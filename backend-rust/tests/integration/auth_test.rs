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

// ============================================================================
// Phase 1: HttpOnly refresh-token cookie tests
// ============================================================================
//
// These tests cover the additive Phase 1 of the cookie migration:
// - login also returns a `refresh_token` HttpOnly cookie
// - /refresh works with body-only, cookie-only, or both (body wins)
// - /logout clears the cookie

/// Register a user and return (email, refresh_token_from_body, set_cookie_header).
async fn register_and_get_refresh_artifacts(
    client: &TestClient,
) -> (String, String, Option<String>) {
    let email = unique_email();
    let register_payload = json!({
        "email": email,
        "password": "SecurePass123!",
        "firstName": "Cookie",
        "lastName": "Tester"
    });
    let response = client.post("/api/auth/register", &register_payload).await;
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    let refresh_token = body["tokens"]["refreshToken"]
        .as_str()
        .expect("Should have refresh token")
        .to_string();
    // Registration doesn't currently set the cookie (Phase 1 only modifies
    // login/refresh/logout), but capture whatever Set-Cookie is present.
    let set_cookie = response.set_cookie_for("refresh_token");
    (email, refresh_token, set_cookie)
}

/// Log a user in and return (refresh_token_from_body, full_set_cookie_header_value).
async fn login_and_capture_cookie(client: &TestClient, email: &str, password: &str) -> (String, String) {
    let login_payload = json!({ "email": email, "password": password });
    let response = client.post("/api/auth/login", &login_payload).await;
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    let refresh_token = body["tokens"]["refreshToken"]
        .as_str()
        .expect("Login should return refresh token in body")
        .to_string();

    let set_cookie = response
        .set_cookie_for("refresh_token")
        .expect("Login MUST emit a refresh_token Set-Cookie header (Phase 1)");

    (refresh_token, set_cookie)
}

/// Extract the cookie value (the part after `name=` and before `;`).
fn cookie_value(set_cookie_header: &str) -> &str {
    let after_eq = set_cookie_header
        .split_once('=')
        .map(|(_, rest)| rest)
        .expect("Set-Cookie header must contain '='");
    after_eq.split(';').next().unwrap_or(after_eq)
}

