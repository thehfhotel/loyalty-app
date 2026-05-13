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
//! - `POST /api/admin/bookings/slips/:slip_id/verify`       — admin verify
//! - `POST /api/admin/bookings/slips/:slip_id/needs-action` — admin reject
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
//! Each slip mutation should ideally produce an entry in `booking_audit_log`
//! so the slip viewer's audit-history panel can show "Admin X verified slip Y
//! at Z". That table doesn't exist in the canonical schema yet (tracked in
//! `docs/admin-backend-gaps.md` under the booking-management cluster). When
//! it lands, extend this file to also `INSERT INTO booking_audit_log (...)`.
//! For now the slip row itself is the audit trail: `admin_verified_by`,
//! `admin_verified_at`, `admin_notes` capture the who/when/why.
//!
//! ## sqlx note
//!
//! Uses compile-time `sqlx::query!`/`query_as!` macros, validated against
//! the offline cache in `backend-rust/.sqlx/`. Regenerate with
//! `backend-rust/scripts/regen-sqlx-cache.sh` after any query change.

use axum::{
    extract::{Extension, Path, State},
    routing::post,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{has_role, AuthUser};
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
    pub slip_url: String,
    pub uploaded_at: DateTime<Utc>,
    /// One of: `pending`, `verified`, `needs_action`.
    pub admin_status: String,
    pub admin_verified_at: Option<DateTime<Utc>>,
    pub admin_verified_by: Option<Uuid>,
    pub admin_notes: Option<String>,
    /// The current SlipOK auto-verification state, pulled along so the
    /// frontend can re-render the badge without a refetch.
    pub slipok_status: Option<String>,
    pub slipok_verified_at: Option<DateTime<Utc>>,
}

// ============================================================================
// Helpers
// ============================================================================

fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }
    Ok(())
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
/// Returns 200 with the updated slip row; 404 if the slip doesn't exist.
async fn verify_slip(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(slip_id): Path<Uuid>,
    payload: Option<Json<VerifySlipRequest>>,
) -> AppResult<Json<AdminSlipResponse>> {
    require_admin(&user)?;
    let admin_id = admin_user_id(&user)?;

    let body = payload.map(|Json(p)| p).unwrap_or_default();
    body.validate().map_err(AppError::from)?;

    let mut tx = state.db().begin().await?;

    // Capture the previous state *before* the UPDATE so the audit row
    // can describe what changed. `FOR UPDATE` serialises concurrent
    // admins racing to verify the same slip — under contention exactly
    // one admin "wins" the row and the other reads the post-write state
    // when it acquires the lock.
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
        SET admin_status      = 'verified',
            admin_verified_at = NOW(),
            admin_verified_by = $1,
            admin_notes       = COALESCE($2, admin_notes)
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
        body.admin_notes,
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

    insert_slip_audit_row(
        &mut *tx,
        row.booking_id,
        admin_id,
        "slip_verified",
        Some(before_json),
        Some(after_json),
        body.admin_notes.clone(),
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        slip_id = %slip_id,
        booking_id = %row.booking_id,
        admin_id = %admin_id,
        "Admin verified slip"
    );

    Ok(Json(AdminSlipResponse {
        id: row.id,
        booking_id: row.booking_id,
        slip_url: row.slip_url,
        // `uploaded_at` is nullable in the schema (DEFAULT CURRENT_TIMESTAMP),
        // so we collapse a NULL to "now" — should never actually be null
        // for a row that's been inserted through the normal path.
        uploaded_at: row.uploaded_at.unwrap_or_else(Utc::now),
        admin_status: row.admin_status.unwrap_or_else(|| "verified".to_string()),
        admin_verified_at: row.admin_verified_at,
        admin_verified_by: row.admin_verified_by,
        admin_notes: row.admin_notes,
        slipok_status: row.slipok_status,
        slipok_verified_at: row.slipok_verified_at,
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

    insert_slip_audit_row(
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

    Ok(Json(AdminSlipResponse {
        id: row.id,
        booking_id: row.booking_id,
        slip_url: row.slip_url,
        uploaded_at: row.uploaded_at.unwrap_or_else(Utc::now),
        admin_status: row
            .admin_status
            .unwrap_or_else(|| "needs_action".to_string()),
        admin_verified_at: row.admin_verified_at,
        admin_verified_by: row.admin_verified_by,
        admin_notes: row.admin_notes,
        slipok_status: row.slipok_status,
        slipok_verified_at: row.slipok_verified_at,
    }))
}

/// Insert a single `booking_audit_log` row from inside the caller's
/// transaction. Mirrors `routes::admin_bookings::insert_audit_row`
/// (kept local rather than `pub`-ing the original to avoid coupling
/// admin_slips to admin_bookings's internals — both files are part of
/// the admin surface and share the audit-row contract by convention,
/// not by import).
async fn insert_slip_audit_row<'c, E>(
    executor: E,
    booking_id: Uuid,
    admin_id: Uuid,
    action: &str,
    before_data: Option<serde_json::Value>,
    after_data: Option<serde_json::Value>,
    reason: Option<String>,
) -> AppResult<()>
where
    E: sqlx::Executor<'c, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO booking_audit_log
            (booking_id, admin_id, action, before_data, after_data, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        booking_id,
        admin_id,
        action,
        before_data,
        after_data,
        reason,
    )
    .execute(executor)
    .await?;
    Ok(())
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

    #[test]
    fn admin_slip_response_serialises_camel_case() {
        let resp = AdminSlipResponse {
            id: Uuid::new_v4(),
            booking_id: Uuid::new_v4(),
            slip_url: "/storage/slips/x.jpg".to_string(),
            uploaded_at: Utc::now(),
            admin_status: "verified".to_string(),
            admin_verified_at: Some(Utc::now()),
            admin_verified_by: Some(Uuid::new_v4()),
            admin_notes: None,
            slipok_status: Some("verified".to_string()),
            slipok_verified_at: None,
        };
        let json = serde_json::to_string(&resp).expect("serialise AdminSlipResponse");
        assert!(json.contains("\"bookingId\""));
        assert!(json.contains("\"slipUrl\""));
        assert!(json.contains("\"adminStatus\":\"verified\""));
        assert!(json.contains("\"slipokStatus\""));
    }
}
