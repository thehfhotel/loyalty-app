//! Public deposit-request-link routes — the guest half of workstream B1
//!
//! Reception issues one link for a booking it already took by phone, LINE
//! or at the desk (`routes::admin_deposit_links`). The guest opens the
//! link, sees the amount and a PromptPay QR with the amount already filled
//! in, uploads the slip, and the slip runs through the same `decide()` and
//! audit path as any other.
//!
//! ## Endpoints
//!
//! - `GET  /api/deposit/:token`      — what the guest page renders
//! - `POST /api/deposit/:token/slip` — the slip upload (multipart, `file`)
//!
//! ## No login, and the reason
//!
//! `routes::bookings::add_booking_slip` requires a session and compares
//! `booking.user_id` against the caller, so an authenticated design needs
//! the guest to hold an account and own the booking. Reception's guests
//! arrive by phone and walk-in, and a login wall is the friction B1 exists
//! to remove. **The token is the capability.**
//!
//! What is reused verbatim is the decision path, not the handler: the
//! upload calls the same storage writer as `POST /api/slips/upload`
//! (`routes::slips::store_slip_upload`, magic-byte checks included), the
//! same `insert_booking_slip_tx` and the same `run_slipok_check`.
//! `slipok_check`, `slip_match::decide`, `record_slipok_result` and
//! `slip_confirm::confirm_slip` are untouched.
//!
//! ## Security notes that are easy to undo by accident
//!
//! - The token is 32 CSPRNG bytes, base64url, and only its SHA-256 ever
//!   reaches the database. Lookup is by hash: no timing oracle, and a
//!   database leak yields no live links.
//! - **Never log the token.** Log `link_id` and `booking_id`. The same
//!   goes for rate-limit keys, which is why the per-token bucket is keyed
//!   on the hex of the hash rather than on the token.
//! - The response carries the guest's *given name only*: no phone, no
//!   email, no membership id, no booking UUID.

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddr};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::rate_limit::{RateLimitConfig, RateLimitError, RedisRateLimiter};
use crate::services::promptpay::PromptPayService;
use crate::state::AppState;

// ============================================================================
// The system actor and the token
// ============================================================================

/// The non-loginable user row every deposit-link booking is owned by.
///
/// Seeded by migration `20260912010000_deposit_links.sql` as
/// `deposit-link@system.hf.invalid`. `bookings.user_id` is NOT NULL and a
/// deposit-link guest has no account, so the row has to point somewhere —
/// and pointing it at a real member would hand that member's session a
/// stranger's slip through the storage authorisation path.
///
/// A fixed constant rather than a lookup: it is part of the cross-repo
/// interface for the deposit programme, so it must never be regenerated.
pub const DEPOSIT_LINK_SYSTEM_USER_ID: Uuid =
    Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0051_10b2);

/// `bookings.booking_source` for a booking created from a deposit link.
///
/// `services::slip_confirm` reads this to decide whether a verified slip
/// may flip a non-channel booking to `confirmed`, so the two must agree on
/// the literal.
pub const BOOKING_SOURCE_DEPOSIT_LINK: &str = "deposit_link";

/// Token entropy. 32 bytes from the OS CSPRNG, base64url-encoded without
/// padding, is 43 characters.
const TOKEN_BYTES: usize = 32;

/// Mint a fresh link token. Returns the token — the only time it exists in
/// plaintext anywhere. Show it to the issuing admin once and forget it.
pub(crate) fn generate_token() -> String {
    use rand::RngCore;

    let mut bytes = [0u8; TOKEN_BYTES];
    // `OsRng` rather than a seeded thread RNG: this value is a bearer
    // credential for money, so it comes from the OS CSPRNG directly.
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 of a token, which is all the database ever sees.
pub(crate) fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

// ============================================================================
// The guest state vocabulary
// ============================================================================

/// The link is live and nothing has been uploaded against it.
pub const STATE_AWAITING_PAYMENT: &str = "awaiting_payment";
/// A slip is in, and no decision has been made on it yet.
pub const STATE_CHECKING: &str = "checking";
/// The booking is paid for as far as the guest is concerned.
pub const STATE_CONFIRMED: &str = "confirmed";
/// The link ran out before anything was verified against it.
pub const STATE_EXPIRED: &str = "expired";
/// Reception killed the link (usually because it reissued one).
pub const STATE_REVOKED: &str = "revoked";

/// What a slip contributes to the state of a link.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SlipFacts {
    /// At least one slip has been uploaded against the booking.
    pub any: bool,
    /// At least one of them reads `admin_status = 'verified'`.
    pub any_verified: bool,
}

