//! A16 — the PMS channel create carries an `Idempotency-Key`.
//!
//! `POST /api/channel/bookings` used to have no idempotency of its own, so
//! the only thing standing between a guest who tapped "book" twice and two
//! holds on two rooms was a Redis lock this app takes for itself. Since
//! new-hotel #305 the PMS accepts an `Idempotency-Key` (1..255 printable
//! ASCII, scoped per caller token and property), replays the stored answer
//! with `Idempotency-Replayed: true`, and answers **422** when the same key
//! arrives with a different body.
//!
//! What is pinned here:
//!
//! - **the key is always sent** — a request with no header of its own still
//!   reaches the PMS with one, because sending no key is strictly worse
//!   than sending a fresh one;
//! - **a client's key is the one the PMS sees**, byte for byte, which is
//!   what makes a browser-side retry collapse instead of double-booking;
//! - **a malformed client key is replaced, not rejected** — a client bug
//!   must not turn into "your booking failed" for the guest;
//! - **a replay is a success**, and the caller can tell it was one;
//! - **422 is a clear client error**, not the PMS's raw body in front of a
//!   guest, and not a retryable outage;
//! - **`PMS_HOLD_GUARD` retires the Redis lock and nothing else** — with
//!   the flag off the lock is gone, and the key still goes out.
//!
//! The Redis lock's own behaviour lives in `channel_confirm_guard_test.rs`.

use chrono::{Duration, Utc};
use serde_json::{json, Value};
use uuid::Uuid;
use wiremock::matchers::{header, header_exists, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

use loyalty_backend::services::pms_channel::{
    IdempotencyKey, PmsChannelClient, PmsCreateBookingRequest, PmsGuest, IDEMPOTENCY_KEY_HEADER,
    IDEMPOTENCY_KEY_REUSED_MESSAGE, IDEMPOTENCY_REPLAYED_HEADER, MAX_IDEMPOTENCY_KEY_LEN,
};
use loyalty_backend::types::Property;

use crate::common::{test_app_state_config, test_redis_url, TestApp, TestUser};

/// The property's receiving PromptPay ID — the create handler refuses
/// before it calls the PMS without one, so every route-level case needs it.
const RECEIVING_ID: &str = "0105556123047";

// ============================================================================
// Fixtures
// ============================================================================

/// A `PmsChannelClient` pointed at `pms_uri`, with the hold guard as given.
fn pms_client(pms_uri: &str, hold_guard: bool) -> PmsChannelClient {
    let mut settings = test_app_state_config();
    settings.pms.base_url = Some(pms_uri.to_string());
    settings.pms.channel_token = Some("test-channel-token".to_string());
    settings.pms.hold_guard = hold_guard;
    PmsChannelClient::from_settings(&settings).expect("build PMS client")
}

/// The connection the guard takes its lock on.
///
/// Built the way production builds it (`AppState`'s own manager with the
/// bounded reconnect config from #416) and PINGed before use: a guard that
/// cannot reach Redis stands down, which would make the "two calls, one
/// hold" assertion below pass vacuously.
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
            name: "A16 Guest".to_string(),
            phone: phone.to_string(),
        },
        membership_id: None,
        payment: "deposit50".to_string(),
    }
}

fn unique_phone(prefix: &str) -> String {
    format!("{prefix}{}", &Uuid::new_v4().simple().to_string()[..6])
}

fn created_body(pms_booking_id: &str) -> Value {
    json!({
        "pms_booking_id": pms_booking_id,
        "total": 3000.0,
        "amount_due_now": 1500.0,
        "hold_expires_at": (Utc::now() + Duration::hours(2)).to_rfc3339(),
    })
}

