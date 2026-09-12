//! A19 — the PMS channel's machine `reason`, end to end.
//!
//! Since new-hotel #311 every `/api/channel/*` error body carries a stable
//! `reason`. It exists because the status alone cannot carry the verdict:
//! `sold_out` and `last_room_held_for_desk` are **both 409 Conflict** and
//! both definitive, but one means *pick other dates* and the other means
//! *phone the desk, the room is there and it is yours if you ask for it*.
//!
//! What is pinned here:
//!
//! - **each reason maps to the right status**, keeping the pre-A19
//!   definitive-vs-outage split: the two 409s stay 409, and a closed
//!   channel, a rotated token and an exhausted inventory-lock retry all
//!   stay 503 — a guest is never told "your booking was rejected" about our
//!   own credential;
//! - **the reason reaches the guest's browser**, as `reason` alongside the
//!   unchanged `error` and `message`, because the Thai copy in the LIFF
//!   flow is keyed on it;
//! - **`inventory_lock_timeout` is retried exactly once**, after the delay
//!   the PMS asked for, and then given up on. Not zero (the contended
//!   window is one other booking's write, so the retry usually works), and
//!   not more than once (this runs inside a guest's request, holding the
//!   hold guard's lock);
//! - **an unknown reason changes nothing** — a PMS that grows a new token
//!   must degrade to the pre-A19 status mapping, not 500 the booking.
//!
//! The `Idempotency-Key` half of this path lives in
//! `channel_idempotency_test.rs`, the hold guard's in
//! `channel_confirm_guard_test.rs`.

use chrono::{Duration, Utc};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use loyalty_backend::services::pms_channel::{
    retry_after_delay, IdempotencyKey, PmsChannelClient, PmsCreateBookingRequest, PmsGuest,
    PmsReason, IDEMPOTENCY_KEY_REUSED_MESSAGE,
};
use loyalty_backend::types::Property;

use crate::common::{test_app_state_config, test_redis_url, TestApp, TestUser};

/// The property's receiving PromptPay ID — the create handler refuses
/// before it calls the PMS without one.
const RECEIVING_ID: &str = "0105556123047";

// ============================================================================
// Fixtures
// ============================================================================

async fn app_for(pms_uri: &str) -> TestApp {
    let uri = pms_uri.to_string();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
        cfg.pms.base_url = Some(uri.clone());
        cfg.pms.channel_token = Some("test-channel-token".to_string());
        // The Redis guard is not what is under test here, and leaving it on
        // would make every case in this file share a lock keyed on the same
        // stay.
        cfg.pms.hold_guard = false;
    };
    TestApp::new_with_config(&mutate)
        .await
        .expect("create test app")
}

fn channel_booking_body() -> Value {
    let today = Utc::now().date_naive();
    json!({
        "property": "hf",
        "room_type_id": "3",
        "check_in": (today + Duration::days(45)).to_string(),
        "check_out": (today + Duration::days(47)).to_string(),
        "guests": 2,
        "guest_name": "A19 Guest",
        "guest_phone": "0812345678",
        "payment_option": "deposit50",
    })
}

fn created_body(pms_booking_id: &str) -> Value {
    json!({
        "pms_booking_id": pms_booking_id,
        "total": 3000.0,
        "amount_due_now": 1500.0,
        "hold_expires_at": (Utc::now() + Duration::hours(2)).to_rfc3339(),
    })
}

/// POST the booking against a PMS that answers `template`, and hand back
/// the status and the parsed error body.
async fn create_against(
    email: &str,
    template: ResponseTemplate,
) -> (u16, Value, wiremock::MockServer) {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(template)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new(email);
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let response = client
        .post("/api/bookings/channel", &channel_booking_body())
        .await;
    let status = response.status;
    let body: Value = response
        .json()
        .unwrap_or_else(|e| panic!("error body is JSON ({e}): {}", response.body));
    app.cleanup().await.ok();
    (status, body, pms_mock)
}

/// The PMS's error envelope, as new-hotel sends it.
fn pms_error(reason: &str, extra: Value) -> Value {
    let mut body = json!({
        "error": "channel_error",
        "message": "the PMS's own words, which never reach a guest",
        "reason": reason,
    });
    if let Some(extra) = extra.as_object() {
        for (k, v) in extra {
            body[k] = v.clone();
        }
    }
    body
}

