//! LINE push budget guard (C5) — spend the free plan on purpose, not by luck.
//!
//! Each guest OA sits on the LINE free plan: roughly **300 push messages per
//! calendar month**, shared by everything we send through that OA. Nothing in
//! the codebase used to know that number, so the first feature to get chatty
//! would have spent the month's allowance and every later push — including
//! the ones a guest is waiting for — would have failed at LINE with no local
//! trace of why.
//!
//! This module is that missing arithmetic. The program plan (§8) splits the
//! allowance into fixed buckets and this is where the split is enforced:
//!
//! | bucket        | default cap | drawn by                                |
//! |---------------|-------------|-----------------------------------------|
//! | `auto_verify` | **0**       | nobody — auto-verify must never push    |
//! | `ops`         | 50          | stay accruals, ops/report messages      |
//! | `campaign`    | 200         | admin broadcasts                        |
//! | `reserve`     | 50          | ops only, with an explicit override     |
//!
//! ## The shape of a reservation
//!
//! [`PushBudget::reserve`] is the only way to spend. It either hands back a
//! [`Reservation`] — the quota is already committed at that point, so the
//! caller may send — or a typed [`PushRefusal`] naming why it would not.
//! **A refusal is never an error.** A guest must not see a 500 because an
//! admin sent too many campaign messages; the call site logs the reason and
//! moves on. That is why the refusal is a value in the success arm rather
//! than an `Err`.
//!
//! ## Why the counter never goes back down
//!
//! [`PushBudget::settle`] records how a reserved push ended, and a `failed`
//! one keeps its slot. Refunding would track LINE's own accounting more
//! exactly (LINE does not bill a rejected message), but it would also make
//! the counter non-monotonic — and the 80 % / exhaustion warnings below are
//! *once per month* precisely because the count only ever climbs past a
//! threshold once. A guard that errs toward under-sending is the right kind
//! of wrong for a hard external cap; the ledger still records `failed`, so
//! the difference is visible to anyone who looks.
//!
//! ## Concurrency
//!
//! One `pg_advisory_xact_lock` per (OA, month) serialises reserves for that
//! OA inside the reserving transaction — the same tool `db::seed` and the
//! admin-bootstrap promotion use. It is needed because the whole-OA total is
//! a `SUM` across bucket rows: a per-row `ON CONFLICT` upsert alone would let
//! two concurrent reserves in two different buckets each see the month one
//! short of 300 and both proceed.
//!
//! ## Privacy
//!
//! The ledger stores [`PushTargetHash`] — SHA-256 of the LINE userId, hex —
//! and never the userId itself. The type has no constructor that takes a
//! pre-made string, so there is no call site that *could* write a raw
//! identifier, and the table's CHECK constraint refuses anything that is not
//! 64 lowercase hex characters even if one appeared.
//!
//! ## sqlx note
//!
//! Runtime `sqlx::query`/`query_as` rather than the compile-time macros —
//! the same choice, for the same reason, as `services::booking_notify`:
//! `line_push_budget` / `line_push_ledger` are new in migration
//! `20260915000000_line_push_ledger.sql`, and a runtime query needs no
//! `.sqlx/` offline-cache entry and cannot go stale against one.

use chrono::{DateTime, Datelike, FixedOffset, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::config::Settings;
use crate::error::AppResult;
use crate::types::Property;

/// Asia/Bangkok, the calendar the people reading the admin page live in.
/// Thailand has no DST, so a fixed offset is the whole truth here.
const BANGKOK_UTC_OFFSET_SECS: i32 = 7 * 3600;

/// The auto-verify bucket's cap, fixed by the plan and not configurable.
/// Slip auto-verification answers in the app; it has never had a reason to
/// spend a push, and a settable zero is an invitation to make it non-zero.
pub const AUTO_VERIFY_BUDGET: u32 = 0;

/// Fraction of a bucket that triggers the one "running low" warning, as a
/// numerator/denominator pair so the threshold is exact integer arithmetic.
const WARN_AT_NUMERATOR: u32 = 4;
const WARN_AT_DENOMINATOR: u32 = 5;

// ============================================================================
// Buckets
// ============================================================================

/// One of the four fixed shares of an OA's monthly free allowance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PushBucket {
    /// Slip auto-verification. Capped at zero — see [`AUTO_VERIFY_BUDGET`].
    AutoVerify,
    /// Stay accruals and ops/report messages.
    Ops,
    /// Admin broadcasts.
    Campaign,
    /// Held back for ops, and only with an explicit override.
    Reserve,
}

