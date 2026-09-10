//! Integration coverage for A11: verifying a slip has to move the booking
//! it pays for, whoever pressed the button.
//!
//! Before this, `services::slip_confirm` flipped a booking to `confirmed`
//! only when it was a PMS channel booking (`pms_booking_id` set) or came
//! from a deposit request link (`booking_source = 'deposit_link'`). An
//! ordinary in-app booking whose slip reception verified kept `pending`
//! forever, so a guest who had paid still read "pending" on their booking
//! page — the D6 gap.
//!
//! What is asserted here:
//!
//! - an admin's Verify flips an ordinary app booking to `confirmed`, and
//!   no PMS is contacted for a booking the PMS never held;
//! - the automatic SlipOK path flips the same booking the same way — the
//!   two paths share `slip_confirm`, and this is what proves they did not
//!   drift;
//! - a PMS channel booking still confirms *through the payment event*, and
//!   is never touched by the local flip;
//! - a booking whose hold has already expired is refused: it stays
//!   `pending` and the refusal is recorded as `booking_not_payable`, the
//!   same word `slipok_check` writes for exactly this state;
//! - a deposit-link booking still confirms, so the branch B1 shipped is
//!   preserved by the generalisation rather than replaced by it.

use axum::body::Body;
use axum::http::{header, Request};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use loyalty_backend::services::slip_confirm::{
    ACTION_BOOKING_NOT_CONFIRMED, SLIPOK_SYSTEM_USER_ID,
};

use crate::common::{generate_test_token_with_role, TestApp, TestUser};

/// The property's receiving PromptPay ID for these tests.
const RECEIVING_ID: &str = "0105556123047";
/// A masked receiver value of the same length whose visible digits match.
const MASKED_RECEIVER: &str = "xxx-xxx-xxx3047";
/// SlipOK branch id; also the mock server's path.
const BRANCH_ID: &str = "test-branch";
/// What every fixture booking asks the guest to transfer now.
const AMOUNT_DUE_NOW: &str = "1500.00";
const SLIP_AMOUNT: f64 = 1500.0;

// ============================================================================
// Fixtures
// ============================================================================

fn jpeg_bytes() -> Vec<u8> {
    let mut data = vec![0xFF, 0xD8, 0xFF, 0xE0];
    data.extend_from_slice(b"loyalty-a11-slip");
    data
}

fn build_multipart(filename: &str, content_type: &str, data: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----LoyaltyA11BoundaryM4v";
    let mut body = Vec::with_capacity(data.len() + 256);

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
            filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    (boundary.to_string(), body)
}

/// Store a slip image through the real upload endpoint and return the
/// `/storage/slips/<uuid>.jpg` URL it hands back.
async fn upload_slip(app: &TestApp, user: &TestUser) -> String {
    let (boundary, body) = build_multipart("slip.jpg", "image/jpeg", &jpeg_bytes());
    let token = generate_test_token_with_role(&user.id, &user.email, "customer");

    let req = Request::builder()
        .method("POST")
        .uri("/api/slips/upload")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .expect("build upload request");

    let resp = app.router().oneshot(req).await.expect("upload oneshot");
    assert_eq!(resp.status().as_u16(), 200, "slip upload should succeed");

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("read upload body");
    let json: Value = serde_json::from_slice(&bytes).expect("upload response is JSON");
    json["url"]
        .as_str()
        .expect("upload response carries a url")
        .to_string()
}

async fn insert_room_type(pool: &sqlx::PgPool, name: &str) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO room_types (name, description, price_per_night, max_guests, is_active)
        VALUES ($1, 'a11 fixture', 1500.00, 4, TRUE)
        RETURNING id
        "#,
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("insert room type fixture")
}

async fn insert_room(pool: &sqlx::PgPool, room_type_id: Uuid, room_number: &str) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO rooms (room_type_id, room_number, floor, is_active)
        VALUES ($1, $2, 1, TRUE)
        RETURNING id
        "#,
    )
    .bind(room_type_id)
    .bind(room_number)
    .fetch_one(pool)
    .await
    .expect("insert room fixture")
}

