//! User endpoint integration tests
//!
//! Tests for the /api/users endpoints including:
//! - Get current user profile
//! - Update profile
//! - Change password
//! - Get loyalty status
//! - Unauthorized access

use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{generate_expired_token, TestApp, TestClient, TestUser, TEST_USER_PASSWORD};

// ============================================================================
// Test Setup Helpers
// ============================================================================

/// Create a test user with profile in the database
async fn create_test_user_with_profile(
    pool: &sqlx::PgPool,
    email: &str,
    first_name: &str,
    last_name: &str,
) -> Result<TestUser, sqlx::Error> {
    let user = TestUser::new(email);
    user.insert_with_profile(pool, first_name, last_name)
        .await?;
    Ok(user)
}

/// Create a test user with loyalty data in the database
async fn create_test_user_with_loyalty(
    pool: &sqlx::PgPool,
    email: &str,
    first_name: &str,
    last_name: &str,
    points: i32,
    nights: i32,
) -> Result<TestUser, sqlx::Error> {
    let user = TestUser::new(email);
    user.insert_with_profile(pool, first_name, last_name)
        .await?;

    let tier_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM tiers WHERE name = 'Bronze' LIMIT 1")
            .fetch_optional(pool)
            .await?;

    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user.id)
    .bind(tier_id)
    .bind(points)
    .bind(nights)
    .execute(pool)
    .await?;

    Ok(user)
}

// ============================================================================
// Test: Get Current User
// ============================================================================

