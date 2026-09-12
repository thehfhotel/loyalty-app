//! Integration coverage for the shadow-window agreement report (A9).
//!
//! The arithmetic and the thresholds are unit-tested in
//! `routes::admin_slip_report`; this file proves the half a pure function
//! cannot: that the SQL selects the right rows out of a real
//! `booking_slips` table, that the window and the property filter bite, that
//! a machine's own confirmation is never counted as agreement with itself,
//! and that the endpoint is admin-only.
//!
//! What is asserted:
//!
//! - the agreement math over seeded slips, per property and overall;
//! - a slip still `pending` with the admin, or checked outside the window,
//!   is not a row;
//! - a slip the *machine* verified (auto-verify on) is excluded — the
//!   machine agreeing with itself is not evidence;
//! - `?property=` splits, and an unknown property is refused rather than
//!   answered with an empty report;
//! - the recommendation flips from `keep shadow` to `flip` at the documented
//!   thresholds;
//! - a non-admin gets 403.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use uuid::Uuid;

use loyalty_backend::services::slip_confirm::SLIPOK_SYSTEM_USER_ID;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Fixtures
// ============================================================================

/// A booking awaiting payment at `property`, the shape a slip hangs off.
async fn seed_booking(pool: &sqlx::PgPool, user_id: Uuid, property: &str) -> Uuid {
    let booking_id = Uuid::new_v4();
    let today = Utc::now().date_naive();

    sqlx::query(
        r#"
        INSERT INTO bookings
            (id, user_id, room_id, room_type_id, check_in_date, check_out_date,
             num_guests, total_price, status, property, payment_option, amount_due_now)
        VALUES ($1, $2, NULL, NULL, $3, $4, 2, 3000.00, 'pending', $5,
                'deposit50', 1500.00)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(today + Duration::days(10))
    .bind(today + Duration::days(12))
    .bind(property)
    .execute(pool)
    .await
    .expect("insert booking fixture");

    booking_id
}

/// One row of the shadow-window data set, written straight onto the slip in
/// the shape `run_slipok_check` and the admin routes leave it in.
#[allow(clippy::too_many_arguments)]
async fn seed_slip(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    uploaded_by: Uuid,
    machine_status: &str,
    machine_reason: Option<&str>,
    checked_at: DateTime<Utc>,
    admin_status: &str,
    admin_verified_by: Option<Uuid>,
) -> Uuid {
    let slip_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO booking_slips
            (id, booking_id, slip_url, uploaded_by, uploaded_at,
             slipok_status, slipok_reason, slipok_checked_at,
             admin_status, admin_verified_by, admin_verified_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $8, $9,
                CASE WHEN $8 = 'pending' THEN NULL ELSE $5 END)
        "#,
    )
    .bind(slip_id)
    .bind(booking_id)
    .bind(format!("/storage/slips/{slip_id}.jpg"))
    .bind(uploaded_by)
    .bind(checked_at)
    .bind(machine_status)
    .bind(machine_reason)
    .bind(admin_status)
    .bind(admin_verified_by)
    .execute(pool)
    .await
    .expect("insert slip fixture");

    slip_id
}

/// The window every fixture sits in: yesterday, comfortably inside the
/// fourteen-day default.
fn inside_window() -> DateTime<Utc> {
    Utc::now() - Duration::days(1)
}

async fn admin_and_guest(app: &TestApp) -> (TestUser, TestUser) {
    let admin = TestUser::admin(&format!("admin-{}@example.com", Uuid::new_v4()));
    admin.insert(app.db()).await.expect("insert admin");
    let guest = TestUser::new(&format!("guest-{}@example.com", Uuid::new_v4()));
    guest.insert(app.db()).await.expect("insert guest");
    (admin, guest)
}

async fn fetch_report(app: &TestApp, admin: &TestUser, query: &str) -> Value {
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .get(&format!("/api/admin/slips/agreement-report{query}"))
        .await;
    response.assert_success();
    response.json().expect("report is JSON")
}

// ============================================================================
// Cases
// ============================================================================

