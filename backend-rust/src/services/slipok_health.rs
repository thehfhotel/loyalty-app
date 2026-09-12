//! SlipOK degradation tracker — one alert in, one recovery out (task A4)
//!
//! `slip_match::decide` already does the safe thing when the vendor gives no
//! verdict: the slip lands on `slipok_status = 'unavailable'` and waits for a
//! human. What it cannot do is *tell anyone*. A quota that ran out at 09:00
//! looks, from the desk, exactly like a quiet morning — until reception
//! notices at 16:00 that nothing has auto-checked all day.
//!
//! This module is the missing half: it watches the stream of SlipOK call
//! outcomes and, the first time the automatic check stops working, sends
//! **one** message to the property mailbox saying slips are queued for manual
//! verification and why; and the first time it works again, **one** message
//! saying so.
//!
//! ## Which channel
//!
//! The property mailboxes already wired for `services::booking_notify`
//! (`BOOKING_NOTIFY_EMAIL_HF` / `BOOKING_NOTIFY_EMAIL_HFVILLE`), through the
//! same [`EmailService`] trait. That is deliberately a *reuse*, not a new
//! channel: it is the only alerting surface this backend has that reaches a
//! human, it is already configured, already rate-thought-through, and already
//! the place reception looks. A second channel would be a second thing to
//! configure, a second thing to forget, and a second thing to test.
//!
//! Unlike a booking notification this one is not about a booking, so it is
//! sent to **every** configured mailbox: one vendor serves both properties,
//! and an outage stops the automatic check for both.
//!
//! ## What counts as a failure
//!
//! Only "the vendor gave us no verdict":
//!
//! * [`CheckOutcome::QuotaExceeded`] — the plan's allowance is spent;
//! * [`CheckOutcome::ApiError`] — 5xx, a rotated key answering 401, a gateway
//!   in the way;
//! * [`CheckOutcome::Timeout`] — the request never came back.
//!
//! [`CheckOutcome::Answered`] covers *both* "this slip is good" and "this
//! slip is bad": a verdict means the vendor is up, and a run of guests
//! uploading blurry photographs must never read as an outage.
//!
//! ## Why one failure is not an outage — except for quota
//!
//! A single 5xx costs one slip a trip through the manual queue, which is
//! where every slip goes in shadow mode anyway. Alerting on it would train
//! the desk to ignore the alert. So `api_error` and `timeout` need
//! [`SlipokConfig::degrade_failure_threshold`] consecutive misses (default 3).
//!
//! A **quota** refusal degrades immediately. Quota does not recover on retry:
//! every subsequent slip this month will be refused the same way, and the
//! sooner the desk knows the automatic check is off, the better.
//!
//! ## Why a recovery notice needs a matching alert
//!
//! `announced` on the state row records whether *this* episode's alert
//! actually went out. A recovery notice is sent only when it did. Two
//! reasons: an "it's back" for an outage nobody was told about is pure noise,
//! and it is what makes the cooldown hold — a vendor flapping every ninety
//! seconds produces at most one alert and one recovery per cooldown window,
//! not forty of each.
//!
//! ## sqlx note
//!
//! Runtime `sqlx::query` rather than the compile-time macros, the same choice
//! and the same reason as `services::booking_notify` and
//! `routes::admin_slips::get_slip`: both tables are new in migration
//! `20260915020000_slipok_health.sql`, and a runtime query needs no `.sqlx/`
//! offline-cache entry and cannot go stale against one.

use std::collections::BTreeSet;
use std::sync::Arc;

use axum_prometheus::metrics::counter;
use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, Utc};
use sqlx::{PgPool, Row};
use tracing::{info, warn};

use crate::config::{Settings, QUOTA_WARNING_PERCENT};
use crate::error::AppError;
use crate::services::email::{EmailService, EmailServiceImpl};

/// `slipok_health_alerts_total{kind,outcome}` — one line per alert this
/// module decides to send. `kind` is `degraded` | `recovered` |
/// `quota_warning`; `outcome` is `sent` | `failed` | `skipped_no_recipient`
/// | `skipped_unconfigured`.
const SLIPOK_HEALTH_ALERTS_TOTAL: &str = "slipok_health_alerts_total";

fn count(kind: &'static str, outcome: &'static str) {
    counter!(SLIPOK_HEALTH_ALERTS_TOTAL, "kind" => kind, "outcome" => outcome).increment(1);
}

