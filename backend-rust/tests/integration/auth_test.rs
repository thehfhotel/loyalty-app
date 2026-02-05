//! Authentication integration tests
//!
//! Tests for the authentication API endpoints including:
//! - User registration
//! - User login
//! - Token refresh
//! - Logout

use axum::Router;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::common::{
    init_test_redis, setup_test, teardown_test, TestClient, TEST_JWT_SECRET,
};

use loyalty_backend::routes::auth::routes_with_state;
use loyalty_backend::state::AppState;
use loyalty_backend::config::Settings;

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

/// Create test settings with appropriate defaults for testing
fn create_test_settings() -> Settings {
    let mut settings = Settings::default();
    settings.auth.jwt_secret = TEST_JWT_SECRET.to_string();
    settings.auth.jwt_refresh_secret = TEST_JWT_SECRET.to_string();
    settings.auth.access_token_expiry_secs = 900; // 15 minutes
    settings.auth.refresh_token_expiry_secs = 604800; // 7 days
    settings
}

/// Create a test application with auth routes
async fn create_test_app(pool: PgPool) -> Router {
    let redis = init_test_redis()
        .await
        .expect("Failed to initialize test Redis");

    let settings = create_test_settings();
    let state = AppState::new(pool, redis, settings);

    // Nest auth routes under /api like the main app does
    Router::new()
        .nest("/api", routes_with_state(state))
}

/// Ensure required tables exist for auth tests
async fn ensure_auth_tables(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Create user_audit_log table if it doesn't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user_audit_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            action VARCHAR(100) NOT NULL,
            details JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create password_reset_tokens table if it doesn't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Clean up auth-related test data
#[allow(dead_code)]
async fn cleanup_auth_data(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("TRUNCATE TABLE user_audit_log, password_reset_tokens, refresh_tokens, user_profiles, users CASCADE")
        .execute(pool)
        .await?;
    Ok(())
}

/// Generate a unique email for testing
fn unique_email() -> String {
    format!("test_{}@example.com", uuid::Uuid::new_v4())
}

// ============================================================================
// Registration Tests
// ============================================================================

/// Test successful user registration
/// POST /api/auth/register
/// Verify user is created and tokens are returned
#[tokio::test]
async fn test_register_user_success() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let email = unique_email();
    let register_payload = json!({
        "email": email,
        "password": "SecurePass123!",
        "firstName": "Test",
        "lastName": "User",
        "phone": "+66812345678"
    });

    let response = client.post("/api/auth/register", &register_payload).await;

    // Should return 201 Created
    response.assert_status(201);

    // Parse response body
    let body: Value = response.json().expect("Response should be valid JSON");

    // Verify user data is returned
    assert!(body.get("user").is_some(), "Response should contain user object");
    let user = &body["user"];
    assert_eq!(user["email"], email);
    assert_eq!(user["firstName"], "Test");
    assert_eq!(user["lastName"], "User");
    assert!(user["id"].is_string(), "User should have an ID");
    assert!(user["membershipId"].is_string(), "User should have a membership ID");

    // Verify tokens are returned
    assert!(body.get("tokens").is_some(), "Response should contain tokens");
    let tokens = &body["tokens"];
    assert!(tokens["accessToken"].is_string(), "Should have access token");
    assert!(tokens["refreshToken"].is_string(), "Should have refresh token");

    // Verify access token is a valid JWT (has 3 parts separated by dots)
    let access_token = tokens["accessToken"].as_str().unwrap();
    assert_eq!(access_token.split('.').count(), 3, "Access token should be a valid JWT");

    // Verify user was actually created in database
    let db_user: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&pool)
        .await
        .expect("Database query should succeed");

    assert!(db_user.is_some(), "User should exist in database");

    teardown_test(&test_db).await;
}

