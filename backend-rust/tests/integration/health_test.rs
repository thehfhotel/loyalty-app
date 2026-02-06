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
//! - `GET /api/health` - Full system health check (database + redis + services)
//! - `GET /api/health/basic` - Basic health check (stateless)
//! - `GET /api/health/db` - Database connectivity check
//! - `GET /api/health/redis` - Redis connectivity check
//! - `GET /api/health/full` - Full system health check (alias)

use serde_json::Value;

use crate::common::{TestApp, TestClient};

// ============================================================================
// Basic Health Check Tests (/api/health/basic)
// ============================================================================

/// Test that the basic health endpoint returns HTTP 200 OK.
#[tokio::test]
async fn test_health_basic_returns_ok() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/basic").await;
    response.assert_status(200);
}

/// Test that the basic health endpoint returns correct JSON structure.
#[tokio::test]
async fn test_health_basic_json_structure() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/basic").await;
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

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

/// Test that the basic health endpoint returns status "ok".
#[tokio::test]
async fn test_health_basic_status_ok() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/basic").await;

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Basic health check status should be 'ok'"
    );
}

/// Test that the basic health endpoint returns a valid RFC3339 timestamp.
#[tokio::test]
async fn test_health_basic_valid_timestamp() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/basic").await;

    let json: Value = response.json().expect("Response should be valid JSON");
    let timestamp = json.get("timestamp").and_then(|v| v.as_str());

    assert!(timestamp.is_some(), "Timestamp should be present");

    let ts = timestamp.unwrap();
    assert!(
        chrono::DateTime::parse_from_rfc3339(ts).is_ok(),
        "Timestamp should be valid RFC3339 format: {}",
        ts
    );
}

/// Test that the basic health endpoint returns a semver version.
#[tokio::test]
async fn test_health_basic_version_format() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/basic").await;

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
// Full System Health Check Tests (/api/health)
// ============================================================================

/// Test that the full health endpoint returns 200 when all services are connected.
#[tokio::test]
async fn test_health_endpoint_returns_ok() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health").await;

    // Full health check returns 200 if DB + Redis are healthy, 503 otherwise
    let json: Value = response.json().expect("Response should be valid JSON");
    let status = json.get("status").and_then(|v| v.as_str()).unwrap_or("");

    assert!(
        response.status == 200 || response.status == 503,
        "Expected 200 or 503, got {}",
        response.status
    );

    if response.status == 200 {
        assert_eq!(status, "healthy", "Status should be 'healthy' on 200");
    } else {
        assert_eq!(status, "degraded", "Status should be 'degraded' on 503");
    }
}

/// Test that the full health endpoint returns correct JSON structure.
#[tokio::test]
async fn test_health_endpoint_json_structure() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health").await;

    let json: Value = response.json().expect("Response should be valid JSON");

    // Full health check structure
    assert!(json.get("status").is_some(), "Should have 'status' field");
    assert!(
        json.get("timestamp").is_some(),
        "Should have 'timestamp' field"
    );
    assert!(json.get("version").is_some(), "Should have 'version' field");
    assert!(
        json.get("environment").is_some(),
        "Should have 'environment' field"
    );
    assert!(
        json.get("services").is_some(),
        "Should have 'services' field"
    );
    assert!(json.get("uptime").is_some(), "Should have 'uptime' field");
    assert!(json.get("memory").is_some(), "Should have 'memory' field");
}

/// Test that the services field has expected sub-fields.
#[tokio::test]
async fn test_health_endpoint_services_structure() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health").await;

    let json: Value = response.json().expect("Response should be valid JSON");
    let services = json.get("services").expect("Should have 'services' field");

    assert!(
        services.get("database").is_some(),
        "Services should have 'database'"
    );
    assert!(
        services.get("redis").is_some(),
        "Services should have 'redis'"
    );
    assert!(
        services.get("storage").is_some(),
        "Services should have 'storage'"
    );
    assert!(
        services.get("email").is_some(),
        "Services should have 'email'"
    );
}

// ============================================================================
// Database Health Check Tests (/api/health/db)
// ============================================================================

/// Test that the database health endpoint returns 200 when connected.
#[tokio::test]
async fn test_health_db_connected() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/db").await;

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
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/db").await;

    let json: Value = response.json().expect("Response should be valid JSON");

    // Regardless of status code, the structure should be valid
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
// Redis Health Check Tests (/api/health/redis)
// ============================================================================

/// Test that the Redis health endpoint returns 200 when connected.
#[tokio::test]
async fn test_health_redis_connected() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/redis").await;
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
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/redis").await;
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
// Error Scenario Tests
// ============================================================================

/// Test that unknown health endpoints return 404.
#[tokio::test]
async fn test_health_unknown_endpoint_returns_404() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/unknown").await;
    response.assert_status(404);
}

/// Test that health endpoint handles trailing slash.
#[tokio::test]
async fn test_health_endpoint_trailing_slash() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/health/").await;

    assert!(
        response.status == 200 || response.status == 404 || response.status == 308 || response.status == 503,
        "Should handle trailing slash gracefully, got status {}",
        response.status
    );
}

// ============================================================================
// Concurrent Request Tests
// ============================================================================

/// Test that basic health endpoint handles concurrent requests.
#[tokio::test]
async fn test_health_concurrent_requests() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let mut handles = Vec::new();
    for _ in 0..10 {
        let router = app.router();
        handles.push(tokio::spawn(async move {
            let client = TestClient::new(router);
            client.get("/api/health/basic").await
        }));
    }

    let responses: Vec<_> = futures::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();

    for response in responses {
        response.assert_status(200);
    }
}

// ============================================================================
// Performance Tests
// ============================================================================

/// Test that basic health endpoint responds quickly.
#[tokio::test]
async fn test_health_response_time() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let start = std::time::Instant::now();
    let response = client.get("/api/health/basic").await;
    let duration = start.elapsed();

    response.assert_status(200);

    assert!(
        duration.as_millis() < 100,
        "Health check took too long: {:?}",
        duration
    );
}

/// Test that database health check responds reasonably fast.
#[tokio::test]
async fn test_health_db_response_time() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let start = std::time::Instant::now();
    let response = client.get("/api/health/db").await;
    let duration = start.elapsed();

    // Allow 200 or 503 (DB might be temporarily unavailable)
    assert!(
        response.status == 200 || response.status == 503,
        "Expected 200 or 503, got {}",
        response.status
    );

    assert!(
        duration.as_millis() < 500,
        "Database health check took too long: {:?}",
        duration
    );
}

/// Test that Redis health check responds reasonably fast.
#[tokio::test]
async fn test_health_redis_response_time() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let start = std::time::Instant::now();
    let response = client.get("/api/health/redis").await;
    let duration = start.elapsed();

    response.assert_status(200);

    assert!(
        duration.as_millis() < 500,
        "Redis health check took too long: {:?}",
        duration
    );
}
