//! Admin routes
//!
//! Provides admin-only endpoints for user management, dashboard statistics,
//! analytics, and notification broadcasts.
//!
//! All routes in this module require admin authentication (admin or super_admin role).

use axum::{
    extract::{Extension, Path, Query, State},
    middleware,
    routing::{delete, get, patch, post, put},
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
    /// Field to sort by. Typed; unknown values are rejected with 400
    /// instead of silently falling back. MED-5 (security-2026-05-13.md).
    #[serde(default)]
    pub sort_by: SortBy,
    /// Sort order. Typed; unknown values are rejected with 400.
    #[serde(default)]
    pub sort_order: SortOrder,
}

/// Whitelisted column names that `list_users` is allowed to ORDER BY.
///
/// MED-5 (security-2026-05-13.md): collapses the runtime-string match-arm
/// surface to a typed-only path. The SQL column name is produced by
/// [`Self::to_sql_column`] — the only place in this module that emits a
/// raw column identifier into an ORDER BY clause — so SQL injection on
/// this endpoint is mechanically impossible: serde refuses any value not
/// listed below, and the helper returns a `&'static str` literal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SortBy {
    #[default]
    CreatedAt,
    Email,
    Role,
    IsActive,
}

impl SortBy {
    /// Map the enum variant to the literal SQL column name. Returns a
    /// `&'static str` so callers can safely interpolate into a SQL
    /// fragment without going through a runtime string.
    fn to_sql_column(self) -> &'static str {
        match self {
            SortBy::Email => "u.email",
            SortBy::CreatedAt => "u.created_at",
            SortBy::Role => "u.role",
            SortBy::IsActive => "u.is_active",
        }
    }
}

/// Typed sort direction. Same rationale as [`SortBy`]: keep the SQL
/// fragment surface limited to compile-time-known literals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Asc,
    #[default]
    Desc,
}

impl SortOrder {
    fn to_sql(self) -> &'static str {
        match self {
            SortOrder::Asc => "ASC",
            SortOrder::Desc => "DESC",
        }
    }
}

/// Whitelisted broadcast filters that `broadcast_notification` is allowed
/// to translate into a WHERE clause.
///
/// MED-5 (security-2026-05-13.md): each variant maps to a single SQL
/// fragment via [`Self::to_sql_fragment`] with a positional placeholder.
/// The fragment is a `&'static str` literal, so the SQL surface of the
/// dynamic WHERE is fully enumerable. Values ride through as `String`
/// with an inline `::uuid` / `::user_role` cast so Postgres parses them
/// safely; the bind sites in the handler are the only injection vector
/// left, and those use `sqlx::query_scalar(...).bind(value)`.
enum BroadcastFilter {
    /// `u.is_active = true` — no parameter binding required.
    ActiveOnly,
    /// `ul.tier_id = ${n}::uuid` — bound as the tier UUID's text form.
    TierId,
    /// `u.role = ${n}::user_role` — bound as the role enum's text form.
    Role,
}

impl BroadcastFilter {
    /// Produce a single WHERE-clause fragment with `$n` substituted for
    /// the supplied 1-indexed positional parameter. Returns
    /// `&'static str` for the literal-only `ActiveOnly` case so the
    /// caller can `push` without allocating.
    fn to_sql_fragment(&self, n: usize) -> String {
        match self {
            BroadcastFilter::ActiveOnly => "u.is_active = true".to_string(),
            BroadcastFilter::TierId => format!("ul.tier_id = ${}::uuid", n),
            BroadcastFilter::Role => format!("u.role = ${}::user_role", n),
        }
    }
}

/// Assemble the WHERE clause for `broadcast_notification` from the
/// typed filter payload. Returns the WHERE-clause body (without the
/// leading `WHERE`) and the list of bound text values in positional
/// order. When no filters apply, falls back to `1=1` so the calling
/// query stays a single, valid SELECT.
fn build_broadcast_where_clause(payload: &BroadcastNotificationRequest) -> (String, Vec<String>) {
    let mut fragments: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();

    if payload.active_only {
        fragments.push(BroadcastFilter::ActiveOnly.to_sql_fragment(0));
    }

    if let Some(tier_id) = payload.tier_id {
        values.push(tier_id.to_string());
        fragments.push(BroadcastFilter::TierId.to_sql_fragment(values.len()));
    }

    if let Some(role) = &payload.role {
        values.push(role.to_string());
        fragments.push(BroadcastFilter::Role.to_sql_fragment(values.len()));
    }

    let where_clause = if fragments.is_empty() {
        "1=1".to_string()
    } else {
        fragments.join(" AND ")
    };

    (where_clause, values)
}

