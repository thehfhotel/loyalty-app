//! Integration coverage for deposit request links (workstream B1).
//!
//! Reception issues one link for a booking it already took by phone, LINE
//! or at the desk; the guest opens it with no login and uploads a slip
//! that runs through the same `decide()` and audit path as any other.
//!
//! Every case drives the real handlers through the real router. What is
//! asserted, in the order the spec lists it:
//!
//! - **create** — 201, the deposit is exactly half the total, the booking
//!   is stamped `deposit_link` with a NULL `pms_booking_id` (the trap that
//!   would send a verified slip into a dark PMS), and the token comes back
//!   once. A non-admin gets 403.
//! - **read** — the guest page payload carries the amount and a PromptPay
//!   payload built from the *property's* receiving account, and **no phone
//!   number**. An unknown token is a bare 404.
//! - **upload** — a slip row appears with a recorded `slipok_status`, and
//!   the sixth upload inside the window is refused.
//! - **auto-verify** — with the flag on and everything matching: the slip
//!   verifies, the booking flips to `confirmed` **with no PMS call
//!   attempted**, and the audit row names the SlipOK system actor.
//! - **not payable / duplicate** — an upload after the link expired lands
//!   on `manual` / `booking_not_payable`; the same bank reference on a
//!   second link lands on `manual` / `duplicate`.
//! - **revoke / reissue** — a revoked link reads `revoked` and refuses
//!   uploads with 409; a reissue kills the old token and mints a new one.

use axum::body::Body;
use axum::http::{header, Request};
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use loyalty_backend::services::slip_confirm::SLIPOK_SYSTEM_USER_ID;

use crate::common::{TestApp, TestUser};

/// The property's receiving PromptPay ID for these tests. Deliberately
/// different from anything `PROMPTPAY_TAX_ID` would hold, so a QR built
/// from the group-wide account instead of the property's would show up.
const RECEIVING_ID: &str = "0105556123047";
/// A masked receiver value of the same length whose visible digits match.
const MASKED_RECEIVER: &str = "xxx-xxx-xxx3047";
/// SlipOK branch id; also the mock server's path.
const BRANCH_ID: &str = "test-branch";

// ============================================================================
// Fixtures
// ============================================================================

fn jpeg_bytes() -> Vec<u8> {
    let mut data = vec![0xFF, 0xD8, 0xFF, 0xE0];
    data.extend_from_slice(b"loyalty-deposit-link-slip");
    data
}

fn build_multipart(filename: &str, content_type: &str, data: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----LoyaltyDepositBoundaryK3z";
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

/// Seed one active room type and return its id. The booking needs it: the
/// admin booking list inner-joins `room_types`, so a link whose booking
/// has no room type is a booking reception never sees again.
async fn seed_room_type(pool: &sqlx::PgPool, name: &str) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO room_types (name, description, price_per_night, max_guests, is_active)
        VALUES ($1, 'fixture', 1500.00, 4, TRUE)
        RETURNING id
        "#,
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("insert room type fixture")
}

/// An admin who can issue links.
async fn seed_admin(app: &TestApp, email: &str) -> TestUser {
    let admin = TestUser::admin(email);
    admin.insert(app.db()).await.expect("insert admin");
    admin
}

fn create_body(room_type_id: Uuid, total: &str) -> Value {
    let today = Utc::now().date_naive();
    json!({
        "property": "hf",
        "guestName": "สมชาย ใจดี",
        "guestPhone": "0812345678",
        "checkIn": (today + Duration::days(10)).to_string(),
        "checkOut": (today + Duration::days(12)).to_string(),
        "guests": 2,
        "roomTypeId": room_type_id,
        "totalPrice": total,
    })
}

/// Issue a link as an admin and return the create response.
async fn issue_link(app: &TestApp, admin: &TestUser, room_type_id: Uuid, total: &str) -> Value {
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            "/api/admin/deposit-links",
            &create_body(room_type_id, total),
        )
        .await;
    response.assert_status(201);
    response.json().expect("create response is JSON")
}

