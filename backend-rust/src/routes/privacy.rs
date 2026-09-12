//! PDPA data-subject rights requests (task F3)
//!
//! `docs/privacy/2026-09-pdpa-data-map.md` §8 gap 7 names what was missing
//! after account deletion shipped: not the erasure *mechanism* — that is
//! [`crate::services::account_deletion::erase_account`] — but "the
//! admin-facing route that invokes it and the request log around it", with
//! "a written turnaround (PDPA s.30-s.32 default 30 days)".
//!
//! This module is that request log and its two surfaces.
//!
//! ## Member surface (`/api/privacy`, `auth_middleware`)
//!
//! - `POST /api/privacy/requests` — ask. One open request per kind per
//!   member; a second is 409, decided by a partial unique index rather
//!   than a read-then-write, so two taps on a slow phone cannot both win.
//! - `GET  /api/privacy/requests` — the member's own requests and their
//!   status. Never anyone else's: the `WHERE user_id` comes from the JWT,
//!   not from a parameter, so there is no id to tamper with.
//!
//! ## Admin surface (`/api/admin/privacy`, merged into `routes::admin`)
//!
//! - `GET   /api/admin/privacy/requests` — the queue, oldest first,
//!   because the oldest is the closest to the 30-day deadline. Each row
//!   carries `dueAt` and `overdue` so the clock is visible rather than
//!   arithmetic somebody has to remember to do.
//! - `PATCH /api/admin/privacy/requests/:id` — move a request on, with a
//!   resolution note that is **required** on both terminal statuses. A
//!   refusal without a written reason is not a refusal PDPA recognises.
//! - `GET   /api/admin/privacy/requests/:id/export` — the s.30 access
//!   export, and its alias at the spec's literal path
//!   `GET /api/privacy/requests/:id/export` (same handler, same
//!   `require_admin` guard; see [`routes`]).
//!
//! ## What erasure does here
//!
//! Resolving an `erasure` request as `done` **calls**
//! [`crate::services::account_deletion::erase_account`] with
//! [`DeletionActor::Admin`] — it does not reimplement it. That function
//! already nulls the identifiers, deletes the `line_friendships` rows,
//! revokes sessions, purges notifications, depersonalises
//! `user_audit_log` and writes the `user_deletions` audit row, all in one
//! transaction. Duplicating any of that here would produce a second
//! erasure that drifts from the first, which is the failure mode the
//! shared service exists to prevent.
//!
//! What it deliberately does **not** do is reach past the retention
//! floors. `bookings`, `booking_slips`, `points_transactions`, `stays`
//! and `booking_audit_log` survive an erasure under `AUDIT_LOG_RETENTION_DAYS`
//! (floored at 365 days), `SLIP_ACCESS_LOG_RETENTION_DAYS` (floored at 90)
//! and `SLIP_RETENTION_DAYS`. `docs/privacy/rights-path.md` states, in the
//! words the desk gives the guest, what disappears at once and what
//! expires later.
//!
//! ## Slip images are never in an export
//!
//! A slip is a photograph of somebody's bank transfer, and §1 of the map
//! is emphatic that the payer is frequently **not** the guest. Handing the
//! guest's export a picture of a third party's account name and number
//! would be a disclosure we have no basis for — an access request under
//! s.30 is a right to *one's own* data. [`EXPORT_SQL`] therefore lists
//! slip columns one by one and `slip_url` is not among them; the response
//! says so out loud in `slipImages.included = false` rather than leaving
//! the absence to be noticed.
//!
//! ## Runtime queries, not the macros
//!
//! Every statement here is a runtime `sqlx::query` with `.bind`, the style
//! `routes::analytics` and `services::audit_retention` use. That is a
//! deliberate choice: the compile-time macros would add entries to the
//! `.sqlx/` offline cache that CI verifies, and a fixed-shape read has
//! nothing to gain from it.
//!
//! ## Members only, and the seam that admits it
//!
//! `privacy_requests.user_id` is NOT NULL, so this serves an
//! authenticated member. §2 of the map is blunt that a deposit-link guest
//! has no account and will never be found by `user_id`; their branch is
//! the published contact address and the manual desk procedure in
//! `docs/privacy/rights-path.md`. The identity proof that branch needs is
//! an owner-and-lawyer decision (F1 §10 Q4), so the code states the seam
//! instead of pretending to cover it.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sqlx::Row;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, require_admin, AuthUser};
use crate::services::account_deletion::{erase_account, DeletionActor};
use crate::state::AppState;

