//! The SlipOK system actor's security properties, asserted in CI.
//!
//! Migration `20260911000000_slipok_system_user.sql` seeds one fixed,
//! non-loginable `users` row that every automatic slip verification is
//! attributed to (`services::slip_confirm::SLIPOK_SYSTEM_USER_ID`). The row
//! carries `role = 'admin'`, so "it can never log in" is a property that has
//! to keep holding, not a claim checked once by hand against a scratch
//! database.
//!
//! What could quietly take the protection away with every other check still
//! green: a later migration that recreates or relaxes the `users`
//! constraints, an `ON CONFLICT` clause edited to `DO NOTHING`, or an admin
//! user-management endpoint that rewrites this row like any other. These
//! cases fail loudly in that event.
//!
//! The `UPDATE`s below are deliberate tamper attempts against the constraint
//! — they are the assertion, not a way of setting up fixture state.

use serde_json::json;
use sqlx::{Executor, PgPool};
use uuid::Uuid;

use loyalty_backend::services::slip_confirm::SLIPOK_SYSTEM_USER_ID;

use crate::common::TestApp;

/// The locked email. Under `.invalid` (RFC 2606), so no identity provider
/// can ever assert it.
const SLIPOK_EMAIL: &str = "slipok@system.hf.invalid";

/// The name of the constraint that pins the actor non-loginable.
const CONSTRAINT: &str = "users_slipok_system_actor_not_loginable";

/// Run a statement expected to be refused by a CHECK constraint and return
/// its SQLSTATE.
async fn sqlstate_of(pool: &PgPool, sql: &str) -> String {
    let err = sqlx::query(sql)
        .bind(SLIPOK_SYSTEM_USER_ID)
        .execute(pool)
        .await
        .expect_err(&format!("statement should have been refused: {sql}"));

    match err {
        sqlx::Error::Database(db) => db.code().map(|c| c.into_owned()).unwrap_or_default(),
        other => panic!("expected a database error, got {other:?}"),
    }
}

/// Every column that makes the actor loginable is refused at the database,
/// whoever is holding the connection.
///
/// `23514` is `check_violation`. Asserting the SQLSTATE rather than just
/// "an error happened" is what tells a constraint refusal apart from a typo
/// in the statement.
#[tokio::test]
async fn the_system_actor_cannot_be_made_loginable() {
    let app = TestApp::new().await.expect("create test app");

    assert_eq!(
        sqlstate_of(app.db(), "UPDATE users SET is_active = true WHERE id = $1").await,
        "23514",
        "the actor must never be activated"
    );
    assert_eq!(
        sqlstate_of(
            app.db(),
            "UPDATE users SET password_hash = 'x' WHERE id = $1"
        )
        .await,
        "23514",
        "the actor must never be given a password"
    );
    assert_eq!(
        sqlstate_of(
            app.db(),
            "UPDATE users SET oauth_provider = 'google', oauth_provider_id = 'sub-123' \
             WHERE id = $1"
        )
        .await,
        "23514",
        "the actor must never be linked to an identity provider"
    );
    // The one guard that actually stands on the OAuth path: that path never
    // checks `is_active`, so an admin who could move this row to a domain
    // they control could sign in with Google as a row that reads as a system
    // component. The email is in the constraint for exactly that reason.
    assert_eq!(
        sqlstate_of(
            app.db(),
            "UPDATE users SET email = 'attacker@example.com' WHERE id = $1"
        )
        .await,
        "23514",
        "the actor's email must never be moved to a reachable domain"
    );
    assert_eq!(
        sqlstate_of(app.db(), "UPDATE users SET email = NULL WHERE id = $1").await,
        "23514",
        "a CHECK passes when its expression is NULL, so the email guard has \
         to be NULL-safe"
    );

    // And nothing above left a mark.
    let (email, is_active, has_password): (Option<String>, Option<bool>, bool) = sqlx::query_as(
        "SELECT email, is_active, password_hash IS NOT NULL FROM users WHERE id = $1",
    )
    .bind(SLIPOK_SYSTEM_USER_ID)
    .fetch_one(app.db())
    .await
    .expect("the seeded actor exists");

    assert_eq!(email.as_deref(), Some(SLIPOK_EMAIL));
    assert_eq!(is_active, Some(false));
    assert!(!has_password);

    app.cleanup().await.ok();
}