impl PushBucket {
    /// Every bucket, in plan order — the order the admin endpoint reports.
    pub const ALL: [PushBucket; 4] = [
        PushBucket::AutoVerify,
        PushBucket::Ops,
        PushBucket::Campaign,
        PushBucket::Reserve,
    ];

    /// Stable storage/log token. Matches the `bucket` CHECK constraint.
    pub fn as_str(self) -> &'static str {
        match self {
            PushBucket::AutoVerify => "auto_verify",
            PushBucket::Ops => "ops",
            PushBucket::Campaign => "campaign",
            PushBucket::Reserve => "reserve",
        }
    }
}

impl std::fmt::Display for PushBucket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ============================================================================
// Target hash
// ============================================================================

/// SHA-256 of a LINE userId, lowercase hex — the only form of a push target
/// that ever reaches the ledger.
///
/// There is deliberately no `From<String>` and no public field: the only way
/// to obtain one is [`PushTargetHash::of`], so no call site can write a raw
/// LINE userId into `line_push_ledger` even by accident.
///
/// Full-length, unlike [`crate::utils::hash_email`]'s 48-bit truncation. A
/// LINE userId is `U` + 32 hex characters — 128 bits of entropy, nothing an
/// attacker can enumerate — so there is no reason to spend collision margin
/// here, and the fixed 64-character width is what the table's CHECK asserts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushTargetHash(String);

impl PushTargetHash {
    /// Hash a LINE userId for storage.
    pub fn of(line_user_id: &str) -> Self {
        Self(hex::encode(Sha256::digest(line_user_id.as_bytes())))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// ============================================================================
// Outcomes
// ============================================================================

/// Why a reserve did not hand back quota.
///
/// Each variant is a *normal* operating state, not a fault — but they call
/// for different responses, which is why the caller gets a typed value rather
/// than a bare `false`: `bucket_exhausted` on `campaign` means an admin sent
/// a lot this month, while the same refusal on `ops` means guests have
/// stopped getting their thank-you messages and somebody should look.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushRefusal {
    /// This bucket has spent its share for the month.
    BucketExhausted {
        bucket: PushBucket,
        used: u32,
        limit: u32,
    },
    /// The bucket had room but the OA's whole-month ceiling does not.
    MonthTotalExhausted { used: u32, limit: u32 },
    /// [`PushBucket::Reserve`] was asked for without the ops override.
    ReserveWithoutOverride,
}

impl PushRefusal {
    /// Stable, log-safe reason string. Contains no personal data, and matches
    /// the `result` values the ledger accepts (minus the `refused_` prefix).
    pub fn reason(&self) -> &'static str {
        match self {
            PushRefusal::BucketExhausted { .. } => "bucket_exhausted",
            PushRefusal::MonthTotalExhausted { .. } => "month_total_exhausted",
            PushRefusal::ReserveWithoutOverride => "reserve_without_override",
        }
    }

    /// The `line_push_ledger.result` value recorded for this refusal.
    fn ledger_result(&self) -> &'static str {
        match self {
            PushRefusal::BucketExhausted { .. } => "refused_bucket_exhausted",
            PushRefusal::MonthTotalExhausted { .. } => "refused_month_total_exhausted",
            PushRefusal::ReserveWithoutOverride => "refused_reserve_without_override",
        }
    }
}

/// Quota that has already been committed. Holding one means the caller may
/// send; [`PushBudget::settle`] records how it went.
#[derive(Debug, Clone)]
pub struct Reservation {
    /// `line_push_ledger.id` — the row [`PushBudget::settle`] updates.
    pub ledger_id: Uuid,
    pub property: Property,
    pub bucket: PushBucket,
    /// `YYYY-MM` in Asia/Bangkok.
    pub month: String,
    /// The bucket's count *including* this reservation.
    pub used: u32,
    /// The bucket's cap for the month.
    pub limit: u32,
}