/// Derive the one vocabulary the guest page branches on.
///
/// Derived, never stored — a stored copy is a second source of truth that
/// drifts the first time a slip is verified from the admin screen instead
/// of through this module.
///
/// The order is the contract (b1-deposit-link-spec.md §2):
///
/// 1. `revoked_at` set → `revoked`.
/// 2. `expires_at` past **with no verified slip** → `expired`. The
///    verified-slip carve-out is what stops a guest who paid on the last
///    afternoon of the link from being told, an hour later, that their
///    confirmed booking expired.
/// 3. booking `confirmed`, or any slip verified → `confirmed`.
/// 4. a slip present and not verified → `checking`. Every non-verified
///    SlipOK status collapses here: a guest is never shown a vendor
///    verdict.
/// 5. otherwise → `awaiting_payment`.
pub(crate) fn derive_state(
    revoked_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
    booking_status: &str,
    slips: SlipFacts,
    now: DateTime<Utc>,
) -> &'static str {
    if revoked_at.is_some() {
        return STATE_REVOKED;
    }
    if expires_at <= now && !slips.any_verified {
        return STATE_EXPIRED;
    }
    if booking_status == "confirmed" || slips.any_verified {
        return STATE_CONFIRMED;
    }
    if slips.any {
        return STATE_CHECKING;
    }
    STATE_AWAITING_PAYMENT
}

// ============================================================================
// Rate limits
// ============================================================================

/// 30 requests per minute **per link**, layered on the public sub-router
/// in `routes::mod` the way the strict auth limiter is layered —
/// production only, like every other limiter in this codebase.
///
/// The guest page polls the read endpoint every 5 seconds for two minutes
/// after an upload (12/min), so the budget is a little over double what a
/// well-behaved page asks for.
///
/// **Per link, not per IP, and that is the point.** `get_client_ip` reads
/// the TCP peer and deliberately ignores `X-Forwarded-For` (HIGH-2), but
/// in production `/api` is served through nginx, so the peer is the nginx
/// container for every request on earth. A per-IP budget here would be
/// one global bucket: three guests paying at once, at 12 polls a minute
/// each, would exhaust 30/min between them and a paying guest's page
/// would start answering 429 in the middle of a payment. The link is the
/// subject that actually matters on this router, exactly as it already is
/// for the upload budget below.
pub fn public_read_rate_limit() -> RateLimitConfig {
    RateLimitConfig::new(30, 60)
}