/// POST a slip through the public endpoint. Returns (status, body).
async fn upload_slip_to_token(app: &TestApp, token: &str) -> (u16, Value) {
    let (boundary, body) = build_multipart("slip.jpg", "image/jpeg", &jpeg_bytes());

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/deposit/{}/slip", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .expect("build upload request");

    let resp = app.router().oneshot(req).await.expect("upload oneshot");
    let status = resp.status().as_u16();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("read upload body");
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
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

/// Config with a receiving account for HF but no SlipOK vendor.
fn promptpay_only(cfg: &mut loyalty_backend::Settings) {
    cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
}

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

// ============================================================================
// 1. Create
// ============================================================================

/// The create endpoint produces a booking the rest of the system already
/// knows how to handle, and hands back the token exactly once.
#[tokio::test]
async fn admin_create_issues_a_link_against_a_deposit_link_booking() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-create@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Create Deluxe").await;

    let body = issue_link(&app, &admin, room_type_id, "3000.00").await;

    // The deposit is exactly half — owner decision W4.
    assert_eq!(body["totalAmount"].as_f64(), Some(3000.0));
    assert_eq!(body["amountDueNow"].as_f64(), Some(1500.0));

    // The token is 32 bytes of base64url, and it is here and nowhere else.
    let token = body["token"].as_str().expect("token in create response");
    assert_eq!(token.len(), 43);
    assert!(body["url"].as_str().expect("url").ends_with(token));
    assert!(body["lineShareUrl"]
        .as_str()
        .expect("lineShareUrl")
        .starts_with("https://line.me/R/share?text="));

    let booking_id: Uuid = body["bookingId"]
        .as_str()
        .expect("bookingId")
        .parse()
        .expect("uuid");

    let (source, pms_booking_id, pms_ref, status, owner, amount_due, balance): (
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Uuid,
        Option<rust_decimal::Decimal>,
        Option<rust_decimal::Decimal>,
    ) = sqlx::query_as(
        r#"
        SELECT booking_source, pms_booking_id, pms_ref, status, user_id,
               amount_due_now, balance_due
        FROM bookings WHERE id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_one(app.db())
    .await
    .expect("read booking");

    assert_eq!(source.as_deref(), Some("deposit_link"));
    assert_eq!(
        pms_booking_id, None,
        "a non-null pms_booking_id would send a verified slip into the dark PMS channel"
    );
    assert_eq!(pms_ref, None);
    assert_eq!(status, "pending");
    assert_eq!(
        owner.hyphenated().to_string(),
        "00000000-0000-4000-8000-0000005110b2",
        "the booking must be owned by the non-loginable deposit-link actor, \
         never by a real member"
    );
    assert_eq!(amount_due, Some(rust_decimal::Decimal::new(150_000, 2)));
    assert_eq!(balance, Some(rust_decimal::Decimal::new(150_000, 2)));

    // The token is stored only as a hash.
    let stored_hash: Vec<u8> =
        sqlx::query_scalar("SELECT token_hash FROM booking_deposit_links WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(app.db())
            .await
            .expect("read token hash");
    assert_eq!(stored_hash.len(), 32);
    assert!(
        !String::from_utf8_lossy(&stored_hash).contains(token),
        "the plaintext token must never reach the database"
    );

    app.cleanup().await.ok();
}

/// The endpoint is admin-only. A signed-in customer is refused.
#[tokio::test]
async fn a_non_admin_cannot_issue_a_deposit_link() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let user = TestUser::new("deposit-nonadmin@test.com");
    user.insert(app.db()).await.expect("insert user");
    let room_type_id = seed_room_type(app.db(), "Deposit NonAdmin Deluxe").await;

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .post(
            "/api/admin/deposit-links",
            &create_body(room_type_id, "3000.00"),
        )
        .await;
    response.assert_status(403);

    app.cleanup().await.ok();
}

// ============================================================================
// 2. Read
// ============================================================================

/// The guest page payload: the amount, a QR built from the *property's*
/// receiving account, and nothing that identifies the guest beyond a
/// given name.
#[tokio::test]
async fn the_public_page_shows_the_amount_and_a_property_scoped_qr() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-read@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Read Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();

    let response = app.client().get(&format!("/api/deposit/{}", token)).await;
    response.assert_status(200);
    let body: Value = response.json().expect("public response is JSON");

    assert_eq!(body["state"].as_str(), Some("awaiting_payment"));
    assert_eq!(body["amountDueNow"].as_f64(), Some(1500.0));
    assert_eq!(body["totalAmount"].as_f64(), Some(3000.0));
    assert_eq!(body["currency"].as_str(), Some("THB"));
    assert_eq!(body["nights"].as_i64(), Some(2));
    assert_eq!(body["property"].as_str(), Some("hf"));
    assert_eq!(
        body["guestGivenName"].as_str(),
        Some("สมชาย"),
        "the page shows the given name only"
    );
    assert_eq!(
        body["roomTypeName"].as_str(),
        Some("Deposit Read Deluxe"),
        "the room type comes from the joined catalogue row"
    );

    let payload = body["promptpayQrPayload"]
        .as_str()
        .expect("a payable link carries a QR payload");
    assert!(payload.starts_with("000201"), "EMVCo payload: {payload}");
    // The QR has to be built from the property's account, not the
    // group-wide `PROMPTPAY_TAX_ID`; otherwise the matcher compares the
    // payee against a different id and every slip is `receiver_mismatch`.
    assert!(
        payload.contains(RECEIVING_ID),
        "the payload must carry the property's receiving id: {payload}"
    );

    // Nothing that identifies the guest beyond the given name.
    let raw = body.to_string();
    assert!(!raw.contains("0812345678"), "no phone number on the page");
    assert!(!raw.contains("ใจดี"), "no family name on the page");
    assert!(
        !raw.contains(created["bookingId"].as_str().expect("bookingId")),
        "no booking UUID on the page"
    );

    app.cleanup().await.ok();
}