/// What [`PushBudget::reserve`] decided.
#[derive(Debug, Clone)]
pub enum ReserveOutcome {
    Granted(Reservation),
    Refused(PushRefusal),
}

impl ReserveOutcome {
    pub fn granted(&self) -> Option<&Reservation> {
        match self {
            ReserveOutcome::Granted(r) => Some(r),
            ReserveOutcome::Refused(_) => None,
        }
    }

    pub fn refusal(&self) -> Option<&PushRefusal> {
        match self {
            ReserveOutcome::Granted(_) => None,
            ReserveOutcome::Refused(r) => Some(r),
        }
    }
}

/// How a reserved push ended, for the ledger row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushResult {
    Delivered,
    Failed,
}

impl PushResult {
    fn as_str(self) -> &'static str {
        match self {
            PushResult::Delivered => "delivered",
            PushResult::Failed => "failed",
        }
    }
}

// ============================================================================
// The guard
// ============================================================================

/// Per-bucket caps for one month of one OA.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BucketLimits {
    pub auto_verify: u32,
    pub ops: u32,
    pub campaign: u32,
    pub reserve: u32,
    /// Whole-OA ceiling across all four buckets.
    pub total: u32,
}

impl BucketLimits {
    pub fn of(&self, bucket: PushBucket) -> u32 {
        match bucket {
            PushBucket::AutoVerify => self.auto_verify,
            PushBucket::Ops => self.ops,
            PushBucket::Campaign => self.campaign,
            PushBucket::Reserve => self.reserve,
        }
    }
}

/// The budget guard. Cheap to construct — it is just the configured caps —
/// so call sites build one per push rather than threading it through state.
#[derive(Debug, Clone, Copy)]
pub struct PushBudget {
    limits: BucketLimits,
}

impl PushBudget {
    /// Build the guard from the deployment's configured caps.
    pub fn from_settings(settings: &Settings) -> Self {
        Self {
            limits: BucketLimits {
                auto_verify: AUTO_VERIFY_BUDGET,
                ops: settings.line_push_budget.ops(),
                campaign: settings.line_push_budget.campaign(),
                reserve: settings.line_push_budget.reserve(),
                total: settings.line_push_budget.total(),
            },
        }
    }

    pub fn limits(&self) -> BucketLimits {
        self.limits
    }

    /// Reserve one push against `oa`'s `bucket` for the current month.
    ///
    /// See [`Self::reserve_at`]; this is that call with "now".
    pub async fn reserve(
        &self,
        db: &PgPool,
        oa: Property,
        bucket: PushBucket,
        target: &PushTargetHash,
    ) -> AppResult<ReserveOutcome> {
        self.reserve_at(db, oa, bucket, target, false, Utc::now())
            .await
    }

    /// Reserve against [`PushBucket::Reserve`] — or any bucket — with the ops
    /// override.
    ///
    /// The override is the whole access control on the reserve bucket: it is
    /// held back for ops, so it is spendable only by a call site that says,
    /// in so many words, that it is ops asking. Passing `false` here is
    /// exactly [`Self::reserve`].
    pub async fn reserve_with_override(
        &self,
        db: &PgPool,
        oa: Property,
        bucket: PushBucket,
        target: &PushTargetHash,
        ops_override: bool,
    ) -> AppResult<ReserveOutcome> {
        self.reserve_at(db, oa, bucket, target, ops_override, Utc::now())
            .await
    }

