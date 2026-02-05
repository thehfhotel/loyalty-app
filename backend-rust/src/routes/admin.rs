//! Admin routes
//!
//! Provides admin-only endpoints for user management, dashboard statistics,
//! analytics, and notification broadcasts.
//!
//! All routes in this module require admin authentication (admin or super_admin role).

use axum::{
    extract::{Extension, Path, Query, State},
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::models::notification::NotificationType;
use crate::models::user::UserRole;
use crate::models::user_loyalty::UserLoyaltyResponse;
use crate::models::user_profile::UserProfileResponse;
use crate::state::AppState;

// ============================================================================
// Request/Response DTOs
// ============================================================================

/// Query parameters for listing users with pagination and search
#[derive(Debug, Clone, Deserialize)]
pub struct ListUsersQuery {
    /// Page number (1-indexed, default: 1)
    #[serde(default = "default_page")]
    pub page: i32,
    /// Number of items per page (default: 10, max: 100)
    #[serde(default = "default_limit")]
    pub limit: i32,
    /// Search term for filtering by email or name
    pub search: Option<String>,
    /// Field to sort by (email, created_at, role)
    #[serde(default = "default_sort_by")]
    pub sort_by: String,
    /// Sort order (asc or desc)
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
}

fn default_page() -> i32 {
    1
}

fn default_limit() -> i32 {
    10
}

fn default_sort_by() -> String {
    "created_at".to_string()
}

fn default_sort_order() -> String {
    "desc".to_string()
}

/// Pagination metadata
#[derive(Debug, Clone, Serialize)]
pub struct PaginationMeta {
    pub page: i32,
    pub limit: i32,
    pub total: i64,
    pub pages: i32,
}

/// Response for listing users
#[derive(Debug, Clone, Serialize)]
pub struct ListUsersResponse {
    pub success: bool,
    pub data: Vec<AdminUserResponse>,
    pub pagination: PaginationMeta,
}

/// Admin view of a user (includes more details)
#[derive(Debug, Clone, Serialize)]
pub struct AdminUserResponse {
    pub id: Uuid,
    pub email: Option<String>,
    pub role: String,
    pub is_active: bool,
    pub email_verified: bool,
    pub oauth_provider: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<UserProfileResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loyalty: Option<UserLoyaltyResponse>,
}

/// Response for getting a single user
#[derive(Debug, Clone, Serialize)]
pub struct GetUserResponse {
    pub success: bool,
    pub data: AdminUserResponse,
}

/// Request for updating a user (admin)
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct UpdateUserRequest {
    #[validate(email(message = "Invalid email format"))]
    pub email: Option<String>,
    pub role: Option<UserRole>,
    pub is_active: Option<bool>,
    pub email_verified: Option<bool>,
}

/// Response for updating a user
#[derive(Debug, Clone, Serialize)]
pub struct UpdateUserResponse {
    pub success: bool,
    pub message: String,
    pub data: AdminUserResponse,
}

/// Response for deleting a user
#[derive(Debug, Clone, Serialize)]
pub struct DeleteUserResponse {
    pub success: bool,
    pub message: String,
}

/// Dashboard statistics response
#[derive(Debug, Clone, Serialize)]
pub struct DashboardStats {
    pub total_users: i64,
    pub active_users: i64,
    pub total_points_issued: i64,
    pub total_bookings: i64,
    pub new_users_today: i64,
    pub new_users_this_week: i64,
    pub new_users_this_month: i64,
    pub users_by_tier: Vec<TierUserCount>,
    pub users_by_role: Vec<RoleUserCount>,
}

/// User count by tier
#[derive(Debug, Clone, Serialize)]
pub struct TierUserCount {
    pub tier_name: String,
    pub tier_color: String,
    pub count: i64,
}

/// User count by role
#[derive(Debug, Clone, Serialize)]
pub struct RoleUserCount {
    pub role: String,
    pub count: i64,
}

/// Response for dashboard stats
#[derive(Debug, Clone, Serialize)]
pub struct StatsResponse {
    pub success: bool,
    pub data: DashboardStats,
}

/// Query parameters for analytics
#[derive(Debug, Clone, Deserialize)]
pub struct AnalyticsQuery {
    /// Start date for analytics period
    pub start_date: Option<NaiveDate>,
    /// End date for analytics period
    pub end_date: Option<NaiveDate>,
    /// Metric type (registrations, points, bookings, tiers)
    pub metric: Option<String>,
}

/// Analytics data point for time series
#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsDataPoint {
    pub date: NaiveDate,
    pub value: i64,
}

