//! Integration coverage for the deposit-request funnel (task D6).
//!
//! `GET /api/analytics/deposit-funnel` counts the stages a deposit request
//! passes through — link issued → opened → slip uploaded → machine verdict →
//! human decision → booking confirmed — per property, per day/week/month,
//! straight off `booking_deposit_links`, `booking_slips` and `bookings`.
//!
//! Everything here seeds rows at **fixed** instants rather than relative to
//! `now()`: the endpoint cuts its buckets on Asia/Bangkok days, and a fixture
//! written in local-machine time would pass in Bangkok and fail on a CI
//! runner set to UTC — which is exactly the bug the bucketing exists to
//! prevent.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

/// The non-loginable actor every deposit-link booking is owned by, seeded by
/// `20260912010000_deposit_links.sql`.
const DEPOSIT_LINK_SYSTEM_USER: &str = "00000000-0000-4000-8000-0000005110b2";

/// 08:00 on 1 September 2026 in Bangkok, as the instant the database stores.
fn bangkok(day: &str, hour: i64, minute: i64) -> DateTime<Utc> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").expect("fixture date");
    let midnight_utc = date
        .and_hms_opt(0, 0, 0)
        .expect("midnight")
        .and_utc();
    // Bangkok is UTC+7 and has been since 1976, so subtracting the offset
    // turns a Bangkok wall clock into the instant stored in `timestamptz`.
    midnight_utc + Duration::hours(hour) + Duration::minutes(minute) - Duration::hours(7)
}

fn system_user() -> Uuid {
    Uuid::parse_str(DEPOSIT_LINK_SYSTEM_USER).expect("the seeded actor id is a uuid")
}

/// Insert a booking. `room_id` stays NULL, exactly as
/// `routes::admin_deposit_links` writes it, which also keeps the
/// `bookings_no_overlap` exclusion constraint out of the way.
#[allow(clippy::too_many_arguments)]
async fn seed_booking(
    pool: &PgPool,
    property: Option<&str>,
    status: &str,
    booking_source: Option<&str>,
    pms_booking_id: Option<&str>,
    created_at: DateTime<Utc>,
) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO bookings (
            user_id, room_id, room_type_id, check_in_date, check_out_date,
            num_guests, total_price, status, property, booking_source,
            pms_booking_id, created_at
        )
        VALUES ($1, NULL, NULL, DATE '2026-10-01', DATE '2026-10-03',
                2, 3000.00, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(system_user())
    .bind(status)
    .bind(property)
    .bind(booking_source)
    .bind(pms_booking_id)
    .bind(created_at)
    .fetch_one(pool)
    .await
    .expect("insert booking fixture")
}

/// Insert a deposit link. `opened_at` `None` is a link the guest never opened.
async fn seed_link(
    pool: &PgPool,
    booking_id: Uuid,
    issued_at: DateTime<Utc>,
    opened_at: Option<DateTime<Utc>>,
) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO booking_deposit_links (
            booking_id, token_hash, issued_by, issued_at, expires_at,
            first_opened_at, last_opened_at, open_count
        )
        VALUES ($1, $2, $3, $4, $4 + INTERVAL '2 days', $5, $5,
                CASE WHEN $5::timestamptz IS NULL THEN 0 ELSE 1 END)
        RETURNING id
        "#,
    )
    .bind(booking_id)
    // A distinct 32-byte hash per row: `booking_deposit_links_token_uidx` is
    // unique, so a shared constant would collide on the second fixture.
    .bind(Uuid::new_v4().as_bytes().repeat(2))
    .bind(system_user())
    .bind(issued_at)
    .bind(opened_at)
    .fetch_one(pool)
    .await
    .expect("insert deposit link fixture")
}