// ============================================================================
// 1. The wire shape
// ============================================================================

/// The contract the frontend is written against: `reason` **alongside** the
/// existing `error` and `message`, never instead of them.
///
/// `error` deliberately stays `conflict` — every caller that already
/// branches on the app's own key, `frontend/src/utils/pmsOutage.ts`
/// included, must behave exactly as it did before A19.
#[tokio::test]
async fn the_error_body_carries_reason_alongside_the_unchanged_code_and_message() {
    let (status, body, _pms) = create_against(
        "a19-wire-shape@test.com",
        ResponseTemplate::new(409).set_body_json(pms_error("sold_out", json!({}))),
    )
    .await;

    assert_eq!(status, 409);
    assert_eq!(body["reason"], "sold_out");
    assert_eq!(body["error"], "conflict");
    assert!(
        body["message"].as_str().is_some_and(|m| !m.is_empty()),
        "the guest still gets a sentence: {body}"
    );
    // The PMS's own words are not what the guest reads.
    assert!(
        !body["message"]
            .as_str()
            .unwrap()
            .contains("the PMS's own words"),
        "the PMS body must not be forwarded verbatim: {body}"
    );
}

/// No reason, no field. A client can test for its presence rather than for
/// a sentinel value.
#[tokio::test]
async fn an_error_with_no_pms_reason_has_no_reason_field() {
    let (status, body, _pms) = create_against(
        "a19-no-reason@test.com",
        ResponseTemplate::new(500).set_body_string("upstream exploded"),
    )
    .await;

    assert_eq!(status, 503);
    assert!(
        body.get("reason").is_none(),
        "reason must be absent, not null: {body}"
    );
}

// ============================================================================
// 2. Each reason, and the status it keeps
// ============================================================================

/// Sold out is the PMS's decision about this stay: 409, definitive, and the
/// guest's next step is the dates, not the phone.
#[tokio::test]
async fn sold_out_is_a_definitive_conflict() {
    let (status, body, _pms) = create_against(
        "a19-sold-out@test.com",
        ResponseTemplate::new(409).set_body_json(pms_error("sold_out", json!({}))),
    )
    .await;

    assert_eq!(status, 409);
    assert_eq!(body["reason"], "sold_out");
}

/// The last-room floor: also a 409, also definitive, and the *only* refusal
/// where the guest can still have the room — which is why the frontend must
/// be able to tell it from `sold_out`.
///
/// `free_rooms` and `floor` ride along on the PMS body and are deliberately
/// ignored: neither changes what the guest is told, and parsing them would
/// make an added field a parse failure.
#[tokio::test]
async fn the_last_room_held_for_the_desk_is_its_own_conflict() {
    let (status, body, _pms) = create_against(
        "a19-desk-held@test.com",
        ResponseTemplate::new(409).set_body_json(pms_error(
            "last_room_held_for_desk",
            json!({ "free_rooms": 1, "floor": 1 }),
        )),
    )
    .await;

    assert_eq!(status, 409);
    assert_eq!(body["reason"], "last_room_held_for_desk");
    assert_ne!(
        body["reason"], "sold_out",
        "these two must never collapse into one another"
    );
}

/// A closed channel is not an outage, and the guest copy has to be able to
/// say so — hence a 503 that still names itself.
#[tokio::test]
async fn a_disabled_channel_is_an_outage_with_a_name() {
    let (status, body, _pms) = create_against(
        "a19-disabled@test.com",
        ResponseTemplate::new(503).set_body_json(pms_error("channel_disabled", json!({}))),
    )
    .await;

    assert_eq!(status, 503);
    assert_eq!(body["error"], "external_service_unavailable");
    assert_eq!(body["reason"], "channel_disabled");
}

/// A rotated `LOYALTY_CHANNEL_TOKEN` is **ours**. The guest must never be
/// shown a 401, and must never be told their booking was rejected.
#[tokio::test]
async fn an_unauthorized_channel_never_reaches_the_guest_as_a_rejection() {
    let (status, body, _pms) = create_against(
        "a19-unauthorized@test.com",
        ResponseTemplate::new(401).set_body_json(pms_error("unauthorized", json!({}))),
    )
    .await;

    assert_eq!(status, 503, "our expired credential is not the guest's 401");
    assert_eq!(body["reason"], "unauthorized");
}