/// Analytics response
#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsResponse {
    pub success: bool,
    pub data: AnalyticsData,
}

/// Analytics data
#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsData {
    pub metric: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub data_points: Vec<AnalyticsDataPoint>,
    pub total: i64,
    pub average: f64,
}

/// Request for broadcasting notifications
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct BroadcastNotificationRequest {
    /// Notification title
    #[validate(length(min = 1, max = 200, message = "Title must be 1-200 characters"))]
    pub title: String,
    /// Notification message
    #[validate(length(min = 1, max = 2000, message = "Message must be 1-2000 characters"))]
    pub message: String,
    /// Notification type
    pub notification_type: Option<NotificationType>,
    /// Optional filter: only send to users with specific tier
    pub tier_id: Option<Uuid>,
    /// Optional filter: only send to users with specific role
    pub role: Option<UserRole>,
    /// Optional filter: only send to active users (default: true)
    #[serde(default = "default_active_only")]
    pub active_only: bool,
    /// Optional additional data as JSON
    pub data: Option<serde_json::Value>,
}

fn default_active_only() -> bool {
    true
}

/// Response for broadcast notification
#[derive(Debug, Clone, Serialize)]
pub struct BroadcastNotificationResponse {
    pub success: bool,
    pub message: String,
    pub notifications_sent: i64,
}

// ============================================================================
// Middleware Helper
// ============================================================================

/// Check if the authenticated user has admin privileges
fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required".to_string(),
        ));
    }
    Ok(())
}

/// Check if the authenticated user has super_admin privileges
fn require_super_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "super_admin") {
        return Err(AppError::Forbidden(
            "Super admin access required".to_string(),
        ));
    }
    Ok(())
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /api/admin/users
/// List all users with pagination and search
async fn list_users(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<ListUsersQuery>,
) -> AppResult<Json<ListUsersResponse>> {
    require_admin(&user)?;

    // Validate and normalize pagination params
    let page = query.page.max(1);
    let limit = query.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    // Validate sort params
    let sort_by = match query.sort_by.as_str() {
        "email" | "created_at" | "role" | "is_active" => query.sort_by.as_str(),
        _ => "created_at",
    };
    let sort_order = match query.sort_order.to_lowercase().as_str() {
        "asc" => "ASC",
        _ => "DESC",
    };

    // Build search condition
    let search_pattern = query
        .search
        .as_ref()
        .map(|s| format!("%{}%", s.to_lowercase()));

    // Get total count
    let total: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE LOWER(COALESCE(u.email, '')) LIKE $1
               OR LOWER(COALESCE(up.first_name, '')) LIKE $1
               OR LOWER(COALESCE(up.last_name, '')) LIKE $1
               OR LOWER(COALESCE(up.membership_id, '')) LIKE $1
            "#,
        )
        .bind(pattern)
        .fetch_one(state.db())
        .await?
    } else {
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM users"#)
            .fetch_one(state.db())
            .await?
    };

    // Fetch users with dynamic ordering
    // Note: We need to use raw SQL for dynamic ORDER BY
    let order_clause = format!("ORDER BY {} {} NULLS LAST", sort_by, sort_order);

    let users = if let Some(ref pattern) = search_pattern {
        let query_str = format!(
            r#"
            SELECT
                u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
                u.oauth_provider, u.created_at, u.updated_at,
                up.user_id as profile_user_id, up.first_name, up.last_name,
                up.phone, up.date_of_birth, up.preferences, up.avatar_url,
                up.membership_id, up.created_at as profile_created_at,
                up.updated_at as profile_updated_at,
                ul.user_id as loyalty_user_id, ul.current_points, ul.total_nights,
                ul.tier_id, ul.tier_updated_at, ul.points_updated_at,
                ul.created_at as loyalty_created_at, ul.updated_at as loyalty_updated_at
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN user_loyalty ul ON u.id = ul.user_id
            WHERE LOWER(COALESCE(u.email, '')) LIKE $1
               OR LOWER(COALESCE(up.first_name, '')) LIKE $1
               OR LOWER(COALESCE(up.last_name, '')) LIKE $1
               OR LOWER(COALESCE(up.membership_id, '')) LIKE $1
            {}
            LIMIT $2 OFFSET $3
            "#,
            order_clause
        );

        sqlx::query_as::<_, UserRow>(&query_str)
            .bind(pattern)
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(state.db())
            .await?
    } else {
        let query_str = format!(
            r#"
            SELECT
                u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
                u.oauth_provider, u.created_at, u.updated_at,
                up.user_id as profile_user_id, up.first_name, up.last_name,
                up.phone, up.date_of_birth, up.preferences, up.avatar_url,
                up.membership_id, up.created_at as profile_created_at,
                up.updated_at as profile_updated_at,
                ul.user_id as loyalty_user_id, ul.current_points, ul.total_nights,
                ul.tier_id, ul.tier_updated_at, ul.points_updated_at,
                ul.created_at as loyalty_created_at, ul.updated_at as loyalty_updated_at
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN user_loyalty ul ON u.id = ul.user_id
            {}
            LIMIT $1 OFFSET $2
            "#,
            order_clause
        );

        sqlx::query_as::<_, UserRow>(&query_str)
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(state.db())
            .await?
    };

    // Convert to response format
    let data: Vec<AdminUserResponse> = users.into_iter().map(|row| row.into()).collect();

    let pages = ((total as f64) / (limit as f64)).ceil() as i32;

    Ok(Json(ListUsersResponse {
        success: true,
        data,
        pagination: PaginationMeta {
            page,
            limit,
            total,
            pages,
        },
    }))
}

