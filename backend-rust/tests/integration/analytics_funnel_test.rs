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
//!
//! The one exception is the still-live deposit link in the task D15 friction
//! coverage below. "This hold has not lapsed yet" is a fact about the clock
//! and nothing else — the expired-hold proxy compares `expires_at` against
//! `NOW()` — so a fixed future date would quietly become a lapsed hold on the
//! day it passed and turn the test red for no reason. That one fixture is
//! written relative to `now()` on purpose, and says so where it is seeded.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use loyalty_backend::services::slip_confirm::SLIPOK_SYSTEM_USER_ID;

use crate::common::{TestApp, TestUser};

/// The non-loginable actor every deposit-link booking is owned by, seeded by
/// `20260912010000_deposit_links.sql`.
const DEPOSIT_LINK_SYSTEM_USER: &str = "00000000-0000-4000-8000-0000005110b2";

/// 08:00 on 1 September 2026 in Bangkok, as the instant the database stores.
fn bangkok(day: &str, hour: i64, minute: i64) -> DateTime<Utc> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").expect("fixture date");
    let midnight_utc = date.and_hms_opt(0, 0, 0).expect("midnight").and_utc();
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
    // Two days is `admin_deposit_links::DEFAULT_EXPIRY_HOURS` in spirit; the
    // fixture instants are all in the fixed past, so every link seeded this
    // way has a window that has already closed.
    seed_link_with_window(
        pool,
        booking_id,
        issued_at,
        opened_at,
        issued_at + Duration::days(2),
        None,
    )
    .await
}

/// Insert a deposit link with an explicit payment window and revocation.
///
/// The expired-hold proxy is the one counter that reads the clock
/// (`expires_at <= NOW()`), so its fixtures have to say where the window sits
/// relative to now rather than only where it sits in the seeded world.
async fn seed_link_with_window(
    pool: &PgPool,
    booking_id: Uuid,
    issued_at: DateTime<Utc>,
    opened_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO booking_deposit_links (
            booking_id, token_hash, issued_by, issued_at, expires_at,
            first_opened_at, last_opened_at, open_count, revoked_at
        )
        VALUES ($1, $2, $3, $4, $6, $5, $5,
                CASE WHEN $5::timestamptz IS NULL THEN 0 ELSE 1 END, $7)
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
    .bind(expires_at)
    .bind(revoked_at)
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
    seed_slip_decided_by(
        pool,
        booking_id,
        uploaded_at,
        slipok_status,
        admin_status,
        decided_at,
        None,
    )
    .await
}