/// Insert a slip. `decided_at` `None` is a slip no admin has looked at.
async fn seed_slip(
    pool: &PgPool,
    booking_id: Uuid,
    uploaded_at: DateTime<Utc>,
    slipok_status: &str,
    admin_status: &str,
    decided_at: Option<DateTime<Utc>>,
) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO booking_slips (
            booking_id, slip_url, uploaded_by, uploaded_at,
            slipok_status, admin_status, admin_verified_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(booking_id)
    // `booking_slips_slip_url_uidx` is unique over live rows.
    .bind(format!("/storage/slips/{}.jpg", Uuid::new_v4()))
    .bind(system_user())
    .bind(uploaded_at)
    .bind(slipok_status)
    .bind(admin_status)
    .bind(decided_at)
    .fetch_one(pool)
    .await
    .expect("insert slip fixture")
}

/// The world every counting test reads.
///
/// 1 Sep (Bangkok), property `hf`:
///   * a link opened, paid after 10 minutes, `shadow_pass`, verified by an
///     admin 20 minutes later, booking confirmed;
///   * a link opened, paid after 30 minutes, `manual`, handed back
///     (`needs_action`) 60 minutes later, booking still pending;
///   * a link opened and never paid;
///   * a link never opened.
///
/// 2 Sep (Bangkok), property `hfville`:
///   * a link issued at 01:00 Bangkok — 1 Sep 18:00 **UTC** — opened, paid
///     after 5 minutes, SlipOK `unavailable`, nobody has decided it yet.
///
/// Plus two bookings that are not deposit requests at all: one app booking
/// (no property, no `booking_source`) and one PMS-channel booking.
async fn seed_world(pool: &PgPool) {
    // --- 1 Sep, hf ---------------------------------------------------------
    let paid = seed_booking(
        pool,
        Some("hf"),
        "confirmed",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 8, 0),
    )
    .await;
    seed_link(
        pool,
        paid,
        bangkok("2026-09-01", 8, 0),
        Some(bangkok("2026-09-01", 8, 5)),
    )
    .await;
    seed_slip(
        pool,
        paid,
        bangkok("2026-09-01", 8, 10),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-01", 8, 30)),
    )
    .await;

    let handed_back = seed_booking(
        pool,
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 9, 0),
    )
    .await;
    seed_link(
        pool,
        handed_back,
        bangkok("2026-09-01", 9, 0),
        Some(bangkok("2026-09-01", 9, 5)),
    )
    .await;
    seed_slip(
        pool,
        handed_back,
        bangkok("2026-09-01", 9, 30),
        "manual",
        "needs_action",
        Some(bangkok("2026-09-01", 10, 30)),
    )
    .await;

    let opened_only = seed_booking(
        pool,
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 10, 0),
    )
    .await;
    seed_link(
        pool,
        opened_only,
        bangkok("2026-09-01", 10, 0),
        Some(bangkok("2026-09-01", 10, 15)),
    )
    .await;

    let never_opened = seed_booking(
        pool,
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 11, 0),
    )
    .await;
    seed_link(pool, never_opened, bangkok("2026-09-01", 11, 0), None).await;

    // --- 2 Sep Bangkok / 1 Sep UTC, hfville --------------------------------
    let after_midnight = seed_booking(
        pool,
        Some("hfville"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-02", 1, 0),
    )
    .await;
    seed_link(
        pool,
        after_midnight,
        bangkok("2026-09-02", 1, 0),
        Some(bangkok("2026-09-02", 1, 2)),
    )
    .await;
    seed_slip(
        pool,
        after_midnight,
        bangkok("2026-09-02", 1, 5),
        "unavailable",
        "pending",
        None,
    )
    .await;

    // --- bookings that never went through a link ---------------------------
    // The member app writes neither `property` nor `booking_source`.
    seed_booking(pool, None, "confirmed", None, None, bangkok("2026-09-01", 12, 0)).await;
    // The PMS channel writes `pms_booking_id` and no `booking_source` either.
    seed_booking(
        pool,
        Some("hf"),
        "checked_out",
        None,
        Some("IH-5150"),
        bangkok("2026-09-01", 13, 0),
    )
    .await;
}

/// Fetch the funnel as an admin.
async fn funnel(app: &TestApp, admin: &TestUser, query: &str) -> Value {
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .get(&format!("/api/analytics/deposit-funnel{query}"))
        .await;
    response.assert_status(200);
    response.json::<Value>().expect("funnel json")
}