/// Asia/Bangkok, the hotel's and the vendor's calendar. No DST, so a fixed
/// offset is the whole truth rather than an approximation.
const BANGKOK_OFFSET_SECS: i32 = 7 * 3600;

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/// What one call to SlipOK told us about *SlipOK* (not about the slip).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckOutcome {
    /// The vendor answered. Verified or refused — either way it is up.
    Answered,
    /// The vendor refused on quota (HTTP 429, or the documented code 1008).
    QuotaExceeded,
    /// An HTTP-level failure: 5xx, 401 on a rotated key, a proxy in the way.
    ApiError,
    /// The request never came back inside the client's timeout.
    Timeout,
}

impl CheckOutcome {
    /// True when the vendor gave no verdict.
    pub fn is_failure(self) -> bool {
        !matches!(self, Self::Answered)
    }

    /// The `slipok_reason` vocabulary word for this outcome, or `None` when
    /// the vendor answered. These are the same strings
    /// `routes::bookings::slipok_check` writes onto the slip, so the alert
    /// and the slip row say the same word.
    pub fn reason(self) -> Option<&'static str> {
        match self {
            Self::Answered => None,
            Self::QuotaExceeded => Some("quota_exceeded"),
            Self::ApiError => Some("api_error"),
            Self::Timeout => Some("timeout"),
        }
    }

    /// Quota is the one failure that does not wait for a threshold.
    fn degrades_immediately(self) -> bool {
        matches!(self, Self::QuotaExceeded)
    }

    /// Classify the result of a verification call.
    ///
    /// `Err` is a transport failure — the same split
    /// `routes::bookings::slipok_check` makes when it records the reason.
    /// `Ok` still needs inspecting: a quota refusal and a vendor 5xx both
    /// arrive as a perfectly ordinary `Ok(SlipVerificationResult)`.
    pub fn classify(
        result: &Result<super::slipok::SlipVerificationResult, AppError>,
    ) -> Option<Self> {
        use super::slipok::VerificationStatus;

        match result {
            Err(AppError::ExternalServiceTimeout(_)) => Some(Self::Timeout),
            Err(_) => Some(Self::ApiError),
            Ok(verification) => match verification.status {
                VerificationStatus::QuotaExceeded => Some(Self::QuotaExceeded),
                VerificationStatus::ApiError => {
                    // `NOT_CONFIGURED` is this process having no credentials,
                    // not the vendor being down. Nothing was sent, so nothing
                    // is counted and nobody is alerted.
                    if verification.error_code.as_deref() == Some("NOT_CONFIGURED") {
                        None
                    } else {
                        Some(Self::ApiError)
                    }
                },
                VerificationStatus::Verified | VerificationStatus::Failed => Some(Self::Answered),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// State machine (pure)
// ---------------------------------------------------------------------------

/// The current degradation episode, as stored in the `slipok_health`
/// singleton row.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HealthState {
    /// Failures since the last answer from the vendor.
    pub consecutive_failures: i32,
    /// Whether the automatic check is currently standing aside.
    pub degraded: bool,
    /// When the current episode began.
    pub degraded_since: Option<DateTime<Utc>>,
    /// Why it began — one of the [`CheckOutcome::reason`] words.
    pub degraded_reason: Option<String>,
    /// Whether the desk was actually told about the current episode.
    pub announced: bool,
    /// Cooldown anchor: when the last degradation alert went out.
    pub last_alert_at: Option<DateTime<Utc>>,
    /// When the last recovery notice went out.
    pub last_recovery_at: Option<DateTime<Utc>>,
}

/// How aggressively to degrade and how often to say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DegradePolicy {
    /// Consecutive no-verdict answers before degrading (quota ignores it).
    pub failure_threshold: u32,
    /// Minimum gap between two degradation alerts.
    pub cooldown: Duration,
}

impl DegradePolicy {
    /// The policy the running configuration asks for.
    pub fn from_settings(settings: &Settings) -> Self {
        Self {
            failure_threshold: settings.slipok.degrade_failure_threshold(),
            cooldown: Duration::minutes(i64::from(settings.slipok.degrade_alert_cooldown_mins())),
        }
    }
}

/// A message this module has decided to send. One per transition, never two.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Alert {
    /// The automatic check has stopped working; slips are queued for a human.
    Degraded {
        reason: &'static str,
        consecutive_failures: i32,
    },
    /// It is working again.
    Recovered {
        degraded_since: Option<DateTime<Utc>>,
    },
    /// We have spent [`QUOTA_WARNING_PERCENT`] % of the month's allowance.
    QuotaWarning { used: i64, quota: i64 },
}

impl Alert {
    /// Metric label.
    fn kind(&self) -> &'static str {
        match self {
            Self::Degraded { .. } => "degraded",
            Self::Recovered { .. } => "recovered",
            Self::QuotaWarning { .. } => "quota_warning",
        }
    }
}

/// The next state, plus the one alert (if any) the move earned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transition {
    pub next: HealthState,
    pub alert: Option<Alert>,
}