/// Insert an ordinary in-app booking awaiting payment: a real room, no
/// `pms_booking_id`, `booking_source = 'app'` and nothing holding it but
/// us. This is the shape the D6 gap left stuck on `pending`.
///
/// `hold_expires_at` is passed through so the expired-hold case can seed
/// the same booking with a lapsed one.
async fn seed_app_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    label: &str,
    hold_expires_at: Option<DateTime<Utc>>,
) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    let room_type_id = insert_room_type(pool, &format!("A11 {label} {}", &suffix[..8])).await;
    let room_id = insert_room(pool, room_type_id, &format!("A{}", &suffix[..6])).await;

    seed_booking(
        pool,
        user_id,
        Some(room_type_id),
        Some(room_id),
        None,
        Some("app"),
        hold_expires_at,
    )
    .await
}

/// The one insert every fixture in this file goes through, so the columns
/// that decide which branch of `slip_confirm` runs — `pms_booking_id`,
/// `booking_source`, `hold_expires_at` — are visible side by side.
async fn seed_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    room_type_id: Option<Uuid>,
    room_id: Option<Uuid>,
    pms_booking_id: Option<&str>,
    booking_source: Option<&str>,
    hold_expires_at: Option<DateTime<Utc>>,
) -> Uuid {
    let booking_id = Uuid::new_v4();
    let today = Utc::now().date_naive();

    sqlx::query(
        r#"
        INSERT INTO bookings
            (id, user_id, room_id, room_type_id, check_in_date, check_out_date,
             num_guests, total_price, status, property, pms_booking_id,
             booking_source, payment_option, amount_due_now, hold_expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, 2, 3000.00, 'pending', 'hf', $7,
                $8, 'deposit50', $9::numeric, $10)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_id)
    .bind(today + Duration::days(10))
    .bind(today + Duration::days(12))
    .bind(pms_booking_id)
    .bind(booking_source)
    .bind(AMOUNT_DUE_NOW)
    .bind(hold_expires_at)
    .execute(pool)
    .await
    .expect("insert booking fixture");

    booking_id
}

/// Attach a slip to a booking directly, the state an admin's Verify acts
/// on. The guest-facing upload endpoint is exercised by the automatic
/// case below; the human cases only need a pending slip to exist.
async fn seed_pending_slip(pool: &sqlx::PgPool, booking_id: Uuid, uploader_id: Uuid) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO booking_slips (booking_id, slip_url, uploaded_by, admin_status)
        VALUES ($1, '/storage/slips/a11-fixture.jpg', $2, 'pending')
        RETURNING id
        "#,
    )
    .bind(booking_id)
    .bind(uploader_id)
    .fetch_one(pool)
    .await
    .expect("insert slip fixture")
}

fn slipok_success_body(trans_ref: &str, amount: f64, receiver_value: &str) -> Value {
    json!({
        "success": true,
        "data": {
            "transRef": trans_ref,
            "transTimestamp": "2026-09-12T09:15:00+07:00",
            "amount": amount,
            "sendingBank": "004",
            "receivingBank": "004",
            "sender": { "displayName": "Test Guest" },
            "receiver": {
                "displayName": "The Harbour Front",
                "proxy": { "type": "NATID", "value": receiver_value },
                "account": { "type": "BANKAC", "value": "xxx-x-x1234-x" }
            }
        }
    })
}

async fn seed_admin(app: &TestApp, email: &str) -> TestUser {
    let admin = TestUser::admin(email);
    admin.insert(app.db()).await.expect("insert admin");
    admin
}

async fn seed_guest(app: &TestApp, email: &str) -> TestUser {
    let user = TestUser::new(email);
    user.insert(app.db()).await.expect("insert guest");
    user
}

async fn booking_status(pool: &sqlx::PgPool, booking_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .expect("read booking status")
}

