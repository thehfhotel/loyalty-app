//! The read-only reporting credential (task D14b).
//!
//! `REPORT_READ_TOKEN` exists so the weekly measurement pack can read three
//! production numbers through the API instead of through a superuser `psql`
//! session, which is what it had been doing and what `CLAUDE.md` hard rule 5
//! forbids. The whole value of that trade depends on three properties, and
//! this file is where each one is nailed down:
//!
//! 1. **It opens exactly three GET endpoints.** `deposit_funnel`,
//!    `admin/stats`, `admin/slips/agreement-report`. Anything else under
//!    `/api/admin` must answer 401 to the same token — otherwise the
//!    credential is an admin login with extra steps.
//! 2. **It changes nothing for admins.** An admin JWT reads all three
//!    exactly as before, a customer JWT is still 403, an anonymous caller is
//!    still 401 — with the feature on *and* with it off.
//! 3. **Every use leaves a row.** `user_audit_log`, actor `report_token`,
//!    naming the route. A read nobody can account for is the thing the
//!    `psql` session was criticised for.
//!
//! Plus the two guards that keep it from being trivially attacked: a wrong
//! token is refused, and the per-IP budget is charged *before* the
//! comparison so guessing costs the guesser.
//!
//! The feature is off in `create_test_config`, so every test here that
//! wants it on says so through `TestApp::new_with_config` — which is also
//! how `report_token_is_inert_when_unconfigured` proves the off state.

use serde_json::Value;

use crate::common::{TestApp, TestClient, TestUser, TEST_REPORT_READ_TOKEN};

/// The three routes the token is supposed to open.
const REPORT_ROUTES: [&str; 3] = [
    "/api/analytics/deposit-funnel",
    "/api/admin/stats",
    "/api/admin/slips/agreement-report",
];

/// A representative slice of the admin surface the token must NOT open.
///
/// Deliberately mixed, and deliberately weighted towards the **nearest
/// neighbours** — the routes a mis-scoped layer would take with it:
///
/// * the other endpoints in the two routers the three opened routes live
///   in (`/api/admin/*`, `/api/analytics/*`);
/// * `/api/admin/slips/...`'s actual sibling, `/api/admin/bookings/slips/:id`,
///   which is the one path that could plausibly be caught by a sloppy
///   prefix match against `slips`;
/// * every other module merged into the admin router — rooms, bookings,
///   deposit links, the LINE push budget — since each is merged the same
///   way the agreement report used to be;
/// * the two **PDPA** routes, which matter most of all: `/privacy/requests`
///   lists data-subject requests and `/privacy/requests/:id/export` is the
///   s.30 access export, i.e. the single most sensitive personal-data read
///   in the codebase. A reporting credential reaching that would be far
///   worse than the `psql` session this replaces.
///
/// The `:id` segments carry a syntactically valid UUID so the path matches
/// its route pattern and the refusal comes from `auth_middleware` rather
/// than from a 404 — a 404 would pass this test for the wrong reason.
const FORBIDDEN_ROUTES: [&str; 12] = [
    "/api/admin/users",
    "/api/admin/analytics",
    "/api/admin/new-member-coupon-settings",
    "/api/admin/deposit-links",
    "/api/admin/bookings",
    "/api/admin/bookings/slips/00000000-0000-4000-8000-000000000001",
    "/api/admin/rooms",
    "/api/admin/line/push-budget",
    "/api/admin/privacy/requests",
    "/api/admin/privacy/requests/00000000-0000-4000-8000-000000000001/export",
    "/api/analytics/dashboard",
    "/api/analytics/user-engagement",
];

/// A `TestApp` with `REPORT_READ_TOKEN` set.
async fn app_with_report_token() -> TestApp {
    TestApp::new_with_config(&|settings| {
        settings.report_read.token = Some(TEST_REPORT_READ_TOKEN.to_string());
    })
    .await
    .expect("create test app with a report token")
}

/// A client presenting `token` as a bearer and nothing else.
fn bearer_client(app: &TestApp, token: &str) -> TestClient {
    TestClient::new(app.router()).with_auth(token)
}

/// An admin JWT client.
async fn admin_client(app: &TestApp, email: &str) -> TestClient {
    let admin = TestUser::admin(email);
    admin.insert(app.db()).await.expect("insert admin");
    app.authenticated_client_with_role(&admin.id, &admin.email, "admin")
}

// ============================================================================
// 1. What the token opens
// ============================================================================