/// A key reused with a different body: definitive, 409, and the guest is
/// told the one useful thing — start again — without hearing about keys.
#[tokio::test]
async fn an_idempotency_key_mismatch_tells_the_guest_to_start_again() {
    let (status, body, _pms) = create_against(
        "a19-key-mismatch@test.com",
        ResponseTemplate::new(422).set_body_json(pms_error("idempotency_key_mismatch", json!({}))),
    )
    .await;

    assert_eq!(status, 409);
    assert_eq!(body["reason"], "idempotency_key_mismatch");
    assert_eq!(body["message"], IDEMPOTENCY_KEY_REUSED_MESSAGE);
}

/// A PMS older than #311 sends no reason with its 422. The guest still gets
/// the "start again" copy rather than the PMS's raw body, because the
/// status fallback survives.
#[tokio::test]
async fn a_422_with_no_reason_is_still_read_as_a_reused_key() {
    let (status, body, _pms) = create_against(
        "a19-legacy-422@test.com",
        ResponseTemplate::new(422).set_body_string("idempotency key conflict"),
    )
    .await;

    assert_eq!(status, 409);
    assert_eq!(body["reason"], "idempotency_key_mismatch");
    assert_eq!(body["message"], IDEMPOTENCY_KEY_REUSED_MESSAGE);
}

/// A reason this build has never heard of must not become a 500, and must
/// not be re-emitted raw: it falls through to the mapping that predates
/// A19, whatever that mapping happens to say.
///
/// For a 409 on the create path that mapping is `BadRequest` — `parse_json`
/// has always turned every 4xx outside `NOT_THE_CALLERS_FAULT` into "the
/// guest's to fix", and 409 is one of them. **400 here is the assertion,
/// not a bug**: a build that has not learned the new token behaves exactly
/// as the build before it did, which is the whole point of the fallback.
/// The 409 answers in this file are the *recognised* reasons, and they get
/// there through [`PmsReason::is_definitive`], not through the status.
#[tokio::test]
async fn an_unknown_reason_falls_back_to_the_pre_a19_mapping() {
    let (status, body, _pms) = create_against(
        "a19-unknown-reason@test.com",
        ResponseTemplate::new(409).set_body_json(pms_error("rate_limited_by_the_moon", json!({}))),
    )
    .await;

    assert_eq!(
        status, 400,
        "an unrecognised 409 maps exactly as it did before A19"
    );
    assert!(
        body.get("reason").is_none(),
        "an unrecognised token is not re-emitted as a structured reason: {body}"
    );
}

// ============================================================================
// 3. The one retry
// ============================================================================

/// The inventory lock is contended for about as long as one other booking's
/// write takes, so one retry after the delay the PMS asked for turns a
/// failed booking into a held room.
#[tokio::test]
async fn an_inventory_lock_timeout_is_retried_once_and_succeeds() {
    let pms_mock = MockServer::start().await;
    // First call: the lock was busy. `up_to_n_times(1)` plus mount order is
    // what makes the second call fall through to the success mock.
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(
            ResponseTemplate::new(503)
                .insert_header("Retry-After", "1")
                .set_body_json(pms_error("inventory_lock_timeout", json!({}))),
        )
        .up_to_n_times(1)
        .expect(1)
        .mount(&pms_mock)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("PMS-A19-RETRIED")))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a19-lock-retry@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let response = client
        .post("/api/bookings/channel", &channel_booking_body())
        .await;
    response.assert_status(201);

    assert_eq!(
        pms_mock
            .received_requests()
            .await
            .expect("recorded requests")
            .len(),
        2,
        "exactly one retry: the first call and the one that worked"
    );

    app.cleanup().await.ok();
}

