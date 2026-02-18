//! Admin routes integration tests
//!
//! Tests for the admin API endpoints including:
//! - User management (list, get, update)
//! - Dashboard statistics
//! - Notification broadcasts

use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Test Setup Helpers
// ============================================================================

/// Generate a unique test email
fn unique_email(prefix: &str) -> String {
    format!("{}_{}_test@example.com", prefix, Uuid::new_v4())
}

/// Create and insert a test admin user
async fn create_admin_user(pool: &sqlx::PgPool) -> TestUser {
    let admin = TestUser::admin(&unique_email("admin"));
    admin
        .insert_with_profile(pool, "Admin", "User")
        .await
        .expect("Failed to insert admin user");
    admin
}

/// Create and insert a regular test user
async fn create_regular_user(pool: &sqlx::PgPool) -> TestUser {
    let user = TestUser::new(&unique_email("user"));
    user.insert_with_profile(pool, "Regular", "User")
        .await
        .expect("Failed to insert regular user");
    user
}

// ============================================================================
// List Users Tests
// ============================================================================

/// Test that admin can list users with pagination
/// GET /api/admin/users
/// Requires admin role
#[tokio::test]
async fn test_list_users_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create some additional users for the list
    for i in 0..3 {
        let user = TestUser::new(&unique_email(&format!("list_user_{}", i)));
        user.insert_with_profile(app.db(), &format!("User{}", i), "Test")
            .await
            .expect("Failed to insert test user");
    }

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Act - Get users list
    let response = client.get("/api/admin/users").await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");

    // Verify success response structure
    assert_eq!(
        body.get("success"),
        Some(&json!(true)),
        "Response should indicate success"
    );

    // Verify data is an array
    let data = body.get("data").expect("Response should have data field");
    assert!(data.is_array(), "Data should be an array");

    // Verify pagination metadata exists
    let pagination = body
        .get("pagination")
        .expect("Response should have pagination");
    assert!(
        pagination.get("page").is_some(),
        "Pagination should have page"
    );
    assert!(
        pagination.get("limit").is_some(),
        "Pagination should have limit"
    );
    assert!(
        pagination.get("total").is_some(),
        "Pagination should have total"
    );
    assert!(
        pagination.get("pages").is_some(),
        "Pagination should have pages"
    );

    // Should have at least 4 users (admin + 3 created)
    let total = pagination
        .get("total")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    assert!(total >= 4, "Should have at least 4 users, got {}", total);

    app.cleanup().await.ok();
}

/// Test pagination parameters
/// GET /api/admin/users?page=1&limit=2
#[tokio::test]
async fn test_list_users_pagination() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create 5 additional users
    for i in 0..5 {
        let user = TestUser::new(&unique_email(&format!("page_user_{}", i)));
        user.insert(app.db())
            .await
            .expect("Failed to insert test user");
    }

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Request page 1 with limit 2
    let response = client.get("/api/admin/users?page=1&limit=2").await;

    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    let data = body.get("data").and_then(|v| v.as_array()).unwrap();
    let pagination = body.get("pagination").unwrap();

    // Should return exactly 2 items
    assert_eq!(data.len(), 2, "Should return 2 items per page");

    // Pagination should reflect the limit
    assert_eq!(pagination.get("page"), Some(&json!(1)));
    assert_eq!(pagination.get("limit"), Some(&json!(2)));

    app.cleanup().await.ok();
}

// ============================================================================
// Authorization Tests
// ============================================================================

/// Test that regular user cannot access admin endpoints
/// GET /api/admin/users with non-admin user
/// Should return 403 Forbidden
#[tokio::test]
async fn test_list_users_non_admin_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    // Create a regular (non-admin) user
    let user = create_regular_user(app.db()).await;

    let client = app.authenticated_client(&user.id, &user.email);

    // Act - Try to access admin endpoint
    let response = client.get("/api/admin/users").await;

    // Assert - Should be forbidden
    response.assert_status(403);

    let body: Value = response.json().expect("Response should be valid JSON");

    // Verify error message indicates permission issue
    let error_message = body
        .get("error")
        .or_else(|| body.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    assert!(
        error_message.to_lowercase().contains("admin")
            || error_message.to_lowercase().contains("forbidden")
            || error_message.to_lowercase().contains("permission"),
        "Error should indicate admin access required: {}",
        error_message
    );

    app.cleanup().await.ok();
}

/// Test that unauthenticated requests are rejected
/// GET /api/admin/users without auth token
/// Should return 401 Unauthorized
#[tokio::test]
async fn test_list_users_unauthenticated_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    // Act - Try to access without auth token
    let response = client.get("/api/admin/users").await;

    // Assert - Should be unauthorized
    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Get User Tests
