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
//!   `needs_action`, the booking is untouched, an
//!   audit row explains it, and the PMS is never called at all;
//! - **PMS 409 + human Verify** → the same end state, with the PMS's own
//!   status code and body on the audit row;
//! - **the healthy path is unchanged** — a live hold still confirms through
//!   the payment event and still answers 200;
//! - **an already-confirmed channel booking** re-verifies idempotently and
//!   now reports `bookingConfirmed = false`, because this call confirmed
//!   nothing (the `rows_affected()` fix, seen from the API);
//! - **auto-verify, live mode, PMS 409** → `needs_action` /
//!   a `confirm_refused` audit row, and the refusal survives
//!   `revert_auto_confirm`
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
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

use loyalty_backend::services::pms_channel::{
    hold_guard_key, PmsChannelClient, PmsCreateBookingRequest, PmsGuest,
};
use loyalty_backend::services::slip_confirm::{revert_auto_confirm, ACTION_BOOKING_NOT_CONFIRMED};
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

/// Stamp a slip with a machine decision, so a test can prove a refusal left
/// it alone. `shadow_pass` + a bank reference is the row the shadow-window
/// agreement report counts.
async fn stamp_machine_decision(
    pool: &sqlx::PgPool,
    slip_id: Uuid,
    status: &str,
    reason: Option<&str>,
    trans_ref: Option<&str>,
) {
    sqlx::query(
        r#"
        UPDATE booking_slips
        SET slipok_status = $1, slipok_reason = $2, slipok_trans_ref = $3,
            slipok_checked_at = NOW() - INTERVAL '5 minutes'
        WHERE id = $4
        "#,
    )
    .bind(status)
    .bind(reason)
    .bind(trans_ref)
    .bind(slip_id)
    .execute(pool)
    .await
    .expect("stamp machine decision");
}

