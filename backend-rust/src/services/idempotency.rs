//! Idempotency-key handling for mutation endpoints
//!
//! Backs the `Idempotency-Key` header contract used by mutation
//! endpoints that must not double-execute on retry — admin loyalty
//! awards, booking-slip uploads, etc. See
//! `docs/audits/correctness-2026-05-13.md` (CRITICAL #3 and HIGH #5)
//! for the full audit write-up.
//!
//! ## Contract
//!
//! - Caller sends `Idempotency-Key: <client-generated string>` on the
//!   first request.
//! - The handler calls [`IdempotencyService::take_or_replay`]: it tries
//!   to atomically insert a placeholder row keyed by
//!   `(user_id, key)`. On insert success the caller proceeds with the
//!   real work, then calls [`IdempotencyService::record_response`] to
//!   cache the response body and status.
//! - On insert conflict the caller calls
//!   [`IdempotencyService::load_cached_response`] and returns the
//!   previous response instead of re-running the side effect.
//!
//! ## Why this lives in a service (not middleware)
//!
//! Mutation endpoints often run inside a `sqlx::Transaction`. To make
//! the cached response read-after-write consistent with the side
//! effect, the idempotency rows are written inside the same
//! transaction as the actual write. That means the handler — not a
//! generic middleware — needs to see the connection. The middleware
//! shape would either have to commit early (and risk the cached row
//! pointing at a side effect that later rolled back) or duplicate the
//! transaction boundary. A service helper sidesteps both problems.
//!
//! ## TTL / cleanup
//!
//! The TTL is implicit: rows older than the operator-chosen window
//! (e.g. 24h) are deleted by an out-of-band job (pg_cron or a
//! periodic worker). This module only writes rows — see
//! `migrations/20260513010000_idempotency_keys.sql` for the schema.

use sqlx::PgExecutor;
use uuid::Uuid;

/// Outcome of [`take_or_replay`].
#[derive(Debug)]
pub enum IdempotencyOutcome {
    /// This is the first time we've seen `(user_id, key)`. The caller
    /// owns the side effect and must call [`record_response`] before
    /// returning.
    Fresh,
    /// A previous request with the same `(user_id, key)` already
    /// completed. The cached response (status + body) is in
    /// `cached_response` — return it instead of re-running the side
    /// effect.
    Replay(CachedResponse),
}

/// Cached HTTP response for a previously-handled idempotency key.
#[derive(Debug, Clone)]
pub struct CachedResponse {
    pub status: i32,
    pub body: Vec<u8>,
}

/// Reserve `(user_id, key)` if it's fresh, otherwise return the
/// previously-cached response.
///
/// `request_path` is stored for debugging but not used as part of the
/// uniqueness key — re-using the same key against a *different* path
/// would (correctly) hit the cache, since the goal of idempotency is
/// "this client's logical operation should run exactly once".
///
/// Pass `executor` as a mutable transaction reference (`&mut *tx`) so
/// the placeholder row gets rolled back if the handler errors out
/// after reserving. Otherwise a transient failure would permanently
/// block a retry on the same key.
pub async fn take_or_replay<'c, E>(
    executor: E,
    user_id: Uuid,
    key: &str,
    request_path: &str,
) -> Result<IdempotencyOutcome, sqlx::Error>
where
    E: PgExecutor<'c>,
{
    // Try to insert the placeholder. `ON CONFLICT DO NOTHING RETURNING
    // user_id` returns one row on fresh insert and zero rows on
    // conflict — letting us decide between "first time" and "cached"
    // in a single round trip.
    let inserted = sqlx::query!(
        r#"
        INSERT INTO idempotency_keys (user_id, key, request_path, response_status)
        VALUES ($1, $2, $3, 0)
        ON CONFLICT (user_id, key) DO NOTHING
        RETURNING user_id
        "#,
        user_id,
        key,
        request_path,
    )
    .fetch_optional(executor)
    .await?;

    match inserted {
        Some(_) => Ok(IdempotencyOutcome::Fresh),
        None => {
            // We can't read the cached row from the same transaction we
            // just rolled into, because the original write happened in
            // a *different* transaction. Signal to the caller that they
            // must fetch via [`load_cached_response`] against the pool.
            Ok(IdempotencyOutcome::Replay(CachedResponse {
                status: 0,
                body: Vec::new(),
            }))
        },
    }
}

/// Fetch the cached response for `(user_id, key)`.
///
/// Used by the caller after [`take_or_replay`] returns `Replay(_)`
/// (the placeholder body is empty because the SELECT must run outside
/// the transaction that just lost the race — Postgres won't show
/// uncommitted writes from another transaction).
///
/// Returns `Ok(None)` when the row vanished between conflict and
/// fetch (e.g. TTL cleanup ran in the gap) — the caller should then
/// treat the request as fresh.
pub async fn load_cached_response<'c, E>(
    executor: E,
    user_id: Uuid,
    key: &str,
) -> Result<Option<CachedResponse>, sqlx::Error>
where
    E: PgExecutor<'c>,
{
    let row = sqlx::query!(
        r#"
        SELECT response_status, response_body
        FROM idempotency_keys
        WHERE user_id = $1 AND key = $2
        "#,
        user_id,
        key,
    )
    .fetch_optional(executor)
    .await?;

    Ok(row.map(|r| CachedResponse {
        status: r.response_status,
        body: r.response_body.unwrap_or_default(),
    }))
}

/// Store the response status + body for a freshly-handled request so
/// retries with the same key replay this exact payload.
///
/// Call inside the same transaction that wrote the side effect — that
/// way a rollback removes the cached response together with the work
/// it would have replayed.
pub async fn record_response<'c, E>(
    executor: E,
    user_id: Uuid,
    key: &str,
    status: i32,
    body: &[u8],
) -> Result<(), sqlx::Error>
where
    E: PgExecutor<'c>,
{
    sqlx::query!(
        r#"
        UPDATE idempotency_keys
        SET response_status = $3, response_body = $4
        WHERE user_id = $1 AND key = $2
        "#,
        user_id,
        key,
        status,
        body,
    )
    .execute(executor)
    .await?;
    Ok(())
}