/// An unknown token is a bare 404 — no hint about whether it was
/// well-formed, recently revoked, or never existed.
#[tokio::test]
async fn an_unknown_token_is_a_bare_404() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");

    let response = app
        .client()
        .get("/api/deposit/ZmFrZS10b2tlbi10aGF0LW5ldmVyLWV4aXN0ZWQtaGVyZQ")
        .await;
    response.assert_status(404);

    let (status, _) =
        upload_slip_to_token(&app, "ZmFrZS10b2tlbi10aGF0LW5ldmVyLWV4aXN0ZWQtaGVyZQ").await;
    assert_eq!(status, 404);

    app.cleanup().await.ok();
}

// ============================================================================
// 3. Upload and the per-link budget
// ============================================================================

/// The upload stores a slip against the booking and records a decision on
/// it, even with no SlipOK vendor configured — which is the state the
/// programme runs in until the vendor key lands.
#[tokio::test]
async fn an_upload_creates_a_slip_row_and_records_a_decision() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-upload@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Upload Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();
    let booking_id: Uuid = created["bookingId"]
        .as_str()
        .expect("bookingId")
        .parse()
        .expect("uuid");

    let (status, body) = upload_slip_to_token(&app, &token).await;
    assert_eq!(status, 201, "upload response: {body}");

    let slip_id: Uuid = body["slipId"]
        .as_str()
        .expect("slipId")
        .parse()
        .expect("uuid");
    assert_eq!(body["state"].as_str(), Some("checking"));

    let (slipok_status, slipok_reason, _, admin_status) = read_slip_state(app.db(), slip_id).await;
    assert_eq!(
        slipok_status.as_deref(),
        Some("unavailable"),
        "no vendor configured is recorded as a decision, not left blank"
    );
    assert_eq!(slipok_reason.as_deref(), Some("not_configured"));
    assert_eq!(admin_status.as_deref(), Some("pending"));

    let (stored_booking, uploaded_by): (Uuid, Uuid) =
        sqlx::query_as("SELECT booking_id, uploaded_by FROM booking_slips WHERE id = $1")
            .bind(slip_id)
            .fetch_one(app.db())
            .await
            .expect("read slip row");
    assert_eq!(stored_booking, booking_id);
    assert_eq!(
        uploaded_by.hyphenated().to_string(),
        "00000000-0000-4000-8000-0000005110b2"
    );

    // The public page now reports the same thing the row says.
    let page = app.client().get(&format!("/api/deposit/{}", token)).await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("checking"));
    assert_eq!(page["slipokStatus"].as_str(), Some("unavailable"));
    assert!(
        page["promptpayQrPayload"].is_string(),
        "a link still waiting on a verdict can still be paid"
    );

    app.cleanup().await.ok();
}