/// Fold one call outcome into the episode state.
///
/// Pure: no clock, no database, no email. `now` and `policy` are parameters
/// precisely so every branch is a table-driven unit test rather than a
/// sixty-minute integration wait.
pub fn next_state(
    current: &HealthState,
    outcome: CheckOutcome,
    now: DateTime<Utc>,
    policy: DegradePolicy,
) -> Transition {
    let mut next = current.clone();

    let Some(reason) = outcome.reason() else {
        // The vendor answered. Any verdict — including "this slip is bad" —
        // clears the run of failures.
        next.consecutive_failures = 0;
        if !current.degraded {
            return Transition { next, alert: None };
        }

        let announced = current.announced;
        next.degraded = false;
        next.degraded_since = None;
        next.degraded_reason = None;
        next.announced = false;
        if announced {
            next.last_recovery_at = Some(now);
        }

        return Transition {
            next,
            alert: announced.then_some(Alert::Recovered {
                degraded_since: current.degraded_since,
            }),
        };
    };

    next.consecutive_failures = current.consecutive_failures.saturating_add(1);

    if current.degraded {
        // Already down and already (possibly) announced. Nothing more to say
        // until it comes back — this is the branch that makes "repeated
        // failures send none" true.
        return Transition { next, alert: None };
    }

    let threshold = i32::try_from(policy.failure_threshold).unwrap_or(i32::MAX);
    if !outcome.degrades_immediately() && next.consecutive_failures < threshold {
        // A blip. The slip is already in the manual queue; nobody is paged.
        return Transition { next, alert: None };
    }

    next.degraded = true;
    next.degraded_since = Some(now);
    next.degraded_reason = Some(reason.to_string());

    // Cooldown. A vendor that flaps cannot spend the desk's attention.
    let cooled_down = current
        .last_alert_at
        .map_or(true, |last| now - last >= policy.cooldown);
    if !cooled_down {
        next.announced = false;
        return Transition { next, alert: None };
    }

    next.announced = true;
    next.last_alert_at = Some(now);
    let consecutive_failures = next.consecutive_failures;
    Transition {
        next,
        alert: Some(Alert::Degraded {
            reason,
            consecutive_failures,
        }),
    }
}

/// Is the 80 %-of-quota warning due?
///
/// `None` for `quota` means the owner has not recorded the plan's allowance
/// yet (task A3), and an unknown ceiling is a silent one. `already_warned`
/// is this calendar month's stamp — the warning fires once per month, not
/// once per check after the line is crossed.
pub fn quota_warning_due(used: i64, quota: Option<i64>, already_warned: bool) -> bool {
    match quota {
        Some(quota) if quota > 0 && !already_warned => used * 100 >= quota * QUOTA_WARNING_PERCENT,
        _ => false,
    }
}

/// First day of `now`'s month in Asia/Bangkok.
///
/// The quota is a Thai vendor's calendar month. Bucketing by UTC would file
/// the first seven hours of every month under the previous one, which at the
/// turn of a month is exactly when the counter matters.
pub fn bangkok_month(now: DateTime<Utc>) -> NaiveDate {
    let offset = FixedOffset::east_opt(BANGKOK_OFFSET_SECS).expect("Bangkok offset is in range");
    let local = now.with_timezone(&offset).date_naive();
    NaiveDate::from_ymd_opt(local.year(), local.month(), 1).unwrap_or(local)
}

// ---------------------------------------------------------------------------
// Recorder: the handle the SlipOK client holds
// ---------------------------------------------------------------------------

/// What `services::slipok` needs in order to report a call's outcome.
///
/// Built once in `AppState::new` and handed to the client, so the tracker
/// observes **every** SlipOK call — the booking upload path and the
/// deposit-link path alike — without either route handler knowing it exists.
#[derive(Clone)]
pub struct SlipokHealthRecorder {
    db: PgPool,
    config: Arc<Settings>,
}

// Hand-written: `Settings` carries the SMTP password and the API key, and a
// derived `Debug` on the struct that owns it is how those reach a log line.
impl std::fmt::Debug for SlipokHealthRecorder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SlipokHealthRecorder")
    }
}

impl SlipokHealthRecorder {
    pub fn new(db: PgPool, config: Arc<Settings>) -> Self {
        Self { db, config }
    }

    /// Record one call outcome. Never fails, never blocks the caller: the
    /// guest's upload response is already decided by the time this runs, and
    /// a tracker that could break a slip upload would be worse than no
    /// tracker at all.
    pub fn record(&self, outcome: CheckOutcome) {
        let db = self.db.clone();
        let config = Arc::clone(&self.config);
        tokio::spawn(async move {
            let email =
                EmailServiceImpl::from_smtp_config(&config.email.smtp, &config.server.frontend_url);
            record_with_service(&db, &config, &email, outcome, Utc::now()).await;
        });
    }
}