/// `slipok_checked_at`, for proving a refusal did not re-stamp it.
async fn slipok_checked_at(pool: &sqlx::PgPool, slip_id: Uuid) -> Option<DateTime<Utc>> {
    sqlx::query_scalar("SELECT slipok_checked_at FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_one(pool)
        .await
        .expect("read slipok_checked_at")
}

/// `slipok_trans_ref`, for proving a refusal released it.
async fn slipok_trans_ref(pool: &sqlx::PgPool, slip_id: Uuid) -> Option<String> {
    sqlx::query_scalar("SELECT slipok_trans_ref FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_one(pool)
        .await
        .expect("read slipok_trans_ref")
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

/// A booking **we** have already given up on: the local row is `cancelled`.
///
/// This is the one shape that is refused without asking the PMS, and the
/// reason is narrow: posting `payment-verified` at a booking we cancelled
/// could only record a deposit against a room nobody is holding. Everything
/// else — including a hold whose clock has run out — is the PMS's call, not
/// ours (see the next test).
#[tokio::test]
async fn a_cancelled_channel_booking_refuses_without_calling_the_pms() {
    // Mounted with no route: any call 404s, and `received_requests` being
    // empty is what proves the refusal happened before the PMS was told
    // anything.
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
    let admin = seed_admin(&app, "a15-admin-cancelled@test.com").await;
    let guest = seed_guest(&app, "a15-guest-cancelled@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-CANCELLED",
        "cancelled",
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
        rendered.contains("confirm_refused"),
        "the admin is told which refusal this is, in the vocabulary the UI \
         already renders — and it is the *refusal* word, not the machine's \
         `booking_not_payable`: {rendered}"
    );

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "cancelled",
        "the booking must be left exactly as it was"
    );

    let (admin_status, verified_by, _slipok_status, _slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("needs_action"),
        "the slip goes back to the desk rather than reading verified"
    );
    assert_eq!(
        verified_by, None,
        "nobody verified anything, so nothing is stamped"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    let (_, reason, after) = refusal_row(&rows);
    assert!(
        reason
            .as_deref()
            .is_some_and(|r| r.contains("confirm_refused")),
        "the audit row says why in both languages: {reason:?}"
    );
    let after = after.as_ref().expect("refusal row carries after_data");
    assert_eq!(after["reason"].as_str(), Some("confirm_refused"));
    assert_eq!(after["pmsBookingId"].as_str(), Some("PMS-A15-CANCELLED"));
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
        "a booking we cancelled must not generate a payment event"
    );

    app.cleanup().await.ok();
}

/// A hold whose clock has run out, which the PMS has **not** swept yet.
///
/// The first cut of this work refused here, locally, before calling the PMS.
/// That was wrong. `new-hotel`'s `ChannelService::confirm_payment` matches on
/// `book_status` and never reads `book_hold_expires_at`, and its expiry sweep
/// runs every five minutes — so for up to five minutes after the clock
/// lapses the hold is still `pending` there and the payment event confirms it
/// with a 200. Refusing locally threw away a booking the PMS was willing to
/// honour and sent reception off to re-book a room the guest already had.
///
/// The local clock now decides nothing. The PMS is asked, and its answer is
/// taken.
#[tokio::test]
async fn a_lapsed_hold_the_pms_still_honours_is_confirmed_not_refused() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/api/channel/bookings/PMS-A15-LAPSED/payment-verified",
        ))
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
    let admin = seed_admin(&app, "a15-admin-lapsed@test.com").await;
    let guest = seed_guest(&app, "a15-guest-lapsed@test.com").await;

    // Pending locally, clock two hours gone — the exact state the PMS's own
    // sweep has not reached yet.
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-LAPSED",
        "pending",
        Some(Utc::now() - Duration::hours(2)),
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
    assert_eq!(
        body["bookingConfirmed"].as_bool(),
        Some(true),
        "the PMS said yes, so the booking is confirmed: {body}"
    );

    assert_eq!(booking_status(app.db(), booking_id).await, "confirmed");

    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "a lapsed local clock is not by itself a refusal: {rows:?}"
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

    // The machine had already looked at this slip and passed it in shadow
    // mode. That verdict is the agreement report's sample, and the refusal
    // below must not touch it.
    stamp_machine_decision(app.db(), slip_id, "shadow_pass", None, Some("A15KEEP409")).await;
    let checked_at_before = slipok_checked_at(app.db(), slip_id).await;

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

    let (admin_status, _verified_by, slipok_status, _slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(admin_status.as_deref(), Some("needs_action"));

    // M1 — the machine's verdict about the *slip* survives a refusal about
    // the *booking*. Overwriting `shadow_pass` with `manual` here would move
    // a row out of the "machine and human agreed" column and quietly bias
    // the decision to flip SLIPOK_AUTO_VERIFY.
    assert_eq!(
        slipok_status.as_deref(),
        Some("shadow_pass"),
        "a refusal judges the booking, not the slip"
    );
    // (A `slipok_reason` that can actually change is asserted in the no_show
    // case, which seeds a real `manual` / `amount_mismatch` verdict — this
    // shadow_pass row has none to preserve.)
    assert_eq!(
        slipok_checked_at(app.db(), slip_id).await,
        checked_at_before,
        "the machine's timestamp is not re-stamped by a human's refusal"
    );

    // But the bank reference IS released: reception re-books the room and
    // the guest uploads the same transfer again, which would otherwise come
    // back `duplicate` against the partial unique index.
    assert_eq!(
        slipok_trans_ref(app.db(), slip_id).await,
        None,
        "the reference is freed so the same transfer can be re-uploaded"
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
            .is_some_and(|r| r.contains("409") && r.contains("confirm_refused")),
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

/// A PMS answer that is **not** about the booking: 403, the shape
/// `HFVILLE_WRITES_ENABLED=false` produces.
///
/// The first cut treated every 4xx as definitive, which meant a rotated
/// token (401), a write gate (403), an unmounted router (404, i.e. the PMS's
/// PG pool is down) or a Cloudflare Access challenge would each send a slip
/// to reception reading "this booking is dead". They are all things a person
/// fixes and then retries, so they must behave like an outage: error out,
/// leave the slip verified, touch nothing.
#[tokio::test]
async fn a_non_409_4xx_is_retryable_and_never_refuses_the_booking() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-A15-403/payment-verified"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_string("<html><body>HF Ville writes are disabled</body></html>"),
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
    let admin = seed_admin(&app, "a15-admin-403@test.com").await;
    let guest = seed_guest(&app, "a15-guest-403@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-403",
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

    assert_eq!(
        response.status, 503,
        "a write gate is an outage to us, not a dead booking: {}",
        response.body
    );

    // The `Unavailable` arm is where B1's narrowing sent every HTML-heavy
    // answer, and `ExternalServiceUnavailable` renders verbatim into the
    // admin's browser — so it has to go through `sanitize_pms_body` too.
    // This is the only test that proves that wiring.
    for banned in ['<', '>', '"'] {
        assert!(
            !response.body.contains(banned),
            "the PMS's markup must not reach the admin: {}",
            response.body
        );
    }
    assert!(
        response.body.contains("HF Ville writes are disabled"),
        "and the words a human needs must survive the sanitiser: {}",
        response.body
    );

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "nothing moved"
    );

    let (admin_status, _verified_by, _slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("verified"),
        "the verify stands and the admin retries it; the slip must NOT be \
         pushed to needs_action over someone else's config flag"
    );
    assert_eq!(slipok_reason, None);

    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "a retryable failure is not a refusal: {rows:?}"
    );

    app.cleanup().await.ok();
}