// ============================================================================

/// Test that admin can get a specific user by ID
/// GET /api/admin/users/:id
#[tokio::test]
async fn test_get_user_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create a target user to retrieve
    let target_user = TestUser::new(&unique_email("target"));
    target_user
        .insert_with_profile(app.db(), "Target", "User")
        .await
        .expect("Failed to insert target user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Act - Get specific user
    let response = client
        .get(&format!("/api/admin/users/{}", target_user.id))
        .await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(body.get("success"), Some(&json!(true)));

    let data = body.get("data").expect("Response should have data");

    // Verify user details
    assert_eq!(
        data.get("id").and_then(|v| v.as_str()),
        Some(target_user.id.to_string()).as_deref(),
        "User ID should match"
    );
    assert_eq!(
        data.get("email").and_then(|v| v.as_str()),
        Some(target_user.email.as_str()),
        "User email should match"
    );
    assert!(data.get("role").is_some(), "Response should include role");
    assert!(
        data.get("is_active").is_some(),
        "Response should include is_active"
    );
    assert!(
        data.get("created_at").is_some(),
        "Response should include created_at"
    );

    app.cleanup().await.ok();
}

/// Test getting a non-existent user returns 404
/// GET /api/admin/users/:id with invalid ID
#[tokio::test]
async fn test_get_user_not_found() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Act - Get non-existent user
    let fake_id = Uuid::new_v4();
    let response = client.get(&format!("/api/admin/users/{}", fake_id)).await;

    // Assert - Should be not found
    response.assert_status(404);

    app.cleanup().await.ok();
}

// ============================================================================
// Update User Tests
// ============================================================================

/// Test that admin can update a user
/// PUT /api/admin/users/:id
#[tokio::test]
async fn test_update_user_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create a target user to update
    let target_user = TestUser::new(&unique_email("update_target"));
    target_user
        .insert_with_profile(app.db(), "Original", "Name")
        .await
        .expect("Failed to insert target user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Prepare update payload
    let update_payload = json!({
        "is_active": false
    });

    // Act - Update user
    let response = client
        .put(
            &format!("/api/admin/users/{}", target_user.id),
            &update_payload,
        )
        .await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(body.get("success"), Some(&json!(true)));

    let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        message.to_lowercase().contains("updated") || message.to_lowercase().contains("success"),
        "Should indicate successful update: {}",
        message
    );

    // Verify the updated data is returned
    let data = body.get("data").expect("Response should have data");
    assert_eq!(
        data.get("is_active"),
        Some(&json!(false)),
        "is_active should be updated to false"
    );

    app.cleanup().await.ok();
}

/// Test updating user email
/// PUT /api/admin/users/:id with email change
#[tokio::test]
async fn test_update_user_email() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    let target_user = TestUser::new(&unique_email("email_update"));
    target_user
        .insert(app.db())
        .await
        .expect("Failed to insert target user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let new_email = unique_email("new_email");
    let update_payload = json!({
        "email": new_email
    });

    // Act
    let response = client
        .put(
            &format!("/api/admin/users/{}", target_user.id),
            &update_payload,
        )
        .await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    let data = body.get("data").unwrap();

    assert_eq!(
        data.get("email").and_then(|v| v.as_str()),
        Some(new_email.as_str()),
        "Email should be updated"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Dashboard Stats Tests
// ============================================================================

/// Test that admin can get dashboard statistics
/// GET /api/admin/stats
#[tokio::test]
async fn test_get_stats() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create some users for stats
    for i in 0..3 {
        let user = TestUser::new(&unique_email(&format!("stats_user_{}", i)));
        user.insert(app.db())
            .await
            .expect("Failed to insert test user");
    }

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Act - Get stats
    let response = client.get("/api/admin/stats").await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(body.get("success"), Some(&json!(true)));

    let data = body.get("data").expect("Response should have data");

    // Verify stats fields exist
    assert!(
        data.get("total_users").is_some(),
        "Stats should include total_users"
    );
    assert!(
        data.get("active_users").is_some(),
        "Stats should include active_users"
    );
    assert!(
        data.get("new_users_today").is_some(),
        "Stats should include new_users_today"
    );
    assert!(
        data.get("new_users_this_week").is_some(),
        "Stats should include new_users_this_week"
    );
    assert!(
        data.get("new_users_this_month").is_some(),
        "Stats should include new_users_this_month"
    );
    assert!(
        data.get("users_by_tier").is_some(),
        "Stats should include users_by_tier"
    );
    assert!(
        data.get("users_by_role").is_some(),
        "Stats should include users_by_role"
    );

    // Verify total_users is at least 4 (admin + 3 created)
    let total_users = data
        .get("total_users")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    assert!(
        total_users >= 4,
        "Total users should be at least 4, got {}",
        total_users
    );

    app.cleanup().await.ok();
}

/// Test that non-admin cannot access stats
/// GET /api/admin/stats with regular user
#[tokio::test]
async fn test_get_stats_non_admin_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_regular_user(app.db()).await;

    let client = app.authenticated_client(&user.id, &user.email);

    // Act
    let response = client.get("/api/admin/stats").await;

    // Assert - Should be forbidden
    response.assert_status(403);

    app.cleanup().await.ok();
}

