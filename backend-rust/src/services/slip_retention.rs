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
//!   `checked_in`);
//! * **anything but `admin_status = 'verified'`.** `pending` and unset are
//!   undecided by definition, and `needs_action` is *also* undecided — it
//!   means an admin looked, found a problem and handed the slip back to the
//!   guest, so the image is still the evidence behind an open dispute.
//!   Erasing it would destroy the record of the very thing being argued
//!   about. `slipok_status = 'manual'` is excluded for the same reason;
//! * slips already tombstoned;
//! * **any image a second live slip row still points at.** Nothing in the
//!   schema stops two `booking_slips` rows carrying the same `slip_url`
//!   (`POST /api/bookings/:id/slips` takes the URL from the request body),
//!   so unlinking on behalf of one row could destroy a *different, live*
//!   booking's payment evidence. The sweep therefore refuses to unlink a
//!   file another live row shares, and `routes::bookings` now rejects a
//!   duplicate attach outright so the situation stops being created.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

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

/// How many times the sweep will try to unlink one file before giving up on
/// it until the process restarts.
///
/// Without a budget, a file the process genuinely cannot remove — a
/// permissions problem, a read-only mount — logs one ERROR per slip per pass,
/// every hour, for ever. That is not an alert, it is a way to bury real ones.
const MAX_UNLINK_ATTEMPTS: u32 = 3;

/// Slips whose unlink has failed, and how often.
///
/// Process-local and deliberately not persisted: the failures this bounds are
/// environmental (a mount, a permission), so a restart is exactly the event
/// that should make the sweep try again.
static UNLINK_FAILURES: OnceLock<Mutex<HashMap<Uuid, u32>>> = OnceLock::new();

/// `OnceLock` rather than `LazyLock`: the crate's MSRV is 1.75 and
/// `LazyLock` only stabilised in 1.80.
fn unlink_failures() -> &'static Mutex<HashMap<Uuid, u32>> {
    UNLINK_FAILURES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record a failed unlink. Returns the new attempt count.
fn note_unlink_failure(slip_id: Uuid) -> u32 {
    let mut failures = unlink_failures()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let count = failures.entry(slip_id).or_insert(0);
    *count += 1;
    *count
}

/// Has this slip already exhausted its unlink budget?
fn unlink_budget_spent(slip_id: Uuid) -> bool {
    unlink_failures()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&slip_id)
        .is_some_and(|count| *count >= MAX_UNLINK_ATTEMPTS)
}

/// Forget a slip's failure history once it succeeds.
fn clear_unlink_failures(slip_id: Uuid) {
    unlink_failures()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&slip_id);
}

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
        // A file this process has already failed to remove three times is not
        // going to come free on the fourth try in the same hour. Skip it
        // silently until a restart; the WARN was logged when the budget ran
        // out.
        if unlink_budget_spent(slip_id) {
            continue;
        }

        // Erase first. If this fails the row keeps its path and the next
        // pass tries again — a missing file is `Ok(false)`, not an error, so
        // a crash between the unlink and the tombstone still converges.
        match delete_slip_file_in(slips_dir, &slip_url).await {
            Ok(_) => clear_unlink_failures(slip_id),
            Err(e) => {
                let attempts = note_unlink_failure(slip_id);
                if attempts >= MAX_UNLINK_ATTEMPTS {
                    tracing::warn!(
                        error = %e,
                        slip_id = %slip_id,
                        attempts,
                        "giving up on erasing this slip image until the process restarts; \
                         its retention tombstone is NOT written, so the row still reports \
                         the image as present"
                    );
                } else {
                    tracing::error!(
                        error = %e,
                        slip_id = %slip_id,
                        attempts,
                        "could not erase a slip image; leaving the row untouched for the next sweep"
                    );
                }
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
///
/// The `NOT EXISTS` clause is the shared-file guard: a file another live slip
/// row still points at is somebody else's payment evidence, and unlinking it
/// would destroy that booking's record while leaving *its* row claiming the
/// image is present. Such a row simply stops being a candidate — no error, no
/// tombstone — until the last row sharing the file is itself eligible.
async fn fetch_candidates(
    db: &PgPool,
    retention_days: u32,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    // The window is validated into `1..=3650` by
    // `RetentionConfig::slip_retention_days`, so this conversion cannot fail
    // in practice. It is a `try_into` anyway because the failure mode of a
    // silent `as i32` wrap here is catastrophic: a negative interval turns
    // "older than N days" into "older than a date in the future", which would
    // erase every closed booking's slip on the first tick.
    let days: i32 = match i32::try_from(retention_days) {
        Ok(days) if days > 0 => days,
        _ => {
            tracing::error!(
                retention_days,
                "slip retention window is out of range for an interval; refusing to sweep"
            );
            return Ok(Vec::new());
        },
    };

    let rows = sqlx::query!(
        r#"
        SELECT bs.id, bs.slip_url AS "slip_url!"
        FROM booking_slips bs
        JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.deleted_at IS NULL
          AND bs.slip_url IS NOT NULL
          AND b.status IN ('checked_out', 'completed', 'cancelled', 'no_show')
          AND bs.admin_status = 'verified'
          AND (bs.slipok_status IS NULL OR bs.slipok_status <> 'manual')
          AND GREATEST(
                b.check_out_date::timestamptz,
                COALESCE(b.cancelled_at, '-infinity'::timestamptz),
                COALESCE(b.updated_at, '-infinity'::timestamptz)
              ) < NOW() - make_interval(days => $1)
          AND NOT EXISTS (
                SELECT 1
                FROM booking_slips other
                WHERE other.id <> bs.id
                  AND other.slip_url = bs.slip_url
                  AND other.deleted_at IS NULL
              )
        ORDER BY bs.id
        LIMIT $2
        "#,
        days,
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