/// A test app whose PMS is `pms_uri` and whose HF PromptPay is configured.
async fn app_for(pms_uri: &str) -> TestApp {
    let uri = pms_uri.to_string();
    let mutate = move |cfg: &mut loyalty_backend::Settings| {
        cfg.promptpay.hf_id = Some(RECEIVING_ID.to_string());
        cfg.pms.base_url = Some(uri.clone());
        cfg.pms.channel_token = Some("test-channel-token".to_string());
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
        "check_in": (today + Duration::days(40)).to_string(),
        "check_out": (today + Duration::days(42)).to_string(),
        "guests": 2,
        "guest_name": "A16 Guest",
        "guest_phone": "0812345678",
        "payment_option": "deposit50",
    })
}

/// The single `Idempotency-Key` the PMS was called with.
fn key_the_pms_saw(requests: &[Request]) -> String {
    assert_eq!(
        requests.len(),
        1,
        "exactly one create should have reached the PMS"
    );
    requests[0]
        .headers
        .get(IDEMPOTENCY_KEY_HEADER)
        .unwrap_or_else(|| panic!("the create must carry an {IDEMPOTENCY_KEY_HEADER} header"))
        .to_str()
        .expect("the key is ASCII")
        .to_string()
}

/// The PMS's own rule, restated here so a drift in `IdempotencyKey` cannot
/// quietly start sending keys the PMS would reject.
fn assert_pms_would_accept(key: &str) {
    assert!(
        (1..=MAX_IDEMPOTENCY_KEY_LEN).contains(&key.len()),
        "the PMS accepts 1..255 bytes, got {}: {key:?}",
        key.len()
    );
    assert!(
        key.bytes().all(|b| (0x20..=0x7E).contains(&b)),
        "the PMS accepts printable ASCII only: {key:?}"
    );
}

// ============================================================================
// 1. The key goes out
// ============================================================================

/// A guest's booking reaches the PMS with a key even though the request
/// that started it carried none.
///
/// The point is not which key — it is that there is always one, so a
/// duplicate *delivery* of this request (a proxy retry, a dropped ACK)
/// collapses on the PMS's side instead of holding a second room.
#[tokio::test]
async fn a_create_with_no_client_key_still_reaches_the_pms_with_one() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .and(header_exists(IDEMPOTENCY_KEY_HEADER))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("PMS-A16-MINTED")))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a16-minted@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let response = client
        .post("/api/bookings/channel", &channel_booking_body())
        .await;
    response.assert_status(201);

    let key = key_the_pms_saw(
        &pms_mock
            .received_requests()
            .await
            .expect("recorded requests"),
    );
    assert_pms_would_accept(&key);

    app.cleanup().await.ok();
}

/// A client that minted its own key gets **that** key sent, byte for byte.
///
/// This is the half that actually stops double bookings: the frontend mints
/// one per `createBooking()` call and `axiosInterceptor` replays the same
/// config — headers included — after a 401 refresh, so the retry and the
/// original are one attempt as far as the PMS is concerned.
#[tokio::test]
async fn a_client_supplied_key_is_the_one_the_pms_sees() {
    const CLIENT_KEY: &str = "11111111-2222-4333-8444-555555555555";

    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .and(header(IDEMPOTENCY_KEY_HEADER, CLIENT_KEY))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("PMS-A16-CLIENT")))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a16-client-key@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let response = client
        .post_with_headers(
            "/api/bookings/channel",
            &channel_booking_body(),
            &[(IDEMPOTENCY_KEY_HEADER, CLIENT_KEY)],
        )
        .await;
    response.assert_status(201);

    assert_eq!(
        key_the_pms_saw(
            &pms_mock
                .received_requests()
                .await
                .expect("recorded requests")
        ),
        CLIENT_KEY,
        "the client's key must be forwarded unchanged — a rewritten key is \
         no key at all, because the retry would carry a different one"
    );

    app.cleanup().await.ok();
}

