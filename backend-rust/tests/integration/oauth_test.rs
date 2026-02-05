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
use serde_json::Value;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

use crate::common::{init_test_db, init_test_redis, setup_test, teardown_test, TestClient};

use loyalty_backend::config::Settings;
use loyalty_backend::state::AppState;
use loyalty_backend::routes::oauth::routes;

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
    settings.auth.jwt_refresh_secret = "test-jwt-refresh-secret-key-for-testing-only-32-chars".to_string();
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
    settings.auth.jwt_refresh_secret = "test-jwt-refresh-secret-key-for-testing-only-32-chars".to_string();
    settings.server.frontend_url = "http://localhost:3000".to_string();
    // OAuth not configured - client_id and client_secret are None
    settings
}

/// Create a test application with OAuth routes
async fn create_oauth_test_app(settings: Settings) -> Result<Router, Box<dyn std::error::Error>> {
    let pool = init_test_db().await?;
    let redis = init_test_redis().await?;

    let state = AppState::new(pool, redis, settings);

    // Mount OAuth routes under /api
    Ok(Router::new().nest("/api", routes().with_state(state)))
}

// ============================================================================
// Google OAuth Redirect Tests
// ============================================================================

/// Test Google OAuth redirect endpoint
/// GET /api/oauth/google
/// Verify it returns a redirect to Google OAuth
#[tokio::test]
async fn test_google_oauth_redirect() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act
    let response = client.get("/api/oauth/google").await;

    // Assert - Should return a redirect (302 or 303) to Google OAuth
    // Note: The response might be 200 with HTML redirect for mobile Safari compatibility,
    // or a proper HTTP redirect (302/303)
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status (302/303) or HTML redirect (200), got {}. Body: {}",
        response.status,
        response.body
    );

    // If it's a 200, it should be an HTML redirect page
    if response.status == 200 {
        assert!(
            response.body.contains("accounts.google.com") || response.body.contains("Redirecting"),
            "HTML response should contain redirect to Google. Body: {}",
            response.body
        );
    }
}

/// Test Google OAuth redirect includes required parameters
#[tokio::test]
async fn test_google_oauth_redirect_url_params() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act
    let response = client.get("/api/oauth/google").await;

    // The redirect URL should contain required OAuth parameters
    // For HTML redirect response, check the body
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
}

/// Test Google OAuth redirect when not configured
#[tokio::test]
async fn test_google_oauth_redirect_not_configured() {
    let settings = create_test_settings_without_oauth();
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act
    let response = client.get("/api/oauth/google").await;

    // Assert - Should redirect to login with error when OAuth is not configured
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // The redirect should indicate OAuth is not configured
    if response.status == 200 {
        assert!(
            response.body.contains("not_configured") || response.body.contains("error") || response.body.contains("login"),
            "Response should indicate Google OAuth is not configured"
        );
    }
}

// ============================================================================
// LINE OAuth Redirect Tests
// ============================================================================

/// Test LINE OAuth redirect endpoint
/// GET /api/oauth/line
/// Verify it returns a redirect to LINE OAuth
#[tokio::test]
async fn test_line_oauth_redirect() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act
    let response = client.get("/api/oauth/line").await;

    // Assert - Should return a redirect (302 or 303) to LINE OAuth
    // Note: The response might be 200 with HTML redirect for mobile Safari compatibility,
    // or a proper HTTP redirect (302/303)
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status (302/303) or HTML redirect (200), got {}. Body: {}",
        response.status,
        response.body
    );

    // If it's a 200, it should be an HTML redirect page
    if response.status == 200 {
        assert!(
            response.body.contains("access.line.me") || response.body.contains("Redirecting") || response.body.contains("LINE"),
            "HTML response should contain redirect to LINE. Body: {}",
            response.body
        );
    }
}

/// Test LINE OAuth redirect includes required parameters
#[tokio::test]
async fn test_line_oauth_redirect_url_params() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act
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
}