/// Rate-limit the public deposit endpoints on the **link** rather than on
/// the client address; see [`public_read_rate_limit`] for why.
///
/// The bucket key is the hex SHA-256 of the token, never the token: the
/// key reaches Redis and, on a Redis failure, the warning log line.
pub async fn deposit_link_rate_limit_middleware(
    State(limiter): State<RedisRateLimiter>,
    Path(token): Path<String>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Result<axum::response::Response, crate::middleware::rate_limit::RateLimitError> {
    limiter
        .check_subject(&hex::encode(token_hash(&token)))
        .await?;
    Ok(next.run(request).await)
}

/// 5 **stored** slips per hour per link.
///
/// Unlike every other limiter here this one runs in *all* environments,
/// and deliberately: the public upload has no authentication at all, so
/// the per-link budget is a property of the capability rather than a
/// production-only convenience. It is safe to leave on in tests because
/// the bucket key is the token hash, which is unique per test.
///
/// Charged **after** the file has validated and been written, never on an
/// attempt. A guest who has already transferred the money and then picks
/// the wrong file five times — a WebP screenshot from an Android gallery,
/// a PDF out of a bank app, a HEIC iOS did not transcode, a truncated
/// upload on a flaky mobile connection — would otherwise be locked out
/// for an hour from the only page that lets them show proof of payment.
const UPLOAD_PER_TOKEN: (u32, u64) = (5, 3600);

/// 30 upload *attempts* per hour per link, charged before the body is
/// read.
///
/// This is the anti-flood budget [`UPLOAD_PER_TOKEN`] used to be, split
/// off so that the strict budget can count stored slips instead. Loose
/// enough that a guest fumbling with their gallery never meets it, tight
/// enough that a token holder cannot make us parse 10 MB bodies all day.
const UPLOAD_ATTEMPTS_PER_TOKEN: (u32, u64) = (30, 3600);

/// 20 uploads per hour per IP. Production only — in tests every request
/// comes from 127.0.0.1, so an always-on IP bucket would leak between test
/// cases and make the suite flaky in a way that says nothing about the
/// code.
///
/// Behind nginx this is effectively one global bucket (see
/// [`public_read_rate_limit`]), so treat it as the coarse backstop it is:
/// the per-link budgets above are the ones that speak about a guest.
const UPLOAD_PER_IP: (u32, u64) = (20, 3600);

/// Turn a limiter refusal into a 429 that tells the truth about *when* to
/// come back.
///
/// `check_subject` has already computed the remaining TTL of the window
/// and hands it back on the error. Discarding it and answering with the
/// full window length instead tells a guest who hit the budget at minute
/// 59 to wait an hour for a bucket that resets in a minute — and a
/// frontend that honours `Retry-After` will do exactly that.
fn too_many_requests(err: RateLimitError) -> AppError {
    let RateLimitError::TooManyRequests { retry_after } = err;
    AppError::TooManyRequests(retry_after as u64)
}

/// Charge one upload *attempt*, before the multipart body is read.
///
/// Deliberately does not touch [`UPLOAD_PER_TOKEN`]: that budget counts
/// slips we actually stored, and is charged by
/// [`charge_stored_slip_budget`] once the file has validated.
async fn charge_upload_attempt_budgets(
    state: &AppState,
    token_hash_hex: &str,
    client_ip: Option<IpAddr>,
) -> AppResult<()> {
    let attempts = RedisRateLimiter::new(
        state.redis(),
        RateLimitConfig::new(UPLOAD_ATTEMPTS_PER_TOKEN.0, UPLOAD_ATTEMPTS_PER_TOKEN.1),
        "deposit_upload_attempt",
    );
    if let Err(e) = attempts.check_subject(token_hash_hex).await {
        return Err(too_many_requests(e));
    }

    if state.is_production() {
        if let Some(ip) = client_ip {
            let per_ip = RedisRateLimiter::new(
                state.redis(),
                RateLimitConfig::new(UPLOAD_PER_IP.0, UPLOAD_PER_IP.1),
                "deposit_upload_ip",
            );
            if let Err(e) = per_ip.check(ip).await {
                return Err(too_many_requests(e));
            }
        }
    }

    Ok(())
}

/// Charge one **stored** slip against the strict per-link budget.
async fn charge_stored_slip_budget(state: &AppState, token_hash_hex: &str) -> AppResult<()> {
    let per_token = RedisRateLimiter::new(
        state.redis(),
        RateLimitConfig::new(UPLOAD_PER_TOKEN.0, UPLOAD_PER_TOKEN.1),
        "deposit_upload_token",
    );
    match per_token.check_subject(token_hash_hex).await {
        Ok(()) => Ok(()),
        Err(e) => Err(too_many_requests(e)),
    }
}

// ============================================================================
// DTOs
// ============================================================================

/// Everything the guest page renders, and nothing else.
///
/// Note what is absent: the guest's phone, the booking UUID, the link id,
/// any membership identifier, and the payer's bank details. The page is
/// reachable by anyone holding the token, so it carries the minimum that
/// lets the right person recognise their own booking.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositLinkPublicResponse {
    pub property: String,
    /// The guest's given name only — "สมชาย", not "สมชาย ใจดี".
    pub guest_given_name: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub nights: i64,
    pub room_type_name: Option<String>,
    pub total_amount: f64,
    pub amount_due_now: f64,
    pub currency: &'static str,
    /// Raw EMVCo PromptPay payload; the page renders the QR client-side.
    ///
    /// `null` once the link can no longer take a payment (`confirmed`,
    /// `expired`, `revoked`) — handing out a payable QR for a dead link is
    /// how a guest pays money nobody is expecting. Also `null` in the
    /// operational corner where the property has no receiving account
    /// configured; the create endpoint refuses to issue a link in that
    /// state, so it can only be reached by removing configuration under a
    /// live link.
    pub promptpay_qr_payload: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub state: &'static str,
    pub slipok_status: Option<String>,
    pub slipok_reason: Option<String>,
}

