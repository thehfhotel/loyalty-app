//! Loyalty routes
//!
//! Provides endpoints for loyalty program features including status,
//! transactions, and tier management.
//!
//! ## Endpoints
//!
//! - `GET /tiers` - Get all available loyalty tiers (public)
//! - `GET /status` - Get current user's loyalty status (authenticated)
//! - `GET /transactions` - Get user's transaction history (authenticated)
//! - `POST /award` - Award points to a user (admin only)
//! - `POST /recalculate/:user_id` - Recalculate user's tier (admin only)

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::db::Database;
use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::state::AppState;

// ============================================================================
// State (Legacy - for backwards compatibility)
// ============================================================================

/// Application state for loyalty routes (uses Database wrapper)
/// This is kept for backwards compatibility with older route configurations.
#[derive(Clone)]
pub struct LoyaltyState {
    pub db: Database,
}

impl LoyaltyState {
    /// Get a reference to the database connection pool
    pub fn pool(&self) -> &PgPool {
        self.db.pool()
    }
}

// ============================================================================
// Database Row Types
// ============================================================================

/// Tier row from database
#[derive(Debug, Clone, FromRow)]
pub struct TierRow {
    pub id: Uuid,
    pub name: String,
    pub min_points: i32,
    pub min_nights: i32,
    pub benefits: Option<JsonValue>,
    pub color: String,
    pub sort_order: i32,
    pub is_active: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// User loyalty row with tier join
#[derive(Debug, Clone, FromRow)]
pub struct UserLoyaltyWithTierRow {
    pub user_id: Uuid,
    pub current_points: Option<i32>,
    pub total_nights: Option<i32>,
    pub tier_id: Option<Uuid>,
    pub tier_updated_at: Option<DateTime<Utc>>,
    pub points_updated_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    // Tier fields from join
    pub tier_name: Option<String>,
    pub tier_min_points: Option<i32>,
    pub tier_min_nights: Option<i32>,
    pub tier_benefits: Option<JsonValue>,
    pub tier_color: Option<String>,
    pub tier_sort_order: Option<i32>,
}

/// Points transaction row from database
#[derive(Debug, Clone, FromRow)]
pub struct PointsTransactionRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub points: i32,
    #[sqlx(rename = "type")]
    pub transaction_type: String,
    pub description: Option<String>,
    pub reference_id: Option<String>,
    pub admin_user_id: Option<Uuid>,
    pub admin_reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub nights_stayed: Option<i32>,
}

// ============================================================================
// Response Types
// ============================================================================

/// API success response wrapper
#[derive(Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub data: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data,
            message: None,
        }
    }

    pub fn with_message(data: T, message: impl Into<String>) -> Self {
        Self {
            success: true,
            data,
            message: Some(message.into()),
        }
    }
}

/// Tier response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierResponse {
    pub id: Uuid,
    pub name: String,
    pub min_points: i32,
    pub min_nights: i32,
    pub benefits: JsonValue,
    pub color: String,
    pub sort_order: i32,
    pub is_active: bool,
}

impl From<TierRow> for TierResponse {
    fn from(row: TierRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            min_points: row.min_points,
            min_nights: row.min_nights,
            benefits: row.benefits.unwrap_or(serde_json::json!({})),
            color: row.color,
            sort_order: row.sort_order,
            is_active: row.is_active.unwrap_or(true),
        }
    }
}

/// User loyalty status response
#[derive(Debug, Clone, Serialize)]
pub struct LoyaltyStatusResponse {
    pub user_id: Uuid,
    pub current_points: i32,
    pub total_nights: i32,
    pub tier: Option<TierInfo>,
    pub tier_updated_at: Option<DateTime<Utc>>,
    pub points_updated_at: Option<DateTime<Utc>>,
    pub next_tier: Option<NextTierInfo>,
}

/// Tier info for loyalty status
#[derive(Debug, Clone, Serialize)]
pub struct TierInfo {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub benefits: JsonValue,
    pub min_nights: i32,
}

/// Next tier progress info
#[derive(Debug, Clone, Serialize)]
pub struct NextTierInfo {
    pub name: String,
    pub min_nights: i32,
    pub nights_needed: i32,
    pub progress_percentage: f32,
}

/// Points transaction response
#[derive(Debug, Clone, Serialize)]
pub struct PointsTransactionResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub points: i32,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub description: Option<String>,
    pub reference_id: Option<String>,
    pub admin_user_id: Option<Uuid>,
    pub admin_reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub nights_stayed: i32,
}

impl From<PointsTransactionRow> for PointsTransactionResponse {
    fn from(row: PointsTransactionRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            points: row.points,
            transaction_type: row.transaction_type,
            description: row.description,
            reference_id: row.reference_id,
            admin_user_id: row.admin_user_id,
            admin_reason: row.admin_reason,
            expires_at: row.expires_at,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            nights_stayed: row.nights_stayed.unwrap_or(0),
        }
    }
}

/// Paginated transactions response
#[derive(Debug, Clone, Serialize)]
pub struct PaginatedTransactionsResponse {
    pub transactions: Vec<PointsTransactionResponse>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

/// Award points result
#[derive(Debug, Clone, Serialize)]
pub struct AwardPointsResult {
    pub transaction_id: Uuid,
    pub points_awarded: i32,
    pub nights_added: i32,
    pub new_total_points: i32,
    pub new_total_nights: i32,
    pub tier_changed: bool,
    pub new_tier_name: Option<String>,
}

/// Recalculate tier result
#[derive(Debug, Clone, Serialize)]
pub struct RecalculateTierResult {
    pub user_id: Uuid,
    pub previous_tier: Option<String>,
    pub new_tier: String,
    pub tier_changed: bool,
    pub total_nights: i32,
}

// ============================================================================
// Request Types
// ============================================================================

/// Query params for transactions endpoint
#[derive(Debug, Deserialize)]
pub struct TransactionsQuery {
    #[serde(default = "default_page")]
    pub page: i32,
    #[serde(default = "default_limit")]
    pub limit: i32,
}

fn default_page() -> i32 {
    1
}

fn default_limit() -> i32 {
    20
}

fn default_offset() -> i32 {
    0
}

/// Award points request body
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwardPointsRequest {
    pub user_id: Uuid,
    pub points: i32,
    #[serde(default)]
    pub nights: i32,
    pub source: Option<String>,
    pub description: Option<String>,
}

// ============================================================================
// Admin Request Types
// ============================================================================

/// Query params for admin users list endpoint
#[derive(Debug, Deserialize)]
pub struct AdminUsersQuery {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(default = "default_offset")]
    pub offset: i32,
    pub search: Option<String>,
}

/// Query params for admin transactions endpoint
#[derive(Debug, Deserialize)]
pub struct AdminTransactionsQuery {
    #[serde(default = "default_limit")]
    pub limit: i32,
    #[serde(default = "default_offset")]
    pub offset: i32,
}

/// Admin award points request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAwardPointsRequest {
    pub user_id: Uuid,
    pub points: i32,
    pub description: Option<String>,
    pub reference_id: Option<String>,
}

/// Admin deduct points request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDeductPointsRequest {
    pub user_id: Uuid,
    pub points: i32,
    pub reason: String,
}

/// Admin award spending with nights request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAwardSpendingWithNightsRequest {
    pub user_id: Uuid,
    #[serde(default)]
    pub amount_spent: f64,
    #[serde(default)]
    pub nights_stayed: i32,
    pub reference_id: Option<String>,
    pub description: Option<String>,
}

