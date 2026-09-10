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
//!   the sixth *stored* slip inside the window is refused. Files the
//!   storage writer rejects, and uploads to a revoked link, cost the guest
//!   nothing: the budget counts slips, not attempts.
//! - **auto-verify** — with the flag on and everything matching: the slip
//!   verifies, the booking flips to `confirmed` **with no PMS call
//!   attempted**, and the audit row names the SlipOK system actor.
//! - **not payable / duplicate** — an upload after the link expired lands
//!   on `manual` / `booking_not_payable`; the same bank reference on a
//!   second link lands on `manual` / `duplicate`.
//! - **revoke / reissue** — a revoked link reads `revoked` and refuses
//!   uploads with 409; a reissue kills every live token and mints a new
//!   one, twice in a row without tripping the one-live-link index; a
//!   malformed reissue body is a 400 rather than a silent default.
//! - **configuration** — a property with no PromptPay receiving account
//!   is a 400 that names it, and writes nothing.

use axum::body::Body;
use axum::http::{header, Request};
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use loyalty_backend::services::slip_confirm::SLIPOK_SYSTEM_USER_ID;

use crate::common::{TestApp, TestResponse, TestUser};

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

/// The header the public routes take their capability in. Never a path
/// segment: a path is written to the nginx and Cloudflare access logs, and
/// this value is a bearer credential for a payment.
const TOKEN_HEADER: &str = "X-Deposit-Token";

/// GET the guest page for a token.
async fn read_link(app: &TestApp, token: &str) -> TestResponse {
    app.client()
        .with_header(TOKEN_HEADER, token)
        .get("/api/deposit")
        .await
}

/// GET the guest page as a particular client behind the trusted proxy.
async fn read_link_from(app: &TestApp, token: &str, client_ip: &str) -> TestResponse {
    app.client()
        .with_header(TOKEN_HEADER, token)
        .with_header("X-Forwarded-For", client_ip)
        .get("/api/deposit")
        .await
}

/// POST a slip through the public endpoint. Returns (status, body).
async fn upload_slip_to_token(app: &TestApp, token: &str) -> (u16, Value) {
    upload_file_to_token(app, token, "slip.jpg", "image/jpeg", &jpeg_bytes()).await
}