fn default_page() -> i32 {
    1
}

fn default_limit() -> i32 {
    10
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

/// Request for updating user status via PATCH
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUserStatusRequest {
    pub is_active: bool,
}

/// Request for updating user role via PATCH
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUserRoleRequest {
    pub role: UserRole,
}

/// Coupon status response
#[derive(Debug, Clone, Serialize)]
pub struct CouponStatusResponse {
    pub success: bool,
    pub data: serde_json::Value,
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
        return Err(AppError::Forbidden("Admin access required".to_string()));
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

/// Reject `delete_user` (deactivation) when the target user is itself a
/// super_admin. Pairs with the role-escalation gate in #236 so the role
/// hierarchy stays symmetric — you can't demote a super_admin without
/// being one, and you can't deactivate one either.
///
/// Extracted as a free function so it's testable without spinning up a
/// database; the handler resolves `existing_role` from the DB and then
/// delegates the policy decision to this helper.
fn deny_deactivation_if_super_admin(existing_role: &UserRole) -> AppResult<()> {
    if *existing_role == UserRole::SuperAdmin {
        return Err(AppError::Forbidden(
            "Cannot deactivate another super_admin".to_string(),
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

    // MED-5: typed sort params. Unknown values are rejected with 400 at
    // deserialisation time (serde) rather than silently falling back to
    // a default — the previous string-match pattern was safe today only
    // because of an allowlist that's easy to forget on a future column
    // addition. With the typed enum, adding a column requires extending
    // both `SortBy` and `to_sql_column`, and the compiler enforces the
    // mapping is total.
    let sort_by = query.sort_by.to_sql_column();
    let sort_order = query.sort_order.to_sql();

    // Build search condition
    let search_pattern = query
        .search
        .as_ref()
        .map(|s| format!("%{}%", s.to_lowercase()));

    // Get total count
    let total: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!: i64"
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE LOWER(COALESCE(u.email, '')) LIKE $1
               OR LOWER(COALESCE(up.first_name, '')) LIKE $1
               OR LOWER(COALESCE(up.last_name, '')) LIKE $1
               OR LOWER(COALESCE(up.membership_id, '')) LIKE $1
            "#,
            pattern,
        )
        .fetch_one(state.db())
        .await?
    } else {
        sqlx::query_scalar!(r#"SELECT COUNT(*) as "count!: i64" FROM users"#)
            .fetch_one(state.db())
            .await?
    };

    // Fetch users with dynamic ordering
    // Note: We need to use raw SQL for dynamic ORDER BY - keep as runtime query
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

    // Note: Uses runtime query because it shares UserRow (with FromRow) with dynamic queries
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

    // Check if user exists and fetch current role so we can gate role
    // transitions that touch the super_admin tier (see super_admin gate
    // below). Runtime sqlx::query_scalar avoids forcing an .sqlx/ cache
    // regen for this one read; UserRole derives sqlx::Type so the enum
    // round-trips through the wire format safely.
    let existing_role: UserRole =
        sqlx::query_scalar::<_, UserRole>(r#"SELECT role FROM users WHERE id = $1"#)
            .bind(user_id)
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound("User".to_string()))?;

    // Role-escalation gate (HIGH-1).
    //
    // Without this guard, any admin could:
    //   (a) promote any user (including themselves) to super_admin, OR
    //   (b) demote an existing super_admin to a lower role,
    // both bypassing the require_super_admin gate that protects
    // delete_user. Require super_admin for either transition.
    if let Some(new_role) = &payload.role {
        let touches_super_admin =
            *new_role == UserRole::SuperAdmin || existing_role == UserRole::SuperAdmin;
        if touches_super_admin {
            require_super_admin(&user)?;
        }
    }

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

    // Build update query dynamically - keep as runtime (dynamic SET clause)
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

    // Execute update - keep as runtime (dynamic query)
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

    // Fetch updated user - keep as runtime (shares UserRow with dynamic queries)
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
///
/// Deactivates (soft-disables) a user. **No hard delete is implemented** —
/// despite the route name and HTTP verb, this handler only sets
/// `is_active = false` so the user can no longer log in, redeem points, or
/// access the account UI. Loyalty rows, bookings, and audit history are
/// preserved.
///
/// Gated by `require_super_admin` because the action is irreversible for
/// the affected user without admin intervention.
///
/// MED-2 (security-2026-05-13.md): symmetric super_admin protection.
/// A super_admin cannot deactivate **another** super_admin. This mirrors
/// the gate added in #236 (HIGH-1) that prevents a regular admin from
/// promoting users to super_admin or demoting existing super_admins —
/// without this, two compromised super_admins could lock each other out,
/// and the role hierarchy would be asymmetric (you can't demote a peer
/// via role change, but you could effectively delete them).
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

    // Check if user exists and fetch their role so we can apply the
    // symmetric super_admin guard (MED-2). Runtime sqlx::query_scalar
    // matches the pattern used by `update_user` / `update_user_role`
    // and keeps this off the compile-time cache.
    let existing_role: UserRole =
        sqlx::query_scalar::<_, UserRole>(r#"SELECT role FROM users WHERE id = $1"#)
            .bind(user_id)
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound("User".to_string()))?;

    // MED-2: a super_admin cannot deactivate another super_admin. The
    // role hierarchy stays symmetric with the demotion gate in #236 —
    // you cannot get around it by deactivating instead of demoting.
    deny_deactivation_if_super_admin(&existing_role)?;

    // Soft delete: deactivate the user instead of hard delete
    sqlx::query!(
        r#"
        UPDATE users
        SET is_active = false, updated_at = NOW()
        WHERE id = $1
        "#,
        user_id,
    )
    .execute(state.db())
    .await?;

    Ok(Json(DeleteUserResponse {
        success: true,
        message: "User deactivated successfully".to_string(),
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
    let total_users: i64 = sqlx::query_scalar!(r#"SELECT COUNT(*) as "count!: i64" FROM users"#)
        .fetch_one(state.db())
        .await?;

    // Active users (last 30 days based on updated_at or last login)
    let thirty_days_ago = Utc::now() - Duration::days(30);
    let active_users: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!: i64"
        FROM users
        WHERE is_active = true
        AND updated_at >= $1
        "#,
        thirty_days_ago,
    )
    .fetch_one(state.db())
    .await?;

    // Total points issued (sum of all positive point transactions).
    //
    // MED-3 (correctness-2026-05-13.md): propagate query errors with `?`
    // instead of `.unwrap_or(0)`. A silently-coerced zero on transient
    // connection drops / statement timeouts / schema regressions used to
    // make the admin dashboard read "0 points issued" while the other
    // tile queries (above and below) failed loudly with `?` — a doubly
    // confusing UX. Now every tile uses the same error mode.
    let total_points_issued: i64 = sqlx::query_scalar!(
        r#"
        SELECT COALESCE(SUM(points), 0) as "sum!: i64"
        FROM points_transactions
        WHERE points > 0
        "#,
    )
    .fetch_one(state.db())
    .await?;

    // Total bookings (count of point transactions with type 'stay' or similar).
    // MED-3 (correctness-2026-05-13.md): same `?` propagation as
    // `total_points_issued` above.
    let total_bookings: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!: i64"
        FROM points_transactions
        WHERE type::text = 'stay' OR type::text = 'booking'
        "#,
    )
    .fetch_one(state.db())
    .await?;

    // New users today
    let today_start = Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap();
    let today_start_utc = DateTime::<Utc>::from_naive_utc_and_offset(today_start, Utc);
    let new_users_today: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!: i64" FROM users WHERE created_at >= $1"#,
        today_start_utc,
    )
    .fetch_one(state.db())
    .await?;

    // New users this week
    let week_ago = Utc::now() - Duration::days(7);
    let new_users_this_week: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!: i64" FROM users WHERE created_at >= $1"#,
        week_ago,
    )
    .fetch_one(state.db())
    .await?;

    // New users this month
    let month_ago = Utc::now() - Duration::days(30);
    let new_users_this_month: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!: i64" FROM users WHERE created_at >= $1"#,
        month_ago,
    )
    .fetch_one(state.db())
    .await?;

    // Users by tier
    let tier_rows = sqlx::query!(
        r#"
        SELECT
            t.name as "tier_name!",
            t.color as "tier_color!",
            COUNT(ul.user_id) as "count!: i64"
        FROM tiers t
        LEFT JOIN user_loyalty ul ON t.id = ul.tier_id
        WHERE t.is_active = true
        GROUP BY t.id, t.name, t.color, t.sort_order
        ORDER BY t.sort_order
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let users_by_tier: Vec<TierUserCount> = tier_rows
        .into_iter()
        .map(|row| TierUserCount {
            tier_name: row.tier_name,
            tier_color: row.tier_color,
            count: row.count,
        })
        .collect();

    // Users by role
    let role_rows = sqlx::query!(
        r#"
        SELECT
            role::text as "role!",
            COUNT(*) as "count!: i64"
        FROM users
        GROUP BY role
        ORDER BY role
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let users_by_role: Vec<RoleUserCount> = role_rows
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
        "registrations" => get_registration_analytics(state.db(), start_date, end_date).await?,
        "points" => get_points_analytics(state.db(), start_date, end_date).await?,
        "bookings" => get_bookings_analytics(state.db(), start_date, end_date).await?,
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unknown metric: {}. Valid metrics: registrations, points, bookings",
                metric
            )));
        },
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

/// Helper: Get registration analytics
async fn get_registration_analytics(
    db: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> AppResult<Vec<AnalyticsDataPoint>> {
    let rows = sqlx::query!(
        r#"
        SELECT
            DATE(created_at) as "date!",
            COUNT(*) as "count!: i64"
        FROM users
        WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
        "#,
        start_date,
        end_date,
    )
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
    let rows = sqlx::query!(
        r#"
        SELECT
            DATE(created_at) as "date!",
            COALESCE(SUM(points), 0) as "count!: i64"
        FROM points_transactions
        WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2 AND points > 0
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
        "#,
        start_date,
        end_date,
    )
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
    let rows = sqlx::query!(
        r#"
        SELECT
            DATE(created_at) as "date!",
            COUNT(*) as "count!: i64"
        FROM points_transactions
        WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2
            AND (type::text = 'stay' OR type::text = 'booking')
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
        "#,
        start_date,
        end_date,
    )
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

    let notification_type = payload.notification_type.unwrap_or(NotificationType::Info);

    // MED-5: typed WHERE-clause builder. The previous implementation
    // assembled SQL fragments from string interpolation against a
    // local-mutable vector — safe today because all *values* were
    // bound via `.bind(…)`, but the *fragment* surface was still
    // freeform. Converting to a typed enum makes the set of producible
    // fragments enumerable in one place, and the builder below is the
    // only thing in this module that emits a literal SQL fragment for
    // the broadcast filter. Each fragment carries a `::uuid` /
    // `::user_role` cast inline, so all values can ride through as
    // `String` and Postgres parses them safely.
    let (where_clause, filter_values) = build_broadcast_where_clause(&payload);

    // Get target user IDs — runtime query because the WHERE-clause
    // shape varies with which filters the admin requested. Values are
    // bound positionally as text and re-cast in SQL; the column /
    // operator literals come from `BroadcastFilter` and are `&'static
    // str`s, so a future refactor can't accidentally let user input
    // become a SQL identifier.
    let query_str = format!(
        r#"
        SELECT u.id
        FROM users u
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        WHERE {}
        "#,
        where_clause
    );

    let mut q = sqlx::query_scalar::<_, Uuid>(&query_str);
    for value in &filter_values {
        q = q.bind(value);
    }
    let user_ids: Vec<Uuid> = q.fetch_all(state.db()).await?;

    if user_ids.is_empty() {
        return Ok(Json(BroadcastNotificationResponse {
            success: true,
            message: "No users matched the filter criteria".to_string(),
            notifications_sent: 0,
        }));
    }

    // Insert notifications for all target users
    // Note: Uses runtime query because $5::notification_type enum cast
    // is not supported by compile-time macros
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

/// PATCH /api/admin/users/:id/status
async fn update_user_status(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserStatusRequest>,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&user)?;

    sqlx::query("UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1")
        .bind(user_id)
        .bind(payload.is_active)
        .execute(state.db())
        .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "User status updated successfully"
    })))
}

