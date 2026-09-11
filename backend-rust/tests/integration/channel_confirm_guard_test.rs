//! A15 — a late slip against a PMS channel booking must fail **loudly**.
//!
//! B8's race 2.4 is the one that needs no concurrency at all: a slip
//! verified more than two hours after the hold was taken. The PMS side was
//! always right (`confirm_booking_payment` is guarded on
//! `book_status = 'pending'` under `FOR UPDATE`, and a released hold answers
//! 409). The loyalty side was not: it selected the booking with no `status`
//! filter, fired `payment_verified` at a `pms_booking_id` the sweep had
//! already released, never read `rows_affected()` on the guarded local
//! `UPDATE`, and logged *"channel booking confirmed"* either way. The guest
//! had paid and had no room, and every surface said otherwise.
//!
//! What is asserted here, for the admin's Verify and the automatic path
//! alike:
//!
//! - **expired hold + human Verify** → 409, the slip is back in the queue as
//!   `needs_action` / `booking_not_payable`, the booking is untouched, an
//!   audit row explains it, and the PMS is never called at all;
//! - **PMS 409 + human Verify** → the same end state, with the PMS's own
//!   status code and body on the audit row;
//! - **the healthy path is unchanged** — a live hold still confirms through
//!   the payment event and still answers 200;
//! - **an already-confirmed channel booking** re-verifies idempotently and
//!   now reports `bookingConfirmed = false`, because this call confirmed
//!   nothing (the `rows_affected()` fix, seen from the API);
//! - **auto-verify, live mode, PMS 409** → `needs_action` /
//!   `booking_not_payable`, and the refusal survives `revert_auto_confirm`
//!   rather than being overwritten with `pending` / `confirm_failed`;
//! - **auto-verify, shadow mode, expired hold** → recorded as `manual` /
//!   `booking_not_payable` with no PMS call and no slip stamped, which is
//!   the state production ships in.
//!
//! The second half of the file covers the other B8 L5 item: the PMS hold
//! create is not idempotent on either side, so the app holds a short Redis
//! lock per guest and stay. See `services::pms_channel::create_booking`.

use axum::body::Body;
use axum::http::{header, Request};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use loyalty_backend::services::pms_channel::{
    hold_guard_key, PmsChannelClient, PmsCreateBookingRequest, PmsGuest,
};
use loyalty_backend::services::slip_confirm::ACTION_BOOKING_NOT_CONFIRMED;
use loyalty_backend::types::Property;

use crate::common::{
    generate_test_token_with_role, test_app_state_config, test_redis_url, TestApp, TestUser,
};

/// The property's receiving PromptPay ID. Present in every config so the
/// app is realistic; only the automatic cases actually match against it.
const RECEIVING_ID: &str = "0105556123047";
/// A masked receiver of the same length whose visible digits match.
const MASKED_RECEIVER: &str = "xxx-xxx-xxx3047";
/// SlipOK branch id; also the mock server's path.
const BRANCH_ID: &str = "test-branch";
/// What the fixture booking asks the guest to pay now.
const AMOUNT_DUE_NOW: &str = "1500.00";
const SLIP_AMOUNT: f64 = 1500.0;

// ============================================================================
// Fixtures
// ============================================================================

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

/// A PMS channel booking awaiting payment: no local room (the PMS owns it),
/// `amount_due_now` set, and a hold whose expiry the caller chooses.
async fn seed_channel_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    pms_booking_id: &str,
    status: &str,
    hold_expires_at: Option<DateTime<Utc>>,
) -> Uuid {
    let booking_id = Uuid::new_v4();
    let today = Utc::now().date_naive();

    sqlx::query(
        r#"
        INSERT INTO bookings
            (id, user_id, room_id, room_type_id, check_in_date, check_out_date,
             num_guests, total_price, status, property, pms_booking_id,
             payment_option, amount_due_now, hold_expires_at)
        VALUES ($1, $2, NULL, NULL, $3, $4, 2, 3000.00, $5, 'hf', $6,
                'deposit50', $7::numeric, $8)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(today + Duration::days(10))
    .bind(today + Duration::days(12))
    .bind(status)
    .bind(pms_booking_id)
    .bind(AMOUNT_DUE_NOW)
    .bind(hold_expires_at)
    .execute(pool)
    .await
    .expect("insert channel booking fixture");

    booking_id
}

/// A pending slip attached directly — the state an admin's Verify acts on.
async fn seed_pending_slip(pool: &sqlx::PgPool, booking_id: Uuid, uploader_id: Uuid) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO booking_slips (booking_id, slip_url, uploaded_by, admin_status)
        VALUES ($1, '/storage/slips/a15-fixture.jpg', $2, 'pending')
        RETURNING id
        "#,
    )
    .bind(booking_id)
    .bind(uploader_id)
    .fetch_one(pool)
    .await
    .expect("insert slip fixture")
}