/// POST an arbitrary file through the public endpoint, so a test can send
/// the things a guest's phone actually sends when they pick the wrong one.
async fn upload_file_to_token(
    app: &TestApp,
    token: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> (u16, Value) {
    let (boundary, body) = build_multipart(filename, content_type, data);

    let req = Request::builder()
        .method("POST")
        .uri("/api/deposit/slip")
        .header(TOKEN_HEADER, token)
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

/// The columns of `bookings` that say what kind of booking a deposit link
/// produced. A named row rather than a seven-wide tuple: the assertions
/// below read as claims about a booking, not as positional unpacking.
#[derive(Debug, sqlx::FromRow)]
struct BookingShape {
    booking_source: Option<String>,
    pms_booking_id: Option<String>,
    pms_ref: Option<String>,
    status: String,
    user_id: Uuid,
    amount_due_now: Option<rust_decimal::Decimal>,
    balance_due: Option<rust_decimal::Decimal>,
}

async fn read_booking_shape(pool: &sqlx::PgPool, booking_id: Uuid) -> BookingShape {
    sqlx::query_as::<_, BookingShape>(
        r#"
        SELECT booking_source, pms_booking_id, pms_ref, status, user_id,
               amount_due_now, balance_due
        FROM bookings WHERE id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .expect("read booking")
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
    // ...and it is in the URL's **fragment**, which no server on the way
    // ever sees. A token in the path would be written into the frontend
    // nginx access log and Cloudflare's HTTP logs on every page load.
    let url = body["url"].as_str().expect("url");
    assert!(
        url.ends_with(&format!("/d#{token}")),
        "guest link shape: {url}"
    );
    let (before_fragment, _) = url.split_once('#').expect("the token is a fragment");
    assert!(
        !before_fragment.contains(token),
        "no part of the URL a server sees may carry the token: {url}"
    );
    assert!(body["lineShareUrl"]
        .as_str()
        .expect("lineShareUrl")
        .starts_with("https://line.me/R/share?text="));

    let booking_id: Uuid = body["bookingId"]
        .as_str()
        .expect("bookingId")
        .parse()
        .expect("uuid");

    let booking = read_booking_shape(app.db(), booking_id).await;

    assert_eq!(booking.booking_source.as_deref(), Some("deposit_link"));
    assert_eq!(
        booking.pms_booking_id, None,
        "a non-null pms_booking_id would send a verified slip into the dark PMS channel"
    );
    assert_eq!(booking.pms_ref, None);
    assert_eq!(booking.status, "pending");
    assert_eq!(
        booking.user_id.hyphenated().to_string(),
        "00000000-0000-4000-8000-0000005110b2",
        "the booking must be owned by the non-loginable deposit-link actor, \
         never by a real member"
    );
    assert_eq!(
        booking.amount_due_now,
        Some(rust_decimal::Decimal::new(150_000, 2))
    );
    assert_eq!(
        booking.balance_due,
        Some(rust_decimal::Decimal::new(150_000, 2))
    );

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

    let response = read_link(&app, &token).await;
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

    let response = read_link(&app, "ZmFrZS10b2tlbi10aGF0LW5ldmVyLWV4aXN0ZWQtaGVyZQ").await;
    response.assert_status(404);

    let (status, _) =
        upload_slip_to_token(&app, "ZmFrZS10b2tlbi10aGF0LW5ldmVyLWV4aXN0ZWQtaGVyZQ").await;
    assert_eq!(status, 404);

    app.cleanup().await.ok();
}

/// A missing or malformed `X-Deposit-Token` answers exactly what an
/// unknown token answers: 404, with nothing in the body that separates
/// the cases.
///
/// The point is not the status code, it is that all four responses are
/// **identical**. A scanner that could tell "no header" from "bad header"
/// from "no such link" would have an oracle for guessing tokens.
#[tokio::test]
async fn a_missing_or_malformed_token_header_is_the_same_404_as_an_unknown_token() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-header@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Header Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "2000.00").await;
    let token = created["token"].as_str().expect("token").to_string();

    // The live token works, so the fixture is real.
    read_link(&app, &token).await.assert_status(200);

    // No header at all.
    let bare = app.client().get("/api/deposit").await;
    bare.assert_status(404);
    let bare_body: Value = bare.json().unwrap_or(Value::Null);

    // Malformed: empty, blank, too short, too long, and carrying
    // characters outside the base64url alphabet (a path traversal, a
    // space, dots).
    //
    // No CR/LF case here on purpose: `HeaderValue` refuses to hold one, so
    // a header carrying a newline cannot be built, sent or received at
    // all. That is a stronger guarantee than a 404, and it belongs to the
    // HTTP layer rather than to this handler.
    let too_long = "a".repeat(200);
    for bad in [
        "",
        "   ",
        "short",
        "../../etc/passwd",
        "has spaces in it here",
        "token.with.dots.in.it",
        "!!!!!!!!!!!!!!!!!!!!",
        too_long.as_str(),
    ] {
        let response = read_link(&app, bad).await;
        assert_eq!(
            response.status, 404,
            "a malformed token header must be a 404: {bad:?}"
        );
        let body: Value = response.json().unwrap_or(Value::Null);
        assert_eq!(
            body, bare_body,
            "every failure on this route must answer identically: {bad:?}"
        );

        let (status, _) = upload_slip_to_token(&app, bad).await;
        assert_eq!(status, 404, "and the same on the upload: {bad:?}");
    }

    // An unknown but *well-formed* token is the same answer again.
    let unknown = read_link(&app, "ZmFrZS10b2tlbi10aGF0LW5ldmVyLWV4aXN0ZWQtaGVyZQ").await;
    unknown.assert_status(404);
    let unknown_body: Value = unknown.json().unwrap_or(Value::Null);
    assert_eq!(unknown_body, bare_body);

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
    let page = read_link(&app, &token).await;
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

/// The five-slips-an-hour budget counts slips we STORED, not attempts.
///
/// A guest who has already transferred the money and then picks the wrong
/// file five times — a WebP screenshot out of an Android gallery, a PDF
/// out of a bank app — must not be locked out for an hour from the only
/// page that lets them show proof of payment.
#[tokio::test]
async fn rejected_files_do_not_burn_the_five_slip_budget() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-badfiles@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit BadFiles Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();

    // Five files the storage writer refuses: an unsupported image type,
    // and a JPEG-labelled file whose magic bytes say otherwise.
    for attempt in 1..=5 {
        let (status, _) = upload_file_to_token(
            &app,
            &token,
            "screenshot.webp",
            "image/webp",
            b"RIFF____WEBPVP8 not a jpeg",
        )
        .await;
        assert_eq!(
            status, 400,
            "attempt {attempt} is a rejected file, not a stored slip"
        );
    }

    let (status, body) = upload_slip_to_token(&app, &token).await;
    assert_eq!(
        status, 201,
        "a real slip after five rejected files must still be accepted: {body}"
    );

    app.cleanup().await.ok();
}

/// A revoked link answers 409 without spending one of the guest's five
/// slips either — there is nothing they can do about a revocation.
#[tokio::test]
async fn a_revoked_link_does_not_spend_the_budget() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-revokedbudget@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit RevokedBudget Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();
    let link_id = created["linkId"].as_str().expect("linkId").to_string();

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .post_empty(&format!("/api/admin/deposit-links/{}/revoke", link_id))
        .await
        .assert_status(200);

    for _ in 0..6 {
        let (status, _) = upload_slip_to_token(&app, &token).await;
        assert_eq!(
            status, 409,
            "a revoked link stays a 409 and never turns into a 429"
        );
    }

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

    // The two columns that decide whether the PMS is called at all.
    // `slip_confirm` looks for `pms_booking_id IS NOT NULL` to find a
    // channel booking, and flips a non-channel one only when
    // `booking_source = 'deposit_link'`. The `.expect(0)` on the PMS mock
    // above is the outcome; this is the state that produced it, asserted so
    // a future writer of this row cannot make the mock pass by accident.
    let booking = read_booking_shape(app.db(), booking_id).await;
    assert_eq!(
        booking.pms_booking_id, None,
        "a deposit-link booking holds no PMS reference, so nothing addresses the PMS"
    );
    assert_eq!(booking.booking_source.as_deref(), Some("deposit_link"));

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
    let page = read_link(&app, &token).await;
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

    let page = read_link(&app, &token).await;
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

    let page = read_link(&app, &token).await;
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
    let page = read_link(&app, &old_token).await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("revoked"));
    let (status, _) = upload_slip_to_token(&app, &old_token).await;
    assert_eq!(status, 409);

    // ...and the new one is live.
    let page = read_link(&app, &new_token).await;
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

