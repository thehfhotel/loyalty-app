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
//! * **any image that some *ineligible* live slip row still points at.**
//!   Nothing in the schema stopped two `booking_slips` rows carrying the same
//!   `slip_url` (`POST /api/bookings/:id/slips` takes the URL from the request
//!   body), so unlinking on behalf of one row could destroy a *different,
//!   live* booking's payment evidence.
//!
//! ## One file, many rows: erase together or not at all (F2b)
//!
//! The first cut of that guard was "defer if **any** other live row shares
//! the file". It is safe and it is also a permanent leak: two closed,
//! eligible bookings whose rows share one `slip_url` each see the other as a
//! live referrer, so each defers to the other and the image is never erased —
//! for ever, which is the exact outcome the retention window exists to
//! prevent.
//!
//! The sweep therefore works on **files, not rows**. Candidates are grouped
//! by `slip_url`, and a group is erased only when *every* live row sharing
//! that URL is eligible in the same pass: one `unlink`, then one `UPDATE`
//! tombstoning all of them. If a single sharer is ineligible — an open
//! booking, an undecided slip, a dispute — the whole group defers exactly as
//! before, and becomes erasable by itself once that last sharer closes.
//!
//! Duplicates stopped being created by `routes::bookings`, which rejects a
//! URL already attached to a live row with a 409, and by the unique partial
//! index in `20260913000000_booking_slips_slip_url_unique.sql`. The grouping
//! stays anyway: the index is written to skip itself if production ever turns
//! out to hold duplicates, and rows created before either guard are still out
//! there in principle.

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

/// Files whose unlink has failed, and how often.
///
/// Keyed by `slip_url` rather than by slip id because the unit of work is the
/// **file**: one URL can back several rows, and a mount that will not let go
/// of the image will not let go of it once per row either.
///
/// Process-local and deliberately not persisted: the failures this bounds are
/// environmental (a mount, a permission), so a restart is exactly the event
/// that should make the sweep try again.
static UNLINK_FAILURES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

/// `OnceLock` rather than `LazyLock`: the crate's MSRV is 1.75 and
/// `LazyLock` only stabilised in 1.80.
fn unlink_failures() -> &'static Mutex<HashMap<String, u32>> {
    UNLINK_FAILURES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record a failed unlink. Returns the new attempt count.
fn note_unlink_failure(slip_url: &str) -> u32 {
    let mut failures = unlink_failures()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let count = failures.entry(slip_url.to_string()).or_insert(0);
    *count += 1;
    *count
}

/// Has this file already exhausted its unlink budget?
fn unlink_budget_spent(slip_url: &str) -> bool {
    unlink_failures()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(slip_url)
        .is_some_and(|count| *count >= MAX_UNLINK_ATTEMPTS)
}

/// Forget a file's failure history once it succeeds.
fn clear_unlink_failures(slip_url: &str) {
    unlink_failures()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(slip_url);
}

/// Run one pass using the process's configured retention window and slips
/// directory. Called from the timer in `main.rs`.
///
/// Never returns an error and never panics: a sweep that could take the
/// process down on a bad night is worse than one that logs and retries.
/// Returns how many slip **images** were erased — files unlinked, not rows
/// tombstoned. One image can be the evidence behind several rows.
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
    let groups = match fetch_erasable_groups(db, retention_days).await {
        Ok(groups) => groups,
        Err(e) => {
            tracing::error!(error = %e, "slip retention sweep query failed");
            return 0;
        },
    };

    if groups.is_empty() {
        return 0;
    }

    let mut erased = 0u64;
    let mut tombstoned = 0u64;
    for (slip_url, slip_ids) in groups {
        // A file this process has already failed to remove three times is not
        // going to come free on the fourth try in the same hour. Skip it
        // silently until a restart; the WARN was logged when the budget ran
        // out.
        if unlink_budget_spent(&slip_url) {
            continue;
        }

        // Erase first. If this fails the rows keep their path and the next
        // pass tries again — a missing file is `Ok(false)`, not an error, so
        // a crash between the unlink and the tombstone still converges.
        match delete_slip_file_in(slips_dir, &slip_url).await {
            Ok(_) => clear_unlink_failures(&slip_url),
            Err(e) => {
                let attempts = note_unlink_failure(&slip_url);
                if attempts >= MAX_UNLINK_ATTEMPTS {
                    tracing::warn!(
                        error = %e,
                        slip_url = %slip_url,
                        slips = slip_ids.len(),
                        attempts,
                        "giving up on erasing this slip image until the process restarts; \
                         its retention tombstone is NOT written, so the rows still report \
                         the image as present"
                    );
                } else {
                    tracing::error!(
                        error = %e,
                        slip_url = %slip_url,
                        slips = slip_ids.len(),
                        attempts,
                        "could not erase a slip image; leaving the rows untouched for the \
                         next sweep"
                    );
                }
                continue;
            },
        }

        match tombstone_group(db, &slip_ids).await {
            Ok(0) => {
                // Another pass (or another instance) got there first.
            },
            Ok(rows) => {
                erased += 1;
                tombstoned += rows;
            },
            Err(e) => tracing::error!(
                error = %e,
                slip_url = %slip_url,
                slips = slip_ids.len(),
                "erased a slip image but failed to write its tombstones; the next sweep \
                 will retry"
            ),
        }
    }

    if erased > 0 {
        tracing::info!(
            erased,
            tombstoned,
            retention_days,
            "erased slip images past the retention window"
        );
    }

    erased
}

