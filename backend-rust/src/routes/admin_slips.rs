//! Admin booking-slip moderation routes
//!
//! Backs the **Slip Viewer Sidebar** in `BookingManagement.tsx`. The viewer
//! shows the slip image, the SlipOK auto-verification status, and gives
//! the admin two manual actions:
//!
//! - "Verify" the slip — mark it as `admin_status='verified'`, stamp
//!   `admin_verified_by`/`admin_verified_at`, optionally attach notes.
//! - "Needs action" — mark it as `admin_status='needs_action'` with notes
//!   explaining what the user needs to fix (wrong amount, blurry, etc.).
//!
//! ## Endpoints
//!
//! - `GET  /api/admin/bookings/slips/:slip_id`              — read one slip
//! - `POST /api/admin/bookings/slips/:slip_id/verify`       — admin verify
//! - `POST /api/admin/bookings/slips/:slip_id/needs-action` — admin reject
//! - `GET  /api/admin/bookings/slips/:slip_id/access-log`   — who read it
//!
//! ## Access logging (F2)
//!
//! The first three all answer with the slip's image URL, so each writes a
//! `slip_access_log` row naming the admin, the slip and the time — the
//! record `docs/privacy/2026-09-pdpa-data-map.md` §7 says did not exist. The
//! fourth reads that log back and is not itself a slip read.
//!
//! Note the mount path: nested under `/bookings/slips/...` to match the
//! frontend's `verifySlipByIdMutation` URL in `SlipViewerSidebar.tsx:130-158`
//! and the entry in `docs/admin-backend-gaps.md`. The slip operations live
//! in their own file (rather than `admin_rooms` or `admin.rs`) because
//! they're conceptually unrelated to room inventory and the broader admin
//! page surface is large enough already.
//!
//! ## Audit logging
//!
//! Each slip mutation writes a `booking_audit_log` row inside the same
//! transaction as the slip update, so the slip viewer's audit-history panel
//! can show "Admin X verified slip Y at Z". The slip row itself carries the
//! same facts denormalised: `admin_verified_by`, `admin_verified_at`,
//! `admin_notes`.
//!
//! An **automatic** verification writes the same row, attributed to the
//! SlipOK system actor (`services::slip_confirm::SLIPOK_SYSTEM_USER_ID`),
//! which is also what `autoVerified` on the response reports. Machine and
//! human decisions are therefore told apart by the actor, not by the
//! presence or absence of a row.
//!
//! ## Where the verify logic lives
//!
//! The verify action's effects — mark the slip verified, write the audit
//! row, push the payment event to the PMS, confirm the booking — live in
//! `services::slip_confirm`, because the automatic SlipOK check runs the
//! same code with no admin behind it. Do not re-implement any of it here.
//!
//! ## sqlx note
//!
//! Uses compile-time `sqlx::query!`/`query_as!` macros, validated against
//! the offline cache in `backend-rust/.sqlx/`. Regenerate with
//! `backend-rust/scripts/regen-sqlx-cache.sh` after any query change.

use axum::{
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{require_admin, AuthUser};
use crate::services::slip_access_log;
use crate::state::AppState;

// ============================================================================
// DTOs
// ============================================================================

/// Optional notes for the verify action. The frontend doesn't currently
/// send a body for verify (`verifySlipByIdMutation` in `SlipViewerSidebar`),
/// so the body is fully optional. We still accept `adminNotes` so an admin
/// can attach context like "Verified manually after customer email" without
/// needing a separate endpoint.
#[derive(Debug, Clone, Deserialize, Validate, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct VerifySlipRequest {
    #[validate(length(max = 2000, message = "Notes must be 2000 characters or fewer"))]
    pub admin_notes: Option<String>,
}

/// Notes are required for the "needs action" path — the whole point is to
/// tell the user *what* to fix. An empty notes field would be useless to
/// the customer.
#[derive(Debug, Clone, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct NeedsActionRequest {
    /// The reason the slip needs the user's attention. Must be 1–2000 chars.
    #[validate(length(
        min = 1,
        max = 2000,
        message = "Notes must be between 1 and 2000 characters"
    ))]
    pub notes: String,
}

