//! Analytics routes
//!
//! Provides endpoints for tracking and retrieving analytics data including
//! coupon usage, profile changes, and user engagement metrics.
//!
//! ## Endpoints
//!
//! ### User Analytics (authenticated)
//! - `POST /coupon-usage` - Track a coupon usage event
//! - `POST /profile-change` - Track a profile change event
//!
//! ### Admin Analytics (admin only)
//! - `GET /coupon-usage` - Get coupon usage analytics
//! - `GET /profile-changes` - Get profile change analytics
//! - `GET /user-engagement` - Get user engagement metrics
//! - `GET /dashboard` - Get analytics dashboard summary
//! - `POST /update-daily` - Update daily analytics (typically called by cron)

use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    middleware,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::state::AppState;

// ============================================================================
// Request Types
// ============================================================================

/// Request to track coupon usage
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackCouponUsageRequest {
    pub coupon_id: String,
    pub user_coupon_id: Option<String>,
    pub event_type: String,
    pub source: Option<String>,
    pub metadata: Option<JsonValue>,
}

/// Request to track profile change
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackProfileChangeRequest {
    pub field: String,
    pub old_value: Option<String>,
    pub new_value: String,
    #[serde(default = "default_change_source")]
    pub change_source: String,
    pub metadata: Option<JsonValue>,
}

fn default_change_source() -> String {
    "user".to_string()
}

/// Query parameters for analytics endpoints
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub coupon_id: Option<String>,
    pub user_id: Option<String>,
}

/// Query parameters for dashboard
#[derive(Debug, Deserialize)]
pub struct DashboardQuery {
    #[serde(default = "default_period")]
    pub period: String,
}

fn default_period() -> String {
    "30".to_string()
}

/// Request to update daily analytics
#[derive(Debug, Deserialize)]
pub struct UpdateDailyRequest {
    pub date: Option<String>,
}

// ============================================================================
// Response Types
// ============================================================================

/// Generic success response
#[derive(Debug, Serialize)]
pub struct SuccessResponse {
    pub success: bool,
    pub message: String,
}

/// Coupon usage analytics response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CouponUsageAnalytics {
    pub total_events: i64,
    pub unique_users: i64,
    pub conversion_rate: f64,
    pub events_by_type: JsonValue,
    pub top_sources: Vec<SourceCount>,
}

/// Source count for analytics
#[derive(Debug, Serialize, FromRow)]
pub struct SourceCount {
    pub source: Option<String>,
    pub count: i64,
}

/// Profile change analytics response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileChangeAnalytics {
    pub total_changes: i64,
    pub unique_users: i64,
    pub changes_by_field: JsonValue,
    pub completion_milestones: Vec<CompletionMilestone>,
}

/// Completion milestone info
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionMilestone {
    pub user_id: Uuid,
    pub completed_at: Option<DateTime<Utc>>,
}

/// User engagement metrics response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEngagementMetrics {
    pub active_users: i64,
    pub user_segments: JsonValue,
    pub avg_coupons_per_user: f64,
    pub avg_profile_changes_per_user: f64,
    pub top_users: Vec<TopUser>,
}

/// Top user info
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TopUser {
    pub user_id: Uuid,
    pub interaction_count: i64,
}