/// Five uploads per hour, per link. The budget is keyed on the link
/// rather than the address, because a guest whose phone changes IP
/// between attempts is still one link.
#[tokio::test]
async fn the_sixth_upload_on_one_link_is_refused() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-ratelimit@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit RateLimit Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();

    for attempt in 1..=5 {
        let (status, body) = upload_slip_to_token(&app, &token).await;
        assert_eq!(status, 201, "upload {attempt} should be accepted: {body}");
    }

    let (status, _) = upload_slip_to_token(&app, &token).await;
    assert_eq!(
        status, 429,
        "the sixth upload inside the window must be refused"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 4. Auto-verify
// ============================================================================

/// Flag on, everything matches: the slip verifies, the booking flips to
/// `confirmed` **without any PMS call**, and the decision is audited
/// against the SlipOK system actor.
#[tokio::test]
async fn auto_verify_confirms_a_deposit_link_booking_without_touching_the_pms() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "DEPOSITLINK0001",
                1500.0,
                MASKED_RECEIVER,
            )),
        )
        .expect(1)
        .mount(&slipok_mock)
        .await;

    // Any PMS traffic at all is a bug: a deposit-link booking has no
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
    let admin = seed_admin(&app, "deposit-autoverify@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit AutoVerify Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();
    let booking_id: Uuid = created["bookingId"]
        .as_str()
        .expect("bookingId")
        .parse()
        .expect("uuid");

    let (status, body) = upload_slip_to_token(&app, &token).await;
    assert_eq!(status, 201, "upload response: {body}");
    let slip_id: Uuid = body["slipId"]
        .as_str()
        .expect("slipId")
        .parse()
        .expect("uuid");

    // The guest sees the outcome in the upload's own response — no poll,
    // no refetch.
    assert_eq!(body["state"].as_str(), Some("confirmed"));
    assert_eq!(body["slipokStatus"].as_str(), Some("verified"));

    let (slipok_status, slipok_reason, trans_ref, admin_status) =
        read_slip_state(app.db(), slip_id).await;
    assert_eq!(slipok_status.as_deref(), Some("verified"));
    assert_eq!(slipok_reason, None);
    assert_eq!(trans_ref.as_deref(), Some("DEPOSITLINK0001"));
    assert_eq!(admin_status.as_deref(), Some("verified"));

    let booking_status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_one(app.db())
        .await
        .expect("read booking status");
    assert_eq!(
        booking_status, "confirmed",
        "a deposit-link booking has no PMS to tell, so the verified slip is \
         the whole payment event"
    );

    // The `slip_verified` row is attributed to the SlipOK actor. The
    // `deposit_link_issued` row from the create call is the admin's.
    let (audit_admin_id, audit_reason): (Uuid, Option<String>) = sqlx::query_as(
        r#"
        SELECT admin_id, reason FROM booking_audit_log
        WHERE booking_id = $1 AND action = 'slip_verified'
        "#,
    )
    .bind(booking_id)
    .fetch_one(app.db())
    .await
    .expect("exactly one slip_verified audit row");
    assert_eq!(audit_admin_id, SLIPOK_SYSTEM_USER_ID);
    assert!(audit_reason
        .as_deref()
        .is_some_and(|r| r.contains("DEPOSITLINK0001")));

    // The page has moved on, and no longer offers a QR to pay again.
    let page = app.client().get(&format!("/api/deposit/{}", token)).await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("confirmed"));
    assert!(
        page["promptpayQrPayload"].is_null(),
        "a paid link must not keep handing out a payable QR"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 5. Not payable, and duplicates
// ============================================================================

/// A slip uploaded after the link ran out is accepted — the guest already
/// sent the money — but never auto-confirmed. It lands in the manual
/// queue on `booking_not_payable`, the branch the PMS channel already
/// uses for an expired hold.
#[tokio::test]
async fn a_slip_uploaded_after_the_link_expired_lands_in_the_manual_queue() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "EXPIREDLINK0001",
                1500.0,
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
    let admin = seed_admin(&app, "deposit-expired@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Expired Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();
    let booking_id: Uuid = created["bookingId"]
        .as_str()
        .expect("bookingId")
        .parse()
        .expect("uuid");

    // Wind both clocks back. The API refuses to issue an already-dead
    // link, so the only way to reach this state is to age the fixture.
    let past = Utc::now() - Duration::hours(1);
    sqlx::query("UPDATE booking_deposit_links SET expires_at = $1 WHERE booking_id = $2")
        .bind(past)
        .bind(booking_id)
        .execute(app.db())
        .await
        .expect("age the link");
    sqlx::query("UPDATE bookings SET hold_expires_at = $1 WHERE id = $2")
        .bind(past)
        .bind(booking_id)
        .execute(app.db())
        .await
        .expect("age the booking");

    let page = app.client().get(&format!("/api/deposit/{}", token)).await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("expired"));
    assert!(
        page["promptpayQrPayload"].is_null(),
        "an expired link must not keep handing out a payable QR"
    );

    let (status, body) = upload_slip_to_token(&app, &token).await;
    assert_eq!(
        status, 201,
        "the guest already transferred the money; refusing the image would \
         leave them with a payment and nowhere to show it: {body}"
    );
    let slip_id: Uuid = body["slipId"]
        .as_str()
        .expect("slipId")
        .parse()
        .expect("uuid");

    let (slipok_status, slipok_reason, trans_ref, admin_status) =
        read_slip_state(app.db(), slip_id).await;
    assert_eq!(slipok_status.as_deref(), Some("manual"));
    assert_eq!(slipok_reason.as_deref(), Some("booking_not_payable"));
    assert_eq!(
        trans_ref, None,
        "a rejected slip must not occupy the unique index — the guest may \
         legitimately re-upload the same transfer once the desk sorts it out"
    );
    assert_eq!(admin_status.as_deref(), Some("pending"));

    let booking_status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_one(app.db())
        .await
        .expect("read booking status");
    assert_eq!(booking_status, "pending");

    app.cleanup().await.ok();
}