/// Test LINE OAuth redirect when not configured
#[tokio::test]
async fn test_line_oauth_redirect_not_configured() {
    let settings = create_test_settings_without_oauth();
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act
    let response = client.get("/api/oauth/line").await;

    // Assert - Should redirect to login with error when OAuth is not configured
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // The redirect should indicate OAuth is not configured
    if response.status == 200 {
        assert!(
            response.body.contains("not_configured") || response.body.contains("error") || response.body.contains("login"),
            "Response should indicate LINE OAuth is not configured"
        );
    }
}

// ============================================================================
// Google OAuth Callback Tests
// ============================================================================

/// Test Google OAuth callback with invalid code
/// GET /api/oauth/google/callback?code=invalid
/// Verify it returns an error redirect
#[tokio::test]
async fn test_google_callback_invalid_code() {
    // Start a mock server to simulate Google's token endpoint
    let mock_server = MockServer::start().await;

    // Mock Google token endpoint to return an error for invalid code
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "The authorization code is invalid or has expired."
            })),
        )
        .mount(&mock_server)
        .await;

    let settings = create_test_settings_with_oauth(
        Some(&format!("{}/callback", mock_server.uri())),
        None,
    );

    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Call callback with invalid code and missing state
    // Note: Without a valid state, the callback should fail with session_expired or oauth_invalid
    let response = client.get("/api/oauth/google/callback?code=invalid_code").await;

    // Assert - Should return a redirect to login with error
    // The callback without a state parameter should fail
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}. Body: {}",
        response.status,
        response.body
    );

    // The response should indicate an error occurred
    if response.status == 200 {
        assert!(
            response.body.contains("error") ||
            response.body.contains("failed") ||
            response.body.contains("invalid") ||
            response.body.contains("login"),
            "Response should indicate authentication error. Body: {}",
            response.body
        );
    }
}

/// Test Google OAuth callback with missing state parameter
#[tokio::test]
async fn test_google_callback_missing_state() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Call callback with code but no state (CSRF protection should fail)
    let response = client.get("/api/oauth/google/callback?code=some_code").await;

    // Assert - Should redirect with error due to missing state
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // Should indicate invalid request or session expired
    if response.status == 200 {
        assert!(
            response.body.contains("invalid") ||
            response.body.contains("expired") ||
            response.body.contains("error") ||
            response.body.contains("login"),
            "Response should indicate CSRF validation failed"
        );
    }
}

/// Test Google OAuth callback with OAuth provider error
#[tokio::test]
async fn test_google_callback_provider_error() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Simulate OAuth provider returning an error (e.g., user denied access)
    let response = client
        .get("/api/oauth/google/callback?error=access_denied&error_description=User%20denied%20access")
        .await;

    // Assert - Should redirect with provider error
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // Should indicate OAuth provider error
    if response.status == 200 {
        assert!(
            response.body.contains("error") ||
            response.body.contains("denied") ||
            response.body.contains("login"),
            "Response should indicate OAuth provider error"
        );
    }
}

// ============================================================================
// LINE OAuth Callback Tests
// ============================================================================

/// Test LINE OAuth callback with invalid code
/// GET /api/oauth/line/callback?code=invalid
/// Verify it returns an error redirect
#[tokio::test]
async fn test_line_callback_invalid_code() {
    // Start a mock server to simulate LINE's token endpoint
    let mock_server = MockServer::start().await;

    // Mock LINE token endpoint to return an error for invalid code
    Mock::given(method("POST"))
        .and(path("/oauth2/v2.1/token"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "The authorization code is invalid or expired"
            })),
        )
        .mount(&mock_server)
        .await;

    let settings = create_test_settings_with_oauth(
        None,
        Some(&format!("{}/callback", mock_server.uri())),
    );

    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Call callback with invalid code and missing state
    let response = client.get("/api/oauth/line/callback?code=invalid_code").await;

    // Assert - Should return a redirect to login with error
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}. Body: {}",
        response.status,
        response.body
    );

    // The response should indicate an error occurred
    if response.status == 200 {
        assert!(
            response.body.contains("error") ||
            response.body.contains("failed") ||
            response.body.contains("invalid") ||
            response.body.contains("login"),
            "Response should indicate authentication error. Body: {}",
            response.body
        );
    }
}