    /// Reserve as of a given instant — the seam the month-rollover test uses.
    ///
    /// Atomic: the whole decision (read the month, check both caps, increment
    /// the bucket, write the ledger row) happens in one transaction behind a
    /// per-(OA, month) advisory lock, so two concurrent pushes cannot both
    /// see the last free slot.
    pub async fn reserve_at(
        &self,
        db: &PgPool,
        oa: Property,
        bucket: PushBucket,
        target: &PushTargetHash,
        ops_override: bool,
        now: DateTime<Utc>,
    ) -> AppResult<ReserveOutcome> {
        let month = month_key(now);
        let limit = self.limits.of(bucket);

        if bucket == PushBucket::Reserve && !ops_override {
            let refusal = PushRefusal::ReserveWithoutOverride;
            self.record_refusal(db, oa, bucket, &month, target, &refusal)
                .await?;
            return Ok(ReserveOutcome::Refused(refusal));
        }

        let mut tx = db.begin().await?;

        // Serialise reserves for this OA and month. Without it the whole-OA
        // total below is a read of a moving number.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
            .bind(format!("line_push_budget:{}:{}", oa.as_str(), month))
            .execute(&mut *tx)
            .await?;

        let rows: Vec<BucketCountRow> = sqlx::query_as(
            r#"SELECT bucket, count FROM line_push_budget WHERE property = $1 AND month = $2"#,
        )
        .bind(oa.as_str())
        .bind(&month)
        .fetch_all(&mut *tx)
        .await?;

        let used_bucket: u32 = rows
            .iter()
            .find(|r| r.bucket == bucket.as_str())
            .map(|r| r.count.max(0) as u32)
            .unwrap_or(0);
        let used_total: u32 = rows.iter().map(|r| r.count.max(0) as u32).sum();

        if used_bucket >= limit {
            tx.rollback().await?;
            let refusal = PushRefusal::BucketExhausted {
                bucket,
                used: used_bucket,
                limit,
            };
            self.record_refusal(db, oa, bucket, &month, target, &refusal)
                .await?;
            return Ok(ReserveOutcome::Refused(refusal));
        }

        if used_total >= self.limits.total {
            tx.rollback().await?;
            let refusal = PushRefusal::MonthTotalExhausted {
                used: used_total,
                limit: self.limits.total,
            };
            self.record_refusal(db, oa, bucket, &month, target, &refusal)
                .await?;
            return Ok(ReserveOutcome::Refused(refusal));
        }

        sqlx::query(
            r#"
            INSERT INTO line_push_budget (property, bucket, month, count)
            VALUES ($1, $2, $3, 1)
            ON CONFLICT (property, bucket, month) DO UPDATE
                SET count = line_push_budget.count + 1, updated_at = NOW()
            "#,
        )
        .bind(oa.as_str())
        .bind(bucket.as_str())
        .bind(&month)
        .execute(&mut *tx)
        .await?;

        let ledger_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO line_push_ledger (id, property, bucket, month, target_hash, result)
            VALUES ($1, $2, $3, $4, $5, 'reserved')
            "#,
        )
        .bind(ledger_id)
        .bind(oa.as_str())
        .bind(bucket.as_str())
        .bind(&month)
        .bind(target.as_str())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        let used = used_bucket + 1;
        warn_on_threshold_crossing(oa, bucket.as_str(), &month, used, limit);
        warn_on_threshold_crossing(oa, "month_total", &month, used_total + 1, self.limits.total);

        Ok(ReserveOutcome::Granted(Reservation {
            ledger_id,
            property: oa,
            bucket,
            month,
            used,
            limit,
        }))
    }

    /// Record how a reserved push ended. The quota stays spent either way —
    /// see the module docs on why the counter never goes back down.
    pub async fn settle(
        &self,
        db: &PgPool,
        reservation: &Reservation,
        result: PushResult,
    ) -> AppResult<()> {
        sqlx::query(r#"UPDATE line_push_ledger SET result = $2 WHERE id = $1"#)
            .bind(reservation.ledger_id)
            .bind(result.as_str())
            .execute(db)
            .await?;
        Ok(())
    }

    /// Write the audit row for a push that was never sent. Outside the
    /// reserving transaction on purpose: the transaction was rolled back
    /// precisely because nothing should be counted, and this row must survive
    /// that rollback.
    async fn record_refusal(
        &self,
        db: &PgPool,
        oa: Property,
        bucket: PushBucket,
        month: &str,
        target: &PushTargetHash,
        refusal: &PushRefusal,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO line_push_ledger (id, property, bucket, month, target_hash, result)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(oa.as_str())
        .bind(bucket.as_str())
        .bind(month)
        .bind(target.as_str())
        .bind(refusal.ledger_result())
        .execute(db)
        .await?;
        Ok(())
    }
}