/// The same bank reference presented against a second link is a
/// duplicate: one transfer cannot pay two deposits.
#[tokio::test]
async fn the_same_bank_reference_on_a_second_link_is_a_duplicate() {
    let slipok_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/{}", BRANCH_ID)))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(slipok_success_body(
                "SHAREDREF0001",
                1500.0,
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
        // Shadow mode, which is what ships: the first slip records the
        // reference without verifying anything.
        cfg.slipok.auto_verify = false;
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
    };

    let app = TestApp::new_with_config(&mutate)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-duplicate@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Duplicate Deluxe").await;

    let first = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let second = issue_link(&app, &admin, room_type_id, "3000.00").await;

    let (status, body) = upload_slip_to_token(&app, first["token"].as_str().unwrap()).await;
    assert_eq!(status, 201, "{body}");
    let first_slip: Uuid = body["slipId"].as_str().unwrap().parse().unwrap();
    let (slipok_status, _, trans_ref, _) = read_slip_state(app.db(), first_slip).await;
    assert_eq!(slipok_status.as_deref(), Some("shadow_pass"));
    assert_eq!(trans_ref.as_deref(), Some("SHAREDREF0001"));

    let (status, body) = upload_slip_to_token(&app, second["token"].as_str().unwrap()).await;
    assert_eq!(status, 201, "{body}");
    let second_slip: Uuid = body["slipId"].as_str().unwrap().parse().unwrap();
    let (slipok_status, slipok_reason, trans_ref, _) = read_slip_state(app.db(), second_slip).await;
    assert_eq!(slipok_status.as_deref(), Some("manual"));
    assert_eq!(slipok_reason.as_deref(), Some("duplicate"));
    assert_eq!(trans_ref, None);

    app.cleanup().await.ok();
}

// ============================================================================
// 6. Revoke and reissue
// ============================================================================

/// Revoking kills the link for reading *and* for paying: the page says so,
/// and the upload is refused rather than silently accepted against a
/// booking reception has moved on from.
#[tokio::test]
async fn a_revoked_link_reads_revoked_and_refuses_uploads() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-revoke@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Revoke Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();
    let link_id = created["linkId"].as_str().expect("linkId").to_string();

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post_empty(&format!("/api/admin/deposit-links/{}/revoke", link_id))
        .await;
    response.assert_status(200);
    let revoked: Value = response.json().expect("revoke response");
    assert_eq!(revoked["state"].as_str(), Some("revoked"));

    let page = app.client().get(&format!("/api/deposit/{}", token)).await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(
        page["state"].as_str(),
        Some("revoked"),
        "a dead link answers 200 so the guest can be told to call the desk"
    );
    assert!(page["promptpayQrPayload"].is_null());

    let (status, _) = upload_slip_to_token(&app, &token).await;
    assert_eq!(status, 409);

    // Pressing Revoke twice is not an error.
    let response = client
        .post_empty(&format!("/api/admin/deposit-links/{}/revoke", link_id))
        .await;
    response.assert_status(200);

    app.cleanup().await.ok();
}

