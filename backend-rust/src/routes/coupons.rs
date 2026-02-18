//! Coupon routes
//!
//! Provides endpoints for coupon management including listing,
//! viewing, creating, assigning, and redeeming coupons.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, require_role, AuthUser};
use crate::models::coupon::{
    CouponResponse, CouponStatus, CouponType, CreateCouponRequest, UpdateCouponRequest,
    UserCouponResponse, UserCouponStatus,
};
use crate::state::AppState;

// ============================================================================
// Helper functions for parsing enum strings from compile-time macros
// ============================================================================

/// Parse a coupon type string from the database into the CouponType enum
fn parse_coupon_type(s: &str) -> CouponType {
    match s {
        "percentage" => CouponType::Percentage,
        "fixed_amount" => CouponType::FixedAmount,
        "bogo" => CouponType::Bogo,
        "free_upgrade" => CouponType::FreeUpgrade,
        "free_service" => CouponType::FreeService,
        _ => CouponType::Percentage,
    }
}

/// Parse a coupon status string from the database into the CouponStatus enum
fn parse_coupon_status(s: &str) -> CouponStatus {
    match s {
        "draft" => CouponStatus::Draft,
        "active" => CouponStatus::Active,
        "paused" => CouponStatus::Paused,
        "expired" => CouponStatus::Expired,
        "exhausted" => CouponStatus::Exhausted,
        _ => CouponStatus::Draft,
    }
}

/// Parse a user coupon status string from the database into the UserCouponStatus enum
fn parse_user_coupon_status(s: &str) -> UserCouponStatus {
    match s {
        "available" => UserCouponStatus::Available,
        "used" => UserCouponStatus::Used,
        "expired" => UserCouponStatus::Expired,
        "revoked" => UserCouponStatus::Revoked,
        _ => UserCouponStatus::Available,
    }
}

// ============================================================================
// Request/Response DTOs
// ============================================================================

/// Query parameters for listing coupons
#[derive(Debug, Deserialize, Default)]
pub struct ListCouponsQuery {
    /// Page number (1-indexed)
    pub page: Option<u32>,
    /// Items per page (max 50)
    pub limit: Option<u32>,
    /// Filter by status (admin only)
    pub status: Option<String>,
    /// Filter by coupon type
    #[serde(rename = "type")]
    pub coupon_type: Option<String>,
    /// Search term for code or name
    pub search: Option<String>,
    /// Filter by creator (admin only)
    #[serde(rename = "createdBy")]
    pub created_by: Option<String>,
}

/// Query parameters for listing user coupons
#[derive(Debug, Deserialize, Default)]
pub struct ListUserCouponsQuery {
    /// Page number (1-indexed)
    pub page: Option<u32>,
    /// Items per page (max 50)
    pub limit: Option<u32>,
    /// Filter by status (available, used, expired, revoked)
    pub status: Option<String>,
    /// User ID to view (admin only)
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
}

/// Query parameters for analytics data
#[derive(Debug, Deserialize, Default)]
pub struct AnalyticsDataQuery {
    /// Number of days to look back (default: 30, max: 365)
    pub days: Option<u32>,
}

/// Request to assign a coupon to users
#[derive(Debug, Deserialize, Validate)]
pub struct AssignCouponRequest {
    /// Coupon ID to assign
    #[serde(rename = "couponId")]
    pub coupon_id: Uuid,
    /// List of user IDs to assign to
    #[serde(rename = "userIds")]
    #[validate(length(
        min = 1,
        max = 100,
        message = "Must specify between 1 and 100 user IDs"
    ))]
    pub user_ids: Vec<Uuid>,
    /// Reason for assignment
    #[serde(rename = "assignedReason")]
    pub assigned_reason: Option<String>,
    /// Custom expiry date
    #[serde(rename = "customExpiry")]
    pub custom_expiry: Option<DateTime<Utc>>,
}

/// Request to redeem a coupon
#[derive(Debug, Deserialize, Validate)]
pub struct RedeemCouponRequest {
    /// QR code of the user coupon
    #[serde(rename = "qrCode")]
    #[validate(length(min = 1, message = "QR code is required"))]
    pub qr_code: String,
    /// Original amount before discount
    #[serde(rename = "originalAmount")]
    #[validate(custom(function = "validate_positive_decimal"))]
    pub original_amount: Decimal,
    /// Transaction reference
    #[serde(rename = "transactionReference")]
    pub transaction_reference: Option<String>,
    /// Location of redemption
    pub location: Option<String>,
    /// Additional metadata
    pub metadata: Option<serde_json::Value>,
}

/// Custom validator for positive Decimal values
fn validate_positive_decimal(value: &Decimal) -> Result<(), validator::ValidationError> {
    let min = Decimal::new(1, 2); // 0.01
    if *value >= min {
        Ok(())
    } else {
        let mut err = validator::ValidationError::new("range");
        err.message = Some(std::borrow::Cow::Borrowed(
            "Original amount must be positive",
        ));
        Err(err)
    }
}

/// Request to revoke a user coupon
#[derive(Debug, Deserialize)]
pub struct RevokeUserCouponRequest {
    /// Reason for revocation
    pub reason: Option<String>,
}

/// Paginated response wrapper
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: u32,
    pub limit: u32,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
}