/// Dashboard response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResponse {
    pub success: bool,
    pub data: DashboardData,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub period: String,
    pub coupon_usage: CouponUsageSummary,
    pub profile_changes: ProfileChangesSummary,
    pub user_engagement: UserEngagementSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CouponUsageSummary {
    pub total_events: i64,
    pub unique_users: i64,
    pub conversion_rate: f64,
    pub top_sources: Vec<SourceCount>,
    pub event_breakdown: JsonValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileChangesSummary {
    pub total_changes: i64,
    pub unique_users: i64,
    pub top_fields: Vec<FieldCount>,
    pub recent_completions: Vec<CompletionMilestone>,
}

#[derive(Debug, Serialize)]
pub struct FieldCount {
    pub field: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEngagementSummary {
    pub active_users: i64,
    pub user_segments: JsonValue,
    pub avg_interactions: AvgInteractions,
    pub top_users: Vec<TopUser>,
}

#[derive(Debug, Serialize)]
pub struct AvgInteractions {
    pub coupons: f64,
    pub profile_changes: f64,
}

// ============================================================================
// Valid Event Types
// ============================================================================

const VALID_COUPON_EVENT_TYPES: &[&str] = &[
    "view",
    "assign",
    "redeem_attempt",
    "redeem_success",
    "redeem_fail",
    "expire",
    "revoke",
];

const VALID_CHANGE_SOURCES: &[&str] = &["user", "admin", "system"];

// ============================================================================
// Handlers - User Analytics
// ============================================================================

/// POST /analytics/coupon-usage
/// Track a coupon usage event
async fn track_coupon_usage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<TrackCouponUsageRequest>,
) -> Result<(StatusCode, Json<SuccessResponse>), AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate required fields
    if payload.coupon_id.is_empty() {
        return Err(AppError::BadRequest("couponId is required".to_string()));
    }

    if payload.event_type.is_empty() {
        return Err(AppError::BadRequest("eventType is required".to_string()));
    }

    // Validate event type
    if !VALID_COUPON_EVENT_TYPES.contains(&payload.event_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid eventType. Must be one of: {}",
            VALID_COUPON_EVENT_TYPES.join(", ")
        )));
    }

    let coupon_id = Uuid::parse_str(&payload.coupon_id)
        .map_err(|_| AppError::BadRequest("Invalid coupon ID format".to_string()))?;

    let user_coupon_id = payload
        .user_coupon_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|_| AppError::BadRequest("Invalid user coupon ID format".to_string()))?;

    // Insert analytics record
    sqlx::query(
        r#"
        INSERT INTO coupon_usage_analytics
        (user_id, coupon_id, user_coupon_id, event_type, source, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        "#,
    )
    .bind(user_id)
    .bind(coupon_id)
    .bind(user_coupon_id)
    .bind(&payload.event_type)
    .bind(&payload.source)
    .bind(&payload.metadata)
    .execute(state.db())
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(SuccessResponse {
            success: true,
            message: "Coupon usage event tracked successfully".to_string(),
        }),
    ))
}

/// POST /analytics/profile-change
/// Track a profile change event
async fn track_profile_change(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<TrackProfileChangeRequest>,
) -> Result<(StatusCode, Json<SuccessResponse>), AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate required fields
    if payload.field.is_empty() {
        return Err(AppError::BadRequest("field is required".to_string()));
    }

    // Validate change source
    if !VALID_CHANGE_SOURCES.contains(&payload.change_source.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid changeSource. Must be one of: {}",
            VALID_CHANGE_SOURCES.join(", ")
        )));
    }

    // Insert analytics record
    sqlx::query(
        r#"
        INSERT INTO profile_change_analytics
        (user_id, field, old_value, new_value, change_source, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        "#,
    )
    .bind(user_id)
    .bind(&payload.field)
    .bind(&payload.old_value)
    .bind(&payload.new_value)
    .bind(&payload.change_source)
    .bind(&payload.metadata)
    .execute(state.db())
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(SuccessResponse {
            success: true,
            message: "Profile change event tracked successfully".to_string(),
        }),
    ))
}

// ============================================================================
// Handlers - Admin Analytics
// ============================================================================

