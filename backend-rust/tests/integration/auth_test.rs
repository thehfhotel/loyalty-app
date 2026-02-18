//! Authentication integration tests
//!
//! Tests for the authentication API endpoints including:
//! - User registration
//! - User login
//! - Token refresh
//! - Logout

use serde_json::{json, Value};

use crate::common::{TestApp, TestClient};

// ============================================================================
// Test Helpers
// ============================================================================

/// Generate a unique email for testing
fn unique_email() -> String {
    format!("test_{}@example.com", uuid::Uuid::new_v4())
}

/// Helper to assert status with a custom message
fn response_assert_status(response: &crate::common::TestResponse, expected: u16) {
    assert_eq!(
        response.status, expected,
        "Expected status {}, got {}. Body: {}",
        expected, response.status, response.body
    );
}

// ============================================================================
// Registration Tests
// ============================================================================

#[tokio::test]
async fn test_register_user_success() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let email = unique_email();
    let register_payload = json!({
        "email": email,
        "password": "SecurePass123!",
        "firstName": "Test",
        "lastName": "User",
        "phone": "+66812345678"
    });

    let response = client.post("/api/auth/register", &register_payload).await;

    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");

    assert!(
        body.get("user").is_some(),
        "Response should contain user object"
    );
    let user = &body["user"];
    assert_eq!(user["email"], email);
    assert_eq!(user["firstName"], "Test");
    assert_eq!(user["lastName"], "User");
    assert!(user["id"].is_string(), "User should have an ID");
    assert!(
        user["membershipId"].is_string(),
        "User should have a membership ID"
    );

    assert!(
        body.get("tokens").is_some(),
        "Response should contain tokens"
    );
    let tokens = &body["tokens"];
    assert!(
        tokens["accessToken"].is_string(),
        "Should have access token"
    );
    assert!(
        tokens["refreshToken"].is_string(),
        "Should have refresh token"
    );

    let access_token = tokens["accessToken"].as_str().unwrap();
    assert_eq!(
        access_token.split('.').count(),
        3,
        "Access token should be a valid JWT"
    );

    // Verify user was actually created in database
    let db_user: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(app.db())
        .await
        .expect("Database query should succeed");

    assert!(db_user.is_some(), "User should exist in database");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_register_duplicate_email_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let email = unique_email();
    let register_payload = json!({
        "email": email,
        "password": "SecurePass123!",
        "firstName": "Test",
        "lastName": "User"
    });

    // First registration should succeed
    let response1 = client.post("/api/auth/register", &register_payload).await;
    response1.assert_status(200);

    // Second registration with same email should fail
    let response2 = client.post("/api/auth/register", &register_payload).await;

    assert!(
        response2.status == 400 || response2.status == 409,
        "Expected 400 or 409 status for duplicate email, got {}",
        response2.status
    );

    let body: Value = response2.json().expect("Response should be valid JSON");
    let error_code = body.get("error").and_then(|v| v.as_str()).unwrap_or("");
    let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("");

    let error_indicates_duplicate = error_code == "already_exists"
        || error_code == "bad_request"
        || error_code == "conflict"
        || message.to_lowercase().contains("email")
        || message.to_lowercase().contains("already")
        || message.to_lowercase().contains("registered")
        || message.to_lowercase().contains("exists");

    assert!(
        error_indicates_duplicate,
        "Error should indicate duplicate email. error: {}, message: {}",
        error_code, message
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Login Tests
// ============================================================================

#[tokio::test]
async fn test_login_success() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let email = unique_email();
    let password = "SecurePass123!";

    let register_payload = json!({
        "email": email,
        "password": password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(200);

    // Login with the same credentials
    let login_payload = json!({
        "email": email,
        "password": password
    });

    let login_response = client.post("/api/auth/login", &login_payload).await;

    login_response.assert_status(200);

    let body: Value = login_response
        .json()
        .expect("Response should be valid JSON");

    assert!(
        body.get("user").is_some(),
        "Response should contain user object"
    );
    let user = &body["user"];
    assert_eq!(user["email"], email);

    assert!(
        body.get("tokens").is_some(),
        "Response should contain tokens"
    );
    let tokens = &body["tokens"];
    assert!(
        tokens["accessToken"].is_string(),
        "Should have access token"
    );
    assert!(
        tokens["refreshToken"].is_string(),
        "Should have refresh token"
    );

    let access_token = tokens["accessToken"].as_str().unwrap();
    assert_eq!(
        access_token.split('.').count(),
        3,
        "Access token should be a valid JWT"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_login_invalid_password() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

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
    register_response.assert_status(200);

    let login_payload = json!({
        "email": email,
        "password": wrong_password
    });

    let login_response = client.post("/api/auth/login", &login_payload).await;

    response_assert_status(&login_response, 401);

    let body: Value = login_response
        .json()
        .expect("Response should be valid JSON");
    let error_message = body
        .get("error")
        .or_else(|| body.get("message"))
        .map(|v| v.as_str().unwrap_or(""))
        .unwrap_or("");

    assert!(
        error_message.to_lowercase().contains("invalid")
            || error_message.to_lowercase().contains("password")
            || error_message.to_lowercase().contains("unauthorized"),
        "Error message should indicate authentication failure: {}",
        error_message
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Token Refresh Tests
// ============================================================================

#[tokio::test]
async fn test_refresh_token() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let email = unique_email();
    let password = "SecurePass123!";

    let register_payload = json!({
        "email": email,
        "password": password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(200);

    let register_body: Value = register_response
        .json()
        .expect("Response should be valid JSON");
    let original_refresh_token = register_body["tokens"]["refreshToken"]
        .as_str()
        .expect("Should have refresh token");
    let _original_access_token = register_body["tokens"]["accessToken"]
        .as_str()
        .expect("Should have access token");

    // Use refresh token to get new tokens
    let refresh_payload = json!({
        "refreshToken": original_refresh_token
    });

    let refresh_response = client.post("/api/auth/refresh", &refresh_payload).await;

    refresh_response.assert_status(200);

    let refresh_body: Value = refresh_response
        .json()
        .expect("Response should be valid JSON");

    assert!(
        refresh_body.get("tokens").is_some(),
        "Response should contain tokens"
    );
    let tokens = &refresh_body["tokens"];

    let new_access_token = tokens["accessToken"]
        .as_str()
        .expect("Should have new access token");
    let new_refresh_token = tokens["refreshToken"]
        .as_str()
        .expect("Should have new refresh token");

    assert_eq!(
        new_access_token.split('.').count(),
        3,
        "New access token should be a valid JWT"
    );
    assert!(
        !new_refresh_token.is_empty(),
        "New refresh token should not be empty"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Logout Tests
// ============================================================================

#[tokio::test]
async fn test_logout() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let email = unique_email();
    let password = "SecurePass123!";

    let register_payload = json!({
        "email": email,
        "password": password,
        "firstName": "Test",
        "lastName": "User"
    });

    let register_response = client.post("/api/auth/register", &register_payload).await;
    register_response.assert_status(200);

    let register_body: Value = register_response
        .json()
        .expect("Response should be valid JSON");
    let access_token = register_body["tokens"]["accessToken"]
        .as_str()
        .expect("Should have access token");
    let refresh_token = register_body["tokens"]["refreshToken"]
        .as_str()
        .expect("Should have refresh token");

    // Logout with the access token
    let auth_client = TestClient::new(app.router()).with_auth(access_token);

    let logout_payload = json!({
        "refreshToken": refresh_token
    });

    let logout_response = auth_client.post("/api/auth/logout", &logout_payload).await;

    logout_response.assert_status(200);

    let logout_body: Value = logout_response
        .json()
        .expect("Response should be valid JSON");
    let message = logout_body
        .get("message")
        .map(|v| v.as_str().unwrap_or(""))
        .unwrap_or("");

    assert!(
        message.to_lowercase().contains("logged out")
            || message.to_lowercase().contains("logout")
            || message.to_lowercase().contains("success"),
        "Should confirm successful logout: {}",
        message
    );

    // Try to use the refresh token - should fail
    let refresh_payload = json!({
        "refreshToken": refresh_token
    });

    let refresh_response = client.post("/api/auth/refresh", &refresh_payload).await;

    assert!(
        refresh_response.status == 401 || refresh_response.status == 400,
        "Refresh with invalidated token should fail with 401 or 400, got {}",
        refresh_response.status
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

#[tokio::test]
async fn test_register_invalid_email() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let register_payload = json!({
        "email": "not-a-valid-email",
        "password": "SecurePass123!",
        "firstName": "Test",
        "lastName": "User"
    });

    let response = client.post("/api/auth/register", &register_payload).await;

    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid email, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_register_short_password() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let register_payload = json!({
        "email": unique_email(),
        "password": "short",
        "firstName": "Test",
        "lastName": "User"
    });

    let response = client.post("/api/auth/register", &register_payload).await;

    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for short password, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_login_nonexistent_email() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let login_payload = json!({
        "email": "nonexistent@example.com",
        "password": "SomePassword123!"
    });

    let response = client.post("/api/auth/login", &login_payload).await;

    response_assert_status(&response, 401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_invalid_token() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let refresh_payload = json!({
        "refreshToken": "invalid-refresh-token-that-does-not-exist"
    });

    let response = client.post("/api/auth/refresh", &refresh_payload).await;

    assert!(
        response.status == 401 || response.status == 400,
        "Expected 401 or 400 for invalid refresh token, got {}",
        response.status
    );

    app.cleanup().await.ok();
}