// ============================================================================
// Constants
// ============================================================================

/// The PDPA s.30/s.31/s.32 default turnaround. Reported to the admin as
/// `dueAt` so the clock belongs to the row rather than to somebody's memory.
pub const RESPONSE_WINDOW_DAYS: i64 = 30;

/// The longest member-supplied note we store. Long enough for a paragraph
/// explaining what is wrong with a name; short enough that the column
/// cannot be used as free storage.
pub const MAX_NOTE_CHARS: usize = 2_000;

/// Statuses that count as live work. Kept in one place because the partial
/// unique index in `20260915030000_privacy_requests.sql` uses exactly this
/// set, and the two drifting apart would quietly break the 409.
const LIVE_STATUSES: [&str; 2] = ["open", "in_progress"];

/// Why a slip image is never in an access export. Returned verbatim in the
/// response so the reason travels with the data instead of living only in
/// this file.
const SLIP_IMAGE_EXCLUSION_REASON: &str = "Slip images are photographs of a bank transfer and \
     routinely show the account name and number of a third party who sent the money on the \
     guest's behalf. Releasing the image would disclose that third party's banking data, which \
     an access request under PDPA s.30 does not cover. Slip metadata (amount reference, \
     verification status and decision times) is included in full.";

/// Fields held about the member that an export deliberately withholds, and
/// which the desk releases only after a human has read them. Stated in the
/// response so the export never looks more complete than it is.
const WITHHELD_FROM_EXPORT: [&str; 4] = [
    "booking_slips.slip_url (and the image file itself) — see slipImages.reason",
    "bookings.admin_notes — internal staff commentary, released after review",
    "points_transactions.admin_reason — internal staff commentary, released after review",
    "user_coupons.qr_code — a redemption credential, not descriptive data",
];

// ============================================================================
// Types
// ============================================================================

/// The four rights this path serves. Names match
/// `chk_privacy_requests_kind`; serde rejects anything else before a
/// handler runs, so an unknown kind is a 400 at the boundary rather than a
/// constraint violation at the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    /// PDPA s.30 — a copy of the data we hold.
    Access,
    /// PDPA s.33 — erase it.
    Erasure,
    /// PDPA s.35 — correct it.
    Rectification,
    /// PDPA s.32 — object, in practice "stop messaging me".
    Objection,
}

impl RequestKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Access => "access",
            Self::Erasure => "erasure",
            Self::Rectification => "rectification",
            Self::Objection => "objection",
        }
    }
}

/// A terminal or in-flight status an admin may move a request to.
///
/// `open` is absent on purpose: a request starts there and never returns.
/// Re-opening a closed request would restart a clock that already ran, so
/// the desk files a fresh request instead — which the partial unique index
/// permits precisely because it only covers live rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionStatus {
    InProgress,
    Done,
    Refused,
}

impl ResolutionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Refused => "refused",
        }
    }

    /// `done` and `refused` close a request: they set `resolved_at` and
    /// require a written note. `chk_privacy_requests_resolved_at` holds the
    /// first half of that invariant in the database.
    fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Refused)
    }
}

/// `POST /api/privacy/requests` body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequestBody {
    pub kind: RequestKind,
    #[serde(default)]
    pub note: Option<String>,
}

/// `PATCH /api/admin/privacy/requests/:id` body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequestBody {
    pub status: ResolutionStatus,
    #[serde(default)]
    pub resolution_note: Option<String>,
}

/// One request as the member sees it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyRequestResponse {
    pub id: Uuid,
    pub kind: String,
    pub status: String,
    pub note: Option<String>,
    pub requested_at: DateTime<Utc>,
    /// `requested_at + 30 days`. Shown to the member too: a published
    /// turnaround nobody can see is a promise with no witness.
    pub due_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution_note: Option<String>,
}