#[tokio::test]
async fn test_login_sets_refresh_token_cookie_with_security_attributes() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Register a user (registration doesn't set the cookie in Phase 1).
    let (email, _initial_refresh, _) = register_and_get_refresh_artifacts(&client).await;

    // Log in — login MUST emit the refresh_token cookie.
    let (body_refresh_token, set_cookie) =
        login_and_capture_cookie(&client, &email, "SecurePass123!").await;

    // The cookie value matches the refresh token returned in the JSON body.
    assert_eq!(
        cookie_value(&set_cookie),
        body_refresh_token,
        "Cookie value must match the refreshToken in the JSON response so both \
         storage paths reference the same server-side row"
    );

    // Defense-in-depth attributes per Phase 1 spec.
    assert!(
        set_cookie.contains("HttpOnly"),
        "Cookie must be HttpOnly to prevent XSS exfiltration: {set_cookie}"
    );
    assert!(
        set_cookie.contains("Secure"),
        "Cookie must be Secure (HTTPS-only): {set_cookie}"
    );
    assert!(
        set_cookie.contains("SameSite=Strict"),
        "Cookie must be SameSite=Strict to defend against CSRF: {set_cookie}"
    );
    assert!(
        set_cookie.contains("Path=/api/auth"),
        "Cookie must be scoped to /api/auth: {set_cookie}"
    );
    assert!(
        set_cookie.contains("Max-Age="),
        "Cookie must carry an explicit Max-Age: {set_cookie}"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_body_only_still_works() {
    // Backwards-compatibility: existing localStorage frontend POSTs the token
    // in the body. This must keep working unchanged.
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (email, _, _) = register_and_get_refresh_artifacts(&client).await;
    let (body_refresh_token, _set_cookie) =
        login_and_capture_cookie(&client, &email, "SecurePass123!").await;

    let refresh_payload = json!({ "refreshToken": body_refresh_token });
    let response = client.post("/api/auth/refresh", &refresh_payload).await;

    response.assert_status(200);
    let body: Value = response.json().expect("Response should be valid JSON");
    assert!(body["tokens"]["accessToken"].is_string());
    assert!(body["tokens"]["refreshToken"].is_string());

    // Refresh should also rotate the cookie.
    let new_set_cookie = response
        .set_cookie_for("refresh_token")
        .expect("Refresh must rotate the cookie too");
    assert_eq!(
        cookie_value(&new_set_cookie),
        body["tokens"]["refreshToken"].as_str().unwrap(),
        "Rotated cookie value must match the new refresh token in the body"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_cookie_only_works() {
    // The Phase 2 frontend will stop sending the body and rely on the cookie.
    // Verify that path right now so Phase 2 can ship without a backend change.
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (email, _, _) = register_and_get_refresh_artifacts(&client).await;
    let (body_refresh_token, _set_cookie) =
        login_and_capture_cookie(&client, &email, "SecurePass123!").await;

    // Build a client that sends the refresh-token cookie but no body.
    let cookie_client = app
        .client()
        .with_cookie(&format!("refresh_token={body_refresh_token}"));

    // Empty JSON object body — handler should fall back to the cookie.
    let response = cookie_client.post("/api/auth/refresh", &json!({})).await;
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    let new_access_token = body["tokens"]["accessToken"]
        .as_str()
        .expect("Should have new access token");
    assert_eq!(
        new_access_token.split('.').count(),
        3,
        "New access token should be a valid JWT"
    );
    assert!(body["tokens"]["refreshToken"].is_string());

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_both_body_and_cookie_uses_body() {
    // Spec: "Body takes precedence if both present (so the frontend can switch
    // over gradually)." Verify by sending a VALID body token and an INVALID
    // cookie token — the request must succeed (proving the body was used).
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (email, _, _) = register_and_get_refresh_artifacts(&client).await;
    let (body_refresh_token, _set_cookie) =
        login_and_capture_cookie(&client, &email, "SecurePass123!").await;

    let cookie_client = app
        .client()
        .with_cookie("refresh_token=this-cookie-token-is-not-valid");

    let refresh_payload = json!({ "refreshToken": body_refresh_token });
    let response = cookie_client
        .post("/api/auth/refresh", &refresh_payload)
        .await;

    response.assert_status(200);
    let body: Value = response.json().expect("Response should be valid JSON");
    assert!(
        body["tokens"]["accessToken"].is_string(),
        "Body token must take precedence over the (invalid) cookie token"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_neither_body_nor_cookie_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // No body, no cookie.
    let response = client.post_empty("/api/auth/refresh").await;
    assert!(
        response.status == 401 || response.status == 400,
        "Expected 401 or 400 when no refresh token supplied, got {}: {}",
        response.status,
        response.body
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_logout_clears_refresh_token_cookie() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (email, _, _) = register_and_get_refresh_artifacts(&client).await;
    let (body_refresh_token, _set_cookie) =
        login_and_capture_cookie(&client, &email, "SecurePass123!").await;

    // Log in again to get an access token (we have body_refresh_token but
    // need an access token for the logout endpoint).
    let login_payload = json!({ "email": email, "password": "SecurePass123!" });
    let login_response = client.post("/api/auth/login", &login_payload).await;
    login_response.assert_status(200);
    let login_body: Value = login_response.json().unwrap();
    let access_token = login_body["tokens"]["accessToken"].as_str().unwrap();

    let auth_client = TestClient::new(app.router()).with_auth(access_token);
    let logout_payload = json!({ "refreshToken": body_refresh_token });
    let logout_response = auth_client.post("/api/auth/logout", &logout_payload).await;
    logout_response.assert_status(200);

    let clear_cookie = logout_response
        .set_cookie_for("refresh_token")
        .expect("Logout MUST emit a refresh_token Set-Cookie header to clear it");

    assert_eq!(
        cookie_value(&clear_cookie),
        "",
        "Cleared cookie value must be empty"
    );
    assert!(
        clear_cookie.contains("Max-Age=0"),
        "Cleared cookie must have Max-Age=0 to drop it immediately: {clear_cookie}"
    );
    assert!(
        clear_cookie.contains("HttpOnly"),
        "Cleared cookie must keep HttpOnly attribute: {clear_cookie}"
    );
    assert!(
        clear_cookie.contains("Secure"),
        "Cleared cookie must keep Secure attribute: {clear_cookie}"
    );
    assert!(
        clear_cookie.contains("SameSite=Strict"),
        "Cleared cookie must keep SameSite=Strict: {clear_cookie}"
    );
    assert!(
        clear_cookie.contains("Path=/api/auth"),
        "Cleared cookie must keep the same Path so the browser actually drops it: {clear_cookie}"
    );

    app.cleanup().await.ok();
}
