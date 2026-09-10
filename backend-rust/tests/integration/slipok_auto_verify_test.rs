//! Integration coverage for the automatic SlipOK check that runs when a
//! guest attaches a slip to a booking (`POST /api/bookings/:id/slips`).
//!
//! Every case drives the real handler against a wiremock SlipOK server,
//! injected through `slipok.api_url` — the same construction path
//! production uses (`AppState::new` → `SlipOkService::from_settings`).
//!
//! What is asserted, per the rollout plan:
//!
//! - flag on + everything matches  → slip verified, channel booking
//!   confirmed and the PMS told, exactly as the admin path would leave it;
//! - flag off + everything matches → `shadow_pass`, `admin_status` still
//!   `pending` (this is the state we ship in);
//! - amount mismatch               → `manual` / `amount_mismatch`;
//! - HTTP 429                      → `unavailable` / `quota_exceeded`, and
//!   the guest's upload still succeeds.

use axum::body::Body;
use axum::http::{header, Request};
use chrono::Duration;
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::common::{generate_test_token_with_role, TestApp, TestUser};

/// The property's receiving PromptPay ID for these tests.
const RECEIVING_ID: &str = "0105556123047";
/// A masked receiver value of the same length whose visible digits match.
const MASKED_RECEIVER: &str = "xxx-xxx-xxx3047";
/// SlipOK branch id; also the mock server's path.
const BRANCH_ID: &str = "test-branch";

const SLIP_AMOUNT: f64 = 1500.0;

// ============================================================================
// Fixtures
// ============================================================================

/// Smallest byte string that passes the upload endpoint's JPEG magic-byte
/// check. The SlipOK server is a mock, so the pixels are irrelevant.
fn jpeg_bytes() -> Vec<u8> {
    let mut data = vec![0xFF, 0xD8, 0xFF, 0xE0];
    data.extend_from_slice(b"loyalty-test-slip");
    data
}

fn build_multipart(filename: &str, content_type: &str, data: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----LoyaltySlipOkBoundaryQ7x";
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
/// `/storage/slips/<uuid>.jpg` URL it hands back. Going through the
/// endpoint (rather than writing the file directly) is what proves the
/// check reads back from the directory the upload actually wrote to.
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

/// Insert a PMS channel booking awaiting payment: `status = 'pending'`,
/// `amount_due_now` set, no local room. This is the shape a slip is
/// uploaded against in production.
async fn seed_channel_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    amount_due_now: &str,
    pms_booking_id: &str,
) -> Uuid {
    let booking_id = Uuid::new_v4();
    let today = chrono::Utc::now().date_naive();

    sqlx::query(
        r#"
        INSERT INTO bookings
            (id, user_id, room_id, room_type_id, check_in_date, check_out_date,
             num_guests, total_price, status, property, pms_booking_id,
             payment_option, amount_due_now)
        VALUES ($1, $2, NULL, NULL, $3, $4, 2, 3000.00, 'pending', 'hf', $5,
                'deposit50', $6::numeric)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(today + Duration::days(10))
    .bind(today + Duration::days(12))
    .bind(pms_booking_id)
    .bind(amount_due_now)
    .execute(pool)
    .await
    .expect("insert channel booking fixture");

    booking_id
}

/// A SlipOK success payload for a transfer of `amount` to `receiver`, in
/// the envelope shape the vendor documents: the slip fields sit under
/// `data`, `success` stays at the top level.
fn slipok_success_body(trans_ref: &str, amount: f64, receiver_value: &str) -> Value {
    json!({
        "success": true,
        "data": {
            "transRef": trans_ref,
            "transTimestamp": "2026-09-10T09:15:00+07:00",
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

/// The SlipOK-facing state of a slip row.
async fn read_slip_state(
    pool: &sqlx::PgPool,
    slip_id: Uuid,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    sqlx::query_as(
        r#"
        SELECT slipok_status, slipok_reason, slipok_trans_ref, admin_status
        FROM booking_slips WHERE id = $1
        "#,
    )
    .bind(slip_id)
    .fetch_one(pool)
    .await
    .expect("read slip row")
}

async fn booking_status(pool: &sqlx::PgPool, booking_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .expect("read booking status")
}

// ============================================================================
// Cases
// ============================================================================

/// (a) Flag on, SlipOK verifies, amount and receiver match: the slip is
/// verified and the channel booking is confirmed — the same end state the
/// admin's Verify button produces, including the PMS payment event.
#[tokio::test]
async fn auto_verify_confirms_a_matching_slip() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "AUTOVERIFY0001",
                SLIP_AMOUNT,
                MASKED_RECEIVER,
            )),
        )
        .mount(&slipok_mock)
        .await;

    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-AUTO-1/payment-verified"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .expect(1)
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

    let user = TestUser::new("slipok-auto-verify@test.com");
    user.insert(app.db()).await.expect("insert user");

    let booking_id = seed_channel_booking(app.db(), user.id, "1500.00", "PMS-AUTO-1").await;
    let slip_url = upload_slip(&app, &user).await;

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", booking_id),
            &json!({ "slipUrl": slip_url }),
        )
        .await;
    response.assert_status(201);

    let body: Value = response.json().expect("slip response is JSON");
    let slip_id: Uuid = body["id"].as_str().expect("slip id").parse().expect("uuid");

    let (slipok_status, slipok_reason, trans_ref, admin_status) =
        read_slip_state(app.db(), slip_id).await;
    assert_eq!(slipok_status.as_deref(), Some("verified"));
    assert_eq!(slipok_reason, None);
    assert_eq!(trans_ref.as_deref(), Some("AUTOVERIFY0001"));
    assert_eq!(
        admin_status.as_deref(),
        Some("verified"),
        "auto-verify must leave the same admin_status an admin would"
    );

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "confirmed",
        "the channel booking should be confirmed by the payment event"
    );

    // No audit row: an automatic verify has no admin to attribute it to.
    let audit_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM booking_audit_log WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(app.db())
            .await
            .expect("count audit rows");
    assert_eq!(audit_rows, 0);

    app.cleanup().await.ok();
}