/// Success response wrapper
#[derive(Debug, Serialize)]
pub struct SuccessResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<T> SuccessResponse<T> {
    pub fn new(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            message: None,
        }
    }

    pub fn with_message(data: T, message: impl Into<String>) -> Self {
        Self {
            success: true,
            data: Some(data),
            message: Some(message.into()),
        }
    }
}

/// Coupon validation response
#[derive(Debug, Serialize)]
pub struct CouponValidationResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<CouponValidationData>,
    pub message: String,
}

/// Coupon validation data
#[derive(Debug, Serialize)]
pub struct CouponValidationData {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub coupon_type: CouponType,
    pub value: Option<Decimal>,
    pub currency: Option<String>,
    #[serde(rename = "minimumSpend")]
    pub minimum_spend: Option<Decimal>,
    #[serde(rename = "maximumDiscount")]
    pub maximum_discount: Option<Decimal>,
    #[serde(rename = "validUntil")]
    pub valid_until: Option<DateTime<Utc>>,
}

/// Redemption result response
#[derive(Debug, Serialize)]
pub struct RedemptionResult {
    pub success: bool,
    pub message: String,
    #[serde(rename = "originalAmount")]
    pub original_amount: Decimal,
    #[serde(rename = "discountAmount")]
    pub discount_amount: Decimal,
    #[serde(rename = "finalAmount")]
    pub final_amount: Decimal,
}

/// Coupon statistics response
#[derive(Debug, Serialize)]
pub struct CouponStats {
    #[serde(rename = "totalCoupons")]
    pub total_coupons: i64,
    #[serde(rename = "activeCoupons")]
    pub active_coupons: i64,
    #[serde(rename = "totalAssigned")]
    pub total_assigned: i64,
    #[serde(rename = "totalRedeemed")]
    pub total_redeemed: i64,
    #[serde(rename = "redemptionRate")]
    pub redemption_rate: f64,
}

/// User coupon with coupon details
#[derive(Debug, Serialize)]
pub struct UserCouponWithDetails {
    pub id: Uuid,
    pub user_id: Uuid,
    pub coupon_id: Uuid,
    pub status: Option<UserCouponStatus>,
    pub qr_code: String,
    pub used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    // Coupon details
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub coupon_type: CouponType,
    pub value: Option<Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<Decimal>,
    pub maximum_discount: Option<Decimal>,
    pub coupon_valid_from: Option<DateTime<Utc>>,
    pub coupon_valid_until: Option<DateTime<Utc>>,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// List available coupons
///
/// GET /api/coupons
/// Query params: page, limit, status (admin), type, search
async fn list_coupons(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(query): Query<ListCouponsQuery>,
) -> AppResult<Json<SuccessResponse<PaginatedResponse<CouponResponse>>>> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(50).max(1);
    let offset = ((page - 1) * limit) as i64;

    let is_admin = user.role == "admin" || user.role == "super_admin";

    // Build query based on role
    let (coupons, total): (Vec<CouponResponse>, i64) = if is_admin {
        // Admin can see all coupons and filter by status
        let status_filter = query.status.as_deref();
        let type_filter = query.coupon_type.as_deref();
        let search_filter = query.search.as_deref().map(|s| format!("%{}%", s));

        let rows = sqlx::query!(
            r#"
            SELECT
                id,
                code,
                name,
                description,
                terms_and_conditions,
                type::text as "coupon_type!",
                value,
                currency,
                minimum_spend,
                maximum_discount,
                valid_from,
                valid_until,
                usage_limit,
                usage_limit_per_user,
                used_count,
                status::text as "status",
                created_at
            FROM coupons
            WHERE
                ($1::text IS NULL OR status::text = $1)
                AND ($2::text IS NULL OR type::text = $2)
                AND ($3::text IS NULL OR (code ILIKE $3 OR name ILIKE $3))
            ORDER BY created_at DESC
            LIMIT $4 OFFSET $5
            "#,
            status_filter,
            type_filter,
            search_filter.clone() as Option<String>,
            limit as i64,
            offset,
        )
        .fetch_all(state.db())
        .await?;

        let coupons: Vec<CouponResponse> = rows
            .into_iter()
            .map(|r| CouponResponse {
                id: r.id,
                code: r.code,
                name: r.name,
                description: r.description,
                terms_and_conditions: r.terms_and_conditions,
                coupon_type: parse_coupon_type(&r.coupon_type),
                value: r.value,
                currency: r.currency,
                minimum_spend: r.minimum_spend,
                maximum_discount: r.maximum_discount,
                valid_from: r.valid_from,
                valid_until: r.valid_until,
                usage_limit: r.usage_limit,
                usage_limit_per_user: r.usage_limit_per_user,
                used_count: r.used_count,
                status: r.status.map(|s| parse_coupon_status(&s)),
                created_at: r.created_at,
            })
            .collect();

        let total: i64 = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!: i64"
            FROM coupons
            WHERE
                ($1::text IS NULL OR status::text = $1)
                AND ($2::text IS NULL OR type::text = $2)
                AND ($3::text IS NULL OR (code ILIKE $3 OR name ILIKE $3))
            "#,
            status_filter,
            type_filter,
            search_filter as Option<String>,
        )
        .fetch_one(state.db())
        .await?;

