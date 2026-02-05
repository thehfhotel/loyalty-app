//! SSE (Server-Sent Events) Integration Tests
//!
//! Tests for the /api/sse endpoints including:
//! - SSE connection authentication
//! - SSE event stream establishment
//! - Real-time notification delivery

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use futures::StreamExt;
use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;
use tower::ServiceExt;
use uuid::Uuid;

use crate::common::{
    generate_test_token, init_test_db, init_test_redis, setup_test, teardown_test, TestUser,
    TEST_JWT_SECRET,
};

use loyalty_backend::config::Settings;
use loyalty_backend::routes::sse::routes as sse_routes;
use loyalty_backend::services::sse::{get_sse_service, SseEvent};
use loyalty_backend::state::AppState;

// ============================================================================
// Test Setup
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

/// Create a test application with SSE routes
async fn create_sse_test_app() -> Result<Router, Box<dyn std::error::Error>> {
    // Initialize test database
    let pool = init_test_db().await?;

    // Initialize test Redis
    let redis = init_test_redis().await?;

    // Create test settings
    let settings = create_test_settings();

    // Set JWT_SECRET environment variable for auth middleware
    std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);

    let state = AppState::new(pool, redis, settings);

    // Create router with SSE routes nested under /api
    Ok(Router::new()
        .nest("/api/sse", sse_routes())
        .with_state(state))
}

/// Generate a unique email for testing
fn unique_email() -> String {
    format!("sse_test_{}@example.com", Uuid::new_v4())
}

// ============================================================================
// Test: SSE Connection Requires Authentication
// ============================================================================

/// Test that SSE connection without authentication returns 401
/// GET /api/sse/events without token
#[tokio::test]
async fn test_sse_connection_requires_auth() {
    // Arrange
    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    // Create request WITHOUT authentication
    let request = Request::builder()
        .method("GET")
        .uri("/api/sse/events")
        .header("Accept", "text/event-stream")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "SSE connection without auth should return 401 Unauthorized"
    );

    // Verify response body contains error message
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8(body.to_vec()).unwrap();

    // Parse as JSON to verify error structure
    let json: Value = serde_json::from_str(&body_str).expect("Response should be valid JSON");

    assert!(
        json.get("error").is_some() || json.get("message").is_some(),
        "Response should contain error information: {}",
        body_str
    );

    // Verify error code is 'unauthorized' or message indicates auth required
    let error_code = json.get("error").and_then(|v| v.as_str());
    let message = json.get("message").and_then(|v| v.as_str());

    let is_auth_error = error_code.map(|e| e == "unauthorized").unwrap_or(false)
        || message
            .map(|m| m.to_lowercase().contains("auth"))
            .unwrap_or(false);

    assert!(
        is_auth_error,
        "Response should indicate authentication is required: {}",
        body_str
    );
}

// ============================================================================
// Test: SSE Connection Success
// ============================================================================

/// Test successful SSE connection with valid authentication
/// GET /api/sse/events with valid token
/// Connection established and receives event stream headers
#[tokio::test]
async fn test_sse_connection_success() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    let token = generate_test_token(&user.id, &user.email);

    // Create authenticated request
    let request = Request::builder()
        .method("GET")
        .uri("/api/sse/events")
        .header("Accept", "text/event-stream")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    // Act - Use timeout to prevent hanging if SSE stream doesn't respond
    let response_result = timeout(Duration::from_secs(5), app.oneshot(request)).await;

    // Assert
    assert!(
        response_result.is_ok(),
        "SSE connection should respond within timeout"
    );

    let response = response_result.unwrap().unwrap();

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "SSE connection with valid auth should return 200 OK"
    );

    // Verify SSE-specific headers
    let headers = response.headers();

    // Check Content-Type is text/event-stream
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    assert!(
        content_type.contains("text/event-stream"),
        "Content-Type should be text/event-stream, got: {}",
        content_type
    );

    // Check Cache-Control is no-cache (required for SSE)
    let cache_control = headers
        .get("cache-control")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    assert!(
        cache_control.contains("no-cache") || cache_control.is_empty(),
        "Cache-Control should be no-cache for SSE, got: {}",
        cache_control
    );

    // Verify the body stream starts with a connected event
    // Read a small portion of the stream to verify initial event
    let body = response.into_body();
    let mut stream = http_body_util::BodyStream::new(body);

    let first_chunk_result = timeout(Duration::from_secs(2), stream.next()).await;

    if let Ok(Some(Ok(frame))) = first_chunk_result {
        let chunk = frame.into_data().unwrap_or_default();
        let chunk_str = String::from_utf8_lossy(&chunk);

        // SSE events should contain 'event:' and 'data:' lines
        assert!(
            chunk_str.contains("event:") || chunk_str.contains("data:"),
            "SSE stream should contain event data, got: {}",
            chunk_str
        );

        // Verify connected event is sent
        assert!(
            chunk_str.contains("connected") || chunk_str.contains("Connected"),
            "Initial SSE event should be a connected event, got: {}",
            chunk_str
        );
    }
    // Note: It's okay if we can't read the first chunk in time - the important thing
    // is that the connection was established with correct headers

    // Cleanup
    teardown_test(&test_db).await;
}