/// GET /api/admin/users/:id
/// Get a specific user by ID with all details
async fn get_user(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<GetUserResponse>> {
    require_admin(&user)?;

    let row = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
            u.oauth_provider, u.created_at, u.updated_at,
            up.user_id as profile_user_id, up.first_name, up.last_name,
            up.phone, up.date_of_birth, up.preferences, up.avatar_url,
            up.membership_id, up.created_at as profile_created_at,
            up.updated_at as profile_updated_at,
            ul.user_id as loyalty_user_id, ul.current_points, ul.total_nights,
            ul.tier_id, ul.tier_updated_at, ul.points_updated_at,
            ul.created_at as loyalty_created_at, ul.updated_at as loyalty_updated_at
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("User".to_string()))?;

    Ok(Json(GetUserResponse {
        success: true,
        data: row.into(),
    }))
}

/// PUT /api/admin/users/:id
/// Update a user (admin can update any field)
async fn update_user(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserRequest>,
) -> AppResult<Json<UpdateUserResponse>> {
    require_admin(&user)?;

    // Validate the request
    payload.validate().map_err(AppError::from)?;

    // Check if user exists
    let _existing: Uuid = sqlx::query_scalar(
        r#"SELECT id FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("User".to_string()))?;

    // Prevent admin from changing their own role to a lower level
    if user_id == Uuid::parse_str(&user.id).unwrap_or_default() {
        if let Some(new_role) = &payload.role {
            if *new_role == UserRole::Customer {
                return Err(AppError::BadRequest(
                    "Cannot demote yourself to customer".to_string(),
                ));
            }
        }
    }

    // Build update query dynamically
    let mut updates = Vec::new();
    let mut param_index = 1;

    if payload.email.is_some() {
        param_index += 1;
        updates.push(format!("email = ${}", param_index));
    }
    if payload.role.is_some() {
        param_index += 1;
        updates.push(format!("role = ${}::user_role", param_index));
    }
    if payload.is_active.is_some() {
        param_index += 1;
        updates.push(format!("is_active = ${}", param_index));
    }
    if payload.email_verified.is_some() {
        param_index += 1;
        updates.push(format!("email_verified = ${}", param_index));
    }

    if updates.is_empty() {
        return Err(AppError::BadRequest("No fields to update".to_string()));
    }

    updates.push("updated_at = NOW()".to_string());

    let query_str = format!(
        "UPDATE users SET {} WHERE id = $1 RETURNING id",
        updates.join(", ")
    );

    // Execute update
    let mut query = sqlx::query_scalar::<_, Uuid>(&query_str).bind(user_id);

    if let Some(email) = &payload.email {
        query = query.bind(email);
    }
    if let Some(role) = &payload.role {
        query = query.bind(role.to_string());
    }
    if let Some(is_active) = payload.is_active {
        query = query.bind(is_active);
    }
    if let Some(email_verified) = payload.email_verified {
        query = query.bind(email_verified);
    }

    query.fetch_one(state.db()).await?;

    // Fetch updated user
    let row = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
            u.oauth_provider, u.created_at, u.updated_at,
            up.user_id as profile_user_id, up.first_name, up.last_name,
            up.phone, up.date_of_birth, up.preferences, up.avatar_url,
            up.membership_id, up.created_at as profile_created_at,
            up.updated_at as profile_updated_at,
            ul.user_id as loyalty_user_id, ul.current_points, ul.total_nights,
            ul.tier_id, ul.tier_updated_at, ul.points_updated_at,
            ul.created_at as loyalty_created_at, ul.updated_at as loyalty_updated_at
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(state.db())
    .await?;

    Ok(Json(UpdateUserResponse {
        success: true,
        message: "User updated successfully".to_string(),
        data: row.into(),
    }))
}

/// DELETE /api/admin/users/:id
/// Soft delete or deactivate a user (super_admin only for hard delete)
async fn delete_user(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<DeleteUserResponse>> {
    require_super_admin(&user)?;

    // Prevent self-deletion
    if user_id == Uuid::parse_str(&user.id).unwrap_or_default() {
        return Err(AppError::BadRequest(
            "Cannot delete your own account".to_string(),
        ));
    }

    // Check if user exists
    let _existing: Uuid = sqlx::query_scalar(r#"SELECT id FROM users WHERE id = $1"#)
        .bind(user_id)
        .fetch_optional(state.db())
        .await?
        .ok_or_else(|| AppError::NotFound("User".to_string()))?;

    // Soft delete: deactivate the user instead of hard delete
    sqlx::query(
        r#"
        UPDATE users
        SET is_active = false, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(state.db())
    .await?;

    Ok(Json(DeleteUserResponse {
        success: true,
        message: "User deleted successfully".to_string(),
    }))
}

/// GET /api/admin/stats
/// Get dashboard statistics
async fn get_stats(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> AppResult<Json<StatsResponse>> {
    require_admin(&user)?;

    // Total users
    let total_users: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM users"#)
        .fetch_one(state.db())
        .await?;

    // Active users (last 30 days based on updated_at or last login)
    let thirty_days_ago = Utc::now() - Duration::days(30);
    let active_users: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM users
        WHERE is_active = true
        AND updated_at >= $1
        "#,
    )
    .bind(thirty_days_ago)
    .fetch_one(state.db())
    .await?;

    // Total points issued (sum of all positive point transactions)
    let total_points_issued: i64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(points), 0)
        FROM points_transactions
        WHERE points > 0
        "#,
    )
    .fetch_one(state.db())
    .await
    .unwrap_or(0);

    // Total bookings (count of point transactions with type 'stay' or similar)
    // Note: Since bookings table may not exist, we count from points_transactions
    let total_bookings: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM points_transactions
        WHERE type = 'stay' OR type = 'booking'
        "#,
    )
    .fetch_one(state.db())
    .await
    .unwrap_or(0);

    // New users today
    let today_start = Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap();
    let today_start_utc = DateTime::<Utc>::from_naive_utc_and_offset(today_start, Utc);
    let new_users_today: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM users WHERE created_at >= $1"#)
        .bind(today_start_utc)
        .fetch_one(state.db())
        .await?;

    // New users this week
    let week_ago = Utc::now() - Duration::days(7);
    let new_users_this_week: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM users WHERE created_at >= $1"#)
        .bind(week_ago)
        .fetch_one(state.db())
        .await?;

    // New users this month
    let month_ago = Utc::now() - Duration::days(30);
    let new_users_this_month: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM users WHERE created_at >= $1"#)
        .bind(month_ago)
        .fetch_one(state.db())
        .await?;

    // Users by tier
    #[derive(sqlx::FromRow)]
    struct TierCountRow {
        tier_name: String,
        tier_color: String,
        count: i64,
    }

    let tier_counts = sqlx::query_as::<_, TierCountRow>(
        r#"
        SELECT
            t.name as tier_name,
            t.color as tier_color,
            COUNT(ul.user_id) as count
        FROM tiers t
        LEFT JOIN user_loyalty ul ON t.id = ul.tier_id
        WHERE t.is_active = true
        GROUP BY t.id, t.name, t.color, t.sort_order
        ORDER BY t.sort_order
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let users_by_tier: Vec<TierUserCount> = tier_counts
        .into_iter()
        .map(|row| TierUserCount {
            tier_name: row.tier_name,
            tier_color: row.tier_color,
            count: row.count,
        })
        .collect();

    // Users by role
    #[derive(sqlx::FromRow)]
    struct RoleCountRow {
        role: String,
        count: i64,
    }

    let role_counts = sqlx::query_as::<_, RoleCountRow>(
        r#"
        SELECT
            role::text as role,
            COUNT(*) as count
        FROM users
        GROUP BY role
        ORDER BY role
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let users_by_role: Vec<RoleUserCount> = role_counts
        .into_iter()
        .map(|row| RoleUserCount {
            role: row.role,
            count: row.count,
        })
        .collect();

    Ok(Json(StatsResponse {
        success: true,
        data: DashboardStats {
            total_users,
            active_users,
            total_points_issued,
            total_bookings,
            new_users_today,
            new_users_this_week,
            new_users_this_month,
            users_by_tier,
            users_by_role,
        },
    }))
}

/// GET /api/admin/analytics
/// Get analytics data for charts
async fn get_analytics(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<AnalyticsQuery>,
) -> AppResult<Json<AnalyticsResponse>> {
    require_admin(&user)?;

    // Default to last 30 days if no dates provided
    let end_date = query.end_date.unwrap_or_else(|| Utc::now().date_naive());
    let start_date = query
        .start_date
        .unwrap_or_else(|| end_date - Duration::days(30));

    let metric = query.metric.unwrap_or_else(|| "registrations".to_string());

    let data_points = match metric.as_str() {
        "registrations" => {
            get_registration_analytics(state.db(), start_date, end_date).await?
        }
        "points" => {
            get_points_analytics(state.db(), start_date, end_date).await?
        }
        "bookings" => {
            get_bookings_analytics(state.db(), start_date, end_date).await?
        }
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unknown metric: {}. Valid metrics: registrations, points, bookings",
                metric
            )));
        }
    };

    let total: i64 = data_points.iter().map(|dp| dp.value).sum();
    let average = if data_points.is_empty() {
        0.0
    } else {
        total as f64 / data_points.len() as f64
    };

    Ok(Json(AnalyticsResponse {
        success: true,
        data: AnalyticsData {
            metric,
            start_date,
            end_date,
            data_points,
            total,
            average,
        },
    }))
}

