//! User endpoint integration tests
//!
//! Tests for the /api/users endpoints including:
//! - Get current user profile
//! - Update profile
//! - Change password
//! - Get loyalty status
//! - Unauthorized access

use axum::Router;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{
    generate_test_token, init_test_db, init_test_redis, setup_test, teardown_test, TestClient,
    TestUser, TEST_JWT_SECRET, TEST_USER_PASSWORD,
};

// ============================================================================
// Test Setup
// ============================================================================

/// Create a router with database state for user testing
async fn create_user_router() -> Result<Router, Box<dyn std::error::Error>> {
    use loyalty_backend::config::Settings;
    use loyalty_backend::routes::users::routes_with_state;
    use loyalty_backend::state::AppState;

    // Initialize test database
    let pool = init_test_db().await?;

    // Initialize test Redis
    let redis = init_test_redis().await?;

    // Create test settings
    let mut settings = Settings::default();
    settings.auth.jwt_secret = TEST_JWT_SECRET.to_string();
    settings.auth.jwt_refresh_secret = TEST_JWT_SECRET.to_string();

    // Set JWT_SECRET environment variable for auth middleware
    std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);

    let state = AppState::new(pool, redis, settings);

    // Create router with user routes nested under /api
    Ok(Router::new().nest("/api", routes_with_state(state)))
}

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

    // Get Bronze tier ID (default tier)
    let tier_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM tiers WHERE name = 'Bronze' LIMIT 1")
            .fetch_optional(pool)
            .await?;

    // Insert loyalty data
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, tier_id, current_points, lifetime_points, total_nights)
        VALUES ($1, $2, $3, $3, $4)
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
#[ignore = "Requires running database and Redis"]
async fn test_get_current_user() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = create_test_user_with_profile(&pool, "testuser@example.com", "John", "Doe")
        .await
        .expect("Failed to create test user");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/api/users/me").await;

    // Assert
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
        profile.get("first_name").and_then(|v| v.as_str()),
        Some("John"),
        "First name should match"
    );
    assert_eq!(
        profile.get("last_name").and_then(|v| v.as_str()),
        Some("Doe"),
        "Last name should match"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Update Profile
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_update_profile() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = create_test_user_with_profile(&pool, "updatetest@example.com", "Jane", "Smith")
        .await
        .expect("Failed to create test user");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let update_payload = json!({
        "first_name": "Janet",
        "last_name": "Johnson"
    });

    // Act
    let response = client.put("/api/users/me", &update_payload).await;

    // Assert
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
        profile.get("first_name").and_then(|v| v.as_str()),
        Some("Janet"),
        "First name should be updated to Janet"
    );
    assert_eq!(
        profile.get("last_name").and_then(|v| v.as_str()),
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
        get_profile.get("first_name").and_then(|v| v.as_str()),
        Some("Janet"),
        "Persisted first name should be Janet"
    );
    assert_eq!(
        get_profile.get("last_name").and_then(|v| v.as_str()),
        Some("Johnson"),
        "Persisted last name should be Johnson"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Change Password
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_change_password() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = create_test_user_with_profile(&pool, "pwdchange@example.com", "Password", "Changer")
        .await
        .expect("Failed to create test user");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router.clone()).with_auth(&token);

    let new_password = "NewSecurePassword456!";
    let change_payload = json!({
        "current_password": TEST_USER_PASSWORD,
        "new_password": new_password
    });

    // Act
    let response = client.put("/api/users/me/password", &change_payload).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Password change should succeed"
    );

    // Verify the message indicates success
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
            .fetch_optional(&pool)
            .await
            .expect("Query should succeed")
            .flatten();

    assert!(stored_hash.is_some(), "Password hash should exist");

    // Verify the new password is correctly hashed
    use argon2::{password_hash::PasswordHash, password_hash::PasswordVerifier, Argon2};

    let hash = stored_hash.unwrap();
    let parsed_hash = PasswordHash::new(&hash).expect("Hash should be valid");

    // New password should verify
    assert!(
        Argon2::default()
            .verify_password(new_password.as_bytes(), &parsed_hash)
            .is_ok(),
        "New password should verify against stored hash"
    );

    // Old password should NOT verify
    assert!(
        Argon2::default()
            .verify_password(TEST_USER_PASSWORD.as_bytes(), &parsed_hash)
            .is_err(),
        "Old password should not verify against new hash"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Get Loyalty Status
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_loyalty_status() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = create_test_user_with_loyalty(
        &pool,
        "loyaltytest@example.com",
        "Loyal",
        "Customer",
        1500, // points
        5,    // nights
    )
    .await
    .expect("Failed to create test user with loyalty");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/api/users/me/loyalty").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have 'data' field");

    // Verify points
    assert_eq!(
        data.get("current_points").and_then(|v| v.as_i64()),
        Some(1500),
        "Current points should be 1500"
    );

    // Verify total nights
    assert_eq!(
        data.get("total_nights").and_then(|v| v.as_i64()),
        Some(5),
        "Total nights should be 5"
    );

    // Verify user_id
    assert_eq!(
        data.get("user_id").and_then(|v| v.as_str()),
        Some(user.id.to_string().as_str()),
        "User ID should match"
    );

    // Verify tier exists (should be Bronze for default users)
    let tier = data.get("tier");
    assert!(tier.is_some(), "Response should have tier information");

    if let Some(tier_obj) = tier {
        if !tier_obj.is_null() {
            assert!(tier_obj.get("name").is_some(), "Tier should have a name");
        }
    }

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Unauthorized Access
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_unauthorized_access() {
    // Arrange
    let router = create_user_router().await.expect("Failed to create router");

    // Create client WITHOUT auth token
    let client = TestClient::new(router);

    // Act - Try to access protected endpoint without token
    let response = client.get("/api/users/me").await;

    // Assert
    response.assert_status(401);

    let json: Value = response.json().expect("Response should be valid JSON");

    // Should have error field
    assert!(
        json.get("error").is_some(),
        "Response should have 'error' field"
    );

    let error = json.get("error").and_then(|v| v.as_str());
    assert!(error.is_some(), "Error field should be a string");
    assert_eq!(
        error.unwrap(),
        "unauthorized",
        "Error should be 'unauthorized'"
    );

    // Verify message indicates missing/invalid token
    let message = json.get("message").and_then(|v| v.as_str());
    assert!(message.is_some(), "Response should have 'message' field");
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_unauthorized_access_invalid_token() {
    // Arrange
    let router = create_user_router().await.expect("Failed to create router");

    // Create client with invalid token
    let client = TestClient::new(router).with_auth("invalid.token.here");

    // Act
    let response = client.get("/api/users/me").await;

    // Assert
    response.assert_status(401);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("error").and_then(|v| v.as_str()),
        Some("unauthorized"),
        "Error should be 'unauthorized'"
    );
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_unauthorized_access_expired_token() {
    use crate::common::generate_expired_token;

    // Arrange
    let router = create_user_router().await.expect("Failed to create router");

    let user_id = Uuid::new_v4();
    let expired_token = generate_expired_token(&user_id, "expired@example.com");

    let client = TestClient::new(router).with_auth(&expired_token);

    // Act
    let response = client.get("/api/users/me").await;

    // Assert
    response.assert_status(401);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("error").and_then(|v| v.as_str()),
        Some("unauthorized"),
        "Error should be 'unauthorized'"
    );
}