/// Reissue mints a live token for the same booking and kills the old one.
#[tokio::test]
async fn reissue_kills_the_old_token_and_mints_a_new_one() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-reissue@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Reissue Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let old_token = created["token"].as_str().expect("token").to_string();
    let link_id = created["linkId"].as_str().expect("linkId").to_string();
    let booking_id = created["bookingId"]
        .as_str()
        .expect("bookingId")
        .to_string();

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            &format!("/api/admin/deposit-links/{}/reissue", link_id),
            &json!({ "expiresInHours": 24 }),
        )
        .await;
    response.assert_status(201);
    let reissued: Value = response.json().expect("reissue response");

    let new_token = reissued["token"].as_str().expect("token").to_string();
    assert_ne!(new_token, old_token);
    assert_eq!(
        reissued["bookingId"].as_str(),
        Some(booking_id.as_str()),
        "a reissue replaces the link, not the booking"
    );
    assert_eq!(reissued["amountDueNow"].as_f64(), Some(1500.0));

    // The old token is dead...
    let page = app
        .client()
        .get(&format!("/api/deposit/{}", old_token))
        .await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("revoked"));
    let (status, _) = upload_slip_to_token(&app, &old_token).await;
    assert_eq!(status, 409);

    // ...and the new one is live.
    let page = app
        .client()
        .get(&format!("/api/deposit/{}", new_token))
        .await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("awaiting_payment"));
    assert!(page["promptpayQrPayload"].is_string());

    // `hold_expires_at` moves with the new link, or `slipok_check` would
    // reject the very slip the reissue exists to collect.
    let (hold_expires, link_expires): (
        Option<chrono::DateTime<Utc>>,
        Option<chrono::DateTime<Utc>>,
    ) = sqlx::query_as(
        r#"
        SELECT b.hold_expires_at,
               (SELECT expires_at FROM booking_deposit_links
                WHERE booking_id = b.id AND revoked_at IS NULL)
        FROM bookings b WHERE b.id = $1
        "#,
    )
    .bind(booking_id.parse::<Uuid>().unwrap())
    .fetch_one(app.db())
    .await
    .expect("read expiries");
    assert_eq!(hold_expires, link_expires);

    app.cleanup().await.ok();
}

// ============================================================================
// The admin list
// ============================================================================

/// The list computes the same state vocabulary the guest page does, and
/// the `open` filter is the one reception lives in.
#[tokio::test]
async fn the_admin_list_reports_state_and_filters_on_it() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-list@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit List Deluxe").await;

    let open = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let doomed = issue_link(&app, &admin, room_type_id, "4000.00").await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .post_empty(&format!(
            "/api/admin/deposit-links/{}/revoke",
            doomed["linkId"].as_str().unwrap()
        ))
        .await
        .assert_status(200);

    let response = client.get("/api/admin/deposit-links").await;
    response.assert_status(200);
    let all: Value = response.json().expect("list response");
    assert_eq!(all["total"].as_i64(), Some(2));

    let response = client.get("/api/admin/deposit-links?status=open").await;
    response.assert_status(200);
    let body: Value = response.json().expect("list response");
    assert_eq!(body["total"].as_i64(), Some(1));
    let links = body["links"].as_array().expect("links array");
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["linkId"].as_str(), open["linkId"].as_str());
    assert_eq!(links[0]["state"].as_str(), Some("awaiting_payment"));
    assert_eq!(links[0]["amountDueNow"].as_f64(), Some(1500.0));
    assert_eq!(links[0]["property"].as_str(), Some("hf"));
    assert_eq!(
        links[0]["issuedByName"].as_str(),
        Some("deposit-list@test.com"),
        "an admin with no profile row falls back to their email"
    );

    let response = client.get("/api/admin/deposit-links?status=revoked").await;
    response.assert_status(200);
    let body: Value = response.json().expect("list response");
    assert_eq!(body["total"].as_i64(), Some(1));
    assert_eq!(
        body["links"][0]["linkId"].as_str(),
        doomed["linkId"].as_str()
    );

    // An unknown filter is a 400, not a silently empty list.
    client
        .get("/api/admin/deposit-links?status=whatever")
        .await
        .assert_status(400);

    app.cleanup().await.ok();
}