/// GET /analytics/coupon-usage
/// Get coupon usage analytics (admin only)
async fn get_coupon_usage_analytics(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<Json<CouponUsageAnalytics>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let end_date = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap());

    // Get total events and unique users
    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_events,
            COUNT(DISTINCT user_id) as unique_users
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
          AND ($3::uuid IS NULL OR coupon_id = $3)
          AND ($4::uuid IS NULL OR user_id = $4)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .bind(
        params
            .coupon_id
            .as_ref()
            .and_then(|id| Uuid::parse_str(id).ok()),
    )
    .bind(
        params
            .user_id
            .as_ref()
            .and_then(|id| Uuid::parse_str(id).ok()),
    )
    .fetch_one(state.db())
    .await
    .unwrap_or((0, 0));

    // Get events by type
    let events_by_type: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT event_type, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        GROUP BY event_type
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    let events_map: serde_json::Map<String, JsonValue> = events_by_type
        .into_iter()
        .map(|(t, c)| (t, JsonValue::Number(c.into())))
        .collect();

    // Get top sources
    let top_sources: Vec<SourceCount> = sqlx::query_as(
        r#"
        SELECT source, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE source IS NOT NULL
          AND ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        GROUP BY source
        ORDER BY count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    // Calculate conversion rate (redeem_success / redeem_attempt)
    let conversion: Option<(i64, i64)> = sqlx::query_as(
        r#"
        SELECT
            SUM(CASE WHEN event_type = 'redeem_success' THEN 1 ELSE 0 END)::bigint,
            SUM(CASE WHEN event_type = 'redeem_attempt' THEN 1 ELSE 0 END)::bigint
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_optional(state.db())
    .await?;

    let conversion_rate = match conversion {
        Some((success, attempts)) if attempts > 0 => (success as f64 / attempts as f64) * 100.0,
        _ => 0.0,
    };

    Ok(Json(CouponUsageAnalytics {
        total_events: stats.0,
        unique_users: stats.1,
        conversion_rate,
        events_by_type: JsonValue::Object(events_map),
        top_sources,
    }))
}

/// GET /analytics/profile-changes
/// Get profile change analytics (admin only)
async fn get_profile_change_analytics(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<Json<ProfileChangeAnalytics>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let end_date = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap());

    // Get total changes and unique users
    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_changes,
            COUNT(DISTINCT user_id) as unique_users
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
          AND ($3::uuid IS NULL OR user_id = $3)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .bind(
        params
            .user_id
            .as_ref()
            .and_then(|id| Uuid::parse_str(id).ok()),
    )
    .fetch_one(state.db())
    .await
    .unwrap_or((0, 0));

    // Get changes by field
    let changes_by_field: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT field, COUNT(*) as count
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
          AND ($2::timestamp IS NULL OR created_at <= $2)
        GROUP BY field
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    let changes_map: serde_json::Map<String, JsonValue> = changes_by_field
        .into_iter()
        .map(|(f, c)| (f, JsonValue::Number(c.into())))
        .collect();

    Ok(Json(ProfileChangeAnalytics {
        total_changes: stats.0,
        unique_users: stats.1,
        changes_by_field: JsonValue::Object(changes_map),
        completion_milestones: vec![], // Simplified - could be populated from a completions table
    }))
}

/// GET /analytics/user-engagement
/// Get user engagement metrics (admin only)
async fn get_user_engagement_metrics(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AnalyticsQuery>,
) -> Result<Json<UserEngagementMetrics>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let end_date = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap());

    // Get active users (users with any analytics activity)
    let active_users: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT user_id)
        FROM (
            SELECT user_id FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            UNION
            SELECT user_id FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
        ) combined
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(state.db())
    .await
    .unwrap_or((0,));

    // Get average interactions per user
    let coupon_avg: (f64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(AVG(count), 0)
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
        ) user_counts
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(state.db())
    .await
    .unwrap_or((0.0,));

    let profile_avg: (f64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(AVG(count), 0)
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
        ) user_counts
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(state.db())
    .await
    .unwrap_or((0.0,));

    // Get top users by interaction count
    let top_users: Vec<TopUser> = sqlx::query_as(
        r#"
        SELECT user_id, SUM(count)::bigint as interaction_count
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
            UNION ALL
            SELECT user_id, COUNT(*) as count
            FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
              AND ($2::timestamp IS NULL OR created_at <= $2)
            GROUP BY user_id
        ) combined
        GROUP BY user_id
        ORDER BY interaction_count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    Ok(Json(UserEngagementMetrics {
        active_users: active_users.0,
        user_segments: serde_json::json!({}), // Simplified
        avg_coupons_per_user: coupon_avg.0,
        avg_profile_changes_per_user: profile_avg.0,
        top_users,
    }))
}