async fn booking_status(pool: &sqlx::PgPool, booking_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .expect("read booking status")
}

/// `(admin_status, admin_verified_by, slipok_status, slipok_reason)`.
async fn slip_state(
    pool: &sqlx::PgPool,
    slip_id: Uuid,
) -> (Option<String>, Option<Uuid>, Option<String>, Option<String>) {
    sqlx::query_as(
        r#"
        SELECT admin_status, admin_verified_by, slipok_status, slipok_reason
        FROM booking_slips WHERE id = $1
        "#,
    )
    .bind(slip_id)
    .fetch_one(pool)
    .await
    .expect("read slip row")
}

/// Every audit row on a booking, as (action, reason, after_data).
async fn audit_rows(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
) -> Vec<(String, Option<String>, Option<Value>)> {
    sqlx::query_as(
        r#"
        SELECT action, reason, after_data FROM booking_audit_log
        WHERE booking_id = $1 ORDER BY occurred_at, id
        "#,
    )
    .bind(booking_id)
    .fetch_all(pool)
    .await
    .expect("read audit rows")
}

/// The one refusal row, or a panic naming what was actually written.
fn refusal_row(
    rows: &[(String, Option<String>, Option<Value>)],
) -> &(String, Option<String>, Option<Value>) {
    rows.iter()
        .find(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED)
        .unwrap_or_else(|| panic!("expected a {ACTION_BOOKING_NOT_CONFIRMED} row, got {rows:?}"))
}

fn jpeg_bytes() -> Vec<u8> {
    let mut data = vec![0xFF, 0xD8, 0xFF, 0xE0];
    data.extend_from_slice(b"loyalty-a15-slip");
    data
}

fn build_multipart(data: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----LoyaltyA15Boundary";
    let mut body = Vec::with_capacity(data.len() + 256);
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"slip.jpg\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: image/jpeg\r\n\r\n");
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
    (boundary.to_string(), body)
}

/// Store a slip image through the real upload endpoint.
async fn upload_slip(app: &TestApp, user: &TestUser) -> String {
    let (boundary, body) = build_multipart(&jpeg_bytes());
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
    json["url"].as_str().expect("upload url").to_string()
}

fn slipok_success_body(trans_ref: &str) -> Value {
    json!({
        "success": true,
        "data": {
            "transRef": trans_ref,
            "transTimestamp": "2026-09-11T09:15:00+07:00",
            "amount": SLIP_AMOUNT,
            "sendingBank": "004",
            "receivingBank": "004",
            "sender": { "displayName": "Test Guest" },
            "receiver": {
                "displayName": "The Harbour Front",
                "proxy": { "type": "NATID", "value": MASKED_RECEIVER },
                "account": { "type": "BANKAC", "value": "xxx-x-x1234-x" }
            }
        }
    })
}

// ============================================================================
// 1. The human path
// ============================================================================