/// Response for both mutations — returns the updated slip row so the
/// frontend can update its local state without an extra round-trip.
/// Field names mirror the `BookingSlip` interface in `SlipViewerSidebar.tsx`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSlipResponse {
    pub id: Uuid,
    pub booking_id: Uuid,
    /// Path to the image, or **null** once the image has been erased under
    /// the F2 retention policy — read it together with `deletedAt`. The
    /// column lost its `NOT NULL` in
    /// `20260912020000_slip_retention_access_log.sql` precisely so an erased
    /// slip has no path that still looks like a path.
    pub slip_url: Option<String>,
    /// When the image was erased, or null while it is still on disk. The
    /// metadata row itself is never deleted: the amount, the bank reference
    /// and the decision are payment evidence.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Why it was erased — `retention_sweep` today.
    pub deletion_reason: Option<String>,
    pub uploaded_at: DateTime<Utc>,
    /// One of: `pending`, `verified`, `needs_action`.
    pub admin_status: String,
    pub admin_verified_at: Option<DateTime<Utc>>,
    pub admin_verified_by: Option<Uuid>,
    pub admin_notes: Option<String>,
    /// The current SlipOK auto-verification state, pulled along so the
    /// frontend can re-render the badge without a refetch. One of the locked
    /// vocabulary values: `pending`, `verified`, `shadow_pass`, `manual`,
    /// `unavailable`.
    pub slipok_status: Option<String>,
    /// Why the machine landed on that status — one of the locked
    /// `slipok_reason` keys (`amount_mismatch`, `receiver_mismatch`,
    /// `duplicate`, `slip_invalid`, `booking_not_payable`, `confirm_failed`,
    /// `quota_exceeded`, `api_error`, `not_configured`, `timeout`), or null
    /// when the check passed.
    ///
    /// In shadow mode nothing else on this response distinguishes one
    /// machine decision from another: `admin_status` stays `pending` and
    /// `autoVerified` is false for every row, so this field and the two
    /// below are the whole decision record the drill and the agreement
    /// report read back.
    pub slipok_reason: Option<String>,
    /// The bank reference SlipOK returned, stored only when every check
    /// passed. The forensic anchor for an automatic decision.
    pub slipok_trans_ref: Option<String>,
    /// When the machine last decided about this slip.
    pub slipok_checked_at: Option<DateTime<Utc>>,
    /// Legacy, always null: nothing in the backend writes
    /// `booking_slips.slipok_verified_at` — the automatic path records its
    /// timestamp in `slipok_checked_at`. Kept on the response only until
    /// A6's sidebar stops reading it; drop it then, along with the column.
    pub slipok_verified_at: Option<DateTime<Utc>>,
    /// True when `admin_verified_by` is the SlipOK system actor — the slip
    /// was decided by the machine and no human has touched it since.
    ///
    /// This is what the human-touch KPI counts and what tells reception
    /// whether the desk still owes this slip a look. Both mutations in this
    /// file re-stamp `admin_verified_by` with the acting admin, so their
    /// responses report `false` by construction; the value is `true` on the
    /// read surfaces that render a slip the machine verified.
    pub auto_verified: bool,
    /// True when this call moved the booking the slip pays for to
    /// `confirmed`.
    ///
    /// `false` is not an error and usually means "there was nothing to move"
    /// — the booking was already `confirmed` (this endpoint deliberately
    /// allows a re-verify), or cancelled, or the PMS owns it and answered
    /// the payment event. It is `booking_not_confirmed_reason` that says a
    /// confirmation was *refused*.
    pub booking_confirmed: bool,
    /// Set only when a verified slip was refused the booking it pays for —
    /// today only `booking_not_payable`, from the automatic path meeting a
    /// hold that lapsed during the SlipOK round-trip.
    ///
    /// It exists because without it nothing on this response distinguishes
    /// "verified and confirmed" from "verified and the booking did not
    /// move", while the guest page, the deposit-link admin list and the desk
    /// mail all read `confirmed` off a verified slip. One of the locked
    /// `slipok_reason` keys, so the UI can render it with the wording it
    /// already has for the badge.
    ///
    /// **Follow-up owed to B2 (reception deposit-link panel).** The backend
    /// half is done; the admin UI is not, and this is the exact work, so it
    /// does not have to be rediscovered:
    ///
    /// 1. `SlipViewerSidebar.tsx` renders audit rows through
    ///    `actionMap[action] ?? action`, and `booking_not_confirmed` has no
    ///    entry — a Thai-first desk currently reads the raw English
    ///    identifier. Add
    ///    `admin.booking.bookingManagement.auditActions.bookingNotConfirmed`
    ///    to both locales — th: `ยังไม่ได้ยืนยันการจอง`, en: `Booking not
    ///    confirmed` — and map `booking_not_confirmed` to it.
    /// 2. Badge the verify result itself when this field is non-null. The
    ///    wording already exists in both locales: render
    ///    `payment.slipok.reason.${bookingNotConfirmedReason}` (for today's
    ///    only value that is `payment.slipok.reason.booking_not_payable`),
    ///    so no new reason strings are needed.
    ///
    /// Until then the desk's only signal is the audit row and the backend
    /// WARN — which is why the desk mail is suppressed in the handler rather
    /// than left to contradict the UI.
    pub booking_not_confirmed_reason: Option<String>,
}