/// Reissue twice on the SAME link id, which is what reception does when
/// they double-click, retry after a timeout, or press Reissue on a link
/// an earlier reissue already replaced (the desk still has the old link
/// id on screen).
///
/// Revoking only the named row is a no-op the second time, so the insert
/// used to be the second live link on the booking and the partial unique
/// index turned the whole thing into a bare 500 — on the one operation
/// whose purpose is to recover a lost link.
#[tokio::test]
async fn reissuing_the_same_link_twice_hands_back_a_link_not_a_500() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-reissue-twice@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Reissue Twice Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let link_id = created["linkId"].as_str().expect("linkId").to_string();
    let booking_id: Uuid = created["bookingId"]
        .as_str()
        .expect("bookingId")
        .parse()
        .expect("bookingId is a UUID");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let first = client
        .post_empty(&format!("/api/admin/deposit-links/{}/reissue", link_id))
        .await;
    first.assert_status(201);
    let first: Value = first.json().expect("first reissue response");

    // Same link id again — the desk never learned the new one.
    let second = client
        .post_empty(&format!("/api/admin/deposit-links/{}/reissue", link_id))
        .await;
    second.assert_status(201);
    let second: Value = second.json().expect("second reissue response");

    assert_ne!(
        first["token"].as_str(),
        second["token"].as_str(),
        "each reissue mints a fresh token"
    );

    // Exactly one live link on the booking, and it is the newest one.
    let live: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM booking_deposit_links WHERE booking_id = $1 AND revoked_at IS NULL"#,
    )
    .bind(booking_id)
    .fetch_all(app.db())
    .await
    .expect("read live links");
    assert_eq!(live.len(), 1, "one live link per booking, always");
    assert_eq!(
        live[0].to_string(),
        second["linkId"].as_str().expect("linkId"),
        "the survivor is the link the last reissue minted"
    );

    // The link the FIRST reissue minted is dead, and its page says so.
    let page = read_link(&app, first["token"].as_str().expect("token")).await;
    page.assert_status(200);
    let page: Value = page.json().expect("page JSON");
    assert_eq!(page["state"].as_str(), Some("revoked"));

    app.cleanup().await.ok();
}