#[tokio::test]
async fn test_get_current_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_test_user_with_profile(app.db(), "testuser@example.com", "John", "Doe")
        .await
        .expect("Failed to create test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/users/me").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(
        json.get("success").is_some(),
        "Response should have 'success' field"
    );
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have 'data' field");
    let profile = data
        .get("profile")
        .expect("Data should have 'profile' field");

    assert_eq!(
        profile.get("id").and_then(|v| v.as_str()),
        Some(user.id.to_string().as_str()),
        "Profile ID should match user ID"
    );
    assert_eq!(
        profile.get("email").and_then(|v| v.as_str()),
        Some("testuser@example.com"),
        "Email should match"
    );
    assert_eq!(
        profile.get("firstName").and_then(|v| v.as_str()),
        Some("John"),
        "First name should match"
    );
    assert_eq!(
        profile.get("lastName").and_then(|v| v.as_str()),
        Some("Doe"),
        "Last name should match"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Update Profile
// ============================================================================

#[tokio::test]
async fn test_update_profile() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_test_user_with_profile(app.db(), "updatetest@example.com", "Jane", "Smith")
        .await
        .expect("Failed to create test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let update_payload = json!({
        "firstName": "Janet",
        "lastName": "Johnson"
    });

    let response = client.put("/api/users/me", &update_payload).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have 'data' field");
    let profile = data
        .get("profile")
        .expect("Data should have 'profile' field");

    assert_eq!(
        profile.get("firstName").and_then(|v| v.as_str()),
        Some("Janet"),
        "First name should be updated to Janet"
    );
    assert_eq!(
        profile.get("lastName").and_then(|v| v.as_str()),
        Some("Johnson"),
        "Last name should be updated to Johnson"
    );

    // Verify changes are persisted by fetching again
    let get_response = client.get("/api/users/me").await;
    get_response.assert_status(200);

    let get_json: Value = get_response.json().expect("Response should be valid JSON");
    let get_profile = get_json
        .get("data")
        .and_then(|d| d.get("profile"))
        .expect("Should have profile data");

    assert_eq!(
        get_profile.get("firstName").and_then(|v| v.as_str()),
        Some("Janet"),
        "Persisted first name should be Janet"
    );
    assert_eq!(
        get_profile.get("lastName").and_then(|v| v.as_str()),
        Some("Johnson"),
        "Persisted last name should be Johnson"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Change Password
// ============================================================================

#[tokio::test]
async fn test_change_password() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user =
        create_test_user_with_profile(app.db(), "pwdchange@example.com", "Password", "Changer")
            .await
            .expect("Failed to create test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let new_password = "NewSecurePassword456!";
    let change_payload = json!({
        "currentPassword": TEST_USER_PASSWORD,
        "newPassword": new_password
    });

    let response = client.put("/api/users/me/password", &change_payload).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Password change should succeed"
    );

    let message = json.get("message").and_then(|v| v.as_str());
    assert!(message.is_some(), "Response should have a success message");
    assert!(
        message.unwrap().to_lowercase().contains("password"),
        "Message should mention password"
    );

    // Verify old password no longer works by checking the hash was updated
    let stored_hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_optional(app.db())
            .await
            .expect("Query should succeed")
            .flatten();

    assert!(stored_hash.is_some(), "Password hash should exist");

    use argon2::{password_hash::PasswordHash, password_hash::PasswordVerifier, Argon2};

    let hash = stored_hash.unwrap();
    let parsed_hash = PasswordHash::new(&hash).expect("Hash should be valid");

    assert!(
        Argon2::default()
            .verify_password(new_password.as_bytes(), &parsed_hash)
            .is_ok(),
        "New password should verify against stored hash"
    );

    assert!(
        Argon2::default()
            .verify_password(TEST_USER_PASSWORD.as_bytes(), &parsed_hash)
            .is_err(),
        "Old password should not verify against new hash"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Get Loyalty Status
// ============================================================================

#[tokio::test]
async fn test_get_loyalty_status() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_test_user_with_loyalty(
        app.db(),
        "loyaltytest@example.com",
        "Loyal",
        "Customer",
        1500,
        5,
    )
    .await
    .expect("Failed to create test user with loyalty");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/users/me/loyalty").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have 'data' field");

    assert_eq!(
        data.get("currentPoints").and_then(|v| v.as_i64()),
        Some(1500),
        "Current points should be 1500"
    );

    assert_eq!(
        data.get("totalNights").and_then(|v| v.as_i64()),
        Some(5),
        "Total nights should be 5"
    );

    assert_eq!(
        data.get("userId").and_then(|v| v.as_str()),
        Some(user.id.to_string().as_str()),
        "User ID should match"
    );

    let tier = data.get("tier");
    assert!(tier.is_some(), "Response should have tier information");

    if let Some(tier_obj) = tier {
        if !tier_obj.is_null() {
            assert!(tier_obj.get("name").is_some(), "Tier should have a name");
        }
    }

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Unauthorized Access
// ============================================================================

#[tokio::test]
async fn test_unauthorized_access() {
    let app = TestApp::new().await.expect("Failed to create test app");

    // Create client WITHOUT auth token
    let client = app.client();

    let response = client.get("/api/users/me").await;

    response.assert_status(401);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(
        json.get("error").is_some(),
        "Response should have 'error' field"
    );

    let error = json.get("error").and_then(|v| v.as_str());
    assert!(error.is_some(), "Error field should be a string");
    assert_eq!(
        error.unwrap(),
        "No token provided",
        "Error should be 'No token provided'"
    );

    let message = json.get("message").and_then(|v| v.as_str());
    assert!(message.is_some(), "Response should have 'message' field");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_unauthorized_access_invalid_token() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = TestClient::new(app.router()).with_auth("invalid.token.here");

    let response = client.get("/api/users/me").await;

    response.assert_status(401);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("error").and_then(|v| v.as_str()),
        Some("Invalid token"),
        "Error should be 'Invalid token'"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_unauthorized_access_expired_token() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user_id = Uuid::new_v4();
    let expired_token = generate_expired_token(&user_id, "expired@example.com");

    let client = TestClient::new(app.router()).with_auth(&expired_token);

    let response = client.get("/api/users/me").await;

    response.assert_status(401);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("error").and_then(|v| v.as_str()),
        Some("Token expired"),
        "Error should be 'Token expired'"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Update Profile - Validation Errors
// ============================================================================

#[tokio::test]
async fn test_update_profile_validation_error() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_test_user_with_profile(app.db(), "validation@example.com", "Valid", "User")
        .await
        .expect("Failed to create test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let long_name = "A".repeat(150);
    let update_payload = json!({
        "firstName": long_name
    });

    let response = client.put("/api/users/me", &update_payload).await;

    assert!(
        response.status == 400 || response.status == 422,
        "Should return validation error status, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Change Password - Wrong Current Password
// ============================================================================

#[tokio::test]
async fn test_change_password_wrong_current() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_test_user_with_profile(app.db(), "wrongpwd@example.com", "Wrong", "Password")
        .await
        .expect("Failed to create test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let change_payload = json!({
        "currentPassword": "WrongPassword123!",
        "newPassword": "NewPassword456!"
    });

    let response = client.put("/api/users/me/password", &change_payload).await;

    response.assert_status(400);

    let json: Value = response.json().expect("Response should be valid JSON");

    let message = json.get("message").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        message.to_lowercase().contains("incorrect")
            || message.to_lowercase().contains("invalid")
            || message.to_lowercase().contains("wrong"),
        "Message should indicate password is incorrect: {}",
        message
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Get Loyalty Status - No Loyalty Record
// ============================================================================

#[tokio::test]
async fn test_get_loyalty_status_no_record() {
    let app = TestApp::new().await.expect("Failed to create test app");

    // Create user WITHOUT loyalty data
    let user = create_test_user_with_profile(app.db(), "noloyalty@example.com", "No", "Loyalty")
        .await
        .expect("Failed to create test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/users/me/loyalty").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have 'data' field");

    assert_eq!(
        data.get("currentPoints").and_then(|v| v.as_i64()),
        Some(0),
        "Default points should be 0"
    );
    assert_eq!(
        data.get("totalNights").and_then(|v| v.as_i64()),
        Some(0),
        "Default nights should be 0"
    );

    app.cleanup().await.ok();
}