        (coupons, total)
    } else {
        // Regular users can only see active coupons
        let type_filter = query.coupon_type.as_deref();
        let search_filter = query.search.as_deref().map(|s| format!("%{}%", s));

        let rows = sqlx::query!(
            r#"
            SELECT
                id,
                code,
                name,
                description,
                terms_and_conditions,
                type::text as "coupon_type!",
                value,
                currency,
                minimum_spend,
                maximum_discount,
                valid_from,
                valid_until,
                usage_limit,
                usage_limit_per_user,
                used_count,
                status::text as "status",
                created_at
            FROM coupons
            WHERE status = 'active'
                AND ($1::text IS NULL OR type::text = $1)
                AND ($2::text IS NULL OR (code ILIKE $2 OR name ILIKE $2))
                AND (valid_from IS NULL OR valid_from <= NOW())
                AND (valid_until IS NULL OR valid_until > NOW())
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#,
            type_filter,
            search_filter.clone() as Option<String>,
            limit as i64,
            offset,
        )
        .fetch_all(state.db())
        .await?;

        let coupons: Vec<CouponResponse> = rows
            .into_iter()
            .map(|r| CouponResponse {
                id: r.id,
                code: r.code,
                name: r.name,
                description: r.description,
                terms_and_conditions: r.terms_and_conditions,
                coupon_type: parse_coupon_type(&r.coupon_type),
                value: r.value,
                currency: r.currency,
                minimum_spend: r.minimum_spend,
                maximum_discount: r.maximum_discount,
                valid_from: r.valid_from,
                valid_until: r.valid_until,
                usage_limit: r.usage_limit,
                usage_limit_per_user: r.usage_limit_per_user,
                used_count: r.used_count,
                status: r.status.map(|s| parse_coupon_status(&s)),
                created_at: r.created_at,
            })
            .collect();

        let total: i64 = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!: i64"
            FROM coupons
            WHERE status = 'active'
                AND ($1::text IS NULL OR type::text = $1)
                AND ($2::text IS NULL OR (code ILIKE $2 OR name ILIKE $2))
                AND (valid_from IS NULL OR valid_from <= NOW())
                AND (valid_until IS NULL OR valid_until > NOW())
            "#,
            type_filter,
            search_filter as Option<String>,
        )
        .fetch_one(state.db())
        .await?;

        (coupons, total)
    };

    let total_pages = ((total as f64) / (limit as f64)).ceil() as u32;

    Ok(Json(SuccessResponse::new(PaginatedResponse {
        items: coupons,
        total,
        page,
        limit,
        total_pages,
    })))
}

/// Get user's assigned coupons
///
/// GET /api/coupons/my-coupons
/// Query params: page, limit, status
async fn get_user_coupons(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(query): Query<ListUserCouponsQuery>,
) -> AppResult<Json<SuccessResponse<PaginatedResponse<UserCouponWithDetails>>>> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(50).max(1);
    let offset = ((page - 1) * limit) as i64;

    let is_admin = user.role == "admin" || user.role == "super_admin";

    // Determine which user's coupons to fetch
    let target_user_id = if is_admin && query.user_id.is_some() {
        query.user_id.clone().unwrap()
    } else {
        user.id.clone()
    };

    let user_uuid = Uuid::parse_str(&target_user_id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID format".to_string()))?;

    let status_filter = query.status.as_deref();

    let rows = sqlx::query!(
        r#"
        SELECT
            uc.id,
            uc.user_id,
            uc.coupon_id,
            uc.status::text as "status",
            uc.qr_code,
            uc.used_at,
            uc.expires_at,
            uc.created_at,
            c.code,
            c.name,
            c.description,
            c.type::text as "coupon_type!",
            c.value,
            c.currency,
            c.minimum_spend,
            c.maximum_discount,
            c.valid_from as coupon_valid_from,
            c.valid_until as coupon_valid_until
        FROM user_coupons uc
        JOIN coupons c ON uc.coupon_id = c.id
        WHERE uc.user_id = $1
            AND ($2::text IS NULL OR uc.status::text = $2)
        ORDER BY uc.created_at DESC
        LIMIT $3 OFFSET $4
        "#,
        user_uuid,
        status_filter,
        limit as i64,
        offset,
    )
    .fetch_all(state.db())
    .await?;

    let user_coupons: Vec<UserCouponWithDetails> = rows
        .into_iter()
        .map(|r| UserCouponWithDetails {
            id: r.id,
            user_id: r.user_id,
            coupon_id: r.coupon_id,
            status: r.status.map(|s| parse_user_coupon_status(&s)),
            qr_code: r.qr_code,
            used_at: r.used_at,
            expires_at: r.expires_at,
            created_at: r.created_at,
            code: r.code,
            name: r.name,
            description: r.description,
            coupon_type: parse_coupon_type(&r.coupon_type),
            value: r.value,
            currency: r.currency,
            minimum_spend: r.minimum_spend,
            maximum_discount: r.maximum_discount,
            coupon_valid_from: r.coupon_valid_from,
            coupon_valid_until: r.coupon_valid_until,
        })
        .collect();

    let total: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!: i64"
        FROM user_coupons
        WHERE user_id = $1
            AND ($2::text IS NULL OR status::text = $2)
        "#,
        user_uuid,
        status_filter,
    )
    .fetch_one(state.db())
    .await?;

    let total_pages = ((total as f64) / (limit as f64)).ceil() as u32;

    Ok(Json(SuccessResponse::new(PaginatedResponse {
        items: user_coupons,
        total,
        page,
        limit,
        total_pages,
    })))
}