/// One request as the desk sees it: the member's row plus enough identity
/// to find them, and the clock made explicit.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPrivacyRequestResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    /// NULL for an already-erased member — which is a normal state here,
    /// since an erasure request that completed destroys the address.
    pub email: Option<String>,
    pub membership_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub note: Option<String>,
    pub requested_at: DateTime<Utc>,
    pub due_at: DateTime<Utc>,
    /// `true` once the 30-day window has passed with the request still
    /// live. Computed, never stored: a stored flag would need a job to
    /// keep it true.
    pub overdue: bool,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolved_by: Option<Uuid>,
    pub resolution_note: Option<String>,
}

/// Query string for the admin queue.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminListQuery {
    /// `open` (the default — live work only) or `all`.
    #[serde(default)]
    pub status: Option<String>,
}

// ============================================================================
// Member handlers
// ============================================================================

/// The columns every read of this table returns, in one place so the three
/// readers cannot drift.
const REQUEST_COLUMNS: &str = "id, user_id, kind, status, note, requested_at, resolved_at, \
                               resolved_by, resolution_note";

fn member_row(row: &sqlx::postgres::PgRow) -> AppResult<PrivacyRequestResponse> {
    let requested_at: DateTime<Utc> = row.try_get("requested_at")?;
    Ok(PrivacyRequestResponse {
        id: row.try_get("id")?,
        kind: row.try_get("kind")?,
        status: row.try_get("status")?,
        note: row.try_get("note")?,
        requested_at,
        due_at: requested_at + Duration::days(RESPONSE_WINDOW_DAYS),
        resolved_at: row.try_get("resolved_at")?,
        resolution_note: row.try_get("resolution_note")?,
    })
}

/// Normalise a free-text field: trim, treat empty as absent, refuse
/// anything past the cap. Returning an error rather than truncating means
/// a member never discovers later that half their sentence was dropped.
fn clean_note(note: Option<String>, field: &str) -> AppResult<Option<String>> {
    let Some(note) = note else { return Ok(None) };
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::Validation(format!(
            "{field} must be {MAX_NOTE_CHARS} characters or fewer"
        )));
    }
    Ok(Some(trimmed.to_string()))
}

/// `POST /api/privacy/requests`
///
/// The duplicate guard is `ON CONFLICT … DO NOTHING` against the partial
/// unique index, not a `SELECT` first: under two concurrent taps a
/// read-then-write lets both through, and the member ends up with two open
/// erasure requests and a desk that answers one of them.
async fn create_request(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateRequestBody>,
) -> AppResult<(StatusCode, Json<PrivacyRequestResponse>)> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::Unauthorized("Invalid user id in token".to_string()))?;
    let note = clean_note(body.note, "note")?;

    let sql = format!(
        "INSERT INTO privacy_requests (user_id, kind, note) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, kind) WHERE status IN ('open', 'in_progress') DO NOTHING \
         RETURNING {REQUEST_COLUMNS}"
    );

    let row = sqlx::query(&sql)
        .bind(user_id)
        .bind(body.kind.as_str())
        .bind(note.as_deref())
        .fetch_optional(state.db())
        .await?;

    let Some(row) = row else {
        return Err(AppError::Conflict(format!(
            "You already have an open {} request. We will answer it within {} days.",
            body.kind.as_str(),
            RESPONSE_WINDOW_DAYS
        )));
    };

    // The member's own audit trail records that they exercised a right.
    // `user_audit_log` is the established sink for user-scoped events
    // (`routes/auth.rs`, `services/oauth.rs`); no personal data beyond the
    // kind goes in, and the note deliberately does not.
    audit(
        state.db(),
        user_id,
        "privacy_request_created",
        json!({ "kind": body.kind.as_str() }),
    )
    .await;

    Ok((StatusCode::CREATED, Json(member_row(&row)?)))
}

/// `GET /api/privacy/requests` — the member's own, newest first.
async fn list_my_requests(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<JsonValue>> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::Unauthorized("Invalid user id in token".to_string()))?;

    let sql = format!(
        "SELECT {REQUEST_COLUMNS} FROM privacy_requests WHERE user_id = $1 \
         ORDER BY requested_at DESC LIMIT 100"
    );
    let rows = sqlx::query(&sql)
        .bind(user_id)
        .fetch_all(state.db())
        .await?;

    let requests = rows.iter().map(member_row).collect::<AppResult<Vec<_>>>()?;

    Ok(Json(json!({
        "requests": requests,
        "responseWindowDays": RESPONSE_WINDOW_DAYS,
    })))
}