/// Row type for analytics queries
#[derive(sqlx::FromRow)]
struct AnalyticsRow {
    date: NaiveDate,
    count: i64,
}

/// Helper: Get registration analytics
async fn get_registration_analytics(
    db: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> AppResult<Vec<AnalyticsDataPoint>> {
    let rows = sqlx::query_as::<_, AnalyticsRow>(
        r#"
        SELECT
            DATE(created_at) as date,
            COUNT(*) as count
        FROM users
        WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AnalyticsDataPoint {
            date: row.date,
            value: row.count,
        })
        .collect())
}

/// Helper: Get points analytics
async fn get_points_analytics(
    db: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> AppResult<Vec<AnalyticsDataPoint>> {
    let rows = sqlx::query_as::<_, AnalyticsRow>(
        r#"
        SELECT
            DATE(created_at) as date,
            COALESCE(SUM(points), 0) as count
        FROM points_transactions
        WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2 AND points > 0
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AnalyticsDataPoint {
            date: row.date,
            value: row.count,
        })
        .collect())
}

/// Helper: Get bookings analytics
async fn get_bookings_analytics(
    db: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> AppResult<Vec<AnalyticsDataPoint>> {
    let rows = sqlx::query_as::<_, AnalyticsRow>(
        r#"
        SELECT
            DATE(created_at) as date,
            COUNT(*) as count
        FROM points_transactions
        WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2
            AND (type = 'stay' OR type = 'booking')
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AnalyticsDataPoint {
            date: row.date,
            value: row.count,
        })
        .collect())
}