/// Test registration fails with duplicate email
/// POST /api/auth/register with same email twice
/// Verify 400 error
#[tokio::test]
async fn test_register_duplicate_email_fails() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let email = unique_email();
    let register_payload = json!({
        "email": email,
        "password": "SecurePass123!",
        "firstName": "Test",
        "lastName": "User"
    });

    // First registration should succeed
    let response1 = client.post("/api/auth/register", &register_payload).await;
    response1.assert_status(201);

    // Need to create a new app/client since the router is consumed
    let app2 = create_test_app(pool.clone()).await;
    let client2 = TestClient::new(app2);

    // Second registration with same email should fail
    let response2 = client2.post("/api/auth/register", &register_payload).await;

    // Should return 400 Bad Request (email already registered)
    assert!(
        response2.status == 400 || response2.status == 409,
        "Expected 400 or 409 status for duplicate email, got {}",
        response2.status
    );

    // Verify error message
    let body: Value = response2.json().expect("Response should be valid JSON");
    let error_message = body.get("error")
        .or_else(|| body.get("message"))
        .map(|v| v.as_str().unwrap_or(""))
        .unwrap_or("");

    assert!(
        error_message.to_lowercase().contains("email") ||
        error_message.to_lowercase().contains("already") ||
        error_message.to_lowercase().contains("registered"),
        "Error message should indicate email issue: {}",
        error_message
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// Login Tests
// ============================================================================

/// Test successful login
/// POST /api/auth/login with valid credentials
/// Verify tokens are returned
#[tokio::test]
async fn test_login_success() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    // First, register a user
    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let email = unique_email();
    let password = "SecurePass123!";

    let register_payload = json!({
        "email": email,
        "password": password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(201);

    // Now login with the same credentials
    let app2 = create_test_app(pool.clone()).await;
    let client2 = TestClient::new(app2);

    let login_payload = json!({
        "email": email,
        "password": password
    });

    let login_response = client2.post("/api/auth/login", &login_payload).await;

    // Should return 200 OK
    login_response.assert_status(200);

    // Parse response body
    let body: Value = login_response.json().expect("Response should be valid JSON");

    // Verify user data is returned
    assert!(body.get("user").is_some(), "Response should contain user object");
    let user = &body["user"];
    assert_eq!(user["email"], email);

    // Verify tokens are returned
    assert!(body.get("tokens").is_some(), "Response should contain tokens");
    let tokens = &body["tokens"];
    assert!(tokens["accessToken"].is_string(), "Should have access token");
    assert!(tokens["refreshToken"].is_string(), "Should have refresh token");

    // Verify access token is a valid JWT
    let access_token = tokens["accessToken"].as_str().unwrap();
    assert_eq!(access_token.split('.').count(), 3, "Access token should be a valid JWT");

    teardown_test(&test_db).await;
}

/// Test login fails with invalid password
/// POST /api/auth/login with wrong password
/// Verify 401 error
#[tokio::test]
async fn test_login_invalid_password() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    // First, register a user
    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let email = unique_email();
    let correct_password = "SecurePass123!";
    let wrong_password = "WrongPassword456!";

    let register_payload = json!({
        "email": email,
        "password": correct_password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(201);

    // Try to login with wrong password
    let app2 = create_test_app(pool.clone()).await;
    let client2 = TestClient::new(app2);

    let login_payload = json!({
        "email": email,
        "password": wrong_password
    });

    let login_response = client2.post("/api/auth/login", &login_payload).await;

    // Should return 401 Unauthorized
    response_assert_status(&login_response, 401);

    // Verify error message
    let body: Value = login_response.json().expect("Response should be valid JSON");
    let error_message = body.get("error")
        .or_else(|| body.get("message"))
        .map(|v| v.as_str().unwrap_or(""))
        .unwrap_or("");

    assert!(
        error_message.to_lowercase().contains("invalid") ||
        error_message.to_lowercase().contains("password") ||
        error_message.to_lowercase().contains("unauthorized"),
        "Error message should indicate authentication failure: {}",
        error_message
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// Token Refresh Tests
// ============================================================================

/// Test refresh token to get new access token
/// POST /api/auth/refresh with valid refresh token
/// Verify new tokens are returned
#[tokio::test]
async fn test_refresh_token() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    // Register and login to get tokens
    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let email = unique_email();
    let password = "SecurePass123!";

    let register_payload = json!({
        "email": email,
        "password": password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(201);

    let register_body: Value = register_response.json().expect("Response should be valid JSON");
    let original_refresh_token = register_body["tokens"]["refreshToken"]
        .as_str()
        .expect("Should have refresh token");
    // Note: We verify access token exists but don't need to use it for refresh
    let _original_access_token = register_body["tokens"]["accessToken"]
        .as_str()
        .expect("Should have access token");

    // Use refresh token to get new tokens
    let app2 = create_test_app(pool.clone()).await;
    let client2 = TestClient::new(app2);

    let refresh_payload = json!({
        "refreshToken": original_refresh_token
    });

    let refresh_response = client2.post("/api/auth/refresh", &refresh_payload).await;

    // Should return 200 OK
    refresh_response.assert_status(200);

    // Parse response body
    let refresh_body: Value = refresh_response.json().expect("Response should be valid JSON");

    // Verify new tokens are returned
    assert!(refresh_body.get("tokens").is_some(), "Response should contain tokens");
    let tokens = &refresh_body["tokens"];

    let new_access_token = tokens["accessToken"].as_str().expect("Should have new access token");
    let new_refresh_token = tokens["refreshToken"].as_str().expect("Should have new refresh token");

    // New tokens should be valid JWTs
    assert_eq!(new_access_token.split('.').count(), 3, "New access token should be a valid JWT");
    assert!(!new_refresh_token.is_empty(), "New refresh token should not be empty");

    // New access token should be different from the original (issued at different times)
    // Note: In practice, they could be the same if issued within the same second,
    // so we just verify the new token is valid rather than different

    teardown_test(&test_db).await;
}

// ============================================================================
// Logout Tests
// ============================================================================

/// Test logout invalidates refresh token
/// POST /api/auth/logout invalidates refresh token
/// Verify subsequent refresh fails
#[tokio::test]
async fn test_logout() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    // Register to get tokens
    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let email = unique_email();
    let password = "SecurePass123!";

    let register_payload = json!({
        "email": email,
        "password": password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(201);

    let register_body: Value = register_response.json().expect("Response should be valid JSON");
    let access_token = register_body["tokens"]["accessToken"]
        .as_str()
        .expect("Should have access token");
    let refresh_token = register_body["tokens"]["refreshToken"]
        .as_str()
        .expect("Should have refresh token");

    // Logout with the access token (authenticated request)
    let app2 = create_test_app(pool.clone()).await;
    let client2 = TestClient::new(app2).with_auth(access_token);

    let logout_payload = json!({
        "refreshToken": refresh_token
    });

    let logout_response = client2.post("/api/auth/logout", &logout_payload).await;

    // Should return 200 OK
    logout_response.assert_status(200);

    // Verify logout message
    let logout_body: Value = logout_response.json().expect("Response should be valid JSON");
    let message = logout_body.get("message")
        .map(|v| v.as_str().unwrap_or(""))
        .unwrap_or("");

    assert!(
        message.to_lowercase().contains("logged out") ||
        message.to_lowercase().contains("logout") ||
        message.to_lowercase().contains("success"),
        "Should confirm successful logout: {}",
        message
    );

    // Try to use the refresh token - should fail
    let app3 = create_test_app(pool.clone()).await;
    let client3 = TestClient::new(app3);

    let refresh_payload = json!({
        "refreshToken": refresh_token
    });

    let refresh_response = client3.post("/api/auth/refresh", &refresh_payload).await;

    // Should return 401 Unauthorized (token was deleted/invalidated)
    assert!(
        refresh_response.status == 401 || refresh_response.status == 400,
        "Refresh with invalidated token should fail with 401 or 400, got {}",
        refresh_response.status
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Helper to assert status with a custom message
fn response_assert_status(response: &crate::common::TestResponse, expected: u16) {
    assert_eq!(
        response.status, expected,
        "Expected status {}, got {}. Body: {}",
        expected, response.status, response.body
    );
}

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

/// Test registration with invalid email format
#[tokio::test]
async fn test_register_invalid_email() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let register_payload = json!({
        "email": "not-a-valid-email",
        "password": "SecurePass123!",
        "firstName": "Test",
        "lastName": "User"
    });

    let response = client.post("/api/auth/register", &register_payload).await;

    // Should return 400 Bad Request (validation error)
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid email, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

/// Test registration with too short password
#[tokio::test]
async fn test_register_short_password() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let register_payload = json!({
        "email": unique_email(),
        "password": "short",  // Less than 8 characters
        "firstName": "Test",
        "lastName": "User"
    });

    let response = client.post("/api/auth/register", &register_payload).await;

    // Should return 400 Bad Request (validation error)
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for short password, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

/// Test login with non-existent email
#[tokio::test]
async fn test_login_nonexistent_email() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let login_payload = json!({
        "email": "nonexistent@example.com",
        "password": "SomePassword123!"
    });

    let response = client.post("/api/auth/login", &login_payload).await;

    // Should return 401 Unauthorized
    response_assert_status(&response, 401);

    teardown_test(&test_db).await;
}

/// Test refresh with invalid token
#[tokio::test]
async fn test_refresh_invalid_token() {
    let (pool, test_db) = setup_test().await;
    ensure_auth_tables(&pool).await.expect("Failed to create auth tables");

    let app = create_test_app(pool.clone()).await;
    let client = TestClient::new(app);

    let refresh_payload = json!({
        "refreshToken": "invalid-refresh-token-that-does-not-exist"
    });

    let response = client.post("/api/auth/refresh", &refresh_payload).await;

    // Should return 401 Unauthorized
    assert!(
        response.status == 401 || response.status == 400,
        "Expected 401 or 400 for invalid refresh token, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}