// ============================================================================
// Admin handlers
// ============================================================================

fn admin_row(
    row: &sqlx::postgres::PgRow,
    now: DateTime<Utc>,
) -> AppResult<AdminPrivacyRequestResponse> {
    let requested_at: DateTime<Utc> = row.try_get("requested_at")?;
    let due_at = requested_at + Duration::days(RESPONSE_WINDOW_DAYS);
    let resolved_at: Option<DateTime<Utc>> = row.try_get("resolved_at")?;
    Ok(AdminPrivacyRequestResponse {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        email: row.try_get("email")?,
        membership_id: row.try_get("membership_id")?,
        kind: row.try_get("kind")?,
        status: row.try_get("status")?,
        note: row.try_get("note")?,
        requested_at,
        due_at,
        overdue: resolved_at.is_none() && now > due_at,
        resolved_at,
        resolved_by: row.try_get("resolved_by")?,
        resolution_note: row.try_get("resolution_note")?,
    })
}

/// `GET /api/admin/privacy/requests?status=open|all`
///
/// Default is the live queue. Oldest first: the oldest request is the one
/// nearest the deadline, so the natural reading order is also the correct
/// working order.
async fn admin_list_requests(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<AdminListQuery>,
) -> AppResult<Json<JsonValue>> {
    require_admin(&auth_user)?;

    let all = matches!(query.status.as_deref(), Some("all"));
    let sql = format!(
        "SELECT pr.id, pr.user_id, u.email, up.membership_id, pr.kind, pr.status, pr.note, \
                pr.requested_at, pr.resolved_at, pr.resolved_by, pr.resolution_note \
         FROM privacy_requests pr \
         JOIN users u ON u.id = pr.user_id \
         LEFT JOIN user_profiles up ON up.user_id = pr.user_id \
         {} \
         ORDER BY pr.requested_at ASC LIMIT 500",
        if all {
            ""
        } else {
            "WHERE pr.status IN ('open', 'in_progress')"
        }
    );

    let now = Utc::now();
    let rows = sqlx::query(&sql).fetch_all(state.db()).await?;
    let requests = rows
        .iter()
        .map(|row| admin_row(row, now))
        .collect::<AppResult<Vec<_>>>()?;

    let open_count = requests
        .iter()
        .filter(|r| LIVE_STATUSES.contains(&r.status.as_str()))
        .count();
    let overdue_count = requests.iter().filter(|r| r.overdue).count();

    Ok(Json(json!({
        "requests": requests,
        "openCount": open_count,
        "overdueCount": overdue_count,
        "responseWindowDays": RESPONSE_WINDOW_DAYS,
    })))
}

