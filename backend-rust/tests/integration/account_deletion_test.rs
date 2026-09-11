//! PDPA account erasure (F3, `docs/privacy/2026-09-pdpa-data-map.md` §8 gap P1-3).
//!
//! The defect these tests pin down: `DELETE /api/users/account` used to run
//! `UPDATE users SET is_active = false` and nothing else, so a "deleted"
//! member kept a resolvable `oauth_provider_id`, kept their
//! `line_friendships` rows, stayed reachable by LINE push, and was
//! resurrected by the next login with the same provider id.
//!
//! Each test below is one sentence from that list, turned into an assertion.

use serde_json::Value;
use uuid::Uuid;

use crate::common::{test_app_state_config, TestApp, TestUser};

/// The `users` columns the erase is supposed to destroy, plus the tombstone.
#[derive(sqlx::FromRow)]
struct ErasedUserRow {
    email: Option<String>,
    oauth_provider: Option<String>,
    oauth_provider_id: Option<String>,
    is_active: Option<bool>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// The `user_profiles` columns the erase is supposed to destroy, plus the
/// one it must keep.
#[derive(sqlx::FromRow)]
struct ErasedProfileRow {
    first_name: Option<String>,
    last_name: Option<String>,
    phone: Option<String>,
    date_of_birth: Option<chrono::NaiveDate>,
    avatar_url: Option<String>,
    membership_id: String,
}

// ============================================================================
// Fixtures
// ============================================================================

/// A LINE member: `users` row with a LINE identity, a profile carrying
/// every field the erase is supposed to destroy, and a friendship row for
/// each property OA.
async fn create_line_member(
    pool: &sqlx::PgPool,
    email: &str,
    line_user_id: &str,
) -> Result<TestUser, sqlx::Error> {
    let user = TestUser::new(email);
    user.insert_with_profile(pool, "Somchai", "Jaidee").await?;

    sqlx::query("UPDATE users SET oauth_provider = 'line', oauth_provider_id = $2 WHERE id = $1")
        .bind(user.id)
        .bind(line_user_id)
        .execute(pool)
        .await?;

    sqlx::query(
        "UPDATE user_profiles SET phone = '0812345678', date_of_birth = DATE '1990-04-01', \
         avatar_url = '/storage/avatars/x.jpg' WHERE user_id = $1",
    )
    .bind(user.id)
    .execute(pool)
    .await?;

    for property in ["hf", "hfville"] {
        sqlx::query(
            "INSERT INTO line_friendships (line_user_id, property, is_friend) \
             VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING",
        )
        .bind(line_user_id)
        .bind(property)
        .execute(pool)
        .await?;
    }

    Ok(user)
}

/// Build an `AppState` over the test app's pool — `upsert_line_user` takes
/// state rather than a bare pool, and `TestApp` keeps its own private.
fn state_for(app: &TestApp) -> loyalty_backend::AppState {
    loyalty_backend::AppState::new(app.db().clone(), app.redis(), test_app_state_config())
}

async fn insert_booking(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Uuid, sqlx::Error> {
    let room_type_id: Uuid = sqlx::query_scalar(
        "INSERT INTO room_types (id, name, price_per_night, max_guests, is_active) \
         VALUES ($1, 'Deluxe', 2000.00, 2, true) RETURNING id",
    )
    .bind(Uuid::new_v4())
    .fetch_one(pool)
    .await?;

    let room_id: Uuid = sqlx::query_scalar(
        "INSERT INTO rooms (id, room_type_id, room_number, floor, is_active) \
         VALUES ($1, $2, '742', 7, true) RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .fetch_one(pool)
    .await?;

    let booking_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bookings (id, user_id, room_id, room_type_id, check_in_date, \
         check_out_date, num_guests, total_price, status) \
         VALUES ($1, $2, $3, $4, DATE '2026-10-01', DATE '2026-10-03', 2, 4000.00, 'completed')",
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_id)
    .execute(pool)
    .await?;

    Ok(booking_id)
}

// ============================================================================
// 1. A push to an erased member is a no-op, and says why
// ============================================================================

/// The headline defect. Before the erase the member is a live push target
/// (they get as far as `NoChannel` — no channel token is configured in the
/// test settings, which is the *last* step of the routing). After it they
/// are `NoPushTarget`: `push_targets` no longer contains them at all.
#[tokio::test]
async fn push_to_an_erased_member_is_a_no_op_with_a_reason() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = create_line_member(app.db(), "push-target@example.com", "Uline000000000001")
        .await
        .expect("Failed to create LINE member");

    let settings = test_app_state_config();

    // Before: routing gets past identity and friendship and only stops at
    // the channel token, proving both earlier stages resolved.
    let before = loyalty_backend::services::line::push_to_member(
        app.db(),
        &settings,
        user.id,
        None,
        "สวัสดีค่ะ",
    )
    .await
    .expect("push routing should not error");
    assert_eq!(
        before.reason(),
        "no_channel",
        "before erasure the member must still resolve as a push target"
    );

    loyalty_backend::services::account_deletion::erase_account(
        app.db(),
        user.id,
        loyalty_backend::services::account_deletion::DeletionActor::SelfService,
    )
    .await
    .expect("erase failed")
    .expect("user should exist");

    let after = loyalty_backend::services::line::push_to_member(
        app.db(),
        &settings,
        user.id,
        None,
        "สวัสดีค่ะ",
    )
    .await
    .expect("push routing should not error");

    assert!(!after.delivered(), "an erased member must not be pushed to");
    assert_eq!(
        after.reason(),
        "no_push_target",
        "the no-op must name the reason, so an erasure is distinguishable \
         from a LINE misconfiguration in the logs"
    );

    app.cleanup().await.ok();
}

/// The second, independent severing: the friendship rows are keyed on the
/// LINE userId, so leaving them behind would both keep the identifier and
/// keep the member friended from our side.
#[tokio::test]
async fn erasure_removes_the_line_friendship_rows() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let line_id = "Uline000000000002";
    let user = create_line_member(app.db(), "friendships@example.com", line_id)
        .await
        .expect("Failed to create LINE member");