/// PATCH /api/admin/users/:id/role
async fn update_user_role(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserRoleRequest>,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&user)?;

    // Fetch the target user's current role to gate transitions that touch
    // super_admin (see HIGH-1 in security-2026-05-13.md). A 404 here matches
    // the pattern used by update_user above. Runtime sqlx::query_scalar
    // keeps this off the compile-time cache (no .sqlx/ regen needed).
    let existing_role: UserRole =
        sqlx::query_scalar::<_, UserRole>(r#"SELECT role FROM users WHERE id = $1"#)
            .bind(user_id)
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound("User".to_string()))?;

    // Role-escalation gate (HIGH-1).
    //
    // Block any role transition that either targets super_admin (promotion)
    // or starts from super_admin (demotion of an existing super_admin)
    // unless the caller is themselves a super_admin. Without this gate, a
    // regular admin could promote any user — including themselves — to
    // super_admin, then exercise super_admin-gated handlers like
    // delete_user.
    let touches_super_admin =
        payload.role == UserRole::SuperAdmin || existing_role == UserRole::SuperAdmin;
    if touches_super_admin {
        require_super_admin(&user)?;
    }

    if user_id == Uuid::parse_str(&user.id).unwrap_or_default()
        && payload.role == UserRole::Customer
    {
        return Err(AppError::BadRequest(
            "Cannot demote yourself to customer".to_string(),
        ));
    }

    sqlx::query("UPDATE users SET role = $2::text::user_role, updated_at = NOW() WHERE id = $1")
        .bind(user_id)
        .bind(payload.role.to_string())
        .execute(state.db())
        .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "User role updated successfully"
    })))
}