/// `PATCH /api/admin/privacy/requests/:id`
///
/// Three rules, all enforced here rather than trusted to the UI:
///
/// 1. A closed request cannot be re-closed. 409, because the second caller
///    is acting on a stale screen and overwriting somebody's resolution
///    note silently would be worse than refusing.
/// 2. `done` and `refused` require a written note.
/// 3. Resolving an `erasure` as `done` runs the erase **first**, inside
///    the same request. If [`erase_account`] fails the row stays live, so
///    the log never claims an erasure that did not happen.
async fn admin_resolve_request(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ResolveRequestBody>,
) -> AppResult<Json<JsonValue>> {
    require_admin(&auth_user)?;
    let admin_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::Unauthorized("Invalid user id in token".to_string()))?;

    let resolution_note = clean_note(body.resolution_note, "resolutionNote")?;
    if body.status.is_terminal() && resolution_note.is_none() {
        return Err(AppError::Validation(
            "A resolution note is required when a request is marked done or refused".to_string(),
        ));
    }

    let existing = sqlx::query("SELECT user_id, kind, status FROM privacy_requests WHERE id = $1")
        .bind(id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound("Privacy request".to_string()))?;

    let subject_id: Uuid = existing.try_get("user_id")?;
    let kind: String = existing.try_get("kind")?;
    let current_status: String = existing.try_get("status")?;

    if !LIVE_STATUSES.contains(&current_status.as_str()) {
        return Err(AppError::Conflict(format!(
            "This request is already {current_status} and cannot be changed"
        )));
    }

    // Rule 3: the erase runs before the row is marked done. An erasure
    // recorded as complete that did not run is the one inconsistency this
    // table exists to make impossible.
    //
    // The order is deliberate and it is the *lesser* of two races. Claiming
    // the row first and erasing second would mean a failed erase leaves a
    // request marked done — the log lying about what happened. This way the
    // residual window is the opposite: a second admin could refuse the same
    // request between the read above and the UPDATE below, in which case the
    // account is erased and this call answers 409. That is visible (the
    // member shows as erased, the request shows as refused) and recoverable,
    // where a silent false "done" is neither. Closing it entirely would mean
    // holding a row lock across `erase_account`'s own transaction, which
    // buys little against two admins deciding the same request in opposite
    // directions in the same second.
    let mut erasure: Option<JsonValue> = None;
    if kind == RequestKind::Erasure.as_str() && body.status == ResolutionStatus::Done {
        let outcome = erase_account(state.db(), subject_id, DeletionActor::Admin(admin_id))
            .await?
            .ok_or_else(|| AppError::NotFound("User".to_string()))?;
        erasure = Some(json!({
            "alreadyErased": outcome.already_erased,
            "lineFriendshipsSevered": outcome.line_friendships_severed,
            "refreshTokensRevoked": outcome.refresh_tokens_revoked,
            "notificationsPurged": outcome.notifications_purged,
            "auditRowsDepersonalised": outcome.audit_rows_depersonalised,
        }));
    }

    let terminal = body.status.is_terminal();
    let sql = format!(
        "UPDATE privacy_requests SET status = $2, resolution_note = $3, \
            resolved_at = CASE WHEN $4 THEN NOW() ELSE NULL END, \
            resolved_by = CASE WHEN $4 THEN $5::uuid ELSE NULL END \
         WHERE id = $1 AND status IN ('open', 'in_progress') \
         RETURNING {REQUEST_COLUMNS}"
    );

    let row = sqlx::query(&sql)
        .bind(id)
        .bind(body.status.as_str())
        .bind(resolution_note.as_deref())
        .bind(terminal)
        .bind(admin_id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| {
            // Lost a race with another admin between the read and the
            // write. Same answer as rule 1.
            AppError::Conflict("This request was resolved by someone else".to_string())
        })?;

    audit(
        state.db(),
        subject_id,
        "privacy_request_resolved",
        json!({
            "requestId": id,
            "kind": kind,
            "status": body.status.as_str(),
            "adminId": admin_id,
            "erasure": erasure,
        }),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "request": member_row(&row)?,
        "erasure": erasure,
    })))
}

/// `GET /api/admin/privacy/requests/:id/export`
/// (alias: `GET /api/privacy/requests/:id/export`)
///
/// The s.30 answer, assembled on demand and never stored. One statement
/// builds the whole document in Postgres — see [`EXPORT_SQL`] for why the
/// column lists are spelled out one by one.
async fn admin_export_request(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<JsonValue>> {
    require_admin(&auth_user)?;
    let admin_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::Unauthorized("Invalid user id in token".to_string()))?;

    let existing = sqlx::query("SELECT user_id, kind, status FROM privacy_requests WHERE id = $1")
        .bind(id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound("Privacy request".to_string()))?;

    let subject_id: Uuid = existing.try_get("user_id")?;
    let kind: String = existing.try_get("kind")?;

    if kind != RequestKind::Access.as_str() {
        return Err(AppError::Validation(format!(
            "An export answers an access request; this one is a {kind} request"
        )));
    }

    let data: JsonValue = sqlx::query_scalar(EXPORT_SQL)
        .bind(subject_id)
        .fetch_one(state.db())
        .await?;

    // Gap 2 of the map, generalised: a bulk read of a member's data that
    // nobody can attribute afterwards is the thing F2 fixed for slip
    // images. An export is a larger read than a slip view, so it gets the
    // same treatment — and unlike the slip log this row is not
    // best-effort: an export we cannot attribute is one we should not have
    // produced.
    sqlx::query(
        "INSERT INTO user_audit_log (user_id, action, details) VALUES ($1, 'privacy_access_export', $2)",
    )
    .bind(subject_id)
    .bind(json!({
        "requestId": id,
        "adminId": admin_id,
        "slipImagesIncluded": false,
    }))
    .execute(state.db())
    .await?;

    Ok(Json(json!({
        "requestId": id,
        "userId": subject_id,
        "generatedAt": Utc::now(),
        "generatedBy": admin_id,
        "slipImages": {
            "included": false,
            "reason": SLIP_IMAGE_EXCLUSION_REASON,
        },
        "withheld": WITHHELD_FROM_EXPORT,
        "data": data,
    })))
}

