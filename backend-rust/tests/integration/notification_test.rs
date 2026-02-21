//! Notification endpoint integration tests
//!
//! Tests for the /api/notifications endpoints including:
//! - Listing notifications with pagination
//! - Getting unread count
//! - Marking notifications as read (single and all)
//! - Deleting notifications

use chrono::{Duration, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Test Setup
// ============================================================================

/// Test notification fixture data
#[derive(Debug, Clone)]
pub struct TestNotification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    pub notification_type: String,
    pub read_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl TestNotification {
    /// Create a new unread notification fixture
    pub fn new(user_id: Uuid, title: &str, message: &str) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            title: title.to_string(),
            message: message.to_string(),
            notification_type: "info".to_string(),
            read_at: None,
            expires_at: None,
        }
    }

    /// Create a read notification fixture
    pub fn read(user_id: Uuid, title: &str, message: &str) -> Self {
        let mut notification = Self::new(user_id, title, message);
        notification.read_at = Some(Utc::now());
        notification
    }

    /// Create an expired notification fixture
    pub fn expired(user_id: Uuid, title: &str, message: &str) -> Self {
        let mut notification = Self::new(user_id, title, message);
        notification.expires_at = Some(Utc::now() - Duration::days(1));
        notification
    }

    /// Insert this notification into the database
    pub async fn insert(&self, pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO notifications (id, user_id, title, message, type, read_at, expires_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            "#,
        )
        .bind(self.id)
        .bind(self.user_id)
        .bind(&self.title)
        .bind(&self.message)
        .bind(&self.notification_type)
        .bind(self.read_at)
        .bind(self.expires_at)
        .execute(pool)
        .await?;

        Ok(())
    }
}

// ============================================================================
// List Notifications Tests
// ============================================================================