/// A key the PMS would reject is replaced here, before the request is sent.
///
/// A client bug — a stray newline, a 400-character string — must not become
/// "your booking failed" for a guest who did nothing wrong. The booking goes
/// through, and it goes through *with a valid key*, so the delivery-level
/// guarantee survives the bad input.
#[tokio::test]
async fn a_malformed_client_key_is_replaced_rather_than_refused() {
    let too_long = "k".repeat(MAX_IDEMPOTENCY_KEY_LEN + 1);

    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(ResponseTemplate::new(201).set_body_json(created_body("PMS-A16-MALFORMED")))
        .expect(1)
        .mount(&pms_mock)
        .await;

    let app = app_for(&pms_mock.uri()).await;
    let guest = TestUser::new("a16-bad-key@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let client = app.authenticated_client_with_role(&guest.id, &guest.email, "customer");

    let response = client
        .post_with_headers(
            "/api/bookings/channel",
            &channel_booking_body(),
            &[(IDEMPOTENCY_KEY_HEADER, &too_long)],
        )
        .await;
    response.assert_status(201);

    let key = key_the_pms_saw(
        &pms_mock
            .received_requests()
            .await
            .expect("recorded requests"),
    );
    assert_ne!(key, too_long, "the oversized key must not be forwarded");
    assert_pms_would_accept(&key);

    app.cleanup().await.ok();
}

// ============================================================================
// 2. What comes back
// ============================================================================

/// `Idempotency-Replayed: true` is a **success**, and it is visible.
///
/// The body the PMS replays is the real hold — same `pms_booking_id`, same
/// amounts — so the caller must not treat the header as a failure or as a
/// reason to retry. It is surfaced anyway because it changes what the route
/// may safely do on a later error: a replayed hold may already belong to a
/// booking row the guest can see, and releasing it would cancel a live
/// booking.
#[tokio::test]
async fn a_replayed_hold_is_a_success_the_caller_can_recognise() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(created_body("PMS-A16-REPLAY"))
                .append_header(IDEMPOTENCY_REPLAYED_HEADER, "true"),
        )
        .expect(1)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri(), true);
    let created = client
        .create_booking(
            &hold_request(&unique_phone("08610")),
            guard_redis().await,
            &IdempotencyKey::new_v4(),
        )
        .await
        .expect("a replay is a success, not an error");

    assert_eq!(created.pms_booking_id, "PMS-A16-REPLAY");
    assert!(
        created.replayed,
        "the caller must be able to tell a replay from a fresh hold"
    );
}

/// A fresh hold is not mistaken for a replay.
///
/// The default has to be `false`: a new hold wrongly marked as replayed is
/// one the route would refuse to release when its own insert failed, and
/// the room would sit held until the sweep expired it.
#[tokio::test]
async fn a_fresh_hold_is_not_reported_as_a_replay() {
    for replayed_header in [None, Some("false"), Some("no")] {
        let pms_mock = MockServer::start().await;
        let mut template = ResponseTemplate::new(201).set_body_json(created_body("PMS-A16-FRESH"));
        if let Some(value) = replayed_header {
            template = template.append_header(IDEMPOTENCY_REPLAYED_HEADER, value);
        }
        Mock::given(method("POST"))
            .and(path("/api/channel/bookings"))
            .respond_with(template)
            .expect(1)
            .mount(&pms_mock)
            .await;

        let client = pms_client(&pms_mock.uri(), true);
        let created = client
            .create_booking(
                &hold_request(&unique_phone("08620")),
                guard_redis().await,
                &IdempotencyKey::new_v4(),
            )
            .await
            .expect("the hold was created");

        assert!(
            !created.replayed,
            "{replayed_header:?} does not say `true`, so this is a fresh hold"
        );
    }
}