/// Every audit row on a booking, as (action, admin_id, reason).
async fn audit_rows(pool: &sqlx::PgPool, booking_id: Uuid) -> Vec<(String, Uuid, Option<String>)> {
    sqlx::query_as(
        r#"
        SELECT action, admin_id, reason FROM booking_audit_log
        WHERE booking_id = $1 ORDER BY created_at
        "#,
    )
    .bind(booking_id)
    .fetch_all(pool)
    .await
    .expect("read audit rows")
}

/// Config for the human-verify cases: a receiving account so the app is
/// realistic, and no SlipOK vendor at all — the admin is the decider.
fn promptpay_only(cfg: &mut loyalty_backend::Settings) {
    cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
}

// ============================================================================
// 1. The human path
// ============================================================================

/// An admin verifies the slip on an ordinary app booking: the booking
/// flips to `confirmed`, so the guest's page stops saying "pending".
#[tokio::test]
async fn admin_verify_confirms_an_app_booking() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "a11-admin-verify@test.com").await;
    let guest = seed_guest(&app, "a11-guest-verify@test.com").await;

    let booking_id = seed_app_booking(app.db(), guest.id, "Verify", None).await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "the fixture starts where the guest is stuck"
    );

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({ "adminNotes": "โอนเข้าบัญชีแล้ว" }),
        )
        .await;
    response.assert_status(200);

    let body: Value = response.json().expect("verify response is JSON");
    assert_eq!(body["adminStatus"].as_str(), Some("verified"));

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "confirmed",
        "a verified slip against a booking nobody else holds is the whole \
         payment event: the booking has to move"
    );

    // The verify is audited once, by the admin — the generalised flip adds
    // no second row when it succeeds.
    let rows = audit_rows(app.db(), booking_id).await;
    assert_eq!(
        rows.iter()
            .filter(|(action, _, _)| action == "slip_verified")
            .count(),
        1,
        "exactly one slip_verified row: {rows:?}"
    );
    assert_eq!(
        rows[0].1, admin.id,
        "attributed to the admin who pressed it"
    );
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "nothing was refused: {rows:?}"
    );

    app.cleanup().await.ok();
}

/// The same booking shape, verified by the machine instead. The two paths
/// share `slip_confirm`, and the booking must land in the same place —
/// with no PMS traffic, because the PMS never held this room.
#[tokio::test]
async fn auto_verify_confirms_an_app_booking() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "A11AUTO0001",
                SLIP_AMOUNT,
                MASKED_RECEIVER,
            )),
        )
        .expect(1)
        .mount(&slipok_mock)
        .await;

    // Any PMS traffic at all is a bug: an app booking has no
    // `pms_booking_id`, and a payment event against a booking the PMS
    // never held is money posted to nothing.
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .expect(0)
        .mount(&pms_mock)
        .await;

    let slipok_uri = slipok_mock.uri();
    let pms_uri = pms_mock.uri();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.slipok.api_key = Some("test-key".to_string());
        cfg.slipok.branch_id = Some(BRANCH_ID.to_string());
        cfg.slipok.api_url = Some(slipok_uri.clone());
        cfg.slipok.auto_verify = true;
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
        cfg.pms.base_url = Some(pms_uri.clone());
        cfg.pms.channel_token = Some("test-channel-token".to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");
    let guest = seed_guest(&app, "a11-auto-app@test.com").await;

    let booking_id = seed_app_booking(app.db(), guest.id, "Auto", None).await;
    let slip_url = upload_slip(&app, &guest).await;

    let client = app.authenticated_client(&guest.id, &guest.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", booking_id),
            &json!({ "slipUrl": slip_url }),
        )
        .await;
    response.assert_status(201);

    let body: Value = response.json().expect("slip response is JSON");
    let slip_id: Uuid = body["id"].as_str().expect("slip id").parse().expect("uuid");

    let (slipok_status, admin_status): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT slipok_status, admin_status FROM booking_slips WHERE id = $1")
            .bind(slip_id)
            .fetch_one(app.db())
            .await
            .expect("read slip row");
    assert_eq!(slipok_status.as_deref(), Some("verified"));
    assert_eq!(admin_status.as_deref(), Some("verified"));

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "confirmed",
        "the automatic path runs the same confirm as the admin's button"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    assert_eq!(rows.len(), 1, "one decision, one row: {rows:?}");
    assert_eq!(rows[0].0, "slip_verified");
    assert_eq!(rows[0].1, SLIPOK_SYSTEM_USER_ID);

    app.cleanup().await.ok();
}