#[tokio::test]
async fn test_list_notifications() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("notification-list-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let notification1 = TestNotification::new(user.id, "Test Title 1", "Test message 1");
    let notification2 = TestNotification::new(user.id, "Test Title 2", "Test message 2");
    let notification3 = TestNotification::read(user.id, "Read Title", "Read message");

    notification1
        .insert(app.db())
        .await
        .expect("Failed to insert notification 1");
    notification2
        .insert(app.db())
        .await
        .expect("Failed to insert notification 2");
    notification3
        .insert(app.db())
        .await
        .expect("Failed to insert notification 3");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(
        json.get("notifications").is_some(),
        "Response should have 'notifications' field"
    );
    assert!(
        json.get("pagination").is_some(),
        "Response should have 'pagination' field"
    );

    let notifications = json.get("notifications").unwrap().as_array().unwrap();
    assert_eq!(notifications.len(), 3, "Should return all 3 notifications");

    let pagination = json.get("pagination").unwrap();
    assert_eq!(pagination.get("total").and_then(|v| v.as_i64()), Some(3));
    assert_eq!(pagination.get("page").and_then(|v| v.as_i64()), Some(1));

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_list_notifications_unread_only() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("notification-unread-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let unread1 = TestNotification::new(user.id, "Unread 1", "Message 1");
    let unread2 = TestNotification::new(user.id, "Unread 2", "Message 2");
    let read1 = TestNotification::read(user.id, "Read 1", "Read message");

    unread1.insert(app.db()).await.expect("Failed to insert");
    unread2.insert(app.db()).await.expect("Failed to insert");
    read1.insert(app.db()).await.expect("Failed to insert");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications?unread_only=true").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let notifications = json.get("notifications").unwrap().as_array().unwrap();

    assert_eq!(
        notifications.len(),
        2,
        "Should return only unread notifications"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_list_notifications_requires_auth() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();
    let response = client.get("/api/notifications").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_list_notifications_pagination() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("notification-pagination@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    for i in 0..25 {
        let notification =
            TestNotification::new(user.id, &format!("Title {}", i), &format!("Message {}", i));
        notification
            .insert(app.db())
            .await
            .expect("Failed to insert");
    }

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications?page=2&limit=10").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let notifications = json.get("notifications").unwrap().as_array().unwrap();
    let pagination = json.get("pagination").unwrap();

    assert_eq!(notifications.len(), 10, "Should return 10 notifications");
    assert_eq!(pagination.get("page").and_then(|v| v.as_i64()), Some(2));
    assert_eq!(pagination.get("limit").and_then(|v| v.as_i64()), Some(10));
    assert_eq!(pagination.get("total").and_then(|v| v.as_i64()), Some(25));
    assert_eq!(pagination.get("pages").and_then(|v| v.as_i64()), Some(3));

    app.cleanup().await.ok();
}

// ============================================================================
// Unread Count Tests
// ============================================================================

#[tokio::test]
async fn test_get_unread_count() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("unread-count-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    // Create 3 unread and 2 read notifications
    for i in 0..3 {
        let notification = TestNotification::new(user.id, &format!("Unread {}", i), "Message");
        notification
            .insert(app.db())
            .await
            .expect("Failed to insert");
    }
    for i in 0..2 {
        let notification = TestNotification::read(user.id, &format!("Read {}", i), "Message");
        notification
            .insert(app.db())
            .await
            .expect("Failed to insert");
    }

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications/unread-count").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    assert!(
        json.get("data").is_some(),
        "Response should have 'data' field"
    );

    let data = json.get("data").unwrap();
    assert_eq!(
        data.get("unreadCount").and_then(|v| v.as_i64()),
        Some(3),
        "Should have 3 unread notifications"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_unread_count_requires_auth() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();
    let response = client.get("/api/notifications/unread-count").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_unread_count_zero() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("unread-zero-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications/unread-count").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").unwrap();
    assert_eq!(
        data.get("unreadCount").and_then(|v| v.as_i64()),
        Some(0),
        "Should have 0 unread notifications"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Mark Notification Read Tests
// ============================================================================

#[tokio::test]
async fn test_mark_notification_read() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("mark-read-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let notification = TestNotification::new(user.id, "Test Title", "Test message");
    notification
        .insert(app.db())
        .await
        .expect("Failed to insert notification");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .put(
            &format!("/api/notifications/{}/read", notification.id),
            &serde_json::json!({}),
        )
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    assert!(
        json.get("notification").is_some(),
        "Response should have 'notification' field"
    );

    let returned_notification = json.get("notification").unwrap();
    assert_eq!(
        returned_notification.get("id").and_then(|v| v.as_str()),
        Some(notification.id.to_string().as_str())
    );
    assert!(
        returned_notification.get("readAt").is_some(),
        "Notification should have readAt set"
    );
    assert_eq!(
        returned_notification
            .get("isRead")
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    // Verify in database
    let db_notification: (Option<chrono::DateTime<chrono::Utc>>,) =
        sqlx::query_as("SELECT read_at FROM notifications WHERE id = $1")
            .bind(notification.id)
            .fetch_one(app.db())
            .await
            .expect("Failed to fetch notification");

    assert!(
        db_notification.0.is_some(),
        "Database should have read_at set"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_mark_notification_read_not_found() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("mark-read-notfound@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let client = app.authenticated_client(&user.id, &user.email);
    let non_existent_id = Uuid::new_v4();

    let response = client
        .put(
            &format!("/api/notifications/{}/read", non_existent_id),
            &serde_json::json!({}),
        )
        .await;

    response.assert_status(404);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_mark_notification_read_other_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user1 = TestUser::new("mark-read-user1@example.com");
    let user2 = TestUser::new("mark-read-user2@example.com");
    user1
        .insert(app.db())
        .await
        .expect("Failed to insert user1");
    user2
        .insert(app.db())
        .await
        .expect("Failed to insert user2");

    // Create notification for user1
    let notification = TestNotification::new(user1.id, "User1 Notification", "Message");
    notification
        .insert(app.db())
        .await
        .expect("Failed to insert notification");

    // Try to mark as read with user2's token
    let client = app.authenticated_client(&user2.id, &user2.email);
    let response = client
        .put(
            &format!("/api/notifications/{}/read", notification.id),
            &serde_json::json!({}),
        )
        .await;

    // Should return 404 (notification not found for this user)
    response.assert_status(404);

    app.cleanup().await.ok();
}

// ============================================================================
// Mark All Read Tests
// ============================================================================

#[tokio::test]
async fn test_mark_all_read() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("mark-all-read-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    for i in 0..5 {
        let notification =
            TestNotification::new(user.id, &format!("Title {}", i), &format!("Message {}", i));
        notification
            .insert(app.db())
            .await
            .expect("Failed to insert notification");
    }

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .put("/api/notifications/read-all", &serde_json::json!({}))
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(
        json.get("markedRead").and_then(|v| v.as_i64()),
        Some(5),
        "Should have marked 5 notifications as read"
    );

    // Verify all are now read in database
    let unread_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL")
            .bind(user.id)
            .fetch_one(app.db())
            .await
            .expect("Failed to count unread");

    assert_eq!(
        unread_count.0, 0,
        "All notifications should be marked as read"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_mark_all_read_already_read() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("mark-all-already-read@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    for i in 0..3 {
        let notification = TestNotification::read(user.id, &format!("Read {}", i), "Message");
        notification
            .insert(app.db())
            .await
            .expect("Failed to insert notification");
    }

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .put("/api/notifications/read-all", &serde_json::json!({}))
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(
        json.get("markedRead").and_then(|v| v.as_i64()),
        Some(0),
        "Should have marked 0 notifications (all were already read)"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_mark_all_read_requires_auth() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();
    let response = client
        .put("/api/notifications/read-all", &serde_json::json!({}))
        .await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Delete Notification Tests
// ============================================================================

#[tokio::test]
async fn test_delete_notification() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("delete-notification-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let notification = TestNotification::new(user.id, "To Delete", "This will be deleted");
    notification
        .insert(app.db())
        .await
        .expect("Failed to insert notification");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client
        .delete(&format!("/api/notifications/{}", notification.id))
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(json.get("success").and_then(|v| v.as_bool()), Some(true));
    assert!(
        json.get("message").is_some(),
        "Response should have 'message' field"
    );

    // Verify deleted from database
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notifications WHERE id = $1")
        .bind(notification.id)
        .fetch_one(app.db())
        .await
        .expect("Failed to count");

    assert_eq!(count.0, 0, "Notification should be deleted from database");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_notification_not_found() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("delete-notfound@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let client = app.authenticated_client(&user.id, &user.email);
    let non_existent_id = Uuid::new_v4();

    let response = client
        .delete(&format!("/api/notifications/{}", non_existent_id))
        .await;

    response.assert_status(404);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_notification_other_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user1 = TestUser::new("delete-user1@example.com");
    let user2 = TestUser::new("delete-user2@example.com");
    user1
        .insert(app.db())
        .await
        .expect("Failed to insert user1");
    user2
        .insert(app.db())
        .await
        .expect("Failed to insert user2");

    // Create notification for user1
    let notification = TestNotification::new(user1.id, "User1 Notification", "Message");
    notification
        .insert(app.db())
        .await
        .expect("Failed to insert notification");

    // Try to delete with user2's token
    let client = app.authenticated_client(&user2.id, &user2.email);
    let response = client
        .delete(&format!("/api/notifications/{}", notification.id))
        .await;

    // Should return 404 (notification not found for this user)
    response.assert_status(404);

    // Verify notification still exists
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notifications WHERE id = $1")
        .bind(notification.id)
        .fetch_one(app.db())
        .await
        .expect("Failed to count");

    assert_eq!(count.0, 1, "Notification should still exist");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_notification_requires_auth() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();
    let some_id = Uuid::new_v4();

    let response = client
        .delete(&format!("/api/notifications/{}", some_id))
        .await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Edge Cases
// ============================================================================

#[tokio::test]
async fn test_list_notifications_excludes_expired() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("expired-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let valid_notification = TestNotification::new(user.id, "Valid", "This is valid");
    valid_notification
        .insert(app.db())
        .await
        .expect("Failed to insert");

    let expired_notification = TestNotification::expired(user.id, "Expired", "This is expired");
    expired_notification
        .insert(app.db())
        .await
        .expect("Failed to insert");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let notifications = json.get("notifications").unwrap().as_array().unwrap();

    assert_eq!(
        notifications.len(),
        1,
        "Should only return non-expired notifications"
    );
    assert_eq!(
        notifications[0].get("title").and_then(|v| v.as_str()),
        Some("Valid")
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_notification_response_structure() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("structure-test@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let notification = TestNotification::new(user.id, "Test Title", "Test message");
    notification
        .insert(app.db())
        .await
        .expect("Failed to insert");

    let client = app.authenticated_client(&user.id, &user.email);
    let response = client.get("/api/notifications").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let notifications = json.get("notifications").unwrap().as_array().unwrap();
    let first = &notifications[0];

    assert!(first.get("id").is_some(), "Should have 'id' field");
    assert!(first.get("userId").is_some(), "Should have 'userId' field");
    assert!(first.get("title").is_some(), "Should have 'title' field");
    assert!(
        first.get("message").is_some(),
        "Should have 'message' field"
    );
    assert!(first.get("type").is_some(), "Should have 'type' field");
    assert!(
        first.get("createdAt").is_some(),
        "Should have 'createdAt' field"
    );
    assert!(first.get("isRead").is_some(), "Should have 'isRead' field");

    assert_eq!(
        first.get("title").and_then(|v| v.as_str()),
        Some("Test Title")
    );
    assert_eq!(
        first.get("message").and_then(|v| v.as_str()),
        Some("Test message")
    );
    assert_eq!(first.get("isRead").and_then(|v| v.as_bool()), Some(false));

    app.cleanup().await.ok();
}
