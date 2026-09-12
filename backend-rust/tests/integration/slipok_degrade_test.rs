//! Integration coverage for the SlipOK degradation tracker (A4).
//!
//! The state machine itself is unit-tested in `services::slipok_health`; what
//! this file proves is the part a pure function cannot: that the *stored*
//! state in `slipok_health` / `slipok_monthly_usage` carries the episode
//! across calls, and that exactly the intended number of messages leaves the
//! building.
//!
//! The seam is the `EmailService` trait, the same choice
//! `booking_notify_test` makes and for the same reason: a recording fake
//! tests what we render and how many times, where an SMTP substitute would
//! test `lettre`.
//!
//! What is asserted:
//!
//! - the transition into degraded sends exactly one alert;
//! - repeated failures after it send none, inside the cooldown;
//! - the first answer after the outage sends exactly one recovery;
//! - the 80 %-of-quota warning fires once per month and not again;
//! - with no `SLIPOK_MONTHLY_QUOTA` recorded (production today) no quota
//!   warning can fire however many checks are made;
//! - the alert goes to every configured property mailbox and names no
//!   vendor;
//! - a stack with no mailbox degrades silently rather than raising.

use std::sync::Mutex;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};

use loyalty_backend::error::AppError;
use loyalty_backend::services::slipok_health::{record_with_service, CheckOutcome};
use loyalty_backend::services::EmailService;
use loyalty_backend::Settings;

use crate::common::{test_app_state_config, TestApp};

const HF_MAILBOX: &str = "hf-desk@example.com";
const HFVILLE_MAILBOX: &str = "hfville-desk@example.com";

// ============================================================================
// Recording fake
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
struct SentEmail {
    to: String,
    subject: String,
    html_body: String,
}

/// Records every `send_email`. Deliberately the whole message, not just a
/// count: "one alert" is only half the requirement — the other half is that
/// it tells the desk what to do.
struct RecordingEmailService {
    sent: Mutex<Vec<SentEmail>>,
}

impl RecordingEmailService {
    fn new() -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
        }
    }

    fn sent(&self) -> Vec<SentEmail> {
        self.sent.lock().expect("recording fake lock").clone()
    }

    fn subjects(&self) -> Vec<String> {
        self.sent().into_iter().map(|m| m.subject).collect()
    }
}

#[async_trait]
impl EmailService for RecordingEmailService {
    async fn send_email(&self, to: &str, subject: &str, html_body: &str) -> Result<(), AppError> {
        self.sent
            .lock()
            .expect("recording fake lock")
            .push(SentEmail {
                to: to.to_string(),
                subject: subject.to_string(),
                html_body: html_body.to_string(),
            });
        Ok(())
    }