/// The whole shape, over a mixed window: agreements, both disagreement
/// kinds, an `unavailable` row that must not move the rate, and a reason
/// histogram.
#[tokio::test]
async fn the_report_counts_agreement_over_a_mixed_window() {
    let app = TestApp::new().await.expect("test app");
    let (admin, guest) = admin_and_guest(&app).await;
    let booking = seed_booking(app.db(), guest.id, "hf").await;
    let when = inside_window();

    // Three the machine passed and a person verified: agreement.
    for _ in 0..3 {
        seed_slip(
            app.db(),
            booking,
            guest.id,
            "shadow_pass",
            None,
            when,
            "verified",
            Some(admin.id),
        )
        .await;
    }
    // Two the machine stopped and a person also rejected: agreement.
    for _ in 0..2 {
        seed_slip(
            app.db(),
            booking,
            guest.id,
            "manual",
            Some("amount_mismatch"),
            when,
            "needs_action",
            Some(admin.id),
        )
        .await;
    }
    // One the machine stopped and a person approved anyway: the cheap miss.
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "manual",
        Some("receiver_mismatch"),
        when,
        "verified",
        Some(admin.id),
    )
    .await;
    // One the machine would have confirmed and a person refused: the
    // expensive miss.
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        when,
        "needs_action",
        Some(admin.id),
    )
    .await;
    // One the machine had no opinion on: counted, never judged.
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "unavailable",
        Some("quota_exceeded"),
        when,
        "verified",
        Some(admin.id),
    )
    .await;

    let report = fetch_report(&app, &admin, "").await;
    let overall = &report["overall"];

    assert_eq!(overall["rowsConsidered"], 8);
    assert_eq!(
        overall["decidableRows"], 7,
        "the unavailable row is not one"
    );
    assert_eq!(overall["agreements"], 5);
    assert_eq!(overall["disagreementCount"], 2);
    assert_eq!(overall["machineVerifiedHumanRejected"], 1);
    assert_eq!(overall["humanVerifiedMachineManual"], 1);
    assert_eq!(overall["humanVerifiedRows"], 5);
    assert_eq!(overall["machineVerdicts"]["shadowPass"], 4);
    assert_eq!(overall["machineVerdicts"]["manual"], 3);
    assert_eq!(overall["machineVerdicts"]["unavailable"], 1);
    assert_eq!(overall["humanDecisions"]["verified"], 5);
    assert_eq!(overall["humanDecisions"]["needsAction"], 3);

    let rate = overall["agreementRate"].as_f64().expect("a rate");
    assert!((rate - 5.0 / 7.0).abs() < 1e-9, "agreement rate {rate}");

    let histogram = overall["reasonHistogram"]
        .as_array()
        .expect("a histogram")
        .iter()
        .map(|r| {
            (
                r["reason"].as_str().expect("reason").to_string(),
                r["count"].as_u64().expect("count"),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        histogram,
        vec![
            ("amount_mismatch".to_string(), 2),
            ("quota_exceeded".to_string(), 1),
            ("receiver_mismatch".to_string(), 1),
        ]
    );

    // Both disagreements are listed, named, and carry no guest identifiers.
    let disagreements = overall["disagreements"].as_array().expect("a list");
    assert_eq!(disagreements.len(), 2);
    let kinds: Vec<&str> = disagreements
        .iter()
        .map(|d| d["kind"].as_str().expect("kind"))
        .collect();
    assert!(kinds.contains(&"machine_verified_human_rejected"));
    assert!(kinds.contains(&"human_verified_machine_manual"));
    for d in disagreements {
        assert_eq!(
            d["decidedBy"].as_str().expect("decidedBy"),
            admin.id.to_string()
        );
        assert!(d.get("slipUrl").is_none());
        assert!(d.get("guestName").is_none());
    }

    // Eight rows is below the floor, and the expensive miss is non-zero.
    assert_eq!(overall["recommendation"]["verdict"], "keep shadow");
    let failed: Vec<&str> = overall["recommendation"]["failedThresholds"]
        .as_array()
        .expect("thresholds")
        .iter()
        .map(|t| t.as_str().expect("threshold"))
        .collect();
    assert!(failed.contains(&"rows"));
    assert!(failed.contains(&"machine_verified_human_rejected"));

    app.cleanup().await.expect("cleanup");
}

/// A slip nobody has decided yet is not evidence, and neither is one the
/// machine checked outside the window.
#[tokio::test]
async fn undecided_and_out_of_window_slips_are_not_rows() {
    let app = TestApp::new().await.expect("test app");
    let (admin, guest) = admin_and_guest(&app).await;
    let booking = seed_booking(app.db(), guest.id, "hf").await;

    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        inside_window(),
        "verified",
        Some(admin.id),
    )
    .await;
    // Still waiting for reception.
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        inside_window(),
        "pending",
        None,
    )
    .await;
    // Decided, but checked long before the window opened.
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        Utc::now() - Duration::days(90),
        "verified",
        Some(admin.id),
    )
    .await;

    let report = fetch_report(&app, &admin, "").await;
    assert_eq!(report["overall"]["rowsConsidered"], 1);

    app.cleanup().await.expect("cleanup");
}