#[derive(Debug, FromRow)]
struct BucketCountRow {
    bucket: String,
    count: i32,
}

// ============================================================================
// Reading the month back
// ============================================================================

/// One bucket's month-to-date position, as the admin endpoint reports it.
#[derive(Debug, Clone, Serialize)]
pub struct BucketUsage {
    pub bucket: PushBucket,
    pub used: u32,
    pub limit: u32,
    pub remaining: u32,
}

/// One OA's month-to-date position across every bucket.
#[derive(Debug, Clone, Serialize)]
pub struct PropertyUsage {
    pub property: Property,
    pub used: u32,
    pub limit: u32,
    pub remaining: u32,
    pub buckets: Vec<BucketUsage>,
}

impl PushBudget {
    /// Month-to-date usage per bucket per OA for the current month.
    pub async fn usage(&self, db: &PgPool) -> AppResult<(String, Vec<PropertyUsage>)> {
        self.usage_at(db, Utc::now()).await
    }

    /// Month-to-date usage as of a given instant — the seam the tests use.
    ///
    /// Every OA and every bucket is reported, including the ones with no row
    /// yet: an operator asking "how much is left" needs the zeroes as much as
    /// the counts, and a missing row must not read as a missing bucket.
    pub async fn usage_at(
        &self,
        db: &PgPool,
        now: DateTime<Utc>,
    ) -> AppResult<(String, Vec<PropertyUsage>)> {
        let month = month_key(now);
        let rows: Vec<UsageRow> = sqlx::query_as(
            r#"SELECT property, bucket, count FROM line_push_budget WHERE month = $1"#,
        )
        .bind(&month)
        .fetch_all(db)
        .await?;

        let properties = Property::ALL
            .into_iter()
            .map(|property| {
                let buckets: Vec<BucketUsage> = PushBucket::ALL
                    .into_iter()
                    .map(|bucket| {
                        let used = rows
                            .iter()
                            .find(|r| {
                                r.property == property.as_str() && r.bucket == bucket.as_str()
                            })
                            .map(|r| r.count.max(0) as u32)
                            .unwrap_or(0);
                        let limit = self.limits.of(bucket);
                        BucketUsage {
                            bucket,
                            used,
                            limit,
                            remaining: limit.saturating_sub(used),
                        }
                    })
                    .collect();
                let used: u32 = buckets.iter().map(|b| b.used).sum();
                PropertyUsage {
                    property,
                    used,
                    limit: self.limits.total,
                    remaining: self.limits.total.saturating_sub(used),
                    buckets,
                }
            })
            .collect();

        Ok((month, properties))
    }
}

#[derive(Debug, FromRow)]
struct UsageRow {
    property: String,
    bucket: String,
    count: i32,
}

// ============================================================================
// Month key + warnings
// ============================================================================

/// `YYYY-MM` in Asia/Bangkok for an instant.
pub fn month_key(now: DateTime<Utc>) -> String {
    let offset =
        FixedOffset::east_opt(BANGKOK_UTC_OFFSET_SECS).expect("UTC+7 is a valid fixed offset");
    let local = now.with_timezone(&offset);
    format!("{:04}-{:02}", local.year(), local.month())
}

/// The count at which a bucket is 80 % spent — the point the first warning
/// fires. Rounds *up*, so a cap of 50 warns at 40 and a cap of 3 warns at 3
/// (which the exhaustion warning then takes precedence over).
fn warn_threshold(limit: u32) -> u32 {
    limit
        .saturating_mul(WARN_AT_NUMERATOR)
        .div_ceil(WARN_AT_DENOMINATOR)
}