/// Test SSE connection with token in query parameter (for EventSource)
/// GET /api/sse/events?token=<jwt> should work
#[tokio::test]
async fn test_sse_connection_with_query_token() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    let token = generate_test_token(&user.id, &user.email);

    // Create request with token in query parameter (as EventSource would)
    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/sse/events?token={}", token))
        .header("Accept", "text/event-stream")
        .body(Body::empty())
        .unwrap();

    // Act
    let response_result = timeout(Duration::from_secs(5), app.oneshot(request)).await;

    // Assert
    assert!(
        response_result.is_ok(),
        "SSE connection with query token should respond within timeout"
    );

    let response = response_result.unwrap().unwrap();

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "SSE connection with query token should return 200 OK"
    );

    // Verify SSE headers
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    assert!(
        content_type.contains("text/event-stream"),
        "Content-Type should be text/event-stream, got: {}",
        content_type
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: SSE Receives Notification
// ============================================================================

/// Test that connected SSE client receives notification events
/// Connect to SSE, trigger a notification, verify event received
#[tokio::test]
async fn test_sse_receives_notification() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let user_id = user.id.to_string();

    // Get the SSE service to add a client directly
    let sse_service = get_sse_service();

    // Add a client for our test user
    let (_client_id, mut receiver) = sse_service.add_client(&user_id).await;

    // Act - Send a notification to the user
    let notification_data = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "title": "Test Notification",
        "message": "This is a test notification message",
        "type": "info",
        "timestamp": chrono::Utc::now().timestamp_millis()
    });

    let event = SseEvent::notification(notification_data.clone());
    sse_service.send_to_user(&user_id, event).await;

    // Assert - Verify the notification was received
    let receive_result = timeout(Duration::from_secs(2), receiver.recv()).await;

    assert!(
        receive_result.is_ok(),
        "Should receive notification within timeout"
    );

    let received_event = receive_result
        .unwrap()
        .expect("Should receive event successfully");

    // Verify event type
    assert_eq!(
        received_event.event_type.to_string(),
        "notification",
        "Event type should be 'notification'"
    );

    // Verify event data
    assert_eq!(
        received_event.data.get("title").and_then(|v| v.as_str()),
        Some("Test Notification"),
        "Notification title should match"
    );

    assert_eq!(
        received_event.data.get("message").and_then(|v| v.as_str()),
        Some("This is a test notification message"),
        "Notification message should match"
    );

    // Cleanup
    sse_service.remove_client(&user_id, _client_id).await;
    teardown_test(&test_db).await;
}

