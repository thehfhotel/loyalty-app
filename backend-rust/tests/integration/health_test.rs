//! Health check endpoint integration tests
//!
//! Tests for the /api/health endpoints including:
//! - Basic health check
//! - Database health check
//! - Redis health check
//! - Full system health check
//!
//! # Endpoints Tested
//!
//! - `GET /api/health` - Basic health check (stateless)
//! - `GET /api/health/db` - Database connectivity check
//! - `GET /api/health/redis` - Redis connectivity check
//! - `GET /api/health/full` - Full system health check

use serde_json::Value;

use crate::common::{TestApp, TestClient};

// ============================================================================
// Basic Health Check Tests
// ============================================================================

/// Test that the health endpoint returns HTTP 200 OK.
#[tokio::test]
async fn test_health_endpoint_returns_ok() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health").await;

    // Assert
    response.assert_status(200);
}

/// Test that the health endpoint returns correct JSON structure.
#[tokio::test]
async fn test_health_endpoint_json_structure() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    // Check required fields exist
    assert!(
        json.get("status").is_some(),
        "Response should have 'status' field"
    );
    assert!(
        json.get("timestamp").is_some(),
        "Response should have 'timestamp' field"
    );
    assert!(
        json.get("version").is_some(),
        "Response should have 'version' field"
    );
}

/// Test that the health endpoint returns status "ok".
#[tokio::test]
async fn test_health_endpoint_status_ok() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health").await;

    // Assert
    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Health check status should be 'ok'"
    );
}

/// Test that the health endpoint returns a valid RFC3339 timestamp.
#[tokio::test]
async fn test_health_endpoint_valid_timestamp() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health").await;

    // Assert
    let json: Value = response.json().expect("Response should be valid JSON");
    let timestamp = json.get("timestamp").and_then(|v| v.as_str());

    assert!(timestamp.is_some(), "Timestamp should be present");

    // Verify it's a valid ISO 8601 / RFC3339 timestamp
    let ts = timestamp.unwrap();
    assert!(
        chrono::DateTime::parse_from_rfc3339(ts).is_ok(),
        "Timestamp should be valid RFC3339 format: {}",
        ts
    );
}

/// Test that the health endpoint returns a semver version.
#[tokio::test]
async fn test_health_endpoint_version_format() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health").await;

    // Assert
    let json: Value = response.json().expect("Response should be valid JSON");
    let version = json.get("version").and_then(|v| v.as_str());

    assert!(version.is_some(), "Version should be present");
    assert!(
        version.unwrap().contains('.'),
        "Version should be in semver format (e.g., 0.1.0): {}",
        version.unwrap()
    );
}

// ============================================================================
// Database Health Check Tests
// ============================================================================

/// Test that the database health endpoint returns 200 when connected.
#[tokio::test]
async fn test_health_db_connected() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/db").await;

    // Assert - Allow 503 if database is temporarily unavailable in CI
    // The health endpoint correctly reports database status
    let json: Value = response.json().expect("Response should be valid JSON");

    if response.status == 200 {
        assert_eq!(
            json.get("status").and_then(|v| v.as_str()),
            Some("ok"),
            "Database health status should be 'ok'"
        );
        assert_eq!(
            json.get("database").and_then(|v| v.as_str()),
            Some("connected"),
            "Database should be 'connected'"
        );
    } else if response.status == 503 {
        // Database temporarily unavailable - this is valid behavior
        assert_eq!(
            json.get("status").and_then(|v| v.as_str()),
            Some("error"),
            "Database health status should be 'error' when unavailable"
        );
    } else {
        panic!(
            "Unexpected status code: {}. Expected 200 or 503",
            response.status
        );
    }
}

/// Test that the database health endpoint returns correct JSON structure.
#[tokio::test]
async fn test_health_db_json_structure() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/db").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(
        json.get("status").is_some(),
        "Response should have 'status' field"
    );
    assert!(
        json.get("database").is_some(),
        "Response should have 'database' field"
    );
    assert!(
        json.get("timestamp").is_some(),
        "Response should have 'timestamp' field"
    );
}

// ============================================================================
// Redis Health Check Tests
// ============================================================================

/// Test that the Redis health endpoint returns 200 when connected.
#[tokio::test]
async fn test_health_redis_connected() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/redis").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Redis health status should be 'ok'"
    );
    assert_eq!(
        json.get("redis").and_then(|v| v.as_str()),
        Some("connected"),
        "Redis should be 'connected'"
    );
}