/// Get coupon by ID
///
/// GET /api/coupons/:id
async fn get_coupon(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
) -> AppResult<Json<SuccessResponse<CouponResponse>>> {
    let is_admin = user.role == "admin" || user.role == "super_admin";

    let row = sqlx::query!(
        r#"
        SELECT
            id,
            code,
            name,
            description,
            terms_and_conditions,
            type::text as "coupon_type!",
            value,
            currency,
            minimum_spend,
            maximum_discount,
            valid_from,
            valid_until,
            usage_limit,
            usage_limit_per_user,
            used_count,
            status::text as "status",
            created_at
        FROM coupons
        WHERE id = $1
        "#,
        coupon_id,
    )
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Coupon".to_string()))?;

    let coupon = CouponResponse {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        terms_and_conditions: row.terms_and_conditions,
        coupon_type: parse_coupon_type(&row.coupon_type),
        value: row.value,
        currency: row.currency,
        minimum_spend: row.minimum_spend,
        maximum_discount: row.maximum_discount,
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        usage_limit: row.usage_limit,
        usage_limit_per_user: row.usage_limit_per_user,
        used_count: row.used_count,
        status: row.status.map(|s| parse_coupon_status(&s)),
        created_at: row.created_at,
    };

    // Non-admin users can only see active coupons
    if !is_admin && coupon.status != Some(CouponStatus::Active) {
        return Err(AppError::NotFound("Coupon".to_string()));
    }

    Ok(Json(SuccessResponse::new(coupon)))
}

/// Create a new coupon (admin only)
///
/// POST /api/coupons
async fn create_coupon(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(request): Json<CreateCouponRequest>,
) -> AppResult<(StatusCode, Json<SuccessResponse<CouponResponse>>)> {
    // Validate required fields
    if request.code.is_empty() || request.name.is_empty() {
        return Err(AppError::Validation(
            "Code and name are required".to_string(),
        ));
    }

    // Validate code format (uppercase letters, numbers, underscores, hyphens only)
    if !request
        .code
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(AppError::Validation(
            "Code must contain only uppercase letters, numbers, underscores, and hyphens"
                .to_string(),
        ));
    }

    // Validate value for percentage and fixed_amount types
    if matches!(
        request.coupon_type,
        CouponType::Percentage | CouponType::FixedAmount
    ) {
        match request.value {
            None => {
                return Err(AppError::Validation(
                    "Value is required for percentage and fixed_amount coupons".to_string(),
                ));
            },
            Some(v) if v <= Decimal::ZERO => {
                return Err(AppError::Validation(
                    "Value must be positive for percentage and fixed_amount coupons".to_string(),
                ));
            },
            _ => {},
        }
    }

    // Validate percentage value
    if request.coupon_type == CouponType::Percentage {
        if let Some(value) = request.value {
            if value > Decimal::from(100) {
                return Err(AppError::Validation(
                    "Percentage value cannot exceed 100".to_string(),
                ));
            }
        }
    }

    let user_uuid = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID format".to_string()))?;

    let coupon_id = Uuid::new_v4();
    let status = request.status.unwrap_or(CouponStatus::Draft);
    let currency = request
        .currency
        .clone()
        .unwrap_or_else(|| "THB".to_string());

    // Note: Uses runtime query because bind params with enum type casts
    // ($6::coupon_type, $17::coupon_status) are not supported by compile-time macros
    let coupon = sqlx::query_as::<_, CouponResponse>(
        r#"
        INSERT INTO coupons (
            id, code, name, description, terms_and_conditions,
            type, value, currency, minimum_spend, maximum_discount,
            valid_from, valid_until, usage_limit, usage_limit_per_user,
            tier_restrictions, customer_segment, status, created_by,
            created_at, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
        )
        RETURNING
            id,
            code,
            name,
            description,
            terms_and_conditions,
            type as coupon_type,
            value,
            currency,
            minimum_spend,
            maximum_discount,
            valid_from,
            valid_until,
            usage_limit,
            usage_limit_per_user,
            used_count,
            status,
            created_at
        "#,
    )
    .bind(coupon_id)
    .bind(&request.code)
    .bind(&request.name)
    .bind(&request.description)
    .bind(&request.terms_and_conditions)
    .bind(&request.coupon_type)
    .bind(request.value)
    .bind(&currency)
    .bind(request.minimum_spend)
    .bind(request.maximum_discount)
    .bind(request.valid_from)
    .bind(request.valid_until)
    .bind(request.usage_limit)
    .bind(request.usage_limit_per_user.unwrap_or(1))
    .bind(&request.tier_restrictions)
    .bind(&request.customer_segment)
    .bind(&status)
    .bind(user_uuid)
    .fetch_one(state.db())
    .await
    .map_err(|e: sqlx::Error| {
        if e.to_string().contains("duplicate key") {
            AppError::AlreadyExists("A coupon with this code already exists".to_string())
        } else {
            AppError::from(e)
        }
    })?;

    Ok((
        StatusCode::CREATED,
        Json(SuccessResponse::with_message(
            coupon,
            "Coupon created successfully",
        )),
    ))
}