/// GET /api/admin/new-member-coupon-settings
async fn get_new_member_coupon_settings(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&user)?;

    let row: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT value FROM app_settings WHERE key = 'new_member_coupon' LIMIT 1")
            .fetch_optional(state.db())
            .await?;

    match row {
        Some((value,)) => Ok(Json(serde_json::json!({
            "success": true,
            "data": value,
        }))),
        None => Ok(Json(serde_json::json!({
            "success": true,
            "data": {
                "enabled": false,
                "coupon_id": null,
                "settings": {}
            },
        }))),
    }
}

/// PUT /api/admin/new-member-coupon-settings
async fn update_new_member_coupon_settings(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&user)?;

    sqlx::query(
        r#"
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('new_member_coupon', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        "#,
    )
    .bind(&payload)
    .execute(state.db())
    .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "New member coupon settings updated successfully",
        "data": payload,
    })))
}

/// GET /api/admin/coupon-status/:couponId
async fn get_coupon_status(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(coupon_id): Path<Uuid>,
) -> AppResult<Json<CouponStatusResponse>> {
    require_admin(&user)?;

    let row: Option<(String, Option<String>, Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT status::text, name, used_count, usage_limit FROM coupons WHERE id = $1",
    )
    .bind(coupon_id)
    .fetch_optional(state.db())
    .await?;

    match row {
        Some((status, name, used_count, usage_limit)) => Ok(Json(CouponStatusResponse {
            success: true,
            data: serde_json::json!({
                "id": coupon_id,
                "status": status,
                "name": name,
                "used_count": used_count.unwrap_or(0),
                "usage_limit": usage_limit,
            }),
        })),
        None => Err(AppError::NotFound("Coupon".to_string())),
    }
}