/// Warn exactly once per month per bucket, at 80 % and again at exhaustion.
///
/// No new channel and no extra state: the count only ever climbs, and climbs
/// one at a time, so it passes each threshold exactly once in a month. That
/// equality test *is* the once-per-month guarantee — which is also why
/// [`PushBudget::settle`] must not decrement.
fn warn_on_threshold_crossing(oa: Property, bucket: &str, month: &str, used: u32, limit: u32) {
    if limit == 0 {
        return;
    }
    if used == limit {
        tracing::warn!(
            property = %oa,
            bucket = bucket,
            month = month,
            used = used,
            limit = limit,
            "LINE push budget exhausted for the month; further pushes in this bucket are refused"
        );
    } else if used == warn_threshold(limit) {
        tracing::warn!(
            property = %oa,
            bucket = bucket,
            month = month,
            used = used,
            limit = limit,
            "LINE push budget at 80% for the month"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn month_key_is_bangkok_local_not_utc() {
        // 2026-01-31 18:00Z is already 2026-02-01 01:00 in Bangkok, so the
        // February budget starts seven hours before UTC says it does. The
        // people reading the admin page keep a Bangkok calendar.
        let utc = Utc.with_ymd_and_hms(2026, 1, 31, 18, 0, 0).unwrap();
        assert_eq!(month_key(utc), "2026-02");

        let same_day = Utc.with_ymd_and_hms(2026, 1, 31, 10, 0, 0).unwrap();
        assert_eq!(month_key(same_day), "2026-01");
    }

    #[test]
    fn month_key_is_zero_padded() {
        let utc = Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap();
        assert_eq!(month_key(utc), "2026-09");
    }

    #[test]
    fn warn_threshold_is_eighty_percent_rounded_up() {
        assert_eq!(warn_threshold(50), 40);
        assert_eq!(warn_threshold(200), 160);
        assert_eq!(warn_threshold(300), 240);
        // Rounds up so a small bucket still gets a warning before the cap.
        assert_eq!(warn_threshold(3), 3);
        assert_eq!(warn_threshold(1), 1);
        assert_eq!(warn_threshold(0), 0);
    }

    #[test]
    fn target_hash_is_sixty_four_lowercase_hex_and_never_the_id() {
        let raw = "U1234567890abcdef1234567890abcdef";
        let hash = PushTargetHash::of(raw);
        assert_eq!(hash.as_str().len(), 64);
        assert!(hash.as_str().chars().all(|c| c.is_ascii_hexdigit()));
        assert!(hash.as_str().chars().all(|c| !c.is_ascii_uppercase()));
        assert!(!hash.as_str().contains(raw));
        // Stable, so the same member correlates across a month.
        assert_eq!(hash, PushTargetHash::of(raw));
        assert_ne!(
            hash,
            PushTargetHash::of("Uffffffffffffffffffffffffffffffff")
        );
    }

    #[test]
    fn bucket_tokens_match_the_check_constraint() {
        assert_eq!(PushBucket::AutoVerify.as_str(), "auto_verify");
        assert_eq!(PushBucket::Ops.as_str(), "ops");
        assert_eq!(PushBucket::Campaign.as_str(), "campaign");
        assert_eq!(PushBucket::Reserve.as_str(), "reserve");
    }

    #[test]
    fn refusal_reasons_are_stable_and_log_safe() {
        assert_eq!(
            PushRefusal::ReserveWithoutOverride.reason(),
            "reserve_without_override"
        );
        assert_eq!(
            PushRefusal::BucketExhausted {
                bucket: PushBucket::Ops,
                used: 50,
                limit: 50
            }
            .reason(),
            "bucket_exhausted"
        );
        assert_eq!(
            PushRefusal::MonthTotalExhausted {
                used: 300,
                limit: 300
            }
            .reason(),
            "month_total_exhausted"
        );
    }

    #[test]
    fn plan_defaults_are_the_configured_limits() {
        let budget = PushBudget::from_settings(&Settings::default());
        let limits = budget.limits();
        assert_eq!(limits.auto_verify, 0);
        assert_eq!(limits.ops, 50);
        assert_eq!(limits.campaign, 200);
        assert_eq!(limits.reserve, 50);
        assert_eq!(limits.total, 300);
        // The plan's four buckets add up to the free plan exactly.
        assert_eq!(
            limits.auto_verify + limits.ops + limits.campaign + limits.reserve,
            limits.total
        );
    }
}