    async fn send_password_reset_email(&self, _to: &str, _token: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_welcome_email(&self, _to: &str, _name: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_verification_email(&self, _to: &str, _code: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_registration_verification_email(
        &self,
        _to: &str,
        _code: &str,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn is_configured(&self) -> bool {
        true
    }

    async fn verify_connection(&self) -> Result<bool, AppError> {
        Ok(true)
    }

    fn generate_verification_code(&self) -> String {
        "000000".to_string()
    }
}

/// A service that reports itself unconfigured, i.e. a stack with no relay.
struct NoRelayEmailService;

#[async_trait]
impl EmailService for NoRelayEmailService {
    async fn send_email(&self, _to: &str, _subject: &str, _html: &str) -> Result<(), AppError> {
        panic!("an unconfigured relay must never be asked to send");
    }

    async fn send_password_reset_email(&self, _to: &str, _token: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_welcome_email(&self, _to: &str, _name: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_verification_email(&self, _to: &str, _code: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send_registration_verification_email(
        &self,
        _to: &str,
        _code: &str,
    ) -> Result<(), AppError> {
        Ok(())
    }

    fn is_configured(&self) -> bool {
        false
    }

    async fn verify_connection(&self) -> Result<bool, AppError> {
        Ok(false)
    }

    fn generate_verification_code(&self) -> String {
        "000000".to_string()
    }
}

// ============================================================================
// Fixtures
// ============================================================================

/// Both mailboxes set, a three-failure threshold and a one-hour cooldown —
/// the defaults, written out so a test reads without cross-referencing.
fn config_with_mailboxes() -> Settings {
    let mut config = test_app_state_config();
    config.booking_notify.hf = Some(HF_MAILBOX.to_string());
    config.booking_notify.hfville = Some(HFVILLE_MAILBOX.to_string());
    config.slipok.degrade_failure_threshold = Some("3".to_string());
    config.slipok.degrade_alert_cooldown_mins = Some("60".to_string());
    config
}

/// A fixed clock. Every test places its calls on this line by hand, so the
/// cooldown is exercised without anybody waiting an hour.
fn at(minute: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_789_000_000, 0).expect("timestamp in range")
        + Duration::minutes(minute)
}

/// How many checks `slipok_monthly_usage` has counted this month.
///
/// The cast is load-bearing: Postgres widens `SUM` over a `BIGINT` to
/// `NUMERIC`, which sqlx will not decode into an `i64`.
async fn checks_counted(pool: &sqlx::PgPool) -> i64 {
    sqlx::query_scalar("SELECT COALESCE(SUM(checks), 0)::BIGINT FROM slipok_monthly_usage")
        .fetch_one(pool)
        .await
        .expect("read monthly usage")
}

/// The stored episode, as the next call will read it.
async fn stored_state(pool: &sqlx::PgPool) -> (i32, bool, bool) {
    sqlx::query_as(
        "SELECT consecutive_failures, degraded, announced FROM slipok_health WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .expect("read slipok_health row")
}

// ============================================================================
// Cases
// ============================================================================

/// The headline requirement, end to end against the real tables: one alert
/// on the way down, silence while it stays down, one notice on the way back.
#[tokio::test]
async fn one_alert_down_silence_while_down_one_notice_back_up() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();
    let email = RecordingEmailService::new();

    // Two misses is a blip, not an outage.
    for minute in 0..2 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::ApiError,
            at(minute),
        )
        .await;
    }
    assert!(
        email.sent().is_empty(),
        "two failures are below the threshold; nobody is told"
    );
    assert_eq!(stored_state(app.db()).await, (2, false, false));

    // The third trips it — one alert, to each configured mailbox.
    record_with_service(app.db(), &config, &email, CheckOutcome::ApiError, at(2)).await;
    let after_degrade = email.sent();
    assert_eq!(
        after_degrade.len(),
        2,
        "one alert, delivered to each of the two mailboxes"
    );
    let recipients: Vec<&str> = after_degrade.iter().map(|m| m.to.as_str()).collect();
    assert_eq!(recipients, vec![HF_MAILBOX, HFVILLE_MAILBOX]);
    assert!(after_degrade[0].subject.contains("รอพนักงานตรวจ"));
    assert!(after_degrade[0].html_body.contains("รอพนักงานตรวจ"));
    assert_eq!(stored_state(app.db()).await, (3, true, true));

    // Thirty more failures inside the cooldown say nothing at all.
    for minute in 3..33 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::ApiError,
            at(minute),
        )
        .await;
    }
    assert_eq!(
        email.sent().len(),
        2,
        "an outage is one alert, however long it lasts"
    );

    // The first answer brings exactly one recovery notice per mailbox.
    record_with_service(app.db(), &config, &email, CheckOutcome::Answered, at(40)).await;
    let all = email.sent();
    assert_eq!(all.len(), 4, "two mailboxes × (one alert + one recovery)");
    assert!(all[2].subject.contains("กลับมาทำงานแล้ว"));
    assert!(all[3].subject.contains("กลับมาทำงานแล้ว"));
    assert_eq!(stored_state(app.db()).await, (0, false, false));

    // …and the answers that follow are silent.
    for minute in 41..45 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::Answered,
            at(minute),
        )
        .await;
    }
    assert_eq!(email.sent().len(), 4, "a healthy vendor sends nothing");

