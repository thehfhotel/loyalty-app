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
use chrono::{DateTime, Utc};
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
#[derive(Debug, Serialize, sqlx::FromRow)]
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
    #[sqlx(rename = "type")]
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

        let coupons = sqlx::query_as::<_, CouponResponse>(
            r#"
            SELECT
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
            FROM coupons
            WHERE
                ($1::text IS NULL OR status::text = $1)
                AND ($2::text IS NULL OR type::text = $2)
                AND ($3::text IS NULL OR (code ILIKE $3 OR name ILIKE $3))
            ORDER BY created_at DESC
            LIMIT $4 OFFSET $5
            "#,
        )
        .bind(status_filter)
        .bind(type_filter)
        .bind(&search_filter)
        .bind(limit as i64)
        .bind(offset)
        .fetch_all(state.db())
        .await?;

        let total: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM coupons
            WHERE
                ($1::text IS NULL OR status::text = $1)
                AND ($2::text IS NULL OR type::text = $2)
                AND ($3::text IS NULL OR (code ILIKE $3 OR name ILIKE $3))
            "#,
        )
        .bind(status_filter)
        .bind(type_filter)
        .bind(&search_filter)
        .fetch_one(state.db())
        .await?;

        (coupons, total)
    } else {
        // Regular users can only see active coupons
        let type_filter = query.coupon_type.as_deref();
        let search_filter = query.search.as_deref().map(|s| format!("%{}%", s));

        let coupons = sqlx::query_as::<_, CouponResponse>(
            r#"
            SELECT
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
            FROM coupons
            WHERE status = 'active'
                AND ($1::text IS NULL OR type::text = $1)
                AND ($2::text IS NULL OR (code ILIKE $2 OR name ILIKE $2))
                AND (valid_from IS NULL OR valid_from <= NOW())
                AND (valid_until IS NULL OR valid_until > NOW())
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#,
        )
        .bind(type_filter)
        .bind(&search_filter)
        .bind(limit as i64)
        .bind(offset)
        .fetch_all(state.db())
        .await?;

        let total: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM coupons
            WHERE status = 'active'
                AND ($1::text IS NULL OR type::text = $1)
                AND ($2::text IS NULL OR (code ILIKE $2 OR name ILIKE $2))
                AND (valid_from IS NULL OR valid_from <= NOW())
                AND (valid_until IS NULL OR valid_until > NOW())
            "#,
        )
        .bind(type_filter)
        .bind(&search_filter)
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

    let user_coupons = sqlx::query_as::<_, UserCouponWithDetails>(
        r#"
        SELECT
            uc.id,
            uc.user_id,
            uc.coupon_id,
            uc.status,
            uc.qr_code,
            uc.used_at,
            uc.expires_at,
            uc.created_at,
            c.code,
            c.name,
            c.description,
            c.type as coupon_type,
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
    )
    .bind(user_uuid)
    .bind(status_filter)
    .bind(limit as i64)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM user_coupons
        WHERE user_id = $1
            AND ($2::text IS NULL OR status::text = $2)
        "#,
    )
    .bind(user_uuid)
    .bind(status_filter)
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

    let coupon = sqlx::query_as::<_, CouponResponse>(
        r#"
        SELECT
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
        FROM coupons
        WHERE id = $1
        "#,
    )
    .bind(coupon_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Coupon".to_string()))?;

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
    .map_err(|e| {
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
            let existing: String =
                sqlx::query_scalar(r#"SELECT type::text FROM coupons WHERE id = $1"#)
                    .bind(coupon_id)
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
    let result = sqlx::query("DELETE FROM coupons WHERE id = $1")
        .bind(coupon_id)
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
    #[derive(sqlx::FromRow)]
    #[allow(dead_code)]
    struct CouponCheckRow {
        id: Uuid,
        status: String,
        valid_until: Option<DateTime<Utc>>,
    }

    let coupon = sqlx::query_as::<_, CouponCheckRow>(
        r#"
        SELECT id, status::text as status, valid_until
        FROM coupons
        WHERE id = $1
        "#,
    )
    .bind(request.coupon_id)
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

        let user_coupon = sqlx::query_as::<_, UserCouponResponse>(
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
                status,
                qr_code,
                used_at,
                expires_at,
                created_at
            "#,
        )
        .bind(user_coupon_id)
        .bind(user_id)
        .bind(request.coupon_id)
        .bind(&qr_code)
        .bind(admin_uuid)
        .bind(&request.assigned_reason)
        .bind(expires_at)
        .fetch_one(state.db())
        .await?;

        assigned_coupons.push(user_coupon);
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
    #[derive(sqlx::FromRow)]
    #[allow(dead_code)]
    struct UserCouponRedeemRow {
        id: Uuid,
        user_id: Uuid,
        status: String,
        expires_at: Option<DateTime<Utc>>,
        coupon_type: String,
        value: Option<Decimal>,
        minimum_spend: Option<Decimal>,
        maximum_discount: Option<Decimal>,
        currency: Option<String>,
    }

    let user_coupon = sqlx::query_as::<_, UserCouponRedeemRow>(
        r#"
        SELECT
            uc.id,
            uc.user_id,
            uc.status::text as status,
            uc.expires_at,
            c.type::text as coupon_type,
            c.value,
            c.minimum_spend,
            c.maximum_discount,
            c.currency
        FROM user_coupons uc
        JOIN coupons c ON uc.coupon_id = c.id
        WHERE uc.qr_code = $1
        "#,
    )
    .bind(&request.qr_code)
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

    sqlx::query(
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
    )
    .bind(user_coupon.id)
    .bind(redeemer_uuid)
    .bind(&request.location)
    .bind(&redemption_details)
    .execute(state.db())
    .await?;

    // Increment used_count on coupon
    sqlx::query(
        r#"
        UPDATE coupons
        SET used_count = COALESCE(used_count, 0) + 1, updated_at = NOW()
        WHERE id = (SELECT coupon_id FROM user_coupons WHERE id = $1)
        "#,
    )
    .bind(user_coupon.id)
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

    #[derive(sqlx::FromRow)]
    struct CouponValidateRow {
        status: String,
        expires_at: Option<DateTime<Utc>>,
        name: String,
        description: Option<String>,
        coupon_type: String,
        value: Option<Decimal>,
        currency: Option<String>,
        minimum_spend: Option<Decimal>,
        maximum_discount: Option<Decimal>,
        valid_until: Option<DateTime<Utc>>,
    }

    let user_coupon = sqlx::query_as::<_, CouponValidateRow>(
        r#"
        SELECT
            uc.status::text as status,
            uc.expires_at,
            c.name,
            c.description,
            c.type::text as coupon_type,
            c.value,
            c.currency,
            c.minimum_spend,
            c.maximum_discount,
            c.valid_until
        FROM user_coupons uc
        JOIN coupons c ON uc.coupon_id = c.id
        WHERE uc.qr_code = $1
        "#,
    )
    .bind(&qr_code)
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
                        coupon_type: match uc.coupon_type.as_str() {
                            "percentage" => CouponType::Percentage,
                            "fixed_amount" => CouponType::FixedAmount,
                            "bogo" => CouponType::Bogo,
                            "free_upgrade" => CouponType::FreeUpgrade,
                            "free_service" => CouponType::FreeService,
                            _ => CouponType::Percentage,
                        },
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
    let result = sqlx::query(
        r#"
        UPDATE user_coupons
        SET status = 'revoked', updated_at = NOW()
        WHERE id = $1 AND status = 'available'
        "#,
    )
    .bind(user_coupon_id)
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
    #[derive(sqlx::FromRow)]
    struct CouponStatsRow {
        total_coupons: i64,
        active_coupons: i64,
        total_assigned: i64,
        total_redeemed: i64,
    }

    let stats = sqlx::query_as::<_, CouponStatsRow>(
        r#"
        SELECT
            (SELECT COUNT(*) FROM coupons) as total_coupons,
            (SELECT COUNT(*) FROM coupons WHERE status = 'active') as active_coupons,
            (SELECT COUNT(*) FROM user_coupons) as total_assigned,
            (SELECT COUNT(*) FROM user_coupons WHERE status = 'used') as total_redeemed
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

    let redemptions = sqlx::query_as::<_, UserCouponResponse>(
        r#"
        SELECT
            id,
            user_id,
            coupon_id,
            status,
            qr_code,
            used_at,
            expires_at,
            created_at
        FROM user_coupons
        WHERE coupon_id = $1 AND status = 'used'
        ORDER BY used_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(coupon_id)
    .bind(limit as i64)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM user_coupons
        WHERE coupon_id = $1 AND status = 'used'
        "#,
    )
    .bind(coupon_id)
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

    let assignments = sqlx::query_as::<_, UserCouponResponse>(
        r#"
        SELECT
            id,
            user_id,
            coupon_id,
            status,
            qr_code,
            used_at,
            expires_at,
            created_at
        FROM user_coupons
        WHERE coupon_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(coupon_id)
    .bind(limit as i64)
    .bind(offset)
    .fetch_all(state.db())
    .await?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM user_coupons
        WHERE coupon_id = $1
        "#,
    )
    .bind(coupon_id)
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