/// Update a coupon (admin only)
///
/// PUT /api/coupons/:id
async fn update_coupon(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
    Json(request): Json<UpdateCouponRequest>,
) -> AppResult<Json<SuccessResponse<CouponResponse>>> {
    // Validate percentage value if updating
    if let Some(value) = request.value {
        if value > Decimal::from(100) {
            // Check if it's a percentage type coupon
            let existing: String = sqlx::query_scalar!(
                r#"SELECT type::text as "coupon_type!" FROM coupons WHERE id = $1"#,
                coupon_id,
            )
            .fetch_optional(state.db())
            .await?
            .ok_or_else(|| AppError::NotFound("Coupon".to_string()))?;

            if existing == "percentage" {
                return Err(AppError::Validation(
                    "Percentage value cannot exceed 100".to_string(),
                ));
            }
        }
    }

    // Note: Uses runtime query because bind param $15 is Option<CouponStatus> (enum type)
    // which is not supported by compile-time macros
    let coupon = sqlx::query_as::<_, CouponResponse>(
        r#"
        UPDATE coupons
        SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            terms_and_conditions = COALESCE($4, terms_and_conditions),
            value = COALESCE($5, value),
            currency = COALESCE($6, currency),
            minimum_spend = COALESCE($7, minimum_spend),
            maximum_discount = COALESCE($8, maximum_discount),
            valid_from = COALESCE($9, valid_from),
            valid_until = COALESCE($10, valid_until),
            usage_limit = COALESCE($11, usage_limit),
            usage_limit_per_user = COALESCE($12, usage_limit_per_user),
            tier_restrictions = COALESCE($13, tier_restrictions),
            customer_segment = COALESCE($14, customer_segment),
            status = COALESCE($15, status),
            updated_at = NOW()
        WHERE id = $1
        RETURNING
            id,
            code,
            name,
            description,
            terms_and_conditions,
            type as coupon_type,
            value,
            currency,
            minimum_spend,
            maximum_discount,
            valid_from,
            valid_until,
            usage_limit,
            usage_limit_per_user,
            used_count,
            status,
            created_at
        "#,
    )
    .bind(coupon_id)
    .bind(&request.name)
    .bind(&request.description)
    .bind(&request.terms_and_conditions)
    .bind(request.value)
    .bind(&request.currency)
    .bind(request.minimum_spend)
    .bind(request.maximum_discount)
    .bind(request.valid_from)
    .bind(request.valid_until)
    .bind(request.usage_limit)
    .bind(request.usage_limit_per_user)
    .bind(&request.tier_restrictions)
    .bind(&request.customer_segment)
    .bind(&request.status)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Coupon".to_string()))?;

    Ok(Json(SuccessResponse::with_message(
        coupon,
        "Coupon updated successfully",
    )))
}

/// Delete a coupon (admin only)
///
/// DELETE /api/coupons/:id
async fn delete_coupon(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
) -> AppResult<Json<SuccessResponse<()>>> {
    let result = sqlx::query!("DELETE FROM coupons WHERE id = $1", coupon_id)
        .execute(state.db())
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Coupon not found or already deleted".to_string(),
        ));
    }

    Ok(Json(SuccessResponse {
        success: true,
        data: None,
        message: Some("Coupon deleted successfully".to_string()),
    }))
}

/// Assign coupon to users (admin only)
///
/// POST /api/coupons/assign
async fn assign_coupon(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(request): Json<AssignCouponRequest>,
) -> AppResult<Json<SuccessResponse<Vec<UserCouponResponse>>>> {
    // Validate request
    if request.user_ids.is_empty() {
        return Err(AppError::Validation(
            "At least one user ID is required".to_string(),
        ));
    }

    if request.user_ids.len() > 100 {
        return Err(AppError::Validation(
            "Cannot assign to more than 100 users at once".to_string(),
        ));
    }

    let admin_uuid = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::InvalidInput("Invalid admin user ID format".to_string()))?;

    // Check if coupon exists and is active
    let coupon = sqlx::query!(
        r#"
        SELECT id, status::text as "status!", valid_until
        FROM coupons
        WHERE id = $1
        "#,
        request.coupon_id,
    )
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Coupon".to_string()))?;

    if coupon.status != "active" {
        return Err(AppError::Validation(
            "Cannot assign inactive coupon".to_string(),
        ));
    }

    // Generate QR codes and assign coupons
    let mut assigned_coupons = Vec::new();

    for user_id in &request.user_ids {
        let user_coupon_id = Uuid::new_v4();
        let qr_code = format!("QR-{}-{}", request.coupon_id, user_coupon_id);

        // Use custom expiry or coupon's valid_until
        let expires_at = request.custom_expiry.or(coupon.valid_until);

        let row = sqlx::query!(
            r#"
            INSERT INTO user_coupons (
                id, user_id, coupon_id, status, qr_code,
                assigned_by, assigned_reason, expires_at, created_at, updated_at
            )
            VALUES ($1, $2, $3, 'available', $4, $5, $6, $7, NOW(), NOW())
            RETURNING
                id,
                user_id,
                coupon_id,
                status::text as "status",
                qr_code,
                used_at,
                expires_at,
                created_at
            "#,
            user_coupon_id,
            user_id,
            request.coupon_id,
            &qr_code,
            admin_uuid,
            request.assigned_reason.as_deref(),
            expires_at,
        )
        .fetch_one(state.db())
        .await?;

        assigned_coupons.push(UserCouponResponse {
            id: row.id,
            user_id: row.user_id,
            coupon_id: row.coupon_id,
            status: row.status.map(|s| parse_user_coupon_status(&s)),
            qr_code: row.qr_code,
            used_at: row.used_at,
            expires_at: row.expires_at,
            created_at: row.created_at,
        });
    }

    Ok(Json(SuccessResponse::with_message(
        assigned_coupons,
        format!(
            "Coupon assigned to {} users successfully",
            request.user_ids.len()
        ),
    )))
}

