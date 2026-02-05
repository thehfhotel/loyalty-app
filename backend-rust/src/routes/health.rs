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

/// Full system health check response
#[derive(Serialize)]
pub struct SystemHealthResponse {
    pub status: String,
    pub timestamp: String,
    pub version: String,
    pub database: String,
    pub redis: String,
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
async fn health_check_full(
    State(state): State<AppState>,
) -> Result<Json<SystemHealthResponse>, (StatusCode, Json<SystemHealthResponse>)> {
    let timestamp = Utc::now().to_rfc3339();

    // Check database
    let db_status = match sqlx::query("SELECT 1").execute(state.db()).await {
        Ok(_) => "connected".to_string(),
        Err(_) => "disconnected".to_string(),
    };

    // Check Redis
    let mut redis_conn = state.redis();
    let redis_status = match redis::cmd("PING")
        .query_async::<_, String>(&mut redis_conn)
        .await
    {
        Ok(_) => "connected".to_string(),
        Err(_) => "disconnected".to_string(),
    };

    let all_healthy = db_status == "connected" && redis_status == "connected";

    let response = SystemHealthResponse {
        status: if all_healthy {
            "ok".to_string()
        } else {
            "degraded".to_string()
        },
        timestamp,
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: db_status,
        redis: redis_status,
    };

    if all_healthy {
        Ok(Json(response))
    } else {
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(response)))
    }
}

/// Create health routes (basic health check only, no state required)
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(health_check))
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