/// With `SLIPOK_AUTO_VERIFY` on, an automatic confirmation stamps the slip
/// `verified` against the SlipOK system actor. Counting it would be the
/// machine marking its own homework — and would push the agreement rate
/// towards 100 % exactly as the flag got riskier.
#[tokio::test]
async fn a_slip_the_machine_verified_itself_is_not_evidence() {
    let app = TestApp::new().await.expect("test app");
    let (admin, guest) = admin_and_guest(&app).await;
    let booking = seed_booking(app.db(), guest.id, "hf").await;
    let when = inside_window();

    seed_slip(
        app.db(),
        booking,
        guest.id,
        "verified",
        None,
        when,
        "verified",
        Some(SLIPOK_SYSTEM_USER_ID),
    )
    .await;
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        when,
        "verified",
        Some(admin.id),
    )
    .await;

    let report = fetch_report(&app, &admin, "").await;
    assert_eq!(
        report["overall"]["rowsConsidered"], 1,
        "only the slip a person decided"
    );
    assert_eq!(report["overall"]["machineVerdicts"]["verified"], 0);

    app.cleanup().await.expect("cleanup");
}

/// The per-property split, and the `?property=` filter over the same data.
#[tokio::test]
async fn the_report_splits_by_property_and_filters_on_it() {
    let app = TestApp::new().await.expect("test app");
    let (admin, guest) = admin_and_guest(&app).await;
    let hf = seed_booking(app.db(), guest.id, "hf").await;
    let hfville = seed_booking(app.db(), guest.id, "hfville").await;
    let when = inside_window();

    for _ in 0..3 {
        seed_slip(
            app.db(),
            hf,
            guest.id,
            "shadow_pass",
            None,
            when,
            "verified",
            Some(admin.id),
        )
        .await;
    }
    seed_slip(
        app.db(),
        hfville,
        guest.id,
        "shadow_pass",
        None,
        when,
        "needs_action",
        Some(admin.id),
    )
    .await;

    let report = fetch_report(&app, &admin, "").await;
    assert_eq!(report["overall"]["rowsConsidered"], 4);

    let sections = report["properties"].as_array().expect("sections");
    assert_eq!(sections.len(), 2);
    assert_eq!(sections[0]["property"], "hf");
    assert_eq!(sections[0]["rowsConsidered"], 3);
    assert_eq!(sections[0]["machineVerifiedHumanRejected"], 0);
    assert_eq!(sections[1]["property"], "hfville");
    assert_eq!(sections[1]["machineVerifiedHumanRejected"], 1);

    // Filtered, the other property is gone entirely.
    let hf_only = fetch_report(&app, &admin, "?property=hf").await;
    assert_eq!(hf_only["property"], "hf");
    assert_eq!(hf_only["overall"]["rowsConsidered"], 3);
    let sections = hf_only["properties"].as_array().expect("sections");
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0]["property"], "hf");

    // An unknown property is a caller error. Answering it with an empty
    // report would read exactly like "no disagreements".
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .get("/api/admin/slips/agreement-report?property=nowhere")
        .await
        .assert_status(400);

    app.cleanup().await.expect("cleanup");
}