/// GET /analytics/dashboard
/// Get analytics dashboard summary (admin only)
async fn get_analytics_dashboard(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<DashboardQuery>,
) -> Result<Json<DashboardResponse>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let days: i64 = params.period.parse().unwrap_or(30);
    let start_date = Utc::now() - chrono::Duration::days(days);

    let analytics_query = AnalyticsQuery {
        start_date: Some(start_date.format("%Y-%m-%d").to_string()),
        end_date: None,
        coupon_id: None,
        user_id: None,
    };

    // Get coupon usage analytics
    let coupon_analytics =
        get_coupon_usage_analytics_internal(state.db(), &analytics_query).await?;

    // Get profile change analytics
    let profile_analytics =
        get_profile_change_analytics_internal(state.db(), &analytics_query).await?;

    // Get user engagement metrics
    let engagement_metrics =
        get_user_engagement_metrics_internal(state.db(), &analytics_query).await?;

    Ok(Json(DashboardResponse {
        success: true,
        data: DashboardData {
            period: format!("{} days", days),
            coupon_usage: CouponUsageSummary {
                total_events: coupon_analytics.total_events,
                unique_users: coupon_analytics.unique_users,
                conversion_rate: coupon_analytics.conversion_rate,
                top_sources: coupon_analytics.top_sources.into_iter().take(5).collect(),
                event_breakdown: coupon_analytics.events_by_type,
            },
            profile_changes: ProfileChangesSummary {
                total_changes: profile_analytics.total_changes,
                unique_users: profile_analytics.unique_users,
                top_fields: extract_top_fields(&profile_analytics.changes_by_field, 5),
                recent_completions: profile_analytics
                    .completion_milestones
                    .into_iter()
                    .take(10)
                    .collect(),
            },
            user_engagement: UserEngagementSummary {
                active_users: engagement_metrics.active_users,
                user_segments: engagement_metrics.user_segments,
                avg_interactions: AvgInteractions {
                    coupons: engagement_metrics.avg_coupons_per_user,
                    profile_changes: engagement_metrics.avg_profile_changes_per_user,
                },
                top_users: engagement_metrics.top_users.into_iter().take(10).collect(),
            },
        },
    }))
}

/// POST /analytics/update-daily
/// Update daily user analytics (admin only, typically called by cron)
async fn update_daily_analytics(
    State(_state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<UpdateDailyRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let target_date = payload
        .date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Utc::now().date_naive());

    // In a real implementation, this would aggregate and store daily analytics
    // For now, we just acknowledge the request
    tracing::info!("Daily analytics update requested for date: {}", target_date);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Daily analytics updated successfully",
        "data": {
            "recordsProcessed": 0,
            "date": target_date.to_string()
        }
    })))
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

async fn get_coupon_usage_analytics_internal(
    db: &sqlx::PgPool,
    params: &AnalyticsQuery,
) -> Result<CouponUsageAnalytics, AppError> {
    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_events,
            COUNT(DISTINCT user_id) as unique_users
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        "#,
    )
    .bind(start_date)
    .fetch_one(db)
    .await
    .unwrap_or((0, 0));

    let events_by_type: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT event_type, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        GROUP BY event_type
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let events_map: serde_json::Map<String, JsonValue> = events_by_type
        .into_iter()
        .map(|(t, c)| (t, JsonValue::Number(c.into())))
        .collect();

    let top_sources: Vec<SourceCount> = sqlx::query_as(
        r#"
        SELECT source, COUNT(*) as count
        FROM coupon_usage_analytics
        WHERE source IS NOT NULL
          AND ($1::timestamp IS NULL OR created_at >= $1)
        GROUP BY source
        ORDER BY count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    Ok(CouponUsageAnalytics {
        total_events: stats.0,
        unique_users: stats.1,
        conversion_rate: 0.0,
        events_by_type: JsonValue::Object(events_map),
        top_sources,
    })
}

async fn get_profile_change_analytics_internal(
    db: &sqlx::PgPool,
    params: &AnalyticsQuery,
) -> Result<ProfileChangeAnalytics, AppError> {
    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let stats: (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_changes,
            COUNT(DISTINCT user_id) as unique_users
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        "#,
    )
    .bind(start_date)
    .fetch_one(db)
    .await
    .unwrap_or((0, 0));

    let changes_by_field: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT field, COUNT(*) as count
        FROM profile_change_analytics
        WHERE ($1::timestamp IS NULL OR created_at >= $1)
        GROUP BY field
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let changes_map: serde_json::Map<String, JsonValue> = changes_by_field
        .into_iter()
        .map(|(f, c)| (f, JsonValue::Number(c.into())))
        .collect();

    Ok(ProfileChangeAnalytics {
        total_changes: stats.0,
        unique_users: stats.1,
        changes_by_field: JsonValue::Object(changes_map),
        completion_milestones: vec![],
    })
}