/// The answer to an upload. `state` is re-derived after the SlipOK check
/// has run, so a slip that auto-verifies comes back as `confirmed` in the
/// same response the upload returns — no refetch, no race with the poll.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositSlipUploadResponse {
    pub slip_id: Uuid,
    pub state: &'static str,
    pub slipok_status: Option<String>,
}

// ============================================================================
// Lookup
// ============================================================================

/// The link joined to its booking. Everything the two handlers need.
struct LinkRow {
    link_id: Uuid,
    booking_id: Uuid,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
    property: Option<String>,
    guest_name: Option<String>,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    total_price: Decimal,
    amount_due_now: Option<Decimal>,
    booking_status: String,
    room_type_name: Option<String>,
}

/// Find a link by the hash of its token.
///
/// An unknown token is a plain 404 carrying no detail: the response must
/// not tell a scanner whether a token was well-formed, recently revoked or
/// never existed.
async fn find_link_by_token(db: &sqlx::PgPool, token: &str) -> AppResult<LinkRow> {
    let hash = token_hash(token);

    let row = sqlx::query!(
        r#"
        SELECT l.id                AS "link_id!",
               l.booking_id        AS "booking_id!",
               l.expires_at        AS "expires_at!",
               l.revoked_at,
               b.property,
               b.guest_name,
               b.check_in_date     AS "check_in_date!",
               b.check_out_date    AS "check_out_date!",
               b.total_price       AS "total_price!",
               b.amount_due_now,
               b.status            AS "booking_status!",
               rt.name             AS "room_type_name?"
        FROM booking_deposit_links l
        JOIN bookings b   ON b.id = l.booking_id
        LEFT JOIN room_types rt ON rt.id = b.room_type_id
        WHERE l.token_hash = $1
        "#,
        &hash,
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Deposit link".to_string()))?;

    Ok(LinkRow {
        link_id: row.link_id,
        booking_id: row.booking_id,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        property: row.property,
        guest_name: row.guest_name,
        check_in_date: row.check_in_date,
        check_out_date: row.check_out_date,
        total_price: row.total_price,
        amount_due_now: row.amount_due_now,
        booking_status: row.booking_status,
        room_type_name: row.room_type_name,
    })
}

/// The slips already attached to a booking, newest first.
///
/// Read as rows rather than aggregated in SQL because two different
/// questions are asked of them — "has any slip been verified" (state) and
/// "what does the newest one say" (the badge) — and a booking under a
/// deposit link carries a handful of slips at most.
async fn read_slip_facts(
    db: &sqlx::PgPool,
    booking_id: Uuid,
) -> AppResult<(SlipFacts, Option<String>, Option<String>)> {
    let rows = sqlx::query!(
        r#"
        SELECT admin_status, slipok_status, slipok_reason
        FROM booking_slips
        WHERE booking_id = $1
        ORDER BY uploaded_at DESC NULLS LAST, id DESC
        "#,
        booking_id,
    )
    .fetch_all(db)
    .await?;

    let facts = SlipFacts {
        any: !rows.is_empty(),
        any_verified: rows
            .iter()
            .any(|r| r.admin_status.as_deref() == Some("verified")),
    };
    let latest_status = rows.first().and_then(|r| r.slipok_status.clone());
    let latest_reason = rows.first().and_then(|r| r.slipok_reason.clone());

    Ok((facts, latest_status, latest_reason))
}

// ============================================================================
// Handlers
// ============================================================================

/// `GET /api/deposit/:token`
///
/// 200 for every *known* token, including an expired or revoked one: the
/// guest holding a dead link needs to be told to call the desk, and a 404
/// there would look like a broken page. 404 only when no link matches.
async fn get_deposit_link(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Json<DepositLinkPublicResponse>> {
    let link = find_link_by_token(state.db(), &token).await?;
    let (slips, slipok_status, slipok_reason) =
        read_slip_facts(state.db(), link.booking_id).await?;

    let derived = derive_state(
        link.revoked_at,
        link.expires_at,
        &link.booking_status,
        slips,
        Utc::now(),
    );

    let amount_due_now = link.amount_due_now.unwrap_or(link.total_price);

    // Only mint a QR while the link can still take a payment.
    let promptpay_qr_payload = if matches!(derived, STATE_AWAITING_PAYMENT | STATE_CHECKING) {
        build_promptpay_payload(&state, link.property.as_deref(), amount_due_now)
    } else {
        None
    };

    // Opens are counted for the A9 shadow-window report and so reception
    // can tell "the guest never opened it" from "the guest opened it and
    // did nothing".
    //
    // A *session*, not a request. This page polls itself every 5 seconds
    // for two minutes after an upload and every 30 seconds after that, so
    // counting requests would score one guest who opened the link once and
    // paid at around thirty, and a page left open in a LINE in-app browser
    // tab at two a minute forever — a number that answers neither question
    // above. The 30-minute gate also means the one endpoint on this
    // service with no authentication at all stops writing to the database
    // on every read.
    //
    // Best-effort either way: a failed counter must never cost the guest
    // their page.
    if let Err(e) = sqlx::query!(
        r#"
        UPDATE booking_deposit_links
        SET open_count      = open_count + 1,
            first_opened_at = COALESCE(first_opened_at, NOW()),
            last_opened_at  = NOW()
        WHERE id = $1
          AND (last_opened_at IS NULL OR last_opened_at < NOW() - INTERVAL '30 minutes')
        "#,
        link.link_id,
    )
    .execute(state.db())
    .await
    {
        tracing::warn!(
            link_id = %link.link_id,
            error = %e,
            "failed to record a deposit-link open"
        );
    }

    Ok(Json(DepositLinkPublicResponse {
        property: link.property.clone().unwrap_or_default(),
        guest_given_name: given_name(link.guest_name.as_deref()),
        check_in: link.check_in_date,
        check_out: link.check_out_date,
        nights: (link.check_out_date - link.check_in_date).num_days(),
        room_type_name: link.room_type_name,
        total_amount: link.total_price.to_f64().unwrap_or(0.0),
        amount_due_now: amount_due_now.to_f64().unwrap_or(0.0),
        currency: "THB",
        promptpay_qr_payload,
        expires_at: link.expires_at,
        state: derived,
        slipok_status,
        slipok_reason,
    }))
}

/// `POST /api/deposit/:token/slip`
///
/// Multipart, field `file` (or `slip`), JPEG or PNG, 10 MB.
///
/// An **expired** link still accepts an upload. The guest transferred the
/// money; refusing the image would leave them with a payment and nowhere
/// to show it. The slip lands in the manual queue on its own, because
/// `slipok_check` already refuses to auto-confirm a booking whose
/// `hold_expires_at` has passed (`booking_not_payable`) — the same branch
/// the PMS channel uses.
///
/// A **revoked** link does not: revocation is reception saying "not this
/// link", and the reissued one is where the slip belongs.
async fn upload_deposit_slip(
    State(state): State<AppState>,
    Path(token): Path<String>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<DepositSlipUploadResponse>)> {
    let link = find_link_by_token(state.db(), &token).await?;
    let token_hash_hex = hex::encode(token_hash(&token));

    // Revocation first, and before any budget: reception saying "not this
    // link" is a 409 the guest can do nothing about, and it must not cost
    // them one of the five slips they are allowed to show.
    if link.revoked_at.is_some() {
        return Err(AppError::Conflict(
            "This payment link is no longer active".to_string(),
        ));
    }

    // The *attempt* budget is charged before the body is read, so a flood
    // costs us a lookup rather than 10 MB of buffering per request. The
    // strict five-slips-an-hour budget is charged further down, once the
    // file has actually validated.
    charge_upload_attempt_budgets(
        &state,
        &token_hash_hex,
        connect_info.map(|ConnectInfo(addr)| addr.ip()),
    )
    .await?;

    // The same writer `POST /api/slips/upload` uses: same 10 MB cap, same
    // JPEG/PNG magic-byte check, same `STORAGE_PATH/slips/<uuid>` target,
    // so F2's retention and access logging cover this with no special case.
    // Everything it rejects — wrong format, oversize, truncated body — is
    // rejected before the strict budget below is touched.
    let slip_url = crate::routes::slips::store_slip_upload(multipart).await?;

    charge_stored_slip_budget(&state, &token_hash_hex).await?;

    let mut tx = state.db().begin().await?;
    let slip = crate::routes::bookings::insert_booking_slip_tx(
        &mut tx,
        link.booking_id,
        &slip_url,
        DEPOSIT_LINK_SYSTEM_USER_ID,
    )
    .await?;
    tx.commit().await?;

    tracing::info!(
        link_id = %link.link_id,
        booking_id = %link.booking_id,
        slip_id = %slip.id,
        "deposit-link slip uploaded"
    );

    // Identical to the authenticated path: run the check inline under one
    // explicit budget so the decision is already stored when this response
    // returns, and swallow a blown budget into a WARN — the slip is then
    // exactly where it was before this feature existed, in the admin queue.
    let budget = crate::routes::bookings::slipok_check_budget(&state);
    let notify_event = match tokio::time::timeout(
        budget,
        crate::routes::bookings::run_slipok_check(&state, slip.id, link.booking_id, &slip_url),
    )
    .await
    {
        Ok(event) => event,
        Err(_) => {
            tracing::warn!(
                slip_id = %slip.id,
                booking_id = %link.booking_id,
                budget_secs = budget.as_secs(),
                "SlipOK check exceeded its latency budget; slip left for manual verification"
            );
            None
        },
    };

    // Outside the budget, for the reason the authenticated path spells out:
    // `notify` claims the event before it spawns the send, so a deadline
    // landing between the claim and the spawn would leave a claimed event
    // nobody ever sends. Out here it races nothing.
    if let Some(event) = notify_event {
        crate::services::booking_notify::notify(&state, link.booking_id, event).await;
    }

    // Re-read: the check above may have verified the slip and flipped the
    // booking, and the guest should see that in this response rather than
    // on the next poll.
    let booking_status: String =
        sqlx::query_scalar!("SELECT status FROM bookings WHERE id = $1", link.booking_id)
            .fetch_one(state.db())
            .await?;
    let (slips, slipok_status, _) = read_slip_facts(state.db(), link.booking_id).await?;

    let derived = derive_state(
        link.revoked_at,
        link.expires_at,
        &booking_status,
        slips,
        Utc::now(),
    );

    Ok((
        StatusCode::CREATED,
        Json(DepositSlipUploadResponse {
            slip_id: slip.id,
            state: derived,
            slipok_status,
        }),
    ))
}

// ============================================================================
// Helpers
// ============================================================================

/// The PromptPay payload for a property, built the way
/// `create_channel_booking` builds it.
///
/// Deliberately **not** `GET /api/payments/promptpay-qr`: that endpoint
/// builds the QR from the group-wide `PROMPTPAY_TAX_ID`, while the matcher
/// compares the payee against `id_for_property(property)`. A QR from the
/// wrong account means every slip comes back `receiver_mismatch`.
pub(crate) fn build_promptpay_payload(
    state: &AppState,
    property: Option<&str>,
    amount: Decimal,
) -> Option<String> {
    let receiving_id = property
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .and_then(|p| state.config().promptpay.id_for_property(p))
        .cloned()?;

    let amount = amount.to_f64()?;

    match PromptPayService::new(receiving_id).and_then(|s| s.generate_payload(amount)) {
        Ok(payload) => Some(payload),
        Err(e) => {
            tracing::warn!(
                property = property.unwrap_or("unknown"),
                error = %e,
                "could not build a PromptPay payload for a deposit link"
            );
            None
        },
    }
}

/// First whitespace-separated token of the stored guest name.
///
/// Reception types a full name; the page shows only enough for the right
/// person to recognise their own booking. Anyone who opens the link
/// already holds the token, but a link forwarded into a group chat should
/// not publish a full name to it.
fn given_name(guest_name: Option<&str>) -> String {
    guest_name
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string()
}

// ============================================================================
// Router
// ============================================================================

/// Public deposit-link routes, mounted at `/api/deposit` with **no auth
/// middleware** — that is the whole design (see the module docs).
pub fn routes() -> Router<AppState> {
    Router::new().route("/:token", get(get_deposit_link)).route(
        "/:token/slip",
        post(upload_deposit_slip)
                // Same per-route body cap as `POST /api/slips/upload`, for
                // the same reason: reject oversize bodies at the
                // body-extraction layer rather than buffering them first.
                .layer(DefaultBodyLimit::max(
                    crate::routes::slips::SLIP_UPLOAD_BODY_LIMIT_BYTES,
                )),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(mins: i64) -> DateTime<Utc> {
        Utc::now() + chrono::Duration::minutes(mins)
    }

    #[test]
    fn deposit_link_system_user_id_is_the_locked_value() {
        // The migration seeds this literal and the cross-repo interface
        // names it. A typo here would break the FK on `bookings.user_id`
        // for every link issued.
        assert_eq!(
            DEPOSIT_LINK_SYSTEM_USER_ID.hyphenated().to_string(),
            "00000000-0000-4000-8000-0000005110b2"
        );
    }

    #[test]
    fn token_is_43_url_safe_characters_and_never_repeats() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 43, "32 bytes base64url without padding");
        assert_ne!(a, b);
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "token must be URL-safe with no padding: {a}"
        );
    }

    #[test]
    fn token_hash_is_sha256_and_stable() {
        let token = "not-a-real-token";
        assert_eq!(token_hash(token).len(), 32);
        assert_eq!(token_hash(token), token_hash(token));
        assert_ne!(token_hash(token), token_hash("not-a-real-token2"));
    }

    #[test]
    fn revoked_wins_over_everything() {
        assert_eq!(
            derive_state(
                Some(ts(-10)),
                ts(60),
                "pending",
                SlipFacts::default(),
                Utc::now()
            ),
            STATE_REVOKED
        );
    }

    #[test]
    fn expiry_defers_to_a_verified_slip() {
        let past = ts(-60);
        // Expired with nothing verified: expired.
        assert_eq!(
            derive_state(None, past, "pending", SlipFacts::default(), Utc::now()),
            STATE_EXPIRED
        );
        // Expired but the guest already paid and it verified: confirmed.
        assert_eq!(
            derive_state(
                None,
                past,
                "pending",
                SlipFacts {
                    any: true,
                    any_verified: true
                },
                Utc::now()
            ),
            STATE_CONFIRMED
        );
    }

    #[test]
    fn a_slip_that_has_not_verified_reads_as_checking() {
        assert_eq!(
            derive_state(
                None,
                ts(60),
                "pending",
                SlipFacts {
                    any: true,
                    any_verified: false
                },
                Utc::now()
            ),
            STATE_CHECKING,
            "every non-verified status collapses onto `checking` — a guest \
             never sees a vendor verdict"
        );
    }

    #[test]
    fn a_confirmed_booking_reads_confirmed_even_with_no_slip_row() {
        // The admin can confirm a booking from the desk without the slip
        // ever landing here.
        assert_eq!(
            derive_state(None, ts(60), "confirmed", SlipFacts::default(), Utc::now()),
            STATE_CONFIRMED
        );
    }

    #[test]
    fn a_live_untouched_link_awaits_payment() {
        assert_eq!(
            derive_state(None, ts(60), "pending", SlipFacts::default(), Utc::now()),
            STATE_AWAITING_PAYMENT
        );
    }

    #[test]
    fn given_name_takes_the_first_token_only() {
        assert_eq!(given_name(Some("สมชาย ใจดี")), "สมชาย");
        assert_eq!(given_name(Some("  Somchai  Jaidee ")), "Somchai");
        assert_eq!(given_name(Some("Somchai")), "Somchai");
        assert_eq!(given_name(None), "");
        assert_eq!(given_name(Some("   ")), "");
    }
}