/// Redeem a coupon
///
/// POST /api/coupons/redeem
async fn redeem_coupon(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(request): Json<RedeemCouponRequest>,
) -> AppResult<Json<SuccessResponse<RedemptionResult>>> {
    if request.qr_code.is_empty() {
        return Err(AppError::Validation("QR code is required".to_string()));
    }

    if request.original_amount <= Decimal::ZERO {
        return Err(AppError::Validation(
            "Original amount must be positive".to_string(),
        ));
    }

    let redeemer_uuid = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID format".to_string()))?;

    // Get user coupon by QR code with coupon details
    let user_coupon = sqlx::query!(
        r#"
        SELECT
            uc.id,
            uc.user_id,
            uc.status::text as "status!",
            uc.expires_at,
            c.type::text as "coupon_type!",
            c.value,
            c.minimum_spend,
            c.maximum_discount,
            c.currency
        FROM user_coupons uc
        JOIN coupons c ON uc.coupon_id = c.id
        WHERE uc.qr_code = $1
        "#,
        &request.qr_code,
    )
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Invalid QR code".to_string()))?;

    // Check if coupon is available
    if user_coupon.status != "available" {
        return Err(AppError::Validation(format!(
            "Coupon is not available for use (status: {})",
            user_coupon.status
        )));
    }

    // Check if coupon has expired
    if let Some(expires_at) = user_coupon.expires_at {
        if expires_at < Utc::now() {
            return Err(AppError::Validation("Coupon has expired".to_string()));
        }
    }

    // Check minimum spend
    if let Some(min_spend) = user_coupon.minimum_spend {
        if request.original_amount < min_spend {
            return Err(AppError::Validation(format!(
                "Minimum spend of {} {} is required",
                min_spend,
                user_coupon.currency.as_deref().unwrap_or("THB")
            )));
        }
    }

    // Calculate discount
    let discount_amount = match user_coupon.coupon_type.as_str() {
        "percentage" => {
            let percentage = user_coupon.value.unwrap_or(Decimal::ZERO);
            let discount = request.original_amount * percentage / Decimal::from(100);
            // Apply maximum discount cap
            if let Some(max_discount) = user_coupon.maximum_discount {
                discount.min(max_discount)
            } else {
                discount
            }
        },
        "fixed_amount" => user_coupon.value.unwrap_or(Decimal::ZERO),
        _ => Decimal::ZERO, // BOGO, free_upgrade, free_service don't have numeric discounts
    };

    let final_amount = (request.original_amount - discount_amount).max(Decimal::ZERO);

    // Update user coupon as used
    let redemption_details = serde_json::json!({
        "originalAmount": request.original_amount,
        "discountAmount": discount_amount,
        "finalAmount": final_amount,
        "transactionReference": request.transaction_reference,
        "location": request.location,
        "metadata": request.metadata
    });

    sqlx::query!(
        r#"
        UPDATE user_coupons
        SET
            status = 'used',
            used_at = NOW(),
            used_by_admin = $2,
            redemption_location = $3,
            redemption_details = $4,
            updated_at = NOW()
        WHERE id = $1
        "#,
        user_coupon.id,
        redeemer_uuid,
        request.location.as_deref(),
        &redemption_details,
    )
    .execute(state.db())
    .await?;

    // Increment used_count on coupon
    sqlx::query!(
        r#"
        UPDATE coupons
        SET used_count = COALESCE(used_count, 0) + 1, updated_at = NOW()
        WHERE id = (SELECT coupon_id FROM user_coupons WHERE id = $1)
        "#,
        user_coupon.id,
    )
    .execute(state.db())
    .await?;

    Ok(Json(SuccessResponse::new(RedemptionResult {
        success: true,
        message: "Coupon redeemed successfully".to_string(),
        original_amount: request.original_amount,
        discount_amount,
        final_amount,
    })))
}