/// Admin award nights request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAwardNightsRequest {
    pub user_id: Uuid,
    pub nights: i32,
    pub reason: String,
    pub reference_id: Option<String>,
}

/// Admin deduct nights request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDeductNightsRequest {
    pub user_id: Uuid,
    pub nights: i32,
    pub reason: String,
    pub reference_id: Option<String>,
}

// ============================================================================
// Admin Response Types
// ============================================================================

/// User loyalty status for admin list
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminUserLoyaltyRow {
    pub user_id: Uuid,
    pub current_points: Option<i32>,
    pub total_nights: Option<i32>,
    pub tier_name: Option<String>,
    pub tier_color: Option<String>,
    pub tier_benefits: Option<JsonValue>,
    pub tier_level: Option<i32>,
    pub progress_percentage: Option<f64>,
    pub next_tier_nights: Option<i32>,
    pub next_tier_name: Option<String>,
    pub nights_to_next_tier: Option<i32>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub membership_id: Option<String>,
    pub email: Option<String>,
    pub oauth_provider: Option<String>,
    pub oauth_provider_id: Option<String>,
    pub user_created_at: Option<DateTime<Utc>>,
}

/// Paginated admin users response
#[derive(Debug, Clone, Serialize)]
pub struct AdminUsersResponse {
    pub users: Vec<AdminUserLoyaltyRow>,
    pub total: i64,
}

/// Admin transaction row with user and admin info
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTransactionRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub points: i32,
    #[sqlx(rename = "type")]
    pub transaction_type: String,
    pub description: Option<String>,
    pub reference_id: Option<String>,
    pub admin_user_id: Option<Uuid>,
    pub admin_reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub nights_stayed: Option<i32>,
    pub user_email: Option<String>,
    pub user_membership_id: Option<String>,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
    pub admin_email: Option<String>,
    pub admin_first_name: Option<String>,
    pub admin_last_name: Option<String>,
    pub admin_membership_id: Option<String>,
}

/// Paginated admin transactions response
#[derive(Debug, Clone, Serialize)]
pub struct AdminTransactionsResponse {
    pub transactions: Vec<AdminTransactionRow>,
    pub total: i64,
}