/// And it is retried **once**. A second timeout is an outage — reported as
/// one, with the reason intact, after exactly two calls.
#[tokio::test]
async fn a_second_inventory_lock_timeout_gives_up() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(
            ResponseTemplate::new(503)
                .insert_header("Retry-After", "1")
                .set_body_json(pms_error("inventory_lock_timeout", json!({}))),
        )
        .expect(2)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a19-lock-giveup@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let response = client
        .post("/api/bookings/channel", &channel_booking_body())
        .await;
    response.assert_status(503);
    let body: Value = response.json().expect("error body is JSON");
    assert_eq!(body["reason"], "inventory_lock_timeout");
    assert_eq!(body["error"], "external_service_unavailable");

    assert_eq!(
        pms_mock
            .received_requests()
            .await
            .expect("recorded requests")
            .len(),
        2,
        "two calls, never three: this retry runs inside a guest's request"
    );

    app.cleanup().await.ok();
}

/// Every *other* reason is answered on the first call. A definitive 409 in
/// particular must not be retried — retrying a sold-out stay is how a
/// guest's "book" tap turns into a ten-second wait for the same answer.
#[tokio::test]
async fn no_other_reason_is_retried() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(409).set_body_json(pms_error("sold_out", json!({}))))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a19-no-retry@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    client
        .post("/api/bookings/channel", &channel_booking_body())
        .await
        .assert_status(409);

    assert_eq!(
        pms_mock
            .received_requests()
            .await
            .expect("recorded requests")
            .len(),
        1
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 4. A named refusal frees the one-in-flight lock
// ============================================================================

/// A `PmsChannelClient` pointed at `pms_uri`, with the hold guard on.
fn guarded_client(pms_uri: &str) -> PmsChannelClient {
    let mut settings = test_app_state_config();
    settings.pms.base_url = Some(pms_uri.to_string());
    settings.pms.channel_token = Some("test-channel-token".to_string());
    settings.pms.hold_guard = true;
    PmsChannelClient::from_settings(&settings).expect("build PMS client")
}

/// The connection the guard takes its lock on — built the way production
/// builds it, and PINGed, because a guard that cannot reach Redis stands
/// down and would make the assertion below pass vacuously.
async fn guard_redis() -> redis::aio::ConnectionManager {
    let client = redis::Client::open(test_redis_url()).expect("test Redis URL parses");
    let mut conn = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        redis::aio::ConnectionManager::new_with_config(
            client,
            loyalty_backend::redis::connection_manager_config(),
        ),
    )
    .await
    .expect("Redis connection did not time out")
    .expect("these tests need Redis; without it they prove nothing");
    let pong: String = redis::cmd("PING")
        .query_async(&mut conn)
        .await
        .expect("Redis answers PING");
    assert_eq!(pong, "PONG");
    conn
}

fn hold_request(phone: &str) -> PmsCreateBookingRequest {
    let today = Utc::now().date_naive();
    PmsCreateBookingRequest {
        property: Property::Hf,
        room_type_id: "3".to_string(),
        check_in: today + Duration::days(60),
        check_out: today + Duration::days(62),
        guests: 2,
        guest: PmsGuest {
            name: "A19 Guest".to_string(),
            phone: phone.to_string(),
        },
        membership_id: None,
        payment: "deposit50".to_string(),
    }
}

/// The PMS named a reason, so it answered and made nothing — and the
/// one-in-flight lock has to come off at once.
///
/// The alternative, which this is here to stop: the lock is held to its
/// 20-second TTL, and a guest told "this room type is sold out" who
/// immediately tries the *same* dates with a different room type is
/// answered "a booking for these dates is already being created". Before
/// A19 a sold-out create came back as `BadRequest`, which the guard already
/// released on; the typed error must not quietly change that.
#[tokio::test]
async fn a_named_refusal_does_not_strand_the_one_in_flight_lock() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(409).set_body_json(pms_error("sold_out", json!({}))))
        .expect(2)
        .mount(&pms_mock)
        .await;

    let client = guarded_client(&pms_mock.uri());
    let phone = format!("086{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let request = hold_request(&phone);

    let first = client
        .create_booking(&request, guard_redis().await, &IdempotencyKey::new_v4())
        .await
        .expect_err("sold out is a refusal");
    assert_eq!(first.status_code(), axum::http::StatusCode::CONFLICT);

    // The second attempt must reach the PMS, not bounce off our own lock.
    let second = client
        .create_booking(&request, guard_redis().await, &IdempotencyKey::new_v4())
        .await
        .expect_err("still sold out");
    assert_eq!(second.reason(), Some("sold_out"), "got: {second}");

    assert_eq!(
        pms_mock
            .received_requests()
            .await
            .expect("recorded requests")
            .len(),
        2,
        "the lock must not have swallowed the second attempt"
    );
}