/// Best-effort `user_audit_log` write.
///
/// The request itself already succeeded and its row is committed; failing
/// the response because the audit insert lost a connection would tell the
/// member their request did not register when it did. Logged loudly
/// instead — the same trade-off `services::slip_access_log::record_best_effort`
/// makes, and for the same reason. The *export* audit above is the one
/// exception and is not routed through here.
async fn audit(db: &sqlx::PgPool, user_id: Uuid, action: &str, details: JsonValue) {
    if let Err(err) =
        sqlx::query("INSERT INTO user_audit_log (user_id, action, details) VALUES ($1, $2, $3)")
            .bind(user_id)
            .bind(action)
            .bind(details)
            .execute(db)
            .await
    {
        tracing::error!(
            action = action,
            error = %err,
            "failed to write privacy-request audit row"
        );
    }
}

// ============================================================================
// The export document
// ============================================================================

/// One statement, one JSONB document.
///
/// Every column is named explicitly rather than `SELECT *`, and that is
/// the whole security property of this query: a future `ALTER TABLE` that
/// adds a column to `booking_slips` cannot silently put it in a guest's
/// export, and `slip_url` — the pointer to a third party's bank
/// photograph — is absent by construction rather than by a filter somebody
/// has to remember.
///
/// Also excluded, and listed to the caller in `withheld`: internal staff
/// commentary (`bookings.admin_notes`, `points_transactions.admin_reason`)
/// which the desk releases only after a human has read it, and
/// `user_coupons.qr_code`, which is a redemption credential rather than
/// descriptive data.
const EXPORT_SQL: &str = r#"
SELECT jsonb_build_object(
    'profile', (
        SELECT to_jsonb(p) FROM (
            SELECT u.id                AS user_id,
                   u.email,
                   u.role::text        AS role,
                   u.is_active,
                   u.email_verified,
                   u.oauth_provider,
                   u.oauth_provider_id,
                   u.created_at,
                   u.updated_at,
                   u.deleted_at,
                   up.first_name,
                   up.last_name,
                   up.phone,
                   up.date_of_birth,
                   up.avatar_url,
                   up.membership_id,
                   up.preferences
            FROM users u
            LEFT JOIN user_profiles up ON up.user_id = u.id
            WHERE u.id = $1
        ) p
    ),
    'loyalty', (
        SELECT to_jsonb(l) FROM (
            SELECT ul.current_points,
                   ul.total_nights,
                   t.name AS tier_name,
                   ul.tier_updated_at,
                   ul.points_updated_at
            FROM user_loyalty ul
            LEFT JOIN tiers t ON t.id = ul.tier_id
            WHERE ul.user_id = $1
        ) l
    ),
    'bookings', COALESCE((
        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at) FROM (
            SELECT id, property, status, check_in_date, check_out_date, num_guests,
                   total_price, discount_amount, payment_type, payment_amount,
                   amount_due_now, balance_due, guest_name, guest_phone,
                   booking_source, pms_booking_id, pms_ref, notes,
                   cancelled_at, cancellation_reason, points_earned,
                   created_at, updated_at
            FROM bookings WHERE user_id = $1
        ) b
    ), '[]'::jsonb),
    'stays', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.check_in) FROM (
            SELECT id, pms_stay_id, property, check_in, check_out, nights,
                   points_awarded, created_at
            FROM stays WHERE user_id = $1
        ) s
    ), '[]'::jsonb),
    'pointsTransactions', COALESCE((
        SELECT jsonb_agg(to_jsonb(pt) ORDER BY pt.created_at) FROM (
            SELECT id, points, type::text AS type, description, reference_id,
                   nights_stayed, expires_at, created_at
            FROM points_transactions WHERE user_id = $1
        ) pt
    ), '[]'::jsonb),
    'coupons', COALESCE((
        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at) FROM (
            SELECT uc.id, co.code, co.name, uc.status::text AS status,
                   uc.used_at, uc.redemption_location, uc.expires_at, uc.created_at
            FROM user_coupons uc
            LEFT JOIN coupons co ON co.id = uc.coupon_id
            WHERE uc.user_id = $1
        ) c
    ), '[]'::jsonb),
    'surveyResponses', COALESCE((
        SELECT jsonb_agg(to_jsonb(sr) ORDER BY sr.started_at) FROM (
            SELECT id, survey_id, answers, is_completed, progress,
                   started_at, completed_at
            FROM survey_responses WHERE user_id = $1
        ) sr
    ), '[]'::jsonb),
    'paymentSlips', COALESCE((
        SELECT jsonb_agg(to_jsonb(sl) ORDER BY sl.uploaded_at) FROM (
            SELECT bs.id, bs.booking_id, bs.uploaded_at, bs.is_primary,
                   bs.slipok_status, bs.slipok_reason, bs.slipok_trans_ref,
                   bs.slipok_checked_at, bs.admin_status, bs.admin_verified_at,
                   bs.deleted_at AS image_erased_at, bs.deletion_reason
            FROM booking_slips bs
            JOIN bookings bk ON bk.id = bs.booking_id
            WHERE bk.user_id = $1
        ) sl
    ), '[]'::jsonb),
    'lineFriendships', COALESCE((
        SELECT jsonb_agg(to_jsonb(lf) ORDER BY lf.property) FROM (
            SELECT f.property, f.is_friend, f.followed_at, f.updated_at
            FROM line_friendships f
            JOIN users lu ON lu.oauth_provider = 'line'
                         AND lu.oauth_provider_id = f.line_user_id
            WHERE lu.id = $1
        ) lf
    ), '[]'::jsonb),
    'privacyRequests', COALESCE((
        SELECT jsonb_agg(to_jsonb(pq) ORDER BY pq.requested_at) FROM (
            SELECT id, kind, status, note, requested_at, resolved_at, resolution_note
            FROM privacy_requests WHERE user_id = $1
        ) pq
    ), '[]'::jsonb)
)
"#;