/// Points earning rule row
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PointsEarningRuleRow {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub points_per_unit: f64,
    pub unit_type: String,
    pub multiplier_by_tier: Option<JsonValue>,
    pub is_active: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Expire points result
#[derive(Debug, Clone, Serialize)]
pub struct ExpirePointsResult {
    pub expired_count: i64,
}

/// Admin award/deduct result
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOperationResult {
    pub transaction_id: Uuid,
    pub loyalty_status: Option<LoyaltyStatusResponse>,
}

/// Admin nights operation result
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminNightsOperationResult {
    pub transaction_id: Uuid,
    pub new_total_nights: i32,
    pub new_tier_name: String,
    pub loyalty_status: Option<LoyaltyStatusResponse>,
}

/// Admin spending with nights result
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSpendingWithNightsResult {
    pub transaction_id: Uuid,
    pub points_earned: i32,
    pub new_total_nights: i32,
    pub new_tier_name: String,
    pub loyalty_status: Option<LoyaltyStatusResponse>,
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /loyalty/tiers
/// Get all available loyalty tiers (public endpoint)
async fn get_tiers(
    State(state): State<LoyaltyState>,
) -> Result<Json<ApiResponse<Vec<TierResponse>>>, AppError> {
    let tiers: Vec<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE is_active = true
        ORDER BY sort_order ASC
        "#,
    )
    .fetch_all(state.db.pool())
    .await?;

    let tier_responses: Vec<TierResponse> = tiers.into_iter().map(TierResponse::from).collect();

    Ok(Json(ApiResponse::success(tier_responses)))
}

/// GET /loyalty/status
/// Get current user's loyalty status (requires authentication)
async fn get_status(
    State(state): State<LoyaltyState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiResponse<LoyaltyStatusResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Get user loyalty with tier info
    let loyalty: Option<UserLoyaltyWithTierRow> = sqlx::query_as(
        r#"
        SELECT
            ul.user_id,
            ul.current_points,
            ul.total_nights,
            ul.tier_id,
            ul.tier_updated_at,
            ul.points_updated_at,
            ul.created_at,
            ul.updated_at,
            t.name as tier_name,
            t.min_points as tier_min_points,
            t.min_nights as tier_min_nights,
            t.benefits as tier_benefits,
            t.color as tier_color,
            t.sort_order as tier_sort_order
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(state.db.pool())
    .await?;

    let loyalty =
        loyalty.ok_or_else(|| AppError::NotFound("Loyalty status not found".to_string()))?;

    // Build tier info if present
    let tier_info =
        if let (Some(tier_id), Some(tier_name)) = (loyalty.tier_id, loyalty.tier_name.clone()) {
            Some(TierInfo {
                id: tier_id,
                name: tier_name,
                color: loyalty
                    .tier_color
                    .clone()
                    .unwrap_or_else(|| "#CD7F32".to_string()),
                benefits: loyalty
                    .tier_benefits
                    .clone()
                    .unwrap_or(serde_json::json!({})),
                min_nights: loyalty.tier_min_nights.unwrap_or(0),
            })
        } else {
            None
        };

    // Calculate next tier info
    let current_nights = loyalty.total_nights.unwrap_or(0);
    let next_tier_info = get_next_tier_info(state.db.pool(), current_nights).await?;

    let response = LoyaltyStatusResponse {
        user_id: loyalty.user_id,
        current_points: loyalty.current_points.unwrap_or(0),
        total_nights: current_nights,
        tier: tier_info,
        tier_updated_at: loyalty.tier_updated_at,
        points_updated_at: loyalty.points_updated_at,
        next_tier: next_tier_info,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// Helper to get next tier info
async fn get_next_tier_info(
    pool: &PgPool,
    current_nights: i32,
) -> Result<Option<NextTierInfo>, AppError> {
    let next_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights > $1 AND is_active = true
        ORDER BY min_nights ASC
        LIMIT 1
        "#,
    )
    .bind(current_nights)
    .fetch_optional(pool)
    .await?;

    Ok(next_tier.map(|tier| {
        let nights_needed = tier.min_nights - current_nights;
        let progress = if tier.min_nights > 0 {
            (current_nights as f32 / tier.min_nights as f32) * 100.0
        } else {
            100.0
        };

        NextTierInfo {
            name: tier.name,
            min_nights: tier.min_nights,
            nights_needed,
            progress_percentage: progress.min(100.0),
        }
    }))
}

/// GET /loyalty/transactions
/// Get user's points transaction history (requires authentication)
async fn get_transactions(
    State(state): State<LoyaltyState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<TransactionsQuery>,
) -> Result<Json<ApiResponse<PaginatedTransactionsResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let page = params.page.max(1);
    let limit = params.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    // Get total count
    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM points_transactions WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(state.db.pool())
            .await?;

    // Get transactions
    let transactions: Vec<PointsTransactionRow> = sqlx::query_as(
        r#"
        SELECT
            id, user_id, points, type::text as type, description, reference_id,
            admin_user_id, admin_reason, expires_at, created_at, nights_stayed
        FROM points_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(state.db.pool())
    .await?;

    let transaction_responses: Vec<PointsTransactionResponse> = transactions
        .into_iter()
        .map(PointsTransactionResponse::from)
        .collect();

    let total_pages = ((total.0 as f64) / (limit as f64)).ceil() as i32;

    let response = PaginatedTransactionsResponse {
        transactions: transaction_responses,
        total: total.0,
        page,
        limit,
        total_pages,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /loyalty/award
/// Award points to a user (admin only)
async fn award_points(
    State(state): State<LoyaltyState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AwardPointsRequest>,
) -> Result<Json<ApiResponse<AwardPointsResult>>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    // Validate points
    if payload.points <= 0 && payload.nights <= 0 {
        return Err(AppError::Validation(
            "Points or nights must be greater than 0".to_string(),
        ));
    }

    // Start transaction
    let mut tx = state.db.pool().begin().await?;

    // Get current user loyalty
    let current_loyalty: Option<(Option<i32>, Option<i32>, Option<Uuid>)> = sqlx::query_as(
        "SELECT current_points, total_nights, tier_id FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (old_points, old_nights, old_tier_id) = current_loyalty
        .ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?;

    let old_points = old_points.unwrap_or(0);
    let old_nights = old_nights.unwrap_or(0);

    // Create points transaction
    let transaction_type = payload.source.as_deref().unwrap_or("admin_award");
    let description = payload
        .description
        .clone()
        .unwrap_or_else(|| "Points awarded by admin".to_string());

    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (user_id, points, type, description, admin_user_id, admin_reason, nights_stayed)
        VALUES ($1, $2, $3::points_transaction_type, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(payload.points)
    .bind(transaction_type)
    .bind(&description)
    .bind(admin_user_id)
    .bind(&description)
    .bind(payload.nights)
    .fetch_one(&mut *tx)
    .await?;

    // Update user loyalty
    let new_points = old_points + payload.points;
    let new_nights = old_nights + payload.nights;

    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET current_points = $1,
            total_nights = $2,
            points_updated_at = NOW(),
            updated_at = NOW()
        WHERE user_id = $3
        "#,
    )
    .bind(new_points)
    .bind(new_nights)
    .bind(payload.user_id)
    .execute(&mut *tx)
    .await?;

    // Recalculate tier based on nights
    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(new_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let (_new_tier_id, new_tier_name, tier_changed) = if let Some(tier) = new_tier {
        let changed = old_tier_id != Some(tier.id);
        if changed {
            sqlx::query(
                "UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW() WHERE user_id = $2",
            )
            .bind(tier.id)
            .bind(payload.user_id)
            .execute(&mut *tx)
            .await?;
        }
        (Some(tier.id), Some(tier.name), changed)
    } else {
        (old_tier_id, None, false)
    };

    tx.commit().await?;

    let result = AwardPointsResult {
        transaction_id: transaction_id.0,
        points_awarded: payload.points,
        nights_added: payload.nights,
        new_total_points: new_points,
        new_total_nights: new_nights,
        tier_changed,
        new_tier_name,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Points awarded successfully",
    )))
}

/// POST /loyalty/recalculate/:userId
/// Recalculate user's tier based on nights (admin only)
async fn recalculate_tier(
    State(state): State<LoyaltyState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<ApiResponse<RecalculateTierResult>>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    // Start transaction
    let mut tx = state.db.pool().begin().await?;

    // Get current user loyalty with tier name
    let current: Option<(Option<i32>, Option<Uuid>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT ul.total_nights, ul.tier_id, t.name
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (total_nights, old_tier_id, old_tier_name) =
        current.ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?;

    let total_nights = total_nights.unwrap_or(0);

    // Find appropriate tier based on nights
    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(total_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let new_tier = new_tier
        .ok_or_else(|| AppError::Internal("No tier found for user's night count".to_string()))?;

    let tier_changed = old_tier_id != Some(new_tier.id);

    // Update tier if changed
    if tier_changed {
        sqlx::query(
            r#"
            UPDATE user_loyalty
            SET tier_id = $1, tier_updated_at = NOW(), updated_at = NOW()
            WHERE user_id = $2
            "#,
        )
        .bind(new_tier.id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let result = RecalculateTierResult {
        user_id,
        previous_tier: old_tier_name,
        new_tier: new_tier.name,
        tier_changed,
        total_nights,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        if tier_changed {
            "Tier recalculated and updated"
        } else {
            "Tier recalculated, no change needed"
        },
    )))
}

// ============================================================================
// Router
// ============================================================================

/// Create loyalty routes for use with the main router
///
/// These routes are intended to be nested under /api/loyalty via the main router.
/// They use the shared AppState which includes the database connection pool.
///
/// ## Endpoints
///
/// ### Public Routes
/// - `GET /tiers` - Get all available loyalty tiers (public)
///
/// ### Authenticated Routes
/// - `GET /status` - Get current user's loyalty status (authenticated)
/// - `GET /transactions` - Get user's transaction history (authenticated)
/// - `POST /award` - Award points to a user (admin only)
/// - `POST /recalculate/:user_id` - Recalculate user's tier (admin only)
///
/// ### Admin Routes (require admin role)
/// - `GET /admin/users` - List all users' loyalty status with pagination
/// - `POST /admin/award-points` - Award points to user
/// - `POST /admin/deduct-points` - Deduct points from user
/// - `GET /admin/transactions` - Get all admin transactions with pagination
/// - `GET /admin/user/:userId/history` - Get specific user's history
/// - `GET /admin/earning-rules` - Get earning rules config
/// - `POST /admin/expire-points` - Trigger points expiration
/// - `POST /admin/award-spending-with-nights` - Award based on spending + nights
/// - `POST /admin/award-nights` - Award nights only
/// - `POST /admin/deduct-nights` - Deduct nights only
pub fn routes() -> Router<AppState> {
    // Public routes (no auth required) - tiers can be viewed by anyone
    let public_routes = Router::new().route("/tiers", get(get_tiers_full));

    // Authenticated routes - require valid JWT token
    let auth_routes = Router::new()
        .route("/status", get(get_status_full))
        .route("/transactions", get(get_transactions_full))
        .route("/award", post(award_points_full))
        .route("/recalculate/:user_id", post(recalculate_tier_full))
        .layer(middleware::from_fn(auth_middleware));

    // Admin routes - nested under /admin, require auth + admin role
    let admin_routes = Router::new()
        .route("/admin/users", get(admin_get_users))
        .route("/admin/award-points", post(admin_award_points))
        .route("/admin/deduct-points", post(admin_deduct_points))
        .route("/admin/transactions", get(admin_get_transactions))
        .route("/admin/user/:userId/history", get(admin_get_user_history))
        .route("/admin/earning-rules", get(admin_get_earning_rules))
        .route("/admin/expire-points", post(admin_expire_points))
        .route(
            "/admin/award-spending-with-nights",
            post(admin_award_spending_with_nights),
        )
        .route("/admin/award-nights", post(admin_award_nights))
        .route("/admin/deduct-nights", post(admin_deduct_nights))
        .layer(middleware::from_fn(auth_middleware));

    public_routes.merge(auth_routes).merge(admin_routes)
}

/// Create loyalty routes with stubs (for development/testing without database)
///
/// Returns routes that return "not implemented" responses.
pub fn routes_stub() -> Router {
    Router::new()
        .route("/tiers", get(get_tiers_stub))
        .route("/status", get(get_status_stub))
        .route("/transactions", get(get_transactions_stub))
        .route("/award", post(award_points_stub))
        .route("/recalculate/:user_id", post(recalculate_tier_stub))
}

/// Create loyalty routes with LoyaltyState (uses Database wrapper)
///
/// These routes are intended to be nested under /api/loyalty via the main router.
pub fn routes_with_state(state: LoyaltyState) -> Router {
    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/tiers", get(get_tiers))
        .with_state(state.clone());

    // Authenticated routes
    let auth_routes = Router::new()
        .route("/status", get(get_status))
        .route("/transactions", get(get_transactions))
        .route("/award", post(award_points))
        .route("/recalculate/:user_id", post(recalculate_tier))
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state);

    Router::new().merge(public_routes).merge(auth_routes)
}

// ============================================================================
// Handlers for AppState (state::AppState with PgPool)
// ============================================================================

/// GET /tiers - using AppState
async fn get_tiers_full(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<TierResponse>>>, AppError> {
    let tiers: Vec<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE is_active = true
        ORDER BY sort_order ASC
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let tier_responses: Vec<TierResponse> = tiers.into_iter().map(TierResponse::from).collect();

    Ok(Json(ApiResponse::success(tier_responses)))
}

/// GET /loyalty/status - using FullAppState
async fn get_status_full(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiResponse<LoyaltyStatusResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let loyalty: Option<UserLoyaltyWithTierRow> = sqlx::query_as(
        r#"
        SELECT
            ul.user_id, ul.current_points, ul.total_nights, ul.tier_id,
            ul.tier_updated_at, ul.points_updated_at, ul.created_at, ul.updated_at,
            t.name as tier_name, t.min_points as tier_min_points,
            t.min_nights as tier_min_nights, t.benefits as tier_benefits,
            t.color as tier_color, t.sort_order as tier_sort_order
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(state.db())
    .await?;

    let loyalty =
        loyalty.ok_or_else(|| AppError::NotFound("Loyalty status not found".to_string()))?;

    let tier_info =
        if let (Some(tier_id), Some(tier_name)) = (loyalty.tier_id, loyalty.tier_name.clone()) {
            Some(TierInfo {
                id: tier_id,
                name: tier_name,
                color: loyalty
                    .tier_color
                    .clone()
                    .unwrap_or_else(|| "#CD7F32".to_string()),
                benefits: loyalty
                    .tier_benefits
                    .clone()
                    .unwrap_or(serde_json::json!({})),
                min_nights: loyalty.tier_min_nights.unwrap_or(0),
            })
        } else {
            None
        };

    let current_nights = loyalty.total_nights.unwrap_or(0);
    let next_tier_info = get_next_tier_info(state.db(), current_nights).await?;

    let response = LoyaltyStatusResponse {
        user_id: loyalty.user_id,
        current_points: loyalty.current_points.unwrap_or(0),
        total_nights: current_nights,
        tier: tier_info,
        tier_updated_at: loyalty.tier_updated_at,
        points_updated_at: loyalty.points_updated_at,
        next_tier: next_tier_info,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /loyalty/transactions - using FullAppState
async fn get_transactions_full(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<TransactionsQuery>,
) -> Result<Json<ApiResponse<PaginatedTransactionsResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let page = params.page.max(1);
    let limit = params.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM points_transactions WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(state.db())
            .await?;

    let transactions: Vec<PointsTransactionRow> = sqlx::query_as(
        r#"
        SELECT id, user_id, points, type::text as type, description, reference_id,
               admin_user_id, admin_reason, expires_at, created_at, nights_stayed
        FROM points_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let transaction_responses: Vec<PointsTransactionResponse> = transactions
        .into_iter()
        .map(PointsTransactionResponse::from)
        .collect();

    let total_pages = ((total.0 as f64) / (limit as f64)).ceil() as i32;

    let response = PaginatedTransactionsResponse {
        transactions: transaction_responses,
        total: total.0,
        page,
        limit,
        total_pages,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /loyalty/award - using FullAppState
async fn award_points_full(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AwardPointsRequest>,
) -> Result<Json<ApiResponse<AwardPointsResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    if payload.points <= 0 && payload.nights <= 0 {
        return Err(AppError::Validation(
            "Points or nights must be greater than 0".to_string(),
        ));
    }

    let mut tx = state.db().begin().await?;

    let current_loyalty: Option<(Option<i32>, Option<i32>, Option<Uuid>)> = sqlx::query_as(
        "SELECT current_points, total_nights, tier_id FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (old_points, old_nights, old_tier_id) = current_loyalty
        .ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?;

    let old_points = old_points.unwrap_or(0);
    let old_nights = old_nights.unwrap_or(0);

    let transaction_type = payload.source.as_deref().unwrap_or("admin_award");
    let description = payload
        .description
        .clone()
        .unwrap_or_else(|| "Points awarded by admin".to_string());

    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (user_id, points, type, description, admin_user_id, admin_reason, nights_stayed)
        VALUES ($1, $2, $3::points_transaction_type, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(payload.points)
    .bind(transaction_type)
    .bind(&description)
    .bind(admin_user_id)
    .bind(&description)
    .bind(payload.nights)
    .fetch_one(&mut *tx)
    .await?;

    let new_points = old_points + payload.points;
    let new_nights = old_nights + payload.nights;

    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET current_points = $1, total_nights = $2, points_updated_at = NOW(), updated_at = NOW()
        WHERE user_id = $3
        "#,
    )
    .bind(new_points)
    .bind(new_nights)
    .bind(payload.user_id)
    .execute(&mut *tx)
    .await?;

    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(new_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let (_, new_tier_name, tier_changed) = if let Some(tier) = new_tier {
        let changed = old_tier_id != Some(tier.id);
        if changed {
            sqlx::query(
                "UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW() WHERE user_id = $2",
            )
            .bind(tier.id)
            .bind(payload.user_id)
            .execute(&mut *tx)
            .await?;
        }
        (Some(tier.id), Some(tier.name), changed)
    } else {
        (old_tier_id, None, false)
    };

    tx.commit().await?;

    let result = AwardPointsResult {
        transaction_id: transaction_id.0,
        points_awarded: payload.points,
        nights_added: payload.nights,
        new_total_points: new_points,
        new_total_nights: new_nights,
        tier_changed,
        new_tier_name,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Points awarded successfully",
    )))
}

/// POST /loyalty/recalculate/:userId - using FullAppState
async fn recalculate_tier_full(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<ApiResponse<RecalculateTierResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let mut tx = state.db().begin().await?;

    let current: Option<(Option<i32>, Option<Uuid>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT ul.total_nights, ul.tier_id, t.name
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (total_nights, old_tier_id, old_tier_name) =
        current.ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?;

    let total_nights = total_nights.unwrap_or(0);

    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(total_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let new_tier = new_tier
        .ok_or_else(|| AppError::Internal("No tier found for user's night count".to_string()))?;

    let tier_changed = old_tier_id != Some(new_tier.id);

    if tier_changed {
        sqlx::query(
            "UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW(), updated_at = NOW() WHERE user_id = $2",
        )
        .bind(new_tier.id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let result = RecalculateTierResult {
        user_id,
        previous_tier: old_tier_name,
        new_tier: new_tier.name,
        tier_changed,
        total_nights,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        if tier_changed {
            "Tier recalculated and updated"
        } else {
            "Tier recalculated, no change needed"
        },
    )))
}

// ============================================================================
// Admin Handlers (AppState)
// ============================================================================

/// Helper function to get user's loyalty status
async fn get_user_loyalty_status_internal(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<LoyaltyStatusResponse>, AppError> {
    let loyalty: Option<UserLoyaltyWithTierRow> = sqlx::query_as(
        r#"
        SELECT
            ul.user_id, ul.current_points, ul.total_nights, ul.tier_id,
            ul.tier_updated_at, ul.points_updated_at, ul.created_at, ul.updated_at,
            t.name as tier_name, t.min_points as tier_min_points,
            t.min_nights as tier_min_nights, t.benefits as tier_benefits,
            t.color as tier_color, t.sort_order as tier_sort_order
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    match loyalty {
        Some(loyalty) => {
            let tier_info = if let (Some(tier_id), Some(tier_name)) =
                (loyalty.tier_id, loyalty.tier_name.clone())
            {
                Some(TierInfo {
                    id: tier_id,
                    name: tier_name,
                    color: loyalty
                        .tier_color
                        .clone()
                        .unwrap_or_else(|| "#CD7F32".to_string()),
                    benefits: loyalty
                        .tier_benefits
                        .clone()
                        .unwrap_or(serde_json::json!({})),
                    min_nights: loyalty.tier_min_nights.unwrap_or(0),
                })
            } else {
                None
            };

            let current_nights = loyalty.total_nights.unwrap_or(0);
            let next_tier_info = get_next_tier_info(pool, current_nights).await?;

            Ok(Some(LoyaltyStatusResponse {
                user_id: loyalty.user_id,
                current_points: loyalty.current_points.unwrap_or(0),
                total_nights: current_nights,
                tier: tier_info,
                tier_updated_at: loyalty.tier_updated_at,
                points_updated_at: loyalty.points_updated_at,
                next_tier: next_tier_info,
            }))
        }
        None => Ok(None),
    }
}

/// GET /loyalty/admin/users - Get all users' loyalty status (admin only)
async fn admin_get_users(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AdminUsersQuery>,
) -> Result<Json<ApiResponse<AdminUsersResponse>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let limit = params.limit.clamp(1, 100);
    let offset = params.offset.max(0);

    // Build query based on search term
    let (users, total) = if let Some(ref search) = params.search {
        let search_pattern = format!("%{}%", search);
        let users: Vec<AdminUserLoyaltyRow> = sqlx::query_as(
            r#"
            SELECT
                ul.user_id,
                ul.current_points,
                ul.total_nights,
                t.name as tier_name,
                t.color as tier_color,
                t.benefits as tier_benefits,
                t.sort_order as tier_level,
                CASE
                    WHEN next_tier.min_nights IS NOT NULL
                    THEN ROUND((ul.total_nights::numeric / next_tier.min_nights) * 100)
                    ELSE 100
                END as progress_percentage,
                next_tier.min_nights as next_tier_nights,
                next_tier.name as next_tier_name,
                CASE
                    WHEN next_tier.min_nights IS NOT NULL
                    THEN (next_tier.min_nights - ul.total_nights)
                    ELSE NULL
                END as nights_to_next_tier,
                up.first_name,
                up.last_name,
                up.phone,
                up.membership_id,
                u.email,
                u.oauth_provider,
                u.oauth_provider_id,
                u.created_at as user_created_at
            FROM user_loyalty ul
            JOIN tiers t ON ul.tier_id = t.id
            LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
            JOIN users u ON ul.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE (u.email ILIKE $1 OR up.first_name ILIKE $1 OR up.last_name ILIKE $1
                   OR u.id::text ILIKE $1 OR up.membership_id ILIKE $1 OR up.phone ILIKE $1)
            ORDER BY ul.total_nights DESC, ul.current_points DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(&search_pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(state.db())
        .await?;

        let total: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM user_loyalty ul
            JOIN users u ON ul.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE (u.email ILIKE $1 OR up.first_name ILIKE $1 OR up.last_name ILIKE $1
                   OR u.id::text ILIKE $1 OR up.membership_id ILIKE $1 OR up.phone ILIKE $1)
            "#,
        )
        .bind(&search_pattern)
        .fetch_one(state.db())
        .await?;

        (users, total.0)
    } else {
        let users: Vec<AdminUserLoyaltyRow> = sqlx::query_as(
            r#"
            SELECT
                ul.user_id,
                ul.current_points,
                ul.total_nights,
                t.name as tier_name,
                t.color as tier_color,
                t.benefits as tier_benefits,
                t.sort_order as tier_level,
                CASE
                    WHEN next_tier.min_nights IS NOT NULL
                    THEN ROUND((ul.total_nights::numeric / next_tier.min_nights) * 100)
                    ELSE 100
                END as progress_percentage,
                next_tier.min_nights as next_tier_nights,
                next_tier.name as next_tier_name,
                CASE
                    WHEN next_tier.min_nights IS NOT NULL
                    THEN (next_tier.min_nights - ul.total_nights)
                    ELSE NULL
                END as nights_to_next_tier,
                up.first_name,
                up.last_name,
                up.phone,
                up.membership_id,
                u.email,
                u.oauth_provider,
                u.oauth_provider_id,
                u.created_at as user_created_at
            FROM user_loyalty ul
            JOIN tiers t ON ul.tier_id = t.id
            LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
            JOIN users u ON ul.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            ORDER BY ul.total_nights DESC, ul.current_points DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(state.db())
        .await?;

        let total: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM user_loyalty")
                .fetch_one(state.db())
                .await?;

        (users, total.0)
    };

    let response = AdminUsersResponse { users, total };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /loyalty/admin/award-points - Award points to a user (admin only)
async fn admin_award_points(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AdminAwardPointsRequest>,
) -> Result<Json<ApiResponse<AdminOperationResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    if payload.points <= 0 {
        return Err(AppError::Validation(
            "Points must be greater than 0".to_string(),
        ));
    }

    let description = payload
        .description
        .clone()
        .unwrap_or_else(|| "Points awarded by admin".to_string());

    let admin_reason = format!("Points awarded by admin user {}", admin_user_id);

    // Create points transaction using award_points stored procedure if available,
    // or direct insert
    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (user_id, points, type, description, reference_id, admin_user_id, admin_reason)
        VALUES ($1, $2, 'admin_award'::points_transaction_type, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(payload.points)
    .bind(&description)
    .bind(&payload.reference_id)
    .bind(admin_user_id)
    .bind(&admin_reason)
    .fetch_one(state.db())
    .await?;

    // Update user loyalty points
    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET current_points = current_points + $1,
            points_updated_at = NOW(),
            updated_at = NOW()
        WHERE user_id = $2
        "#,
    )
    .bind(payload.points)
    .bind(payload.user_id)
    .execute(state.db())
    .await?;

    // Get updated loyalty status
    let loyalty_status = get_user_loyalty_status_internal(state.db(), payload.user_id).await?;

    let result = AdminOperationResult {
        transaction_id: transaction_id.0,
        loyalty_status,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Points awarded successfully",
    )))
}

/// POST /loyalty/admin/deduct-points - Deduct points from a user (admin only)
async fn admin_deduct_points(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AdminDeductPointsRequest>,
) -> Result<Json<ApiResponse<AdminOperationResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    if payload.points <= 0 {
        return Err(AppError::Validation(
            "Points must be greater than 0".to_string(),
        ));
    }

    // Check if user has enough points
    let current: Option<(Option<i32>,)> = sqlx::query_as(
        "SELECT current_points FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_optional(state.db())
    .await?;

    let current_points = current
        .ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?
        .0
        .unwrap_or(0);

    if current_points < payload.points {
        return Err(AppError::Validation(
            "Insufficient points for deduction".to_string(),
        ));
    }

    let description = format!("Points deducted by admin: {}", payload.reason);

    // Create points transaction with negative points
    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (user_id, points, type, description, admin_user_id, admin_reason)
        VALUES ($1, $2, 'admin_deduction'::points_transaction_type, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(-payload.points) // Negative for deduction
    .bind(&description)
    .bind(admin_user_id)
    .bind(&payload.reason)
    .fetch_one(state.db())
    .await?;

    // Update user loyalty points
    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET current_points = current_points - $1,
            points_updated_at = NOW(),
            updated_at = NOW()
        WHERE user_id = $2
        "#,
    )
    .bind(payload.points)
    .bind(payload.user_id)
    .execute(state.db())
    .await?;

    // Get updated loyalty status
    let loyalty_status = get_user_loyalty_status_internal(state.db(), payload.user_id).await?;

    let result = AdminOperationResult {
        transaction_id: transaction_id.0,
        loyalty_status,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Points deducted successfully",
    )))
}

/// GET /loyalty/admin/transactions - Get all admin transactions (admin only)
async fn admin_get_transactions(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<AdminTransactionsQuery>,
) -> Result<Json<ApiResponse<AdminTransactionsResponse>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let limit = params.limit.clamp(1, 100);
    let offset = params.offset.max(0);

    let transactions: Vec<AdminTransactionRow> = sqlx::query_as(
        r#"
        SELECT
            pt.id,
            pt.user_id,
            pt.points,
            pt.type::text as type,
            pt.description,
            pt.reference_id,
            pt.admin_user_id,
            pt.admin_reason,
            pt.expires_at,
            pt.created_at,
            pt.nights_stayed,
            u.email as user_email,
            up.membership_id as user_membership_id,
            up.first_name as user_first_name,
            up.last_name as user_last_name,
            admin.email as admin_email,
            admin_profile.first_name as admin_first_name,
            admin_profile.last_name as admin_last_name,
            admin_profile.membership_id as admin_membership_id
        FROM points_transactions pt
        LEFT JOIN users u ON pt.user_id = u.id
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LEFT JOIN users admin ON pt.admin_user_id = admin.id
        LEFT JOIN user_profiles admin_profile ON admin.id = admin_profile.user_id
        WHERE pt.type IN ('admin_award', 'admin_deduction', 'earned_stay')
        ORDER BY pt.created_at DESC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM points_transactions
        WHERE type IN ('admin_award', 'admin_deduction', 'earned_stay')
        "#,
    )
    .fetch_one(state.db())
    .await?;

    let response = AdminTransactionsResponse {
        transactions,
        total: total.0,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /loyalty/admin/user/:userId/history - Get user's points history (admin only)
async fn admin_get_user_history(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Query(params): Query<AdminTransactionsQuery>,
) -> Result<Json<ApiResponse<PaginatedTransactionsResponse>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let limit = params.limit.clamp(1, 100);
    let offset = params.offset.max(0);

    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM points_transactions WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(state.db())
            .await?;

    let transactions: Vec<PointsTransactionRow> = sqlx::query_as(
        r#"
        SELECT id, user_id, points, type::text as type, description, reference_id,
               admin_user_id, admin_reason, expires_at, created_at, nights_stayed
        FROM points_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let transaction_responses: Vec<PointsTransactionResponse> = transactions
        .into_iter()
        .map(PointsTransactionResponse::from)
        .collect();

    // Calculate pagination info
    let page = (offset / limit) + 1;
    let total_pages = ((total.0 as f64) / (limit as f64)).ceil() as i32;

    let response = PaginatedTransactionsResponse {
        transactions: transaction_responses,
        total: total.0,
        page,
        limit,
        total_pages,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /loyalty/admin/earning-rules - Get points earning rules (admin only)
async fn admin_get_earning_rules(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiResponse<Vec<PointsEarningRuleRow>>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let rules: Vec<PointsEarningRuleRow> = sqlx::query_as(
        r#"
        SELECT id, name, description, points_per_unit, unit_type, multiplier_by_tier,
               is_active, created_at, updated_at
        FROM points_earning_rules
        WHERE is_active = true
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(state.db())
    .await?;

    Ok(Json(ApiResponse::success(rules)))
}

/// POST /loyalty/admin/expire-points - Trigger points expiration (admin only)
async fn admin_expire_points(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiResponse<ExpirePointsResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    // Expire points and create negative transactions
    let result = sqlx::query(
        r#"
        INSERT INTO points_transactions (user_id, points, type, description, created_at)
        SELECT
            user_id,
            -points,
            'expired'::points_transaction_type,
            'Points expired automatically',
            NOW()
        FROM points_transactions
        WHERE expires_at <= NOW()
        AND points > 0
        AND id NOT IN (
            SELECT reference_id::UUID
            FROM points_transactions
            WHERE type = 'expired'
            AND reference_id IS NOT NULL
        )
        "#,
    )
    .execute(state.db())
    .await?;

    let expired_count = result.rows_affected() as i64;

    Ok(Json(ApiResponse::with_message(
        ExpirePointsResult { expired_count },
        format!("Expired points for {} transactions", expired_count),
    )))
}

/// POST /loyalty/admin/award-spending-with-nights - Award spending points with nights (admin only)
async fn admin_award_spending_with_nights(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AdminAwardSpendingWithNightsRequest>,
) -> Result<Json<ApiResponse<AdminSpendingWithNightsResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    if payload.amount_spent == 0.0 && payload.nights_stayed == 0 {
        return Err(AppError::Validation(
            "At least one of amount spent or nights stayed must be provided".to_string(),
        ));
    }

    // Calculate points (10 points per 1 THB spent)
    let points_earned = (payload.amount_spent * 10.0).floor() as i32;

    let description = payload.description.clone().unwrap_or_else(|| {
        format!(
            "Hotel stay: {} night(s), {:.2} THB spent",
            payload.nights_stayed, payload.amount_spent
        )
    });

    let reference_id = payload
        .reference_id
        .clone()
        .unwrap_or_else(|| format!("STAY-{}", chrono::Utc::now().timestamp_millis()));

    let admin_reason = format!(
        "Admin {} awarded {} nights and {:.2} THB spending",
        auth_user.email.as_deref().unwrap_or("unknown"),
        payload.nights_stayed,
        payload.amount_spent
    );

    // Determine transaction type based on whether it's adding or removing
    let transaction_type = if payload.nights_stayed < 0 || points_earned < 0 {
        "admin_deduction"
    } else {
        "earned_stay"
    };

    let mut tx = state.db().begin().await?;

    // Ensure user has loyalty status
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights)
        SELECT $1, t.id, 0, 0
        FROM tiers t
        WHERE t.name = 'Bronze'
        ON CONFLICT (user_id) DO NOTHING
        "#,
    )
    .bind(payload.user_id)
    .execute(&mut *tx)
    .await?;

    // Create points transaction
    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (
            user_id, points, type, description, reference_id, nights_stayed,
            admin_user_id, admin_reason, created_at, expires_at
        ) VALUES ($1, $2, $3::points_transaction_type, $4, $5, $6, $7, $8, NOW(), NOW() + INTERVAL '1 year')
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(points_earned)
    .bind(transaction_type)
    .bind(&description)
    .bind(&reference_id)
    .bind(payload.nights_stayed)
    .bind(admin_user_id)
    .bind(&admin_reason)
    .fetch_one(&mut *tx)
    .await?;

    // Update user_loyalty: add points and nights
    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET current_points = current_points + $2,
            total_nights = total_nights + $3,
            updated_at = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(payload.user_id)
    .bind(points_earned)
    .bind(payload.nights_stayed)
    .execute(&mut *tx)
    .await?;

    // Get updated total nights
    let loyalty: (Option<i32>,) = sqlx::query_as(
        "SELECT total_nights FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_one(&mut *tx)
    .await?;
    let new_total_nights = loyalty.0.unwrap_or(0);

    // Recalculate tier based on nights
    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(new_total_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let new_tier_name = if let Some(tier) = &new_tier {
        // Update tier
        sqlx::query(
            "UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW() WHERE user_id = $2",
        )
        .bind(tier.id)
        .bind(payload.user_id)
        .execute(&mut *tx)
        .await?;
        tier.name.clone()
    } else {
        "Bronze".to_string()
    };

    tx.commit().await?;

    // Get updated loyalty status
    let loyalty_status = get_user_loyalty_status_internal(state.db(), payload.user_id).await?;

    let result = AdminSpendingWithNightsResult {
        transaction_id: transaction_id.0,
        points_earned,
        new_total_nights,
        new_tier_name,
        loyalty_status,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Spending points and nights awarded successfully",
    )))
}

/// POST /loyalty/admin/award-nights - Award nights only (admin only)
async fn admin_award_nights(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AdminAwardNightsRequest>,
) -> Result<Json<ApiResponse<AdminNightsOperationResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    if payload.nights <= 0 {
        return Err(AppError::Validation(
            "Nights must be greater than 0".to_string(),
        ));
    }

    let description = format!("Admin awarded {} night(s)", payload.nights);

    let mut tx = state.db().begin().await?;

    // Ensure user has loyalty status
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights)
        SELECT $1, t.id, 0, 0
        FROM tiers t
        WHERE t.name = 'Bronze'
        ON CONFLICT (user_id) DO NOTHING
        "#,
    )
    .bind(payload.user_id)
    .execute(&mut *tx)
    .await?;

    // Create points transaction (0 points, only nights)
    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (
            user_id, points, type, description, reference_id, nights_stayed,
            admin_user_id, admin_reason, created_at
        ) VALUES ($1, 0, 'earned_stay'::points_transaction_type, $2, $3, $4, $5, $6, NOW())
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(&description)
    .bind(&payload.reference_id)
    .bind(payload.nights)
    .bind(admin_user_id)
    .bind(&payload.reason)
    .fetch_one(&mut *tx)
    .await?;

    // Update user_loyalty: add nights only
    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET total_nights = total_nights + $2,
            updated_at = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(payload.user_id)
    .bind(payload.nights)
    .execute(&mut *tx)
    .await?;

    // Get updated total nights
    let loyalty: (Option<i32>,) = sqlx::query_as(
        "SELECT total_nights FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_one(&mut *tx)
    .await?;
    let new_total_nights = loyalty.0.unwrap_or(0);

    // Recalculate tier based on nights
    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(new_total_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let new_tier_name = if let Some(tier) = &new_tier {
        sqlx::query(
            "UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW() WHERE user_id = $2",
        )
        .bind(tier.id)
        .bind(payload.user_id)
        .execute(&mut *tx)
        .await?;
        tier.name.clone()
    } else {
        "Bronze".to_string()
    };

    tx.commit().await?;

    // Get updated loyalty status
    let loyalty_status = get_user_loyalty_status_internal(state.db(), payload.user_id).await?;

    let result = AdminNightsOperationResult {
        transaction_id: transaction_id.0,
        new_total_nights,
        new_tier_name,
        loyalty_status,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Nights awarded successfully",
    )))
}

/// POST /loyalty/admin/deduct-nights - Deduct nights only (admin only)
async fn admin_deduct_nights(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<AdminDeductNightsRequest>,
) -> Result<Json<ApiResponse<AdminNightsOperationResult>>, AppError> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let admin_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid admin user ID".to_string()))?;

    if payload.nights <= 0 {
        return Err(AppError::Validation(
            "Nights must be greater than 0".to_string(),
        ));
    }

    // Check if user has enough nights
    let current: Option<(Option<i32>,)> = sqlx::query_as(
        "SELECT total_nights FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_optional(state.db())
    .await?;

    let current_nights = current
        .ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?
        .0
        .unwrap_or(0);

    if current_nights < payload.nights {
        return Err(AppError::Validation(
            "Insufficient nights for deduction".to_string(),
        ));
    }

    let description = format!("Admin deducted {} night(s)", payload.nights);

    let mut tx = state.db().begin().await?;

    // Create points transaction with negative nights
    let transaction_id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO points_transactions (
            user_id, points, type, description, reference_id, nights_stayed,
            admin_user_id, admin_reason, created_at
        ) VALUES ($1, 0, 'admin_deduction'::points_transaction_type, $2, $3, $4, $5, $6, NOW())
        RETURNING id
        "#,
    )
    .bind(payload.user_id)
    .bind(&description)
    .bind(&payload.reference_id)
    .bind(-payload.nights) // Negative nights
    .bind(admin_user_id)
    .bind(&payload.reason)
    .fetch_one(&mut *tx)
    .await?;

    // Update user_loyalty: deduct nights
    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET total_nights = total_nights - $2,
            updated_at = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(payload.user_id)
    .bind(payload.nights)
    .execute(&mut *tx)
    .await?;

    // Get updated total nights
    let loyalty: (Option<i32>,) = sqlx::query_as(
        "SELECT total_nights FROM user_loyalty WHERE user_id = $1",
    )
    .bind(payload.user_id)
    .fetch_one(&mut *tx)
    .await?;
    let new_total_nights = loyalty.0.unwrap_or(0);

    // Recalculate tier based on nights
    let new_tier: Option<TierRow> = sqlx::query_as(
        r#"
        SELECT id, name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at
        FROM tiers
        WHERE min_nights <= $1 AND is_active = true
        ORDER BY min_nights DESC
        LIMIT 1
        "#,
    )
    .bind(new_total_nights)
    .fetch_optional(&mut *tx)
    .await?;

    let new_tier_name = if let Some(tier) = &new_tier {
        sqlx::query(
            "UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW() WHERE user_id = $2",
        )
        .bind(tier.id)
        .bind(payload.user_id)
        .execute(&mut *tx)
        .await?;
        tier.name.clone()
    } else {
        "Bronze".to_string()
    };

    tx.commit().await?;

    // Get updated loyalty status
    let loyalty_status = get_user_loyalty_status_internal(state.db(), payload.user_id).await?;

    let result = AdminNightsOperationResult {
        transaction_id: transaction_id.0,
        new_total_nights,
        new_tier_name,
        loyalty_status,
    };

    Ok(Json(ApiResponse::with_message(
        result,
        "Nights deducted successfully",
    )))
}

/// Create loyalty routes with explicit AppState (for backwards compatibility)
///
/// This function takes AppState explicitly and attaches it to the routes.
/// Use `routes()` instead when using the main router's shared state.
pub fn routes_with_app_state(state: AppState) -> Router {
    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/tiers", get(get_tiers_full))
        .with_state(state.clone());

    // Authenticated routes
    let auth_routes = Router::new()
        .route("/status", get(get_status_full))
        .route("/transactions", get(get_transactions_full))
        .route("/award", post(award_points_full))
        .route("/recalculate/:user_id", post(recalculate_tier_full))
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state.clone());

    // Admin routes - nested under /admin, require auth + admin role
    let admin_routes = Router::new()
        .route("/admin/users", get(admin_get_users))
        .route("/admin/award-points", post(admin_award_points))
        .route("/admin/deduct-points", post(admin_deduct_points))
        .route("/admin/transactions", get(admin_get_transactions))
        .route("/admin/user/:userId/history", get(admin_get_user_history))
        .route("/admin/earning-rules", get(admin_get_earning_rules))
        .route("/admin/expire-points", post(admin_expire_points))
        .route(
            "/admin/award-spending-with-nights",
            post(admin_award_spending_with_nights),
        )
        .route("/admin/award-nights", post(admin_award_nights))
        .route("/admin/deduct-nights", post(admin_deduct_nights))
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state);

    Router::new()
        .merge(public_routes)
        .merge(auth_routes)
        .merge(admin_routes)
}

// ============================================================================
// Stub Handlers (for routes without state)
// ============================================================================

/// Not implemented response
#[derive(Serialize)]
pub struct NotImplementedResponse {
    pub error: String,
    pub message: String,
}

fn not_implemented_response() -> (StatusCode, Json<NotImplementedResponse>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(NotImplementedResponse {
            error: "not_implemented".to_string(),
            message: "This endpoint requires database connection. Use routes_with_state()."
                .to_string(),
        }),
    )
}

async fn get_tiers_stub() -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn get_status_stub() -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn get_transactions_stub() -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn award_points_stub() -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn recalculate_tier_stub() -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transactions_query_defaults() {
        let query = TransactionsQuery {
            page: default_page(),
            limit: default_limit(),
        };
        assert_eq!(query.page, 1);
        assert_eq!(query.limit, 20);
    }

    #[test]
    fn test_tier_response_from_row() {
        let row = TierRow {
            id: Uuid::new_v4(),
            name: "Gold".to_string(),
            min_points: 0,
            min_nights: 10,
            benefits: Some(serde_json::json!({"discount": 15})),
            color: "#FFD700".to_string(),
            sort_order: 2,
            is_active: Some(true),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
        };

        let response: TierResponse = row.into();
        assert_eq!(response.name, "Gold");
        assert_eq!(response.min_nights, 10);
        assert!(response.is_active);
    }

    #[test]
    fn test_tier_response_defaults_none_values() {
        let row = TierRow {
            id: Uuid::new_v4(),
            name: "Bronze".to_string(),
            min_points: 0,
            min_nights: 0,
            benefits: None,
            color: "#CD7F32".to_string(),
            sort_order: 0,
            is_active: None,
            created_at: None,
            updated_at: None,
        };

        let response: TierResponse = row.into();
        assert_eq!(response.benefits, serde_json::json!({}));
        assert!(response.is_active); // Defaults to true
    }

    #[test]
    fn test_api_response_success() {
        let response = ApiResponse::success(vec!["a", "b", "c"]);
        assert!(response.success);
        assert!(response.message.is_none());
    }

    #[test]
    fn test_api_response_with_message() {
        let response = ApiResponse::with_message("data", "Operation completed");
        assert!(response.success);
        assert_eq!(response.message, Some("Operation completed".to_string()));
    }

    #[test]
    fn test_award_points_request_deserialization() {
        let json = r#"{
            "userId": "550e8400-e29b-41d4-a716-446655440000",
            "points": 100,
            "nights": 5,
            "source": "admin_award",
            "description": "Test award"
        }"#;

        let request: AwardPointsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.points, 100);
        assert_eq!(request.nights, 5);
        assert_eq!(request.source, Some("admin_award".to_string()));
    }

    #[test]
    fn test_points_transaction_response_from_row() {
        let row = PointsTransactionRow {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            points: 500,
            transaction_type: "earned_stay".to_string(),
            description: Some("Hotel stay".to_string()),
            reference_id: Some("STAY-001".to_string()),
            admin_user_id: None,
            admin_reason: None,
            expires_at: None,
            created_at: Some(Utc::now()),
            nights_stayed: Some(3),
        };

        let response: PointsTransactionResponse = row.into();
        assert_eq!(response.points, 500);
        assert_eq!(response.transaction_type, "earned_stay");
        assert_eq!(response.nights_stayed, 3);
    }

    // ============================================================================
    // Admin Route Tests
    // ============================================================================

    #[test]
    fn test_admin_users_query_defaults() {
        let query = AdminUsersQuery {
            limit: default_limit(),
            offset: default_offset(),
            search: None,
        };
        assert_eq!(query.limit, 20);
        assert_eq!(query.offset, 0);
        assert!(query.search.is_none());
    }

    #[test]
    fn test_admin_award_points_request_deserialization() {
        let json = r#"{
            "userId": "550e8400-e29b-41d4-a716-446655440000",
            "points": 500,
            "description": "Bonus award",
            "referenceId": "REF-001"
        }"#;

        let request: AdminAwardPointsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.points, 500);
        assert_eq!(request.description, Some("Bonus award".to_string()));
        assert_eq!(request.reference_id, Some("REF-001".to_string()));
    }

    #[test]
    fn test_admin_deduct_points_request_deserialization() {
        let json = r#"{
            "userId": "550e8400-e29b-41d4-a716-446655440000",
            "points": 100,
            "reason": "Points adjustment"
        }"#;

        let request: AdminDeductPointsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.points, 100);
        assert_eq!(request.reason, "Points adjustment");
    }

    #[test]
    fn test_admin_award_spending_with_nights_request_deserialization() {
        let json = r#"{
            "userId": "550e8400-e29b-41d4-a716-446655440000",
            "amountSpent": 5000.50,
            "nightsStayed": 3,
            "description": "Hotel stay reward"
        }"#;

        let request: AdminAwardSpendingWithNightsRequest = serde_json::from_str(json).unwrap();
        assert!((request.amount_spent - 5000.50).abs() < f64::EPSILON);
        assert_eq!(request.nights_stayed, 3);
    }

    #[test]
    fn test_admin_award_nights_request_deserialization() {
        let json = r#"{
            "userId": "550e8400-e29b-41d4-a716-446655440000",
            "nights": 5,
            "reason": "Loyalty bonus"
        }"#;

        let request: AdminAwardNightsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.nights, 5);
        assert_eq!(request.reason, "Loyalty bonus");
    }

    #[test]
    fn test_admin_deduct_nights_request_deserialization() {
        let json = r#"{
            "userId": "550e8400-e29b-41d4-a716-446655440000",
            "nights": 2,
            "reason": "Nights correction"
        }"#;

        let request: AdminDeductNightsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.nights, 2);
        assert_eq!(request.reason, "Nights correction");
    }

    #[test]
    fn test_expire_points_result_serialization() {
        let result = ExpirePointsResult { expired_count: 42 };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("42"));
    }

    #[test]
    fn test_admin_operation_result_serialization() {
        let result = AdminOperationResult {
            transaction_id: Uuid::new_v4(),
            loyalty_status: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("transactionId"));
    }

    #[test]
    fn test_admin_nights_operation_result_serialization() {
        let result = AdminNightsOperationResult {
            transaction_id: Uuid::new_v4(),
            new_total_nights: 15,
            new_tier_name: "Silver".to_string(),
            loyalty_status: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("newTotalNights"));
        assert!(json.contains("Silver"));
    }
}
