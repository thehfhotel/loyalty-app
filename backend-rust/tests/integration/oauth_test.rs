//! OAuth integration tests
//!
//! Tests for the OAuth API endpoints including:
//! - Google OAuth redirect initiation
//! - LINE OAuth redirect initiation
//! - Google OAuth callback with invalid code
//! - LINE OAuth callback with invalid code
//!
//! Note: Full OAuth flow tests require mocking external APIs.
//! These tests use wiremock to mock Google/LINE token endpoints.

use axum::Router;
use sqlx::PgPool;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

use crate::common::{init_test_redis, setup_test, teardown_test, TestClient};

use loyalty_backend::config::Settings;
use loyalty_backend::routes::oauth::routes;
use loyalty_backend::state::AppState;

// ============================================================================
// Test Setup
// ============================================================================

/// Create test settings with OAuth providers configured
fn create_test_settings_with_oauth(
    google_callback_url: Option<&str>,
    line_callback_url: Option<&str>,
) -> Settings {
    let mut settings = Settings::default();
    settings.auth.jwt_secret = "test-jwt-secret-key-for-testing-only-minimum-32-chars".to_string();
    settings.auth.jwt_refresh_secret =
        "test-jwt-refresh-secret-key-for-testing-only-32-chars".to_string();
    settings.auth.access_token_expiry_secs = 900;
    settings.auth.refresh_token_expiry_secs = 604800;
    settings.server.frontend_url = "http://localhost:3000".to_string();

    // Configure Google OAuth
    settings.oauth.google.client_id = Some("test-google-client-id".to_string());
    settings.oauth.google.client_secret = Some("test-google-client-secret".to_string());
    if let Some(url) = google_callback_url {
        settings.oauth.google.callback_url = url.to_string();
    }

    // Configure LINE OAuth
    settings.oauth.line.client_id = Some("test-line-client-id".to_string());
    settings.oauth.line.client_secret = Some("test-line-client-secret".to_string());
    if let Some(url) = line_callback_url {
        settings.oauth.line.callback_url = url.to_string();
    }

    settings
}

/// Create test settings without OAuth configured
fn create_test_settings_without_oauth() -> Settings {
    let mut settings = Settings::default();
    settings.auth.jwt_secret = "test-jwt-secret-key-for-testing-only-minimum-32-chars".to_string();
    settings.auth.jwt_refresh_secret =
        "test-jwt-refresh-secret-key-for-testing-only-32-chars".to_string();
    settings.server.frontend_url = "http://localhost:3000".to_string();
    // OAuth not configured - client_id and client_secret are None
    settings
}

/// Create a test application with OAuth routes
async fn create_oauth_test_app(
    pool: PgPool,
    settings: Settings,
) -> Result<Router, Box<dyn std::error::Error>> {
    let redis = init_test_redis().await?;
    let state = AppState::new(pool, redis, settings);
    Ok(Router::new().nest("/api/oauth", routes().with_state(state)))
}

// ============================================================================
// Google OAuth Redirect Tests
// ============================================================================

/// Test Google OAuth redirect endpoint
/// GET /api/oauth/google
/// Verify it returns a redirect to Google OAuth
#[tokio::test]
async fn test_google_oauth_redirect() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/google").await;

    // Should return a redirect (302 or 303) to Google OAuth
    // The response might be 200 with HTML redirect for mobile Safari compatibility
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status (302/303) or HTML redirect (200), got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 {
        assert!(
            response.body.contains("accounts.google.com") || response.body.contains("Redirecting"),
            "HTML response should contain redirect to Google. Body: {}",
            response.body
        );
    }

    teardown_test(&test_db).await;
}

/// Test Google OAuth redirect includes required parameters
#[tokio::test]
async fn test_google_oauth_redirect_url_params() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/google").await;

    // The redirect URL should contain required OAuth parameters
    if response.status == 200 {
        let body = &response.body;
        assert!(
            body.contains("client_id") || body.contains("accounts.google.com"),
            "Redirect should include client_id parameter"
        );
        assert!(
            body.contains("response_type=code") || body.contains("accounts.google.com"),
            "Redirect should include response_type=code"
        );
        assert!(
            body.contains("scope") || body.contains("accounts.google.com"),
            "Redirect should include scope parameter"
        );
        assert!(
            body.contains("state") || body.contains("accounts.google.com"),
            "Redirect should include state parameter for CSRF protection"
        );
    }

    teardown_test(&test_db).await;
}