    let before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM line_friendships WHERE line_user_id = $1")
            .bind(line_id)
            .fetch_one(app.db())
            .await
            .expect("count failed");
    assert_eq!(before, 2, "fixture should have friended both OAs");

    let outcome = loyalty_backend::services::account_deletion::erase_account(
        app.db(),
        user.id,
        loyalty_backend::services::account_deletion::DeletionActor::SelfService,
    )
    .await
    .expect("erase failed")
    .expect("user should exist");

    assert_eq!(outcome.line_friendships_severed, 2);

    let after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM line_friendships WHERE line_user_id = $1")
            .bind(line_id)
            .fetch_one(app.db())
            .await
            .expect("count failed");
    assert_eq!(after, 0, "no push-target row may survive the erasure");

    app.cleanup().await.ok();
}

/// The broadcast is the one fan-out dispatch in the codebase. It must skip
/// an erased member **even when the admin explicitly asks for inactive
/// users too** — which is exactly what routing it through `push_targets`
/// buys, and what an `active_only` flag alone never could.
#[tokio::test]
async fn admin_broadcast_cannot_reach_an_erased_member() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let erased = create_line_member(
        app.db(),
        "broadcast-erased@example.com",
        "Uline000000000003",
    )
    .await
    .expect("Failed to create LINE member");
    let kept = create_line_member(app.db(), "broadcast-kept@example.com", "Uline000000000004")
        .await
        .expect("Failed to create LINE member");

    loyalty_backend::services::account_deletion::erase_account(
        app.db(),
        erased.id,
        loyalty_backend::services::account_deletion::DeletionActor::SelfService,
    )
    .await
    .expect("erase failed")
    .expect("user should exist");

    let admin = TestUser::admin("broadcast-admin@example.com");
    admin
        .insert_with_profile(app.db(), "Ad", "Min")
        .await
        .expect("Failed to insert admin");
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let response = client
        .post(
            "/api/admin/notifications/broadcast",
            &serde_json::json!({
                "title": "Hello",
                "message": "Program news",
                "type": "info",
                // Deliberately the widest possible audience.
                "activeOnly": false,
            }),
        )
        .await;
    response.assert_status(200);

    let erased_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id = $1")
            .bind(erased.id)
            .fetch_one(app.db())
            .await
            .expect("count failed");
    assert_eq!(
        erased_rows, 0,
        "an erased member must not receive a broadcast even with activeOnly=false"
    );

    let kept_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id = $1")
            .bind(kept.id)
            .fetch_one(app.db())
            .await
            .expect("count failed");
    assert_eq!(kept_rows, 1, "live members must still receive it");

    app.cleanup().await.ok();
}

// ============================================================================
// 2. A later login with the same provider id is a NEW account
// ============================================================================