// ============================================================================
// Routers
// ============================================================================

/// Member routes, mounted at `/api/privacy`.
///
/// The `:id/export` route is the alias mentioned in the module docs: the
/// F3 brief names `GET /api/privacy/requests/{id}/export` literally while
/// also asking for the admin surface to live under the admin router, so
/// the handler is reachable from both and `require_admin` guards it in
/// either case. One handler, two paths — not two implementations.
///
/// Rate limiting: in production the whole `/api` tree already sits under
/// the default Redis limiter (`routes::mod::create_router`), and the
/// writing route additionally takes the strict bucket, the same layering
/// `auth::routes` gets. Both are production-only for the reason stated
/// there — an integration suite hammering the same endpoint from
/// 127.0.0.1 would otherwise trip a 5/min budget and fail for the wrong
/// reason.
pub fn routes(state: AppState) -> Router<AppState> {
    use crate::middleware::rate_limit::{redis_rate_limit_middleware, RedisRateLimiter};

    let write = Router::new().route("/requests", axum::routing::post(create_request));
    let write = if state.is_production() {
        write.route_layer(middleware::from_fn_with_state(
            RedisRateLimiter::strict(state.redis(), "privacy"),
            redis_rate_limit_middleware,
        ))
    } else {
        write
    };

    Router::new()
        .route("/requests", get(list_my_requests))
        .route("/requests/:id/export", get(admin_export_request))
        .merge(write)
        .layer(middleware::from_fn(auth_middleware))
}