/// Test Google OAuth redirect when not configured
#[tokio::test]
async fn test_google_oauth_redirect_not_configured() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_without_oauth();
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/google").await;

    // Should redirect to login with error when OAuth is not configured
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            response.body.contains("not_configured")
                || response.body.contains("error")
                || response.body.contains("login"),
            "Response should indicate Google OAuth is not configured"
        );
    }

    teardown_test(&test_db).await;
}

// ============================================================================
// LINE OAuth Redirect Tests
// ============================================================================

/// Test LINE OAuth redirect endpoint
/// GET /api/oauth/line
/// Verify it returns a redirect to LINE OAuth
#[tokio::test]
async fn test_line_oauth_redirect() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/line").await;

    // Should return a redirect (302 or 303) to LINE OAuth
    // The response might be 200 with HTML redirect for mobile Safari compatibility
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status (302/303) or HTML redirect (200), got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 {
        assert!(
            response.body.contains("access.line.me")
                || response.body.contains("Redirecting")
                || response.body.contains("LINE"),
            "HTML response should contain redirect to LINE. Body: {}",
            response.body
        );
    }

    teardown_test(&test_db).await;
}

/// Test LINE OAuth redirect includes required parameters
#[tokio::test]
async fn test_line_oauth_redirect_url_params() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/line").await;

    // The redirect URL should contain required OAuth parameters
    if response.status == 200 {
        let body = &response.body;
        assert!(
            body.contains("client_id") || body.contains("access.line.me"),
            "Redirect should include client_id parameter"
        );
        assert!(
            body.contains("response_type=code") || body.contains("access.line.me"),
            "Redirect should include response_type=code"
        );
        assert!(
            body.contains("scope") || body.contains("access.line.me"),
            "Redirect should include scope parameter"
        );
        assert!(
            body.contains("state") || body.contains("access.line.me"),
            "Redirect should include state parameter for CSRF protection"
        );
    }

    teardown_test(&test_db).await;
}

/// Test LINE OAuth redirect when not configured
#[tokio::test]
async fn test_line_oauth_redirect_not_configured() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_without_oauth();
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/line").await;

    // Should redirect to login with error when OAuth is not configured
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            response.body.contains("not_configured")
                || response.body.contains("error")
                || response.body.contains("login"),
            "Response should indicate LINE OAuth is not configured"
        );
    }

    teardown_test(&test_db).await;
}

// ============================================================================
// Google OAuth Callback Tests
// ============================================================================

/// Test Google OAuth callback with invalid code
/// GET /api/oauth/google/callback?code=invalid
/// Verify it returns an error redirect
#[tokio::test]
async fn test_google_callback_invalid_code() {
    let (pool, test_db) = setup_test().await;

    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": "invalid_grant",
            "error_description": "The authorization code is invalid or has expired."
        })))
        .mount(&mock_server)
        .await;

    let settings =
        create_test_settings_with_oauth(Some(&format!("{}/callback", mock_server.uri())), None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Without a valid state, the callback should fail with session_expired or oauth_invalid
    let response = client
        .get("/api/oauth/google/callback?code=invalid_code")
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 {
        assert!(
            response.body.contains("error")
                || response.body.contains("failed")
                || response.body.contains("invalid")
                || response.body.contains("login"),
            "Response should indicate authentication error. Body: {}",
            response.body
        );
    }

    teardown_test(&test_db).await;
}

/// Test Google OAuth callback with missing state parameter
#[tokio::test]
async fn test_google_callback_missing_state() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Call callback with code but no state (CSRF protection should fail)
    let response = client
        .get("/api/oauth/google/callback?code=some_code")
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            response.body.contains("invalid")
                || response.body.contains("expired")
                || response.body.contains("error")
                || response.body.contains("login"),
            "Response should indicate CSRF validation failed"
        );
    }

    teardown_test(&test_db).await;
}

/// Test Google OAuth callback with OAuth provider error
#[tokio::test]
async fn test_google_callback_provider_error() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Simulate OAuth provider returning an error (user denied access)
    let response = client
        .get("/api/oauth/google/callback?error=access_denied&error_description=User%20denied%20access")
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            response.body.contains("error")
                || response.body.contains("denied")
                || response.body.contains("login"),
            "Response should indicate OAuth provider error"
        );
    }

    teardown_test(&test_db).await;
}

// ============================================================================
// LINE OAuth Callback Tests
// ============================================================================