// ============================================================================
// 2. The PMS channel is untouched
// ============================================================================

/// A channel booking still confirms the way ADR-0003 says it does: the PMS
/// is told first, and the local row follows. The generalised flip must not
/// short-circuit that — the PMS owns the room.
#[tokio::test]
async fn a_channel_booking_still_confirms_through_the_pms_event() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-A11-1/payment-verified"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let pms_uri = pms_mock.uri();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
        cfg.pms.base_url = Some(pms_uri.clone());
        cfg.pms.channel_token = Some("test-channel-token".to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "a11-admin-channel@test.com").await;
    let guest = seed_guest(&app, "a11-guest-channel@test.com").await;

    let booking_id = seed_booking(
        app.db(),
        guest.id,
        None,
        None,
        Some("PMS-A11-1"),
        None,
        Some(Utc::now() + Duration::hours(2)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({}),
        )
        .await
        .assert_status(200);

    assert_eq!(booking_status(app.db(), booking_id).await, "confirmed");

    // The `.expect(1)` on the mock is the real assertion: the payment event
    // fired. This one says the local flip did not quietly take over the
    // decision on the way past.
    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "a channel booking is judged by the PMS, never refused locally: {rows:?}"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 3. An expired hold is refused
// ============================================================================

/// The room is no longer held, so the payment cannot confirm anything: the
/// slip is still verified (the money did arrive and the desk said so), the
/// booking stays `pending`, and the refusal is on the record as
/// `booking_not_payable` — the same word the automatic check writes when it
/// meets this state before uploading a decision.
#[tokio::test]
async fn an_expired_hold_is_not_confirmed_and_says_why() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "a11-admin-expired@test.com").await;
    let guest = seed_guest(&app, "a11-guest-expired@test.com").await;

    let booking_id = seed_app_booking(
        app.db(),
        guest.id,
        "Expired",
        Some(Utc::now() - Duration::hours(1)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({ "adminNotes": "เลยเวลาแล้ว" }),
        )
        .await;
    // The verify itself is not an error: refusing it would leave the desk
    // unable to record a payment that really did arrive.
    response.assert_status(200);
    let body: Value = response.json().expect("verify response is JSON");
    assert_eq!(body["adminStatus"].as_str(), Some("verified"));

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "a booking whose hold has lapsed must never be confirmed by a slip"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    let refusal = rows
        .iter()
        .find(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED)
        .unwrap_or_else(|| panic!("the refusal must be on the record: {rows:?}"));
    assert_eq!(
        refusal.1, admin.id,
        "attributed to the same actor as the verify"
    );
    assert!(
        refusal
            .2
            .as_deref()
            .is_some_and(|reason| reason.contains("booking_not_payable")),
        "the reason vocabulary is the machine's own: {:?}",
        refusal.2
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 4. Deposit links keep working
// ============================================================================

/// The branch B1 shipped is a special case of the new rule, not a casualty
/// of it: a deposit-link booking still confirms on verify, with no PMS
/// call.
#[tokio::test]
async fn a_deposit_link_booking_still_confirms() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "a11-admin-deposit@test.com").await;
    let guest = seed_guest(&app, "a11-guest-deposit@test.com").await;

    // The shape `routes::admin_deposit_links` writes: no PMS reference,
    // `booking_source = 'deposit_link'`, and the link's expiry copied onto
    // the booking's hold.
    let booking_id = seed_booking(
        app.db(),
        guest.id,
        None,
        None,
        None,
        Some("deposit_link"),
        Some(Utc::now() + Duration::hours(48)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({}),
        )
        .await
        .assert_status(200);

    assert_eq!(booking_status(app.db(), booking_id).await, "confirmed");

    app.cleanup().await.ok();
}