/// A body that is present but unreadable is a 400, not a silent fallback
/// to the 48-hour default. `{"expiresInHours": "24"}` is what a form
/// field bound straight to an input produces.
#[tokio::test]
async fn a_malformed_reissue_body_is_refused_rather_than_ignored() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-reissue-body@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Reissue Body Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let link_id = created["linkId"].as_str().expect("linkId").to_string();

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .post(
            &format!("/api/admin/deposit-links/{}/reissue", link_id),
            &json!({ "expiresInHours": "24" }),
        )
        .await
        .assert_status(400);

    // An empty body still means "use the default expiry".
    client
        .post_empty(&format!("/api/admin/deposit-links/{}/reissue", link_id))
        .await
        .assert_status(201);

    app.cleanup().await.ok();
}

// ============================================================================
// Configuration
// ============================================================================

/// A property with no PromptPay receiving account is a 400 naming the
/// property, not a 500 saying "Server configuration error". Reception
/// issuing the first link after a misspelt `PROMPTPAY_HF_ID` should read
/// the answer and fix the variable, not page someone.
#[tokio::test]
async fn a_property_with_no_receiving_account_is_a_named_400() {
    // Default test config carries no PromptPay ids at all.
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "deposit-noqr@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit NoQr Deluxe").await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .post(
            "/api/admin/deposit-links",
            &create_body(room_type_id, "3000.00"),
        )
        .await;
    response.assert_status(400);

    // Nothing was written: a link the guest could never pay is worse than
    // no link at all.
    let bookings: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM bookings WHERE room_type_id = $1"#)
            .bind(room_type_id)
            .fetch_one(app.db())
            .await
            .expect("count bookings for this fixture room type");
    assert_eq!(bookings, 0);

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

// ============================================================================
// The public limiter: whose bucket is it?
// ============================================================================
//
// These endpoints have no authentication, so their budgets are the only
// thing standing between a leaked token and the storage volume. Three
// layers, and each one is here because the other two cannot do its job:
//
// - per client IP, resolved from `X-Forwarded-For` because behind nginx
//   the TCP peer is the same container for every guest on earth;
// - one global bucket per route, because a caller who varies the token
//   mints a fresh per-token bucket every time;
// - per link, because a phone that changes IP mid-payment is still one
//   guest and one link.

/// Two guests behind the same nginx get **separate** budgets, and the one
/// that overruns is the only one refused.
///
/// This is the whole reason the limiter reads `X-Forwarded-For` at all. If
/// it keyed on the TCP peer, both guests below would share one bucket:
/// the first to poll would spend it and the second would meet a 429 in the
/// middle of paying, having done nothing wrong.
#[tokio::test]
async fn two_clients_behind_the_same_proxy_get_separate_ip_budgets() {
    const NOISY: &str = "203.0.113.10";
    const QUIET: &str = "198.51.100.20";
    // Must match `deposit_links::READ_PER_IP`.
    const READ_PER_IP: usize = 30;

    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-iplimit@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit IpLimit Deluxe").await;

    // Two links, so the per-link budget can never be the thing that fires
    // below: each token is asked for far fewer times than its own budget.
    let first = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let second = issue_link(&app, &admin, room_type_id, "4000.00").await;
    let first_token = first["token"].as_str().expect("token").to_string();
    let second_token = second["token"].as_str().expect("token").to_string();

    // The noisy client spends its whole per-IP budget on one link.
    for request in 1..=READ_PER_IP {
        let response = read_link_from(&app, &first_token, NOISY).await;
        assert_eq!(
            response.status, 200,
            "read {request} of {READ_PER_IP} is inside the budget"
        );
    }

    // One more from the same client — on a *different* link, whose own
    // bucket has been touched once. Only the per-IP bucket is over, so a
    // 429 here can mean nothing else.
    let over = read_link_from(&app, &second_token, NOISY).await;
    assert_eq!(
        over.status, 429,
        "the client that overran its budget is refused"
    );

    // The quiet client, arriving through the same nginx on the same TCP
    // connection as far as the backend can see, is untouched.
    let unaffected = read_link_from(&app, &second_token, QUIET).await;
    assert_eq!(
        unaffected.status, 200,
        "a second guest behind the same proxy must have their own bucket"
    );

    app.cleanup().await.ok();
}