    app.cleanup().await.expect("cleanup");
}

/// The cooldown delays an alert; it must never cancel one — asserted across
/// the *stored* episode, because that is where it went wrong: `announced`
/// survives in `slipok_health` between calls, and nothing used to
/// re-evaluate it once an episode had been suppressed.
///
/// The sequence that used to go permanently silent: announce, recover, go
/// down again inside the cooldown, and stay down. Every later failure
/// short-circuited on `degraded`, so hours past the cooldown nothing had
/// been said — the desk's last message read "recovered" while every slip
/// queued for manual review — and the eventual recovery was silent too,
/// because a recovery notice is only sent for an announced episode. A quota
/// exhaustion landing in that window was swallowed for the rest of the
/// month.
#[tokio::test]
async fn a_suppressed_outage_that_stays_down_is_announced_after_the_cooldown() {
    let app = TestApp::new().await.expect("test app");
    let mut config = config_with_mailboxes();
    // One mailbox, so each event is exactly one message.
    config.booking_notify.hfville = None;
    let email = RecordingEmailService::new();

    // Episode one: announced, then recovered.
    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::QuotaExceeded,
        at(0),
    )
    .await;
    record_with_service(app.db(), &config, &email, CheckOutcome::Answered, at(1)).await;
    assert_eq!(email.sent().len(), 2, "one alert, one recovery");

    // Episode two starts inside the 60-minute cooldown: degraded, suppressed.
    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::QuotaExceeded,
        at(5),
    )
    .await;
    assert_eq!(email.sent().len(), 2, "suppressed by the cooldown");
    assert_eq!(
        stored_state(app.db()).await,
        (1, true, false),
        "degraded, and knowingly un-announced"
    );

    // …and it stays down. Still nothing while the cooldown holds.
    for minute in [10, 20, 30, 50, 59] {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::QuotaExceeded,
            at(minute),
        )
        .await;
    }
    assert_eq!(email.sent().len(), 2, "still inside the cooldown");

    // The first failure past the cooldown says it — once.
    for minute in [61, 62, 63, 70] {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::QuotaExceeded,
            at(minute),
        )
        .await;
    }
    let after = email.sent();
    assert_eq!(
        after.len(),
        3,
        "exactly one late alert, not one per failure — got {:?}",
        email.subjects()
    );
    assert!(after[2].subject.contains("รอพนักงานตรวจ"));
    let (_, degraded, announced) = stored_state(app.db()).await;
    assert!(degraded, "still degraded");
    assert!(
        announced,
        "and now announced, so the recovery will be heard"
    );

    // And because it was announced, the recovery is announced too — the desk
    // is never left with "recovered" as the last thing it heard.
    record_with_service(app.db(), &config, &email, CheckOutcome::Answered, at(80)).await;
    assert_eq!(
        email.subjects(),
        vec![
            "ระบบตรวจสลิปอัตโนมัติหยุดทำงาน — สลิปรอพนักงานตรวจ".to_string(),
            "ระบบตรวจสลิปอัตโนมัติกลับมาทำงานแล้ว".to_string(),
            "ระบบตรวจสลิปอัตโนมัติหยุดทำงาน — สลิปรอพนักงานตรวจ".to_string(),
            "ระบบตรวจสลิปอัตโนมัติกลับมาทำงานแล้ว".to_string(),
        ]
    );
    assert_eq!(stored_state(app.db()).await, (0, false, false));

    app.cleanup().await.expect("cleanup");
}