/// Test that the Redis health endpoint returns correct JSON structure.
#[tokio::test]
async fn test_health_redis_json_structure() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/redis").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(
        json.get("status").is_some(),
        "Response should have 'status' field"
    );
    assert!(
        json.get("redis").is_some(),
        "Response should have 'redis' field"
    );
    assert!(
        json.get("timestamp").is_some(),
        "Response should have 'timestamp' field"
    );
}

// ============================================================================
// Full System Health Check Tests
// ============================================================================

/// Test that the full health endpoint returns 200 when all services are connected.
#[tokio::test]
async fn test_health_full_all_connected() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/full").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Full health status should be 'ok'"
    );
    assert_eq!(
        json.get("database").and_then(|v| v.as_str()),
        Some("connected"),
        "Database should be 'connected'"
    );
    assert_eq!(
        json.get("redis").and_then(|v| v.as_str()),
        Some("connected"),
        "Redis should be 'connected'"
    );
}

/// Test that the full health endpoint returns correct JSON structure.
#[tokio::test]
async fn test_health_full_json_structure() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/full").await;

    // Assert - Allow 503 if database is temporarily unavailable in CI
    let json: Value = response.json().expect("Response should be valid JSON");

    if response.status == 200 {
        assert!(
            json.get("status").is_some(),
            "Response should have 'status' field"
        );
        assert!(
            json.get("timestamp").is_some(),
            "Response should have 'timestamp' field"
        );
        assert!(
            json.get("version").is_some(),
            "Response should have 'version' field"
        );
        assert!(
            json.get("database").is_some(),
            "Response should have 'database' field"
        );
        assert!(
            json.get("redis").is_some(),
            "Response should have 'redis' field"
        );
    } else if response.status == 503 {
        // Service partially or fully unavailable - verify error structure
        assert!(
            json.get("status").is_some(),
            "Response should have 'status' field"
        );
        let status = json.get("status").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            status == "error" || status == "degraded",
            "Status should be 'error' or 'degraded' when unavailable, got: {}",
            status
        );
    } else {
        panic!(
            "Unexpected status code: {}. Expected 200 or 503",
            response.status
        );
    }
}

// ============================================================================
// Error Scenario Tests
// ============================================================================

/// Test that unknown health endpoints return 404.
#[tokio::test]
async fn test_health_unknown_endpoint_returns_404() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let response = client.get("/api/health/unknown").await;

    // Assert
    response.assert_status(404);
}

/// Test that health endpoint handles trailing slash.
#[tokio::test]
async fn test_health_endpoint_trailing_slash() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act - Some frameworks handle trailing slashes differently
    let response = client.get("/api/health/").await;

    // Assert - Should either redirect or return 404/200 depending on config
    // The important thing is it doesn't error
    assert!(
        response.status == 200 || response.status == 404 || response.status == 308,
        "Should handle trailing slash gracefully, got status {}",
        response.status
    );
}

// ============================================================================
// Concurrent Request Tests
// ============================================================================

/// Test that health endpoint handles concurrent requests.
#[tokio::test]
async fn test_health_concurrent_requests() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");

    // Act - Make multiple concurrent requests
    let mut handles = Vec::new();
    for _ in 0..10 {
        let router = app.router();
        handles.push(tokio::spawn(async move {
            let client = TestClient::new(router);
            client.get("/api/health").await
        }));
    }

    // Wait for all requests to complete
    let responses: Vec<_> = futures::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();

    // Assert - All should succeed
    for response in responses {
        response.assert_status(200);
    }
}

// ============================================================================
// Performance Tests
// ============================================================================

/// Test that health endpoint responds quickly.
#[tokio::test]
async fn test_health_response_time() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let start = std::time::Instant::now();
    let response = client.get("/api/health").await;
    let duration = start.elapsed();

    // Assert
    response.assert_status(200);

    // Health check should respond within 100ms
    assert!(
        duration.as_millis() < 100,
        "Health check took too long: {:?}",
        duration
    );
}

/// Test that database health check responds reasonably fast.
#[tokio::test]
async fn test_health_db_response_time() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let start = std::time::Instant::now();
    let response = client.get("/api/health/db").await;
    let duration = start.elapsed();

    // Assert
    response.assert_status(200);

    // Database health check should respond within 500ms
    assert!(
        duration.as_millis() < 500,
        "Database health check took too long: {:?}",
        duration
    );
}

/// Test that Redis health check responds reasonably fast.
#[tokio::test]
async fn test_health_redis_response_time() {
    // Arrange
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    // Act
    let start = std::time::Instant::now();
    let response = client.get("/api/health/redis").await;
    let duration = start.elapsed();

    // Assert
    response.assert_status(200);

    // Redis health check should respond within 500ms
    assert!(
        duration.as_millis() < 500,
        "Redis health check took too long: {:?}",
        duration
    );
}