/// (b) Same slip, flag off: the decision is recorded as `shadow_pass` and
/// nothing is verified. This is the state the change ships in.
#[tokio::test]
async fn shadow_mode_records_the_decision_without_verifying() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "SHADOW0001",
                SLIP_AMOUNT,
                MASKED_RECEIVER,
            )),
        )
        .mount(&slipok_mock)
        .await;

    // The PMS must not be called at all in shadow mode.
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-SHADOW-1/payment-verified"))
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
        cfg.slipok.auto_verify = false;
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
        cfg.pms.base_url = Some(pms_uri.clone());
        cfg.pms.channel_token = Some("test-channel-token".to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");

    let user = TestUser::new("slipok-shadow@test.com");
    user.insert(app.db()).await.expect("insert user");

    let booking_id = seed_channel_booking(app.db(), user.id, "1500.00", "PMS-SHADOW-1").await;
    let slip_url = upload_slip(&app, &user).await;

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", booking_id),
            &json!({ "slipUrl": slip_url }),
        )
        .await;
    response.assert_status(201);

    let body: Value = response.json().expect("slip response is JSON");
    let slip_id: Uuid = body["id"].as_str().expect("slip id").parse().expect("uuid");

    let (slipok_status, slipok_reason, trans_ref, admin_status) =
        read_slip_state(app.db(), slip_id).await;
    assert_eq!(slipok_status.as_deref(), Some("shadow_pass"));
    assert_eq!(slipok_reason, None);
    assert_eq!(trans_ref.as_deref(), Some("SHADOW0001"));
    assert_eq!(
        admin_status.as_deref(),
        Some("pending"),
        "shadow mode must never verify a slip"
    );
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");

    app.cleanup().await.ok();
}

/// (c) SlipOK verifies the slip but for the wrong amount: manual, with the
/// reason recorded for the admin sidebar. No bank reference is stored, so
/// a corrected re-upload of the same transfer is not pre-judged a duplicate.
#[tokio::test]
async fn amount_mismatch_goes_to_manual_with_a_reason() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "MISMATCH0001",
                1499.99,
                MASKED_RECEIVER,
            )),
        )
        .mount(&slipok_mock)
        .await;

    let slipok_uri = slipok_mock.uri();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.slipok.api_key = Some("test-key".to_string());
        cfg.slipok.branch_id = Some(BRANCH_ID.to_string());
        cfg.slipok.api_url = Some(slipok_uri.clone());
        cfg.slipok.auto_verify = true;
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");

    let user = TestUser::new("slipok-mismatch@test.com");
    user.insert(app.db()).await.expect("insert user");

    let booking_id = seed_channel_booking(app.db(), user.id, "1500.00", "PMS-MISMATCH-1").await;
    let slip_url = upload_slip(&app, &user).await;

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", booking_id),
            &json!({ "slipUrl": slip_url }),
        )
        .await;
    response.assert_status(201);

    let body: Value = response.json().expect("slip response is JSON");
    let slip_id: Uuid = body["id"].as_str().expect("slip id").parse().expect("uuid");

    let (slipok_status, slipok_reason, trans_ref, admin_status) =
        read_slip_state(app.db(), slip_id).await;
    assert_eq!(slipok_status.as_deref(), Some("manual"));
    assert_eq!(slipok_reason.as_deref(), Some("amount_mismatch"));
    assert_eq!(trans_ref, None);
    assert_eq!(admin_status.as_deref(), Some("pending"));
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");

    app.cleanup().await.ok();
}

/// (d) SlipOK is out of quota. The slip lands on the manual path with the
/// reason recorded, and — the point of the case — the guest's upload still
/// succeeds. A metered vendor must never be able to fail a guest's request.
#[tokio::test]
async fn quota_exceeded_is_recorded_and_the_upload_still_succeeds() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(ResponseTemplate::new(429).set_body_json(json!({
            "success": false,
            "code": 1008,
            "message": "quota exceeded"
        })))
        .mount(&slipok_mock)
        .await;

    let slipok_uri = slipok_mock.uri();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.slipok.api_key = Some("test-key".to_string());
        cfg.slipok.branch_id = Some(BRANCH_ID.to_string());
        cfg.slipok.api_url = Some(slipok_uri.clone());
        cfg.slipok.auto_verify = true;
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");

    let user = TestUser::new("slipok-quota@test.com");
    user.insert(app.db()).await.expect("insert user");

    let booking_id = seed_channel_booking(app.db(), user.id, "1500.00", "PMS-QUOTA-1").await;
    let slip_url = upload_slip(&app, &user).await;

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", booking_id),
            &json!({ "slipUrl": slip_url }),
        )
        .await;
    response.assert_status(201);

    let body: Value = response.json().expect("slip response is JSON");
    let slip_id: Uuid = body["id"].as_str().expect("slip id").parse().expect("uuid");

    let (slipok_status, slipok_reason, trans_ref, admin_status) =
        read_slip_state(app.db(), slip_id).await;
    assert_eq!(slipok_status.as_deref(), Some("unavailable"));
    assert_eq!(slipok_reason.as_deref(), Some("quota_exceeded"));
    assert_eq!(trans_ref, None);
    assert_eq!(admin_status.as_deref(), Some("pending"));
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");

    app.cleanup().await.ok();
}
