//! Integration coverage for the property booking-notification email (B0:
//! `hf-tasks/tasks/direct-booking-designs/b0-booking-email-spec.md`).
//!
//! The seam under test is the `EmailService` trait, not SMTP. A wiremock SMTP
//! substitute would test `lettre`; a recording fake tests what we render, who
//! we render it to, and — the part that actually costs money if it breaks —
//! how many times.
//!
//! What is asserted:
//!
//! - a created booking sends one message, to that property's mailbox, with
//!   the guest's phone in full and no slip image or payer bank details;
//! - the same event twice sends once (retry, idempotent replay, an admin
//!   pressing Verify on an already-verified slip);
//! - a property with a blank mailbox sends nothing and raises nothing;
//! - a booking create still returns 201 when the mail relay is unreachable;
//! - two real admin verifies of the same slip leave exactly one claim row;
//! - a shadow pass and the admin confirmation that follows it are two
//!   different events and both reach the desk (this is the configuration
//!   production runs);
//! - a send that never happened hands its claim back;
//! - nothing about the slip row — its image path or its bank reference —
//!   reaches the message.

use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{header, Request};
use serde_json::Value;
use tower::ServiceExt;
use uuid::Uuid;

use loyalty_backend::error::AppError;
use loyalty_backend::services::booking_notify::{notify_with_service, BookingNotifyEvent};
use loyalty_backend::services::EmailService;
use loyalty_backend::Settings;

use crate::common::{generate_test_token_with_role, test_app_state_config, TestApp};

/// No sleeping in tests: the retry delay is a parameter precisely so the
/// suite does not spend 30 seconds proving one retry happened.
const NO_WAIT: Duration = Duration::from_millis(0);

const HF_MAILBOX: &str = "hf-desk@example.com";
const HFVILLE_MAILBOX: &str = "hfville-desk@example.com";

/// The slip image path every fixture uses. No message may contain it.
const SLIP_URL: &str = "/storage/slips/notify-test.jpg";

// ============================================================================
// Recording fake
// ============================================================================

#[derive(Debug, Clone)]
struct SentEmail {
    to: String,
    subject: String,
    html_body: String,
}

/// Records every `send_email`, and can be told to fail them.
struct RecordingEmailService {
    sent: Mutex<Vec<SentEmail>>,
    configured: bool,
    fail: bool,
}

impl RecordingEmailService {
    fn new() -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            configured: true,
            fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            configured: true,
            fail: true,
        }
    }

    fn sent(&self) -> Vec<SentEmail> {
        self.sent.lock().expect("recording fake lock").clone()
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
        if self.fail {
            return Err(AppError::Internal("relay refused the message".to_string()));
        }
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
        self.configured
    }

    async fn verify_connection(&self) -> Result<bool, AppError> {
        Ok(self.configured)
    }

    fn generate_verification_code(&self) -> String {
        "TEST-CODE".to_string()
    }
}

// ============================================================================
// Fixtures
// ============================================================================

/// Settings with both property mailboxes set.
fn config_with_mailboxes() -> Settings {
    let mut config = test_app_state_config();
    config.booking_notify.hf = Some(HF_MAILBOX.to_string());
    config.booking_notify.hfville = Some(HFVILLE_MAILBOX.to_string());
    config
}

