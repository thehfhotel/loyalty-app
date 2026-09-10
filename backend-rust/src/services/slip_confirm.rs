//! Slip confirmation — the one path that turns a slip into a paid booking
//!
//! Extracted verbatim out of `routes::admin_slips::verify_slip` so the human
//! path and the automatic path (`routes::bookings::run_slipok_check`) cannot
//! drift apart: a machine verify and an admin verify must leave the same
//! `admin_status`, the same PMS call and the same booking status behind.
//!
//! The only difference is the actor:
//!
//! * `Some(admin_id)` — an admin pressed Verify. Behaves exactly as before
//!   the extraction, including the `booking_audit_log` row.
//! * `None` — the automatic check confirmed it. `booking_audit_log.admin_id`
//!   is `UUID NOT NULL` with an FK to `users`, and there is no system user
//!   row to point it at, so the audit insert is skipped and the confirmation
//!   is recorded as a `tracing::info!` carrying the slip, the booking and
//!   the bank reference instead.
//!
//! ## sqlx note
//!
//! The compile-time queries here were **moved**, not rewritten: the offline
//! cache in `.sqlx/` is keyed on the query text, so keeping the text
//! byte-identical means the extraction needs no `cargo sqlx prepare` run.

use chrono::{DateTime, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// The slip row after confirmation, plus what confirmation did to the
/// booking. Carries exactly the columns `AdminSlipResponse` needs so the
/// admin handler still answers without a second read.
#[derive(Debug, Clone)]
pub struct ConfirmOutcome {
    pub id: Uuid,
    pub booking_id: Uuid,
    pub slip_url: String,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub admin_status: Option<String>,
    pub admin_verified_at: Option<DateTime<Utc>>,
    pub admin_verified_by: Option<Uuid>,
    pub admin_notes: Option<String>,
    pub slipok_status: Option<String>,
    pub slipok_verified_at: Option<DateTime<Utc>>,
    /// True when this call flipped a PMS channel booking to `confirmed`.
    pub booking_confirmed: bool,
}

/// Mark a slip verified and confirm the booking it pays for.
///
/// `actor` is the admin who pressed Verify, or `None` when the automatic
/// SlipOK check confirmed the slip. See the module docs for the single
/// behavioural difference between the two.
///
/// Errors leave the slip untouched: the slip update and the audit row are
/// one transaction, and the PMS call runs after the commit exactly as it did
/// inline in `admin_slips.rs` (a PMS failure surfaces so the action is
/// retried, rather than leaving money received against an expiring hold).
pub async fn confirm_slip(
    state: &AppState,
    slip_id: Uuid,
    booking_id: Uuid,
    actor: Option<Uuid>,
) -> Result<ConfirmOutcome, AppError> {
    confirm_slip_with_notes(state, slip_id, booking_id, actor, None).await
}

/// [`confirm_slip`] with the admin's optional notes.
///
/// Only the admin handler passes notes; they land on `admin_notes` and in
/// the audit row's `reason`, which is why the notes-free [`confirm_slip`]
/// above is the entry point for the automatic path.
pub async fn confirm_slip_with_notes(
    state: &AppState,
    slip_id: Uuid,
    booking_id: Uuid,
    actor: Option<Uuid>,
    admin_notes: Option<String>,
) -> Result<ConfirmOutcome, AppError> {
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
        actor,
        admin_notes,
        slip_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    match actor {
        Some(admin_id) => {
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
                admin_notes.clone(),
            )
            .await?;

            tx.commit().await?;

            tracing::info!(
                slip_id = %slip_id,
                booking_id = %row.booking_id,
                admin_id = %admin_id,
                "Admin verified slip"
            );
        },
        None => {
            // No audit row: `booking_audit_log.admin_id` is NOT NULL with an
            // FK to `users`, and an automatic verify has no user. The bank
            // reference stored by the SlipOK check is the forensic anchor, so
            // it goes in the log line. Runtime query (not the macro) so the
            // new `slipok_trans_ref` column needs no `.sqlx` cache entry.
            let trans_ref: Option<String> =
                sqlx::query_scalar("SELECT slipok_trans_ref FROM booking_slips WHERE id = $1")
                    .bind(slip_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .flatten();

            tx.commit().await?;

            tracing::info!(
                slip_id = %slip_id,
                booking_id = %row.booking_id,
                trans_ref = trans_ref.as_deref().unwrap_or("unknown"),
                "SlipOK auto-verified slip"
            );
        },
    }

    // PMS booking channel (ADR-0003): a verified slip IS the payment event
    // for a channel booking. Confirm the PMS booking first — if the PMS is
    // unreachable this returns an error so the admin retries the verify
    // action (idempotent on both sides) rather than leaving money received
    // against a hold that would silently expire.
    let channel_row = sqlx::query!(
        r#"
        SELECT pms_booking_id AS "pms_booking_id!",
               COALESCE(amount_due_now, total_price) AS "amount_received!"
        FROM bookings WHERE id = $1 AND pms_booking_id IS NOT NULL
        "#,
        row.booking_id
    )
    .fetch_optional(state.db())
    .await?;

    let mut booking_confirmed = false;
    if let Some(channel) = channel_row {
        let pms_booking_id = channel.pms_booking_id;
        let pms = crate::services::pms_channel::PmsChannelClient::from_settings(state.config())?;
        // The PMS needs the received amount — it doesn't persist the
        // guest's deposit50/full choice.
        pms.payment_verified(&pms_booking_id, channel.amount_received)
            .await?;
        sqlx::query!(
            r#"UPDATE bookings SET status = 'confirmed', updated_at = NOW()
               WHERE id = $1 AND status = 'pending'"#,
            row.booking_id
        )
        .execute(state.db())
        .await?;
        booking_confirmed = true;
        tracing::info!(
            booking_id = %row.booking_id,
            pms_booking_id = %pms_booking_id,
            "channel booking confirmed after slip verification"
        );
    }

    debug_assert_eq!(
        row.booking_id, booking_id,
        "caller passed a booking id that does not own this slip"
    );

    Ok(ConfirmOutcome {
        id: row.id,
        booking_id: row.booking_id,
        slip_url: row.slip_url,
        uploaded_at: row.uploaded_at,
        admin_status: row.admin_status,
        admin_verified_at: row.admin_verified_at,
        admin_verified_by: row.admin_verified_by,
        admin_notes: row.admin_notes,
        slipok_status: row.slipok_status,
        slipok_verified_at: row.slipok_verified_at,
        booking_confirmed,
    })
}

/// Insert a single `booking_audit_log` row from inside the caller's
/// transaction. Mirrors `routes::admin_bookings::insert_audit_row`
/// (kept local rather than `pub`-ing the original to avoid coupling
/// admin_slips to admin_bookings's internals — both files are part of
/// the admin surface and share the audit-row contract by convention,
/// not by import).
pub(crate) async fn insert_slip_audit_row<'c, E>(
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
