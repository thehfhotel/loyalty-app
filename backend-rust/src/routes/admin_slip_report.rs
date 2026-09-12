//! The shadow-window agreement report (task A9)
//!
//! `GET /api/admin/slips/agreement-report?from&to&property`
//!
//! One question, one endpoint: **may we turn `SLIPOK_AUTO_VERIFY` on?**
//!
//! Production runs in shadow mode — the machine reaches a verdict on every
//! slip and writes it to `booking_slips.slipok_status`, then a human decides
//! anyway. Fourteen days of that is a labelled data set: for every slip we
//! have what the machine would have done and what a person actually did. This
//! report is the arithmetic over that set, plus the one line the owner is
//! actually after.
//!
//! ## What counts as a row
//!
//! A slip counts when all three hold:
//!
//! 1. the machine reached a verdict inside the window
//!    (`slipok_checked_at` is set and falls in `[from, to]`);
//! 2. a human has since reached a final decision
//!    (`admin_status` is `verified` or `needs_action`, not `pending`);
//! 3. that decision was made by **a person** — `admin_verified_by` is not
//!    the SlipOK system actor.
//!
//! (3) is not a detail. With `SLIPOK_AUTO_VERIFY` on, an automatic
//! confirmation stamps `admin_verified_by` with
//! [`SLIPOK_SYSTEM_USER_ID`](crate::services::slip_confirm::SLIPOK_SYSTEM_USER_ID)
//! and `admin_status = 'verified'`. Counting those would be the machine
//! marking its own homework, and would drive the agreement rate towards 100 %
//! exactly as the flag got riskier.
//!
//! ## What "agreement" means
//!
//! The machine's verdict is turned into a *prediction of what a human would
//! do*:
//!
//! | machine `slipok_status`  | prediction        |
//! |-------------------------|-------------------|
//! | `verified`, `shadow_pass` | human verifies   |
//! | `manual`                  | human rejects    |
//! | `unavailable`             | **no prediction** |
//!
//! `unavailable` is the machine saying "I have nothing to say" — a quota
//! refusal, an outage, a property with no receiving account configured. It is
//! counted and reported, but it is not evidence either way, so it is out of
//! the agreement denominator. Folding it in would let a bad week at the
//! vendor look like a bad matcher.
//!
//! ## The recommendation
//!
//! `flip` only when **all** of:
//!
//! * [`MIN_ROWS_TO_FLIP`] rows or more — twenty slips is not a lot, but it is
//!   the floor below which one unlucky guest moves the rate by five points;
//! * **zero** machine-verified-but-human-rejected. This is the only failure
//!   that costs money: the machine would have confirmed a booking a person
//!   refused. One is too many, so the threshold is not a rate;
//! * machine-sent-to-manual among the slips a human approved at or below
//!   [`MAX_FALSE_MANUAL_RATE`]. This one only costs work — reception checks
//!   it by hand, which is what happens today anyway — so it is a rate, and
//!   the denominator is the human-verified rows (`humanVerifiedRows` on the
//!   response, so nobody has to guess which denominator was used);
//! * **at least one** human-verified row, so that rate has a denominator at
//!   all. A window in which a person approved nothing is not a window in
//!   which the machine was proved cheap to run — it is a window with nothing
//!   to measure, and `0 / 0` must not read as a flawless 0 %. This shares
//!   the `false_manual_rate` label because it is the same threshold failing
//!   for want of data.
//!
//! Anything else is `keep shadow`, with `failedThresholds` naming which of
//! them did not hold and `reason` saying it in a sentence.
//!
//! ## Bounds
//!
//! The window may span at most [`MAX_WINDOW_DAYS`] days (`from <= to` alone
//! is ordered, not bounded), and at most [`MAX_ROWS_SCANNED`] slips are read
//! — `rowsTruncated` on the response says when that bit, because every count
//! is computed from the rows actually read. The disagreement *list* is
//! separately capped at [`MAX_DISAGREEMENTS_LISTED`] with
//! `disagreementsTruncated`; the counts beside it stay exact.
//!
//! ## PII
//!
//! The disagreement list carries slip ids, verdicts, timestamps and the
//! deciding admin's **user id**. No names, no emails, no guest details, no
//! bank references, no slip image URLs. The report is a calibration
//! artefact; identifying whose slip it was is not part of the question.
//!
//! ## sqlx note
//!
//! Runtime `sqlx::query` rather than the compile-time macros, the same choice
//! and reason as `routes::admin_slips::get_slip`: the `slipok_*` columns are
//! new enough that a runtime query needs no `.sqlx/` offline-cache entry and
//! cannot go stale against one.

use std::collections::BTreeMap;