/// Twenty clean rows, no expensive miss, and the false-manual rate inside
/// the ceiling: the one case that earns `flip`.
#[tokio::test]
async fn a_clean_window_of_twenty_rows_recommends_the_flip() {
    let app = TestApp::new().await.expect("test app");
    let (admin, guest) = admin_and_guest(&app).await;
    let booking = seed_booking(app.db(), guest.id, "hf").await;
    let when = inside_window();

    // 18 agreements on the pass side, 2 the machine sent to manual and a
    // person approved: 2 of 20 human-verified = 10 %, inside the 20 % ceiling.
    for _ in 0..18 {
        seed_slip(
            app.db(),
            booking,
            guest.id,
            "shadow_pass",
            None,
            when,
            "verified",
            Some(admin.id),
        )
        .await;
    }
    for _ in 0..2 {
        seed_slip(
            app.db(),
            booking,
            guest.id,
            "manual",
            Some("slip_invalid"),
            when,
            "verified",
            Some(admin.id),
        )
        .await;
    }

    let report = fetch_report(&app, &admin, "").await;
    let overall = &report["overall"];
    assert_eq!(overall["rowsConsidered"], 20);
    assert_eq!(overall["machineVerifiedHumanRejected"], 0);
    assert_eq!(overall["humanVerifiedMachineManual"], 2);
    assert_eq!(overall["recommendation"]["verdict"], "flip");
    assert!(overall["recommendation"]["failedThresholds"]
        .as_array()
        .expect("thresholds")
        .is_empty());

    // One slip the machine would have confirmed and a person refused takes
    // the recommendation straight back to `keep shadow`.
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        when,
        "needs_action",
        Some(admin.id),
    )
    .await;
    let report = fetch_report(&app, &admin, "").await;
    assert_eq!(
        report["overall"]["recommendation"]["verdict"],
        "keep shadow"
    );
    assert_eq!(
        report["overall"]["recommendation"]["failedThresholds"]
            .as_array()
            .expect("thresholds"),
        &vec![Value::from("machine_verified_human_rejected")]
    );

    app.cleanup().await.expect("cleanup");
}

/// An explicit window is honoured — and it is the *machine check* time the
/// window is measured against, which is what makes "the fourteen-day shadow
/// run" a meaningful phrase.
#[tokio::test]
async fn an_explicit_window_selects_by_the_machine_check_time() {
    let app = TestApp::new().await.expect("test app");
    let (admin, guest) = admin_and_guest(&app).await;
    let booking = seed_booking(app.db(), guest.id, "hf").await;

    let old = Utc::now() - Duration::days(40);
    let recent = Utc::now() - Duration::days(2);
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        old,
        "verified",
        Some(admin.id),
    )
    .await;
    seed_slip(
        app.db(),
        booking,
        guest.id,
        "shadow_pass",
        None,
        recent,
        "verified",
        Some(admin.id),
    )
    .await;

    let from = (old - Duration::days(1)).date_naive();
    let to = (old + Duration::days(1)).date_naive();
    let report = fetch_report(&app, &admin, &format!("?from={from}&to={to}")).await;

    assert_eq!(report["from"], from.to_string());
    assert_eq!(report["to"], to.to_string());
    assert_eq!(report["overall"]["rowsConsidered"], 1);

    app.cleanup().await.expect("cleanup");
}

/// It is an admin report. A signed-in guest must not be able to read other
/// people's slip decisions, however anonymised they are.
#[tokio::test]
async fn a_non_admin_is_refused() {
    let app = TestApp::new().await.expect("test app");
    let (_, guest) = admin_and_guest(&app).await;

    let client = app.authenticated_client(&guest.id, &guest.email);
    client
        .get("/api/admin/slips/agreement-report")
        .await
        .assert_status(403);

    app.cleanup().await.expect("cleanup");
}
