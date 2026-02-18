//! Coupon service module
//!
//! Provides coupon management functionality including:
//! - Coupon CRUD operations
//! - User coupon assignments
//! - Coupon redemption
//! - Eligibility checking

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::coupon::{
    Coupon, CouponResponse, CouponStatus, CouponType, UserCoupon, UserCouponStatus,
};
use crate::services::AppState;

/// Filters for listing coupons
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CouponFilters {
    /// Filter by status
    pub status: Option<CouponStatus>,
    /// Filter by type
    pub coupon_type: Option<CouponType>,
    /// Search by code, name, or description
    pub search: Option<String>,
    /// Filter by creator
    pub created_by: Option<Uuid>,
    /// Page number (1-indexed)
    pub page: Option<i32>,
    /// Items per page
    pub limit: Option<i32>,
}

/// DTO for creating a new coupon
#[derive(Debug, Clone, Deserialize)]
pub struct CreateCouponDto {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub coupon_type: CouponType,
    pub value: Option<Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<Decimal>,
    pub maximum_discount: Option<Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub usage_limit: Option<i32>,
    pub usage_limit_per_user: Option<i32>,
    pub tier_restrictions: Option<Vec<String>>,
    pub customer_segment: Option<serde_json::Value>,
    pub original_language: Option<String>,
}

/// DTO for updating an existing coupon
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCouponDto {
    pub code: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub coupon_type: Option<CouponType>,
    pub value: Option<Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<Decimal>,
    pub maximum_discount: Option<Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub usage_limit: Option<i32>,
    pub usage_limit_per_user: Option<i32>,
    pub tier_restrictions: Option<Vec<String>>,
    pub customer_segment: Option<serde_json::Value>,
    pub status: Option<CouponStatus>,
}

/// User coupon with coupon details
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserCouponWithDetails {
    // UserCoupon fields
    pub id: Uuid,
    pub user_id: Uuid,
    pub coupon_id: Uuid,
    pub status: Option<UserCouponStatus>,
    pub qr_code: String,
    pub used_at: Option<DateTime<Utc>>,
    pub used_by_admin: Option<Uuid>,
    pub redemption_location: Option<String>,
    pub assigned_by: Option<Uuid>,
    pub assigned_reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub user_coupon_created_at: Option<DateTime<Utc>>,

    // Coupon details
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub coupon_type: CouponType,
    pub value: Option<Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<Decimal>,
    pub maximum_discount: Option<Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,

    // Calculated fields
    pub effective_expiry: Option<DateTime<Utc>>,
    pub expiring_soon: Option<bool>,
}

/// Response for user coupon with details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCouponWithDetailsResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub coupon_id: Uuid,
    pub status: Option<UserCouponStatus>,
    pub qr_code: String,
    pub used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub assigned_at: Option<DateTime<Utc>>,

    // Coupon details
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub coupon_type: CouponType,
    pub value: Option<Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<Decimal>,
    pub maximum_discount: Option<Decimal>,
    pub coupon_expires_at: Option<DateTime<Utc>>,

    // Calculated fields
    pub effective_expiry: Option<DateTime<Utc>>,
    pub expiring_soon: bool,
}

impl From<UserCouponWithDetails> for UserCouponWithDetailsResponse {
    fn from(uc: UserCouponWithDetails) -> Self {
        Self {
            id: uc.id,
            user_id: uc.user_id,
            coupon_id: uc.coupon_id,
            status: uc.status,
            qr_code: uc.qr_code,
            used_at: uc.used_at,
            expires_at: uc.expires_at,
            assigned_at: uc.user_coupon_created_at,
            code: uc.code,
            name: uc.name,
            description: uc.description,
            terms_and_conditions: uc.terms_and_conditions,
            coupon_type: uc.coupon_type,
            value: uc.value,
            currency: uc.currency,
            minimum_spend: uc.minimum_spend,
            maximum_discount: uc.maximum_discount,
            coupon_expires_at: uc.valid_until,
            effective_expiry: uc.effective_expiry,
            expiring_soon: uc.expiring_soon.unwrap_or(false),
        }
    }
}