/// The 5xx half of the same rule, unchanged from before A15 and pinned here
/// so the 409 carve-out cannot quietly swallow it.
#[tokio::test]
async fn a_pms_5xx_is_retryable_and_never_refuses_the_booking() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/PMS-A15-500/payment-verified"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "pms down" })))
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
    let admin = seed_admin(&app, "a15-admin-500@test.com").await;
    let guest = seed_guest(&app, "a15-guest-500@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "PMS-A15-500",
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

    assert_eq!(response.status, 503, "body: {}", response.body);
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");

    let (admin_status, _, _, _) = slip_state(app.db(), slip_id).await;
    assert_eq!(admin_status.as_deref(), Some("verified"));

    let rows = audit_rows(app.db(), booking_id).await;
    assert!(!rows
        .iter()
        .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED));

    app.cleanup().await.ok();
}

/// A balance slip against a booking the PMS has already settled.
///
/// `completed` is in the PMS's own replay arm
/// (`"confirmed" | "checkedin" | "completed"`), so `payment-verified` answers
/// 200 with `already_confirmed: true` — receiving the rest of the money from
/// a guest whose stay is done is an ordinary thing, not an error. What must
/// be true is that the local flip moves nothing and the response says so.
#[tokio::test]
async fn a_balance_slip_on_a_settled_booking_is_a_replay_not_a_refusal() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4201/payment-verified"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "pms_booking_id": "hf-4201",
            "status": "confirmed",
            "deposit_recorded": 1500.0,
            "balance_due": 1500.0,
            "already_confirmed": true
        })))
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
    let admin = seed_admin(&app, "a15-admin-settled@test.com").await;
    let guest = seed_guest(&app, "a15-guest-settled@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4201",
        "completed",
        Some(Utc::now() - Duration::hours(30)),
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
        "nothing moved — the stay had already settled: {body}"
    );
    assert!(body["bookingNotConfirmedReason"].is_null());

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "completed",
        "a payment must never walk a stay backwards to 'confirmed'"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "a replay is not a refusal: {rows:?}"
    );

    app.cleanup().await.ok();
}

/// `checked_in` is in our settled list but **not** in the PMS's replay arm.
///
/// The PMS's arm is `"confirmed" | "checkedin" | "completed"`, and the CT
/// sync mapper rewrites `book_status` to `checked_in` (with the underscore)
/// every cycle — so the steady state falls into the PMS's `other =>` arm and
/// answers 409. Keeping `checked_in` local-settled is deliberate: we do not
/// pre-judge, we ask, and the refusal path handles the answer. This pins
/// that end-to-end so the cross-repo gap is visible rather than assumed
/// away.
#[tokio::test]
async fn a_checked_in_booking_the_pms_refuses_is_refused_loudly() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4202/payment-verified"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "success": false,
            "error": "booking 4202 is 'checked_in' and cannot be confirmed"
        })))
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
    let admin = seed_admin(&app, "a15-admin-checkedin@test.com").await;
    let guest = seed_guest(&app, "a15-guest-checkedin@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4202",
        "checked_in",
        Some(Utc::now() - Duration::hours(30)),
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
        .assert_status(409);

    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "checked_in",
        "refused, and the stay is left exactly as it was"
    );
    let rows = audit_rows(app.db(), booking_id).await;
    let (_, _, after) = refusal_row(&rows);
    assert_eq!(
        after.as_ref().expect("after_data")["pmsStatus"].as_u64(),
        Some(409)
    );

    app.cleanup().await.ok();
}