/// An admin presses Verify on a slip whose PMS hold has already run out.
///
/// The old code posted the payment event anyway and then claimed success.
/// The room belongs to the PMS and the PMS may have sold it to somebody
/// else, so the only honest answer is a refusal — and unlike a lapsed
/// deposit link, a human cannot override it, because no button in this app
/// can take the room back.
#[tokio::test]
async fn an_expired_hold_refuses_the_admins_verify_without_calling_the_pms() {
    // Mounted with no route at all: any call to this server 404s, and the
    // assertion below (`received_requests` is empty) is what proves the
    // refusal happened *before* the PMS was told anything.
    let pms_mock = MockServer::start().await;
    let pms_uri = pms_mock.uri();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
        cfg.pms.base_url = Some(pms_uri.clone());
        cfg.pms.channel_token = Some("test-channel-token".to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "a15-admin-expired@test.com").await;
    let guest = seed_guest(&app, "a15-guest-expired@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-EXPIRED",
        "pending",
        Some(Utc::now() - Duration::hours(1)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({ "adminNotes": "โอนมาแล้ว" }),
        )
        .await;

    response.assert_status(409);
    let body: Value = response.json().expect("error response is JSON");
    let rendered = body.to_string();
    assert!(
        rendered.contains("booking_not_payable"),
        "the admin is told which refusal this is, in the vocabulary the UI \
         already renders: {rendered}"
    );

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "the booking must be left exactly as it was"
    );

    let (admin_status, verified_by, _slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("needs_action"),
        "the slip goes back to the desk rather than reading verified"
    );
    assert_eq!(
        slipok_reason.as_deref(),
        Some("booking_not_payable"),
        "one word for one situation, shared with slipok_check"
    );
    assert_eq!(
        verified_by,
        Some(admin.id),
        "who last touched the slip is still on the record"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    let (_, reason, after) = refusal_row(&rows);
    assert!(
        reason
            .as_deref()
            .is_some_and(|r| r.contains("booking_not_payable")),
        "the audit row says why in both languages: {reason:?}"
    );
    let after = after.as_ref().expect("refusal row carries after_data");
    assert_eq!(after["reason"].as_str(), Some("booking_not_payable"));
    assert_eq!(after["pmsBookingId"].as_str(), Some("PMS-A15-EXPIRED"));
    assert!(
        after["pmsStatus"].is_null(),
        "no PMS status, because the PMS was never asked: {after}"
    );
    assert!(
        !rows.iter().any(|(action, _, _)| action == "slip_verified"),
        "the slip was never stamped verified in the first place: {rows:?}"
    );

    assert!(
        pms_mock
            .received_requests()
            .await
            .unwrap_or_default()
            .is_empty(),
        "a booking whose hold is gone must not generate a payment event"
    );

    app.cleanup().await.ok();
}

/// The hold still looks live to us, and the PMS says otherwise — the 409
/// documented at `new-hotel/docs/loyalty-channel.md:78-86`.
///
/// Before A15 every non-2xx from the PMS became
/// `ExternalServiceUnavailable`, i.e. "retry me", and the slip was left
/// reading `verified`. A refusal is not an outage: it is definitive, and it
/// has to land on the slip with the PMS's own words attached.
#[tokio::test]
async fn a_pms_409_refuses_the_admins_verify_and_records_what_the_pms_said() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-A15-409/payment-verified"))
        .respond_with(
            ResponseTemplate::new(409).set_body_json(json!({ "error": "hold already released" })),
        )
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
    let admin = seed_admin(&app, "a15-admin-409@test.com").await;
    let guest = seed_guest(&app, "a15-guest-409@test.com").await;

    // A hold that has *not* expired locally, so the pre-check passes and the
    // PMS is the only thing that can refuse.
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-409",
        "pending",
        Some(Utc::now() + Duration::hours(2)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({}),
        )
        .await;

    response.assert_status(409);

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "the PMS refused, so nothing local may move"
    );

    let (admin_status, _verified_by, slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(admin_status.as_deref(), Some("needs_action"));
    assert_eq!(slipok_reason.as_deref(), Some("booking_not_payable"));
    assert_eq!(
        slipok_status.as_deref(),
        Some("manual"),
        "a slip nobody could act on belongs on the manual path"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    let (_, reason, after) = refusal_row(&rows);
    let after = after.as_ref().expect("refusal row carries after_data");
    assert_eq!(
        after["pmsStatus"].as_u64(),
        Some(409),
        "the PMS's own status code is what a human needs here: {after}"
    );
    assert!(
        after["pmsResponse"]
            .as_str()
            .is_some_and(|b| b.contains("hold already released")),
        "and its body: {after}"
    );
    assert!(
        reason
            .as_deref()
            .is_some_and(|r| r.contains("409") && r.contains("booking_not_payable")),
        "the human-readable reason carries both: {reason:?}"
    );

    app.cleanup().await.ok();
}

/// The healthy path, unchanged: a live hold, a PMS that says yes, a 200 and
/// a confirmed booking. This is the regression guard on everything above.
#[tokio::test]
async fn a_live_hold_still_confirms_through_the_payment_event() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-A15-OK/payment-verified"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "success": true })))
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
    let admin = seed_admin(&app, "a15-admin-ok@test.com").await;
    let guest = seed_guest(&app, "a15-guest-ok@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-OK",
        "pending",
        Some(Utc::now() + Duration::hours(2)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({}),
        )
        .await;
    response.assert_status(200);

    let body: Value = response.json().expect("verify response is JSON");
    assert_eq!(body["adminStatus"].as_str(), Some("verified"));
    assert_eq!(
        body["bookingConfirmed"].as_bool(),
        Some(true),
        "the guarded UPDATE really did move a row: {body}"
    );
    assert!(body["bookingNotConfirmedReason"].is_null());

    assert_eq!(booking_status(app.db(), booking_id).await, "confirmed");

    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "nothing was refused: {rows:?}"
    );

    app.cleanup().await.ok();
}