/// The bucket for one day and property, or `None` if the endpoint did not
/// emit one.
fn bucket<'a>(body: &'a Value, day: &str, property: &str) -> Option<&'a Value> {
    body["buckets"].as_array().expect("buckets array").iter().find(|b| {
        b["bucketStart"] == Value::String(day.to_string())
            && b["property"] == Value::String(property.to_string())
    })
}

async fn seed_admin(app: &TestApp, email: &str) -> TestUser {
    let admin = TestUser::admin(email);
    admin.insert(app.db()).await.expect("insert admin");
    admin
}

// ============================================================================
// Counters
// ============================================================================

#[tokio::test]
async fn deposit_funnel_counts_every_stage_for_one_property_and_day() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-stages@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(
        &app,
        &admin,
        "?startDate=2026-09-01&endDate=2026-09-02&granularity=day",
    )
    .await;

    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");
    assert_eq!(hf["linksIssued"], 4);
    assert_eq!(hf["linksOpened"], 3, "the never-opened link must not count");
    assert_eq!(hf["slipsUploaded"], 2);

    // Exhaustive over `slipok_status`, so the breakdown sums to slipsUploaded.
    assert_eq!(hf["machineVerdict"]["verified"], 0);
    assert_eq!(hf["machineVerdict"]["shadowPass"], 1);
    assert_eq!(hf["machineVerdict"]["manual"], 1);
    assert_eq!(hf["machineVerdict"]["unavailable"], 0);
    assert_eq!(hf["machineVerdict"]["pending"], 0);

    // And so does the human decision.
    assert_eq!(hf["humanDecision"]["verified"], 1);
    assert_eq!(hf["humanDecision"]["needsAction"], 1);
    assert_eq!(hf["humanDecision"]["pending"], 0);

    assert_eq!(
        hf["bookingsConfirmed"], 1,
        "only the paid request reached a confirmed booking"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_medians_are_the_middle_of_the_seeded_timings() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-medians@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;

    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");
    // Slips landed 10 and 30 minutes after their links were issued.
    assert_eq!(hf["medianMinutesLinkToSlip"], 20.0);
    // Decisions came 20 and 60 minutes after the slips landed.
    assert_eq!(hf["medianMinutesSlipToDecision"], 40.0);

    let hfville = bucket(&body, "2026-09-02", "hfville").expect("2 Sep hfville bucket");
    assert_eq!(hfville["medianMinutesLinkToSlip"], 5.0);
    assert_eq!(
        hfville["medianMinutesSlipToDecision"],
        Value::Null,
        "nobody has decided that slip, and 0 would read as an instant decision"
    );

    // Over the window: 5, 10 and 30 minutes to a slip; 20 and 60 to a decision.
    assert_eq!(body["totals"]["medianMinutesLinkToSlip"], 10.0);
    assert_eq!(body["totals"]["medianMinutesSlipToDecision"], 40.0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_totals_cover_the_whole_window() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-totals@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;

    assert_eq!(body["totals"]["linksIssued"], 5);
    assert_eq!(body["totals"]["linksOpened"], 4);
    assert_eq!(body["totals"]["slipsUploaded"], 3);
    assert_eq!(body["totals"]["machineVerdict"]["shadowPass"], 1);
    assert_eq!(body["totals"]["machineVerdict"]["manual"], 1);
    assert_eq!(body["totals"]["machineVerdict"]["unavailable"], 1);
    assert_eq!(body["totals"]["humanDecision"]["verified"], 1);
    assert_eq!(body["totals"]["humanDecision"]["needsAction"], 1);
    assert_eq!(body["totals"]["humanDecision"]["pending"], 1);
    assert_eq!(body["totals"]["bookingsConfirmed"], 1);

    app.cleanup().await.ok();
}

// ============================================================================
// Property split and bucketing
// ============================================================================

#[tokio::test]
async fn deposit_funnel_splits_the_two_properties() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-property@test.com").await;
    seed_world(app.db()).await;

    let all = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;
    assert!(bucket(&all, "2026-09-01", "hf").is_some());
    assert!(bucket(&all, "2026-09-02", "hfville").is_some());

    let hf_only = funnel(
        &app,
        &admin,
        "?startDate=2026-09-01&endDate=2026-09-02&property=hf",
    )
    .await;
    assert_eq!(hf_only["property"], "hf");
    assert_eq!(hf_only["totals"]["linksIssued"], 4);
    for entry in hf_only["buckets"].as_array().expect("buckets") {
        assert_eq!(entry["property"], "hf", "the filter leaked another property");
    }

    let hfville_only = funnel(
        &app,
        &admin,
        "?startDate=2026-09-01&endDate=2026-09-02&property=hfville",
    )
    .await;
    assert_eq!(hfville_only["totals"]["linksIssued"], 1);
    assert_eq!(hfville_only["totals"]["slipsUploaded"], 1);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_cuts_days_on_bangkok_midnight_not_utc() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-timezone@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;
    assert_eq!(body["timezone"], "Asia/Bangkok");

    // The hfville link was issued at 01:00 on 2 Sep in Bangkok, which is
    // 18:00 on 1 Sep in UTC. Bucketed on UTC it would land a day early and
    // the funnel would disagree with the list reception is looking at.
    assert!(
        bucket(&body, "2026-09-01", "hfville").is_none(),
        "the after-midnight link must not fall into the previous Bangkok day"
    );
    let hfville = bucket(&body, "2026-09-02", "hfville").expect("2 Sep hfville bucket");
    assert_eq!(hfville["linksIssued"], 1);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_collapses_buckets_at_week_and_month_granularity() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-granularity@test.com").await;
    seed_world(app.db()).await;

    let monthly = funnel(
        &app,
        &admin,
        "?startDate=2026-09-01&endDate=2026-09-30&granularity=month",
    )
    .await;
    assert_eq!(monthly["granularity"], "month");
    let hf = bucket(&monthly, "2026-09-01", "hf").expect("September hf bucket");
    assert_eq!(hf["linksIssued"], 4);
    let hfville = bucket(&monthly, "2026-09-01", "hfville").expect("September hfville bucket");
    assert_eq!(
        hfville["linksIssued"], 1,
        "both Bangkok days belong to the same month"
    );

    // 1 Sep 2026 is a Tuesday, so date_trunc('week') puts both days in the
    // week starting Monday 31 August.
    let weekly = funnel(
        &app,
        &admin,
        "?startDate=2026-09-01&endDate=2026-09-07&granularity=week",
    )
    .await;
    assert_eq!(weekly["granularity"], "week");
    assert_eq!(
        bucket(&weekly, "2026-08-31", "hf").expect("week-of hf bucket")["linksIssued"],
        4
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Booking source split
// ============================================================================

#[tokio::test]
async fn deposit_funnel_derives_the_source_split_from_a_null_booking_source() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-source@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;

    // Only `routes::admin_deposit_links` ever writes `booking_source`. The app
    // and the PMS channel both leave it NULL, so reading the column alone
    // would report every one of those bookings as the same thing.
    assert_eq!(body["totals"]["bookingsBySource"]["depositLink"], 1);
    assert_eq!(body["totals"]["bookingsBySource"]["app"], 1);
    assert_eq!(body["totals"]["bookingsBySource"]["channel"], 1);

    // The app booking carries no property at all, so it has to be reachable
    // under some name rather than being dropped from the report.
    let unknown = bucket(&body, "2026-09-01", "unknown").expect("the app booking's bucket");
    assert_eq!(unknown["bookingsBySource"]["app"], 1);
    assert_eq!(
        unknown["linksIssued"], 0,
        "a bucket that exists only in the bookings query still reports zeroed stages"
    );

    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");
    assert_eq!(hf["bookingsBySource"]["channel"], 1);
    assert_eq!(hf["bookingsBySource"]["depositLink"], 1);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_counts_only_confirmed_bookings_in_the_source_split() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-source-status@test.com").await;

    // A cancelled booking is not a booking anybody took.
    seed_booking(
        app.db(),
        Some("hf"),
        "cancelled",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 8, 0),
    )
    .await;
    // A guest who has since checked out was still confirmed; there is no
    // `confirmed_at` column to say otherwise.
    seed_booking(
        app.db(),
        Some("hf"),
        "checked_out",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 9, 0),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-01").await;
    assert_eq!(body["totals"]["bookingsBySource"]["depositLink"], 1);

    app.cleanup().await.ok();
}