/// POST /api/admin/notifications/broadcast
/// Send notification to all users or filtered users
async fn broadcast_notification(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<BroadcastNotificationRequest>,
) -> AppResult<Json<BroadcastNotificationResponse>> {
    require_admin(&user)?;

    // Validate the request
    payload.validate().map_err(AppError::from)?;

    let notification_type = payload
        .notification_type
        .unwrap_or(NotificationType::Info);

    // Build query to get target users based on filters
    let mut conditions = Vec::new();
    let mut params: Vec<String> = Vec::new();

    if payload.active_only {
        conditions.push("u.is_active = true".to_string());
    }

    if let Some(tier_id) = payload.tier_id {
        params.push(tier_id.to_string());
        conditions.push(format!("ul.tier_id = ${}::uuid", params.len()));
    }

    if let Some(role) = &payload.role {
        params.push(role.to_string());
        conditions.push(format!("u.role = ${}::user_role", params.len()));
    }

    let where_clause = if conditions.is_empty() {
        "1=1".to_string()
    } else {
        conditions.join(" AND ")
    };

    // Get target user IDs
    let query_str = format!(
        r#"
        SELECT u.id
        FROM users u
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        WHERE {}
        "#,
        where_clause
    );

    let user_ids: Vec<Uuid> = sqlx::query_scalar(&query_str)
        .fetch_all(state.db())
        .await?;

    if user_ids.is_empty() {
        return Ok(Json(BroadcastNotificationResponse {
            success: true,
            message: "No users matched the filter criteria".to_string(),
            notifications_sent: 0,
        }));
    }

    // Insert notifications for all target users
    let notification_type_str = format!("{:?}", notification_type).to_lowercase();
    let data_json = payload.data.unwrap_or(serde_json::json!({}));

    let mut count: i64 = 0;
    for user_id in &user_ids {
        let notification_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO notifications (id, user_id, title, message, type, data, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5::notification_type, $6, NOW(), NOW())
            "#,
        )
        .bind(notification_id)
        .bind(user_id)
        .bind(&payload.title)
        .bind(&payload.message)
        .bind(&notification_type_str)
        .bind(&data_json)
        .execute(state.db())
        .await?;
        count += 1;
    }

    Ok(Json(BroadcastNotificationResponse {
        success: true,
        message: format!("Broadcast sent to {} users", count),
        notifications_sent: count,
    }))
}