use axum::{
    extract::{Extension, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{require_admin, AuthUser};
use crate::services::slip_confirm::is_slipok_actor;
use crate::services::slip_match::{
    SLIPOK_STATUS_MANUAL, SLIPOK_STATUS_SHADOW_PASS, SLIPOK_STATUS_UNAVAILABLE,
    SLIPOK_STATUS_VERIFIED,
};
use crate::state::AppState;

/// Fewest rows a `flip` recommendation will stand on.
pub const MIN_ROWS_TO_FLIP: usize = 20;

/// Largest share of human-verified slips the machine may have sent to manual
/// and still earn a `flip`.
pub const MAX_FALSE_MANUAL_RATE: f64 = 0.20;

/// Default window when the caller names neither end: the fourteen days the
/// shadow rollout was specified to run for.
const DEFAULT_WINDOW_DAYS: i64 = 14;

/// Ceiling on how many disagreement rows one section lists. A report the
/// owner cannot open is not a report; the counts above it stay exact.
const MAX_DISAGREEMENTS_LISTED: usize = 200;

/// Longest window the report will answer for, in days.
///
/// `from <= to` on its own is not a bound: `from=1970-01-01` is a perfectly
/// ordered window that scans the whole table. A shadow run is fourteen days
/// and a year of history is already far more than any flip decision needs,
/// so 400 days leaves room for "the last year and a bit" and refuses the
/// rest rather than quietly spending the database on it.
const MAX_WINDOW_DAYS: i64 = 400;

/// Ceiling on how many slip rows one report reads.
///
/// The window cap above bounds this in practice — at real slip volumes 400
/// days is a few thousand rows — but the two are independent: volume could
/// grow without the window changing. Every count in the report is computed
/// from the rows actually read, so hitting this ceiling would silently
/// understate them; [`AgreementReport::rows_truncated`] says so on the
/// response instead, and a truncated report must not be read as a
/// recommendation.
const MAX_ROWS_SCANNED: i64 = 20_000;

/// Asia/Bangkok. `from` and `to` are dates a person typed while looking at a
/// Thai calendar, so they are resolved as Thai days, not UTC ones.
const BANGKOK_OFFSET_SECS: i32 = 7 * 3600;

/// Bucket for a booking whose `property` column is null — early rows, and
/// anything created before the column existed.
const UNKNOWN_PROPERTY: &str = "unknown";

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AgreementReportQuery {
    /// Inclusive first day (`YYYY-MM-DD`, Asia/Bangkok). Defaults to
    /// [`DEFAULT_WINDOW_DAYS`] before `to`.
    pub from: Option<String>,
    /// Inclusive last day (`YYYY-MM-DD`, Asia/Bangkok). Defaults to today.
    pub to: Option<String>,
    /// `hf` | `hfville`. Omitted means both.
    pub property: Option<String>,
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/// One row of the shadow-window data set: what the machine said, what the
/// person decided.
#[derive(Debug, Clone)]
pub struct AgreementRow {
    pub slip_id: Uuid,
    pub property: String,
    pub machine_status: String,
    pub machine_reason: Option<String>,
    pub machine_checked_at: Option<DateTime<Utc>>,
    pub human_decision: String,
    pub decided_by: Option<Uuid>,
    pub decided_at: Option<DateTime<Utc>>,
}

/// What the machine's verdict predicts a human will do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Prediction {
    /// `verified` / `shadow_pass` — the machine would have confirmed it.
    Pass,
    /// `manual` — the machine would have stopped and asked.
    Manual,
    /// `unavailable` (or a status this build does not know) — no opinion.
    None,
}

fn predict(machine_status: &str) -> Prediction {
    match machine_status {
        SLIPOK_STATUS_VERIFIED | SLIPOK_STATUS_SHADOW_PASS => Prediction::Pass,
        SLIPOK_STATUS_MANUAL => Prediction::Manual,
        _ => Prediction::None,
    }
}

/// The two ways machine and human can differ. They are named separately
/// because they cost completely different things.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DisagreementKind {
    /// The machine would have confirmed a slip a person refused. This is the
    /// one that moves money, and the flip threshold for it is zero.
    MachineVerifiedHumanRejected,
    /// The machine sent a slip to manual that a person then approved. Costs
    /// reception a look — which is what shadow mode does anyway.
    HumanVerifiedMachineManual,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disagreement {
    pub slip_id: Uuid,
    pub machine_status: String,
    pub machine_reason: Option<String>,
    pub machine_checked_at: Option<DateTime<Utc>>,
    /// `verified` | `needs_action`.
    pub human_decision: String,
    /// The deciding admin's user id — an opaque identifier, never a name or
    /// an address.
    pub decided_by: Option<Uuid>,
    pub decided_at: Option<DateTime<Utc>>,
    pub kind: DisagreementKind,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineVerdictCounts {
    pub verified: usize,
    pub shadow_pass: usize,
    pub manual: usize,
    pub unavailable: usize,
    /// A `slipok_status` this build does not know about. Always zero unless
    /// the vocabulary grew without this file being updated.
    pub other: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanDecisionCounts {
    pub verified: usize,
    pub needs_action: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonCount {
    pub reason: String,
    pub count: usize,
}

/// `flip` or `keep shadow`, and why.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    /// Exactly `"flip"` or `"keep shadow"`.
    pub verdict: &'static str,
    pub reason: String,
    /// Which thresholds did not hold: `rows`, `machine_verified_human_rejected`,
    /// `false_manual_rate`. Empty for a `flip`.
    pub failed_thresholds: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgreementSection {
    /// `hf`, `hfville`, `unknown`, or `all` for the combined block.
    pub property: String,
    pub rows_considered: usize,
    pub machine_verdicts: MachineVerdictCounts,
    pub human_decisions: HumanDecisionCounts,
    /// Rows on which the machine actually made a prediction — i.e. everything
    /// but `unavailable`. The agreement denominator.
    pub decidable_rows: usize,
    pub agreements: usize,
    pub disagreement_count: usize,
    /// `agreements / decidableRows`, or null when there is nothing to divide.
    pub agreement_rate: Option<f64>,
    /// The expensive mistake: machine would have confirmed, human refused.
    pub machine_verified_human_rejected: usize,
    /// Denominator for `humanVerifiedMachineManualRate`, named so nobody has
    /// to guess which one was used.
    pub human_verified_rows: usize,
    /// The cheap mistake: machine said manual, human approved.
    pub human_verified_machine_manual: usize,
    pub human_verified_machine_manual_rate: Option<f64>,
    /// `slipok_reason` histogram over the rows considered, commonest first.
    pub reason_histogram: Vec<ReasonCount>,
    /// Capped at [`MAX_DISAGREEMENTS_LISTED`]; the counts above are exact.
    pub disagreements: Vec<Disagreement>,
    pub disagreements_truncated: bool,
    pub recommendation: Recommendation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgreementReport {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Echo of the `property` filter, or null when both were asked for.
    pub property: Option<String>,
    pub generated_at: DateTime<Utc>,
    /// True when the window held more slips than [`MAX_ROWS_SCANNED`] and the
    /// report therefore describes only the oldest of them. Every count below
    /// is exact *for the rows read*; a truncated report is not a
    /// recommendation, so narrow the window and ask again.
    pub rows_truncated: bool,
    /// Every row in the window, combined. The flag being flipped is one
    /// global environment variable, so this is the block the decision rests
    /// on; the per-property split below is how a single bad property is
    /// spotted.
    pub overall: AgreementSection,
    /// One section per property present in the window, in a stable order.
    pub properties: Vec<AgreementSection>,
}

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

/// Turn rows into a report. Pure, so the arithmetic and the thresholds are
/// unit-tested without a database anywhere near them.
pub fn build_report(
    rows: Vec<AgreementRow>,
    from: NaiveDate,
    to: NaiveDate,
    property: Option<String>,
    generated_at: DateTime<Utc>,
    rows_truncated: bool,
) -> AgreementReport {
    let overall = summarise("all", &rows);

    // BTreeMap so the property order is stable across calls — a report whose
    // sections shuffle between refreshes is a report nobody trusts.
    let mut by_property: BTreeMap<String, Vec<AgreementRow>> = BTreeMap::new();
    for row in rows {
        by_property
            .entry(row.property.clone())
            .or_default()
            .push(row);
    }

    let properties = by_property
        .into_iter()
        .map(|(name, rows)| summarise(&name, &rows))
        .collect();

    AgreementReport {
        from,
        to,
        property,
        generated_at,
        rows_truncated,
        overall,
        properties,
    }
}

fn summarise(property: &str, rows: &[AgreementRow]) -> AgreementSection {
    let mut machine_verdicts = MachineVerdictCounts::default();
    let mut human_decisions = HumanDecisionCounts::default();
    let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
    let mut disagreements: Vec<Disagreement> = Vec::new();

    let mut decidable_rows = 0usize;
    let mut agreements = 0usize;
    let mut machine_verified_human_rejected = 0usize;
    let mut human_verified_machine_manual = 0usize;

    for row in rows {
        match row.machine_status.as_str() {
            SLIPOK_STATUS_VERIFIED => machine_verdicts.verified += 1,
            SLIPOK_STATUS_SHADOW_PASS => machine_verdicts.shadow_pass += 1,
            SLIPOK_STATUS_MANUAL => machine_verdicts.manual += 1,
            SLIPOK_STATUS_UNAVAILABLE => machine_verdicts.unavailable += 1,
            _ => machine_verdicts.other += 1,
        }

        let human_verified = row.human_decision == "verified";
        if human_verified {
            human_decisions.verified += 1;
        } else {
            human_decisions.needs_action += 1;
        }

        if let Some(reason) = row.machine_reason.as_deref().map(str::trim) {
            if !reason.is_empty() {
                *reasons.entry(reason.to_string()).or_default() += 1;
            }
        }

        let prediction = predict(&row.machine_status);
        if prediction == Prediction::None {
            continue;
        }
        decidable_rows += 1;

        let agreed = matches!(
            (prediction, human_verified),
            (Prediction::Pass, true) | (Prediction::Manual, false)
        );
        if agreed {
            agreements += 1;
            continue;
        }

        let kind = if prediction == Prediction::Pass {
            machine_verified_human_rejected += 1;
            DisagreementKind::MachineVerifiedHumanRejected
        } else {
            human_verified_machine_manual += 1;
            DisagreementKind::HumanVerifiedMachineManual
        };

        if disagreements.len() < MAX_DISAGREEMENTS_LISTED {
            disagreements.push(Disagreement {
                slip_id: row.slip_id,
                machine_status: row.machine_status.clone(),
                machine_reason: row.machine_reason.clone(),
                machine_checked_at: row.machine_checked_at,
                human_decision: row.human_decision.clone(),
                decided_by: row.decided_by,
                decided_at: row.decided_at,
                kind,
            });
        }
    }

    let disagreement_count = decidable_rows - agreements;
    let disagreements_truncated = disagreement_count > disagreements.len();

    let agreement_rate = (decidable_rows > 0).then(|| agreements as f64 / decidable_rows as f64);
    let human_verified_rows = human_decisions.verified;
    let human_verified_machine_manual_rate = (human_verified_rows > 0)
        .then(|| human_verified_machine_manual as f64 / human_verified_rows as f64);

    // Commonest first, then alphabetically so equal counts do not shuffle.
    let mut reason_histogram: Vec<ReasonCount> = reasons
        .into_iter()
        .map(|(reason, count)| ReasonCount { reason, count })
        .collect();
    reason_histogram.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.reason.cmp(&b.reason)));

    let recommendation = recommend(
        rows.len(),
        machine_verified_human_rejected,
        human_verified_machine_manual,
        human_verified_rows,
    );

    AgreementSection {
        property: property.to_string(),
        rows_considered: rows.len(),
        machine_verdicts,
        human_decisions,
        decidable_rows,
        agreements,
        disagreement_count,
        agreement_rate,
        machine_verified_human_rejected,
        human_verified_rows,
        human_verified_machine_manual,
        human_verified_machine_manual_rate,
        reason_histogram,
        disagreements,
        disagreements_truncated,
        recommendation,
    }
}

/// The three thresholds, in the order a reader would check them.
///
/// Public so the integration test asserts against the same function the
/// handler answers with, rather than a copy of the rules that could drift.
pub fn recommend(
    rows_considered: usize,
    machine_verified_human_rejected: usize,
    human_verified_machine_manual: usize,
    human_verified_rows: usize,
) -> Recommendation {
    let mut failed: Vec<&'static str> = Vec::new();
    let mut reasons: Vec<String> = Vec::new();

    if rows_considered < MIN_ROWS_TO_FLIP {
        failed.push("rows");
        reasons.push(format!(
            "only {rows_considered} decided slips in the window; {MIN_ROWS_TO_FLIP} is the floor"
        ));
    }

    if machine_verified_human_rejected > 0 {
        failed.push("machine_verified_human_rejected");
        reasons.push(format!(
            "{machine_verified_human_rejected} slip(s) the machine would have confirmed were \
             rejected by a person; this has to be zero"
        ));
    }

    // No human-verified rows at all means there is no denominator, and a
    // rate of "0 out of 0" is not evidence the matcher is cheap to run —
    // it is evidence there is nothing to measure. The rows floor above
    // already catches every realistic case; this keeps the arithmetic
    // honest if it ever does not.
    let rate = (human_verified_rows > 0)
        .then(|| human_verified_machine_manual as f64 / human_verified_rows as f64);
    match rate {
        Some(rate) if rate > MAX_FALSE_MANUAL_RATE => {
            failed.push("false_manual_rate");
            reasons.push(format!(
                "the machine sent {human_verified_machine_manual} of {human_verified_rows} \
                 human-verified slips to manual ({:.0}%), above the {:.0}% ceiling",
                rate * 100.0,
                MAX_FALSE_MANUAL_RATE * 100.0
            ));
        },
        None => {
            failed.push("false_manual_rate");
            reasons.push(
                "no slip in the window was verified by a person, so there is nothing to \
                 measure the machine against"
                    .to_string(),
            );
        },
        Some(_) => {},
    }

    if failed.is_empty() {
        return Recommendation {
            verdict: "flip",
            reason: format!(
                "{rows_considered} decided slips, no slip the machine would have confirmed was \
                 rejected by a person, and {human_verified_machine_manual} of \
                 {human_verified_rows} human-verified slips went to manual — inside every \
                 threshold"
            ),
            failed_thresholds: Vec::new(),
        };
    }

    Recommendation {
        verdict: "keep shadow",
        reason: reasons.join("; "),
        failed_thresholds: failed,
    }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/// Resolve `from` / `to` into a pair of Bangkok days, and those into the
/// half-open UTC instant range the query binds.
///
/// Bangkok, not UTC: the dates come off a Thai calendar, and a UTC window
/// would quietly file every slip uploaded before 07:00 under the previous
/// day — which at the edges of a fourteen-day window is a whole day of
/// evidence in the wrong bucket.
fn resolve_window(
    query: &AgreementReportQuery,
    now: DateTime<Utc>,
) -> AppResult<(NaiveDate, NaiveDate, DateTime<Utc>, DateTime<Utc>)> {
    let offset =
        FixedOffset::east_opt(BANGKOK_OFFSET_SECS).expect("Bangkok offset is a valid offset");

    let parse = |raw: &str, field: &str| -> AppResult<NaiveDate> {
        NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").map_err(|_| {
            AppError::BadRequest(format!("`{field}` must be a date in YYYY-MM-DD form"))
        })
    };

    let to = match query.to.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => parse(raw, "to")?,
        None => now.with_timezone(&offset).date_naive(),
    };
    let from = match query
        .from
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(raw) => parse(raw, "from")?,
        None => to - Duration::days(DEFAULT_WINDOW_DAYS - 1),
    };

    if from > to {
        return Err(AppError::BadRequest(
            "`from` must not be after `to`".to_string(),
        ));
    }

    // Ordered is not the same as bounded: `from=1970-01-01&to=today` passes
    // the check above and scans the whole table. Refuse it rather than spend
    // the database on a window no flip decision needs.
    let span_days = (to - from).num_days() + 1;
    if span_days > MAX_WINDOW_DAYS {
        return Err(AppError::BadRequest(format!(
            "the window may span at most {MAX_WINDOW_DAYS} days; {span_days} were asked for"
        )));
    }

    let start = offset
        .from_local_datetime(&from.and_hms_opt(0, 0, 0).expect("midnight exists"))
        .single()
        .ok_or_else(|| AppError::Internal("could not resolve the window start".to_string()))?
        .with_timezone(&Utc);
    // Half-open: the day after `to` at midnight, so the whole of `to` is in.
    let end = offset
        .from_local_datetime(
            &(to + Duration::days(1))
                .and_hms_opt(0, 0, 0)
                .expect("midnight exists"),
        )
        .single()
        .ok_or_else(|| AppError::Internal("could not resolve the window end".to_string()))?
        .with_timezone(&Utc);

    Ok((from, to, start, end))
}

/// `hf` | `hfville`, or an error. Anything else is refused rather than
/// silently returning an empty report that reads like "no disagreements".
fn parse_property(raw: Option<&str>) -> AppResult<Option<String>> {
    match raw.map(str::trim).filter(|p| !p.is_empty()) {
        None => Ok(None),
        Some(p @ ("hf" | "hfville")) => Ok(Some(p.to_string())),
        Some(_) => Err(AppError::BadRequest(
            "`property` must be `hf` or `hfville`".to_string(),
        )),
    }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/// `GET /api/admin/slips/agreement-report`
///
/// Admin only. Answers the flip question over the given window; see the
/// module docs for what counts as a row and what the thresholds mean.
async fn agreement_report(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<AgreementReportQuery>,
) -> AppResult<Json<AgreementReport>> {
    require_admin(&user)?;

    let now = Utc::now();
    let (from, to, start, end) = resolve_window(&query, now)?;
    let property = parse_property(query.property.as_deref())?;

    let rows = sqlx::query(
        r#"
        SELECT s.id,
               COALESCE(NULLIF(TRIM(b.property), ''), $4) AS property,
               s.slipok_status,
               s.slipok_reason,
               s.slipok_checked_at,
               s.admin_status,
               s.admin_verified_by,
               s.admin_verified_at
        FROM booking_slips s
        JOIN bookings b ON b.id = s.booking_id
        WHERE s.slipok_checked_at IS NOT NULL
          AND s.slipok_checked_at >= $1
          AND s.slipok_checked_at <  $2
          AND s.admin_status IN ('verified', 'needs_action')
          AND s.admin_verified_by IS DISTINCT FROM $5
          AND ($3::text IS NULL OR b.property = $3)
        ORDER BY s.slipok_checked_at ASC, s.id ASC
        LIMIT $6
        "#,
    )
    .bind(start)
    .bind(end)
    .bind(property.as_deref())
    .bind(UNKNOWN_PROPERTY)
    .bind(crate::services::slip_confirm::SLIPOK_SYSTEM_USER_ID)
    // One more than the ceiling, so a full page is distinguishable from a
    // window that happens to hold exactly `MAX_ROWS_SCANNED` slips. The
    // extra row is dropped below; it is only ever a flag.
    .bind(MAX_ROWS_SCANNED + 1)
    .fetch_all(state.db())
    .await?;

    let rows_truncated = rows.len() as i64 > MAX_ROWS_SCANNED;

    let rows = rows
        .into_iter()
        .take(MAX_ROWS_SCANNED as usize)
        .map(|row| {
            let decided_by: Option<Uuid> = row.try_get("admin_verified_by")?;
            // Belt and braces: the SQL already excludes the system actor, so
            // this can only fire if that predicate is ever edited away.
            debug_assert!(!is_slipok_actor(decided_by));
            Ok(AgreementRow {
                slip_id: row.try_get("id")?,
                property: row.try_get("property")?,
                machine_status: row
                    .try_get::<Option<String>, _>("slipok_status")?
                    .unwrap_or_else(|| "pending".to_string()),
                machine_reason: row.try_get("slipok_reason")?,
                machine_checked_at: row.try_get("slipok_checked_at")?,
                human_decision: row
                    .try_get::<Option<String>, _>("admin_status")?
                    .unwrap_or_else(|| "pending".to_string()),
                decided_by,
                decided_at: row.try_get("admin_verified_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(Json(build_report(
        rows,
        from,
        to,
        property,
        now,
        rows_truncated,
    )))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Merged into the parent admin router, so the shared `auth_middleware`
/// layer covers it. Mount path: `/api/admin/slips/agreement-report`.
pub fn router() -> Router<AppState> {
    Router::new().route("/slips/agreement-report", get(agreement_report))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        property: &str,
        machine_status: &str,
        machine_reason: Option<&str>,
        human_decision: &str,
    ) -> AgreementRow {
        AgreementRow {
            slip_id: Uuid::new_v4(),
            property: property.to_string(),
            machine_status: machine_status.to_string(),
            machine_reason: machine_reason.map(str::to_string),
            machine_checked_at: Some(Utc::now()),
            human_decision: human_decision.to_string(),
            decided_by: Some(Uuid::new_v4()),
            decided_at: Some(Utc::now()),
        }
    }

    /// `n` copies of a row, so a test can build a window of a given size
    /// without twenty literals.
    fn rows(n: usize, make: impl Fn() -> AgreementRow) -> Vec<AgreementRow> {
        (0..n).map(|_| make()).collect()
    }

    fn report(rows: Vec<AgreementRow>) -> AgreementReport {
        build_report(
            rows,
            NaiveDate::from_ymd_opt(2026, 8, 29).expect("date"),
            NaiveDate::from_ymd_opt(2026, 9, 11).expect("date"),
            None,
            Utc::now(),
            false,
        )
    }

    // ------------------------------------------------------------------
    // Agreement arithmetic
    // ------------------------------------------------------------------

    #[test]
    fn a_shadow_pass_a_human_verified_is_agreement() {
        let section = summarise("hf", &[row("hf", "shadow_pass", None, "verified")]);
        assert_eq!(section.agreements, 1);
        assert_eq!(section.decidable_rows, 1);
        assert_eq!(section.agreement_rate, Some(1.0));
        assert_eq!(section.disagreement_count, 0);
        assert!(section.disagreements.is_empty());
    }

    #[test]
    fn a_manual_a_human_rejected_is_also_agreement() {
        let section = summarise(
            "hf",
            &[row("hf", "manual", Some("amount_mismatch"), "needs_action")],
        );
        assert_eq!(section.agreements, 1);
        assert_eq!(section.agreement_rate, Some(1.0));
        assert_eq!(section.human_verified_rows, 0);
        // Nothing was human-verified, so the false-manual rate has no
        // denominator rather than a misleading zero.
        assert_eq!(section.human_verified_machine_manual_rate, None);
    }

    #[test]
    fn the_two_disagreements_are_counted_and_named_apart() {
        let section = summarise(
            "hf",
            &[
                row("hf", "shadow_pass", None, "needs_action"),
                row("hf", "manual", Some("receiver_mismatch"), "verified"),
            ],
        );
        assert_eq!(section.agreements, 0);
        assert_eq!(section.disagreement_count, 2);
        assert_eq!(section.machine_verified_human_rejected, 1);
        assert_eq!(section.human_verified_machine_manual, 1);
        assert_eq!(section.agreement_rate, Some(0.0));
        assert_eq!(
            section.disagreements[0].kind,
            DisagreementKind::MachineVerifiedHumanRejected
        );
        assert_eq!(
            section.disagreements[1].kind,
            DisagreementKind::HumanVerifiedMachineManual
        );
    }

    /// An outage is not evidence about the matcher. `unavailable` rows are
    /// reported but must not move the agreement rate in either direction.
    #[test]
    fn unavailable_rows_are_counted_but_never_judged() {
        let mut all = rows(4, || row("hf", "shadow_pass", None, "verified"));
        all.extend(rows(6, || {
            row("hf", "unavailable", Some("quota_exceeded"), "verified")
        }));
        let section = summarise("hf", &all);

        assert_eq!(section.rows_considered, 10);
        assert_eq!(section.machine_verdicts.unavailable, 6);
        assert_eq!(section.decidable_rows, 4, "only the four with an opinion");
        assert_eq!(section.agreement_rate, Some(1.0));
        assert_eq!(section.disagreement_count, 0);
    }

    #[test]
    fn the_reason_histogram_is_commonest_first() {
        let mut all = rows(3, || {
            row("hf", "manual", Some("amount_mismatch"), "needs_action")
        });
        all.extend(rows(5, || {
            row("hf", "manual", Some("receiver_mismatch"), "needs_action")
        }));
        all.push(row("hf", "unavailable", Some("quota_exceeded"), "verified"));
        // A pass carries no reason and must not appear as an empty bucket.
        all.push(row("hf", "shadow_pass", None, "verified"));

        let section = summarise("hf", &all);
        let histogram: Vec<(&str, usize)> = section
            .reason_histogram
            .iter()
            .map(|r| (r.reason.as_str(), r.count))
            .collect();
        assert_eq!(
            histogram,
            vec![
                ("receiver_mismatch", 5),
                ("amount_mismatch", 3),
                ("quota_exceeded", 1),
            ]
        );
    }

    // ------------------------------------------------------------------
    // Recommendation thresholds
    // ------------------------------------------------------------------

    #[test]
    fn twenty_clean_rows_earn_a_flip() {
        let section = summarise(
            "all",
            &rows(20, || row("hf", "shadow_pass", None, "verified")),
        );
        assert_eq!(section.recommendation.verdict, "flip");
        assert!(section.recommendation.failed_thresholds.is_empty());
    }

    #[test]
    fn nineteen_clean_rows_do_not() {
        let section = summarise(
            "all",
            &rows(19, || row("hf", "shadow_pass", None, "verified")),
        );
        assert_eq!(section.recommendation.verdict, "keep shadow");
        assert_eq!(section.recommendation.failed_thresholds, vec!["rows"]);
        assert!(section.recommendation.reason.contains("19"));
    }

    /// One slip the machine would have confirmed and a person refused is
    /// enough, however good the rest of the window looks.
    #[test]
    fn a_single_machine_verified_human_rejected_blocks_the_flip() {
        let mut all = rows(99, || row("hf", "shadow_pass", None, "verified"));
        all.push(row("hf", "shadow_pass", None, "needs_action"));
        let section = summarise("all", &all);

        assert_eq!(section.rows_considered, 100);
        assert!(section.agreement_rate.expect("rate") > 0.98);
        assert_eq!(section.recommendation.verdict, "keep shadow");
        assert_eq!(
            section.recommendation.failed_thresholds,
            vec!["machine_verified_human_rejected"]
        );
    }

    #[test]
    fn the_false_manual_rate_ceiling_is_twenty_percent_inclusive() {
        // 4 of 20 human-verified slips sent to manual: exactly 20 %, which
        // is inside the ceiling.
        let mut all = rows(16, || row("hf", "shadow_pass", None, "verified"));
        all.extend(rows(4, || {
            row("hf", "manual", Some("amount_mismatch"), "verified")
        }));
        let section = summarise("all", &all);
        assert_eq!(section.human_verified_rows, 20);
        assert_eq!(section.human_verified_machine_manual, 4);
        assert_eq!(section.human_verified_machine_manual_rate, Some(0.2));
        assert_eq!(section.recommendation.verdict, "flip");

        // 5 of 20 is 25 % — over.
        let mut all = rows(15, || row("hf", "shadow_pass", None, "verified"));
        all.extend(rows(5, || {
            row("hf", "manual", Some("amount_mismatch"), "verified")
        }));
        let section = summarise("all", &all);
        assert_eq!(section.recommendation.verdict, "keep shadow");
        assert_eq!(
            section.recommendation.failed_thresholds,
            vec!["false_manual_rate"]
        );
        assert!(section.recommendation.reason.contains("25%"));
    }

    /// Every threshold can fail at once, and the reason has to say so —
    /// fixing one of three and finding the answer unchanged is how a report
    /// loses its reader.
    #[test]
    fn all_three_thresholds_can_fail_together() {
        let all = vec![
            row("hf", "shadow_pass", None, "needs_action"),
            row("hf", "manual", Some("amount_mismatch"), "verified"),
        ];
        let section = summarise("all", &all);
        assert_eq!(section.recommendation.verdict, "keep shadow");
        assert_eq!(
            section.recommendation.failed_thresholds,
            vec![
                "rows",
                "machine_verified_human_rejected",
                "false_manual_rate"
            ]
        );
    }

    /// A window of nothing but rejections has no denominator for the false
    /// manual rate. It must not read as a flawless 0 %.
    #[test]
    fn a_window_with_no_human_verified_slip_never_flips() {
        let section = summarise(
            "all",
            &rows(50, || {
                row("hf", "manual", Some("slip_invalid"), "needs_action")
            }),
        );
        assert_eq!(section.agreement_rate, Some(1.0));
        assert_eq!(section.recommendation.verdict, "keep shadow");
        assert_eq!(
            section.recommendation.failed_thresholds,
            vec!["false_manual_rate"]
        );
    }

    // ------------------------------------------------------------------
    // Property split
    // ------------------------------------------------------------------

    #[test]
    fn the_split_is_per_property_and_the_overall_block_is_the_sum() {
        let mut all = rows(20, || row("hf", "shadow_pass", None, "verified"));
        // hfville has the expensive mistake; hf is clean.
        all.extend(rows(19, || row("hfville", "shadow_pass", None, "verified")));
        all.push(row("hfville", "shadow_pass", None, "needs_action"));

        let report = report(all);

        assert_eq!(report.overall.rows_considered, 40);
        assert_eq!(report.overall.recommendation.verdict, "keep shadow");

        let names: Vec<&str> = report
            .properties
            .iter()
            .map(|s| s.property.as_str())
            .collect();
        assert_eq!(names, vec!["hf", "hfville"]);

        let hf = &report.properties[0];
        assert_eq!(hf.rows_considered, 20);
        assert_eq!(hf.machine_verified_human_rejected, 0);
        assert_eq!(hf.recommendation.verdict, "flip");

        let ville = &report.properties[1];
        assert_eq!(ville.rows_considered, 20);
        assert_eq!(ville.machine_verified_human_rejected, 1);
        assert_eq!(ville.recommendation.verdict, "keep shadow");
    }

    #[test]
    fn a_booking_with_no_property_lands_in_its_own_bucket() {
        let report = report(vec![row(UNKNOWN_PROPERTY, "shadow_pass", None, "verified")]);
        assert_eq!(report.properties[0].property, "unknown");
    }

    // ------------------------------------------------------------------
    // Shape and window
    // ------------------------------------------------------------------

    #[test]
    fn the_report_serialises_camel_case() {
        let report = report(vec![row("hf", "manual", Some("duplicate"), "verified")]);
        let json = serde_json::to_string(&report).expect("serialise");

        for key in [
            "\"generatedAt\"",
            "\"rowsConsidered\"",
            "\"agreementRate\"",
            "\"machineVerdicts\"",
            "\"shadowPass\"",
            "\"humanDecisions\"",
            "\"needsAction\"",
            "\"decidableRows\"",
            "\"machineVerifiedHumanRejected\"",
            "\"humanVerifiedRows\"",
            "\"humanVerifiedMachineManual\"",
            "\"humanVerifiedMachineManualRate\"",
            "\"reasonHistogram\"",
            "\"disagreements\"",
            "\"disagreementsTruncated\"",
            "\"rowsTruncated\"",
            "\"recommendation\"",
            "\"failedThresholds\"",
            "\"slipId\"",
            "\"machineStatus\"",
            "\"machineReason\"",
            "\"machineCheckedAt\"",
            "\"humanDecision\"",
            "\"decidedBy\"",
            "\"decidedAt\"",
        ] {
            assert!(json.contains(key), "missing {key} in {json}");
        }
    }

    /// The report is a calibration artefact, not a guest record.
    #[test]
    fn the_report_carries_no_guest_identifiers() {
        let report = report(vec![row("hf", "manual", Some("duplicate"), "verified")]);
        let json = serde_json::to_string(&report)
            .expect("serialise")
            .to_lowercase();
        for forbidden in [
            "email", "phone", "guest", "slipurl", "slip_url", "transref", "sender", "bank",
        ] {
            assert!(!json.contains(forbidden), "leaked {forbidden}");
        }
    }

    #[test]
    fn the_default_window_is_the_fourteen_day_shadow_run() {
        let now = DateTime::parse_from_rfc3339("2026-09-11T03:00:00Z")
            .expect("parse")
            .with_timezone(&Utc);
        let (from, to, start, end) =
            resolve_window(&AgreementReportQuery::default(), now).expect("window");

        assert_eq!(to, NaiveDate::from_ymd_opt(2026, 9, 11).expect("date"));
        assert_eq!(from, NaiveDate::from_ymd_opt(2026, 8, 29).expect("date"));
        // Bangkok midnight is 17:00 the previous day in UTC.
        assert_eq!(start.to_rfc3339(), "2026-08-28T17:00:00+00:00");
        assert_eq!(end.to_rfc3339(), "2026-09-11T17:00:00+00:00");
    }

    /// A slip uploaded at 02:00 Bangkok on the last day of the window is
    /// still 19:00 UTC the day before. A UTC window would drop it.
    #[test]
    fn the_window_is_resolved_in_bangkok_days() {
        let now = DateTime::parse_from_rfc3339("2026-09-11T20:00:00Z")
            .expect("parse")
            .with_timezone(&Utc);
        let (_, to, _, end) =
            resolve_window(&AgreementReportQuery::default(), now).expect("window");
        // 2026-09-11 20:00 UTC is already 2026-09-12 in Bangkok.
        assert_eq!(to, NaiveDate::from_ymd_opt(2026, 9, 12).expect("date"));
        assert_eq!(end.to_rfc3339(), "2026-09-12T17:00:00+00:00");
    }

    /// Ordered is not bounded: `from=1970-01-01` passes `from <= to` and
    /// would scan the whole table.
    #[test]
    fn an_unbounded_window_is_refused() {
        let whole_history = AgreementReportQuery {
            from: Some("1970-01-01".to_string()),
            to: Some("2026-09-11".to_string()),
            property: None,
        };
        let err = resolve_window(&whole_history, Utc::now())
            .expect_err("a decades-long window must be refused");
        assert!(
            matches!(err, AppError::BadRequest(ref m) if m.contains("at most")),
            "expected a bad-request naming the ceiling, got {err:?}"
        );

        // Exactly at the ceiling is accepted; one day more is not.
        let to = NaiveDate::from_ymd_opt(2026, 9, 11).expect("date");
        let at_ceiling = AgreementReportQuery {
            from: Some((to - Duration::days(MAX_WINDOW_DAYS - 1)).to_string()),
            to: Some(to.to_string()),
            property: None,
        };
        assert!(resolve_window(&at_ceiling, Utc::now()).is_ok());

        let one_too_many = AgreementReportQuery {
            from: Some((to - Duration::days(MAX_WINDOW_DAYS)).to_string()),
            to: Some(to.to_string()),
            property: None,
        };
        assert!(resolve_window(&one_too_many, Utc::now()).is_err());
    }

    /// The default window has to fit inside the ceiling it is bounded by,
    /// or the endpoint refuses its own default.
    #[test]
    fn the_default_window_fits_inside_the_ceiling() {
        // A compile-time check, so shrinking the ceiling below the default
        // fails the build rather than one test run.
        const _: () = assert!(DEFAULT_WINDOW_DAYS <= MAX_WINDOW_DAYS);
        assert!(resolve_window(&AgreementReportQuery::default(), Utc::now()).is_ok());
    }

    #[test]
    fn a_backwards_or_unparseable_window_is_refused() {
        let backwards = AgreementReportQuery {
            from: Some("2026-09-11".to_string()),
            to: Some("2026-08-29".to_string()),
            property: None,
        };
        assert!(resolve_window(&backwards, Utc::now()).is_err());

        let nonsense = AgreementReportQuery {
            from: Some("last tuesday".to_string()),
            ..Default::default()
        };
        assert!(resolve_window(&nonsense, Utc::now()).is_err());
    }

    #[test]
    fn the_property_filter_is_an_allowlist() {
        assert_eq!(parse_property(None).expect("none"), None);
        assert_eq!(parse_property(Some("  ")).expect("blank"), None);
        assert_eq!(
            parse_property(Some("hf")).expect("hf"),
            Some("hf".to_string())
        );
        assert_eq!(
            parse_property(Some("hfville")).expect("hfville"),
            Some("hfville".to_string())
        );
        // Not silently empty: an unknown property is a caller error, and an
        // empty report reads exactly like "no disagreements".
        assert!(parse_property(Some("HF")).is_err());
        assert!(parse_property(Some("' OR 1=1 --")).is_err());
    }
}