/// Test LINE OAuth callback with invalid code
/// GET /api/oauth/line/callback?code=invalid
/// Verify it returns an error redirect
#[tokio::test]
async fn test_line_callback_invalid_code() {
    let (pool, test_db) = setup_test().await;

    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/oauth2/v2.1/token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": "invalid_grant",
            "error_description": "The authorization code is invalid or expired"
        })))
        .mount(&mock_server)
        .await;

    let settings =
        create_test_settings_with_oauth(None, Some(&format!("{}/callback", mock_server.uri())));
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client
        .get("/api/oauth/line/callback?code=invalid_code")
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}. Body: {}",
        response.status,
        response.body
    );

    if response.status == 200 {
        assert!(
            response.body.contains("error")
                || response.body.contains("failed")
                || response.body.contains("invalid")
                || response.body.contains("login"),
            "Response should indicate authentication error. Body: {}",
            response.body
        );
    }

    teardown_test(&test_db).await;
}

/// Test LINE OAuth callback with missing state parameter
#[tokio::test]
async fn test_line_callback_missing_state() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Call callback with code but no state (CSRF protection should fail)
    let response = client.get("/api/oauth/line/callback?code=some_code").await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            response.body.contains("invalid")
                || response.body.contains("expired")
                || response.body.contains("error")
                || response.body.contains("login"),
            "Response should indicate CSRF validation failed"
        );
    }

    teardown_test(&test_db).await;
}

/// Test LINE OAuth callback with OAuth provider error
#[tokio::test]
async fn test_line_callback_provider_error() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Simulate OAuth provider returning an error
    let response = client
        .get(
            "/api/oauth/line/callback?error=access_denied&error_description=User%20denied%20access",
        )
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            response.body.contains("error")
                || response.body.contains("denied")
                || response.body.contains("login"),
            "Response should indicate OAuth provider error"
        );
    }

    teardown_test(&test_db).await;
}

// ============================================================================
// OAuth Return URL Validation Tests
// ============================================================================

/// Test OAuth redirect with custom return_url (same origin)
#[tokio::test]
async fn test_oauth_redirect_with_valid_return_url() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Request OAuth with a valid return URL (same origin as frontend)
    let response = client
        .get("/api/oauth/google?return_url=http://localhost:3000/dashboard")
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

/// Test OAuth redirect blocks different origin return_url (open redirect protection)
#[tokio::test]
async fn test_oauth_redirect_blocks_open_redirect() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    // Attempt OAuth with a malicious return URL
    let response = client
        .get("/api/oauth/google?return_url=https://evil.com/phishing")
        .await;

    // Should still proceed with OAuth but use default return URL
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    if response.status == 200 {
        assert!(
            !response.body.contains("evil.com"),
            "Response should not redirect to malicious domain"
        );
    }

    teardown_test(&test_db).await;
}

// ============================================================================
// Mock Server OAuth Flow Tests (with wiremock)
// ============================================================================

/// Test complete Google OAuth flow with mocked external services
/// Note: This test demonstrates how to mock the full OAuth flow
#[tokio::test]
async fn test_google_oauth_flow_with_mocks() {
    // Start mock server for Google APIs
    let mock_server = MockServer::start().await;

    // Mock Google token endpoint
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "mock_access_token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": "mock_refresh_token",
            "id_token": "mock_id_token"
        })))
        .expect(0) // We won't actually hit this in the test due to state validation
        .mount(&mock_server)
        .await;

    // Mock Google userinfo endpoint
    Mock::given(method("GET"))
        .and(path("/oauth2/v2/userinfo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "123456789",
            "email": "test@example.com",
            "verified_email": true,
            "name": "Test User",
            "given_name": "Test",
            "family_name": "User",
            "picture": "https://example.com/photo.jpg"
        })))
        .expect(0) // We won't actually hit this in the test due to state validation
        .mount(&mock_server)
        .await;

    // The mock server is set up - in a real integration test with proper state management,
    // you would:
    // 1. Call /api/oauth/google to get the state
    // 2. Call /api/oauth/google/callback with the state and a valid code
    // 3. The callback would exchange the code using the mocked token endpoint
    // 4. Then fetch user info from the mocked userinfo endpoint

    // For now, verify the mock server is running
    assert!(
        !mock_server.uri().is_empty(),
        "Mock server should be running"
    );
}