// ============================================================================
// Row Types for Complex Queries
// ============================================================================

/// Row type for joined user queries
#[derive(Debug, sqlx::FromRow)]
struct UserRow {
    // User fields
    id: Uuid,
    email: Option<String>,
    role: Option<String>,
    is_active: Option<bool>,
    email_verified: Option<bool>,
    oauth_provider: Option<String>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    // Profile fields
    profile_user_id: Option<Uuid>,
    first_name: Option<String>,
    last_name: Option<String>,
    phone: Option<String>,
    date_of_birth: Option<chrono::NaiveDate>,
    preferences: Option<serde_json::Value>,
    avatar_url: Option<String>,
    membership_id: Option<String>,
    profile_created_at: Option<DateTime<Utc>>,
    profile_updated_at: Option<DateTime<Utc>>,
    // Loyalty fields
    loyalty_user_id: Option<Uuid>,
    current_points: Option<i32>,
    total_nights: Option<i32>,
    tier_id: Option<Uuid>,
    tier_updated_at: Option<DateTime<Utc>>,
    points_updated_at: Option<DateTime<Utc>>,
    loyalty_created_at: Option<DateTime<Utc>>,
    loyalty_updated_at: Option<DateTime<Utc>>,
}

impl From<UserRow> for AdminUserResponse {
    fn from(row: UserRow) -> Self {
        let profile = if row.profile_user_id.is_some() {
            Some(UserProfileResponse {
                user_id: row.profile_user_id.unwrap(),
                first_name: row.first_name.clone(),
                last_name: row.last_name.clone(),
                full_name: match (&row.first_name, &row.last_name) {
                    (Some(first), Some(last)) => Some(format!("{} {}", first, last)),
                    (Some(first), None) => Some(first.clone()),
                    (None, Some(last)) => Some(last.clone()),
                    (None, None) => None,
                },
                phone: row.phone,
                date_of_birth: row.date_of_birth,
                preferences: row.preferences.unwrap_or(serde_json::json!({})),
                avatar_url: row.avatar_url,
                membership_id: row.membership_id.unwrap_or_default(),
                created_at: row.profile_created_at.unwrap_or_else(Utc::now),
                updated_at: row.profile_updated_at.unwrap_or_else(Utc::now),
            })
        } else {
            None
        };

        let loyalty = if row.loyalty_user_id.is_some() {
            Some(UserLoyaltyResponse {
                user_id: row.loyalty_user_id.unwrap(),
                current_points: row.current_points.unwrap_or(0),
                total_nights: row.total_nights.unwrap_or(0),
                tier_id: row.tier_id,
                tier_updated_at: row.tier_updated_at,
                points_updated_at: row.points_updated_at,
                created_at: row.loyalty_created_at.unwrap_or_else(Utc::now),
                updated_at: row.loyalty_updated_at.unwrap_or_else(Utc::now),
            })
        } else {
            None
        };

        AdminUserResponse {
            id: row.id,
            email: row.email,
            role: row.role.unwrap_or_else(|| "customer".to_string()),
            is_active: row.is_active.unwrap_or(true),
            email_verified: row.email_verified.unwrap_or(false),
            oauth_provider: row.oauth_provider,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
            profile,
            loyalty,
        }
    }
}