/// Query for `GET /api/admin/bookings/slips/:slip_id/access-log`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLogQuery {
    #[serde(default = "default_access_log_page")]
    pub page: i64,
    #[serde(default = "default_access_log_limit")]
    pub limit: i64,
}

fn default_access_log_page() -> i64 {
    1
}
fn default_access_log_limit() -> i64 {
    50
}

/// One recorded read of a slip.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlipAccessEntry {
    pub id: Uuid,
    /// The slip that was read. `null` only when that `booking_slips` row was
    /// later hard-deleted — the FK is `ON DELETE SET NULL`, so the record of
    /// the read outlives its subject instead of vanishing with it.
    pub slip_id: Option<Uuid>,
    /// Who read it. Never null — an access nobody can be named for is not
    /// something this table is allowed to hold.
    pub admin_id: Uuid,
    /// Profile name, falling back to the email, built the same way
    /// `admin_bookings::fetch_audit_history` builds its `adminName`.
    pub admin_name: String,
    /// The surface that served it, as a stable machine key — e.g.
    /// `GET /api/storage/slips/:filename`. Never the literal request line,
    /// which would carry the slip UUID a second time.
    pub route: String,
    pub accessed_at: DateTime<Utc>,
    /// Correlates with the request's log lines. Null when the caller sent no
    /// `x-request-id` and no layer generated one.
    pub request_id: Option<String>,
}

/// Paged access log for one slip.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlipAccessLogResponse {
    pub entries: Vec<SlipAccessEntry>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
}

// ============================================================================
// Helpers
// ============================================================================

/// Read the `slipok_*` decision columns and the F2 retention tombstone —
/// the columns the mutations' `RETURNING` clauses do not carry.
///
/// The two mutation queries are compile-time `query!` macros whose text is
/// pinned by the offline cache in `.sqlx/`; widening their `RETURNING` lists
/// would force a `cargo sqlx prepare` run for three columns the mutation
/// does not write. A runtime query needs no cache entry, and one extra
/// indexed read per admin click is not worth the coupling.
async fn fetch_slip_extras(db: &sqlx::PgPool, slip_id: Uuid) -> AppResult<SlipExtras> {
    type Row = (
        Option<String>,
        Option<String>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<String>,
    );

    let row: Option<Row> = sqlx::query_as(
        "SELECT slipok_reason, slipok_trans_ref, slipok_checked_at, deleted_at, deletion_reason \
         FROM booking_slips WHERE id = $1",
    )
    .bind(slip_id)
    .fetch_optional(db)
    .await?;

    let (slipok_reason, slipok_trans_ref, slipok_checked_at, deleted_at, deletion_reason) =
        row.unwrap_or((None, None, None, None, None));

    Ok(SlipExtras {
        slipok_reason,
        slipok_trans_ref,
        slipok_checked_at,
        deleted_at,
        deletion_reason,
    })
}