/// A second slip verified against a channel booking that is already
/// `confirmed`.
///
/// This is the `rows_affected()` fix seen from the API. The PMS takes the
/// payment event as a replay (`already_confirmed: true`), the guarded local
/// `UPDATE … WHERE status = 'pending'` matches nothing, and the response
/// must say so — it used to hard-code `bookingConfirmed: true` about a call
/// that confirmed nothing. It is **not** a refusal: no audit row, and the
/// desk mail still goes out.
#[tokio::test]
async fn re_verifying_an_already_confirmed_channel_booking_reports_nothing_moved() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/api/channel/bookings/PMS-A15-REPLAY/payment-verified",
        ))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "success": true, "already_confirmed": true })),
        )
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
    let admin = seed_admin(&app, "a15-admin-replay@test.com").await;
    let guest = seed_guest(&app, "a15-guest-replay@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-REPLAY",
        "confirmed",
        Some(Utc::now() - Duration::hours(1)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({}),
        )
        .await;
    response.assert_status(200);

    let body: Value = response.json().expect("verify response is JSON");
    assert_eq!(body["adminStatus"].as_str(), Some("verified"));
    assert_eq!(
        body["bookingConfirmed"].as_bool(),
        Some(false),
        "this call moved no row, and the response must not pretend it did: {body}"
    );
    assert!(
        body["bookingNotConfirmedReason"].is_null(),
        "an idempotent replay refuses nothing: {body}"
    );

    assert_eq!(booking_status(app.db(), booking_id).await, "confirmed");

    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "an already-confirmed booking is not a refusal: {rows:?}"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 2. The automatic path
// ============================================================================

/// Live mode (`auto_verify = true`), a perfect slip, a live hold — and the
/// PMS answers 409 when the payment event arrives.
///
/// Two things have to hold. The refusal must land (`needs_action` /
/// `booking_not_payable`), and it must **survive**: `slipok_check` calls
/// `revert_auto_confirm` on any `Err` from `confirm_slip`, and that function
/// used to flip any slip it found back to `pending` / `confirm_failed` —
/// overwriting the reason the desk needs with a vaguer one.
#[tokio::test]
async fn auto_verify_in_live_mode_records_a_pms_refusal_and_keeps_it() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(ResponseTemplate::new(200).set_body_json(slipok_success_body("A15AUTO409")))
        .expect(1)
        .mount(&slipok_mock)
        .await;

    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/api/channel/bookings/PMS-A15-AUTO409/payment-verified",
        ))
        .respond_with(
            ResponseTemplate::new(409).set_body_json(json!({ "error": "hold already released" })),
        )
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
    let guest = seed_guest(&app, "a15-auto-409@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-AUTO409",
        "pending",
        Some(Utc::now() + Duration::hours(2)),
    )
    .await;
    let slip_url = upload_slip(&app, &guest).await;

    let client = app.authenticated_client(&guest.id, &guest.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", booking_id),
            &json!({ "slipUrl": slip_url }),
        )
        .await;
    // The guest's upload still succeeds — the PMS's answer is not their
    // problem to solve at the moment they press send.
    response.assert_status(201);

    let body: Value = response.json().expect("slip response is JSON");
    let slip_id: Uuid = body["id"].as_str().expect("slip id").parse().expect("uuid");

    let (admin_status, _verified_by, slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("needs_action"),
        "the machine's verify was taken back, not left standing"
    );
    assert_eq!(
        slipok_reason.as_deref(),
        Some("booking_not_payable"),
        "the refusal keeps its own reason — revert_auto_confirm must not \
         overwrite it with confirm_failed"
    );
    assert_eq!(slipok_status.as_deref(), Some("manual"));

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "the booking is untouched"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    let (_, _, after) = refusal_row(&rows);
    assert_eq!(
        after.as_ref().expect("after_data")["pmsStatus"].as_u64(),
        Some(409)
    );
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == "slip_verify_reverted"),
        "the refusal already says what happened; a second, vaguer row would \
         only confuse the desk: {rows:?}"
    );

    app.cleanup().await.ok();
}