/// Validate coupon by QR code (public endpoint for checking before redemption)
///
/// GET /api/coupons/validate/:qrCode
async fn validate_coupon(
    State(state): State<AppState>,
    Path(qr_code): Path<String>,
) -> AppResult<Json<SuccessResponse<CouponValidationResponse>>> {
    if qr_code.is_empty() || qr_code == "undefined" {
        return Err(AppError::Validation("QR code is required".to_string()));
    }

    let user_coupon = sqlx::query!(
        r#"
        SELECT
            uc.status::text as "status!",
            uc.expires_at,
            c.name,
            c.description,
            c.type::text as "coupon_type!",
            c.value,
            c.currency,
            c.minimum_spend,
            c.maximum_discount,
            c.valid_until
        FROM user_coupons uc
        JOIN coupons c ON uc.coupon_id = c.id
        WHERE uc.qr_code = $1
        "#,
        &qr_code,
    )
    .fetch_optional(state.db())
    .await?;

    let response = match user_coupon {
        Some(uc) => {
            let effective_expiry = uc.expires_at.or(uc.valid_until);
            let is_valid =
                uc.status == "available" && effective_expiry.map_or(true, |exp| exp > Utc::now());

            CouponValidationResponse {
                valid: is_valid,
                data: if is_valid {
                    Some(CouponValidationData {
                        name: uc.name,
                        description: uc.description,
                        coupon_type: parse_coupon_type(&uc.coupon_type),
                        value: uc.value,
                        currency: uc.currency,
                        minimum_spend: uc.minimum_spend,
                        maximum_discount: uc.maximum_discount,
                        valid_until: effective_expiry,
                    })
                } else {
                    None
                },
                message: if is_valid {
                    "Coupon is valid".to_string()
                } else {
                    "Coupon is not available for use".to_string()
                },
            }
        },
        None => CouponValidationResponse {
            valid: false,
            data: None,
            message: "Invalid QR code".to_string(),
        },
    };

    Ok(Json(SuccessResponse::new(response)))
}

/// Revoke a user coupon (admin only)
///
/// POST /api/coupons/user-coupons/:userCouponId/revoke
async fn revoke_user_coupon(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(user_coupon_id): Path<Uuid>,
    Json(_request): Json<RevokeUserCouponRequest>,
) -> AppResult<Json<SuccessResponse<()>>> {
    let result = sqlx::query!(
        r#"
        UPDATE user_coupons
        SET status = 'revoked', updated_at = NOW()
        WHERE id = $1 AND status = 'available'
        "#,
        user_coupon_id,
    )
    .execute(state.db())
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "User coupon not found or not available for revocation".to_string(),
        ));
    }

    Ok(Json(SuccessResponse {
        success: true,
        data: None,
        message: Some("User coupon revoked successfully".to_string()),
    }))
}

/// Get coupon statistics (admin only)
///
/// GET /api/coupons/analytics/stats
async fn get_coupon_stats(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> AppResult<Json<SuccessResponse<CouponStats>>> {
    let stats = sqlx::query!(
        r#"
        SELECT
            (SELECT COUNT(*) FROM coupons) as "total_coupons!: i64",
            (SELECT COUNT(*) FROM coupons WHERE status = 'active') as "active_coupons!: i64",
            (SELECT COUNT(*) FROM user_coupons) as "total_assigned!: i64",
            (SELECT COUNT(*) FROM user_coupons WHERE status = 'used') as "total_redeemed!: i64"
        "#,
    )
    .fetch_one(state.db())
    .await?;

    let redemption_rate = if stats.total_assigned > 0 {
        (stats.total_redeemed as f64) / (stats.total_assigned as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(SuccessResponse::new(CouponStats {
        total_coupons: stats.total_coupons,
        active_coupons: stats.active_coupons,
        total_assigned: stats.total_assigned,
        total_redeemed: stats.total_redeemed,
        redemption_rate,
    })))
}

/// Get coupon redemptions (admin only)
///
/// GET /api/coupons/:couponId/redemptions
async fn get_coupon_redemptions(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
    Query(query): Query<ListCouponsQuery>,
) -> AppResult<Json<SuccessResponse<PaginatedResponse<UserCouponResponse>>>> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(50).max(1);
    let offset = ((page - 1) * limit) as i64;

    let rows = sqlx::query!(
        r#"
        SELECT
            id,
            user_id,
            coupon_id,
            status::text as "status",
            qr_code,
            used_at,
            expires_at,
            created_at
        FROM user_coupons
        WHERE coupon_id = $1 AND status = 'used'
        ORDER BY used_at DESC
        LIMIT $2 OFFSET $3
        "#,
        coupon_id,
        limit as i64,
        offset,
    )
    .fetch_all(state.db())
    .await?;

    let redemptions: Vec<UserCouponResponse> = rows
        .into_iter()
        .map(|r| UserCouponResponse {
            id: r.id,
            user_id: r.user_id,
            coupon_id: r.coupon_id,
            status: r.status.map(|s| parse_user_coupon_status(&s)),
            qr_code: r.qr_code,
            used_at: r.used_at,
            expires_at: r.expires_at,
            created_at: r.created_at,
        })
        .collect();

    let total: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!: i64"
        FROM user_coupons
        WHERE coupon_id = $1 AND status = 'used'
        "#,
        coupon_id,
    )
    .fetch_one(state.db())
    .await?;

    let total_pages = ((total as f64) / (limit as f64)).ceil() as u32;

    Ok(Json(SuccessResponse::new(PaginatedResponse {
        items: redemptions,
        total,
        page,
        limit,
        total_pages,
    })))
}