/// `no_show` is a refusal we make ourselves, without asking.
///
/// It also pins M1 where it is observable: a slip carrying a real machine
/// verdict (`manual` / `amount_mismatch`) keeps every one of those columns
/// through the refusal.
#[tokio::test]
async fn a_no_show_booking_is_refused_locally_and_the_machine_verdict_survives() {
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
    let admin = seed_admin(&app, "a15-admin-noshow@test.com").await;
    let guest = seed_guest(&app, "a15-guest-noshow@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4203",
        "no_show",
        Some(Utc::now() - Duration::hours(30)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;
    // A verdict with real content in BOTH columns, so preservation is
    // observable rather than vacuously true.
    stamp_machine_decision(
        app.db(),
        slip_id,
        "manual",
        Some("amount_mismatch"),
        Some("A15NOSHOW"),
    )
    .await;
    let checked_at_before = slipok_checked_at(app.db(), slip_id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .post(
            &format!("/api/admin/bookings/slips/{}/verify", slip_id),
            &json!({}),
        )
        .await
        .assert_status(409);

    assert_eq!(booking_status(app.db(), booking_id).await, "no_show");

    let (admin_status, _verified_by, slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(admin_status.as_deref(), Some("needs_action"));
    assert_eq!(
        slipok_status.as_deref(),
        Some("manual"),
        "the machine's verdict on the slip is untouched"
    );
    assert_eq!(
        slipok_reason.as_deref(),
        Some("amount_mismatch"),
        "including a non-null reason — this is the assertion that can fail"
    );
    assert_eq!(
        slipok_checked_at(app.db(), slip_id).await,
        checked_at_before
    );

    // N2: the bank reference is freed from the slip but kept on the record.
    assert_eq!(slipok_trans_ref(app.db(), slip_id).await, None);
    let rows = audit_rows(app.db(), booking_id).await;
    let (_, _, after) = refusal_row(&rows);
    assert_eq!(
        after.as_ref().expect("after_data")["reason"].as_str(),
        Some("confirm_refused"),
        "N12: a refused confirmation has its own word, not the machine's"
    );
    let before: Option<Value> = sqlx::query_scalar(
        "SELECT before_data FROM booking_audit_log WHERE booking_id = $1 AND action = $2",
    )
    .bind(booking_id)
    .bind(ACTION_BOOKING_NOT_CONFIRMED)
    .fetch_one(app.db())
    .await
    .expect("read before_data");
    assert_eq!(
        before.expect("before_data")["slipokTransRef"].as_str(),
        Some("A15NOSHOW"),
        "the reference is payment evidence and must outlive the slip column"
    );

    assert!(
        pms_mock
            .received_requests()
            .await
            .unwrap_or_default()
            .is_empty(),
        "a no_show is ours to refuse; the PMS is not asked"
    );

    app.cleanup().await.ok();
}

/// A 410 Gone is **retryable**, not a refusal.
///
/// `new-hotel` never emits Gone from `/api/channel/*` — `StatusCode::GONE`
/// appears only in `routes/hk.rs` and `routes/new_maintenance.rs` — so a 410
/// here cannot be the PMS's verdict on the booking. It can only have come
/// from something between us and it (a proxy retiring an endpoint, an edge
/// serving a cached tombstone), which is an outage. Calling it definitive
/// would tell reception the room is gone because a load balancer was
/// reconfigured.
#[tokio::test]
async fn a_pms_410_is_retryable_because_the_pms_never_sends_one() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4204/payment-verified"))
        .respond_with(ResponseTemplate::new(410).set_body_string("endpoint retired"))
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
    let admin = seed_admin(&app, "a15-admin-410@test.com").await;
    let guest = seed_guest(&app, "a15-guest-410@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4204",
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

    assert_eq!(
        response.status, 503,
        "a 410 from an intermediary is an outage, not a dead booking: {}",
        response.body
    );
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");
    let (admin_status, _, _, _) = slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("verified"),
        "the verify stands and the admin retries it"
    );
    let rows = audit_rows(app.db(), booking_id).await;
    assert!(
        !rows
            .iter()
            .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED),
        "nothing was refused: {rows:?}"
    );

    app.cleanup().await.ok();
}

/// A PMS that accepts the connection and then says nothing.
///
/// Distinct from a 5xx: it maps to `ExternalServiceTimeout` → **504**, not
/// 503, and like every outage it must leave the slip verified and the
/// booking untouched.
#[tokio::test]
async fn a_pms_timeout_is_a_gateway_timeout_and_refuses_nothing() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4205/payment-verified"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "success": true }))
                // Past PMS_REQUEST_TIMEOUT (10s), so the client gives up.
                .set_delay(std::time::Duration::from_secs(13)),
        )
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
    let admin = seed_admin(&app, "a15-admin-timeout@test.com").await;
    let guest = seed_guest(&app, "a15-guest-timeout@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4205",
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

    assert_eq!(
        response.status, 504,
        "a timeout is its own thing, not a 5xx: {}",
        response.body
    );
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");
    let (admin_status, _, _, _) = slip_state(app.db(), slip_id).await;
    assert_eq!(
        admin_status.as_deref(),
        Some("verified"),
        "an outage never pushes the slip to needs_action"
    );
    let rows = audit_rows(app.db(), booking_id).await;
    assert!(!rows
        .iter()
        .any(|(action, _, _)| action == ACTION_BOOKING_NOT_CONFIRMED));

    app.cleanup().await.ok();
}

/// The third refusal site: the PMS **accepted** the payment and the local
/// row had moved on.
///
/// Reached by racing the confirm against a cancellation — the shape the
/// hold-expiry sweep produces. It is the only refusal written after a
/// *successful* PMS call, so it carries no `pmsStatus`, and it is the one
/// that says money was taken against a booking nobody can serve.
#[tokio::test]
async fn a_local_row_that_moved_under_a_successful_payment_is_refused() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4206/payment-verified"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "success": true }))
                .set_delay(std::time::Duration::from_millis(900)),
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
    let admin = seed_admin(&app, "a15-admin-raced@test.com").await;
    let guest = seed_guest(&app, "a15-guest-raced@test.com").await;

    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4206",
        "pending",
        Some(Utc::now() + Duration::hours(2)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let verify = async {
        client
            .post(
                &format!("/api/admin/bookings/slips/{}/verify", slip_id),
                &json!({}),
            )
            .await
    };
    let interleave = async {
        // While the payment event is in flight, the sweep cancels the hold.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        sqlx::query("UPDATE bookings SET status = 'cancelled' WHERE id = $1")
            .bind(booking_id)
            .execute(app.db())
            .await
            .expect("cancel mid-flight");
    };
    let (response, ()) = tokio::join!(verify, interleave);

    response.assert_status(409);
    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "cancelled",
        "the refusal must not resurrect the booking either"
    );

    let rows = audit_rows(app.db(), booking_id).await;
    let (_, _, after) = refusal_row(&rows);
    let after = after.as_ref().expect("after_data");
    assert!(
        after["pmsStatus"].is_null(),
        "the PMS said yes; there is no refusal status to record: {after}"
    );
    assert!(
        after["detail"]
            .as_str()
            .is_some_and(|d| d.contains("no longer pending")),
        "and the detail says which refusal this is: {after}"
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
/// `confirm_refused` on the audit row), and it must **survive**:
/// `slipok_check` calls
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
        "the slip is back in the desk queue, not left reading verified"
    );

    // M2 — `slipok_check` calls `revert_auto_confirm` on any `Err`, and the
    // refusal has already put this slip right. A revert here would reset it
    // to `pending` / `confirm_failed` and replace a precise reason with a
    // vague one.
    assert_eq!(
        slipok_status.as_deref(),
        Some("verified"),
        "the machine's own verdict on the slip stands; the refusal was about \
         the booking"
    );
    assert_eq!(
        slipok_reason, None,
        "and it is not overwritten with confirm_failed by a revert that must \
         not run"
    );
    assert_eq!(
        slipok_trans_ref(app.db(), slip_id).await,
        None,
        "the reference is freed for the re-upload against the re-booking"
    );

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
/// written by `slipok_check` itself, and it is **deliberately a different
/// word** from the `confirm_refused` the confirm path writes: this one means
/// "the machine declined to act, a human can still finish it", not "a
/// confirmation was tried and the room is gone".
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

/// M2's other half: a failure that happened **before** the slip transaction
/// committed still reverts.
///
/// `record_slipok_result` writes `slipok_status = 'verified'` and stores the
/// bank reference *before* `confirm_slip` runs. If confirmation then fails
/// without reaching the refusal path — a pool timeout, a PMS outage, any
/// error before the commit — the slip sits on `admin_status = 'pending'`
/// carrying a `slipok_trans_ref` nobody would ever clear, and the guest's
/// perfectly good re-upload comes back `duplicate` against the partial
/// unique index.
///
/// An earlier guard tested `admin_status != 'verified'` and skipped exactly
/// this case. The guard now tests the refusal's own signature
/// (`needs_action`), so this reverts as it must.
#[tokio::test]
async fn revert_auto_confirm_still_reverts_a_slip_left_on_pending() {
    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-precommit-revert@test.com").await;
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4301",
        "pending",
        Some(Utc::now() + Duration::hours(2)),
    )
    .await;
    let slip_id = seed_pending_slip(app.db(), booking_id, guest.id).await;

    // Exactly what `record_slipok_result` leaves behind in live mode, before
    // `confirm_slip` has stamped anything.
    stamp_machine_decision(app.db(), slip_id, "verified", None, Some("A15PRECOMMIT")).await;

    let reverted = revert_auto_confirm(app.db(), slip_id)
        .await
        .expect("revert runs");

    assert!(
        reverted,
        "a slip that was never left verified still has a stored reference to \
         give back — skipping it is what stranded the guest's re-upload"
    );

    let (admin_status, verified_by, slipok_status, slipok_reason) =
        slip_state(app.db(), slip_id).await;
    assert_eq!(admin_status.as_deref(), Some("pending"));
    assert_eq!(verified_by, None);
    assert_eq!(slipok_status.as_deref(), Some("manual"));
    assert_eq!(slipok_reason.as_deref(), Some("confirm_failed"));
    assert_eq!(
        slipok_trans_ref(app.db(), slip_id).await,
        None,
        "the reference is freed so the guest can re-upload the same transfer"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 3. The hold-expiry sweep
// ============================================================================

/// Build a `Settings` pointing at a mock PMS, for driving
/// `release_expired_holds` directly.
fn sweep_settings(pms_uri: &str) -> loyalty_backend::Settings {
    let mut settings = test_app_state_config();
    settings.pms.base_url = Some(pms_uri.to_string());
    settings.pms.channel_token = Some("test-channel-token".to_string());
    settings.redis.url = test_redis_url();
    settings
}

/// The PMS's real "already gone" answer: **200** with
/// `already_released: true`.
///
/// Taken verbatim from `new-hotel/hotel-backend/src/routes/channel.rs`
/// (`ReleaseResponse`) via `service/channel.rs::release`, whose `cancelled`
/// arm is an idempotent replay, not an error. This is the success path, so
/// the local cancel follows and the row leaves the sweep's selection.
#[tokio::test]
async fn an_already_released_hold_answers_200_and_is_cancelled_locally() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4101/release"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "success": true,
            "pms_booking_id": "hf-4101",
            "status": "cancelled",
            "already_released": true
        })))
        // Exactly once: a second sweep must not find this row again.
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-sweep-replay@test.com").await;
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4101",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;

    let settings = sweep_settings(&pms_mock.uri());
    let released =
        loyalty_backend::services::pms_channel::release_expired_holds(app.db(), &settings).await;

    assert_eq!(released, 1, "the hold was let go and we cancelled locally");
    assert_eq!(booking_status(app.db(), booking_id).await, "cancelled");

    let released_again =
        loyalty_backend::services::pms_channel::release_expired_holds(app.db(), &settings).await;
    assert_eq!(released_again, 0, "and it is out of the selection");

    app.cleanup().await.ok();
}