/// The global bucket is one bucket, and varying the token does not mint a
/// second one.
///
/// Sized so that it never fires for real traffic, so what is asserted here
/// is its *key*: two requests that differ in both token and client address
/// land on the same counter. Were the global subject to include either,
/// the layer would be worthless — rotating tokens is exactly what a
/// scanner does.
#[tokio::test]
async fn the_global_bucket_counts_every_caller_on_one_key() {
    use redis::AsyncCommands;

    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-global@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit Global Deluxe").await;
    let first = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let second = issue_link(&app, &admin, room_type_id, "4000.00").await;

    read_link_from(
        &app,
        first["token"].as_str().expect("token"),
        "203.0.113.10",
    )
    .await
    .assert_status(200);
    read_link_from(
        &app,
        second["token"].as_str().expect("token"),
        "198.51.100.20",
    )
    .await
    .assert_status(200);
    // A caller with no usable token pays the global budget too: it reached
    // a public endpoint and cost us the work of answering.
    read_link_from(&app, "not-a-real-token-shape!!", "192.0.2.30")
        .await
        .assert_status(404);

    let mut redis = app.redis();
    let keys: Vec<String> = redis
        .keys(format!(
            "rate_limit:{}:deposit_global:*",
            app.rate_limit_namespace()
        ))
        .await
        .expect("list global buckets");
    assert_eq!(
        keys.len(),
        1,
        "three callers, three tokens, three addresses — one global bucket: {keys:?}"
    );
    let count: i64 = redis.get(&keys[0]).await.expect("read the global bucket");
    assert_eq!(count, 3, "every public read is counted on it");

    app.cleanup().await.ok();
}

/// A caller over the stored-slip budget leaves **nothing on disk**.
///
/// Storage is a shared volume with a retention job over it and this
/// endpoint has no authentication at all. An implementation that writes
/// the file first and charges the budget afterwards answers 429 while
/// still accepting the bytes — so a token holder fills the volume five
/// slips at a time and the budget only changes the status code.
#[tokio::test]
async fn a_slip_over_the_budget_is_never_written_to_storage() {
    let app = TestApp::new_with_config(&promptpay_only)
        .await
        .expect("create test app");
    let admin = seed_admin(&app, "deposit-nowrite@test.com").await;
    let room_type_id = seed_room_type(app.db(), "Deposit NoWrite Deluxe").await;
    let created = issue_link(&app, &admin, room_type_id, "3000.00").await;
    let token = created["token"].as_str().expect("token").to_string();

    // Spend the five-slips-an-hour budget.
    for attempt in 1..=5 {
        let (status, body) = upload_slip_to_token(&app, &token).await;
        assert_eq!(status, 201, "upload {attempt} is inside the budget: {body}");
    }

    // The sixth is a perfectly valid JPEG carrying a marker no other test
    // could have written. Files are named by UUID, so the marker is how
    // this test recognises its own bytes on the shared volume.
    let marker = format!("over-budget-{}", Uuid::new_v4());
    let mut payload = vec![0xFF, 0xD8, 0xFF, 0xE0];
    payload.extend_from_slice(marker.as_bytes());

    let (status, _) = upload_file_to_token(&app, &token, "slip.jpg", "image/jpeg", &payload).await;
    assert_eq!(status, 429, "the sixth stored slip is over the budget");

    assert!(
        !slip_storage_contains(marker.as_bytes()),
        "a refused upload must not leave its bytes in slip storage"
    );

    // ...and no row either, so nothing downstream ever sees it.
    let slips: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM booking_slips WHERE booking_id = $1")
        .bind(
            Uuid::parse_str(created["bookingId"].as_str().expect("bookingId"))
                .expect("booking uuid"),
        )
        .fetch_one(app.db())
        .await
        .expect("count slips");
    assert_eq!(slips, 5, "five stored, and the refused one stored nowhere");

    app.cleanup().await.ok();
}

/// Does any file in slip storage contain these bytes?
///
/// The suite shares one storage directory (`STORAGE_PATH` is per process,
/// not per test), so a test can only ask about bytes it made unique.
/// Slips are tiny; anything large is somebody else's fixture and skipped.
fn slip_storage_contains(needle: &[u8]) -> bool {
    let base = std::env::var("STORAGE_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("storage")
        })
        .join("slips");

    let Ok(entries) = std::fs::read_dir(&base) else {
        // No directory at all is the strongest possible "not written".
        return false;
    };

    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > 4096 {
            continue;
        }
        if let Ok(bytes) = std::fs::read(entry.path()) {
            if bytes.windows(needle.len()).any(|window| window == needle) {
                return true;
            }
        }
    }
    false
}
