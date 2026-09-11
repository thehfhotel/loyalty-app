//! Retention for the two audit tables (task F10).
//!
//! `docs/public-launch-readiness.md` carries HIGH-5 — *"`booking_audit_log`
//! retention policy — currently 'retain indefinitely' pending legal review"* —
//! and `docs/privacy/2026-09-pdpa-data-map.md` §7 says the same thing about
//! the JSONB snapshots inside it: *"`before_data`/`after_data` are JSONB
//! snapshots and can therefore contain personal data indefinitely — retention
//! here is F10, still open."* `slip_access_log` arrived with F2 and has never
//! had a window at all.
//!
//! Both tables grow forever today. `slip_access_log` is the one that grows
//! *fast*: the admin bookings list writes one row per slip per page load, at
//! up to 200 rows a page (`routes::admin_bookings::list_bookings`,
//! `limit.clamp(1, 200)`), and every slip-moderation click adds more.
//!
//! ## Why a prune job and not range partitioning
//!
//! The readiness doc's follow-up row proposes range-partitioning
//! `booking_audit_log` by `occurred_at` so old partitions can be detached
//! cheaply. That is the right instinct for a table read *by time*. Neither of
//! these tables is:
//!
//! | read path | predicate |
//! |---|---|
//! | `routes::admin_bookings::fetch_audit_history` | `WHERE al.booking_id = $1 ORDER BY al.occurred_at DESC, al.id DESC` |
//! | `routes::admin_slips::get_slip_access_log` (count) | `WHERE slip_id = $1` |
//! | `routes::admin_slips::get_slip_access_log` (page) | `WHERE sal.slip_id = $1 ORDER BY sal.accessed_at DESC, sal.id DESC LIMIT/OFFSET` |
//!
//! Not one of them constrains the partition key, so the planner could never
//! prune a partition: each of those single index scans would become an Append
//! over *every* partition — sixty of them at a monthly grain over a five-year
//! window. Partitioning would make the only read paths these tables have
//! slower in order to speed up a delete that is not slow.
//!
//! It is also not free to adopt: both tables already exist in production, the
//! partition key has to become part of the primary key, and converting a live
//! table means a rewrite under `ACCESS EXCLUSIVE` — writes blocked for the
//! duration, with sqlx running the migration outside a transaction so a
//! mid-rewrite failure leaves a half-converted table behind.
//!
//! So: a plain time-based prune, batched, driven by an index on the
//! timestamp (`20260913000000_audit_log_retention.sql`). A `DELETE` takes row
//! locks on the rows it removes and nothing else, and the rows it removes are
//! by definition the oldest ones, which no live request is touching. It never
//! blocks a write.
//!
//! ## Off unless configured, and floored
//!
//! Like the slip sweep, there is no default window — see
//! [`crate::config::RetentionConfig`]. Unlike it, these windows have a
//! **floor** as well as a ceiling ([`crate::config::AUDIT_LOG_RETENTION_MIN_DAYS`],
//! [`crate::config::SLIP_ACCESS_LOG_RETENTION_MIN_DAYS`]), because here the
//! dangerous mistake is a window that is too *short*: it destroys the evidence
//! trail behind a confirmation, or the record of who read a guest's payer's
//! bank details, while the dispute or the rights request that needs it is
//! still in time to be filed. A refused window is off and reported at
//! startup, never clamped.
//!
//! ## What it will not delete
//!
//! * **Anything belonging to a booking that is still open.** A `pending`,
//!   `confirmed` or `checked_in` booking is live business: its audit trail is
//!   the record of a negotiation still in progress, and no retention clock
//!   should be running on it yet. Both prunes therefore join through to
//!   `bookings.status` and skip anything that is not closed — the same closed
//!   set [`crate::services::slip_retention`] uses.
//! * **Rows younger than the window**, obviously — the clock is the row's own
//!   `occurred_at` / `accessed_at`, not the booking's.
//!
//! An **orphaned** `slip_access_log` row (`slip_id IS NULL`, because the slip
//! it named was hard-deleted — the FK is `ON DELETE SET NULL` on purpose) has
//! no booking to ask about and is pruned on age alone. It holds nothing about
//! any guest by then: an admin id, a route and a timestamp.
//!
//! ## Why runtime queries rather than `sqlx::query!`
//!
//! Same reason `routes::admin_slips` gives for its `slip_access_log` reads:
//! the compile-time macros are validated against the committed offline cache
//! in `backend-rust/.sqlx/`, and a statement added here without regenerating
//! that cache fails `cargo sqlx prepare --check` in CI. These are three fixed
//! `DELETE`s with bound parameters and no result columns to type-check, so the
//! macro buys little and costs a cache regeneration on every touch.

use sqlx::PgPool;

use crate::config::Settings;