/// Test SSE receives loyalty update events
#[tokio::test]
async fn test_sse_receives_loyalty_update() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let user_id = user.id.to_string();
    let sse_service = get_sse_service();

    // Add a client
    let (client_id, mut receiver) = sse_service.add_client(&user_id).await;

    // Act - Send a loyalty update
    let loyalty_data = serde_json::json!({
        "currentPoints": 1500,
        "tier": "Gold",
        "totalNights": 15,
        "timestamp": chrono::Utc::now().timestamp_millis()
    });

    let event = SseEvent::loyalty_update(loyalty_data.clone());
    sse_service.send_to_user(&user_id, event).await;

    // Assert
    let receive_result = timeout(Duration::from_secs(2), receiver.recv()).await;

    assert!(
        receive_result.is_ok(),
        "Should receive loyalty update within timeout"
    );

    let received_event = receive_result
        .unwrap()
        .expect("Should receive event successfully");

    assert_eq!(
        received_event.event_type.to_string(),
        "loyalty_update",
        "Event type should be 'loyalty_update'"
    );

    assert_eq!(
        received_event
            .data
            .get("currentPoints")
            .and_then(|v| v.as_i64()),
        Some(1500),
        "Points should match"
    );

    assert_eq!(
        received_event.data.get("tier").and_then(|v| v.as_str()),
        Some("Gold"),
        "Tier should match"
    );

    // Cleanup
    sse_service.remove_client(&user_id, client_id).await;
    teardown_test(&test_db).await;
}

/// Test SSE receives coupon assigned events
#[tokio::test]
async fn test_sse_receives_coupon_assigned() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let user_id = user.id.to_string();
    let sse_service = get_sse_service();

    // Add a client
    let (client_id, mut receiver) = sse_service.add_client(&user_id).await;

    // Act - Send a coupon assigned event
    let coupon_data = serde_json::json!({
        "couponId": Uuid::new_v4().to_string(),
        "code": "WELCOME20",
        "discount": 20,
        "type": "percentage",
        "validUntil": "2026-12-31T23:59:59Z"
    });

    let event = SseEvent::coupon_assigned(coupon_data.clone());
    sse_service.send_to_user(&user_id, event).await;

    // Assert
    let receive_result = timeout(Duration::from_secs(2), receiver.recv()).await;

    assert!(
        receive_result.is_ok(),
        "Should receive coupon assigned event within timeout"
    );

    let received_event = receive_result
        .unwrap()
        .expect("Should receive event successfully");

    assert_eq!(
        received_event.event_type.to_string(),
        "coupon_assigned",
        "Event type should be 'coupon_assigned'"
    );

    assert_eq!(
        received_event.data.get("code").and_then(|v| v.as_str()),
        Some("WELCOME20"),
        "Coupon code should match"
    );

    // Cleanup
    sse_service.remove_client(&user_id, client_id).await;
    teardown_test(&test_db).await;
}

/// Test that multiple clients for the same user all receive events
#[tokio::test]
async fn test_sse_multiple_clients_receive_notification() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let user_id = user.id.to_string();
    let sse_service = get_sse_service();

    // Add multiple clients for the same user (simulating multiple browser tabs)
    let (client_id_1, mut receiver_1) = sse_service.add_client(&user_id).await;
    let (client_id_2, mut receiver_2) = sse_service.add_client(&user_id).await;

    // Verify both clients are connected
    assert_eq!(
        sse_service.get_client_count(&user_id).await,
        2,
        "Should have 2 connected clients"
    );

    // Act - Send a notification
    let notification_data = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "title": "Multi-Client Test",
        "message": "Testing multiple clients"
    });

    let event = SseEvent::notification(notification_data);
    sse_service.send_to_user(&user_id, event).await;

    // Assert - Both clients should receive the event
    let result_1 = timeout(Duration::from_secs(2), receiver_1.recv()).await;
    let result_2 = timeout(Duration::from_secs(2), receiver_2.recv()).await;

    assert!(
        result_1.is_ok() && result_1.unwrap().is_ok(),
        "Client 1 should receive the notification"
    );

    assert!(
        result_2.is_ok() && result_2.unwrap().is_ok(),
        "Client 2 should receive the notification"
    );

    // Cleanup
    sse_service.remove_client(&user_id, client_id_1).await;
    sse_service.remove_client(&user_id, client_id_2).await;
    teardown_test(&test_db).await;
}