/// The three routes the weekly pack reads answer the report token.
#[tokio::test]
async fn report_token_reads_the_three_weekly_pack_endpoints() {
    let app = app_with_report_token().await;
    let client = bearer_client(&app, TEST_REPORT_READ_TOKEN);

    for route in REPORT_ROUTES {
        let response = client.get(route).await;
        assert_eq!(
            response.status, 200,
            "the report token must read {route}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

/// `/api/admin/stats` carries the two figures the pack actually takes from
/// it. A 200 with a different shape would pass the test above and still
/// break the pack.
#[tokio::test]
async fn report_token_stats_carries_total_users_and_line_followers() {
    let app = app_with_report_token().await;
    let client = bearer_client(&app, TEST_REPORT_READ_TOKEN);

    let response = client.get("/api/admin/stats").await;
    response.assert_status(200);

    let body: Value = response.json().expect("stats body is JSON");
    let data = body.get("data").expect("stats body has a data object");
    // The casing is mixed on this struct and that is deliberate upstream:
    // `total_users` is snake_case like its siblings, `lineFollowers` was
    // added camelCase (D2b) with an explicit `#[serde(rename)]`. Pin both
    // spellings — the pack reads these keys by name.
    assert!(
        data.get("total_users").is_some(),
        "stats must carry total_users, got {data}"
    );
    assert!(
        data.get("lineFollowers").is_some(),
        "stats must carry lineFollowers (D2b), got {data}"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 2. What the token does NOT open — the load-bearing assertion
// ============================================================================

/// The same token, on the rest of the admin surface, is nobody.
///
/// This is the assertion that makes `REPORT_READ_TOKEN` safe to hand a
/// machine. Those routes are still behind `auth_middleware`, which sees a
/// bearer that is not a JWT and refuses it — the report layer is mounted
/// with `route_layer` on three routes and cannot reach them.
#[tokio::test]
async fn report_token_is_refused_on_every_other_admin_route() {
    let app = app_with_report_token().await;
    let client = bearer_client(&app, TEST_REPORT_READ_TOKEN);

    for route in FORBIDDEN_ROUTES {
        let response = client.get(route).await;
        assert_eq!(
            response.status, 401,
            "the report token must be refused on {route}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

/// A token that is not the configured one opens nothing, including the
/// three routes it would otherwise open.
#[tokio::test]
async fn a_wrong_report_token_opens_nothing() {
    let app = app_with_report_token().await;
    // Shares a long prefix with the real token on purpose: a comparison
    // that short-circuits on the first differing byte, or one that
    // accepted a prefix, would still refuse this — but the digest
    // comparison is what makes "how long a prefix" unobservable, and the
    // unit tests in `middleware::report_token` cover that half.
    let client = bearer_client(&app, "test-report-read-token-0123456789abcdeX");

    for route in REPORT_ROUTES {
        let response = client.get(route).await;
        assert_eq!(
            response.status, 401,
            "a wrong token must not read {route}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

/// With the secret unset the middleware is inert: the very token the other
/// tests use reads nothing, because there is nothing to match it against.
///
/// This is the production default and the state every other test in the
/// suite runs in, so it is worth asserting rather than assuming.
#[tokio::test]
async fn report_token_is_inert_when_unconfigured() {
    let app = TestApp::new().await.expect("create test app");
    let client = bearer_client(&app, TEST_REPORT_READ_TOKEN);

    for route in REPORT_ROUTES {
        let response = client.get(route).await;
        assert_eq!(
            response.status, 401,
            "with REPORT_READ_TOKEN unset nothing may open {route}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

// ============================================================================
// 3. Admins are unaffected, feature on or off
// ============================================================================

/// An admin JWT still reads all three, with the report layer in front of
/// them. The layer must pass a non-matching bearer through untouched — an
/// admin JWT arrives in exactly the same header as the report token.
#[tokio::test]
async fn an_admin_jwt_still_reads_all_three_with_the_feature_on() {
    let app = app_with_report_token().await;
    let client = admin_client(&app, "report-admin@test.com").await;

    for route in REPORT_ROUTES {
        let response = client.get(route).await;
        assert_eq!(
            response.status, 200,
            "an admin must still read {route}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

/// A signed-in customer is still 403 on all three, and an anonymous caller
/// is still 401 — the report layer replaced `auth_middleware` on these
/// routes and must not have relaxed either verdict.
#[tokio::test]
async fn a_customer_is_forbidden_and_an_anonymous_caller_unauthorized() {
    let app = app_with_report_token().await;

    let customer = TestUser::new("report-customer@test.com");
    customer.insert(app.db()).await.expect("insert customer");
    let customer_client =
        app.authenticated_client_with_role(&customer.id, &customer.email, "customer");
    let anonymous = TestClient::new(app.router());

    for route in REPORT_ROUTES {
        let response = customer_client.get(route).await;
        assert_eq!(
            response.status, 403,
            "a customer must be forbidden on {route}, got {} with body {}",
            response.status, response.body
        );

        let response = anonymous.get(route).await;
        assert_eq!(
            response.status, 401,
            "an anonymous caller must be unauthorized on {route}, got {} with body {}",
            response.status, response.body
        );
    }

    app.cleanup().await.ok();
}

// ============================================================================
// 4. Every use leaves a row
// ============================================================================

/// One `user_audit_log` row per report-token read, naming the route.
///
/// `user_id` is NULL because there is no user: the credential mints a
/// synthetic principal with no row behind it, and inventing one to satisfy
/// a column would be the fiction the design exists to avoid.
#[tokio::test]
async fn every_report_token_read_is_audited() {
    let app = app_with_report_token().await;
    let client = bearer_client(&app, TEST_REPORT_READ_TOKEN);

    for route in REPORT_ROUTES {
        client.get(route).await.assert_status(200);
    }

    let rows: Vec<(Option<uuid::Uuid>, String)> = sqlx::query_as(
        r#"
        SELECT user_id, details->>'route' AS route
        FROM user_audit_log
        WHERE action = 'report_token_read'
          AND details->>'actor' = 'report_token'
        ORDER BY details->>'route'
        "#,
    )
    .fetch_all(app.db())
    .await
    .expect("read the audit log");

    let mut expected: Vec<&str> = REPORT_ROUTES.to_vec();
    expected.sort_unstable();
    let recorded: Vec<&str> = rows.iter().map(|(_, route)| route.as_str()).collect();
    assert_eq!(
        recorded, expected,
        "each report-token read must be recorded once, naming its route"
    );
    assert!(
        rows.iter().all(|(user_id, _)| user_id.is_none()),
        "a report-token row belongs to no user — user_id must be NULL"
    );

    app.cleanup().await.ok();
}

/// An admin JWT reading the same routes writes no `report_token` row. The
/// audit trail answers "what did the machine read", so an admin's ordinary
/// dashboard traffic must not appear in it.
#[tokio::test]
async fn an_admin_read_is_not_recorded_as_a_report_token_read() {
    let app = app_with_report_token().await;
    let client = admin_client(&app, "report-admin-audit@test.com").await;

    for route in REPORT_ROUTES {
        client.get(route).await.assert_status(200);
    }

    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_audit_log WHERE action = 'report_token_read'"#,
    )
    .fetch_one(app.db())
    .await
    .expect("count audit rows");

    assert_eq!(
        count, 0,
        "an admin JWT read must not be filed as a report-token read"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 5. The guessing budget
// ============================================================================

/// The per-IP budget is charged BEFORE the token comparison, so guessing
/// runs out of budget rather than running for ever.
///
/// Charged on wrong tokens on purpose: charging only on a match would
/// leave the one path worth bounding unbounded. The budget is 60 per
/// minute; the 61st request from the same address is refused with 429
/// whether or not it carries the right token.
///
/// `X-Forwarded-For` gives this test its own bucket: the test harness has
/// no `ConnectInfo`, so every other test in this file resolves to
/// loopback, and loopback is a trusted hop in the default proxy list — so
/// a forwarded address is believed and lands in a bucket of its own.
#[tokio::test]
async fn guessing_the_report_token_exhausts_a_per_ip_budget() {
    let app = app_with_report_token().await;
    let client =
        bearer_client(&app, "not-the-report-token").with_header("X-Forwarded-For", "203.0.113.7");

    for attempt in 1..=60 {
        let response = client.get("/api/admin/stats").await;
        assert_eq!(
            response.status, 401,
            "attempt {attempt} should be refused as a bad credential, not {}",
            response.status
        );
    }

    let response = client.get("/api/admin/stats").await;
    assert_eq!(
        response.status, 429,
        "the 61st guess in a minute must be over budget, got {} with body {}",
        response.status, response.body
    );
    assert!(
        response.headers.contains_key("retry-after"),
        "a 429 must say when to come back"
    );

    app.cleanup().await.ok();
}