/// The columns [`fetch_slip_extras`] carries back.
#[derive(Debug, Default)]
struct SlipExtras {
    slipok_reason: Option<String>,
    slipok_trans_ref: Option<String>,
    slipok_checked_at: Option<DateTime<Utc>>,
    deleted_at: Option<DateTime<Utc>>,
    deletion_reason: Option<String>,
}

/// Parse the admin's user id from the JWT, returning a typed error on
/// malformed claims rather than panicking with `unwrap`. We need a real
/// `Uuid` (not the string form) to write the FK on `booking_slips`.
fn admin_user_id(user: &AuthUser) -> AppResult<Uuid> {
    Uuid::parse_str(&user.id)
        .map_err(|_| AppError::BadRequest("Authenticated user id is not a valid UUID".to_string()))
}

// ============================================================================
// Handlers
// ============================================================================

/// `POST /api/admin/bookings/slips/:slip_id/verify`
///
/// Marks the slip as admin-verified. Idempotent: re-verifying an
/// already-verified slip updates the timestamp and admin_verified_by to
/// reflect the most recent reviewer (matches operator intuition — "I
/// re-checked this just now").
///
/// The slip update and the matching `booking_audit_log` row are written
/// inside one `sqlx::Transaction` so the audit trail can't drift from
/// the slip state — same shape as `routes/admin_bookings.rs`. See
/// `docs/audits/correctness-2026-05-13.md` (MED #3) for the audit
/// write-up.
///
/// Returns 200 with the updated slip row; 404 if the slip doesn't exist;
/// **409 when the booking could not take the payment** (A15).
///
/// That last one is the case B8 called race 2.4. For a PMS-channel booking
/// the room belongs to the PMS, and a hold it has already released cannot be
/// confirmed by anybody — so a Verify against one answers `Conflict` carrying
/// `booking_not_payable`, leaves the booking untouched, and puts the slip
/// back in this queue as `needs_action`. Reception's next step is to re-book
/// the room at the desk, not to press the button again; a **503** (the PMS
/// could not be reached) is the one that means "try again".
///
/// A lapsed *deposit link* is the opposite case and still answers 200: that
/// hold is paperwork, not a room, and finishing it by hand is what the
/// manual queue exists for. See `services::slip_confirm` for why the two
/// diverge.
async fn verify_slip(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(slip_id): Path<Uuid>,
    headers: HeaderMap,
    payload: Option<Json<VerifySlipRequest>>,
) -> AppResult<Json<AdminSlipResponse>> {
    require_admin(&user)?;
    let admin_id = admin_user_id(&user)?;

    let body = payload.map(|Json(p)| p).unwrap_or_default();
    body.validate().map_err(AppError::from)?;

    // `confirm_slip_with_notes` needs the booking the slip pays for, and a
    // missing slip must still 404 before anything is written. Runtime query
    // (not the `query!` macro) so this lookup needs no `.sqlx` cache entry.
    let booking_id: Uuid = sqlx::query_scalar("SELECT booking_id FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    let outcome = crate::services::slip_confirm::confirm_slip_with_notes(
        &state,
        slip_id,
        booking_id,
        Some(admin_id),
        body.admin_notes.clone(),
    )
    .await?;

    let extras = fetch_slip_extras(state.db(), slip_id).await?;

    // F2: the response carries the slip's URL, so the read is logged.
    slip_access_log::record_best_effort(
        state.db(),
        &[slip_id],
        admin_id,
        slip_access_log::ROUTE_ADMIN_SLIP_VERIFY,
        slip_access_log::request_id(&headers).as_deref(),
    )
    .await;

    // Tell the property's desk the deposit landed (B0). Fire-and-forget, and
    // deduped on the slip: re-verifying an already-verified slip (which this
    // handler deliberately allows) sends no second email.
    //
    // Held back when the confirmation was *refused*: that mail says
    // "ยืนยันแล้ว / Confirmed (เจ้าหน้าที่ยืนยันแล้ว / confirmed by staff)",
    // which would be a false statement about a booking still sitting on
    // `pending`. The gate is the refusal, not `booking_confirmed`: a second
    // slip verified against an already-confirmed booking confirms nothing
    // and still deserves its mail.
    if let Some(reason) = outcome.booking_not_confirmed_reason {
        tracing::warn!(
            slip_id = %slip_id,
            booking_id = %outcome.booking_id,
            reason = %reason,
            "slip verified but the booking was not confirmed; the desk \
             confirmation mail is suppressed"
        );
    } else {
        crate::services::booking_notify::notify(
            &state,
            outcome.booking_id,
            crate::services::booking_notify::BookingNotifyEvent::DepositVerified { slip_id },
        )
        .await;
    }

    Ok(Json(AdminSlipResponse {
        id: outcome.id,
        booking_id: outcome.booking_id,
        slip_url: outcome.slip_url,
        deleted_at: extras.deleted_at,
        deletion_reason: extras.deletion_reason,
        // `uploaded_at` is nullable in the schema (DEFAULT CURRENT_TIMESTAMP),
        // so we collapse a NULL to "now" — should never actually be null
        // for a row that's been inserted through the normal path.
        uploaded_at: outcome.uploaded_at.unwrap_or_else(Utc::now),
        admin_status: outcome
            .admin_status
            .unwrap_or_else(|| "verified".to_string()),
        admin_verified_at: outcome.admin_verified_at,
        admin_verified_by: outcome.admin_verified_by,
        admin_notes: outcome.admin_notes,
        slipok_status: outcome.slipok_status,
        slipok_reason: extras.slipok_reason,
        slipok_trans_ref: extras.slipok_trans_ref,
        slipok_checked_at: extras.slipok_checked_at,
        slipok_verified_at: outcome.slipok_verified_at,
        auto_verified: crate::services::slip_confirm::is_slipok_actor(outcome.admin_verified_by),
        booking_confirmed: outcome.booking_confirmed,
        booking_not_confirmed_reason: outcome.booking_not_confirmed_reason.map(str::to_string),
    }))
}

