//! Authentication integration tests
//!
//! Tests for the authentication API endpoints including:
//! - User registration
//! - User login
//! - Token refresh (Phase 3: cookie-only)
//! - Logout (Phase 3: cookie-only)
//!
//! # Phase 3 cookie-only contract
//!
//! The JSON-body refresh-token contract has been removed. The refresh token
//! is delivered exclusively via the `refresh_token` HttpOnly cookie. Tests
//! that previously POSTed `{"refreshToken": "..."}` to `/auth/refresh` or
//! `/auth/logout` no longer exist — see `test_refresh_with_body_only_is_rejected`
//! and the cookie-only variants for the new contract.

use serde_json::{json, Value};

use crate::common::{TestApp, TestClient, TestResponse};

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
    // Phase 3: refresh token is delivered ONLY via the HttpOnly cookie.
    assert!(
        tokens.get("refreshToken").is_none(),
        "Phase 3: response MUST NOT contain a refreshToken in the JSON body. \
         Got tokens: {tokens}"
    );

    let access_token = tokens["accessToken"].as_str().unwrap();
    assert_eq!(
        access_token.split('.').count(),
        3,
        "Access token should be a valid JWT"
    );

    // Phase 3: registration must also emit the refresh_token cookie so the
    // client has a session immediately without a follow-up login call.
    assert!(
        response.set_cookie_for("refresh_token").is_some(),
        "Registration MUST emit a refresh_token Set-Cookie header (Phase 3)"
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
    // Phase 3: refresh token is delivered ONLY via the HttpOnly cookie.
    assert!(
        tokens.get("refreshToken").is_none(),
        "Phase 3: response MUST NOT contain a refreshToken in the JSON body. \
         Got tokens: {tokens}"
    );

    let access_token = tokens["accessToken"].as_str().unwrap();
    assert_eq!(
        access_token.split('.').count(),
        3,
        "Access token should be a valid JWT"
    );

    // Phase 3: login MUST set the refresh_token cookie — that is the sole
    // delivery channel now.
    assert!(
        login_response.set_cookie_for("refresh_token").is_some(),
        "Login MUST emit a refresh_token Set-Cookie header (Phase 3)"
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
    // Phase 3: refresh is cookie-only. We register to get the Set-Cookie,
    // capture the cookie value, then POST /auth/refresh with the cookie
    // attached and NO JSON body fields naming the token.
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

    let original_cookie = register_response
        .set_cookie_for("refresh_token")
        .expect("Register must emit a refresh_token cookie (Phase 3)");
    let original_cookie_value = parse_cookie_value(&original_cookie).to_string();

    // POST /auth/refresh with the cookie attached. Empty JSON body —
    // there is no longer a body-side path.
    let cookie_client = app
        .client()
        .with_cookie(&format!("refresh_token={original_cookie_value}"));
    let refresh_response = cookie_client.post("/api/auth/refresh", &json!({})).await;

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
    // Phase 3: NO refreshToken in body.
    assert!(
        tokens.get("refreshToken").is_none(),
        "Phase 3: refresh response MUST NOT contain a refreshToken in the body"
    );

    assert_eq!(
        new_access_token.split('.').count(),
        3,
        "New access token should be a valid JWT"
    );

    // Phase 3: the rotated refresh token is delivered exclusively via
    // Set-Cookie. The new cookie value must differ from the old one.
    let rotated_cookie = refresh_response
        .set_cookie_for("refresh_token")
        .expect("Refresh must rotate the refresh_token cookie (Phase 3)");
    let rotated_value = parse_cookie_value(&rotated_cookie);
    assert!(
        !rotated_value.is_empty(),
        "Rotated cookie value must not be empty"
    );
    assert_ne!(
        rotated_value, original_cookie_value,
        "Refresh MUST rotate the refresh token (new cookie != old cookie)"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Logout Tests
// ============================================================================

#[tokio::test]
async fn test_logout() {
    // Phase 3: logout reads the refresh token from the HttpOnly cookie and
    // accepts no JSON body. The handler always emits a clearing Set-Cookie,
    // and after logout the underlying server-side row is gone so a refresh
    // attempt with the (now-stale) cookie value must fail.
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

    let refresh_cookie = register_response
        .set_cookie_for("refresh_token")
        .expect("Register must emit a refresh_token cookie (Phase 3)");
    let refresh_cookie_value = parse_cookie_value(&refresh_cookie).to_string();

    // Logout with the access token AND the refresh cookie. Empty body.
    let auth_client = TestClient::new(app.router())
        .with_auth(access_token)
        .with_cookie(&format!("refresh_token={refresh_cookie_value}"));

    let logout_response = auth_client.post("/api/auth/logout", &json!({})).await;

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

    // Logout must clear the cookie.
    let clear_cookie = logout_response
        .set_cookie_for("refresh_token")
        .expect("Logout MUST emit a clearing refresh_token Set-Cookie");
    assert!(
        clear_cookie.contains("Max-Age=0"),
        "Logout's clearing cookie must use Max-Age=0: {clear_cookie}"
    );

    // Try to refresh with the now-revoked cookie value — the server-side
    // row was deleted during logout, so the cookie no longer maps to any
    // user and the refresh must fail.
    let stale_cookie_client = app
        .client()
        .with_cookie(&format!("refresh_token={refresh_cookie_value}"));
    let refresh_response = stale_cookie_client
        .post("/api/auth/refresh", &json!({}))
        .await;

    assert!(
        refresh_response.status == 401 || refresh_response.status == 400,
        "Refresh with invalidated cookie should fail with 401 or 400, got {}: {}",
        refresh_response.status,
        refresh_response.body
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
    // Phase 3: invalid cookie value must be rejected.
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app
        .client()
        .with_cookie("refresh_token=invalid-refresh-token-that-does-not-exist");

    let response = client.post("/api/auth/refresh", &json!({})).await;

    assert!(
        response.status == 401 || response.status == 400,
        "Expected 401 or 400 for invalid refresh token, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Phase 3: HttpOnly refresh-token cookie is the ONLY delivery channel
// ============================================================================
//
// These tests pin the Phase 3 contract:
// - login, register, and /refresh all emit `Set-Cookie: refresh_token=...`
// - none of them include a `refreshToken` field in the JSON body
// - /refresh and /logout ignore any JSON-body `refreshToken` field — the
//   cookie is the sole source of truth
// - /logout clears the cookie via Max-Age=0
// - missing cookie → 401

/// Extract the cookie value (the part after `name=` and before `;`).
///
/// Named `parse_cookie_value` rather than `cookie_value` so tests can bind a
/// `cookie_value` local without shadowing the helper.
fn parse_cookie_value(set_cookie_header: &str) -> &str {
    let after_eq = set_cookie_header
        .split_once('=')
        .map(|(_, rest)| rest)
        .expect("Set-Cookie header must contain '='");
    after_eq.split(';').next().unwrap_or(after_eq)
}

/// Register a user and return (email, login_response, refresh_cookie_value).
async fn register_user(client: &TestClient) -> (String, TestResponse, String) {
    let email = unique_email();
    let register_payload = json!({
        "email": email,
        "password": "SecurePass123!",
        "firstName": "Cookie",
        "lastName": "Tester"
    });
    let response = client.post("/api/auth/register", &register_payload).await;
    response.assert_status(200);

    let cookie = response
        .set_cookie_for("refresh_token")
        .expect("Register MUST emit a refresh_token Set-Cookie header (Phase 3)");
    let value = parse_cookie_value(&cookie).to_string();
    (email, response, value)
}

/// Log a user in and return (login_response, refresh_cookie_value).
async fn login_user(client: &TestClient, email: &str, password: &str) -> (TestResponse, String) {
    let login_payload = json!({ "email": email, "password": password });
    let response = client.post("/api/auth/login", &login_payload).await;
    response.assert_status(200);

    let cookie = response
        .set_cookie_for("refresh_token")
        .expect("Login MUST emit a refresh_token Set-Cookie header (Phase 3)");
    let value = parse_cookie_value(&cookie).to_string();
    (response, value)
}

#[tokio::test]
async fn test_login_does_not_return_refresh_token_in_body() {
    // Phase 3 contract: the JSON body carries only the access token.
    // Any client still reading `data.tokens.refreshToken` will get `undefined`.
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (email, _register_response, _) = register_user(&client).await;
    let (login_response, _cookie_value) = login_user(&client, &email, "SecurePass123!").await;

    let body: Value = login_response
        .json()
        .expect("Login response should be valid JSON");

    assert!(
        body["tokens"]["accessToken"].is_string(),
        "Body must still carry accessToken"
    );
    assert!(
        body["tokens"].get("refreshToken").is_none(),
        "Phase 3: login response MUST NOT contain a refreshToken in the body. \
         tokens={}",
        body["tokens"]
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_register_does_not_return_refresh_token_in_body() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (_email, register_response, _) = register_user(&client).await;
    let body: Value = register_response
        .json()
        .expect("Register response should be valid JSON");

    assert!(
        body["tokens"]["accessToken"].is_string(),
        "Body must still carry accessToken"
    );
    assert!(
        body["tokens"].get("refreshToken").is_none(),
        "Phase 3: register response MUST NOT contain a refreshToken in the body. \
         tokens={}",
        body["tokens"]
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_does_not_return_refresh_token_in_body() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (_email, _register_response, cookie_value) = register_user(&client).await;

    let cookie_client = app
        .client()
        .with_cookie(&format!("refresh_token={cookie_value}"));
    let response = cookie_client.post("/api/auth/refresh", &json!({})).await;
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    assert!(
        body["tokens"]["accessToken"].is_string(),
        "Refresh body must carry accessToken"
    );
    assert!(
        body["tokens"].get("refreshToken").is_none(),
        "Phase 3: refresh response MUST NOT contain a refreshToken in the body. \
         tokens={}",
        body["tokens"]
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_login_sets_refresh_token_cookie_with_security_attributes() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (email, _register_response, _) = register_user(&client).await;
    let (login_response, _cookie_value) = login_user(&client, &email, "SecurePass123!").await;
    let set_cookie = login_response
        .set_cookie_for("refresh_token")
        .expect("Login MUST emit a refresh_token Set-Cookie header (Phase 3)");

    // Defense-in-depth attributes.
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

    // The cookie value is the actual refresh token: non-empty, opaque, and
    // distinct from the access token in the body so a header logger can't
    // be tricked into emitting it.
    let value = parse_cookie_value(&set_cookie);
    assert!(
        !value.is_empty(),
        "Refresh cookie value must not be empty: {set_cookie}"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_body_only_is_rejected() {
    // Phase 3 broke the body-side contract. A client that POSTs
    // `{"refreshToken": "..."}` WITHOUT the cookie must get 401 — the body
    // field is silently ignored.
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (_email, _register_response, cookie_value) = register_user(&client).await;

    // Same client (no cookie attached) sends the (otherwise-valid) refresh
    // token in the JSON body. The handler must NOT honour it.
    let body_payload = json!({ "refreshToken": cookie_value });
    let response = client.post("/api/auth/refresh", &body_payload).await;

    assert!(
        response.status == 401 || response.status == 400,
        "Phase 3: body-side refreshToken MUST be ignored. Expected 401/400, \
         got {}: {}",
        response.status,
        response.body
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_cookie_only_works() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (_email, _register_response, cookie_value) = register_user(&client).await;

    let cookie_client = app
        .client()
        .with_cookie(&format!("refresh_token={cookie_value}"));

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

    // Refresh rotates the cookie.
    let rotated = response
        .set_cookie_for("refresh_token")
        .expect("Refresh must rotate the cookie");
    let rotated_value = parse_cookie_value(&rotated);
    assert_ne!(
        rotated_value, cookie_value,
        "Refresh MUST rotate the refresh-token value"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_refresh_with_body_and_invalid_cookie_fails() {
    // Phase 3 inverts the Phase 1 precedence rule. Even if a (valid)
    // refresh token is in the body, an INVALID cookie value must cause
    // the request to fail — the cookie is now authoritative.
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let (_email, _register_response, cookie_value) = register_user(&client).await;

    let cookie_client = app
        .client()
        .with_cookie("refresh_token=this-cookie-token-is-not-valid");

    let body_payload = json!({ "refreshToken": cookie_value });
    let response = cookie_client.post("/api/auth/refresh", &body_payload).await;

    assert!(
        response.status == 401 || response.status == 400,
        "Phase 3: an invalid cookie must fail even if a valid token is in \
         the body. Expected 401/400, got {}: {}",
        response.status,
        response.body
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

    let (email, _register_response, _) = register_user(&client).await;

    // Log in to get an access token paired with a fresh cookie.
    let (login_response, cookie_value) = login_user(&client, &email, "SecurePass123!").await;
    let login_body: Value = login_response.json().unwrap();
    let access_token = login_body["tokens"]["accessToken"].as_str().unwrap();

    // Phase 3: logout reads the refresh token from the cookie, not the body.
    let auth_client = TestClient::new(app.router())
        .with_auth(access_token)
        .with_cookie(&format!("refresh_token={cookie_value}"));

    let logout_response = auth_client.post("/api/auth/logout", &json!({})).await;
    logout_response.assert_status(200);

    let clear_cookie = logout_response
        .set_cookie_for("refresh_token")
        .expect("Logout MUST emit a refresh_token Set-Cookie header to clear it");

    assert_eq!(
        parse_cookie_value(&clear_cookie),
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