// ============================================================================
// Reissue
// ============================================================================

#[tokio::test]
async fn a_slip_counts_against_the_link_that_was_live_when_it_landed() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-reissue@test.com").await;

    // Reception issues a link, the guest loses it, reception reissues, and
    // the guest pays against the second one. Both links hang off the same
    // booking, so a naive join would count the slip twice.
    let booking = seed_booking(
        app.db(),
        Some("hf"),
        "confirmed",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 8, 0),
    )
    .await;
    seed_link(
        app.db(),
        booking,
        bangkok("2026-09-01", 8, 0),
        Some(bangkok("2026-09-01", 8, 1)),
    )
    .await;
    sqlx::query("UPDATE booking_deposit_links SET revoked_at = $1 WHERE booking_id = $2")
        .bind(bangkok("2026-09-01", 9, 0))
        .bind(booking)
        .execute(app.db())
        .await
        .expect("revoke the first link");
    seed_link(
        app.db(),
        booking,
        bangkok("2026-09-01", 9, 0),
        Some(bangkok("2026-09-01", 9, 1)),
    )
    .await;
    seed_slip(
        app.db(),
        booking,
        bangkok("2026-09-01", 9, 20),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-01", 9, 40)),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-01").await;
    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");

    assert_eq!(hf["linksIssued"], 2, "a reissue is a second issuance");
    assert_eq!(
        hf["slipsUploaded"], 1,
        "one slip, against the link that was live when it landed"
    );
    assert_eq!(hf["humanDecision"]["verified"], 1);
    // 20 minutes after the *second* link, not 80 after the first.
    assert_eq!(hf["medianMinutesLinkToSlip"], 20.0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_links_verdict_is_read_off_its_latest_slip() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-latest-slip@test.com").await;

    // The guest's first slip came back `needs_action`; the second was
    // verified. They have been verified, not both.
    let booking = seed_booking(
        app.db(),
        Some("hf"),
        "confirmed",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 8, 0),
    )
    .await;
    seed_link(
        app.db(),
        booking,
        bangkok("2026-09-01", 8, 0),
        Some(bangkok("2026-09-01", 8, 1)),
    )
    .await;
    seed_slip(
        app.db(),
        booking,
        bangkok("2026-09-01", 8, 10),
        "manual",
        "needs_action",
        Some(bangkok("2026-09-01", 8, 20)),
    )
    .await;
    seed_slip(
        app.db(),
        booking,
        bangkok("2026-09-01", 8, 40),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-01", 8, 50)),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-01").await;
    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");

    assert_eq!(hf["slipsUploaded"], 1, "the stage counts links, not slips");
    assert_eq!(hf["machineVerdict"]["shadowPass"], 1);
    assert_eq!(hf["machineVerdict"]["manual"], 0);
    assert_eq!(hf["humanDecision"]["verified"], 1);
    assert_eq!(hf["humanDecision"]["needsAction"], 0);
    // The first slip landed 10 minutes after the link.
    assert_eq!(hf["medianMinutesLinkToSlip"], 10.0);
    // The fastest decision on that link's slips: 10 minutes.
    assert_eq!(hf["medianMinutesSlipToDecision"], 10.0);

    app.cleanup().await.ok();
}