/// **The one that matters.** A 409 from `release` does *not* mean "already
/// gone" — it means the PMS is refusing to release a booking whose payment
/// was verified.
///
/// `new-hotel/hotel-backend/src/service/channel.rs::release` answers this for
/// `confirmed` / `checkedin` / anything outside `pending`/`cancelled`. An
/// earlier round of this PR read that 409 as "already cancelled" and
/// cancelled the local row on it, which would have **cancelled a guest's paid
/// booking** while the PMS held them confirmed with a room.
///
/// The sweep must leave the row alone and put it in front of a human.
#[tokio::test]
async fn a_release_409_never_cancels_the_local_booking() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4102/release"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "success": false,
            "error": "booking 4102 is 'confirmed' (payment already verified?); refusing to release"
        })))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-sweep-409@test.com").await;
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4102",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;

    let settings = sweep_settings(&pms_mock.uri());
    let released =
        loyalty_backend::services::pms_channel::release_expired_holds(app.db(), &settings).await;

    assert_eq!(released, 0, "nothing was released");
    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "a booking the PMS says is paid must NOT be cancelled by a sweep — \
         that would strand a guest who has a room in the PMS and no booking \
         with us"
    );

    app.cleanup().await.ok();
}

/// The PMS's other 409: `"changed state during release; retry"`. It says
/// retry in its own words, so the row stays and the next sweep tries again.
#[tokio::test]
async fn a_release_409_that_says_retry_leaves_the_row_for_the_next_sweep() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4103/release"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "success": false,
            "error": "hold 4103 changed state during release; retry"
        })))
        // Twice: the row is still selectable on the next run, which is the
        // whole point of not retiring it.
        .expect(2)
        .mount(&pms_mock)
        .await;

    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-sweep-retry@test.com").await;
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4103",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;

    let settings = sweep_settings(&pms_mock.uri());
    for _ in 0..2 {
        let released =
            loyalty_backend::services::pms_channel::release_expired_holds(app.db(), &settings)
                .await;
        assert_eq!(released, 0);
    }
    assert_eq!(booking_status(app.db(), booking_id).await, "pending");

    app.cleanup().await.ok();
}