// ============================================================================
// Row Types for Complex Queries
// ============================================================================

/// Row type for joined user queries (used by both dynamic and static queries)
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
        let profile = if let Some(profile_user_id) = row.profile_user_id {
            Some(UserProfileResponse {
                user_id: profile_user_id,
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

        let loyalty = if let Some(loyalty_user_id) = row.loyalty_user_id {
            Some(UserLoyaltyResponse {
                user_id: loyalty_user_id,
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
        .route("/users", get(list_users))
        .route("/users/:id", get(get_user))
        .route("/users/:id", put(update_user))
        .route("/users/:id", delete(delete_user))
        .route("/users/:id/status", patch(update_user_status))
        .route("/users/:id/role", patch(update_user_role))
        // Dashboard stats
        .route("/stats", get(get_stats))
        // Analytics
        .route("/analytics", get(get_analytics))
        // Notifications
        .route("/notifications/broadcast", post(broadcast_notification))
        // Coupon settings
        .route("/new-member-coupon-settings", get(get_new_member_coupon_settings))
        .route("/new-member-coupon-settings", put(update_new_member_coupon_settings))
        .route("/coupon-status/:couponId", get(get_coupon_status))
        // Room/room-type/blocked-dates admin endpoints live in a sibling
        // module to keep this file from growing further. Merge before the
        // auth layer so `auth_middleware` covers the merged routes too.
        .merge(crate::routes::admin_rooms::router())
        // Admin booking management endpoints (list / detail / PUT /
        // discount / cancel + the room-types dropdown source) likewise
        // live in their own sibling module.
        .merge(crate::routes::admin_bookings::router())
        // Email-service status/test endpoints — sibling module for the
        // same reason (separates concerns, keeps admin.rs from bloating).
        .merge(crate::routes::admin_email::router())
        // Slip moderation (verify / needs-action) for the booking slip
        // viewer sidebar. Conceptually unrelated to room inventory, so
        // it lives in its own module.
        .merge(crate::routes::admin_slips::router())
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
            page: 0,    // Should be clamped to 1
            limit: 200, // Should be clamped to 100
            search: None,
            sort_by: SortBy::default(),
            sort_order: SortOrder::default(),
        };

        let page = query.page.max(1);
        let limit = query.limit.clamp(1, 100);

        assert_eq!(page, 1);
        assert_eq!(limit, 100);
        // Defaults match the historical implicit fall-back so callers
        // who don't pass sort_by/sort_order keep the same behaviour.
        assert_eq!(query.sort_by.to_sql_column(), "u.created_at");
        assert_eq!(query.sort_order.to_sql(), "DESC");
    }

    // ------------------------------------------------------------------
    // MED-5 (security-2026-05-13.md): typed sort params reject unknowns.
    // ------------------------------------------------------------------

    #[test]
    fn sort_by_accepts_allowlisted_columns_and_maps_to_safe_sql() {
        // The four allowlisted values must each map to a stable SQL
        // column literal. If a future commit adds a column to `SortBy`
        // without updating `to_sql_column`, the compiler catches it.
        assert_eq!(SortBy::Email.to_sql_column(), "u.email");
        assert_eq!(SortBy::CreatedAt.to_sql_column(), "u.created_at");
        assert_eq!(SortBy::Role.to_sql_column(), "u.role");
        assert_eq!(SortBy::IsActive.to_sql_column(), "u.is_active");
    }

    #[test]
    fn sort_by_rejects_unknown_values_at_deserialise_time() {
        // The whole point of MED-5: an attacker-supplied `sort_by=DROP`
        // (or any other non-allowlisted value) must fail to deserialise
        // — not silently fall back. With the typed enum, serde returns
        // an error before the handler ever runs.
        let result: Result<SortBy, _> = serde_json::from_str(r#""drop_table""#);
        assert!(result.is_err());

        // Casing must also fail; we expect snake_case only.
        let result: Result<SortBy, _> = serde_json::from_str(r#""Email""#);
        assert!(result.is_err());
    }

    #[test]
    fn sort_order_typed_enum_rejects_unknown_directions() {
        let result: Result<SortOrder, _> = serde_json::from_str(r#""sideways""#);
        assert!(result.is_err());

        // Casing must match the lowercase rename rule.
        let result: Result<SortOrder, _> = serde_json::from_str(r#""ASC""#);
        assert!(result.is_err());
    }

    #[test]
    fn build_broadcast_where_clause_no_filters_yields_1_eq_1() {
        // All filters disabled → fall back to `1=1` so the SELECT stays
        // well-formed (every authenticated user matches).
        let payload = BroadcastNotificationRequest {
            title: "t".to_string(),
            message: "m".to_string(),
            notification_type: None,
            tier_id: None,
            role: None,
            active_only: false,
            data: None,
        };
        let (where_clause, values) = build_broadcast_where_clause(&payload);
        assert_eq!(where_clause, "1=1");
        assert!(values.is_empty());
    }

    #[test]
    fn build_broadcast_where_clause_emits_static_fragments_for_active_only() {
        // `active_only` is the no-binding case: the fragment is a
        // hard-coded SQL literal with no `$n` placeholder.
        let payload = BroadcastNotificationRequest {
            title: "t".to_string(),
            message: "m".to_string(),
            notification_type: None,
            tier_id: None,
            role: None,
            active_only: true,
            data: None,
        };
        let (where_clause, values) = build_broadcast_where_clause(&payload);
        assert_eq!(where_clause, "u.is_active = true");
        assert!(values.is_empty());
    }

    #[test]
    fn build_broadcast_where_clause_combines_filters_with_positional_binds() {
        // tier_id + role together → two positional parameters, with
        // `::uuid` and `::user_role` casts in the SQL fragment so
        // Postgres parses each bound string safely.
        let tier_id = Uuid::new_v4();
        let payload = BroadcastNotificationRequest {
            title: "t".to_string(),
            message: "m".to_string(),
            notification_type: None,
            tier_id: Some(tier_id),
            role: Some(UserRole::Admin),
            active_only: true,
            data: None,
        };
        let (where_clause, values) = build_broadcast_where_clause(&payload);
        assert_eq!(
            where_clause,
            "u.is_active = true AND ul.tier_id = $1::uuid AND u.role = $2::user_role"
        );
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], tier_id.to_string());
        assert_eq!(values[1], UserRole::Admin.to_string());
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

    // ------------------------------------------------------------------
    // MED-2 (security-2026-05-13.md): symmetric super_admin protection
    // on `delete_user`.
    //
    // The handler does two checks in sequence:
    //   (1) `require_super_admin` — only super_admins can hit this path
    //       at all. Regular admins are 403'd by the existing gate.
    //   (2) `deny_deactivation_if_super_admin` — even a super_admin
    //       cannot deactivate *another* super_admin, mirroring the
    //       role-demotion gate from #236.
    // ------------------------------------------------------------------

    #[test]
    fn delete_user_path_is_blocked_for_regular_admin_by_require_super_admin() {
        // The first check in `delete_user` is `require_super_admin`.
        // A regular admin must be rejected before any DB work happens.
        let admin = AuthUser {
            id: "admin-id".to_string(),
            email: Some("admin@example.com".to_string()),
            role: "admin".to_string(),
        };
        assert!(require_super_admin(&admin).is_err());

        // Sanity: a super_admin is allowed past the same gate, so the
        // outer guard is not over-blocking.
        let super_admin = AuthUser {
            id: "super-id".to_string(),
            email: Some("super@example.com".to_string()),
            role: "super_admin".to_string(),
        };
        assert!(require_super_admin(&super_admin).is_ok());
    }

    #[test]
    fn delete_user_super_admin_cannot_deactivate_another_super_admin() {
        // Even after `require_super_admin` passes, the inner role check
        // must reject a target whose role is `super_admin`. This is the
        // symmetric guard that pairs with the demotion gate in #236.
        let blocked = deny_deactivation_if_super_admin(&UserRole::SuperAdmin);
        assert!(blocked.is_err());
        match blocked {
            Err(AppError::Forbidden(msg)) => {
                assert!(
                    msg.contains("super_admin"),
                    "error message must mention super_admin so the admin UI can surface a useful reason"
                );
            },
            other => panic!("expected Forbidden, got {:?}", other),
        }

        // Conversely, deactivating a regular admin or customer is allowed.
        assert!(deny_deactivation_if_super_admin(&UserRole::Admin).is_ok());
        assert!(deny_deactivation_if_super_admin(&UserRole::Customer).is_ok());
    }
}