/// Get coupon assignments (admin only)
///
/// GET /api/coupons/:couponId/assignments
async fn get_coupon_assignments(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
    Query(query): Query<ListCouponsQuery>,
) -> AppResult<Json<SuccessResponse<PaginatedResponse<UserCouponResponse>>>> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(50).max(1);
    let offset = ((page - 1) * limit) as i64;

    let rows = sqlx::query!(
        r#"
        SELECT
            id,
            user_id,
            coupon_id,
            status::text as "status",
            qr_code,
            used_at,
            expires_at,
            created_at
        FROM user_coupons
        WHERE coupon_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
        coupon_id,
        limit as i64,
        offset,
    )
    .fetch_all(state.db())
    .await?;

    let assignments: Vec<UserCouponResponse> = rows
        .into_iter()
        .map(|r| UserCouponResponse {
            id: r.id,
            user_id: r.user_id,
            coupon_id: r.coupon_id,
            status: r.status.map(|s| parse_user_coupon_status(&s)),
            qr_code: r.qr_code,
            used_at: r.used_at,
            expires_at: r.expires_at,
            created_at: r.created_at,
        })
        .collect();

    let total: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!: i64"
        FROM user_coupons
        WHERE coupon_id = $1
        "#,
        coupon_id,
    )
    .fetch_one(state.db())
    .await?;

    let total_pages = ((total as f64) / (limit as f64)).ceil() as u32;

    Ok(Json(SuccessResponse::new(PaginatedResponse {
        items: assignments,
        total,
        page,
        limit,
        total_pages,
    })))
}

/// Get coupon analytics time-series data (admin only)
///
/// GET /api/coupons/analytics/data
async fn get_coupon_analytics_data(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(query): Query<AnalyticsDataQuery>,
) -> AppResult<Json<SuccessResponse<serde_json::Value>>> {
    let days = query.days.unwrap_or(30).min(365) as i64;
    let start_date = Utc::now() - Duration::days(days);

    // Note: Uses runtime query because the sqlx offline cache does not have
    // this query cached, and we cannot regenerate the cache without a live DB.
    let rows: Vec<(chrono::NaiveDate, i64)> = sqlx::query_as(
        r#"
        SELECT
            DATE(uc.used_at) as date,
            COUNT(*) as count
        FROM user_coupons uc
        WHERE uc.status = 'used'
            AND uc.used_at >= $1
        GROUP BY DATE(uc.used_at)
        ORDER BY DATE(uc.used_at)
        "#,
    )
    .bind(start_date)
    .fetch_all(state.db())
    .await?;

    let data_points: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(date, count)| {
            serde_json::json!({
                "date": date.to_string(),
                "redemptions": count,
            })
        })
        .collect();

    Ok(Json(SuccessResponse::new(serde_json::json!({
        "period_days": days,
        "data_points": data_points,
    }))))
}

// ============================================================================
// Router
// ============================================================================

/// Create coupon routes with state
///
/// All routes are relative and will be nested under /api/coupons by the main router.
/// Routes:
/// - GET / - List available coupons
/// - GET /my-coupons - Get user's assigned coupons
/// - GET /:couponId - Get coupon by ID
/// - GET /validate/:qrCode - Validate coupon by QR code (public)
/// - POST / - Create a new coupon (admin)
/// - PUT /:couponId - Update a coupon (admin)
/// - DELETE /:couponId - Delete a coupon (admin)
/// - POST /assign - Assign coupon to users (admin)
/// - POST /redeem - Redeem a coupon
/// - POST /user-coupons/:userCouponId/revoke - Revoke a user coupon (admin)
/// - GET /analytics/stats - Get coupon statistics (admin)
/// - GET /:couponId/redemptions - Get coupon redemptions (admin)
/// - GET /:couponId/assignments - Get coupon assignments (admin)
pub fn routes() -> Router<AppState> {
    // Public routes (for QR code validation)
    let public_routes = Router::new().route("/validate/:qrCode", get(validate_coupon));

    // Authenticated routes (require login)
    let auth_routes = Router::new()
        .route("/", get(list_coupons))
        .route("/my-coupons", get(get_user_coupons))
        .route("/redeem", post(redeem_coupon))
        .route("/:couponId", get(get_coupon))
        .layer(middleware::from_fn(auth_middleware));

    // Admin routes (require admin role)
    let admin_routes = Router::new()
        .route("/", post(create_coupon))
        .route("/:couponId", put(update_coupon))
        .route("/:couponId", delete(delete_coupon))
        .route("/assign", post(assign_coupon))
        .route(
            "/user-coupons/:userCouponId/revoke",
            post(revoke_user_coupon),
        )
        .route("/analytics/stats", get(get_coupon_stats))
        .route("/analytics/data", get(get_coupon_analytics_data))
        .route("/:couponId/redemptions", get(get_coupon_redemptions))
        .route("/:couponId/assignments", get(get_coupon_assignments))
        .layer(middleware::from_fn(|req, next| {
            require_role(req, next, "admin")
        }))
        .layer(middleware::from_fn(auth_middleware));

    Router::new()
        .merge(public_routes)
        .merge(auth_routes)
        .merge(admin_routes)
}