/// Shadow mode (`auto_verify = false`) — what production runs today — with a
/// hold that has already lapsed.
///
/// The machine records its decision and touches nothing: no PMS call, no
/// stamp on the slip, no movement on the booking. `booking_not_payable` is
/// written by `slipok_check` itself, which is the same word the confirm path
/// uses, so the two cannot drift.
#[tokio::test]
async fn auto_verify_in_shadow_mode_records_the_refusal_and_calls_no_pms() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(ResponseTemplate::new(200).set_body_json(slipok_success_body("A15SHADOW")))
        .expect(1)
        .mount(&slipok_mock)
        .await;

    let pms_mock = MockServer::start().await;

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
    let guest = seed_guest(&app, "a15-auto-shadow@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-SHADOW",
        "pending",
        Some(Utc::now() - Duration::hours(1)),
    )
    .await;
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

    let (admin_status, verified_by, slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("pending"),
        "shadow mode never stamps the slip"
    );
    assert_eq!(verified_by, None);
    assert_eq!(slipok_status.as_deref(), Some("manual"));
    assert_eq!(slipok_reason.as_deref(), Some("booking_not_payable"));

    assert_eq!(booking_status(app.db(), booking_id).await, "pending");
    assert!(
        audit_rows(app.db(), booking_id).await.is_empty(),
        "nothing was decided, so nothing is audited"
    );
    assert!(
        pms_mock
            .received_requests()
            .await
            .unwrap_or_default()
            .is_empty(),
        "shadow mode never talks to the PMS"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 3. The hold-create guard (B8 race 2.3, checklist L5)
// ============================================================================

/// A `PmsChannelClient` pointed at `pms_uri`, taking its guard lock on the
/// suite's Redis.
///
/// Built straight from `Settings` rather than through `TestApp`: the guard
/// needs no database, and a test that does not build one cannot be slowed
/// by the template-database machinery.
fn pms_client(pms_uri: &str) -> PmsChannelClient {
    let mut settings = test_app_state_config();
    settings.pms.base_url = Some(pms_uri.to_string());
    settings.pms.channel_token = Some("test-channel-token".to_string());
    settings.redis.url = test_redis_url();
    PmsChannelClient::from_settings(&settings).expect("build PMS client")
}

/// A hold request for a guest nobody else in the suite shares, so parallel
/// tests cannot collide on the shared Redis.
fn hold_request(phone: &str) -> PmsCreateBookingRequest {
    let today = Utc::now().date_naive();
    PmsCreateBookingRequest {
        property: Property::Hf,
        room_type_id: "3".to_string(),
        check_in: today + Duration::days(30),
        check_out: today + Duration::days(32),
        guests: 2,
        guest: PmsGuest {
            name: "A15 Guest".to_string(),
            phone: phone.to_string(),
        },
        membership_id: None,
        payment: "deposit50".to_string(),
    }
}

fn created_body(pms_booking_id: &str) -> Value {
    json!({
        "pms_booking_id": pms_booking_id,
        "total": 3000.0,
        "amount_due_now": 1500.0,
        "hold_expires_at": (Utc::now() + Duration::hours(2)).to_rfc3339(),
    })
}

/// Two identical hold creates at once — the guest whose first request hung
/// and who pressed "book" again.
///
/// The PMS mints a fresh `book_id` and a fresh room for every
/// `POST /api/channel/bookings` (its `CreateChannelBookingRequest` carries
/// no idempotency field and the handler reads no `Idempotency-Key` header),
/// so without the guard this is two holds on two rooms with two deposits
/// behind them. `.expect(1)` is the assertion that matters.
#[tokio::test]
async fn a_retried_hold_create_cannot_produce_two_holds() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(created_body("hf-1"))
                // Long enough that the second call is certain to arrive
                // while the first is still in flight.
                .set_delay(std::time::Duration::from_millis(700)),
        )
        .expect(1)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri());
    let phone = format!("0810000{}", &Uuid::new_v4().simple().to_string()[..6]);
    let request = hold_request(&phone);

    let (first, second) = tokio::join!(client.create_booking(&request), async {
        // Give the first call time to take the lock before the retry
        // lands — this is the retry, not a tie.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        client.create_booking(&request).await
    });

    assert!(first.is_ok(), "the first hold must go through: {first:?}");
    let err = second.expect_err("the retry must be refused, not served");
    let rendered = err.to_string();
    assert!(
        rendered.contains("already being created"),
        "and refused in words a guest can act on: {rendered}"
    );
}