// ============================================================================
// Broadcast Notification Tests
// ============================================================================

/// Test that admin can broadcast a notification
/// POST /api/admin/notifications/broadcast
#[tokio::test]
async fn test_broadcast_notification() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create some users to receive the notification
    let mut user_ids = Vec::new();
    for i in 0..3 {
        let user = TestUser::new(&unique_email(&format!("broadcast_user_{}", i)));
        user.insert(app.db())
            .await
            .expect("Failed to insert test user");
        user_ids.push(user.id);
    }

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Prepare broadcast payload
    let broadcast_payload = json!({
        "title": "Test Broadcast",
        "message": "This is a test broadcast notification to all users.",
        "notification_type": "info",
        "active_only": true
    });

    // Act - Send broadcast
    let response = client
        .post("/api/admin/notifications/broadcast", &broadcast_payload)
        .await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(body.get("success"), Some(&json!(true)));

    // Verify broadcast message
    let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        message.to_lowercase().contains("broadcast") || message.to_lowercase().contains("sent"),
        "Message should indicate broadcast sent: {}",
        message
    );

    // Verify notifications_sent count
    let notifications_sent = body
        .get("notifications_sent")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    assert!(
        notifications_sent >= 1,
        "Should have sent at least 1 notification, got {}",
        notifications_sent
    );

    app.cleanup().await.ok();
}

/// Test broadcast with title validation
/// POST /api/admin/notifications/broadcast with empty title
#[tokio::test]
async fn test_broadcast_notification_validation() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Prepare invalid payload (empty title)
    let invalid_payload = json!({
        "title": "",
        "message": "This should fail validation"
    });

    // Act
    let response = client
        .post("/api/admin/notifications/broadcast", &invalid_payload)
        .await;

    // Assert - Should fail validation
    assert!(
        response.status == 400 || response.status == 422,
        "Should return 400 or 422 for validation error, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

/// Test that non-admin cannot broadcast notifications
/// POST /api/admin/notifications/broadcast with regular user
#[tokio::test]
async fn test_broadcast_notification_non_admin_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = create_regular_user(app.db()).await;

    let client = app.authenticated_client(&user.id, &user.email);

    let broadcast_payload = json!({
        "title": "Unauthorized Broadcast",
        "message": "This should fail"
    });

    // Act
    let response = client
        .post("/api/admin/notifications/broadcast", &broadcast_payload)
        .await;

    // Assert - Should be forbidden
    response.assert_status(403);

    app.cleanup().await.ok();
}

// ============================================================================
// Search Tests
// ============================================================================

/// Test searching users by email
/// GET /api/admin/users?search=...
#[tokio::test]
async fn test_list_users_search() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = create_admin_user(app.db()).await;

    // Create a user with a unique searchable email
    let search_term = "uniquesearchterm";
    let searchable_user = TestUser::new(&format!("{}@example.com", search_term));
    searchable_user
        .insert_with_profile(app.db(), "Searchable", "User")
        .await
        .expect("Failed to insert searchable user");

    // Create some other users
    for i in 0..2 {
        let user = TestUser::new(&unique_email(&format!("other_{}", i)));
        user.insert(app.db())
            .await
            .expect("Failed to insert test user");
    }

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Act - Search for the specific user
    let response = client
        .get(&format!("/api/admin/users?search={}", search_term))
        .await;

    // Assert
    response.assert_status(200);

    let body: Value = response.json().expect("Response should be valid JSON");
    let data = body.get("data").and_then(|v| v.as_array()).unwrap();

    // Should find the searchable user
    let found = data.iter().any(|user| {
        user.get("email")
            .and_then(|e| e.as_str())
            .map(|e| e.contains(search_term))
            .unwrap_or(false)
    });

    assert!(found, "Should find user with search term in email");

    app.cleanup().await.ok();
}