// ============================================================================
// Test: Update Profile - Validation Errors
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_update_profile_validation_error() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = create_test_user_with_profile(&pool, "validation@example.com", "Valid", "User")
        .await
        .expect("Failed to create test user");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Create payload with name that exceeds max length (>100 chars)
    let long_name = "A".repeat(150);
    let update_payload = json!({
        "first_name": long_name
    });

    // Act
    let response = client.put("/api/users/me", &update_payload).await;

    // Assert - Should return validation error (400 or 422)
    assert!(
        response.status == 400 || response.status == 422,
        "Should return validation error status, got {}",
        response.status
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Change Password - Wrong Current Password
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_change_password_wrong_current() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = create_test_user_with_profile(&pool, "wrongpwd@example.com", "Wrong", "Password")
        .await
        .expect("Failed to create test user");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let change_payload = json!({
        "current_password": "WrongPassword123!",
        "new_password": "NewPassword456!"
    });

    // Act
    let response = client.put("/api/users/me/password", &change_payload).await;

    // Assert - Should fail with 400 Bad Request
    response.assert_status(400);

    let json: Value = response.json().expect("Response should be valid JSON");

    // Should indicate incorrect password
    let message = json.get("message").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        message.to_lowercase().contains("incorrect")
            || message.to_lowercase().contains("invalid")
            || message.to_lowercase().contains("wrong"),
        "Message should indicate password is incorrect: {}",
        message
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Get Loyalty Status - No Loyalty Record
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_loyalty_status_no_record() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Create user WITHOUT loyalty data
    let user = create_test_user_with_profile(&pool, "noloyalty@example.com", "No", "Loyalty")
        .await
        .expect("Failed to create test user");

    let router = create_user_router().await.expect("Failed to create router");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/api/users/me/loyalty").await;

    // Assert - Should return default values (not error)
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have 'data' field");

    // Should have default values
    assert_eq!(
        data.get("current_points").and_then(|v| v.as_i64()),
        Some(0),
        "Default points should be 0"
    );
    assert_eq!(
        data.get("total_nights").and_then(|v| v.as_i64()),
        Some(0),
        "Default nights should be 0"
    );

    // Cleanup
    teardown_test(&test_db).await;
}