/// Booking states that mean "this booking is over". Identical to the closed
/// set in [`crate::services::slip_retention`], deliberately: two retention
/// jobs disagreeing about what "closed" means would be a bug nobody could see
/// from either file.
///
/// `chk_booking_status` allows `pending | confirmed | checked_in |
/// checked_out | completed | cancelled | no_show`; the first three are open.
const CLOSED_STATUSES: [&str; 4] = ["checked_out", "completed", "cancelled", "no_show"];

/// Rows deleted per statement.
///
/// Small enough that one `DELETE` is a short transaction holding a bounded
/// number of row locks, large enough that a busy month drains in a handful of
/// statements.
const BATCH_LIMIT: i64 = 2_000;

/// Statements per table per pass, so one pass has a bounded worst case
/// (100k rows) and a first run against years of backlog spreads over several
/// hourly ticks instead of hammering the database once.
const MAX_BATCHES_PER_PASS: u32 = 50;

/// What one pass did, for the INFO line and for tests.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepSummary {
    /// `booking_audit_log` rows deleted.
    pub audit_rows: u64,
    /// `slip_access_log` rows deleted.
    pub access_rows: u64,
    /// At least one batch failed; the counts above are what got through.
    pub failed: bool,
}

impl SweepSummary {
    /// Total rows removed across both tables.
    pub fn total(&self) -> u64 {
        self.audit_rows + self.access_rows
    }
}

/// Run one pass using the process's configured windows. Called from the timer
/// in `main.rs`.
///
/// Never returns an error and never panics: a retention job that can take the
/// process down on a bad night is worse than one that logs and retries on the
/// next tick.
pub async fn sweep_expired_audit_logs(db: &PgPool, settings: &Settings) -> SweepSummary {
    let audit_days = settings.retention.audit_log_retention_days();
    let access_days = settings.retention.slip_access_log_retention_days();

    if audit_days.is_none() && access_days.is_none() {
        return SweepSummary::default();
    }

    let mut summary = SweepSummary::default();

    if let Some(days) = audit_days {
        match prune(db, Table::BookingAuditLog, days).await {
            Ok(deleted) => summary.audit_rows = deleted,
            Err(partial) => {
                summary.audit_rows = partial;
                summary.failed = true;
            },
        }
    }

    if let Some(days) = access_days {
        match prune(db, Table::SlipAccessLog, days).await {
            Ok(deleted) => summary.access_rows = deleted,
            Err(partial) => {
                summary.access_rows = partial;
                summary.failed = true;
            },
        }
    }

    // One INFO per run, whether or not it deleted anything. A retention job
    // that only speaks when it acts is indistinguishable from a retention job
    // that died three months ago.
    tracing::info!(
        audit_rows = summary.audit_rows,
        access_rows = summary.access_rows,
        audit_retention_days = audit_days,
        slip_access_retention_days = access_days,
        failed = summary.failed,
        "audit log retention sweep finished"
    );

    summary
}

/// Prune one table to an explicit window, independent of the process config.
///
/// Public so an integration test can drive a window without mutating the
/// environment for every other test in the process — the same reason
/// [`crate::services::slip_retention::sweep_expired_slips_in`] takes its
/// directory as a parameter.
///
/// **This entry point does not apply the config floor**, because the floor
/// lives where the value is read from the operator
/// ([`crate::config::RetentionConfig`]) and a test needs to be able to prove
/// what a short window *would* have deleted. Production reaches the prune only
/// through [`sweep_expired_audit_logs`], which cannot see a below-floor value
/// at all.
pub async fn prune_booking_audit_log(db: &PgPool, retention_days: u32) -> u64 {
    match prune(db, Table::BookingAuditLog, retention_days).await {
        Ok(deleted) => deleted,
        Err(partial) => partial,
    }
}