/// Admin routes, merged into `routes::admin::router()` — which supplies
/// `auth_middleware` for the whole merged tree, so this adds none.
pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route("/privacy/requests", get(admin_list_requests))
        .route("/privacy/requests/:id", patch(admin_resolve_request))
        .route("/privacy/requests/:id/export", get(admin_export_request))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_match_the_migration_check_constraint() {
        // `chk_privacy_requests_kind` lists exactly these four. A fifth
        // variant added here without the migration would be a runtime
        // constraint violation on a guest's rights request — the worst
        // place to discover a typo.
        assert_eq!(RequestKind::Access.as_str(), "access");
        assert_eq!(RequestKind::Erasure.as_str(), "erasure");
        assert_eq!(RequestKind::Rectification.as_str(), "rectification");
        assert_eq!(RequestKind::Objection.as_str(), "objection");
    }

    #[test]
    fn statuses_match_the_migration_check_constraint() {
        assert_eq!(ResolutionStatus::InProgress.as_str(), "in_progress");
        assert_eq!(ResolutionStatus::Done.as_str(), "done");
        assert_eq!(ResolutionStatus::Refused.as_str(), "refused");
    }

    #[test]
    fn live_statuses_match_the_partial_unique_index() {
        // The 409 is decided by `uq_privacy_requests_open_kind`, whose
        // predicate is `status IN ('open','in_progress')`. If this array
        // and that predicate disagree, the duplicate guard and the queue
        // filter stop describing the same set of rows.
        assert_eq!(LIVE_STATUSES, ["open", "in_progress"]);
    }

    #[test]
    fn only_terminal_statuses_require_a_resolution_note() {
        assert!(!ResolutionStatus::InProgress.is_terminal());
        assert!(ResolutionStatus::Done.is_terminal());
        assert!(ResolutionStatus::Refused.is_terminal());
    }

    #[test]
    fn an_unknown_kind_is_rejected_at_deserialise_time() {
        // A 400 at the boundary, not a constraint violation at the
        // database. Casing must fail too — snake_case only.
        assert!(serde_json::from_str::<RequestKind>(r#""deletion""#).is_err());
        assert!(serde_json::from_str::<RequestKind>(r#""Access""#).is_err());
        assert!(serde_json::from_str::<RequestKind>(r#""access""#).is_ok());
    }

    #[test]
    fn an_admin_cannot_move_a_request_back_to_open() {
        // `open` is deliberately absent from `ResolutionStatus`: a
        // re-opened request would restart a clock that already ran.
        assert!(serde_json::from_str::<ResolutionStatus>(r#""open""#).is_err());
    }

    #[test]
    fn the_export_never_names_the_slip_image_column() {
        // The one assertion that would have caught a `SELECT *` on
        // `booking_slips`. `slip_url` is the path to a photograph of a
        // third party's bank account; `slipok_response` is the vendor's
        // raw JSON, which carries the payer's name.
        assert!(!EXPORT_SQL.contains("slip_url"));
        assert!(!EXPORT_SQL.contains("slipok_response"));
        assert!(!EXPORT_SQL.contains("admin_notes"));
        assert!(!EXPORT_SQL.contains("qr_code"));
        assert!(!EXPORT_SQL.contains("password_hash"));
        // And it does carry the metadata a guest is entitled to.
        assert!(EXPORT_SQL.contains("slipok_trans_ref"));
    }

    #[test]
    fn notes_are_trimmed_blank_to_none_and_capped() {
        assert_eq!(clean_note(None, "note").unwrap(), None);
        assert_eq!(clean_note(Some("   ".to_string()), "note").unwrap(), None);
        assert_eq!(
            clean_note(Some("  my surname  ".to_string()), "note").unwrap(),
            Some("my surname".to_string())
        );
        let too_long = "ก".repeat(MAX_NOTE_CHARS + 1);
        assert!(clean_note(Some(too_long), "note").is_err());
        // The cap counts characters, not bytes: a Thai note is three bytes
        // per character and would otherwise be rejected at a third of the
        // stated length.
        let thai_at_cap = "ก".repeat(MAX_NOTE_CHARS);
        assert!(clean_note(Some(thai_at_cap), "note").is_ok());
    }

    #[test]
    fn the_response_window_is_the_pdpa_default() {
        assert_eq!(RESPONSE_WINDOW_DAYS, 30);
    }
}