// ============================================================================
// 5. Availability sees the reason too
// ============================================================================

/// The channel closing should say "closed" on the *first* screen of the
/// flow, not only after a guest has picked dates, a room and a payment
/// option.
#[tokio::test]
async fn availability_carries_the_reason_as_well() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/channel/availability"))
        .respond_with(
            ResponseTemplate::new(503).set_body_json(pms_error("channel_disabled", json!({}))),
        )
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a19-availability@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let today = Utc::now().date_naive();
    let response = client
        .get(&format!(
            "/api/bookings/availability?property=hf&check_in={}&check_out={}&guests=2",
            today + Duration::days(50),
            today + Duration::days(52)
        ))
        .await;
    response.assert_status(503);
    let body: Value = response.json().expect("error body is JSON");
    assert_eq!(body["reason"], "channel_disabled");

    app.cleanup().await.ok();
}

// ============================================================================
// 6. The units under all of it
// ============================================================================

/// The tokens are a wire contract in both directions. A rename here is a
/// frontend break, so it is spelled out rather than derived.
#[test]
fn every_reason_round_trips_through_its_wire_token() {
    for reason in [
        PmsReason::ChannelDisabled,
        PmsReason::Unauthorized,
        PmsReason::SoldOut,
        PmsReason::LastRoomHeldForDesk,
        PmsReason::InventoryLockTimeout,
        PmsReason::IdempotencyKeyMismatch,
    ] {
        assert_eq!(PmsReason::parse(reason.as_str()), Some(reason));
        assert_eq!(
            PmsReason::from_body(&json!({ "reason": reason.as_str() }).to_string()),
            Some(reason)
        );
    }
    assert_eq!(PmsReason::parse("something_else"), None);
}

/// Only the answers about *this booking* are definitive. Getting this wrong
/// in either direction is a real failure: a definitive outage strands a
/// guest who could have retried, and a retryable refusal sends a sold-out
/// stay round the loop again.
#[test]
fn only_the_answers_about_this_booking_are_definitive() {
    assert!(PmsReason::SoldOut.is_definitive());
    assert!(PmsReason::LastRoomHeldForDesk.is_definitive());
    assert!(PmsReason::IdempotencyKeyMismatch.is_definitive());
    assert!(!PmsReason::ChannelDisabled.is_definitive());
    assert!(!PmsReason::Unauthorized.is_definitive());
    assert!(!PmsReason::InventoryLockTimeout.is_definitive());
}

/// A body that is not JSON, has no `reason`, or has one of the wrong type
/// is simply "no reason" — never a parse failure that costs a booking.
#[test]
fn a_body_without_a_usable_reason_is_not_an_error() {
    assert_eq!(PmsReason::from_body("<html>Access denied</html>"), None);
    assert_eq!(PmsReason::from_body(""), None);
    assert_eq!(PmsReason::from_body(r#"{"error":"nope"}"#), None);
    assert_eq!(PmsReason::from_body(r#"{"reason":null}"#), None);
    assert_eq!(PmsReason::from_body(r#"{"reason":7}"#), None);
}

/// `Retry-After` is honoured but bounded: this wait happens inside a
/// guest's request, so a PMS that asks for ten minutes gets one second.
#[test]
fn retry_after_is_honoured_within_bounds() {
    use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};
    let with = |v: &str| {
        let mut h = HeaderMap::new();
        h.insert(RETRY_AFTER, HeaderValue::from_str(v).unwrap());
        retry_after_delay(&h)
    };
    assert_eq!(with("1"), std::time::Duration::from_secs(1));
    assert_eq!(with("3"), std::time::Duration::from_secs(3));
    // Out of range, unparseable, or absent: the default.
    assert_eq!(with("600"), std::time::Duration::from_secs(1));
    assert_eq!(
        with("Wed, 21 Oct 2026 07:28:00 GMT"),
        std::time::Duration::from_secs(1)
    );
    assert_eq!(
        retry_after_delay(&HeaderMap::new()),
        std::time::Duration::from_secs(1)
    );
}