/// `POST /api/admin/bookings/slips/:slip_id/needs-action`
///
/// Marks the slip as needing user attention. Notes are required — the
/// whole purpose is to tell the user what's wrong.
///
/// We *also* stamp `admin_verified_by`/`admin_verified_at` here even
/// though the slip isn't "verified" in the positive sense. Rationale:
/// those columns serve double duty as an audit trail of "which admin
/// last touched this slip"; treating them as verify-only loses the
/// who/when for rejections. The `admin_status` field already
/// disambiguates the *kind* of action.
///
/// As with `verify_slip`, the slip update and the corresponding
/// `booking_audit_log` row are written inside one `sqlx::Transaction`.
async fn mark_slip_needs_action(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(slip_id): Path<Uuid>,
    headers: HeaderMap,
    Json(payload): Json<NeedsActionRequest>,
) -> AppResult<Json<AdminSlipResponse>> {
    require_admin(&user)?;
    let admin_id = admin_user_id(&user)?;

    payload.validate().map_err(AppError::from)?;

    let mut tx = state.db().begin().await?;

    let before = sqlx::query!(
        r#"
        SELECT admin_status, admin_verified_at, admin_verified_by, admin_notes
        FROM booking_slips
        WHERE id = $1
        FOR UPDATE
        "#,
        slip_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    let row = sqlx::query!(
        r#"
        UPDATE booking_slips
        SET admin_status      = 'needs_action',
            admin_verified_at = NOW(),
            admin_verified_by = $1,
            admin_notes       = $2
        WHERE id = $3
        RETURNING
            id,
            booking_id,
            slip_url,
            uploaded_at,
            admin_status,
            admin_verified_at,
            admin_verified_by,
            admin_notes,
            slipok_status,
            slipok_verified_at
        "#,
        admin_id,
        payload.notes,
        slip_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    let before_json = json!({
        "adminStatus": before.admin_status,
        "adminVerifiedBy": before.admin_verified_by,
        "adminVerifiedAt": before.admin_verified_at,
        "adminNotes": before.admin_notes,
    });
    let after_json = json!({
        "adminStatus": row.admin_status,
        "adminVerifiedBy": row.admin_verified_by,
        "adminVerifiedAt": row.admin_verified_at,
        "adminNotes": row.admin_notes,
        "slipId": row.id,
    });

    crate::services::slip_confirm::insert_slip_audit_row(
        &mut *tx,
        row.booking_id,
        admin_id,
        "slip_needs_action",
        Some(before_json),
        Some(after_json),
        Some(payload.notes.clone()),
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        slip_id = %slip_id,
        booking_id = %row.booking_id,
        admin_id = %admin_id,
        "Admin marked slip as needs_action"
    );

    let extras = fetch_slip_extras(state.db(), slip_id).await?;

    // F2: the response carries the slip's URL, so the read is logged.
    slip_access_log::record_best_effort(
        state.db(),
        &[slip_id],
        admin_id,
        slip_access_log::ROUTE_ADMIN_SLIP_NEEDS_ACTION,
        slip_access_log::request_id(&headers).as_deref(),
    )
    .await;

    Ok(Json(AdminSlipResponse {
        id: row.id,
        booking_id: row.booking_id,
        slip_url: row.slip_url,
        deleted_at: extras.deleted_at,
        deletion_reason: extras.deletion_reason,
        uploaded_at: row.uploaded_at.unwrap_or_else(Utc::now),
        admin_status: row
            .admin_status
            .unwrap_or_else(|| "needs_action".to_string()),
        admin_verified_at: row.admin_verified_at,
        admin_verified_by: row.admin_verified_by,
        admin_notes: row.admin_notes,
        slipok_status: row.slipok_status,
        slipok_reason: extras.slipok_reason,
        slipok_trans_ref: extras.slipok_trans_ref,
        slipok_checked_at: extras.slipok_checked_at,
        slipok_verified_at: row.slipok_verified_at,
        auto_verified: crate::services::slip_confirm::is_slipok_actor(row.admin_verified_by),
        // needs-action never confirms anything and never refuses a
        // confirmation: it hands the slip back to the guest.
        booking_confirmed: false,
        booking_not_confirmed_reason: None,
    }))
}

/// `GET /api/admin/bookings/slips/:slip_id`
///
/// Read one slip as the two mutations return it. Added with `autoVerified`:
/// both mutations re-stamp `admin_verified_by` with the acting admin, so
/// their responses can only ever report `false`, and without a read endpoint
/// the field would be unobservable through the API — the only way to see
/// that the machine verified a slip would be to open a psql session, which
/// hard rule 5 in `CLAUDE.md` forbids ("never touch the database directly").
/// The auto-verify drill and the shadow-window agreement report both need
/// to read decisions back; this is the route they use.
///
/// Which is why the response carries `slipokReason`, `slipokTransRef` and
/// `slipokCheckedAt` as well. In shadow mode — production today — nothing
/// else on it varies: `adminStatus` stays `pending` and `autoVerified` is
/// false for every row, so without the reason the route could not tell an
/// `amount_mismatch` from a `receiver_mismatch` from a `duplicate`, which is
/// exactly the histogram the agreement report is specified to produce.
///
/// Returns 200 with the slip row; 404 if the slip doesn't exist.
///
/// Runtime query rather than the `query!` macro, like the lookup in
/// `verify_slip`: the `slipok_*` columns are new in migration
/// `20260910000000_booking_slips_slipok.sql` and a runtime query needs no
/// `.sqlx` offline-cache entry.
async fn get_slip(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(slip_id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<AdminSlipResponse>> {
    require_admin(&user)?;
    let admin_id = admin_user_id(&user)?;

    use sqlx::Row;

    let row = sqlx::query(
        r#"
        SELECT id, booking_id, slip_url, uploaded_at, admin_status,
               admin_verified_at, admin_verified_by, admin_notes,
               slipok_status, slipok_reason, slipok_trans_ref,
               slipok_checked_at, slipok_verified_at,
               deleted_at, deletion_reason
        FROM booking_slips
        WHERE id = $1
        "#,
    )
    .bind(slip_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Slip".to_string()))?;

    let admin_verified_by: Option<Uuid> = row.try_get("admin_verified_by")?;
    let uploaded_at: Option<DateTime<Utc>> = row.try_get("uploaded_at")?;
    let admin_status: Option<String> = row.try_get("admin_status")?;

    // F2: this response carries the slip's image URL, so reading it is a
    // read of the slip. `slipUrl` is `null` and `deletedAt` is set once the
    // image has been erased — a deleted slip answers 200 with a state the
    // sidebar can render, never a decode failure dressed up as a 500.
    slip_access_log::record_best_effort(
        state.db(),
        &[slip_id],
        admin_id,
        slip_access_log::ROUTE_ADMIN_SLIP_DETAIL,
        slip_access_log::request_id(&headers).as_deref(),
    )
    .await;

    Ok(Json(AdminSlipResponse {
        id: row.try_get("id")?,
        booking_id: row.try_get("booking_id")?,
        slip_url: row.try_get("slip_url")?,
        deleted_at: row.try_get("deleted_at")?,
        deletion_reason: row.try_get("deletion_reason")?,
        uploaded_at: uploaded_at.unwrap_or_else(Utc::now),
        admin_status: admin_status.unwrap_or_else(|| "pending".to_string()),
        admin_verified_at: row.try_get("admin_verified_at")?,
        admin_verified_by,
        admin_notes: row.try_get("admin_notes")?,
        slipok_status: row.try_get("slipok_status")?,
        slipok_reason: row.try_get("slipok_reason")?,
        slipok_trans_ref: row.try_get("slipok_trans_ref")?,
        slipok_checked_at: row.try_get("slipok_checked_at")?,
        slipok_verified_at: row.try_get("slipok_verified_at")?,
        auto_verified: crate::services::slip_confirm::is_slipok_actor(admin_verified_by),
        // A read decides nothing. Both fields describe what a *call* did to
        // the booking, so on this endpoint they are always the empty answer;
        // a reader who wants the booking's state reads the booking.
        booking_confirmed: false,
        booking_not_confirmed_reason: None,
    }))
}

/// `GET /api/admin/bookings/slips/:slip_id/access-log`
///
/// Who has read this slip, newest first, paged. The answer to the question
/// `docs/privacy/2026-09-pdpa-data-map.md` §7 says we could not answer:
/// *"today we cannot answer 'who looked at this guest's payer's bank
/// details'."*
///
/// 404 when the slip id is unknown — including a slip whose *image* has been
/// erased is **not** a 404: the metadata row outlives the picture, and the
/// history of who saw it while it existed is exactly what a rights request
/// or a breach report needs.
///
/// Reading this log is not itself a slip read: it returns no image and no
/// image URL, so it writes no row of its own and cannot start a feedback
/// loop with itself.
async fn get_slip_access_log(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(slip_id): Path<Uuid>,
    Query(query): Query<AccessLogQuery>,
) -> AppResult<Json<SlipAccessLogResponse>> {
    require_admin(&user)?;

    let page = query.page.max(1);
    let limit = query.limit.clamp(1, 200);
    let offset = (page - 1) * limit;

    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_optional(state.db())
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Slip".to_string()));
    }

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM slip_access_log WHERE slip_id = $1")
        .bind(slip_id)
        .fetch_one(state.db())
        .await?;

    // Runtime query rather than the `query!` macro, like every other read in
    // this file: `slip_access_log` is new in migration
    // `20260912020000_slip_retention_access_log.sql`.
    use sqlx::Row;
    let rows = sqlx::query(
        r#"
        SELECT sal.id,
               sal.slip_id,
               sal.admin_id,
               COALESCE(
                   NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''),
                   u.email,
                   sal.admin_id::text
               ) AS admin_name,
               sal.route,
               sal.accessed_at,
               sal.request_id
        FROM slip_access_log sal
        LEFT JOIN users u          ON u.id = sal.admin_id
        LEFT JOIN user_profiles up ON up.user_id = sal.admin_id
        WHERE sal.slip_id = $1
        ORDER BY sal.accessed_at DESC, sal.id DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(slip_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let entries = rows
        .into_iter()
        .map(|row| {
            Ok(SlipAccessEntry {
                id: row.try_get("id")?,
                slip_id: row.try_get("slip_id")?,
                admin_id: row.try_get("admin_id")?,
                admin_name: row.try_get("admin_name")?,
                route: row.try_get("route")?,
                accessed_at: row.try_get("accessed_at")?,
                request_id: row.try_get("request_id")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(Json(SlipAccessLogResponse {
        entries,
        total,
        page,
        limit,
    }))
}

// ============================================================================
// Router
// ============================================================================

/// Build the admin slip-moderation sub-router.
///
/// Merged into the parent admin router so the shared `auth_middleware`
/// layer covers these routes too. Mount path: `/api/admin/...`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/bookings/slips/:slip_id", get(get_slip))
        .route(
            "/bookings/slips/:slip_id/access-log",
            get(get_slip_access_log),
        )
        .route("/bookings/slips/:slip_id/verify", post(verify_slip))
        .route(
            "/bookings/slips/:slip_id/needs-action",
            post(mark_slip_needs_action),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_slip_request_accepts_empty_body() {
        let empty = VerifySlipRequest::default();
        assert!(empty.validate().is_ok());
    }

    #[test]
    fn verify_slip_request_rejects_excessively_long_notes() {
        let too_long = VerifySlipRequest {
            admin_notes: Some("x".repeat(2001)),
        };
        assert!(too_long.validate().is_err());
    }

    #[test]
    fn needs_action_request_requires_notes() {
        let empty = NeedsActionRequest {
            notes: String::new(),
        };
        assert!(empty.validate().is_err());

        let valid = NeedsActionRequest {
            notes: "Please re-upload a clearer photo of the slip.".to_string(),
        };
        assert!(valid.validate().is_ok());
    }

    /// Build a response the way both handlers do, for a slip last touched
    /// by `admin_verified_by`.
    fn response_verified_by(admin_verified_by: Option<Uuid>) -> AdminSlipResponse {
        AdminSlipResponse {
            id: Uuid::new_v4(),
            booking_id: Uuid::new_v4(),
            slip_url: Some("/storage/slips/x.jpg".to_string()),
            deleted_at: None,
            deletion_reason: None,
            uploaded_at: Utc::now(),
            admin_status: "verified".to_string(),
            admin_verified_at: Some(Utc::now()),
            admin_verified_by,
            admin_notes: None,
            slipok_status: Some("verified".to_string()),
            slipok_reason: None,
            slipok_trans_ref: Some("TESTREF0001".to_string()),
            slipok_checked_at: Some(Utc::now()),
            slipok_verified_at: None,
            auto_verified: crate::services::slip_confirm::is_slipok_actor(admin_verified_by),
            booking_confirmed: true,
            booking_not_confirmed_reason: None,
        }
    }

    #[test]
    fn admin_slip_response_serialises_camel_case() {
        let resp = response_verified_by(Some(Uuid::new_v4()));
        let json = serde_json::to_string(&resp).expect("serialise AdminSlipResponse");
        assert!(json.contains("\"bookingId\""));
        assert!(json.contains("\"slipUrl\""));
        assert!(json.contains("\"adminStatus\":\"verified\""));
        assert!(json.contains("\"slipokStatus\""));
        // The locked camelCase names the drill and the agreement report read.
        assert!(json.contains("\"slipokReason\""));
        assert!(json.contains("\"slipokTransRef\":\"TESTREF0001\""));
        assert!(json.contains("\"slipokCheckedAt\""));
        // A6's sidebar reads these to tell "verified and confirmed" apart
        // from "verified and the booking did not move".
        assert!(json.contains("\"bookingConfirmed\":true"));
        assert!(json.contains("\"bookingNotConfirmedReason\":null"));
        assert!(json.contains("\"autoVerified\""));
    }

    /// `autoVerified` is the field reception's sidebar reads to tell a
    /// machine decision from a colleague's. It must be true for exactly the
    /// system actor and false for every human admin.
    #[test]
    fn auto_verified_is_true_only_for_the_slipok_system_actor() {
        let machine =
            response_verified_by(Some(crate::services::slip_confirm::SLIPOK_SYSTEM_USER_ID));
        assert!(machine.auto_verified);
        let json = serde_json::to_string(&machine).expect("serialise AdminSlipResponse");
        assert!(json.contains("\"autoVerified\":true"));

        let human = response_verified_by(Some(Uuid::new_v4()));
        assert!(!human.auto_verified);
        let json = serde_json::to_string(&human).expect("serialise AdminSlipResponse");
        assert!(json.contains("\"autoVerified\":false"));

        assert!(!response_verified_by(None).auto_verified);
    }
}