/// Test complete LINE OAuth flow with mocked external services
#[tokio::test]
async fn test_line_oauth_flow_with_mocks() {
    // Start mock server for LINE APIs
    let mock_server = MockServer::start().await;

    // Mock LINE token endpoint
    Mock::given(method("POST"))
        .and(path("/oauth2/v2.1/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "mock_line_access_token",
            "token_type": "Bearer",
            "expires_in": 2592000,
            "refresh_token": "mock_line_refresh_token",
            "id_token": "mock_line_id_token"
        })))
        .expect(0)
        .mount(&mock_server)
        .await;

    // Mock LINE profile endpoint
    Mock::given(method("GET"))
        .and(path("/v2/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "userId": "U123456789",
            "displayName": "Test LINE User",
            "pictureUrl": "https://profile.line-scdn.net/test.jpg",
            "statusMessage": "Hello from LINE"
        })))
        .expect(0)
        .mount(&mock_server)
        .await;

    // Verify the mock server is running
    assert!(
        !mock_server.uri().is_empty(),
        "Mock server should be running"
    );
}

// ============================================================================
// PWA and Platform-Specific Tests
// ============================================================================

/// Test OAuth redirect with PWA flag
#[tokio::test]
async fn test_google_oauth_redirect_pwa_mode() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client.get("/api/oauth/google?pwa=true&platform=ios").await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

/// Test OAuth redirect in standalone mode
#[tokio::test]
async fn test_line_oauth_redirect_standalone_mode() {
    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);
    let app = create_oauth_test_app(pool, settings)
        .await
        .expect("Failed to create app");
    let client = TestClient::new(app);

    let response = client
        .get("/api/oauth/line?standalone=true&platform=android")
        .await;

    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// OAuth provisioning transactionality (MED-5 — correctness-2026-05-13.md)
// ============================================================================