/// [`prune_booking_audit_log`] for `slip_access_log`.
pub async fn prune_slip_access_log(db: &PgPool, retention_days: u32) -> u64 {
    match prune(db, Table::SlipAccessLog, retention_days).await {
        Ok(deleted) => deleted,
        Err(partial) => partial,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Table {
    BookingAuditLog,
    SlipAccessLog,
}

impl Table {
    fn name(self) -> &'static str {
        match self {
            Table::BookingAuditLog => "booking_audit_log",
            Table::SlipAccessLog => "slip_access_log",
        }
    }

    /// The batch `DELETE` for this table.
    ///
    /// The shape is the same for both: pick a bounded, **oldest-first** set of
    /// ids with a subquery, then delete exactly those. Deleting by id rather
    /// than by `WHERE occurred_at < ...` directly is what makes the statement
    /// bounded — an unbounded `DELETE` over a first run's backlog would be one
    /// long transaction holding locks on every row it touches, which is the
    /// "blocks writes" failure this job must not have.
    ///
    /// `ORDER BY` the timestamp lets the index added in
    /// `20260913000000_audit_log_retention.sql` (and, for the audit table,
    /// `idx_booking_audit_log_occurred_at` from `20260512020000`, scanned
    /// backwards) drive the scan and stop at `LIMIT`.
    fn delete_sql(self) -> &'static str {
        match self {
            // `booking_id` is NOT NULL with an FK to `bookings`, so an inner
            // join can never drop a row that should have been considered.
            Table::BookingAuditLog => {
                r#"
                DELETE FROM booking_audit_log
                WHERE id IN (
                    SELECT al.id
                    FROM booking_audit_log al
                    JOIN bookings b ON b.id = al.booking_id
                    WHERE al.occurred_at < NOW() - make_interval(days => $1::int)
                      AND b.status = ANY($2::text[])
                    ORDER BY al.occurred_at
                    LIMIT $3
                )
                "#
            },
            // LEFT joins, and `b.id IS NULL` is an accept rather than a
            // reject: a row whose slip was hard-deleted (`slip_id` NULL, the
            // FK is ON DELETE SET NULL) has no booking to ask about and is
            // pruned on age alone. An INNER join here would silently make
            // those rows immortal.
            Table::SlipAccessLog => {
                r#"
                DELETE FROM slip_access_log
                WHERE id IN (
                    SELECT sal.id
                    FROM slip_access_log sal
                    LEFT JOIN booking_slips bs ON bs.id = sal.slip_id
                    LEFT JOIN bookings b       ON b.id = bs.booking_id
                    WHERE sal.accessed_at < NOW() - make_interval(days => $1::int)
                      AND (b.id IS NULL OR b.status = ANY($2::text[]))
                    ORDER BY sal.accessed_at
                    LIMIT $3
                )
                "#
            },
        }
    }
}

/// Delete in batches until the table has nothing left past the window, the
/// per-pass budget runs out, or a statement fails.
///
/// `Err(n)` carries the rows that *were* deleted before the failure, so a
/// partial pass is still counted rather than reported as zero.
async fn prune(db: &PgPool, table: Table, retention_days: u32) -> Result<u64, u64> {
    // The window is validated into a floored range by `RetentionConfig` before
    // it reaches the production caller, so this conversion cannot fail there.
    // It is a `try_from` anyway because the failure mode of a silent `as i32`
    // wrap is catastrophic: a negative interval turns "older than N days" into
    // "older than a date in the future", which would delete the entire audit
    // trail on the first tick.
    let days: i32 = match i32::try_from(retention_days) {
        Ok(days) if days > 0 => days,
        _ => {
            tracing::warn!(
                retention_days,
                table = table.name(),
                "retention window is out of range for an interval; refusing to prune"
            );
            return Err(0);
        },
    };

    let closed: Vec<String> = CLOSED_STATUSES.iter().map(|s| s.to_string()).collect();
    let mut deleted_total = 0u64;

    for _ in 0..MAX_BATCHES_PER_PASS {
        let result = sqlx::query(table.delete_sql())
            .bind(days)
            .bind(&closed)
            .bind(BATCH_LIMIT)
            .execute(db)
            .await;

        match result {
            Ok(done) => {
                let deleted = done.rows_affected();
                deleted_total += deleted;
                // A short batch means the table is drained for this window.
                if deleted < BATCH_LIMIT as u64 {
                    return Ok(deleted_total);
                }
            },
            Err(e) => {
                // One WARN per table per pass, not one per batch: a database
                // that refuses this statement will refuse the next fifty too,
                // and an hourly job that logs fifty identical lines is a way
                // to bury real alerts rather than raise one.
                tracing::warn!(
                    error = %e,
                    table = table.name(),
                    retention_days,
                    deleted_before_failure = deleted_total,
                    "audit log retention prune failed; the next pass will retry"
                );
                return Err(deleted_total);
            },
        }
    }

    // Budget spent with a full batch still coming back: there is more to do,
    // and the next tick will do it. Not a failure.
    Ok(deleted_total)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The closed set must match `slip_retention`'s, and must not contain an
    /// open state. Two retention jobs disagreeing about what "closed" means
    /// is a bug that is invisible from inside either file.
    #[test]
    fn the_closed_set_excludes_every_open_booking_state() {
        for open in ["pending", "confirmed", "checked_in"] {
            assert!(
                !CLOSED_STATUSES.contains(&open),
                "{} is an open booking state and must never be pruned",
                open
            );
        }
        for closed in ["checked_out", "completed", "cancelled", "no_show"] {
            assert!(CLOSED_STATUSES.contains(&closed), "{} is closed", closed);
        }
    }

    /// A bounded batch is the whole reason this job cannot block writes.
    #[test]
    fn the_batch_budget_is_bounded_and_positive() {
        assert!(BATCH_LIMIT > 0);
        assert!(MAX_BATCHES_PER_PASS > 0);
        assert!(
            BATCH_LIMIT <= 10_000,
            "a batch this large stops being a short transaction"
        );
    }

    #[test]
    fn summary_totals_both_tables() {
        let summary = SweepSummary {
            audit_rows: 3,
            access_rows: 4,
            failed: false,
        };
        assert_eq!(summary.total(), 7);
        assert_eq!(SweepSummary::default().total(), 0);
    }
}