/// A 404 — unknown id, or the channel router not mounted because the PMS's
/// canonical pool is down — is ambiguous, so the sweep does **not** retire
/// the row.
///
/// Cancelling on the second reading would throw away live bookings during a
/// PMS outage. The row keeps coming back, loudly, which is the intended
/// pressure.
#[tokio::test]
async fn a_release_404_is_not_treated_as_terminal() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings/hf-4104/release"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "success": false,
            "error": "loyalty-channel booking 4104 not found"
        })))
        .expect(2)
        .mount(&pms_mock)
        .await;

    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-sweep-404@test.com").await;
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4104",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;

    let settings = sweep_settings(&pms_mock.uri());
    for _ in 0..2 {
        loyalty_backend::services::pms_channel::release_expired_holds(app.db(), &settings).await;
    }
    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "pending",
        "an ambiguous 404 must not cancel a hold that may be perfectly live"
    );

    app.cleanup().await.ok();
}

/// A reference this client can never build a URL with.
///
/// No PMS call is possible, so the row is cancelled locally and taken out of
/// the sweep's selection — otherwise it is re-selected on every run forever.
/// It is deliberately **not** counted in `released`: nothing was released at
/// the PMS. That tally means one thing (see `release_expired_holds`).
#[tokio::test]
async fn the_sweep_retires_a_hold_whose_reference_it_can_never_call_with() {
    let pms_mock = MockServer::start().await;

    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-sweep-unusable@test.com").await;
    let booking_id = seed_channel_booking(
        app.db(),
        guest.id,
        "pms/../../evil",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;

    let settings = sweep_settings(&pms_mock.uri());
    let released =
        loyalty_backend::services::pms_channel::release_expired_holds(app.db(), &settings).await;

    assert_eq!(
        released, 0,
        "nothing was released — the PMS was never reachable for this row"
    );
    assert_eq!(
        booking_status(app.db(), booking_id).await,
        "cancelled",
        "but it must leave the sweep's selection, or it comes back every run"
    );
    assert!(
        pms_mock
            .received_requests()
            .await
            .unwrap_or_default()
            .is_empty(),
        "an id that fails validation must never reach a URL"
    );

    app.cleanup().await.ok();
}

/// The local cancel is `WHERE status = 'pending'`, and it must never be
/// counted when it moves no row.
///
/// Driven by racing the sweep the way production does: the batch is selected
/// up front, and while it is parked in the first release a confirmation
/// lands on the bookings. Both rows are confirmed mid-flight, so whichever
/// order the batch came back in — the sweep's SELECT has no `ORDER BY` —
/// every guarded cancel matches zero rows and the sweep must report nothing
/// released rather than claiming cancellations that never happened.
#[tokio::test]
async fn the_sweep_never_counts_a_cancel_that_moved_no_row() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path_regex(r"^/api/channel/bookings/hf-410[56]/release$"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({
                    "success": true,
                    "status": "cancelled",
                    "already_released": false
                }))
                // Wide enough that the interleave below is deterministic.
                .set_delay(std::time::Duration::from_millis(900)),
        )
        .mount(&pms_mock)
        .await;

    let app = TestApp::new().await.expect("create test app");
    let guest = seed_guest(&app, "a15-sweep-zero@test.com").await;

    let first = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4105",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;
    let second = seed_channel_booking(
        app.db(),
        guest.id,
        "hf-4106",
        "pending",
        Some(Utc::now() - Duration::hours(3)),
    )
    .await;

    let settings = sweep_settings(&pms_mock.uri());
    let pool = app.db().clone();

    let sweep = async {
        loyalty_backend::services::pms_channel::release_expired_holds(&pool, &settings).await
    };
    let interleave = async {
        // Inside the first release's delay: an admin verifies both slips.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        sqlx::query("UPDATE bookings SET status = 'confirmed' WHERE id = ANY($1)")
            .bind(vec![first, second])
            .execute(app.db())
            .await
            .expect("confirm both bookings mid-sweep");
    };
    let (released, ()) = tokio::join!(sweep, interleave);

    assert_eq!(
        released, 0,
        "the guarded cancel matched no row, so the sweep released nothing"
    );
    assert_eq!(
        booking_status(app.db(), first).await,
        "confirmed",
        "the cancel must lose cleanly to the confirmation, not overwrite it"
    );
    assert_eq!(booking_status(app.db(), second).await, "confirmed");

    app.cleanup().await.ok();
}