/// Quota does not wait for the threshold: the first refusal is the outage.
#[tokio::test]
async fn a_quota_refusal_degrades_on_the_first_one() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();
    let email = RecordingEmailService::new();

    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::QuotaExceeded,
        at(0),
    )
    .await;

    assert_eq!(email.sent().len(), 2, "one alert to each mailbox");
    assert!(email.sent()[0].html_body.contains("โควตา"));
    assert_eq!(stored_state(app.db()).await, (1, true, true));

    app.cleanup().await.expect("cleanup");
}

/// A slip SlipOK read and refused is not an outage. Without this, three
/// guests uploading unreadable photographs would page the desk.
#[tokio::test]
async fn a_run_of_bad_slips_never_looks_like_an_outage() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();
    let email = RecordingEmailService::new();

    for minute in 0..10 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::Answered,
            at(minute),
        )
        .await;
    }

    assert!(email.sent().is_empty());
    assert_eq!(stored_state(app.db()).await, (0, false, false));
    assert_eq!(checks_counted(app.db()).await, 10);

    app.cleanup().await.expect("cleanup");
}

/// Production today: the owner has not recorded the plan's allowance (A3),
/// so no number of checks can produce a quota warning.
#[tokio::test]
async fn no_quota_warning_until_the_owner_records_the_allowance() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();
    assert!(
        config.slipok.monthly_quota().is_none(),
        "the fixture must start with no quota, like production"
    );
    let email = RecordingEmailService::new();

    for minute in 0..50 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::Answered,
            at(minute),
        )
        .await;
    }

    assert!(
        email.sent().is_empty(),
        "an unknown ceiling is a silent one"
    );
    assert_eq!(checks_counted(app.db()).await, 50);

    app.cleanup().await.expect("cleanup");
}

/// With a quota recorded, the warning fires as the 80 % line is crossed and
/// exactly once for that month — not on every check after it.
#[tokio::test]
async fn the_quota_warning_fires_once_per_month() {
    let app = TestApp::new().await.expect("test app");
    let mut config = config_with_mailboxes();
    config.slipok.monthly_quota = Some("10".to_string());
    let email = RecordingEmailService::new();

    // Seven checks: 70 %, still quiet.
    for minute in 0..7 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::Answered,
            at(minute),
        )
        .await;
    }
    assert!(email.sent().is_empty(), "70% is below the line");

    // The eighth crosses 80 %.
    record_with_service(app.db(), &config, &email, CheckOutcome::Answered, at(7)).await;
    let warned = email.sent();
    assert_eq!(warned.len(), 2, "one warning to each mailbox");
    assert!(warned[0].subject.contains("80%"));

    // Every check after it is silent, including the ones past 100 %.
    for minute in 8..20 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::Answered,
            at(minute),
        )
        .await;
    }
    assert_eq!(
        email.sent().len(),
        2,
        "the month's warning is claimed once, not re-sent per check"
    );

    // A new calendar month gets its own warning, from its own counter.
    let next_month = at(0) + Duration::days(40);
    for offset in 0..8 {
        record_with_service(
            app.db(),
            &config,
            &email,
            CheckOutcome::Answered,
            next_month + Duration::minutes(offset),
        )
        .await;
    }
    assert_eq!(
        email.sent().len(),
        4,
        "a new month is a new allowance and a new warning"
    );

    app.cleanup().await.expect("cleanup");
}

/// Counting is per Bangkok month. A check at 18:00 UTC on the last day of a
/// month belongs to the *next* month's allowance, because in Bangkok it is
/// already the first.
#[tokio::test]
async fn the_monthly_counter_buckets_by_bangkok_month() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();
    let email = RecordingEmailService::new();

    let last_evening = DateTime::parse_from_rfc3339("2026-08-31T18:00:00Z")
        .expect("parse")
        .with_timezone(&Utc);
    let same_day_morning = DateTime::parse_from_rfc3339("2026-08-31T06:00:00Z")
        .expect("parse")
        .with_timezone(&Utc);

    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::Answered,
        same_day_morning,
    )
    .await;
    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::Answered,
        last_evening,
    )
    .await;

    let months: Vec<(chrono::NaiveDate, i64)> =
        sqlx::query_as("SELECT month, checks FROM slipok_monthly_usage ORDER BY month")
            .fetch_all(app.db())
            .await
            .expect("read usage rows");

    assert_eq!(
        months,
        vec![
            (
                chrono::NaiveDate::from_ymd_opt(2026, 8, 1).expect("date"),
                1
            ),
            (
                chrono::NaiveDate::from_ymd_opt(2026, 9, 1).expect("date"),
                1
            ),
        ],
        "18:00 UTC on 31 August is already September in Bangkok"
    );

    app.cleanup().await.expect("cleanup");
}