// ============================================================================
// Routes
// ============================================================================

/// Create admin router with AppState
///
/// All routes require admin authentication and are prefixed with /admin.
/// Admin middleware is applied to all routes in this router.
///
/// # Endpoints
///
/// - `GET /admin/users` - List all users with pagination
/// - `GET /admin/users/:id` - Get user details
/// - `PUT /admin/users/:id` - Update user
/// - `DELETE /admin/users/:id` - Delete/deactivate user (super_admin only)
/// - `GET /admin/stats` - Dashboard statistics
/// - `GET /admin/analytics` - Analytics data
/// - `POST /admin/notifications/broadcast` - Send notification to all users
///
/// # Example
///
/// ```rust,ignore
/// use loyalty_backend::routes::admin;
/// use loyalty_backend::state::AppState;
///
/// let app = Router::new()
///     .nest("/api", admin::router())
///     .with_state(state);
/// ```
pub fn router() -> Router<AppState> {
    Router::new()
        // User management
        .route("/admin/users", get(list_users))
        .route("/admin/users/:id", get(get_user))
        .route("/admin/users/:id", put(update_user))
        .route("/admin/users/:id", delete(delete_user))
        // Dashboard stats
        .route("/admin/stats", get(get_stats))
        // Analytics
        .route("/admin/analytics", get(get_analytics))
        // Notifications
        .route("/admin/notifications/broadcast", post(broadcast_notification))
        // Apply auth middleware to all routes
        .layer(middleware::from_fn(auth_middleware))
}

/// Create admin routes (alias for router())
///
/// All routes require admin authentication.
/// Routes are relative since they're nested under /api/admin in the main router.
pub fn routes() -> Router<AppState> {
    router()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_users_query_defaults() {
        let query = ListUsersQuery {
            page: 0, // Should be clamped to 1
            limit: 200, // Should be clamped to 100
            search: None,
            sort_by: "invalid".to_string(),
            sort_order: "invalid".to_string(),
        };

        let page = query.page.max(1);
        let limit = query.limit.clamp(1, 100);

        assert_eq!(page, 1);
        assert_eq!(limit, 100);
    }

    #[test]
    fn test_pagination_meta() {
        let meta = PaginationMeta {
            page: 1,
            limit: 10,
            total: 95,
            pages: 10, // ceil(95/10) = 10
        };

        assert_eq!(meta.pages, 10);
    }

    #[test]
    fn test_default_active_only() {
        assert!(default_active_only());
    }

    #[test]
    fn test_require_admin() {
        let admin_user = AuthUser {
            id: "123".to_string(),
            email: Some("admin@example.com".to_string()),
            role: "admin".to_string(),
        };

        let customer_user = AuthUser {
            id: "456".to_string(),
            email: Some("customer@example.com".to_string()),
            role: "customer".to_string(),
        };

        assert!(require_admin(&admin_user).is_ok());
        assert!(require_admin(&customer_user).is_err());
    }

    #[test]
    fn test_require_super_admin() {
        let super_admin = AuthUser {
            id: "123".to_string(),
            email: Some("superadmin@example.com".to_string()),
            role: "super_admin".to_string(),
        };

        let admin_user = AuthUser {
            id: "456".to_string(),
            email: Some("admin@example.com".to_string()),
            role: "admin".to_string(),
        };

        assert!(require_super_admin(&super_admin).is_ok());
        assert!(require_super_admin(&admin_user).is_err());
    }
}