// ============================================================================
// 4. The hold-create guard (B8 race 2.3, checklist L5)
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
/// Fail loudly when Redis is not there.
///
/// `acquire_hold_guard` stands down when it cannot reach Redis — the right
/// production behaviour (a Redis outage must not stop the property taking
/// bookings) and a trap for tests: every *positive* lock assertion below
/// would pass vacuously, proving nothing. So the positive tests state the
/// precondition instead of assuming it.
async fn require_redis() {
    let client = redis::Client::open(test_redis_url()).expect("test Redis URL parses");
    let mut conn = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        client.get_multiplexed_async_connection(),
    )
    .await
    .expect("Redis connection did not time out")
    .expect("the hold guard needs Redis; without it this test proves nothing");
    let pong: String = redis::cmd("PING")
        .query_async(&mut conn)
        .await
        .expect("Redis answers PING");
    assert_eq!(pong, "PONG");
}

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

/// N7: a 4xx on the **create** path that is about us, not about the guest.
///
/// `parse_json` used to map every 4xx to `AppError::BadRequest`, so a rotated
/// `LOYALTY_CHANNEL_TOKEN` (401), a disabled HF Ville write gate (403) or an
/// unmounted channel router (404 — what a PMS with a dead PG pool looks like
/// from out here) reached the guest as "PMS rejected create booking". That
/// sends someone off to change dates that were never the problem. All three
/// are ours, and all three are 503.
///
/// A genuine guest-side 4xx — sold out, bad dates — stays a client error,
/// which the last case pins.
#[tokio::test]
async fn a_create_4xx_that_is_our_fault_is_an_outage_not_a_bad_request() {
    for (status, body) in [
        (401u16, "invalid channel token"),
        (403, "HF Ville writes are disabled"),
        (404, "not found"),
    ] {
        let pms_mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/channel/bookings"))
            .respond_with(ResponseTemplate::new(status).set_body_string(body))
            .expect(1)
            .mount(&pms_mock)
            .await;

        let client = pms_client(&pms_mock.uri());
        let phone = format!("0870000{}", &Uuid::new_v4().simple().to_string()[..6]);
        let err = client
            .create_booking(&hold_request(&phone))
            .await
            .expect_err("the PMS refused");

        assert_eq!(
            err.status_code(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "{status} is our problem, so the guest is told to try again, not \
             that their booking was rejected: {err}"
        );
        assert!(
            !matches!(err, loyalty_backend::AppError::BadRequest(_)),
            "{status} must not surface as a client error: {err}"
        );
    }

    // The contrast: a 4xx that really is about what was asked for.
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(400).set_body_string("no rooms of that type"))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri());
    let phone = format!("0880000{}", &Uuid::new_v4().simple().to_string()[..6]);
    let err = client
        .create_booking(&hold_request(&phone))
        .await
        .expect_err("sold out");
    assert!(
        matches!(err, loyalty_backend::AppError::BadRequest(_)),
        "a genuine guest-side refusal stays a client error: {err}"
    );
    assert_eq!(
        err.status_code(),
        axum::http::StatusCode::BAD_REQUEST,
        "{err}"
    );
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

    require_redis().await;
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
    assert!(
        !rendered.contains("  "),
        "the guest-facing message must not carry a collapsed line          continuation: {rendered}"
    );
}