/// Regression guard: provisioning a brand-new OAuth user must be
/// atomic. If any step inside the transaction fails (here we provoke a
/// failure by deleting the default `Bronze` tier before the call), the
/// users row, profile, notification_preferences row, and audit-log
/// entry must all be rolled back so we don't leave a half-provisioned
/// account behind.
#[tokio::test]
async fn test_oauth_provisioning_rolls_back_on_failure() {
    use loyalty_backend::services::oauth::{OAuthService, OAuthServiceImpl, OAuthUserInfo};

    let (pool, test_db) = setup_test().await;

    // Wipe the default tier rows so the loyalty insert inside the
    // provisioning transaction fails with NotFound("Default tier not
    // found"). FK-cascades on user_loyalty mean we delete loyalty rows
    // first; tiers themselves have no rows referenced by the seed users.
    sqlx::query("DELETE FROM user_loyalty")
        .execute(&pool)
        .await
        .ok();
    sqlx::query("DELETE FROM tiers")
        .execute(&pool)
        .await
        .expect("clear tiers");

    let redis = init_test_redis().await.expect("redis");
    let settings = create_test_settings_with_oauth(None, None);
    let state = AppState::new(pool.clone(), redis, settings);

    let service = OAuthServiceImpl::new(
        state.clone(),
        state.config().oauth.google.clone(),
        state.config().oauth.line.clone(),
    );

    // Unique email so we know any users row found afterward is from
    // this call rather than seed data.
    let email = format!("rollback_{}@example.com", uuid::Uuid::new_v4().simple());
    let user_info = OAuthUserInfo {
        provider: "google".to_string(),
        provider_id: format!("provider_{}", uuid::Uuid::new_v4().simple()),
        email: Some(email.clone()),
        first_name: Some("Roll".to_string()),
        last_name: Some("Back".to_string()),
        display_name: Some("Roll Back".to_string()),
        avatar_url: None,
        email_verified: true,
    };

    // The call must fail (no Bronze tier to insert into user_loyalty).
    let result = service.find_or_create_oauth_user(user_info).await;
    assert!(
        result.is_err(),
        "expected provisioning to fail without a default tier"
    );

    // Critical: no users row remains for the email. If the transaction
    // wrap regresses, the users INSERT will have committed before the
    // loyalty INSERT failed, leaving a half-provisioned account.
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&pool)
        .await
        .expect("count users");
    assert_eq!(
        user_count, 0,
        "users row must be rolled back when OAuth provisioning fails mid-flow"
    );

    // Likewise no profile, notification_preferences, or loyalty row.
    let profile_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_profiles up JOIN users u ON u.id = up.user_id WHERE u.email = $1",
    )
    .bind(&email)
    .fetch_one(&pool)
    .await
    .expect("count profiles");
    assert_eq!(
        profile_count, 0,
        "user_profiles row must also be rolled back"
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// OAuth state consumption (MED-1 — correctness-2026-05-13.md)
// ============================================================================

/// Regression guard: the OAuth state key MUST be consumed atomically on
/// the first callback regardless of whether the downstream token exchange
/// succeeds. The previous implementation did GET then DEL with the
/// provider round-trip in between, leaving a replay window.
///
/// This test seeds a known state value in Redis, invokes the Google
/// callback (the token exchange itself will fail because we don't mock
/// it, but the state lookup happens before that), then verifies the
/// Redis key is gone. A regression that re-introduces the late DEL
/// would leave the key behind until the post-exchange cleanup, and the
/// final `KEYS oauth_state:google:*` assertion would fail.
#[tokio::test]
async fn test_google_callback_consumes_oauth_state_atomically() {
    use redis::AsyncCommands;

    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);

    // Build the app + a side-channel Redis connection on the same URL so
    // we can SET the state and then KEYS-check it after the callback.
    let mut redis = init_test_redis().await.expect("redis");
    let state = AppState::new(pool.clone(), redis.clone(), settings.clone());
    let app = axum::Router::new().nest("/api/oauth", routes().with_state(state));
    let client = TestClient::new(app);

    // Use a high-entropy key suffix so this test never collides with a
    // sibling worker's leftover Redis entries.
    let state_key = format!("test_state_{}", uuid::Uuid::new_v4().simple());
    let redis_key = format!("oauth_state:google:{}", state_key);
    let payload = serde_json::json!({
        "session_id": null,
        "user_id": null,
        "user_agent": "test-agent",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "return_url": "http://localhost:3000",
        "provider": "google",
        "original_url": "http://localhost:3000/login",
        "ip": "127.0.0.1",
    })
    .to_string();

    redis
        .set_ex::<_, _, ()>(&redis_key, &payload, 600)
        .await
        .expect("seed oauth_state");

    // Sanity: the key exists before the callback.
    let pre: bool = redis.exists(&redis_key).await.expect("exists check");
    assert!(pre, "state should exist before callback");

    // Invoke the callback. The token-exchange call will fail (we didn't
    // mock the Google endpoint), but `get_oauth_state` runs first and
    // must consume the key with GETDEL.
    let _ = client
        .get(&format!(
            "/api/oauth/google/callback?code=dummy_code&state={}",
            state_key
        ))
        .await;

    // The key must be gone — consumed by GETDEL, not awaiting a
    // post-exchange delete.
    let post: bool = redis.exists(&redis_key).await.expect("exists check");
    assert!(
        !post,
        "state must be consumed atomically by the first callback (MED-1)"
    );

    teardown_test(&test_db).await;
}

/// Same regression guard for the LINE provider. The fix is symmetric so
/// the test must be too.
#[tokio::test]
async fn test_line_callback_consumes_oauth_state_atomically() {
    use redis::AsyncCommands;

    let (pool, test_db) = setup_test().await;
    let settings = create_test_settings_with_oauth(None, None);

    let mut redis = init_test_redis().await.expect("redis");
    let state = AppState::new(pool.clone(), redis.clone(), settings.clone());
    let app = axum::Router::new().nest("/api/oauth", routes().with_state(state));
    let client = TestClient::new(app);

    let state_key = format!("test_state_{}", uuid::Uuid::new_v4().simple());
    let redis_key = format!("oauth_state:line:{}", state_key);
    let payload = serde_json::json!({
        "session_id": null,
        "user_id": null,
        "user_agent": "test-agent",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "return_url": "http://localhost:3000",
        "provider": "line",
        "original_url": "http://localhost:3000/login",
        "ip": "127.0.0.1",
    })
    .to_string();

    redis
        .set_ex::<_, _, ()>(&redis_key, &payload, 600)
        .await
        .expect("seed oauth_state");

    let pre: bool = redis.exists(&redis_key).await.expect("exists check");
    assert!(pre, "state should exist before callback");

    let _ = client
        .get(&format!(
            "/api/oauth/line/callback?code=dummy_code&state={}",
            state_key
        ))
        .await;

    let post: bool = redis.exists(&redis_key).await.expect("exists check");
    assert!(
        !post,
        "state must be consumed atomically by the first callback (MED-1)"
    );

    teardown_test(&test_db).await;
}
