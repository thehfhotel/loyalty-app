//! Coupon and UserCoupon models
//!
//! Contains structs for coupon management and user coupon assignments.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use uuid::Uuid;

/// Coupon type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "coupon_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CouponType {
    Percentage,
    FixedAmount,
    Bogo,
    FreeUpgrade,
    FreeService,
}

/// Coupon status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "coupon_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CouponStatus {
    Draft,
    Active,
    Paused,
    Expired,
    Exhausted,
}

/// User coupon status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "user_coupon_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UserCouponStatus {
    Available,
    Used,
    Expired,
    Revoked,
}

/// Coupon database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Coupon {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    #[sqlx(rename = "type")]
    pub coupon_type: CouponType,
    pub value: Option<rust_decimal::Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<rust_decimal::Decimal>,
    pub maximum_discount: Option<rust_decimal::Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub usage_limit: Option<i32>,
    pub usage_limit_per_user: Option<i32>,
    pub used_count: Option<i32>,
    pub tier_restrictions: Option<serde_json::Value>,
    pub customer_segment: Option<serde_json::Value>,
    pub status: Option<CouponStatus>,
    pub created_by: Option<Uuid>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub original_language: Option<String>,
    pub available_languages: Option<serde_json::Value>,
    pub last_translated: Option<DateTime<Utc>>,
    pub translation_status: Option<String>,
}

/// User coupon assignment database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserCoupon {
    pub id: Uuid,
    pub user_id: Uuid,
    pub coupon_id: Uuid,
    pub status: Option<UserCouponStatus>,
    pub qr_code: String,
    pub used_at: Option<DateTime<Utc>>,
    pub used_by_admin: Option<Uuid>,
    pub redemption_location: Option<String>,
    pub redemption_details: Option<serde_json::Value>,
    pub assigned_by: Option<Uuid>,
    pub assigned_reason: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Create coupon request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCouponRequest {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub coupon_type: CouponType,
    pub value: Option<rust_decimal::Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<rust_decimal::Decimal>,
    pub maximum_discount: Option<rust_decimal::Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub usage_limit: Option<i32>,
    pub usage_limit_per_user: Option<i32>,
    pub tier_restrictions: Option<serde_json::Value>,
    pub customer_segment: Option<serde_json::Value>,
    pub status: Option<CouponStatus>,
}

/// Update coupon request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCouponRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub value: Option<rust_decimal::Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<rust_decimal::Decimal>,
    pub maximum_discount: Option<rust_decimal::Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub usage_limit: Option<i32>,
    pub usage_limit_per_user: Option<i32>,
    pub tier_restrictions: Option<serde_json::Value>,
    pub customer_segment: Option<serde_json::Value>,
    pub status: Option<CouponStatus>,
}

/// Coupon response DTO
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CouponResponse {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub coupon_type: CouponType,
    pub value: Option<rust_decimal::Decimal>,
    pub currency: Option<String>,
    pub minimum_spend: Option<rust_decimal::Decimal>,
    pub maximum_discount: Option<rust_decimal::Decimal>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub usage_limit: Option<i32>,
    pub usage_limit_per_user: Option<i32>,
    pub used_count: Option<i32>,
    pub status: Option<CouponStatus>,
    pub created_at: Option<DateTime<Utc>>,
}

/// User coupon response DTO
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserCouponResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub coupon_id: Uuid,
    pub status: Option<UserCouponStatus>,
    pub qr_code: String,
    pub used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
}

impl From<Coupon> for CouponResponse {
    fn from(coupon: Coupon) -> Self {
        Self {
            id: coupon.id,
            code: coupon.code,
            name: coupon.name,
            description: coupon.description,
            terms_and_conditions: coupon.terms_and_conditions,
            coupon_type: coupon.coupon_type,
            value: coupon.value,
            currency: coupon.currency,
            minimum_spend: coupon.minimum_spend,
            maximum_discount: coupon.maximum_discount,
            valid_from: coupon.valid_from,
            valid_until: coupon.valid_until,
            usage_limit: coupon.usage_limit,
            usage_limit_per_user: coupon.usage_limit_per_user,
            used_count: coupon.used_count,
            status: coupon.status,
            created_at: coupon.created_at,
        }
    }
}

impl From<UserCoupon> for UserCouponResponse {
    fn from(user_coupon: UserCoupon) -> Self {
        Self {
            id: user_coupon.id,
            user_id: user_coupon.user_id,
            coupon_id: user_coupon.coupon_id,
            status: user_coupon.status,
            qr_code: user_coupon.qr_code,
            used_at: user_coupon.used_at,
            expires_at: user_coupon.expires_at,
            created_at: user_coupon.created_at,
        }
    }
}