/// The resurrection bug. The trade-off this locks in is deliberate and
/// documented: the new account starts empty, and the old points cannot be
/// reclaimed, because the only link back to them was the provider id the
/// erase destroyed.
#[tokio::test]
async fn a_later_line_login_with_the_same_provider_id_creates_a_new_account() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let line_id = "Uline000000000005";
    let user = create_line_member(app.db(), "resurrect@example.com", line_id)
        .await
        .expect("Failed to create LINE member");

    loyalty_backend::services::account_deletion::erase_account(
        app.db(),
        user.id,
        loyalty_backend::services::account_deletion::DeletionActor::SelfService,
    )
    .await
    .expect("erase failed")
    .expect("user should exist");

    let state = state_for(&app);
    let profile = loyalty_backend::routes::oauth::LineProfile {
        user_id: line_id.to_string(),
        display_name: "Somchai Jaidee".to_string(),
        picture_url: None,
        status_message: None,
    };

    let (new_user, is_new) = loyalty_backend::routes::oauth::upsert_line_user(&state, &profile)
        .await
        .expect("LINE upsert failed");

    assert!(
        is_new,
        "the login must provision a new account, not reuse one"
    );
    assert_ne!(
        new_user.id,
        user.id.to_string(),
        "an erased account must never be resurrected by a login with the same LINE userId"
    );

    // And the erased row is still erased — the login did not write back to it.
    let (deleted_at, provider_id): (Option<chrono::DateTime<chrono::Utc>>, Option<String>) =
        sqlx::query_as("SELECT deleted_at, oauth_provider_id FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_one(app.db())
            .await
            .expect("select failed");
    assert!(deleted_at.is_some());
    assert!(provider_id.is_none());

    app.cleanup().await.ok();
}

// ============================================================================
// 3. The financial and audit trail survives
// ============================================================================

/// Data map §6: bookings are accounting records with a 5-year window. They
/// stay listable by admins under the *old* user id — the row is anonymised,
/// not removed, which is what keeps the id a valid foreign key.
#[tokio::test]
async fn bookings_still_list_for_admins_under_the_old_user_id() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = create_line_member(app.db(), "booker@example.com", "Uline000000000006")
        .await
        .expect("Failed to create LINE member");
    let booking_id = insert_booking(app.db(), user.id)
        .await
        .expect("Failed to insert booking");

    loyalty_backend::services::account_deletion::erase_account(
        app.db(),
        user.id,
        loyalty_backend::services::account_deletion::DeletionActor::SelfService,
    )
    .await
    .expect("erase failed")
    .expect("user should exist");

    let admin = TestUser::admin("bookings-admin@example.com");
    admin
        .insert_with_profile(app.db(), "Ad", "Min")
        .await
        .expect("Failed to insert admin");
    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let response = client.get("/api/admin/bookings?limit=50").await;
    response.assert_status(200);
    let body: Value = response.json().expect("response body should be JSON");

    let bookings = body["bookings"]
        .as_array()
        .expect("bookings array missing from the admin list");
    let found = bookings
        .iter()
        .find(|b| b["id"].as_str() == Some(&booking_id.to_string()))
        .expect("the erased member's booking must still appear in the admin list");

    assert_eq!(
        found["userId"].as_str(),
        Some(user.id.to_string().as_str()),
        "the booking must stay attributable to the original user id"
    );

    app.cleanup().await.ok();
}