/// The lock is held past the answer, not released with it.
///
/// A guest's retry usually arrives *after* the hold they could not see being
/// created — the request they gave up on succeeded on the server. Releasing
/// the lock on success would let exactly that retry through.
#[tokio::test]
async fn the_guard_outlives_a_successful_hold_create() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("hf-2")))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri());
    let phone = format!("0820000{}", &Uuid::new_v4().simple().to_string()[..6]);
    let request = hold_request(&phone);

    client
        .create_booking(&request)
        .await
        .expect("the first hold goes through");

    let err = client
        .create_booking(&request)
        .await
        .expect_err("an immediate identical retry is refused");
    assert!(err.to_string().contains("already being created"));
}

/// The one failure whose outcome is *known*: the PMS answered and refused,
/// so no hold exists and the guest may correct their dates and try again at
/// once. The lock is given back rather than left to time out.
#[tokio::test]
async fn a_rejected_hold_create_gives_the_lock_straight_back() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": "sold out" })))
        .expect(2)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri());
    let phone = format!("0830000{}", &Uuid::new_v4().simple().to_string()[..6]);
    let request = hold_request(&phone);

    let first = client.create_booking(&request).await;
    assert!(first.is_err(), "the PMS said no");
    let second = client.create_booking(&request).await;

    // Refused again by the *PMS*, not by the guard: the second call reached
    // the mock, which is what `.expect(2)` proves.
    let rendered = second.expect_err("still sold out").to_string();
    assert!(
        !rendered.contains("already being created"),
        "a request that created nothing must not hold the guest's next \
         attempt hostage: {rendered}"
    );
}

/// Two guests, one room type, the same nights: independent locks.
///
/// A guard keyed on the stay alone would serialise the whole property. It is
/// keyed on the guest *and* the stay, which is the only thing that makes it
/// safe to leave the lock held after a success.
#[tokio::test]
async fn the_guard_is_per_guest_not_per_stay() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("hf-3")))
        .expect(2)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri());
    let suffix = Uuid::new_v4().simple().to_string();
    let one = hold_request(&format!("0840000{}", &suffix[..6]));
    let two = hold_request(&format!("0850000{}", &suffix[6..12]));

    assert_ne!(
        hold_guard_key(&one),
        hold_guard_key(&two),
        "different guests must not share a lock"
    );
    client
        .create_booking(&one)
        .await
        .expect("first guest's hold");
    client
        .create_booking(&two)
        .await
        .expect("second guest is not blocked by the first");
}