/// Slip images the sweep may erase this pass, as `(slip_url, [slip ids])`.
///
/// Two steps, because "may I unlink this file?" is a question about the file
/// and not about any one row:
///
/// 1. [`fetch_eligible_rows`] lists the rows that pass every retention rule,
///    ordered by `slip_url` so rows sharing a file come back together;
/// 2. [`count_live_rows_per_url`] asks how many live rows each of those URLs
///    actually has.
///
/// A group is erasable only when those two numbers agree: every live row
/// pointing at the image is eligible in this same pass, so one `unlink` and
/// one `UPDATE` retire the lot. If the counts differ, some sharer is still
/// open, undecided or disputed — the group defers untouched, exactly as the
/// old row-at-a-time `NOT EXISTS` guard did, and becomes erasable on a later
/// pass once that sharer closes.
///
/// Asking the database for the live count instead of re-stating the
/// eligibility predicate for the "other" row is deliberate: one definition of
/// eligible, in one place, rather than two that can drift.
///
/// The `LIMIT` can still cut the last group in half, in which case its
/// eligible count comes up short and the group waits for the next pass —
/// safe, and self-correcting, because the groups ahead of it leave the
/// candidate set as they are erased. A single group larger than
/// [`BATCH_LIMIT`] would defer for ever; that needs 200 live rows on one
/// file, which the 409 on the attach route and the unique partial index on
/// `slip_url` both now prevent.
async fn fetch_erasable_groups(
    db: &PgPool,
    retention_days: u32,
) -> Result<Vec<(String, Vec<Uuid>)>, sqlx::Error> {
    let eligible = fetch_eligible_rows(db, retention_days).await?;
    if eligible.is_empty() {
        return Ok(Vec::new());
    }

    // Preserve the query's `slip_url, id` ordering so a pass is deterministic
    // and so a log line reads the same way twice.
    let mut groups: Vec<(String, Vec<Uuid>)> = Vec::new();
    for (slip_id, slip_url) in eligible {
        match groups.last_mut() {
            Some((url, ids)) if *url == slip_url => ids.push(slip_id),
            _ => groups.push((slip_url, vec![slip_id])),
        }
    }

    let urls: Vec<String> = groups.iter().map(|(url, _)| url.clone()).collect();
    let live_counts = count_live_rows_per_url(db, &urls).await?;

    Ok(groups
        .into_iter()
        .filter(|(url, ids)| {
            // A URL missing from the map cannot happen — every id in the
            // group is itself a live row with that URL — but treating it as
            // "not all accounted for" is the safe reading if it ever does.
            live_counts
                .get(url)
                .is_some_and(|live| *live == ids.len() as i64)
        })
        .collect())
}

/// Rows whose own booking closed longer ago than the window, that still have
/// an image, and that every other retention rule agrees on.
///
/// `GREATEST(...)` is the closing moment: the *latest* of the stay's end,
/// the cancellation stamp and the row's last write. `bookings.updated_at`
/// has no trigger keeping it current and `cancelled_at` is only set on the
/// cancel path, so no single column is trustworthy on its own — taking the
/// maximum means a column that is stale or NULL can only ever delay an
/// erase, never bring one forward.
///
/// This says nothing about whether the *file* may be unlinked; that is
/// [`fetch_erasable_groups`]'s job.
async fn fetch_eligible_rows(
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
        ORDER BY bs.slip_url, bs.id
        LIMIT $2
        "#,
        days,
        BATCH_LIMIT,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|r| (r.id, r.slip_url)).collect())
}

/// How many live (un-tombstoned) rows point at each of these URLs.
///
/// Backed by `idx_booking_slips_slip_url`. A tombstoned row has `slip_url`
/// NULL, so it cannot appear here and cannot hold a file hostage after its
/// own image is gone.
async fn count_live_rows_per_url(
    db: &PgPool,
    slip_urls: &[String],
) -> Result<HashMap<String, i64>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT slip_url AS "slip_url!", COUNT(*) AS "live!"
        FROM booking_slips
        WHERE slip_url = ANY($1)
          AND deleted_at IS NULL
        GROUP BY slip_url
        "#,
        slip_urls,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|r| (r.slip_url, r.live)).collect())
}

/// Blank the path and stamp the tombstone on every row that shared the image
/// just erased, but only while each row still looks un-swept — so a
/// concurrent pass cannot double-count.
///
/// One statement, therefore one transaction: either every row sharing the
/// file records that the image is gone, or none does. A half-tombstoned group
/// would leave a row claiming an image that is no longer on the volume, which
/// is precisely the state the erase-then-tombstone ordering exists to avoid.
///
/// Returns the number of rows tombstoned.
async fn tombstone_group(db: &PgPool, slip_ids: &[Uuid]) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE booking_slips
        SET slip_url        = NULL,
            deleted_at      = NOW(),
            deletion_reason = $2
        WHERE id = ANY($1)
          AND deleted_at IS NULL
        "#,
        slip_ids,
        REASON_RETENTION_SWEEP,
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

/// Where the sweep will look, for the startup log line.
pub fn configured_slips_dir() -> PathBuf {
    slips_base_dir()
}