/// No mailbox anywhere: the episode is still tracked (so the recovery
/// bookkeeping stays right) but nothing is sent and nothing blows up.
#[tokio::test]
async fn a_stack_with_no_mailbox_degrades_silently() {
    let app = TestApp::new().await.expect("test app");
    // `test_app_state_config` ships with no mailbox, like an unconfigured
    // deployment.
    let config = test_app_state_config();
    let email = RecordingEmailService::new();

    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::QuotaExceeded,
        at(0),
    )
    .await;

    assert!(email.sent().is_empty());
    assert_eq!(
        stored_state(app.db()).await,
        (1, true, true),
        "the episode is still recorded, so the recovery accounting stays right"
    );

    app.cleanup().await.expect("cleanup");
}

/// No relay: the tracker must not try to send, and must not panic doing it.
#[tokio::test]
async fn a_stack_with_no_relay_is_never_asked_to_send() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();

    // `NoRelayEmailService::send_email` panics if it is ever reached.
    record_with_service(
        app.db(),
        &config,
        &NoRelayEmailService,
        CheckOutcome::QuotaExceeded,
        at(0),
    )
    .await;

    assert_eq!(stored_state(app.db()).await, (1, true, true));

    app.cleanup().await.expect("cleanup");
}

/// The message has to be usable by the person who reads it: Thai, says what
/// happens to slips now, and never names the vendor.
#[tokio::test]
async fn the_alert_is_thai_first_and_names_no_vendor() {
    let app = TestApp::new().await.expect("test app");
    let config = config_with_mailboxes();
    let email = RecordingEmailService::new();

    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::QuotaExceeded,
        at(0),
    )
    .await;

    let message = email.sent().into_iter().next().expect("one alert");
    assert!(message.subject.starts_with("ระบบตรวจสลิปอัตโนมัติ"));
    // What the desk has to do about it.
    assert!(message.html_body.contains("รอพนักงานตรวจ"));
    assert!(message.html_body.contains("ไม่มีสลิปสูญหาย"));
    let lowered = message.html_body.to_lowercase();
    assert!(!lowered.contains("slipok"), "the vendor is never named");

    app.cleanup().await.expect("cleanup");
}

/// The subject lines, verbatim, so a change to the desk-facing copy is a
/// deliberate act rather than a side effect.
#[tokio::test]
async fn the_subject_lines_are_the_agreed_copy() {
    let app = TestApp::new().await.expect("test app");
    let mut config = config_with_mailboxes();
    // One mailbox, so each event is one message and the list reads cleanly.
    config.booking_notify.hfville = None;
    let email = RecordingEmailService::new();

    record_with_service(
        app.db(),
        &config,
        &email,
        CheckOutcome::QuotaExceeded,
        at(0),
    )
    .await;
    record_with_service(app.db(), &config, &email, CheckOutcome::Answered, at(1)).await;

    assert_eq!(
        email.subjects(),
        vec![
            "ระบบตรวจสลิปอัตโนมัติหยุดทำงาน — สลิปรอพนักงานตรวจ".to_string(),
            "ระบบตรวจสลิปอัตโนมัติกลับมาทำงานแล้ว".to_string(),
        ]
    );

    app.cleanup().await.expect("cleanup");
}
