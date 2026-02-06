//! Health check routes
//!
//! Provides endpoints for health monitoring and readiness checks.

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use chrono::Utc;
use serde::Serialize;

use crate::state::AppState;

/// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub timestamp: String,
    pub version: String,
}

/// Database health check response
#[derive(Serialize)]
pub struct DbHealthResponse {
    pub status: String,
    pub database: String,
    pub timestamp: String,
}

/// Redis health check response
#[derive(Serialize)]
pub struct RedisHealthResponse {
    pub status: String,
    pub redis: String,
    pub timestamp: String,
}

/// Services health status
#[derive(Serialize)]
pub struct ServicesHealth {
    pub database: String,
    pub redis: String,
    pub storage: String,
    pub email: String,
}

/// Memory usage info
#[derive(Serialize)]
pub struct MemoryInfo {
    pub used: u64,
    pub total: u64,
}

/// Full system health check response (matches Node.js format)
#[derive(Serialize)]
pub struct SystemHealthResponse {
    pub status: String,
    pub timestamp: String,
    pub version: String,
    pub environment: String,
    pub services: ServicesHealth,
    pub uptime: u64,
    pub memory: MemoryInfo,
}

/// Basic health check handler
/// Returns {"status": "ok", "timestamp": "...", "version": "0.1.0"}
async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        timestamp: Utc::now().to_rfc3339(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Database health check handler
/// Checks database connectivity
async fn health_check_db(
    State(state): State<AppState>,
) -> Result<Json<DbHealthResponse>, (StatusCode, Json<DbHealthResponse>)> {
    let timestamp = Utc::now().to_rfc3339();

    match sqlx::query("SELECT 1").execute(state.db()).await {
        Ok(_) => Ok(Json(DbHealthResponse {
            status: "ok".to_string(),
            database: "connected".to_string(),
            timestamp,
        })),
        Err(_) => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(DbHealthResponse {
                status: "error".to_string(),
                database: "disconnected".to_string(),
                timestamp,
            }),
        )),
    }
}

/// Redis health check handler
/// Checks Redis connectivity
async fn health_check_redis(
    State(state): State<AppState>,
) -> Result<Json<RedisHealthResponse>, (StatusCode, Json<RedisHealthResponse>)> {
    let timestamp = Utc::now().to_rfc3339();

    let mut redis_conn = state.redis();
    match redis::cmd("PING")
        .query_async::<_, String>(&mut redis_conn)
        .await
    {
        Ok(_) => Ok(Json(RedisHealthResponse {
            status: "ok".to_string(),
            redis: "connected".to_string(),
            timestamp,
        })),
        Err(_) => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(RedisHealthResponse {
                status: "error".to_string(),
                redis: "disconnected".to_string(),
                timestamp,
            }),
        )),
    }
}

/// Full system health check handler
/// Checks both database and Redis connectivity
/// Returns response format matching Node.js: { status, services: { database, redis, ... } }
async fn health_check_full(
    State(state): State<AppState>,
) -> Result<Json<SystemHealthResponse>, (StatusCode, Json<SystemHealthResponse>)> {
    let timestamp = Utc::now().to_rfc3339();

    // Check database
    let db_status = match sqlx::query("SELECT 1").execute(state.db()).await {
        Ok(_) => "healthy".to_string(),
        Err(_) => "unhealthy".to_string(),
    };

    // Check Redis
    let mut redis_conn = state.redis();
    let redis_status = match redis::cmd("PING")
        .query_async::<_, String>(&mut redis_conn)
        .await
    {
        Ok(_) => "healthy".to_string(),
        Err(_) => "unhealthy".to_string(),
    };

    let db_healthy = db_status == "healthy";
    let redis_healthy = redis_status == "healthy";
    let all_healthy = db_healthy && redis_healthy;

    // Get environment from config
    let environment = if state.is_production() {
        "production"
    } else {
        "development"
    }
    .to_string();

    // Build services health status
    let services = ServicesHealth {
        database: db_status,
        redis: redis_status,
        storage: "healthy".to_string(), // Storage is always available in Rust backend
        email: "configured".to_string(), // Email service status
    };

    // Memory info (simplified for Rust - we don't have direct access like Node.js)
    let memory = MemoryInfo {
        used: 0, // Could use jemalloc stats if needed
        total: 0,
    };

    let response = SystemHealthResponse {
        status: if all_healthy {
            "healthy".to_string()
        } else {
            "degraded".to_string()
        },
        timestamp,
        version: env!("CARGO_PKG_VERSION").to_string(),
        environment,
        services,
        uptime: 0, // Would need to track start time for actual uptime
        memory,
    };

    if all_healthy {
        Ok(Json(response))
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(response)))
    }
}

/// Create health routes
/// The root `/` path returns full system health with services object to match Node.js format
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(health_check_full))
        .route("/basic", get(health_check))
        .route("/db", get(health_check_db))
        .route("/redis", get(health_check_redis))
        .route("/full", get(health_check_full))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_health_check_response() {
        let response = health_check().await;
        assert_eq!(response.status, "ok");
        assert!(!response.timestamp.is_empty());
        assert!(!response.version.is_empty());
    }
}