/// The PMS's 422 — "this key already carries a different booking" — is a
/// clear client error, not an outage and not a raw body.
///
/// Three things at once, and all three matter:
///
/// * **409, not 503.** No retry of this request can ever succeed, so
///   nothing upstream should schedule one.
/// * **409, not 400 with the PMS's body.** `parse_json` would have rendered
///   it as `PMS rejected create booking: <whatever the PMS said>`, which
///   explains nothing to a guest and invites the retry that cannot work.
/// * **the guest-facing sentence**, telling them the one useful thing:
///   start again rather than retry this.
#[tokio::test]
async fn a_422_on_the_create_is_a_clear_client_error() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_string("idempotency key reuse with a different request body"),
        )
        .expect(1)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri(), true);
    let err = client
        .create_booking(
            &hold_request(&unique_phone("08630")),
            guard_redis().await,
            &IdempotencyKey::new_v4(),
        )
        .await
        .expect_err("a reused key with a different body is refused");

    assert_eq!(
        err.status_code(),
        axum::http::StatusCode::CONFLICT,
        "422 is definitive about this request, so it must not read as a \
         retryable outage: {err}"
    );
    let rendered = err.to_string();
    assert!(
        rendered.contains(IDEMPOTENCY_KEY_REUSED_MESSAGE),
        "the guest gets the sentence that tells them what to do: {rendered}"
    );
    assert!(
        !rendered.contains("idempotency key reuse with a different request body"),
        "the PMS's own body must not be shown to a guest: {rendered}"
    );
}

// ============================================================================
// 3. PMS_HOLD_GUARD retires the lock, not the key
// ============================================================================

/// With the guard **on**, two identical creates at once are one hold — the
/// behaviour production ships today.
///
/// `.expect(1)` is the assertion; the second call is refused with a 409
/// before it reaches the PMS.
#[tokio::test]
async fn with_the_guard_on_two_identical_creates_are_one_hold() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .and(header_exists(IDEMPOTENCY_KEY_HEADER))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(created_body("PMS-A16-GUARD-ON"))
                .set_delay(std::time::Duration::from_millis(300)),
        )
        .expect(1)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri(), true);
    let redis = guard_redis().await;
    let request = hold_request(&unique_phone("08640"));

    // Bound outside the `join!` so the borrows outlive the futures.
    let (first_key, second_key) = (IdempotencyKey::new_v4(), IdempotencyKey::new_v4());

    let (first, second) = tokio::join!(
        client.create_booking(&request, redis.clone(), &first_key),
        async {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            client
                .create_booking(&request, redis.clone(), &second_key)
                .await
        }
    );

    assert!(first.is_ok(), "the first create holds the room: {first:?}");
    let err = second.expect_err("the second create is refused by the guard");
    assert_eq!(err.status_code(), axum::http::StatusCode::CONFLICT);
}

/// With `PMS_HOLD_GUARD=false` the lock is gone — and the key is not.
///
/// This is the flip the flag exists for: both creates reach the PMS, each
/// carrying a key, and the PMS's own store is what collapses a genuine
/// retry. Wiremock has no key store, so what is provable here is exactly
/// the change the flag makes — the lock stopped refusing, and the header
/// still went out.
#[tokio::test]
async fn with_the_guard_off_the_lock_is_gone_but_the_key_is_not() {
    let pms_mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/channel/bookings"))
        .and(header_exists(IDEMPOTENCY_KEY_HEADER))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(created_body("PMS-A16-GUARD-OFF"))
                .set_delay(std::time::Duration::from_millis(300)),
        )
        .expect(2)
        .mount(&pms_mock)
        .await;

    let client = pms_client(&pms_mock.uri(), false);
    let redis = guard_redis().await;
    let request = hold_request(&unique_phone("08650"));

    // Bound outside the `join!` so the borrows outlive the futures.
    let (first_key, second_key) = (IdempotencyKey::new_v4(), IdempotencyKey::new_v4());

    let (first, second) = tokio::join!(
        client.create_booking(&request, redis.clone(), &first_key),
        async {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            client
                .create_booking(&request, redis.clone(), &second_key)
                .await
        }
    );

    assert!(first.is_ok(), "{first:?}");
    assert!(
        second.is_ok(),
        "with the guard retired nothing local refuses the second create: {second:?}"
    );

    let requests = pms_mock
        .received_requests()
        .await
        .expect("recorded requests");
    assert_eq!(requests.len(), 2, "both creates reached the PMS");
    for request in &requests {
        let key = request
            .headers
            .get(IDEMPOTENCY_KEY_HEADER)
            .expect("turning the lock off must not turn the key off")
            .to_str()
            .expect("the key is ASCII");
        assert_pms_would_accept(key);
    }
}