/// The password login path refuses the actor, which is the guard the
/// constraint above exists to keep true.
#[tokio::test]
async fn the_system_actor_cannot_log_in() {
    let app = TestApp::new().await.expect("create test app");

    let response = app
        .client()
        .post(
            "/api/auth/login",
            &json!({ "email": SLIPOK_EMAIL, "password": "TestPassword123!" }),
        )
        .await;

    // 403, not 401: `routes::auth::login` rejects on `is_active` before it
    // ever looks at the password.
    response.assert_status(403);

    app.cleanup().await.ok();
}

/// Re-applying the seed converges a tampered row instead of erroring, which
/// is what an idempotent seed of a security-relevant row has to do.
///
/// The constraint is dropped first because it is doing its job — there is no
/// other way to produce the tampered row this case is about.
#[tokio::test]
async fn the_seed_migration_converges_a_tampered_actor() {
    let app = TestApp::new().await.expect("create test app");

    app.db()
        .execute(format!("ALTER TABLE users DROP CONSTRAINT {CONSTRAINT}").as_str())
        .await
        .expect("drop the constraint for the tamper");

    sqlx::query(
        "UPDATE users \
         SET is_active = true, password_hash = 'x', email = 'tampered@example.com', \
             oauth_provider = 'google', oauth_provider_id = 'sub-123' \
         WHERE id = $1",
    )
    .bind(SLIPOK_SYSTEM_USER_ID)
    .execute(app.db())
    .await
    .expect("tamper with the actor");

    sqlx::query(
        "UPDATE user_profiles SET first_name = 'Nope', last_name = 'Nope' WHERE user_id = $1",
    )
    .bind(SLIPOK_SYSTEM_USER_ID)
    .execute(app.db())
    .await
    .expect("tamper with the actor's profile");

    // The migration body itself, byte for byte.
    app.db()
        .execute(include_str!(
            "../../migrations/20260911000000_slipok_system_user.sql"
        ))
        .await
        .expect("the seed re-applies cleanly");

    let (email, is_active, has_password, provider): (
        Option<String>,
        Option<bool>,
        bool,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT email, is_active, password_hash IS NOT NULL, oauth_provider \
         FROM users WHERE id = $1",
    )
    .bind(SLIPOK_SYSTEM_USER_ID)
    .fetch_one(app.db())
    .await
    .expect("the actor still exists");

    assert_eq!(email.as_deref(), Some(SLIPOK_EMAIL));
    assert_eq!(is_active, Some(false));
    assert!(!has_password, "the seed must clear a hand-set password");
    assert_eq!(provider, None);

    // The display name is what the desk reads against every automatic
    // verify, so it converges too.
    let (first_name, last_name): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT first_name, last_name FROM user_profiles WHERE user_id = $1")
            .bind(SLIPOK_SYSTEM_USER_ID)
            .fetch_one(app.db())
            .await
            .expect("the actor's profile still exists");
    assert_eq!(first_name.as_deref(), Some("SlipOK"));
    assert_eq!(last_name.as_deref(), Some(""));

    // ...and the constraint the tamper had to remove is back.
    assert_eq!(
        sqlstate_of(app.db(), "UPDATE users SET is_active = true WHERE id = $1").await,
        "23514",
        "re-applying the migration must restore the constraint"
    );

    app.cleanup().await.ok();
}

/// The id in the migration and the id compiled into the backend are the same
/// value. A drift here attributes every automatic verify to a row that does
/// not exist, and the FK on `booking_audit_log.admin_id` then fails the whole
/// confirmation.
#[tokio::test]
async fn the_seeded_row_is_the_id_the_backend_uses() {
    let app = TestApp::new().await.expect("create test app");

    let id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(SLIPOK_EMAIL)
        .fetch_one(app.db())
        .await
        .expect("the migration seeded exactly one actor row");

    assert_eq!(id, SLIPOK_SYSTEM_USER_ID);

    app.cleanup().await.ok();
}