/// The lock is released the moment the hold exists.
///
/// Holding it past a success would punish a guest who genuinely wants a
/// second room for the same nights, and it buys little: once the create
/// returns, the caller has a `pms_booking_id` and writes a local `bookings`
/// row the guest can see, so their next tap is no longer blind.
#[tokio::test]
async fn the_guard_is_released_once_the_hold_exists() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("hf-2")))
        .expect(2)
        .mount(&pms_mock)
        .await;

    require_redis().await;
    let client = pms_client(&pms_mock.uri());
    let phone = format!("0820000{}", &Uuid::new_v4().simple().to_string()[..6]);
    let request = hold_request(&phone);

    client
        .create_booking(&request)
        .await
        .expect("the first hold goes through");
    client
        .create_booking(&request)
        .await
        .expect("a deliberate second hold is not blocked by the first");
}

/// The branch the guard actually exists for: the PMS never answered, so it
/// is genuinely unknown whether a hold now exists.
///
/// This is B8 race 2.3 exactly — the guest gives up on a hung request and
/// taps "book" again. The lock stays until its TTL rather than letting the
/// retry create a second room.
#[tokio::test]
async fn the_guard_is_kept_when_the_outcome_is_unknown() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(502).set_body_string("bad gateway"))
        // Once: the retry must not reach the PMS at all.
        .expect(1)
        .mount(&pms_mock)
        .await;

    require_redis().await;
    let client = pms_client(&pms_mock.uri());
    let phone = format!("0860000{}", &Uuid::new_v4().simple().to_string()[..6]);
    let request = hold_request(&phone);

    let first = client.create_booking(&request).await;
    assert!(first.is_err(), "the PMS never gave an answer");

    let rendered = client
        .create_booking(&request)
        .await
        .expect_err("the retry is refused while the outcome is unknown")
        .to_string();
    assert!(
        rendered.contains("already being created"),
        "and refused by the guard, not by the PMS: {rendered}"
    );
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

    require_redis().await;
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

    require_redis().await;
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