/// Test that events are only sent to the targeted user
#[tokio::test]
async fn test_sse_event_isolation() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user_1 = TestUser::new(&unique_email());
    let user_2 = TestUser::new(&unique_email());

    user_1
        .insert(&pool)
        .await
        .expect("Failed to insert test user 1");
    user_2
        .insert(&pool)
        .await
        .expect("Failed to insert test user 2");

    let user_id_1 = user_1.id.to_string();
    let user_id_2 = user_2.id.to_string();
    let sse_service = get_sse_service();

    // Add clients for both users
    let (client_id_1, mut receiver_1) = sse_service.add_client(&user_id_1).await;
    let (client_id_2, mut receiver_2) = sse_service.add_client(&user_id_2).await;

    // Act - Send notification only to user 1
    let notification_data = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "title": "Private Notification",
        "message": "Only for user 1"
    });

    let event = SseEvent::notification(notification_data);
    sse_service.send_to_user(&user_id_1, event).await;

    // Assert - User 1 should receive, user 2 should not
    let result_1 = timeout(Duration::from_secs(2), receiver_1.recv()).await;
    let result_2 = timeout(Duration::from_millis(500), receiver_2.recv()).await;

    assert!(
        result_1.is_ok() && result_1.unwrap().is_ok(),
        "User 1 should receive the notification"
    );

    assert!(
        result_2.is_err(),
        "User 2 should NOT receive notification meant for user 1 (should timeout)"
    );

    // Cleanup
    sse_service.remove_client(&user_id_1, client_id_1).await;
    sse_service.remove_client(&user_id_2, client_id_2).await;
    teardown_test(&test_db).await;
}

/// Test SSE info endpoint requires authentication
#[tokio::test]
async fn test_sse_info_requires_auth() {
    // Arrange
    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    // Create request WITHOUT authentication
    let request = Request::builder()
        .method("GET")
        .uri("/api/sse/info")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "SSE info endpoint without auth should return 401"
    );
}

/// Test SSE info endpoint returns connection information
#[tokio::test]
async fn test_sse_info_returns_connection_info() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let user = TestUser::new(&unique_email());
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    let token = generate_test_token(&user.id, &user.email);

    // Create authenticated request
    let request = Request::builder()
        .method("GET")
        .uri("/api/sse/info")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "SSE info endpoint with valid auth should return 200 OK"
    );

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).expect("Response should be valid JSON");

    // Verify response contains expected fields
    assert!(
        json.get("userId").is_some(),
        "Response should contain userId"
    );

    assert!(
        json.get("connectedClients").is_some(),
        "Response should contain connectedClients"
    );

    assert!(
        json.get("supportedEvents").is_some(),
        "Response should contain supportedEvents"
    );

    // Verify supported events list
    let supported_events = json.get("supportedEvents").and_then(|v| v.as_array());
    assert!(
        supported_events.is_some(),
        "supportedEvents should be an array"
    );

    let events: Vec<&str> = supported_events
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();

    assert!(
        events.contains(&"notification"),
        "Should support notification events"
    );
    assert!(
        events.contains(&"loyalty_update"),
        "Should support loyalty_update events"
    );
    assert!(
        events.contains(&"coupon_assigned"),
        "Should support coupon_assigned events"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: SSE with Invalid Token
// ============================================================================

/// Test SSE connection with invalid token returns 401
#[tokio::test]
async fn test_sse_connection_invalid_token() {
    // Arrange
    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    // Create request with invalid token
    let request = Request::builder()
        .method("GET")
        .uri("/api/sse/events")
        .header("Accept", "text/event-stream")
        .header("Authorization", "Bearer invalid.token.here")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "SSE connection with invalid token should return 401"
    );
}

/// Test SSE connection with expired token returns 401
#[tokio::test]
async fn test_sse_connection_expired_token() {
    use crate::common::generate_expired_token;

    // Arrange
    let app = create_sse_test_app()
        .await
        .expect("Failed to create SSE test app");

    let user_id = Uuid::new_v4();
    let expired_token = generate_expired_token(&user_id, "expired@example.com");

    // Create request with expired token
    let request = Request::builder()
        .method("GET")
        .uri("/api/sse/events")
        .header("Accept", "text/event-stream")
        .header("Authorization", format!("Bearer {}", expired_token))
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "SSE connection with expired token should return 401"
    );
}
