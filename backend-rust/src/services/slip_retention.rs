//! Slip-image retention sweep (task F2).
//!
//! `docs/privacy/2026-09-pdpa-data-map.md` §1 records the state this
//! replaces: *"**Deletion today: None.** No job, no route, no `remove_file`
//! anywhere touches `STORAGE_PATH/slips` … Slips therefore live forever, and
//! a member who 'deletes their account' still has their payer's bank photo
//! on disk."*
//!
//! ## What the sweep does
//!
//! For a slip whose booking closed more than `SLIP_RETENTION_DAYS` ago:
//!
//! 1. erase `STORAGE_PATH/slips/<uuid>.<ext>` from disk, then
//! 2. tombstone the row — `slip_url = NULL`, `deleted_at = NOW()`,
//!    `deletion_reason = 'retention_sweep'`.
//!
//! In that order, always. The file is the thing that must go; the row is the
//! record that it went. Nulling the path first and then failing to unlink
//! would leave a photograph on the volume that nothing points at any more —
//! the one outcome worse than not having swept at all.
//!
//! The metadata row itself is **never** deleted. Amount, `slipok_trans_ref`
//! and the admin decision are payment evidence and the duplicate-detection
//! key; the data map keeps them for years after the picture stops being
//! useful, and a hard delete would put a hole in the audit trail.
//!
//! ## Off unless configured
//!
//! There is no default window. The 90 days in the data map is a **proposal**
//! the owner has not signed off, so `SLIP_RETENTION_DAYS` blank or unset
//! means this module does nothing at all — see [`crate::config::RetentionConfig`].
//!
//! ## What "closed" means here, and where that differs from the spec
//!
//! The task's wording is "checked out, cancelled, refunded or expired".
//! Against the actual schema:
//!
//! * *checked out* → `status IN ('checked_out', 'completed')`
//! * *cancelled* → `status = 'cancelled'`
//! * *expired* → also `status = 'cancelled'`: the payment-window sweep in
//!   [`crate::services::pms_channel::release_expired_holds`] cancels an
//!   expired hold rather than inventing an `expired` state.
//! * *no_show* → `status = 'no_show'`, closed by any reading of the word.
//! * *refunded* → **does not exist.** `chk_booking_status` allows exactly
//!   `pending | confirmed | checked_in | checked_out | completed | cancelled
//!   | no_show`, and there is no `payment_status` column anywhere in the
//!   schema. Nothing here can key on a refund until one exists.
//!
//! There is also no single "closed at" timestamp on `bookings`. Rather than
//! trust `updated_at` alone — nothing keeps it current by trigger — the
//! window is measured from the **latest** plausible closing moment, so the
//! sweep errs towards deleting late rather than early.
//!
//! ## What it will not touch
//!
//! * slips of bookings that are still open (`pending`, `confirmed`,
//!   `checked_in`),
//! * slips still waiting on a decision — `admin_status` `pending` or unset,
//!   or `slipok_status = 'manual'` — because that image is still the input
//!   to a decision somebody has to make,
//! * slips already tombstoned.

use std::path::{Path, PathBuf};

use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Settings;
use crate::services::storage::{delete_slip_file_in, slips_base_dir};

/// Reason written to `booking_slips.deletion_reason` by this sweep. A short
/// machine key, so a rights-request erase (F3) can be told apart from a
/// scheduled one by a `GROUP BY`.
pub const REASON_RETENTION_SWEEP: &str = "retention_sweep";

/// Rows examined per pass. The sweep runs on a timer, so a backlog drains
/// over several passes instead of holding one long transaction open.
const BATCH_LIMIT: i64 = 200;

/// Run one pass using the process's configured retention window and slips
/// directory. Called from the timer in `main.rs`.
///
/// Never returns an error and never panics: a sweep that could take the
/// process down on a bad night is worse than one that logs and retries.
/// Returns how many slip images were erased.
pub async fn sweep_expired_slips(db: &PgPool, settings: &Settings) -> u64 {
    let Some(days) = settings.retention.slip_retention_days() else {
        return 0;
    };
    sweep_expired_slips_in(db, days, &slips_base_dir()).await
}

/// [`sweep_expired_slips`] against an explicit window and slips directory.
///
/// The directory is a parameter because the production one comes from
/// `STORAGE_PATH`, which is process-global — a test needs its own `tempdir`
/// without mutating the environment for every other test sharing the
/// process.
pub async fn sweep_expired_slips_in(db: &PgPool, retention_days: u32, slips_dir: &Path) -> u64 {
    let candidates = match fetch_candidates(db, retention_days).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "slip retention sweep query failed");
            return 0;
        },
    };

    if candidates.is_empty() {
        return 0;
    }

    let mut erased = 0u64;
    for (slip_id, slip_url) in candidates {
        // Erase first. If this fails the row keeps its path and the next
        // pass tries again — a missing file is `Ok(false)`, not an error, so
        // a crash between the unlink and the tombstone still converges.
        match delete_slip_file_in(slips_dir, &slip_url).await {
            Ok(_) => {},
            Err(e) => {
                tracing::error!(
                    error = %e,
                    slip_id = %slip_id,
                    "could not erase a slip image; leaving the row untouched for the next sweep"
                );
                continue;
            },
        }

        match tombstone(db, slip_id).await {
            Ok(true) => erased += 1,
            // Another pass (or another instance) got there first.
            Ok(false) => {},
            Err(e) => tracing::error!(
                error = %e,
                slip_id = %slip_id,
                "erased a slip image but failed to write its tombstone; the next sweep will retry"
            ),
        }
    }

    if erased > 0 {
        tracing::info!(
            erased,
            retention_days,
            "erased slip images past the retention window"
        );
    }

    erased
}

/// Slips whose booking closed longer ago than the window and that still have
/// an image on disk.
///
/// `GREATEST(...)` is the closing moment: the *latest* of the stay's end,
/// the cancellation stamp and the row's last write. `bookings.updated_at`
/// has no trigger keeping it current and `cancelled_at` is only set on the
/// cancel path, so no single column is trustworthy on its own — taking the
/// maximum means a column that is stale or NULL can only ever delay an
/// erase, never bring one forward.
async fn fetch_candidates(
    db: &PgPool,
    retention_days: u32,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT bs.id, bs.slip_url AS "slip_url!"
        FROM booking_slips bs
        JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.deleted_at IS NULL
          AND bs.slip_url IS NOT NULL
          AND b.status IN ('checked_out', 'completed', 'cancelled', 'no_show')
          AND bs.admin_status IS NOT NULL
          AND bs.admin_status <> 'pending'
          AND (bs.slipok_status IS NULL OR bs.slipok_status <> 'manual')
          AND GREATEST(
                b.check_out_date::timestamptz,
                COALESCE(b.cancelled_at, '-infinity'::timestamptz),
                COALESCE(b.updated_at, '-infinity'::timestamptz)
              ) < NOW() - make_interval(days => $1)
        ORDER BY bs.id
        LIMIT $2
        "#,
        retention_days as i32,
        BATCH_LIMIT,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|r| (r.id, r.slip_url)).collect())
}

/// Blank the path and stamp the tombstone, but only while the row still
/// looks un-swept — so a concurrent pass cannot double-count.
async fn tombstone(db: &PgPool, slip_id: Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE booking_slips
        SET slip_url        = NULL,
            deleted_at      = NOW(),
            deletion_reason = $2
        WHERE id = $1
          AND deleted_at IS NULL
        "#,
        slip_id,
        REASON_RETENTION_SWEEP,
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Where the sweep will look, for the startup log line.
pub fn configured_slips_dir() -> PathBuf {
    slips_base_dir()
}