// ---------------------------------------------------------------------------
// The awaited path
// ---------------------------------------------------------------------------

/// [`SlipokHealthRecorder::record`], awaited, against a caller-supplied
/// service and clock. Returns the alerts it decided to send, in order.
///
/// This is the test seam: the integration tests drive a recording fake
/// through it, so "one alert, then none, then one recovery" is an assertion
/// rather than a sixty-minute wait beside an SMTP server.
pub async fn record_with_service(
    db: &PgPool,
    config: &Settings,
    email: &dyn EmailService,
    outcome: CheckOutcome,
    now: DateTime<Utc>,
) -> Vec<Alert> {
    let mut alerts = Vec::new();

    match apply_outcome(db, config, outcome, now).await {
        Ok(Some(alert)) => alerts.push(alert),
        Ok(None) => {},
        Err(e) => warn!(
            error = %e,
            "slipok health state could not be updated; no alert was decided"
        ),
    }

    // Usage is counted for every call that actually reached the vendor,
    // degraded or not — including the refusals, because a refused call is
    // still a call the plan may have metered. Counting only successes would
    // undercount exactly when the number matters.
    match count_check(db, config, now).await {
        Ok(Some(alert)) => alerts.push(alert),
        Ok(None) => {},
        Err(e) => warn!(
            error = %e,
            "slipok monthly usage could not be counted; no quota warning was decided"
        ),
    }

    for alert in &alerts {
        send(config, email, alert).await;
    }

    alerts
}

