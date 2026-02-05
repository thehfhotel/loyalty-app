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

    let loyalty = loyalty.ok_or_else(|| AppError::NotFound("Loyalty status not found".to_string()))?;

    // Build tier info if present
    let tier_info = if let (Some(tier_id), Some(tier_name)) = (loyalty.tier_id, loyalty.tier_name.clone()) {
        Some(TierInfo {
            id: tier_id,
            name: tier_name,
            color: loyalty.tier_color.clone().unwrap_or_else(|| "#CD7F32".to_string()),
            benefits: loyalty.tier_benefits.clone().unwrap_or(serde_json::json!({})),
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
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM points_transactions WHERE user_id = $1",
    )
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

    let transaction_responses: Vec<PointsTransactionResponse> =
        transactions.into_iter().map(PointsTransactionResponse::from).collect();

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

    let (total_nights, old_tier_id, old_tier_name) = current
        .ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?;

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

    let new_tier = new_tier.ok_or_else(|| {
        AppError::Internal("No tier found for user's night count".to_string())
    })?;

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
/// - `GET /tiers` - Get all available loyalty tiers (public)
/// - `GET /status` - Get current user's loyalty status (authenticated)
/// - `GET /transactions` - Get user's transaction history (authenticated)
/// - `POST /award` - Award points to a user (admin only)
/// - `POST /recalculate/:user_id` - Recalculate user's tier (admin only)
pub fn routes() -> Router<AppState> {
    // Public routes (no auth required) - tiers can be viewed by anyone
    let public_routes = Router::new()
        .route("/tiers", get(get_tiers_full));

    // Authenticated routes - require valid JWT token
    let auth_routes = Router::new()
        .route("/status", get(get_status_full))
        .route("/transactions", get(get_transactions_full))
        .route("/award", post(award_points_full))
        .route("/recalculate/:user_id", post(recalculate_tier_full))
        .layer(middleware::from_fn(auth_middleware));

    public_routes.merge(auth_routes)
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

    let loyalty = loyalty.ok_or_else(|| AppError::NotFound("Loyalty status not found".to_string()))?;

    let tier_info = if let (Some(tier_id), Some(tier_name)) = (loyalty.tier_id, loyalty.tier_name.clone()) {
        Some(TierInfo {
            id: tier_id,
            name: tier_name,
            color: loyalty.tier_color.clone().unwrap_or_else(|| "#CD7F32".to_string()),
            benefits: loyalty.tier_benefits.clone().unwrap_or(serde_json::json!({})),
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

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM points_transactions WHERE user_id = $1",
    )
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

    let transaction_responses: Vec<PointsTransactionResponse> =
        transactions.into_iter().map(PointsTransactionResponse::from).collect();

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
    let description = payload.description.clone().unwrap_or_else(|| "Points awarded by admin".to_string());

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
            sqlx::query("UPDATE user_loyalty SET tier_id = $1, tier_updated_at = NOW() WHERE user_id = $2")
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

    Ok(Json(ApiResponse::with_message(result, "Points awarded successfully")))
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

    let (total_nights, old_tier_id, old_tier_name) = current
        .ok_or_else(|| AppError::NotFound("User loyalty record not found".to_string()))?;

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

    let new_tier = new_tier.ok_or_else(|| {
        AppError::Internal("No tier found for user's night count".to_string())
    })?;

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
        if tier_changed { "Tier recalculated and updated" } else { "Tier recalculated, no change needed" },
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
        .with_state(state);

    Router::new().merge(public_routes).merge(auth_routes)
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
            message: "This endpoint requires database connection. Use routes_with_state().".to_string(),
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
}