/// Paginated response for coupons
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouponListResponse {
    pub coupons: Vec<CouponResponse>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

/// Paginated response for user coupons
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCouponListResponse {
    pub coupons: Vec<UserCouponWithDetailsResponse>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

/// Coupon service trait defining coupon operations
#[async_trait]
pub trait CouponService: Send + Sync {
    /// List coupons with optional filters and pagination
    async fn list_coupons(&self, filters: CouponFilters) -> Result<CouponListResponse, AppError>;

    /// Get a coupon by ID
    async fn get_coupon(&self, coupon_id: Uuid) -> Result<Coupon, AppError>;

    /// Create a new coupon
    async fn create_coupon(
        &self,
        data: CreateCouponDto,
        created_by: Uuid,
    ) -> Result<Coupon, AppError>;

    /// Update an existing coupon
    async fn update_coupon(
        &self,
        coupon_id: Uuid,
        data: UpdateCouponDto,
    ) -> Result<Coupon, AppError>;

    /// Get all coupons for a user
    async fn get_user_coupons(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserCouponWithDetailsResponse>, AppError>;

    /// Assign a coupon to a user
    async fn assign_coupon(
        &self,
        user_id: Uuid,
        coupon_id: Uuid,
        assigned_by: Option<Uuid>,
        assigned_reason: Option<String>,
        custom_expiry: Option<DateTime<Utc>>,
    ) -> Result<UserCoupon, AppError>;

    /// Redeem a user coupon
    async fn redeem_coupon(&self, user_coupon_id: Uuid) -> Result<UserCoupon, AppError>;

    /// Check if a user is eligible for a coupon
    async fn check_eligibility(&self, user_id: Uuid, coupon_id: Uuid) -> Result<bool, AppError>;
}

/// Implementation of the CouponService trait
pub struct CouponServiceImpl {
    state: AppState,
}

impl CouponServiceImpl {
    /// Create a new CouponServiceImpl instance
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

#[async_trait]
impl CouponService for CouponServiceImpl {
    async fn list_coupons(&self, filters: CouponFilters) -> Result<CouponListResponse, AppError> {
        let page = filters.page.unwrap_or(1).max(1);
        let limit = filters.limit.unwrap_or(20).min(100).max(1);
        let offset = (page - 1) * limit;

        // Build dynamic query parts
        let mut conditions: Vec<String> = Vec::new();
        let mut param_idx = 1;

        if filters.status.is_some() {
            conditions.push(format!("status = ${}", param_idx));
            param_idx += 1;
        }

        if filters.coupon_type.is_some() {
            conditions.push(format!("type = ${}", param_idx));
            param_idx += 1;
        }

        if filters.search.is_some() {
            conditions.push(format!(
                "(code ILIKE ${} OR name ILIKE ${} OR description ILIKE ${})",
                param_idx, param_idx, param_idx
            ));
            param_idx += 1;
        }

        if filters.created_by.is_some() {
            conditions.push(format!("created_by = ${}", param_idx));
            param_idx += 1;
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // Get total count
        let count_query = format!("SELECT COUNT(*) as count FROM coupons {}", where_clause);
        let mut count_builder = sqlx::query_scalar::<_, i64>(&count_query);

        if let Some(ref status) = filters.status {
            count_builder = count_builder.bind(status);
        }
        if let Some(ref coupon_type) = filters.coupon_type {
            count_builder = count_builder.bind(coupon_type);
        }
        if let Some(ref search) = filters.search {
            count_builder = count_builder.bind(format!("%{}%", search));
        }
        if let Some(ref created_by) = filters.created_by {
            count_builder = count_builder.bind(created_by);
        }

        let total = count_builder
            .fetch_one(self.state.db.pool())
            .await
            .map_err(|e| AppError::DatabaseQuery(format!("Failed to count coupons: {}", e)))?;

        // Get coupons
        let list_query = format!(
            r#"
            SELECT id, code, name, description, terms_and_conditions,
                   type as coupon_type, value, currency, minimum_spend, maximum_discount,
                   valid_from, valid_until, usage_limit, usage_limit_per_user,
                   used_count, tier_restrictions, customer_segment, status,
                   created_by, created_at, updated_at, original_language,
                   available_languages, last_translated, translation_status
            FROM coupons
            {}
            ORDER BY created_at DESC
            LIMIT ${} OFFSET ${}
            "#,
            where_clause,
            param_idx,
            param_idx + 1
        );

        let mut list_builder = sqlx::query_as::<_, Coupon>(&list_query);

        if let Some(ref status) = filters.status {
            list_builder = list_builder.bind(status);
        }
        if let Some(ref coupon_type) = filters.coupon_type {
            list_builder = list_builder.bind(coupon_type);
        }
        if let Some(ref search) = filters.search {
            list_builder = list_builder.bind(format!("%{}%", search));
        }
        if let Some(ref created_by) = filters.created_by {
            list_builder = list_builder.bind(created_by);
        }

        list_builder = list_builder.bind(limit).bind(offset);

        let coupons = list_builder
            .fetch_all(self.state.db.pool())
            .await
            .map_err(|e| AppError::DatabaseQuery(format!("Failed to fetch coupons: {}", e)))?;

        let total_pages = ((total as f64) / (limit as f64)).ceil() as i32;

        Ok(CouponListResponse {
            coupons: coupons.into_iter().map(CouponResponse::from).collect(),
            total,
            page,
            limit,
            total_pages,
        })
    }

    async fn get_coupon(&self, coupon_id: Uuid) -> Result<Coupon, AppError> {
        let row = sqlx::query!(
            r#"
            SELECT id, code, name, description, terms_and_conditions,
                   type as "coupon_type: CouponType", value, currency, minimum_spend, maximum_discount,
                   valid_from, valid_until, usage_limit, usage_limit_per_user,
                   used_count, tier_restrictions, customer_segment,
                   status as "status: CouponStatus",
                   created_by, created_at, updated_at, original_language,
                   available_languages, last_translated, translation_status
            FROM coupons
            WHERE id = $1
            "#,
            coupon_id,
        )
        .fetch_optional(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to fetch coupon: {}", e)))?;

        row.map(|r| Coupon {
            id: r.id,
            code: r.code,
            name: r.name,
            description: r.description,
            terms_and_conditions: r.terms_and_conditions,
            coupon_type: r.coupon_type,
            value: r.value,
            currency: r.currency,
            minimum_spend: r.minimum_spend,
            maximum_discount: r.maximum_discount,
            valid_from: r.valid_from,
            valid_until: r.valid_until,
            usage_limit: r.usage_limit,
            usage_limit_per_user: r.usage_limit_per_user,
            used_count: r.used_count,
            tier_restrictions: r.tier_restrictions,
            customer_segment: r.customer_segment,
            status: r.status,
            created_by: r.created_by,
            created_at: r.created_at,
            updated_at: r.updated_at,
            original_language: r.original_language,
            available_languages: r.available_languages,
            last_translated: r.last_translated,
            translation_status: r.translation_status,
        })
        .ok_or_else(|| AppError::NotFound("Coupon not found".to_string()))
    }

    async fn create_coupon(
        &self,
        data: CreateCouponDto,
        created_by: Uuid,
    ) -> Result<Coupon, AppError> {
        // Check if code already exists
        let existing = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!" FROM coupons WHERE code = $1"#,
            &data.code,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to check coupon code: {}", e)))?;

        if existing > 0 {
            return Err(AppError::BadRequest(
                "Coupon code already exists".to_string(),
            ));
        }

        let tier_restrictions_json = data
            .tier_restrictions
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Array(vec![])));

        let original_language = data
            .original_language
            .clone()
            .unwrap_or_else(|| "th".to_string());
        let available_languages = serde_json::to_value(vec![&original_language])
            .unwrap_or(serde_json::Value::Array(vec![]));

        let currency = data.currency.unwrap_or_else(|| "THB".to_string());
        let valid_from = data.valid_from.unwrap_or_else(Utc::now);
        let usage_limit_per_user = data.usage_limit_per_user.unwrap_or(1);

        let row = sqlx::query!(
            r#"
            INSERT INTO coupons (
                code, name, description, terms_and_conditions, type, value, currency,
                minimum_spend, maximum_discount, valid_from, valid_until, usage_limit,
                usage_limit_per_user, tier_restrictions, customer_segment, created_by,
                original_language, available_languages
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING id, code, name, description, terms_and_conditions,
                      type as "coupon_type: CouponType", value, currency, minimum_spend, maximum_discount,
                      valid_from, valid_until, usage_limit, usage_limit_per_user,
                      used_count, tier_restrictions, customer_segment,
                      status as "status: CouponStatus",
                      created_by, created_at, updated_at, original_language,
                      available_languages, last_translated, translation_status
            "#,
            &data.code,
            &data.name,
            data.description.as_deref(),
            data.terms_and_conditions.as_deref(),
            &data.coupon_type as &CouponType,
            data.value,
            &currency,
            data.minimum_spend,
            data.maximum_discount,
            valid_from,
            data.valid_until,
            data.usage_limit,
            usage_limit_per_user,
            tier_restrictions_json as Option<serde_json::Value>,
            data.customer_segment as Option<serde_json::Value>,
            created_by,
            &original_language,
            &available_languages,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to create coupon: {}", e)))?;

        let coupon = Coupon {
            id: row.id,
            code: row.code,
            name: row.name,
            description: row.description,
            terms_and_conditions: row.terms_and_conditions,
            coupon_type: row.coupon_type,
            value: row.value,
            currency: row.currency,
            minimum_spend: row.minimum_spend,
            maximum_discount: row.maximum_discount,
            valid_from: row.valid_from,
            valid_until: row.valid_until,
            usage_limit: row.usage_limit,
            usage_limit_per_user: row.usage_limit_per_user,
            used_count: row.used_count,
            tier_restrictions: row.tier_restrictions,
            customer_segment: row.customer_segment,
            status: row.status,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            original_language: row.original_language,
            available_languages: row.available_languages,
            last_translated: row.last_translated,
            translation_status: row.translation_status,
        };

        tracing::info!(
            coupon_code = %data.code,
            created_by = %created_by,
            "Coupon created"
        );

        Ok(coupon)
    }

    async fn update_coupon(
        &self,
        coupon_id: Uuid,
        data: UpdateCouponDto,
    ) -> Result<Coupon, AppError> {
        // Check if coupon exists
        let existing = self.get_coupon(coupon_id).await?;

        // Check if code is being changed and already exists
        if let Some(ref new_code) = data.code {
            if new_code != &existing.code {
                let code_exists = sqlx::query_scalar!(
                    r#"SELECT COUNT(*) as "count!" FROM coupons WHERE code = $1 AND id != $2"#,
                    new_code,
                    coupon_id,
                )
                .fetch_one(self.state.db.pool())
                .await
                .map_err(|e| {
                    AppError::DatabaseQuery(format!("Failed to check coupon code: {}", e))
                })?;

                if code_exists > 0 {
                    return Err(AppError::BadRequest(
                        "Coupon code already exists".to_string(),
                    ));
                }
            }
        }

        let tier_restrictions_json = data
            .tier_restrictions
            .map(|t| serde_json::to_value(t).unwrap_or(serde_json::Value::Array(vec![])));

        let row = sqlx::query!(
            r#"
            UPDATE coupons SET
                code = COALESCE($2, code),
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                terms_and_conditions = COALESCE($5, terms_and_conditions),
                type = COALESCE($6, type),
                value = COALESCE($7, value),
                currency = COALESCE($8, currency),
                minimum_spend = COALESCE($9, minimum_spend),
                maximum_discount = COALESCE($10, maximum_discount),
                valid_from = COALESCE($11, valid_from),
                valid_until = COALESCE($12, valid_until),
                usage_limit = COALESCE($13, usage_limit),
                usage_limit_per_user = COALESCE($14, usage_limit_per_user),
                tier_restrictions = COALESCE($15, tier_restrictions),
                customer_segment = COALESCE($16, customer_segment),
                status = COALESCE($17, status),
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, code, name, description, terms_and_conditions,
                      type as "coupon_type: CouponType", value, currency, minimum_spend, maximum_discount,
                      valid_from, valid_until, usage_limit, usage_limit_per_user,
                      used_count, tier_restrictions, customer_segment,
                      status as "status: CouponStatus",
                      created_by, created_at, updated_at, original_language,
                      available_languages, last_translated, translation_status
            "#,
            coupon_id,
            data.code.as_deref(),
            data.name.as_deref(),
            data.description.as_deref(),
            data.terms_and_conditions.as_deref(),
            data.coupon_type as Option<CouponType>,
            data.value,
            data.currency.as_deref(),
            data.minimum_spend,
            data.maximum_discount,
            data.valid_from,
            data.valid_until,
            data.usage_limit,
            data.usage_limit_per_user,
            tier_restrictions_json as Option<serde_json::Value>,
            data.customer_segment as Option<serde_json::Value>,
            data.status as Option<CouponStatus>,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to update coupon: {}", e)))?;

        let coupon = Coupon {
            id: row.id,
            code: row.code,
            name: row.name,
            description: row.description,
            terms_and_conditions: row.terms_and_conditions,
            coupon_type: row.coupon_type,
            value: row.value,
            currency: row.currency,
            minimum_spend: row.minimum_spend,
            maximum_discount: row.maximum_discount,
            valid_from: row.valid_from,
            valid_until: row.valid_until,
            usage_limit: row.usage_limit,
            usage_limit_per_user: row.usage_limit_per_user,
            used_count: row.used_count,
            tier_restrictions: row.tier_restrictions,
            customer_segment: row.customer_segment,
            status: row.status,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            original_language: row.original_language,
            available_languages: row.available_languages,
            last_translated: row.last_translated,
            translation_status: row.translation_status,
        };

        tracing::info!(
            coupon_id = %coupon_id,
            "Coupon updated"
        );

        Ok(coupon)
    }

    async fn get_user_coupons(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserCouponWithDetailsResponse>, AppError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                uc.id,
                uc.user_id,
                uc.coupon_id,
                uc.status as "status: UserCouponStatus",
                uc.qr_code,
                uc.used_at,
                uc.used_by_admin,
                uc.redemption_location,
                uc.assigned_by,
                uc.assigned_reason,
                uc.expires_at,
                uc.created_at as user_coupon_created_at,
                c.code,
                c.name,
                c.description,
                c.terms_and_conditions,
                c.type as "coupon_type: CouponType",
                c.value,
                c.currency,
                c.minimum_spend,
                c.maximum_discount,
                c.valid_from,
                c.valid_until,
                CASE
                    WHEN uc.expires_at IS NOT NULL THEN uc.expires_at
                    ELSE c.valid_until
                END as effective_expiry,
                CASE
                    WHEN uc.expires_at IS NOT NULL AND uc.expires_at <= NOW() + INTERVAL '7 days' THEN true
                    WHEN c.valid_until IS NOT NULL AND c.valid_until <= NOW() + INTERVAL '7 days' THEN true
                    ELSE false
                END as expiring_soon
            FROM user_coupons uc
            JOIN coupons c ON uc.coupon_id = c.id
            WHERE uc.user_id = $1
              AND uc.status = 'available'
              AND (uc.expires_at IS NULL OR uc.expires_at > NOW())
              AND (c.valid_until IS NULL OR c.valid_until > NOW())
            ORDER BY uc.created_at DESC
            "#,
            user_id,
        )
        .fetch_all(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to fetch user coupons: {}", e)))?;

        Ok(rows
            .into_iter()
            .map(|r| {
                let uc = UserCouponWithDetails {
                    id: r.id,
                    user_id: r.user_id,
                    coupon_id: r.coupon_id,
                    status: r.status,
                    qr_code: r.qr_code,
                    used_at: r.used_at,
                    used_by_admin: r.used_by_admin,
                    redemption_location: r.redemption_location,
                    assigned_by: r.assigned_by,
                    assigned_reason: r.assigned_reason,
                    expires_at: r.expires_at,
                    user_coupon_created_at: r.user_coupon_created_at,
                    code: r.code,
                    name: r.name,
                    description: r.description,
                    terms_and_conditions: r.terms_and_conditions,
                    coupon_type: r.coupon_type,
                    value: r.value,
                    currency: r.currency,
                    minimum_spend: r.minimum_spend,
                    maximum_discount: r.maximum_discount,
                    valid_from: r.valid_from,
                    valid_until: r.valid_until,
                    effective_expiry: r.effective_expiry,
                    expiring_soon: r.expiring_soon,
                };
                UserCouponWithDetailsResponse::from(uc)
            })
            .collect())
    }

    async fn assign_coupon(
        &self,
        user_id: Uuid,
        coupon_id: Uuid,
        assigned_by: Option<Uuid>,
        assigned_reason: Option<String>,
        custom_expiry: Option<DateTime<Utc>>,
    ) -> Result<UserCoupon, AppError> {
        // Verify coupon exists and is active
        let coupon = self.get_coupon(coupon_id).await?;

        if coupon.status != Some(CouponStatus::Active) {
            return Err(AppError::BadRequest("Coupon is not active".to_string()));
        }

        // Check usage limit
        if let (Some(limit), Some(used)) = (coupon.usage_limit, coupon.used_count) {
            if used >= limit {
                return Err(AppError::BadRequest(
                    "Coupon usage limit reached".to_string(),
                ));
            }
        }

        // Check user's usage limit for this coupon
        let user_usage_count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!" FROM user_coupons WHERE user_id = $1 AND coupon_id = $2"#,
            user_id,
            coupon_id,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| {
            AppError::DatabaseQuery(format!("Failed to check user coupon usage: {}", e))
        })?;

        let user_limit = coupon.usage_limit_per_user.unwrap_or(1);
        if user_usage_count >= user_limit as i64 {
            return Err(AppError::BadRequest(
                "User has reached coupon usage limit".to_string(),
            ));
        }

        // Generate QR code
        let qr_code = format!(
            "CPN-{}-{}-{}",
            coupon.code,
            user_id.to_string().split('-').next().unwrap_or(""),
            Utc::now().timestamp_millis()
        );

        // Determine expiry
        let expires_at = custom_expiry.or(coupon.valid_until);

        let row = sqlx::query!(
            r#"
            INSERT INTO user_coupons (
                user_id, coupon_id, qr_code, assigned_by, assigned_reason, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, user_id, coupon_id,
                      status as "status: UserCouponStatus",
                      qr_code, used_at,
                      used_by_admin, redemption_location, redemption_details,
                      assigned_by, assigned_reason, expires_at, created_at, updated_at
            "#,
            user_id,
            coupon_id,
            &qr_code,
            assigned_by,
            assigned_reason.as_deref(),
            expires_at,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to assign coupon: {}", e)))?;

        let user_coupon = UserCoupon {
            id: row.id,
            user_id: row.user_id,
            coupon_id: row.coupon_id,
            status: row.status,
            qr_code: row.qr_code,
            used_at: row.used_at,
            used_by_admin: row.used_by_admin,
            redemption_location: row.redemption_location,
            redemption_details: row.redemption_details,
            assigned_by: row.assigned_by,
            assigned_reason: row.assigned_reason,
            expires_at: row.expires_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };

        tracing::info!(
            user_id = %user_id,
            coupon_id = %coupon_id,
            "Coupon assigned to user"
        );

        Ok(user_coupon)
    }

    async fn redeem_coupon(&self, user_coupon_id: Uuid) -> Result<UserCoupon, AppError> {
        // Get the user coupon
        let uc_row = sqlx::query!(
            r#"
            SELECT id, user_id, coupon_id,
                   status as "status: UserCouponStatus",
                   qr_code, used_at,
                   used_by_admin, redemption_location, redemption_details,
                   assigned_by, assigned_reason, expires_at, created_at, updated_at
            FROM user_coupons
            WHERE id = $1
            "#,
            user_coupon_id,
        )
        .fetch_optional(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to fetch user coupon: {}", e)))?
        .ok_or_else(|| AppError::NotFound("User coupon not found".to_string()))?;

        let user_coupon = UserCoupon {
            id: uc_row.id,
            user_id: uc_row.user_id,
            coupon_id: uc_row.coupon_id,
            status: uc_row.status,
            qr_code: uc_row.qr_code,
            used_at: uc_row.used_at,
            used_by_admin: uc_row.used_by_admin,
            redemption_location: uc_row.redemption_location,
            redemption_details: uc_row.redemption_details,
            assigned_by: uc_row.assigned_by,
            assigned_reason: uc_row.assigned_reason,
            expires_at: uc_row.expires_at,
            created_at: uc_row.created_at,
            updated_at: uc_row.updated_at,
        };

        // Check if coupon is available
        if user_coupon.status != Some(UserCouponStatus::Available) {
            return Err(AppError::BadRequest(
                "Coupon is not available for redemption".to_string(),
            ));
        }

        // Check if expired
        if let Some(expires_at) = user_coupon.expires_at {
            if expires_at < Utc::now() {
                return Err(AppError::BadRequest("Coupon has expired".to_string()));
            }
        }

        // Update the user coupon status
        let upd_row = sqlx::query!(
            r#"
            UPDATE user_coupons
            SET status = 'used', used_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING id, user_id, coupon_id,
                      status as "status: UserCouponStatus",
                      qr_code, used_at,
                      used_by_admin, redemption_location, redemption_details,
                      assigned_by, assigned_reason, expires_at, created_at, updated_at
            "#,
            user_coupon_id,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to redeem coupon: {}", e)))?;

        let updated_coupon = UserCoupon {
            id: upd_row.id,
            user_id: upd_row.user_id,
            coupon_id: upd_row.coupon_id,
            status: upd_row.status,
            qr_code: upd_row.qr_code,
            used_at: upd_row.used_at,
            used_by_admin: upd_row.used_by_admin,
            redemption_location: upd_row.redemption_location,
            redemption_details: upd_row.redemption_details,
            assigned_by: upd_row.assigned_by,
            assigned_reason: upd_row.assigned_reason,
            expires_at: upd_row.expires_at,
            created_at: upd_row.created_at,
            updated_at: upd_row.updated_at,
        };

        // Increment the coupon's used count
        sqlx::query!(
            "UPDATE coupons SET used_count = COALESCE(used_count, 0) + 1, updated_at = NOW() WHERE id = $1",
            user_coupon.coupon_id,
        )
        .execute(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to update coupon used count: {}", e)))?;

        tracing::info!(
            user_coupon_id = %user_coupon_id,
            user_id = %user_coupon.user_id,
            coupon_id = %user_coupon.coupon_id,
            "Coupon redeemed"
        );

        Ok(updated_coupon)
    }

    async fn check_eligibility(&self, user_id: Uuid, coupon_id: Uuid) -> Result<bool, AppError> {
        // Get the coupon
        let coupon = self.get_coupon(coupon_id).await?;

        // Check if coupon is active
        if coupon.status != Some(CouponStatus::Active) {
            return Ok(false);
        }

        // Check validity period
        let now = Utc::now();
        if let Some(valid_from) = coupon.valid_from {
            if now < valid_from {
                return Ok(false);
            }
        }
        if let Some(valid_until) = coupon.valid_until {
            if now > valid_until {
                return Ok(false);
            }
        }

        // Check global usage limit
        if let (Some(limit), Some(used)) = (coupon.usage_limit, coupon.used_count) {
            if used >= limit {
                return Ok(false);
            }
        }

        // Check user's usage limit for this coupon
        let user_usage_count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!" FROM user_coupons WHERE user_id = $1 AND coupon_id = $2"#,
            user_id,
            coupon_id,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| {
            AppError::DatabaseQuery(format!("Failed to check user coupon usage: {}", e))
        })?;

        let user_limit = coupon.usage_limit_per_user.unwrap_or(1);
        if user_usage_count >= user_limit as i64 {
            return Ok(false);
        }

        // Check tier restrictions if present
        if let Some(tier_restrictions) = &coupon.tier_restrictions {
            if let Some(tiers) = tier_restrictions.as_array() {
                if !tiers.is_empty() {
                    // Get user's tier
                    let user_tier: Option<String> = sqlx::query_scalar!(
                        r#"
                        SELECT t.name as "name!"
                        FROM user_loyalty ul
                        JOIN tiers t ON ul.tier_id = t.id
                        WHERE ul.user_id = $1
                        "#,
                        user_id,
                    )
                    .fetch_optional(self.state.db.pool())
                    .await
                    .map_err(|e| {
                        AppError::DatabaseQuery(format!("Failed to check user tier: {}", e))
                    })?;

                    if let Some(tier) = user_tier {
                        let tier_allowed = tiers
                            .iter()
                            .any(|t| t.as_str().map(|s| s == tier).unwrap_or(false));
                        if !tier_allowed {
                            return Ok(false);
                        }
                    } else {
                        // User has no tier, check if that's allowed
                        return Ok(false);
                    }
                }
            }
        }

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coupon_filters_default() {
        let filters = CouponFilters::default();
        assert!(filters.status.is_none());
        assert!(filters.coupon_type.is_none());
        assert!(filters.search.is_none());
        assert!(filters.page.is_none());
        assert!(filters.limit.is_none());
    }

    #[test]
    fn test_create_coupon_dto() {
        let dto = CreateCouponDto {
            code: "TEST10".to_string(),
            name: "Test Coupon".to_string(),
            description: Some("Test description".to_string()),
            terms_and_conditions: None,
            coupon_type: CouponType::Percentage,
            value: Some(Decimal::new(10, 0)),
            currency: Some("THB".to_string()),
            minimum_spend: None,
            maximum_discount: None,
            valid_from: None,
            valid_until: None,
            usage_limit: Some(100),
            usage_limit_per_user: Some(1),
            tier_restrictions: Some(vec!["Gold".to_string(), "Platinum".to_string()]),
            customer_segment: None,
            original_language: Some("th".to_string()),
        };

        assert_eq!(dto.code, "TEST10");
        assert_eq!(dto.tier_restrictions.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn test_update_coupon_dto_partial() {
        let dto = UpdateCouponDto {
            code: None,
            name: Some("Updated Name".to_string()),
            description: None,
            terms_and_conditions: None,
            coupon_type: None,
            value: None,
            currency: None,
            minimum_spend: None,
            maximum_discount: None,
            valid_from: None,
            valid_until: None,
            usage_limit: None,
            usage_limit_per_user: None,
            tier_restrictions: None,
            customer_segment: None,
            status: Some(CouponStatus::Active),
        };

        assert!(dto.code.is_none());
        assert_eq!(dto.name, Some("Updated Name".to_string()));
        assert_eq!(dto.status, Some(CouponStatus::Active));
    }
}