// ============================================================================
// Shape, defaults and refusals
// ============================================================================

#[tokio::test]
async fn deposit_funnel_answers_a_fixed_shape() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-shape@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(
        &app,
        &admin,
        "?startDate=2026-09-01&endDate=2026-09-02&granularity=day",
    )
    .await;

    assert_eq!(body["granularity"], "day");
    assert_eq!(body["startDate"], "2026-09-01");
    assert_eq!(body["endDate"], "2026-09-02");
    assert_eq!(body["property"], Value::Null);
    assert_eq!(body["timezone"], "Asia/Bangkok");

    for key in [
        "linksIssued",
        "linksOpened",
        "slipsUploaded",
        "machineVerdict",
        "humanDecision",
        "bookingsConfirmed",
        "medianMinutesLinkToSlip",
        "medianMinutesSlipToDecision",
        "bookingsBySource",
    ] {
        assert!(
            body["totals"].get(key).is_some(),
            "totals is missing {key}: {}",
            body["totals"]
        );
    }

    let first = &body["buckets"].as_array().expect("buckets")[0];
    assert!(first.get("bucketStart").is_some());
    assert!(first.get("property").is_some());
    // The counters are flattened onto the bucket, not nested under a key.
    assert!(first.get("linksIssued").is_some());
    assert!(first["machineVerdict"].get("shadowPass").is_some());
    assert!(first["humanDecision"].get("needsAction").is_some());
    assert!(first["bookingsBySource"].get("depositLink").is_some());

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_defaults_to_the_last_thirty_days() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-defaults@test.com").await;

    let body = funnel(&app, &admin, "").await;

    assert_eq!(body["granularity"], "day");
    assert_eq!(body["property"], Value::Null);
    let start = NaiveDate::parse_from_str(body["startDate"].as_str().unwrap(), "%Y-%m-%d").unwrap();
    let end = NaiveDate::parse_from_str(body["endDate"].as_str().unwrap(), "%Y-%m-%d").unwrap();
    assert_eq!((end - start).num_days() + 1, 30);

    // An empty window is a window of zeros, not an error and not an empty
    // body: the card has to render something.
    assert_eq!(body["totals"]["linksIssued"], 0);
    assert_eq!(body["totals"]["medianMinutesLinkToSlip"], Value::Null);
    assert_eq!(body["buckets"].as_array().expect("buckets").len(), 0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_is_admin_only() {
    let app = TestApp::new().await.expect("create test app");

    let customer = TestUser::new("funnel-customer@test.com");
    customer.insert(app.db()).await.expect("insert customer");
    let client = app.authenticated_client_with_role(&customer.id, &customer.email, "customer");
    client
        .get("/api/analytics/deposit-funnel")
        .await
        .assert_status(403);

    let anonymous = crate::common::TestClient::new(app.router());
    let response = anonymous.get("/api/analytics/deposit-funnel").await;
    assert!(
        [401, 403].contains(&response.status),
        "an unauthenticated caller must not read the funnel, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn deposit_funnel_refuses_parameters_it_cannot_answer() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-bad-params@test.com").await;
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    for query in [
        // `granularity` is interpolated into `date_trunc`, so it is an
        // allowlist and not a passthrough.
        "?granularity=hour",
        "?granularity=day'); DROP TABLE bookings --",
        "?property=HF",
        "?property=all",
        "?startDate=01-09-2026",
        "?startDate=2026-09-02&endDate=2026-09-01",
        // Longer than the cap.
        "?startDate=2025-01-01&endDate=2026-01-02",
    ] {
        let response = client
            .get(&format!("/api/analytics/deposit-funnel{query}"))
            .await;
        assert_eq!(
            response.status, 400,
            "expected 400 for {query}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

// ============================================================================
// The stub that is gone (task D7)
// ============================================================================

#[tokio::test]
async fn the_update_daily_stub_is_gone() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-no-stub@test.com").await;
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // `POST /analytics/update-daily` logged a line, stored nothing and
    // answered `recordsProcessed: 0`. The funnel is computed live, so there
    // is nothing for a daily rollup to materialise and the route is deleted
    // rather than left to look like a job that runs.
    let response = client.post("/api/analytics/update-daily", &Value::Null).await;
    assert_eq!(
        response.status, 404,
        "the stub must be gone, not answering; got {} with body {}",
        response.status, response.body
    );

    app.cleanup().await.ok();
}