/// Every identifier gone, the id and the tombstone kept, and one audit row
/// that carries no personal data.
#[tokio::test]
async fn erasure_anonymises_every_identifier_and_writes_a_pii_free_audit_row() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = create_line_member(app.db(), "anonymise@example.com", "Uline000000000007")
        .await
        .expect("Failed to create LINE member");

    // A session and an audit row with an IP, so we can prove both are dealt with.
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token, expires_at) \
         VALUES ($1, $2, NOW() + INTERVAL '7 days')",
    )
    .bind(user.id)
    .bind(format!("tok-{}", Uuid::new_v4()))
    .execute(app.db())
    .await
    .expect("Failed to insert refresh token");

    sqlx::query(
        "INSERT INTO user_audit_log (user_id, action, ip_address, user_agent) \
         VALUES ($1, 'login', '203.0.113.7'::inet, 'Mozilla/5.0')",
    )
    .bind(user.id)
    .execute(app.db())
    .await
    .expect("Failed to insert audit row");

    let outcome = loyalty_backend::services::account_deletion::erase_account(
        app.db(),
        user.id,
        loyalty_backend::services::account_deletion::DeletionActor::SelfService,
    )
    .await
    .expect("erase failed")
    .expect("user should exist");

    assert!(!outcome.already_erased);
    assert_eq!(outcome.refresh_tokens_revoked, 1);
    assert_eq!(outcome.audit_rows_depersonalised, 1);

    let row: ErasedUserRow = sqlx::query_as(
        "SELECT email, oauth_provider, oauth_provider_id, is_active, deleted_at \
         FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_one(app.db())
    .await
    .expect("select failed");

    assert!(row.email.is_none(), "email must be nulled");
    assert!(
        row.oauth_provider.is_none(),
        "oauth provider must be nulled"
    );
    assert!(
        row.oauth_provider_id.is_none(),
        "oauth provider id must be nulled"
    );
    assert_eq!(row.is_active, Some(false));
    assert!(row.deleted_at.is_some(), "the tombstone must be set");

    let profile: ErasedProfileRow = sqlx::query_as(
        "SELECT first_name, last_name, phone, date_of_birth, avatar_url, membership_id \
         FROM user_profiles WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_one(app.db())
    .await
    .expect("select failed");

    assert!(
        profile.first_name.is_none() && profile.last_name.is_none(),
        "name must be nulled"
    );
    assert!(profile.phone.is_none(), "phone must be nulled");
    assert!(
        profile.date_of_birth.is_none(),
        "date of birth must be nulled"
    );
    assert!(profile.avatar_url.is_none(), "avatar must be nulled");
    assert!(
        !profile.membership_id.is_empty(),
        "membership_id is a pseudonymous program key and must survive"
    );

    let (ip, ua): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT host(ip_address), user_agent FROM user_audit_log \
         WHERE user_id = $1 AND action = 'login'",
    )
    .bind(user.id)
    .fetch_one(app.db())
    .await
    .expect("select failed");
    assert!(
        ip.is_none() && ua.is_none(),
        "the audit row must survive but hold no personal data"
    );

    let sessions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
            .bind(user.id)
            .fetch_one(app.db())
            .await
            .expect("count failed");
    assert_eq!(sessions, 0, "live sessions must be revoked");

    // The audit row: a user id, a provider name, counts. Nothing else.
    let (actor, requested_by, recorded_provider, fields): (
        String,
        Option<Uuid>,
        Option<String>,
        Vec<String>,
    ) = sqlx::query_as(
        "SELECT actor, requested_by, oauth_provider, anonymised_fields \
         FROM user_deletions WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_one(app.db())
    .await
    .expect("user_deletions row missing");

    assert_eq!(actor, "self");
    assert!(
        requested_by.is_none(),
        "a self-service erase has no requester"
    );
    assert_eq!(recorded_provider.as_deref(), Some("line"));
    assert!(fields.iter().any(|f| f == "users.oauth_provider_id"));
    for field in &fields {
        assert!(
            field.contains('.') && !field.contains('@'),
            "anonymised_fields must hold column names, never values: {field}"
        );
    }

    app.cleanup().await.ok();
}

// ============================================================================
// 4. The endpoint itself
// ============================================================================

/// The JWT outlives the account (`auth_middleware` does not re-read
/// `users`), so a retried delete reaches the handler with the account
/// already gone. That is a 200, and it must not write a second audit row.
#[tokio::test]
async fn delete_account_endpoint_is_idempotent() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = create_line_member(app.db(), "idempotent@example.com", "Uline000000000008")
        .await
        .expect("Failed to create LINE member");

    let client = app.authenticated_client(&user.id, &user.email);

    let first = client.delete("/api/users/account").await;
    first.assert_status(200);

    let second = client.delete("/api/users/account").await;
    second.assert_status(200);
    let body: Value = second.json().expect("response body should be JSON");
    assert_eq!(body["success"], serde_json::json!(true));

    let audit_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_deletions WHERE user_id = $1")
            .bind(user.id)
            .fetch_one(app.db())
            .await
            .expect("count failed");
    assert_eq!(
        audit_rows, 1,
        "a repeat delete must be a no-op, not a second recorded erasure"
    );

    app.cleanup().await.ok();
}

/// The endpoint is the real entry point for all of the above — this pins
/// the wiring, so the service tests above can't pass while the route still
/// runs the old `is_active = false`.
#[tokio::test]
async fn delete_account_endpoint_severs_the_line_identity() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let line_id = "Uline000000000009";
    let user = create_line_member(app.db(), "endpoint@example.com", line_id)
        .await
        .expect("Failed to create LINE member");

    let client = app.authenticated_client(&user.id, &user.email);
    client.delete("/api/users/account").await.assert_status(200);

    let resolvable: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM push_targets WHERE oauth_provider = 'line' AND oauth_provider_id = $1",
    )
    .bind(line_id)
    .fetch_one(app.db())
    .await
    .expect("count failed");
    assert_eq!(
        resolvable, 0,
        "the LINE id must no longer resolve to a push target"
    );

    let loginable: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM login_identities WHERE oauth_provider = 'line' AND oauth_provider_id = $1",
    )
    .bind(line_id)
    .fetch_one(app.db())
    .await
    .expect("count failed");
    assert_eq!(
        loginable, 0,
        "the LINE id must no longer resolve to a login identity"
    );

    app.cleanup().await.ok();
}

/// A user id with no row at all is still a 404 — idempotency covers "already
/// erased", not "never existed".
#[tokio::test]
async fn delete_account_returns_404_for_an_unknown_user() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let ghost = Uuid::new_v4();
    let client = app.authenticated_client(&ghost, "ghost@example.com");

    client.delete("/api/users/account").await.assert_status(404);

    app.cleanup().await.ok();
}