/// Insert a slip and say **who** decided it. `decided_by` `None` leaves
/// `admin_verified_by` NULL, which is what every hand-made fixture wants; an
/// automatic verify passes [`SLIPOK_SYSTEM_USER_ID`], exactly as
/// `services::slip_confirm` stamps it.
#[allow(clippy::too_many_arguments)]
async fn seed_slip_decided_by(
    pool: &PgPool,
    booking_id: Uuid,
    uploaded_at: DateTime<Utc>,
    slipok_status: &str,
    admin_status: &str,
    decided_at: Option<DateTime<Utc>>,
    decided_by: Option<Uuid>,
) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO booking_slips (
            booking_id, slip_url, uploaded_by, uploaded_at,
            slipok_status, admin_status, admin_verified_at, admin_verified_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    .bind(decided_by)
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
    seed_booking(
        pool,
        None,
        "confirmed",
        None,
        None,
        bangkok("2026-09-01", 12, 0),
    )
    .await;
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
    body["buckets"]
        .as_array()
        .expect("buckets array")
        .iter()
        .find(|b| {
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
        assert_eq!(
            entry["property"], "hf",
            "the filter leaked another property"
        );
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
    assert_eq!(
        hf["bookingsConfirmed"], 1,
        "two links, one booking: counting the links would make the funnel \
         rise at its last stage"
    );
    assert_eq!(
        body["totals"]["bookingsConfirmed"], 1,
        "and the totals row must not double it either"
    );
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
    // The *latest* slip's decision — the same slip the verdicts above come
    // from — 10 minutes after it landed.
    assert_eq!(hf["medianMinutesSlipToDecision"], 10.0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_reissue_after_the_window_still_closes_the_link_inside_it() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-reissue-outside@test.com").await;

    // Reception issued a link on 1 September, the guest never paid, and
    // weeks later — outside the window this report asks about — reception
    // reissued and the guest paid against the new link.
    //
    // The successor has to be found over EVERY link of the booking. Sought
    // only among the links inside the window, September's link looks like
    // the live one for ever: it swallows the October slip, the day reports a
    // payment that happened in another month, the same slip is counted again
    // in October's report, and the link-to-slip median inherits the 19-day
    // gap between them.
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
        Some(bangkok("2026-09-01", 8, 5)),
    )
    .await;
    sqlx::query("UPDATE booking_deposit_links SET revoked_at = $1 WHERE booking_id = $2")
        .bind(bangkok("2026-09-20", 10, 0))
        .bind(booking)
        .execute(app.db())
        .await
        .expect("revoke the first link");
    seed_link(
        app.db(),
        booking,
        bangkok("2026-09-20", 10, 0),
        Some(bangkok("2026-09-20", 10, 5)),
    )
    .await;
    seed_slip(
        app.db(),
        booking,
        bangkok("2026-09-20", 10, 30),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-20", 10, 50)),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;
    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");

    assert_eq!(
        hf["linksIssued"], 1,
        "only September's link is in the window"
    );
    assert_eq!(
        hf["slipsUploaded"], 0,
        "the October slip belongs to the link that superseded this one"
    );
    assert_eq!(hf["humanDecision"]["verified"], 0);
    assert_eq!(
        hf["medianMinutesLinkToSlip"],
        Value::Null,
        "no slip in this cohort means no timing, not a 19-day one"
    );
    // The booking really is confirmed — that much is true on 1 September's
    // row, because the link that led to it was issued that day.
    assert_eq!(hf["bookingsConfirmed"], 1);

    // And the slip lands exactly once, in the window that actually contains
    // the link it was uploaded against.
    let october = funnel(&app, &admin, "?startDate=2026-09-20&endDate=2026-09-21").await;
    let late = bucket(&october, "2026-09-20", "hf").expect("20 Sep hf bucket");
    assert_eq!(late["linksIssued"], 1);
    assert_eq!(late["slipsUploaded"], 1);
    assert_eq!(late["medianMinutesLinkToSlip"], 30.0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn an_automatic_verify_is_not_a_staff_decision() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "funnel-auto-verify@test.com").await;

    // With SLIPOK_AUTO_VERIFY on, `services::slip_confirm` writes
    // `admin_status = 'verified'` stamped with the SlipOK actor. Counted as a
    // staff decision, that would inflate the "staff decided" stage and pull
    // the slip-to-decision median towards zero — which would hide exactly
    // the thing this card is meant to calibrate.
    let auto = seed_booking(
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
        auto,
        bangkok("2026-09-01", 8, 0),
        Some(bangkok("2026-09-01", 8, 2)),
    )
    .await;
    seed_slip_decided_by(
        app.db(),
        auto,
        bangkok("2026-09-01", 8, 10),
        "verified",
        "verified",
        Some(bangkok("2026-09-01", 8, 11)),
        Some(SLIPOK_SYSTEM_USER_ID),
    )
    .await;

    // A second request an admin really did look at, so the median has
    // something human to report.
    let by_hand = seed_booking(
        app.db(),
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-01", 9, 0),
    )
    .await;
    seed_link(
        app.db(),
        by_hand,
        bangkok("2026-09-01", 9, 0),
        Some(bangkok("2026-09-01", 9, 2)),
    )
    .await;
    seed_slip_decided_by(
        app.db(),
        by_hand,
        bangkok("2026-09-01", 9, 10),
        "manual",
        "needs_action",
        Some(bangkok("2026-09-01", 9, 40)),
        Some(admin.id),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-01").await;
    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");

    assert_eq!(hf["slipsUploaded"], 2);
    // The machine's own verdict still counts the auto-verify.
    assert_eq!(hf["machineVerdict"]["verified"], 1);
    assert_eq!(hf["machineVerdict"]["manual"], 1);

    assert_eq!(
        hf["humanDecision"]["verified"], 0,
        "nobody verified that slip — SlipOK did"
    );
    assert_eq!(hf["humanDecision"]["autoVerified"], 1);
    assert_eq!(hf["humanDecision"]["needsAction"], 1);
    assert_eq!(
        hf["humanDecision"]["pending"], 0,
        "an auto-verified slip is decided, not waiting for staff"
    );

    // The four still account for every slip.
    let decisions = &hf["humanDecision"];
    let summed = decisions["verified"].as_i64().unwrap()
        + decisions["needsAction"].as_i64().unwrap()
        + decisions["autoVerified"].as_i64().unwrap()
        + decisions["pending"].as_i64().unwrap();
    assert_eq!(summed, hf["slipsUploaded"].as_i64().unwrap());

    assert_eq!(
        hf["medianMinutesSlipToDecision"], 30.0,
        "only the admin's 30 minutes: the machine's 1 minute is not a \
         staff response time"
    );

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
    assert!(first["humanDecision"].get("autoVerified").is_some());
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
        // `granularity` reaches `date_trunc` as a bind parameter, never as
        // text spliced into the SQL — the allowlist is what turns an unknown
        // field name into a 400 rather than a Postgres error read as a 500.
        "?granularity=hour",
        // Percent-encoded, because a raw one is not a valid request URI and
        // would never reach the handler to be refused.
        "?granularity=day%27%29%3B%20DROP%20TABLE%20bookings%20--",
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
    let response = client
        .post("/api/analytics/update-daily", &Value::Null)
        .await;
    assert_eq!(
        response.status, 404,
        "the stub must be gone, not answering; got {} with body {}",
        response.status, response.body
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Friction proxies (task D15)
// ============================================================================
//
// Three standing lines, so the weekly pack can say whether last week's fix
// worked: slips handed back, bookings cancelled after the deposit landed, and
// holds that lapsed unpaid. Each carries its numerator and denominator, and a
// rate of `null` — never `0` — when there is nothing to divide.

/// Read one friction proxy off a totals or bucket object.
fn friction<'a>(row: &'a Value, proxy: &str) -> &'a Value {
    &row["friction"][proxy]
}

#[tokio::test]
async fn friction_proxies_count_the_seeded_world() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-world@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;
    let hf = bucket(&body, "2026-09-01", "hf").expect("1 Sep hf bucket");

    // Two links got a slip; the handed-back one still sits on needs_action.
    let needs_action = friction(hf, "needsActionSlipRate");
    assert_eq!(needs_action["numerator"], 1);
    assert_eq!(needs_action["denominator"], 2, "links with a slip");
    assert_eq!(needs_action["rate"], 0.5);

    // One booking had a slip verified, and it is confirmed, not cancelled.
    let cancelled = friction(hf, "cancelAfterDepositRate");
    assert_eq!(cancelled["numerator"], 0);
    assert_eq!(cancelled["denominator"], 1);
    assert_eq!(
        cancelled["rate"], 0.0,
        "0 out of 1 is a real rate; only 0 out of 0 is null"
    );

    // All four windows closed two days after they were issued, in the fixed
    // past. Only the paid request escapes the numerator.
    let expired = friction(hf, "expiredHoldRate");
    assert_eq!(expired["numerator"], 3);
    assert_eq!(expired["denominator"], 4);
    assert_eq!(expired["rate"], 0.75);

    let totals = &body["totals"];
    assert_eq!(friction(totals, "needsActionSlipRate")["rate"], 0.3333);
    assert_eq!(friction(totals, "cancelAfterDepositRate")["denominator"], 1);
    assert_eq!(friction(totals, "expiredHoldRate")["numerator"], 4);
    assert_eq!(friction(totals, "expiredHoldRate")["denominator"], 5);
    assert_eq!(friction(totals, "expiredHoldRate")["rate"], 0.8);

    // Nothing the funnel already published moved.
    assert_eq!(totals["linksIssued"], 5);
    assert_eq!(totals["slipsUploaded"], 3);
    assert_eq!(totals["humanDecision"]["needsAction"], 1);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_verified_reupload_clears_an_earlier_needs_action() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-reupload@test.com").await;

    // The guest's first slip was handed back and the second was accepted.
    // The proxy reads the LATEST slip, so this guest is no longer friction:
    // counting the history instead would make a desk that fixes problems
    // look worse than one that ignores them.
    let fixed = seed_booking(
        app.db(),
        Some("hf"),
        "confirmed",
        Some("deposit_link"),
        None,
        bangkok("2026-09-05", 8, 0),
    )
    .await;
    seed_link(
        app.db(),
        fixed,
        bangkok("2026-09-05", 8, 0),
        Some(bangkok("2026-09-05", 8, 1)),
    )
    .await;
    seed_slip(
        app.db(),
        fixed,
        bangkok("2026-09-05", 8, 30),
        "manual",
        "needs_action",
        Some(bangkok("2026-09-05", 8, 40)),
    )
    .await;
    seed_slip(
        app.db(),
        fixed,
        bangkok("2026-09-05", 9, 0),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-05", 9, 10)),
    )
    .await;

    // And one that was handed back and left there.
    let still_stuck = seed_booking(
        app.db(),
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-05", 10, 0),
    )
    .await;
    seed_link(
        app.db(),
        still_stuck,
        bangkok("2026-09-05", 10, 0),
        Some(bangkok("2026-09-05", 10, 1)),
    )
    .await;
    seed_slip(
        app.db(),
        still_stuck,
        bangkok("2026-09-05", 10, 30),
        "manual",
        "needs_action",
        Some(bangkok("2026-09-05", 10, 40)),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-05&endDate=2026-09-05").await;
    let hf = bucket(&body, "2026-09-05", "hf").expect("5 Sep hf bucket");

    let needs_action = friction(hf, "needsActionSlipRate");
    assert_eq!(
        needs_action["numerator"], 1,
        "only the link still sitting on needs_action counts"
    );
    assert_eq!(needs_action["denominator"], 2);
    assert_eq!(needs_action["rate"], 0.5);

    // The re-upload also takes its booking out of the expired half: a
    // verified slip is the guest having paid.
    assert_eq!(friction(hf, "expiredHoldRate")["numerator"], 1);
    assert_eq!(friction(hf, "expiredHoldRate")["denominator"], 2);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_machine_handed_back_slip_is_friction_even_though_no_one_decided_it() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-machine@test.com").await;

    // `services::slip_confirm::revert_auto_confirm` moves a slip to
    // `needs_action` when the PMS refuses the confirm, WITHOUT re-stamping
    // `admin_verified_by` — so the row still names the SlipOK actor. The
    // funnel's `humanDecision` files that under `autoVerified`, because that
    // breakdown answers *who decided*. The friction proxy answers *what the
    // guest was put through*, and this guest was told to upload again.
    let bounced = seed_booking(
        app.db(),
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        bangkok("2026-09-06", 8, 0),
    )
    .await;
    seed_link(
        app.db(),
        bounced,
        bangkok("2026-09-06", 8, 0),
        Some(bangkok("2026-09-06", 8, 1)),
    )
    .await;
    seed_slip_decided_by(
        app.db(),
        bounced,
        bangkok("2026-09-06", 8, 30),
        "verified",
        "needs_action",
        Some(bangkok("2026-09-06", 8, 31)),
        Some(SLIPOK_SYSTEM_USER_ID),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-06&endDate=2026-09-06").await;
    let hf = bucket(&body, "2026-09-06", "hf").expect("6 Sep hf bucket");

    assert_eq!(
        hf["humanDecision"]["needsAction"], 0,
        "nobody at the desk decided this one"
    );
    assert_eq!(hf["humanDecision"]["autoVerified"], 1);
    assert_eq!(
        friction(hf, "needsActionSlipRate")["numerator"],
        1,
        "the guest was sent back regardless of who sent them"
    );
    assert_eq!(friction(hf, "needsActionSlipRate")["rate"], 1.0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_booking_cancelled_after_its_deposit_is_counted_once() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-cancel@test.com").await;

    // Reissue makes this one booking two links. A cancel-after-deposit rate
    // counted on links would report it twice and read as two guests lost.
    let refunded = seed_booking(
        app.db(),
        Some("hf"),
        "cancelled",
        Some("deposit_link"),
        None,
        bangkok("2026-09-07", 8, 0),
    )
    .await;
    seed_link_with_window(
        app.db(),
        refunded,
        bangkok("2026-09-07", 8, 0),
        Some(bangkok("2026-09-07", 8, 1)),
        bangkok("2026-09-09", 8, 0),
        Some(bangkok("2026-09-07", 9, 0)),
    )
    .await;
    seed_link(
        app.db(),
        refunded,
        bangkok("2026-09-07", 9, 0),
        Some(bangkok("2026-09-07", 9, 1)),
    )
    .await;
    // The slip landed against the second link and was verified: the money
    // arrived, and the booking was cancelled afterwards.
    seed_slip(
        app.db(),
        refunded,
        bangkok("2026-09-07", 9, 20),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-07", 9, 40)),
    )
    .await;

    // A second booking that paid and stayed booked, so the rate is not 100%.
    let kept = seed_booking(
        app.db(),
        Some("hf"),
        "checked_out",
        Some("deposit_link"),
        None,
        bangkok("2026-09-07", 10, 0),
    )
    .await;
    seed_link(
        app.db(),
        kept,
        bangkok("2026-09-07", 10, 0),
        Some(bangkok("2026-09-07", 10, 1)),
    )
    .await;
    seed_slip(
        app.db(),
        kept,
        bangkok("2026-09-07", 10, 20),
        "shadow_pass",
        "verified",
        Some(bangkok("2026-09-07", 10, 40)),
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-07&endDate=2026-09-07").await;
    let hf = bucket(&body, "2026-09-07", "hf").expect("7 Sep hf bucket");

    assert_eq!(hf["linksIssued"], 3, "two links on one booking, plus one");
    let cancelled = friction(hf, "cancelAfterDepositRate");
    assert_eq!(
        cancelled["numerator"], 1,
        "one booking, however many links it went through"
    );
    assert_eq!(
        cancelled["denominator"], 2,
        "two bookings had a slip verified"
    );
    assert_eq!(cancelled["rate"], 0.5);

    // And the totals row must not double it either.
    assert_eq!(
        friction(&body["totals"], "cancelAfterDepositRate")["numerator"],
        1
    );
    assert_eq!(
        friction(&body["totals"], "cancelAfterDepositRate")["denominator"],
        2
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_live_or_revoked_hold_is_in_neither_half_of_the_expired_rate() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-live-hold@test.com").await;

    let issued = bangkok("2026-09-08", 8, 0);

    // Lapsed: window closed in the fixed past, nothing paid.
    let lapsed = seed_booking(
        app.db(),
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        issued,
    )
    .await;
    seed_link(app.db(), lapsed, issued, Some(bangkok("2026-09-08", 8, 5))).await;

    // Still live. This is the one fixture that MUST be written relative to
    // `now()`: "the window has not closed yet" is a fact about the clock, and
    // a fixed future date would silently become a lapsed hold one day and
    // turn this test red for no reason. Counting it in the denominator would
    // make today's row read artificially good and then drift down as the day
    // aged — exactly the drift that would let the weekly pack claim a fix
    // worked.
    let still_live = seed_booking(
        app.db(),
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        issued,
    )
    .await;
    seed_link_with_window(
        app.db(),
        still_live,
        issued,
        None,
        Utc::now() + Duration::days(2),
        None,
    )
    .await;

    // Revoked by Reissue before it could lapse. It was replaced, not missed,
    // so scoring it as a settled hold would count reception's own correction
    // against them.
    let reissued = seed_booking(
        app.db(),
        Some("hf"),
        "pending",
        Some("deposit_link"),
        None,
        issued,
    )
    .await;
    seed_link_with_window(
        app.db(),
        reissued,
        issued,
        None,
        bangkok("2026-09-10", 8, 0),
        Some(bangkok("2026-09-08", 9, 0)),
    )
    .await;
    seed_link_with_window(
        app.db(),
        reissued,
        bangkok("2026-09-08", 9, 0),
        None,
        Utc::now() + Duration::days(2),
        None,
    )
    .await;

    let body = funnel(&app, &admin, "?startDate=2026-09-08&endDate=2026-09-08").await;
    let hf = bucket(&body, "2026-09-08", "hf").expect("8 Sep hf bucket");

    assert_eq!(hf["linksIssued"], 4, "every link is still an issuance");
    let expired = friction(hf, "expiredHoldRate");
    assert_eq!(
        expired["denominator"], 1,
        "only the lapsed link's window has closed without being revoked"
    );
    assert_eq!(expired["numerator"], 1);
    assert_eq!(expired["rate"], 1.0);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn an_empty_window_has_null_friction_rates_rather_than_zeroes() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-empty@test.com").await;
    seed_world(app.db()).await;

    // A window the seeded world does not reach. The card has to render
    // something, and "0%" would read as a week with no friction at all.
    let body = funnel(&app, &admin, "?startDate=2026-01-01&endDate=2026-01-31").await;
    assert_eq!(body["buckets"].as_array().expect("buckets").len(), 0);

    let totals = &body["totals"];
    for proxy in [
        "needsActionSlipRate",
        "cancelAfterDepositRate",
        "expiredHoldRate",
    ] {
        let rate = friction(totals, proxy);
        assert_eq!(rate["rate"], Value::Null, "{proxy} must not report 0%");
        assert_eq!(rate["numerator"], 0);
        assert_eq!(rate["denominator"], 0);
        assert_eq!(
            rate["reason"], "no_data",
            "{proxy} must say why it is blank — a standing line that goes \
             quiet is one nobody can read"
        );
    }

    app.cleanup().await.ok();
}

#[tokio::test]
async fn a_friction_rate_that_exists_carries_no_reason() {
    let app = TestApp::new().await.expect("create test app");
    let admin = seed_admin(&app, "friction-reason@test.com").await;
    seed_world(app.db()).await;

    let body = funnel(&app, &admin, "?startDate=2026-09-01&endDate=2026-09-02").await;
    let expired = friction(&body["totals"], "expiredHoldRate");

    assert_eq!(expired["rate"], 0.8);
    assert_eq!(
        expired.get("reason"),
        None,
        "a reason beside a real rate would read as a caveat on it"
    );

    // The hfville bucket has nobody who paid, so its cancel rate is the
    // blank-with-a-reason case inside an otherwise populated response.
    let hfville = bucket(&body, "2026-09-02", "hfville").expect("2 Sep hfville bucket");
    let cancelled = friction(hfville, "cancelAfterDepositRate");
    assert_eq!(cancelled["rate"], Value::Null);
    assert_eq!(cancelled["reason"], "no_data");

    app.cleanup().await.ok();
}