/// A booking awaiting payment, the shape a slip is uploaded against.
///
/// `pms_booking_id` is optional on purpose: a booking that carries one makes
/// `slip_confirm` post a payment event to the PMS, which is not configured in
/// this suite. Tests that drive the notifier directly seed the channel shape;
/// the one that drives the real admin verify route seeds a desk booking.
async fn seed_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    property: &str,
    pms_booking_id: Option<String>,
) -> Uuid {
    let booking_id = Uuid::new_v4();
    let today = chrono::Utc::now().date_naive();

    sqlx::query(
        r#"
        INSERT INTO bookings
            (id, user_id, room_id, room_type_id, check_in_date, check_out_date,
             num_guests, total_price, status, property, pms_booking_id,
             pms_room_type_id, guest_name, guest_phone, payment_option,
             amount_due_now, balance_due)
        VALUES ($1, $2, NULL, NULL, $3, $4, 2, 4400.00, 'pending', $5, $6,
                'DLX', 'คุณสมชาย', '0812345678', 'deposit50', 2200.00, 2200.00)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(today + chrono::Duration::days(10))
    .bind(today + chrono::Duration::days(12))
    .bind(property)
    .bind(pms_booking_id)
    .execute(pool)
    .await
    .expect("insert booking fixture");

    booking_id
}

/// The channel shape: held in the PMS, awaiting the deposit.
async fn seed_channel_booking(pool: &sqlx::PgPool, user_id: Uuid, property: &str) -> Uuid {
    let pms_booking_id = format!("PMS-NOTIFY-{}", Uuid::new_v4().simple());
    seed_booking(pool, user_id, property, Some(pms_booking_id)).await
}

async fn seed_slip(pool: &sqlx::PgPool, booking_id: Uuid, uploaded_by: Uuid) -> Uuid {
    seed_slip_with_status(pool, booking_id, uploaded_by, "verified", None).await
}

/// A slip row in a named machine state, optionally carrying the bank
/// reference the vendor returned — the closest thing to payer details this
/// schema holds, and therefore the thing the message must never repeat.
async fn seed_slip_with_status(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    uploaded_by: Uuid,
    slipok_status: &str,
    slipok_trans_ref: Option<&str>,
) -> Uuid {
    sqlx::query_scalar(
        r#"
        INSERT INTO booking_slips
            (booking_id, slip_url, uploaded_by, slipok_status, slipok_trans_ref)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(booking_id)
    .bind(SLIP_URL)
    .bind(uploaded_by)
    .bind(slipok_status)
    .bind(slipok_trans_ref)
    .fetch_one(pool)
    .await
    .expect("insert slip fixture")
}

async fn set_slipok_status(pool: &sqlx::PgPool, slip_id: Uuid, slipok_status: &str) {
    sqlx::query("UPDATE booking_slips SET slipok_status = $2 WHERE id = $1")
        .bind(slip_id)
        .bind(slipok_status)
        .execute(pool)
        .await
        .expect("update slip status");
}

async fn claim_rows(pool: &sqlx::PgPool, booking_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM booking_notify_log WHERE booking_id = $1")
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .expect("count booking_notify_log rows")
}

// ============================================================================
// Cases
// ============================================================================

/// The happy path: one message, to the right property's mailbox, carrying
/// what reception needs and nothing it must not have.
#[tokio::test]
async fn a_created_booking_emails_the_property_desk() {
    let app = TestApp::new().await.expect("test app");
    let user = crate::common::create_test_user(app.db(), "notify-created@example.com")
        .await
        .expect("test user");
    let booking_id = seed_channel_booking(app.db(), user.id, "hfville").await;

    let email = RecordingEmailService::new();
    notify_with_service(
        app.db(),
        &config_with_mailboxes(),
        &email,
        booking_id,
        BookingNotifyEvent::BookingCreated,
        NO_WAIT,
    )
    .await;

    let sent = email.sent();
    assert_eq!(sent.len(), 1, "exactly one message per event");
    assert_eq!(
        sent[0].to, HFVILLE_MAILBOX,
        "routed by the booking property"
    );
    assert!(
        sent[0]
            .subject
            .starts_with("[HF Ville] จองใหม่ / New booking"),
        "Thai-first subject, got {:?}",
        sent[0].subject
    );
    // The reason the email exists: a number reception can dial.
    assert!(sent[0].html_body.contains("0812345678"));
    assert!(sent[0].html_body.contains("คุณสมชาย"));
    // Never: the slip image, the payer's bank, any vendor name.
    let lowered = sent[0].html_body.to_lowercase();
    assert!(!lowered.contains("<img"));
    assert!(!lowered.contains("/storage/slips"));
    assert!(!lowered.contains("slipok"));

    assert_eq!(claim_rows(app.db(), booking_id).await, 1);
    app.cleanup().await.expect("cleanup");
}

/// The dedup rule. `create_booking` replayed through
/// `services::idempotency` returns the cached response and calls the
/// notifier again; a failed send retries; an admin can press Verify twice.
/// Every one of those is the same event, and the desk must see one email.
#[tokio::test]
async fn the_same_event_twice_sends_once() {
    let app = TestApp::new().await.expect("test app");
    let user = crate::common::create_test_user(app.db(), "notify-dedup@example.com")
        .await
        .expect("test user");
    let booking_id = seed_channel_booking(app.db(), user.id, "hf").await;
    let config = config_with_mailboxes();

    let email = RecordingEmailService::new();
    for _ in 0..2 {
        notify_with_service(
            app.db(),
            &config,
            &email,
            booking_id,
            BookingNotifyEvent::BookingCreated,
            NO_WAIT,
        )
        .await;
    }

    assert_eq!(email.sent().len(), 1, "the replay must not re-notify");
    assert_eq!(claim_rows(app.db(), booking_id).await, 1);

    // A different event on the same booking is not a duplicate.
    let slip_id = seed_slip(app.db(), booking_id, user.id).await;
    notify_with_service(
        app.db(),
        &config,
        &email,
        booking_id,
        BookingNotifyEvent::DepositVerified { slip_id },
        NO_WAIT,
    )
    .await;
    assert_eq!(email.sent().len(), 2);
    assert!(email.sent()[1]
        .subject
        .starts_with("[HF] มัดจำเข้าแล้ว / Deposit received"));

    app.cleanup().await.expect("cleanup");
}

/// Not configured is a normal state, not an error.
#[tokio::test]
async fn a_property_with_no_mailbox_sends_nothing_and_raises_nothing() {
    let app = TestApp::new().await.expect("test app");
    let user = crate::common::create_test_user(app.db(), "notify-blank@example.com")
        .await
        .expect("test user");
    let booking_id = seed_channel_booking(app.db(), user.id, "hf").await;

    // Blank, not absent: `${VAR:-}` in every compose file delivers `Some("")`.
    let mut config = test_app_state_config();
    config.booking_notify.hf = Some("   ".to_string());
    config.booking_notify.hfville = Some(HFVILLE_MAILBOX.to_string());

    let email = RecordingEmailService::new();
    notify_with_service(
        app.db(),
        &config,
        &email,
        booking_id,
        BookingNotifyEvent::BookingCreated,
        NO_WAIT,
    )
    .await;

    assert!(email.sent().is_empty(), "a blank mailbox sends nothing");
    // And nothing is claimed, so setting the mailbox later still works.
    assert_eq!(claim_rows(app.db(), booking_id).await, 0);

    app.cleanup().await.expect("cleanup");
}

/// A relay that refuses the message is retried exactly once and then let go.
/// Nothing propagates to the caller.
#[tokio::test]
async fn a_refused_message_is_retried_once_and_then_dropped() {
    let app = TestApp::new().await.expect("test app");
    let user = crate::common::create_test_user(app.db(), "notify-retry@example.com")
        .await
        .expect("test user");
    let booking_id = seed_channel_booking(app.db(), user.id, "hfville").await;

    let email = RecordingEmailService::failing();
    notify_with_service(
        app.db(),
        &config_with_mailboxes(),
        &email,
        booking_id,
        BookingNotifyEvent::BookingCreated,
        NO_WAIT,
    )
    .await;

    assert_eq!(email.sent().len(), 2, "one send plus exactly one retry");
    // Nothing went out, so the event is handed back: a claim that outlives a
    // failed send would keep this booking silent for good.
    assert_eq!(
        claim_rows(app.db(), booking_id).await,
        0,
        "a send that never happened must not hold the event"
    );

    // And a later attempt can therefore still reach the desk.
    let working = RecordingEmailService::new();
    notify_with_service(
        app.db(),
        &config_with_mailboxes(),
        &working,
        booking_id,
        BookingNotifyEvent::BookingCreated,
        NO_WAIT,
    )
    .await;
    assert_eq!(working.sent().len(), 1, "the retry path is not burnt");
    assert_eq!(claim_rows(app.db(), booking_id).await, 1);

    app.cleanup().await.expect("cleanup");
}

/// The configuration production actually runs: `SLIPOK_AUTO_VERIFY` is unset,
/// so a good slip takes the shadow-pass branch and an admin confirms it by
/// hand afterwards. Those are two different things to tell the desk — "a
/// deposit landed, we are checking it" and "it is confirmed" — and a single
/// dedup key would have let the first swallow the second.
#[tokio::test]
async fn a_shadow_pass_and_the_verify_that_follows_both_reach_the_desk() {
    let app = TestApp::new().await.expect("test app");
    let user = crate::common::create_test_user(app.db(), "notify-shadow@example.com")
        .await
        .expect("test user");
    let booking_id = seed_channel_booking(app.db(), user.id, "hfville").await;
    let slip_id = seed_slip_with_status(app.db(), booking_id, user.id, "shadow_pass", None).await;
    let config = config_with_mailboxes();

    let email = RecordingEmailService::new();
    notify_with_service(
        app.db(),
        &config,
        &email,
        booking_id,
        BookingNotifyEvent::DepositShadowPass { slip_id },
        NO_WAIT,
    )
    .await;

    // The admin then presses Verify. `slip_confirm` writes `admin_status` and
    // leaves `slipok_status` where the machine left it, so the fixture does
    // the same.
    notify_with_service(
        app.db(),
        &config,
        &email,
        booking_id,
        BookingNotifyEvent::DepositVerified { slip_id },
        NO_WAIT,
    )
    .await;

    let sent = email.sent();
    assert_eq!(sent.len(), 2, "the confirmation must not be deduped away");
    assert!(
        sent[0].html_body.contains("เจ้าหน้าที่ต้องตรวจซ้ำ"),
        "the shadow notice says a human must still look"
    );
    assert!(
        sent[1].html_body.contains("ยืนยันแล้ว / Confirmed"),
        "the second message says the deposit is confirmed, got {:?}",
        sent[1].html_body
    );
    assert!(!sent[1].html_body.contains("เจ้าหน้าที่ต้องตรวจซ้ำ"));

    let keys: Vec<String> = sqlx::query_scalar(
        "SELECT event_key FROM booking_notify_log WHERE booking_id = $1 ORDER BY event_key",
    )
    .bind(booking_id)
    .fetch_all(app.db())
    .await
    .expect("read claim rows");
    assert_eq!(
        keys,
        vec![
            format!("deposit_shadow_pass:{}", slip_id),
            format!("deposit_verified:{}", slip_id),
        ]
    );

    // Re-firing either event still sends nothing.
    for event in [
        BookingNotifyEvent::DepositShadowPass { slip_id },
        BookingNotifyEvent::DepositVerified { slip_id },
    ] {
        notify_with_service(app.db(), &config, &email, booking_id, event, NO_WAIT).await;
    }
    assert_eq!(email.sent().len(), 2, "each event still sends exactly once");

    app.cleanup().await.expect("cleanup");
}

/// The privacy rule, against the row the notifier actually reads: a real
/// `booking_slips` row with an image path and a bank reference on it.
#[tokio::test]
async fn the_deposit_message_repeats_nothing_from_the_slip_row() {
    let app = TestApp::new().await.expect("test app");
    let user = crate::common::create_test_user(app.db(), "notify-slip-privacy@example.com")
        .await
        .expect("test user");
    let booking_id = seed_channel_booking(app.db(), user.id, "hfville").await;
    let trans_ref = "0123456789012345";
    let slip_id =
        seed_slip_with_status(app.db(), booking_id, user.id, "verified", Some(trans_ref)).await;
    set_slipok_status(app.db(), slip_id, "verified").await;

    let email = RecordingEmailService::new();
    notify_with_service(
        app.db(),
        &config_with_mailboxes(),
        &email,
        booking_id,
        BookingNotifyEvent::DepositVerified { slip_id },
        NO_WAIT,
    )
    .await;

    let sent = email.sent();
    assert_eq!(sent.len(), 1);
    let body = sent[0].html_body.to_lowercase();
    assert!(!body.contains(SLIP_URL), "no slip image path");
    assert!(!body.contains("/storage/slips"));
    assert!(!body.contains("<img"));
    assert!(!body.contains(trans_ref), "no bank reference");
    assert!(!body.contains("bank"));
    assert!(!body.contains("ธนาคาร"));
    assert!(!body.contains("เลขบัญชี"));
    assert!(!body.contains("slipok"));

    // Nothing account-number shaped. The guest's phone is 10 digits and
    // deliberately present, and a random booking id can hold a long digit run
    // of its own, so both are removed before the check rather than exempted
    // from it.
    let without_phone = body
        .replace("0812345678", "")
        .replace(&booking_id.to_string(), "");
    let digits_run = without_phone
        .split(|c: char| !c.is_ascii_digit())
        .map(str::len)
        .max()
        .unwrap_or(0);
    assert!(
        digits_run < 9,
        "message contains an account-number-shaped digit run"
    );

    app.cleanup().await.expect("cleanup");
}

/// The handler contract: a booking is created even when the mail relay is
/// unreachable. The notification is spawned, so nothing about SMTP can reach
/// the guest's response.
#[tokio::test]
async fn a_booking_is_created_even_when_the_relay_is_unreachable() {
    let app = TestApp::new_with_config(&|config| {
        // Configured, and pointed at a port nothing is listening on.
        config.email.smtp.host = Some("127.0.0.1".to_string());
        config.email.smtp.port = 1;
        config.email.smtp.user = Some("relay@example.com".to_string());
        config.email.smtp.pass = Some("not-a-real-password".to_string());
        config.email.smtp.from = Some("relay@example.com".to_string());
        config.booking_notify.hfville = Some(HFVILLE_MAILBOX.to_string());
    })
    .await
    .expect("test app");

    let user = crate::common::create_test_user(app.db(), "notify-201@example.com")
        .await
        .expect("test user");
    let token = generate_test_token_with_role(&user.id, &user.email, "customer");

    // `create_booking` books local inventory, so there has to be some.
    let room_type_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO room_types (id, name, price_per_night, max_guests, is_active)
        VALUES ($1, 'Standard', 1200.00, 2, true)
        "#,
    )
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("insert room type");
    sqlx::query(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor, is_active)
        VALUES ($1, $2, '901', 9, true)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("insert room");

    let today = chrono::Utc::now().date_naive();
    let body = serde_json::json!({
        "checkIn": (today + chrono::Duration::days(20)).to_string(),
        "checkOut": (today + chrono::Duration::days(22)).to_string(),
        "roomType": "standard",
        "guests": 2,
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/bookings")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("build create-booking request");

    let resp = app.router().oneshot(req).await.expect("create booking");
    assert_eq!(
        resp.status().as_u16(),
        201,
        "a dead mail relay must not fail the booking"
    );

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("read body");
    let json: Value = serde_json::from_slice(&bytes).expect("booking response is JSON");
    let booking_id: Uuid = json["id"]
        .as_str()
        .expect("booking id")
        .parse()
        .expect("booking id is a uuid");

    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM bookings WHERE id = $1)")
        .bind(booking_id)
        .fetch_one(app.db())
        .await
        .expect("read booking back");
    assert!(exists, "the booking is committed regardless of SMTP");

    app.cleanup().await.expect("cleanup");
}

/// End to end through the real admin route: verifying the same slip twice
/// claims the event once, so reception is told once.
#[tokio::test]
async fn verifying_a_slip_twice_claims_the_event_once() {
    let app = TestApp::new_with_config(&|config| {
        config.booking_notify.hf = Some(HF_MAILBOX.to_string());
        config.booking_notify.hfville = Some(HFVILLE_MAILBOX.to_string());
    })
    .await
    .expect("test app");

    let guest = crate::common::create_test_user(app.db(), "notify-verify-guest@example.com")
        .await
        .expect("guest user");
    let admin = crate::common::create_test_user(app.db(), "notify-verify-admin@example.com")
        .await
        .expect("admin user");

    // No `pms_booking_id`: the PMS is not configured in this suite, and the
    // point of the case is the notification claim, not the channel handshake.
    let booking_id = seed_booking(app.db(), guest.id, "hf", None).await;
    let slip_id = seed_slip(app.db(), booking_id, guest.id).await;
    let token = generate_test_token_with_role(&admin.id, &admin.email, "admin");

    for attempt in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/admin/bookings/slips/{}/verify", slip_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .expect("build verify request");

        let resp = app.router().oneshot(req).await.expect("verify slip");
        assert_eq!(
            resp.status().as_u16(),
            200,
            "verify attempt {} should succeed",
            attempt
        );
    }

    let claims: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM booking_notify_log WHERE event_key = $1")
            .bind(format!("deposit_verified:{}", slip_id))
            .fetch_one(app.db())
            .await
            .expect("count claims");
    assert_eq!(claims, 1, "the second verify must not re-notify");

    app.cleanup().await.expect("cleanup");
}