/// Load the singleton under a row lock, fold in the outcome, store it back.
///
/// One transaction with `FOR UPDATE` because two slips can fail in the same
/// millisecond, and "ONE alert" has to survive that: without the lock both
/// callers would read `degraded = false` and both would send.
async fn apply_outcome(
    db: &PgPool,
    config: &Settings,
    outcome: CheckOutcome,
    now: DateTime<Utc>,
) -> Result<Option<Alert>, AppError> {
    let mut tx = db.begin().await?;

    // The migration seeds row 1; the upsert is here so a database that
    // somehow lacks it converges rather than silently never alerting.
    sqlx::query("INSERT INTO slipok_health (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        .execute(&mut *tx)
        .await?;

    let row = sqlx::query(
        "SELECT consecutive_failures, degraded, degraded_since, degraded_reason, \
                announced, last_alert_at, last_recovery_at \
         FROM slipok_health WHERE id = 1 FOR UPDATE",
    )
    .fetch_one(&mut *tx)
    .await?;

    let current = HealthState {
        consecutive_failures: row.try_get("consecutive_failures")?,
        degraded: row.try_get("degraded")?,
        degraded_since: row.try_get("degraded_since")?,
        degraded_reason: row.try_get("degraded_reason")?,
        announced: row.try_get("announced")?,
        last_alert_at: row.try_get("last_alert_at")?,
        last_recovery_at: row.try_get("last_recovery_at")?,
    };

    let transition = next_state(&current, outcome, now, DegradePolicy::from_settings(config));

    sqlx::query(
        "UPDATE slipok_health \
         SET consecutive_failures = $1, degraded = $2, degraded_since = $3, \
             degraded_reason = $4, announced = $5, last_alert_at = $6, \
             last_recovery_at = $7, updated_at = NOW() \
         WHERE id = 1",
    )
    .bind(transition.next.consecutive_failures)
    .bind(transition.next.degraded)
    .bind(transition.next.degraded_since)
    .bind(transition.next.degraded_reason.as_deref())
    .bind(transition.next.announced)
    .bind(transition.next.last_alert_at)
    .bind(transition.next.last_recovery_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(transition.alert)
}

/// Count this check against the month, and decide whether the 80 % warning
/// is due.
///
/// The `WHERE quota_alert_sent_at IS NULL` on the stamp is what makes it once
/// per month under concurrency: two checks crossing the line together both
/// see the same count, both think the warning is due, and exactly one UPDATE
/// returns a row.
async fn count_check(
    db: &PgPool,
    config: &Settings,
    now: DateTime<Utc>,
) -> Result<Option<Alert>, AppError> {
    let month = bangkok_month(now);

    let row = sqlx::query(
        "INSERT INTO slipok_monthly_usage (month, checks) VALUES ($1, 1) \
         ON CONFLICT (month) DO UPDATE \
            SET checks = slipok_monthly_usage.checks + 1, updated_at = NOW() \
         RETURNING checks, quota_alert_sent_at",
    )
    .bind(month)
    .fetch_one(db)
    .await?;

    let used: i64 = row.try_get("checks")?;
    let already_warned: Option<DateTime<Utc>> = row.try_get("quota_alert_sent_at")?;
    let quota = config.slipok.monthly_quota();

    if !quota_warning_due(used, quota, already_warned.is_some()) {
        return Ok(None);
    }

    // Claim the month's warning. Losing this race means another check is
    // already sending it.
    let claimed = sqlx::query(
        "UPDATE slipok_monthly_usage SET quota_alert_sent_at = $2 \
         WHERE month = $1 AND quota_alert_sent_at IS NULL \
         RETURNING month",
    )
    .bind(month)
    .bind(now)
    .fetch_optional(db)
    .await?;

    Ok(claimed.map(|_| Alert::QuotaWarning {
        used,
        quota: quota.unwrap_or_default(),
    }))
}

// ---------------------------------------------------------------------------
// Rendering and delivery
// ---------------------------------------------------------------------------

/// Every configured property mailbox, deduplicated and in a stable order.
///
/// Both properties share one vendor account, so an outage is everyone's news.
/// Deduplicated because the two variables may legitimately hold the same
/// address, and the desk should not get the same alert twice.
fn recipients(config: &Settings) -> Vec<String> {
    config
        .booking_notify
        .configured_mailboxes()
        .into_iter()
        .map(|(_, address)| address.to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Thai-first copy. The desk reads Thai; the English line underneath is for
/// whoever is on call.
///
/// The vendor is never named, matching the rule `services::booking_notify`
/// follows for every message that leaves this backend. Nothing interpolated
/// here is user-controlled — the reason is one of a closed set of `&'static
/// str`, the rest are integers — so there is no escaping to do.
fn render(alert: &Alert) -> (String, String) {
    match alert {
        Alert::Degraded {
            reason,
            consecutive_failures,
        } => {
            let (thai_why, english_why) = reason_copy(reason);
            (
                "ระบบตรวจสลิปอัตโนมัติหยุดทำงาน — สลิปรอพนักงานตรวจ".to_string(),
                format!(
                    "<p><strong>ระบบตรวจสลิปอัตโนมัติหยุดทำงานชั่วคราว</strong></p>\
                     <p>สลิปที่ลูกค้าส่งเข้ามาจะ<strong>ไม่ถูกตรวจอัตโนมัติ</strong> \
                     และจะเข้าคิวรอพนักงานตรวจสอบด้วยตนเองตามปกติ \
                     การจองและการอัปโหลดสลิปยังทำงานได้ตามเดิม ไม่มีสลิปสูญหาย</p>\
                     <p>สาเหตุ: {thai_why} (ไม่ได้รับคำตอบติดต่อกัน {failures} ครั้ง)</p>\
                     <p>สิ่งที่ต้องทำ: ตรวจสลิปในหน้าจัดการการจองด้วยตนเองจนกว่าจะมีอีเมลแจ้งว่าระบบกลับมาทำงานแล้ว</p>\
                     <hr><p>Automatic slip checking is temporarily unavailable \
                     ({english_why}; {failures} consecutive no-verdict responses). \
                     Slips are queued for manual verification as usual — nothing is lost. \
                     A recovery email follows when it works again.</p>",
                    failures = consecutive_failures
                ),
            )
        },
        Alert::Recovered { degraded_since } => {
            let since = degraded_since
                .map(|t| t.format("%Y-%m-%d %H:%M UTC").to_string())
                .unwrap_or_else(|| "-".to_string());
            (
                "ระบบตรวจสลิปอัตโนมัติกลับมาทำงานแล้ว".to_string(),
                format!(
                    "<p><strong>ระบบตรวจสลิปอัตโนมัติกลับมาทำงานแล้ว</strong></p>\
                     <p>สลิปที่ส่งเข้ามาใหม่จะถูกตรวจอัตโนมัติตามปกติ \
                     สลิปที่ค้างอยู่ในคิวระหว่างที่ระบบหยุดทำงาน ยังต้องให้พนักงานตรวจสอบด้วยตนเอง</p>\
                     <p>เริ่มหยุดทำงานเมื่อ: {since}</p>\
                     <hr><p>Automatic slip checking is working again (outage began {since}). \
                     Slips that queued up during the outage still need a human.</p>"
                ),
            )
        },
        Alert::QuotaWarning { used, quota } => {
            let percent = if *quota > 0 { used * 100 / quota } else { 0 };
            (
                format!("โควตาตรวจสลิปอัตโนมัติใช้ไปแล้ว {percent}%"),
                format!(
                    "<p><strong>โควตาการตรวจสลิปอัตโนมัติของเดือนนี้ใกล้หมด</strong></p>\
                     <p>ใช้ไปแล้ว {used} จาก {quota} ครั้ง (ประมาณ {percent}%)</p>\
                     <p>เมื่อโควตาหมด สลิปจะยังส่งเข้ามาได้ตามปกติ \
                     แต่จะเข้าคิวรอพนักงานตรวจสอบด้วยตนเองทั้งหมด</p>\
                     <hr><p>Automatic slip checking has used {used} of {quota} checks this month \
                     (~{percent}%). When the allowance runs out, every slip goes to the manual \
                     queue — uploads keep working.</p>"
                ),
            )
        },
    }
}

/// Thai + English wording for a `slipok_reason`.
fn reason_copy(reason: &str) -> (&'static str, &'static str) {
    match reason {
        "quota_exceeded" => (
            "โควตาการตรวจอัตโนมัติของเดือนนี้หมดแล้ว",
            "the monthly allowance is used up",
        ),
        "timeout" => (
            "ระบบตรวจสอบไม่ตอบกลับในเวลาที่กำหนด",
            "the checking service did not answer in time",
        ),
        _ => (
            "ระบบตรวจสอบแจ้งข้อผิดพลาด",
            "the checking service returned an error",
        ),
    }
}

/// Send one alert to every configured mailbox.
///
/// Unconfigured is a normal state, not a failure: a stack with no mailbox or
/// no relay logs once and moves on. The state row has already been written,
/// so an alert that could not be delivered still consumes its cooldown — a
/// deliberate trade, because retrying into a dead relay on every subsequent
/// slip is how one outage becomes a thousand log lines.
async fn send(config: &Settings, email: &dyn EmailService, alert: &Alert) {
    let kind = alert.kind();

    if !email.is_configured() {
        count(kind, "skipped_unconfigured");
        info!(
            alert = kind,
            "SMTP not configured; slipok health alert not sent"
        );
        return;
    }

    let to = recipients(config);
    if to.is_empty() {
        count(kind, "skipped_no_recipient");
        info!(
            alert = kind,
            "no property mailbox configured; slipok health alert not sent"
        );
        return;
    }

    let (subject, html) = render(alert);
    for address in to {
        match email.send_email(&address, &subject, &html).await {
            Ok(()) => {
                count(kind, "sent");
                info!(alert = kind, "slipok health alert sent");
            },
            Err(e) => {
                count(kind, "failed");
                warn!(alert = kind, error = %e, "slipok health alert could not be sent");
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> DegradePolicy {
        DegradePolicy {
            failure_threshold: 3,
            cooldown: Duration::minutes(60),
        }
    }

    fn at(minute: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_780_000_000 + minute * 60, 0).expect("timestamp in range")
    }

    /// Drive a sequence of outcomes through the machine, collecting the
    /// alerts it decided to send. `(minute, outcome)` pairs so a test can
    /// place a failure inside or outside the cooldown.
    fn run(steps: &[(i64, CheckOutcome)]) -> (HealthState, Vec<Alert>) {
        let mut state = HealthState::default();
        let mut alerts = Vec::new();
        for (minute, outcome) in steps {
            let transition = next_state(&state, *outcome, at(*minute), policy());
            state = transition.next;
            if let Some(alert) = transition.alert {
                alerts.push(alert);
            }
        }
        (state, alerts)
    }

    #[test]
    fn a_single_api_error_is_a_blip_not_an_outage() {
        let (state, alerts) = run(&[(0, CheckOutcome::ApiError)]);
        assert!(alerts.is_empty(), "one failure must not alert");
        assert!(!state.degraded);
        assert_eq!(state.consecutive_failures, 1);
    }

    #[test]
    fn an_answer_between_failures_clears_the_run() {
        // Two misses, an answer, two misses: never three in a row, so the
        // threshold is never reached.
        let (state, alerts) = run(&[
            (0, CheckOutcome::ApiError),
            (1, CheckOutcome::Timeout),
            (2, CheckOutcome::Answered),
            (3, CheckOutcome::ApiError),
            (4, CheckOutcome::Timeout),
        ]);
        assert!(alerts.is_empty());
        assert!(!state.degraded);
        assert_eq!(state.consecutive_failures, 2);
    }

    /// A slip SlipOK read and refused is not an outage. Without this, a
    /// guest uploading three blurry photographs would page the desk.
    #[test]
    fn a_refused_slip_counts_as_the_vendor_being_up() {
        let (state, alerts) = run(&[
            (0, CheckOutcome::Answered),
            (1, CheckOutcome::Answered),
            (2, CheckOutcome::Answered),
        ]);
        assert!(alerts.is_empty());
        assert!(!state.degraded);
    }

    #[test]
    fn the_third_consecutive_failure_degrades_and_alerts_exactly_once() {
        let (state, alerts) = run(&[
            (0, CheckOutcome::ApiError),
            (1, CheckOutcome::ApiError),
            (2, CheckOutcome::ApiError),
        ]);
        assert_eq!(
            alerts,
            vec![Alert::Degraded {
                reason: "api_error",
                consecutive_failures: 3,
            }]
        );
        assert!(state.degraded);
        assert!(state.announced);
        assert_eq!(state.last_alert_at, Some(at(2)));
    }

    /// The requirement in one test: transition in sends one alert, the
    /// failures that follow send none.
    #[test]
    fn repeated_failures_after_degrading_send_nothing() {
        let steps: Vec<(i64, CheckOutcome)> =
            (0..40).map(|i| (i, CheckOutcome::ApiError)).collect();
        let (state, alerts) = run(&steps);
        assert_eq!(alerts.len(), 1, "an outage is one alert, not forty");
        assert!(state.degraded);
        assert_eq!(state.consecutive_failures, 40);
    }

    /// Quota does not wait for the threshold: it will not fix itself, and
    /// every remaining slip this month is going to the manual queue.
    #[test]
    fn quota_exhaustion_degrades_on_the_first_refusal() {
        let (state, alerts) = run(&[(0, CheckOutcome::QuotaExceeded)]);
        assert_eq!(
            alerts,
            vec![Alert::Degraded {
                reason: "quota_exceeded",
                consecutive_failures: 1,
            }]
        );
        assert_eq!(state.degraded_reason.as_deref(), Some("quota_exceeded"));
    }

    #[test]
    fn the_first_answer_after_an_outage_sends_one_recovery() {
        let (state, alerts) = run(&[
            (0, CheckOutcome::QuotaExceeded),
            (1, CheckOutcome::Answered),
            (2, CheckOutcome::Answered),
            (3, CheckOutcome::Answered),
        ]);
        assert_eq!(alerts.len(), 2, "one degraded, one recovery");
        assert_eq!(
            alerts[1],
            Alert::Recovered {
                degraded_since: Some(at(0))
            }
        );
        assert!(!state.degraded);
        assert!(!state.announced);
        assert_eq!(state.last_recovery_at, Some(at(1)));
    }

    /// The flapping case the cooldown exists for: down, up, down, up … every
    /// few minutes. Inside one cooldown window the desk hears about it once.
    #[test]
    fn a_flapping_vendor_cannot_spam_inside_the_cooldown() {
        let mut steps = vec![
            (0, CheckOutcome::QuotaExceeded),
            (1, CheckOutcome::Answered),
        ];
        for i in 1..10 {
            steps.push((i * 5, CheckOutcome::QuotaExceeded));
            steps.push((i * 5 + 1, CheckOutcome::Answered));
        }
        let (_, alerts) = run(&steps);
        assert_eq!(
            alerts,
            vec![
                Alert::Degraded {
                    reason: "quota_exceeded",
                    consecutive_failures: 1,
                },
                Alert::Recovered {
                    degraded_since: Some(at(0))
                },
            ],
            "a flapping vendor is one alert and one recovery, not nine of each"
        );
    }

    /// …and once the cooldown has elapsed, the next outage is announced
    /// again. Suppression must not be permanent.
    #[test]
    fn a_new_outage_after_the_cooldown_is_announced_again() {
        let (_, alerts) = run(&[
            (0, CheckOutcome::QuotaExceeded),
            (1, CheckOutcome::Answered),
            // 61 minutes later — past the 60-minute cooldown.
            (62, CheckOutcome::QuotaExceeded),
        ]);
        assert_eq!(alerts.len(), 3);
        assert!(matches!(alerts[2], Alert::Degraded { .. }));
    }

    /// A recovery from an outage that was never announced is silence, not a
    /// mystery "it's back" for a problem the desk never heard about.
    #[test]
    fn an_unannounced_outage_recovers_quietly() {
        let (state, alerts) = run(&[
            (0, CheckOutcome::QuotaExceeded),
            (1, CheckOutcome::Answered),
            // Suppressed by the cooldown: degraded, but not announced.
            (5, CheckOutcome::QuotaExceeded),
            (6, CheckOutcome::Answered),
        ]);
        assert_eq!(alerts.len(), 2, "only the first episode is spoken about");
        assert!(matches!(alerts[0], Alert::Degraded { .. }));
        assert!(matches!(alerts[1], Alert::Recovered { .. }));
        assert!(!state.degraded);
    }

    #[test]
    fn quota_warning_is_silent_until_the_owner_records_the_plan() {
        // A3 has not happened yet: no ceiling, no warning, however many
        // checks we have made.
        assert!(!quota_warning_due(1_000_000, None, false));
    }

    #[test]
    fn quota_warning_fires_at_eighty_percent_and_only_once() {
        assert!(!quota_warning_due(79, Some(100), false));
        assert!(quota_warning_due(80, Some(100), false));
        assert!(quota_warning_due(99, Some(100), false));
        // Already stamped for this month.
        assert!(!quota_warning_due(99, Some(100), true));
        // A nonsense ceiling is treated as unknown, not as "already spent".
        assert!(!quota_warning_due(5, Some(0), false));
    }

    #[test]
    fn the_month_bucket_follows_bangkok_not_utc() {
        // 2026-08-31 18:00 UTC is 2026-09-01 01:00 in Bangkok: September.
        let utc = DateTime::parse_from_rfc3339("2026-08-31T18:00:00Z")
            .expect("parse")
            .with_timezone(&Utc);
        assert_eq!(
            bangkok_month(utc),
            NaiveDate::from_ymd_opt(2026, 9, 1).expect("date")
        );

        // …and 16:59 UTC on the same day is still August in Bangkok.
        let utc = DateTime::parse_from_rfc3339("2026-08-31T16:59:00Z")
            .expect("parse")
            .with_timezone(&Utc);
        assert_eq!(
            bangkok_month(utc),
            NaiveDate::from_ymd_opt(2026, 8, 1).expect("date")
        );
    }

    #[test]
    fn classify_separates_our_outage_from_a_bad_slip() {
        use crate::services::slipok::{SlipVerificationResult, VerificationStatus};

        fn result(status: VerificationStatus, error_code: Option<&str>) -> SlipVerificationResult {
            SlipVerificationResult {
                success: status == VerificationStatus::Verified,
                status,
                amount: None,
                sender_name: None,
                receiver_name: None,
                receiver_proxy_value: None,
                receiver_account_value: None,
                transaction_date: None,
                transaction_id: None,
                bank_code: None,
                receiving_bank_code: None,
                error_code: error_code.map(str::to_string),
                error_message: None,
                raw_response: None,
            }
        }

        assert_eq!(
            CheckOutcome::classify(&Ok(result(VerificationStatus::Verified, None))),
            Some(CheckOutcome::Answered)
        );
        // SlipOK read the slip and said no — the vendor is up.
        assert_eq!(
            CheckOutcome::classify(&Ok(result(VerificationStatus::Failed, Some("1002")))),
            Some(CheckOutcome::Answered)
        );
        assert_eq!(
            CheckOutcome::classify(&Ok(result(VerificationStatus::QuotaExceeded, None))),
            Some(CheckOutcome::QuotaExceeded)
        );
        assert_eq!(
            CheckOutcome::classify(&Ok(result(VerificationStatus::ApiError, Some("HTTP_500")))),
            Some(CheckOutcome::ApiError)
        );
        // No credentials is our configuration, not the vendor's health, and
        // no call was made — so it is not counted against the quota either.
        assert_eq!(
            CheckOutcome::classify(&Ok(result(
                VerificationStatus::ApiError,
                Some("NOT_CONFIGURED")
            ))),
            None
        );
        assert_eq!(
            CheckOutcome::classify(&Err(AppError::ExternalServiceTimeout("SlipOK".to_string()))),
            Some(CheckOutcome::Timeout)
        );
        assert_eq!(
            CheckOutcome::classify(&Err(AppError::SlipOk("boom".to_string()))),
            Some(CheckOutcome::ApiError)
        );
    }

    /// Thai first, no vendor name, and the one thing the desk has to do.
    #[test]
    fn the_degraded_message_is_thai_first_and_names_no_vendor() {
        let (subject, html) = render(&Alert::Degraded {
            reason: "quota_exceeded",
            consecutive_failures: 1,
        });
        assert!(subject.starts_with("ระบบตรวจสลิปอัตโนมัติ"));
        assert!(html.contains("รอพนักงานตรวจ"));
        assert!(html.contains("โควตา"));
        let lowered = html.to_lowercase();
        assert!(!lowered.contains("slipok"), "the vendor is never named");
    }

    #[test]
    fn the_recovery_message_says_the_queue_still_needs_a_human() {
        let (subject, html) = render(&Alert::Recovered {
            degraded_since: None,
        });
        assert!(subject.contains("กลับมาทำงานแล้ว"));
        assert!(html.contains("ตรวจสอบด้วยตนเอง"));
    }

    #[test]
    fn the_quota_warning_reports_the_percentage_it_crossed() {
        let (subject, html) = render(&Alert::QuotaWarning {
            used: 800,
            quota: 1000,
        });
        assert!(subject.contains("80%"));
        assert!(html.contains("800"));
        assert!(html.contains("1000"));
    }
}