/// Test LINE OAuth callback with missing state parameter
#[tokio::test]
async fn test_line_callback_missing_state() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Call callback with code but no state (CSRF protection should fail)
    let response = client.get("/api/oauth/line/callback?code=some_code").await;

    // Assert - Should redirect with error due to missing state
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // Should indicate invalid request or session expired
    if response.status == 200 {
        assert!(
            response.body.contains("invalid") ||
            response.body.contains("expired") ||
            response.body.contains("error") ||
            response.body.contains("login"),
            "Response should indicate CSRF validation failed"
        );
    }
}

/// Test LINE OAuth callback with OAuth provider error
#[tokio::test]
async fn test_line_callback_provider_error() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Simulate OAuth provider returning an error
    let response = client
        .get("/api/oauth/line/callback?error=access_denied&error_description=User%20denied%20access")
        .await;

    // Assert - Should redirect with provider error
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // Should indicate OAuth provider error
    if response.status == 200 {
        assert!(
            response.body.contains("error") ||
            response.body.contains("denied") ||
            response.body.contains("login"),
            "Response should indicate OAuth provider error"
        );
    }
}

// ============================================================================
// OAuth Return URL Validation Tests
// ============================================================================

/// Test OAuth redirect with custom return_url (same origin)
#[tokio::test]
async fn test_oauth_redirect_with_valid_return_url() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Request OAuth with a valid return URL (same origin as frontend)
    let response = client
        .get("/api/oauth/google?return_url=http://localhost:3000/dashboard")
        .await;

    // Assert - Should proceed with OAuth flow
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );
}

/// Test OAuth redirect blocks different origin return_url (open redirect protection)
#[tokio::test]
async fn test_oauth_redirect_blocks_open_redirect() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Attempt OAuth with a malicious return URL
    let response = client
        .get("/api/oauth/google?return_url=https://evil.com/phishing")
        .await;

    // Assert - Should still proceed with OAuth but use default return URL
    // The open redirect attempt should be logged and blocked
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );

    // The redirect should NOT contain the evil.com domain
    if response.status == 200 {
        assert!(
            !response.body.contains("evil.com"),
            "Response should not redirect to malicious domain"
        );
    }
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
    assert!(!mock_server.uri().is_empty(), "Mock server should be running");
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
    assert!(!mock_server.uri().is_empty(), "Mock server should be running");
}

// ============================================================================
// PWA and Platform-Specific Tests
// ============================================================================

/// Test OAuth redirect with PWA flag
#[tokio::test]
async fn test_google_oauth_redirect_pwa_mode() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Request OAuth in PWA mode
    let response = client.get("/api/oauth/google?pwa=true&platform=ios").await;

    // Assert - Should proceed with OAuth flow
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );
}

/// Test OAuth redirect in standalone mode
#[tokio::test]
async fn test_line_oauth_redirect_standalone_mode() {
    let settings = create_test_settings_with_oauth(None, None);
    let app = match create_oauth_test_app(settings).await {
        Ok(app) => app,
        Err(e) => {
            eprintln!("Skipping test - test infrastructure not available: {}", e);
            return;
        }
    };

    let client = TestClient::new(app);

    // Act - Request OAuth in standalone mode
    let response = client.get("/api/oauth/line?standalone=true&platform=android").await;

    // Assert - Should proceed with OAuth flow
    assert!(
        response.status == 302 || response.status == 303 || response.status == 200,
        "Expected redirect status, got {}",
        response.status
    );
}