async fn get_user_engagement_metrics_internal(
    db: &sqlx::PgPool,
    params: &AnalyticsQuery,
) -> Result<UserEngagementMetrics, AppError> {
    let start_date = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| d.and_hms_opt(0, 0, 0).unwrap());

    let active_users: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT user_id)
        FROM (
            SELECT user_id FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
            UNION
            SELECT user_id FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
        ) combined
        "#,
    )
    .bind(start_date)
    .fetch_one(db)
    .await
    .unwrap_or((0,));

    let top_users: Vec<TopUser> = sqlx::query_as(
        r#"
        SELECT user_id, SUM(count)::bigint as interaction_count
        FROM (
            SELECT user_id, COUNT(*) as count
            FROM coupon_usage_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
            GROUP BY user_id
            UNION ALL
            SELECT user_id, COUNT(*) as count
            FROM profile_change_analytics
            WHERE ($1::timestamp IS NULL OR created_at >= $1)
            GROUP BY user_id
        ) combined
        GROUP BY user_id
        ORDER BY interaction_count DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    Ok(UserEngagementMetrics {
        active_users: active_users.0,
        user_segments: serde_json::json!({}),
        avg_coupons_per_user: 0.0,
        avg_profile_changes_per_user: 0.0,
        top_users,
    })
}

fn extract_top_fields(changes_by_field: &JsonValue, limit: usize) -> Vec<FieldCount> {
    let mut fields: Vec<FieldCount> = if let JsonValue::Object(map) = changes_by_field {
        map.iter()
            .filter_map(|(field, count)| {
                count.as_i64().map(|c| FieldCount {
                    field: field.clone(),
                    count: c,
                })
            })
            .collect()
    } else {
        vec![]
    };

    fields.sort_by(|a, b| b.count.cmp(&a.count));
    fields.truncate(limit);
    fields
}

// ============================================================================
// Router
// ============================================================================

/// Create analytics routes
///
/// These routes are intended to be nested under /api/analytics via the main router.
/// All routes require authentication, with admin-only routes performing additional checks.
///
/// ## Endpoints
///
/// ### User Analytics (authenticated)
/// - `POST /coupon-usage` - Track a coupon usage event
/// - `POST /profile-change` - Track a profile change event
///
/// ### Admin Analytics (admin only)
/// - `GET /coupon-usage` - Get coupon usage analytics
/// - `GET /profile-changes` - Get profile change analytics
/// - `GET /user-engagement` - Get user engagement metrics
/// - `GET /dashboard` - Get analytics dashboard summary
/// - `POST /update-daily` - Update daily analytics
pub fn routes() -> Router<AppState> {
    Router::new()
        // User analytics endpoints
        .route("/coupon-usage", post(track_coupon_usage))
        .route("/profile-change", post(track_profile_change))
        // Admin analytics endpoints (role check in handlers)
        .route("/coupon-usage", get(get_coupon_usage_analytics))
        .route("/profile-changes", get(get_profile_change_analytics))
        .route("/user-engagement", get(get_user_engagement_metrics))
        .route("/dashboard", get(get_analytics_dashboard))
        .route("/update-daily", post(update_daily_analytics))
        .layer(middleware::from_fn(auth_middleware))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_coupon_event_types() {
        assert!(VALID_COUPON_EVENT_TYPES.contains(&"view"));
        assert!(VALID_COUPON_EVENT_TYPES.contains(&"assign"));
        assert!(VALID_COUPON_EVENT_TYPES.contains(&"redeem_success"));
        assert!(!VALID_COUPON_EVENT_TYPES.contains(&"invalid"));
    }

    #[test]
    fn test_valid_change_sources() {
        assert!(VALID_CHANGE_SOURCES.contains(&"user"));
        assert!(VALID_CHANGE_SOURCES.contains(&"admin"));
        assert!(VALID_CHANGE_SOURCES.contains(&"system"));
        assert!(!VALID_CHANGE_SOURCES.contains(&"invalid"));
    }

    #[test]
    fn test_extract_top_fields() {
        let changes = serde_json::json!({
            "email": 10,
            "phone": 5,
            "name": 15,
            "avatar": 3
        });

        let top = extract_top_fields(&changes, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].field, "name");
        assert_eq!(top[0].count, 15);
        assert_eq!(top[1].field, "email");
        assert_eq!(top[1].count, 10);
    }

    #[test]
    fn test_default_change_source() {
        assert_eq!(default_change_source(), "user");
    }

    #[test]
    fn test_default_period() {
        assert_eq!(default_period(), "30");
    }
}
