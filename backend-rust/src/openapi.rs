//! OpenAPI documentation configuration
//!
//! This module configures utoipa to generate OpenAPI 3.0 specification
//! for the Loyalty App backend API. The generated spec can be used to
//! generate TypeScript clients or viewed via Swagger UI.
//!
//! ## Usage
//!
//! Add Swagger UI routes to your application:
//!
//! ```ignore
//! use loyalty_backend::openapi::swagger_routes;
//!
//! let app = Router::new()
//!     .merge(swagger_routes())
//!     .merge(api_routes);
//! ```
//!
//! This will expose:
//! - `GET /api/docs` - Interactive Swagger UI
//! - `GET /api/openapi.json` - Raw OpenAPI specification in JSON format

use axum::Router;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};
use utoipa_swagger_ui::SwaggerUi;

/// Security scheme modifier to add JWT Bearer authentication
struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some("JWT access token obtained from /api/auth/login"))
                    .build(),
            ),
        );
    }
}

/// OpenAPI documentation for the Loyalty App Backend
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Loyalty App API",
        version = "1.0.0",
        description = "REST API for the Loyalty Program Management System. This API provides endpoints for user authentication, loyalty program management, coupons, surveys, and real-time event streaming.",
        license(
            name = "Proprietary",
        ),
        contact(
            name = "Loyalty App Team",
            email = "support@loyalty-app.com"
        )
    ),
    servers(
        (url = "/api", description = "API base path")
    ),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "auth", description = "Authentication and authorization endpoints"),
        (name = "users", description = "User profile and management endpoints"),
        (name = "loyalty", description = "Loyalty program endpoints - tiers, points, transactions"),
        (name = "coupons", description = "Coupon management and redemption endpoints"),
        (name = "surveys", description = "Survey management and response endpoints"),
        (name = "sse", description = "Server-Sent Events for real-time updates")
    ),
    paths(
        // Health endpoints
        crate::openapi::paths::health_check,
        crate::openapi::paths::health_check_db,
        crate::openapi::paths::health_check_redis,
        crate::openapi::paths::health_check_full,
        // Auth endpoints
        crate::openapi::paths::auth_register,
        crate::openapi::paths::auth_login,
        crate::openapi::paths::auth_logout,
        crate::openapi::paths::auth_refresh,
        crate::openapi::paths::auth_forgot_password,
        crate::openapi::paths::auth_reset_password,
        crate::openapi::paths::auth_me,
        // User endpoints
        crate::openapi::paths::get_current_user,
        crate::openapi::paths::update_current_user,
        crate::openapi::paths::change_password,
        crate::openapi::paths::get_loyalty_status_user,
        crate::openapi::paths::list_users,
        crate::openapi::paths::get_user_by_id,
        crate::openapi::paths::delete_account,
        // Loyalty endpoints
        crate::openapi::paths::get_tiers,
        crate::openapi::paths::get_loyalty_status,
        crate::openapi::paths::get_transactions,
        crate::openapi::paths::award_points,
        crate::openapi::paths::recalculate_tier,
        // Coupon endpoints
        crate::openapi::paths::list_coupons,
        crate::openapi::paths::get_coupon,
        crate::openapi::paths::create_coupon,
        crate::openapi::paths::update_coupon,
        crate::openapi::paths::delete_coupon,
        crate::openapi::paths::get_user_coupons,
        crate::openapi::paths::assign_coupon,
        crate::openapi::paths::redeem_coupon,
        crate::openapi::paths::validate_coupon,
        crate::openapi::paths::get_coupon_stats,
        // Survey endpoints
        crate::openapi::paths::list_surveys,
        crate::openapi::paths::get_survey,
        crate::openapi::paths::create_survey,
        crate::openapi::paths::update_survey,
        crate::openapi::paths::submit_survey_response,
        crate::openapi::paths::get_survey_responses,
        // SSE endpoints
        crate::openapi::paths::sse_events,
        crate::openapi::paths::sse_info,
    ),
    components(
        schemas(
            // Error responses
            schemas::ErrorResponse,
            // Health schemas
            schemas::HealthResponse,
            schemas::DbHealthResponse,
            schemas::RedisHealthResponse,
            schemas::SystemHealthResponse,
            // Auth schemas
            schemas::RegisterRequest,
            schemas::LoginRequest,
            schemas::LogoutRequest,
            schemas::RefreshTokenRequest,
            schemas::ForgotPasswordRequest,
            schemas::ResetPasswordRequest,
            schemas::AuthResponse,
            schemas::AuthTokens,
            schemas::MeResponse,
            schemas::MessageResponse,
            schemas::TokenRefreshResponse,
            // User schemas
            schemas::UserResponse,
            schemas::UserRole,
            schemas::UpdateProfileRequest,
            schemas::ChangePasswordRequest,
            schemas::UserProfileResponse,
            schemas::PaginatedUsersResponse,
            schemas::PaginationMeta,
            schemas::LoyaltyStatusResponseUser,
            schemas::TierInfoUser,
            // Loyalty schemas
            schemas::TierResponse,
            schemas::LoyaltyStatusResponse,
            schemas::TierInfo,
            schemas::NextTierInfo,
            schemas::PointsTransactionResponse,
            schemas::PaginatedTransactionsResponse,
            schemas::AwardPointsRequest,
            schemas::AwardPointsResult,
            schemas::RecalculateTierResult,
            // Coupon schemas
            schemas::CouponResponse,
            schemas::CouponType,
            schemas::CouponStatus,
            schemas::UserCouponResponse,
            schemas::UserCouponStatus,
            schemas::UserCouponWithDetails,
            schemas::CreateCouponRequest,
            schemas::UpdateCouponRequest,
            schemas::AssignCouponRequest,
            schemas::RedeemCouponRequest,
            schemas::RedemptionResult,
            schemas::CouponValidationResponse,
            schemas::CouponValidationData,
            schemas::CouponStats,
            schemas::PaginatedCouponsResponse,
            schemas::PaginatedUserCouponsResponse,
            // Survey schemas
            schemas::SurveyResponseDto,
            schemas::SurveyQuestion,
            schemas::SurveyQuestionType,
            schemas::SurveyQuestionOption,
            schemas::CreateSurveyRequest,
            schemas::UpdateSurveyRequest,
            schemas::SubmitSurveyResponseRequest,
            schemas::SurveyAnswerDto,
            schemas::PaginatedSurveysResponse,
            schemas::PaginatedSurveyAnswersResponse,
            // SSE schemas
            schemas::SseInfoResponse,
            // Generic schemas
            schemas::SuccessResponse,
        )
    ),
    modifiers(&SecurityAddon)
)]
pub struct ApiDoc;

/// Schema definitions for OpenAPI
pub mod schemas {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
    use rust_decimal::Decimal;
    use serde::{Deserialize, Serialize};
    use utoipa::ToSchema;
    use uuid::Uuid;

    // ============================================================================
    // Error Responses
    // ============================================================================

    /// Standard error response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct ErrorResponse {
        /// Machine-readable error code
        #[schema(example = "validation_error")]
        pub error: String,
        /// Human-readable error message
        #[schema(example = "Validation failed")]
        pub message: String,
        /// Optional field-level error details
        #[serde(skip_serializing_if = "Option::is_none")]
        pub details: Option<std::collections::HashMap<String, Vec<String>>>,
    }

    // ============================================================================
    // Health Schemas
    // ============================================================================

    /// Basic health check response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct HealthResponse {
        /// Health status
        #[schema(example = "ok")]
        pub status: String,
        /// Current timestamp in RFC3339 format
        #[schema(example = "2024-01-15T10:30:00Z")]
        pub timestamp: String,
        /// Application version
        #[schema(example = "0.1.0")]
        pub version: String,
    }

    /// Database health check response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct DbHealthResponse {
        /// Health status
        #[schema(example = "ok")]
        pub status: String,
        /// Database connection status
        #[schema(example = "connected")]
        pub database: String,
        /// Current timestamp
        pub timestamp: String,
    }

    /// Redis health check response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct RedisHealthResponse {
        /// Health status
        #[schema(example = "ok")]
        pub status: String,
        /// Redis connection status
        #[schema(example = "connected")]
        pub redis: String,
        /// Current timestamp
        pub timestamp: String,
    }

    /// Full system health check response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SystemHealthResponse {
        /// Overall health status
        #[schema(example = "ok")]
        pub status: String,
        /// Current timestamp
        pub timestamp: String,
        /// Application version
        #[schema(example = "0.1.0")]
        pub version: String,
        /// Database connection status
        #[schema(example = "connected")]
        pub database: String,
        /// Redis connection status
        #[schema(example = "connected")]
        pub redis: String,
    }

    // ============================================================================
    // Auth Schemas
    // ============================================================================

    /// User registration request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct RegisterRequest {
        /// User's email address
        #[schema(example = "user@example.com")]
        pub email: String,
        /// Password (minimum 8 characters)
        #[schema(example = "securePassword123")]
        pub password: String,
        /// User's first name
        #[serde(rename = "firstName")]
        #[schema(example = "John")]
        pub first_name: String,
        /// User's last name
        #[serde(rename = "lastName")]
        #[schema(example = "Doe")]
        pub last_name: String,
        /// Optional phone number
        #[schema(example = "+66812345678")]
        pub phone: Option<String>,
    }

    /// Login request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct LoginRequest {
        /// User's email address
        #[schema(example = "user@example.com")]
        pub email: String,
        /// User's password
        #[schema(example = "securePassword123")]
        pub password: String,
        /// Remember me for extended session
        #[serde(default, rename = "rememberMe")]
        pub remember_me: bool,
    }

    /// Logout request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct LogoutRequest {
        /// Optional refresh token to invalidate
        #[serde(rename = "refreshToken")]
        pub refresh_token: Option<String>,
    }

    /// Token refresh request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct RefreshTokenRequest {
        /// Refresh token
        #[serde(rename = "refreshToken")]
        pub refresh_token: String,
    }

    /// Forgot password request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct ForgotPasswordRequest {
        /// User's email address
        #[schema(example = "user@example.com")]
        pub email: String,
    }

    /// Reset password request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct ResetPasswordRequest {
        /// Password reset token
        pub token: String,
        /// New password (minimum 8 characters)
        #[schema(example = "newSecurePassword123")]
        pub password: String,
    }

    /// Authentication response with user and tokens
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct AuthResponse {
        /// User information
        pub user: UserResponse,
        /// Authentication tokens
        pub tokens: AuthTokens,
    }

    /// Authentication tokens
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct AuthTokens {
        /// JWT access token
        #[serde(rename = "accessToken")]
        pub access_token: String,
        /// Refresh token for obtaining new access tokens
        #[serde(rename = "refreshToken")]
        pub refresh_token: String,
    }

    /// Current user response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct MeResponse {
        /// User information
        pub user: UserResponse,
    }

    /// Generic message response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct MessageResponse {
        /// Response message
        #[schema(example = "Operation completed successfully")]
        pub message: String,
    }

    /// Token refresh response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct TokenRefreshResponse {
        /// New tokens
        pub tokens: AuthTokens,
    }

    // ============================================================================
    // User Schemas
    // ============================================================================

    /// User role enumeration
    #[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
    #[serde(rename_all = "snake_case")]
    pub enum UserRole {
        /// Regular customer
        Customer,
        /// Administrator
        Admin,
        /// Super administrator with full access
        SuperAdmin,
    }

    /// User response (safe, excludes password)
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UserResponse {
        /// User ID
        #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
        pub id: String,
        /// User's email address
        #[schema(example = "user@example.com")]
        pub email: Option<String>,
        /// User's role
        pub role: UserRole,
        /// Whether the account is active
        #[serde(rename = "isActive")]
        pub is_active: bool,
        /// Whether email is verified
        #[serde(rename = "emailVerified")]
        pub email_verified: bool,
        /// Account creation timestamp
        #[serde(rename = "createdAt")]
        pub created_at: DateTime<Utc>,
        /// Last update timestamp
        #[serde(rename = "updatedAt")]
        pub updated_at: DateTime<Utc>,
        /// User's first name
        #[serde(rename = "firstName", skip_serializing_if = "Option::is_none")]
        pub first_name: Option<String>,
        /// User's last name
        #[serde(rename = "lastName", skip_serializing_if = "Option::is_none")]
        pub last_name: Option<String>,
        /// Phone number
        #[serde(skip_serializing_if = "Option::is_none")]
        pub phone: Option<String>,
        /// Avatar URL
        #[serde(rename = "avatarUrl", skip_serializing_if = "Option::is_none")]
        pub avatar_url: Option<String>,
        /// Membership ID
        #[serde(rename = "membershipId", skip_serializing_if = "Option::is_none")]
        pub membership_id: Option<String>,
    }

    /// Update profile request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UpdateProfileRequest {
        /// First name
        #[schema(example = "John")]
        pub first_name: Option<String>,
        /// Last name
        #[schema(example = "Doe")]
        pub last_name: Option<String>,
        /// Phone number
        #[schema(example = "+66812345678")]
        pub phone: Option<String>,
        /// Date of birth
        pub date_of_birth: Option<NaiveDate>,
        /// User preferences as JSON
        pub preferences: Option<serde_json::Value>,
    }

    /// Change password request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct ChangePasswordRequest {
        /// Current password
        pub current_password: String,
        /// New password (minimum 8 characters)
        pub new_password: String,
    }

    /// User profile response with combined user and profile data
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UserProfileResponse {
        /// User ID
        pub id: Uuid,
        /// Email address
        pub email: Option<String>,
        /// User role
        pub role: String,
        /// Whether account is active
        pub is_active: bool,
        /// Whether email is verified
        pub email_verified: bool,
        /// First name
        pub first_name: Option<String>,
        /// Last name
        pub last_name: Option<String>,
        /// Phone number
        pub phone: Option<String>,
        /// Date of birth
        pub date_of_birth: Option<NaiveDate>,
        /// Avatar URL
        pub avatar_url: Option<String>,
        /// Membership ID
        pub membership_id: Option<String>,
        /// User preferences
        pub preferences: Option<serde_json::Value>,
        /// Account creation timestamp
        pub created_at: DateTime<Utc>,
        /// Last update timestamp
        pub updated_at: DateTime<Utc>,
    }

    /// Paginated users response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginatedUsersResponse {
        /// Success flag
        pub success: bool,
        /// List of users
        pub data: Vec<UserProfileResponse>,
        /// Pagination metadata
        pub pagination: PaginationMeta,
    }

    /// Pagination metadata
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginationMeta {
        /// Current page number
        #[schema(example = 1)]
        pub page: i64,
        /// Items per page
        #[schema(example = 10)]
        pub limit: i64,
        /// Total number of items
        #[schema(example = 100)]
        pub total: i64,
        /// Total number of pages
        #[schema(example = 10)]
        pub pages: i64,
    }

    /// Loyalty status response for user endpoint
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct LoyaltyStatusResponseUser {
        /// User ID
        pub user_id: Uuid,
        /// Current points balance
        #[schema(example = 1500)]
        pub current_points: i32,
        /// Total nights stayed
        #[schema(example = 12)]
        pub total_nights: i32,
        /// Current tier information
        pub tier: Option<TierInfoUser>,
        /// Tier last updated timestamp
        pub tier_updated_at: Option<DateTime<Utc>>,
        /// Points last updated timestamp
        pub points_updated_at: Option<DateTime<Utc>>,
    }

    /// Tier info for user loyalty status
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct TierInfoUser {
        /// Tier ID
        pub id: Uuid,
        /// Tier name
        #[schema(example = "Gold")]
        pub name: String,
        /// Display color (hex)
        #[schema(example = "#FFD700")]
        pub color: String,
        /// Minimum nights required
        #[schema(example = 10)]
        pub min_nights: i32,
        /// Tier benefits
        pub benefits: serde_json::Value,
    }

    // ============================================================================
    // Loyalty Schemas
    // ============================================================================

    /// Tier response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct TierResponse {
        /// Tier ID
        pub id: Uuid,
        /// Tier name
        #[schema(example = "Gold")]
        pub name: String,
        /// Minimum points required (legacy)
        #[schema(example = 0)]
        pub min_points: i32,
        /// Minimum nights required
        #[schema(example = 10)]
        pub min_nights: i32,
        /// Tier benefits as JSON
        pub benefits: serde_json::Value,
        /// Display color (hex)
        #[schema(example = "#FFD700")]
        pub color: String,
        /// Sort order for display
        #[schema(example = 2)]
        pub sort_order: i32,
        /// Whether tier is active
        pub is_active: bool,
    }

    /// Loyalty status response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct LoyaltyStatusResponse {
        /// User ID
        pub user_id: Uuid,
        /// Current points balance
        #[schema(example = 1500)]
        pub current_points: i32,
        /// Total nights stayed
        #[schema(example = 12)]
        pub total_nights: i32,
        /// Current tier information
        pub tier: Option<TierInfo>,
        /// Tier last updated timestamp
        pub tier_updated_at: Option<DateTime<Utc>>,
        /// Points last updated timestamp
        pub points_updated_at: Option<DateTime<Utc>>,
        /// Next tier progress information
        pub next_tier: Option<NextTierInfo>,
    }

    /// Tier information for loyalty status
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct TierInfo {
        /// Tier ID
        pub id: Uuid,
        /// Tier name
        #[schema(example = "Gold")]
        pub name: String,
        /// Display color (hex)
        #[schema(example = "#FFD700")]
        pub color: String,
        /// Tier benefits
        pub benefits: serde_json::Value,
        /// Minimum nights required
        #[schema(example = 10)]
        pub min_nights: i32,
    }

    /// Next tier progress information
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct NextTierInfo {
        /// Next tier name
        #[schema(example = "Platinum")]
        pub name: String,
        /// Minimum nights for next tier
        #[schema(example = 20)]
        pub min_nights: i32,
        /// Nights needed to reach next tier
        #[schema(example = 8)]
        pub nights_needed: i32,
        /// Progress percentage (0-100)
        #[schema(example = 60.0)]
        pub progress_percentage: f32,
    }

    /// Points transaction response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PointsTransactionResponse {
        /// Transaction ID
        pub id: Uuid,
        /// User ID
        pub user_id: Uuid,
        /// Points amount (positive for earned, negative for redeemed)
        #[schema(example = 500)]
        pub points: i32,
        /// Transaction type
        #[serde(rename = "type")]
        #[schema(example = "earned_stay")]
        pub transaction_type: String,
        /// Transaction description
        pub description: Option<String>,
        /// Reference ID (e.g., booking ID)
        pub reference_id: Option<String>,
        /// Admin user ID (if admin action)
        pub admin_user_id: Option<Uuid>,
        /// Admin reason (if admin action)
        pub admin_reason: Option<String>,
        /// Points expiration date
        pub expires_at: Option<DateTime<Utc>>,
        /// Transaction timestamp
        pub created_at: DateTime<Utc>,
        /// Nights stayed (if applicable)
        #[schema(example = 3)]
        pub nights_stayed: i32,
    }

    /// Paginated transactions response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginatedTransactionsResponse {
        /// List of transactions
        pub transactions: Vec<PointsTransactionResponse>,
        /// Total number of transactions
        #[schema(example = 50)]
        pub total: i64,
        /// Current page
        #[schema(example = 1)]
        pub page: i32,
        /// Items per page
        #[schema(example = 20)]
        pub limit: i32,
        /// Total pages
        #[schema(example = 3)]
        pub total_pages: i32,
    }

    /// Award points request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    #[serde(rename_all = "camelCase")]
    pub struct AwardPointsRequest {
        /// User ID to award points to
        pub user_id: Uuid,
        /// Number of points to award
        #[schema(example = 100)]
        pub points: i32,
        /// Number of nights to add
        #[schema(example = 0)]
        pub nights: i32,
        /// Source of points
        #[schema(example = "admin_award")]
        pub source: Option<String>,
        /// Description
        #[schema(example = "Bonus points for referral")]
        pub description: Option<String>,
    }

    /// Award points result
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct AwardPointsResult {
        /// Created transaction ID
        pub transaction_id: Uuid,
        /// Points awarded
        #[schema(example = 100)]
        pub points_awarded: i32,
        /// Nights added
        #[schema(example = 0)]
        pub nights_added: i32,
        /// New total points
        #[schema(example = 1600)]
        pub new_total_points: i32,
        /// New total nights
        #[schema(example = 12)]
        pub new_total_nights: i32,
        /// Whether tier changed
        pub tier_changed: bool,
        /// New tier name (if changed)
        pub new_tier_name: Option<String>,
    }

    /// Recalculate tier result
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct RecalculateTierResult {
        /// User ID
        pub user_id: Uuid,
        /// Previous tier name
        pub previous_tier: Option<String>,
        /// New tier name
        #[schema(example = "Gold")]
        pub new_tier: String,
        /// Whether tier changed
        pub tier_changed: bool,
        /// Current total nights
        #[schema(example = 12)]
        pub total_nights: i32,
    }

    // ============================================================================
    // Coupon Schemas
    // ============================================================================

    /// Coupon type enumeration
    #[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
    #[serde(rename_all = "snake_case")]
    pub enum CouponType {
        /// Percentage discount
        Percentage,
        /// Fixed amount discount
        FixedAmount,
        /// Buy one get one free
        Bogo,
        /// Free room upgrade
        FreeUpgrade,
        /// Free service
        FreeService,
    }

    /// Coupon status enumeration
    #[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
    #[serde(rename_all = "snake_case")]
    pub enum CouponStatus {
        /// Coupon is in draft mode
        Draft,
        /// Coupon is active and can be used
        Active,
        /// Coupon is temporarily paused
        Paused,
        /// Coupon has expired
        Expired,
        /// Coupon usage limit has been reached
        Exhausted,
    }

    /// User coupon status enumeration
    #[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
    #[serde(rename_all = "snake_case")]
    pub enum UserCouponStatus {
        /// Coupon is available for use
        Available,
        /// Coupon has been used
        Used,
        /// Coupon has expired
        Expired,
        /// Coupon has been revoked
        Revoked,
    }

    /// Coupon response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct CouponResponse {
        /// Coupon ID
        pub id: Uuid,
        /// Unique coupon code
        #[schema(example = "SUMMER2024")]
        pub code: String,
        /// Coupon name
        #[schema(example = "Summer Sale Discount")]
        pub name: String,
        /// Coupon description
        pub description: Option<String>,
        /// Terms and conditions
        pub terms_and_conditions: Option<String>,
        /// Coupon type
        pub coupon_type: CouponType,
        /// Discount value
        pub value: Option<Decimal>,
        /// Currency code
        #[schema(example = "THB")]
        pub currency: Option<String>,
        /// Minimum spend required
        pub minimum_spend: Option<Decimal>,
        /// Maximum discount amount
        pub maximum_discount: Option<Decimal>,
        /// Valid from date
        pub valid_from: Option<DateTime<Utc>>,
        /// Valid until date
        pub valid_until: Option<DateTime<Utc>>,
        /// Total usage limit
        pub usage_limit: Option<i32>,
        /// Usage limit per user
        pub usage_limit_per_user: Option<i32>,
        /// Number of times used
        pub used_count: Option<i32>,
        /// Coupon status
        pub status: Option<CouponStatus>,
        /// Creation timestamp
        pub created_at: Option<DateTime<Utc>>,
    }

    /// User coupon response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UserCouponResponse {
        /// User coupon ID
        pub id: Uuid,
        /// User ID
        pub user_id: Uuid,
        /// Coupon ID
        pub coupon_id: Uuid,
        /// User coupon status
        pub status: Option<UserCouponStatus>,
        /// QR code for redemption
        pub qr_code: String,
        /// When the coupon was used
        pub used_at: Option<DateTime<Utc>>,
        /// When the coupon expires
        pub expires_at: Option<DateTime<Utc>>,
        /// When the coupon was assigned
        pub created_at: Option<DateTime<Utc>>,
    }

    /// User coupon with coupon details
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UserCouponWithDetails {
        /// User coupon ID
        pub id: Uuid,
        /// User ID
        pub user_id: Uuid,
        /// Coupon ID
        pub coupon_id: Uuid,
        /// User coupon status
        pub status: Option<UserCouponStatus>,
        /// QR code for redemption
        pub qr_code: String,
        /// When the coupon was used
        pub used_at: Option<DateTime<Utc>>,
        /// When the coupon expires
        pub expires_at: Option<DateTime<Utc>>,
        /// When the coupon was assigned
        pub created_at: Option<DateTime<Utc>>,
        /// Coupon code
        pub code: String,
        /// Coupon name
        pub name: String,
        /// Coupon description
        pub description: Option<String>,
        /// Coupon type
        pub coupon_type: CouponType,
        /// Discount value
        pub value: Option<Decimal>,
        /// Currency
        pub currency: Option<String>,
        /// Minimum spend
        pub minimum_spend: Option<Decimal>,
        /// Maximum discount
        pub maximum_discount: Option<Decimal>,
        /// Coupon valid from
        pub coupon_valid_from: Option<DateTime<Utc>>,
        /// Coupon valid until
        pub coupon_valid_until: Option<DateTime<Utc>>,
    }

    /// Create coupon request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct CreateCouponRequest {
        /// Unique coupon code (uppercase letters, numbers, underscores, hyphens)
        #[schema(example = "SUMMER2024")]
        pub code: String,
        /// Coupon name
        #[schema(example = "Summer Sale Discount")]
        pub name: String,
        /// Coupon description
        pub description: Option<String>,
        /// Terms and conditions
        pub terms_and_conditions: Option<String>,
        /// Coupon type
        pub coupon_type: CouponType,
        /// Discount value
        pub value: Option<Decimal>,
        /// Currency code
        #[schema(example = "THB")]
        pub currency: Option<String>,
        /// Minimum spend required
        pub minimum_spend: Option<Decimal>,
        /// Maximum discount amount
        pub maximum_discount: Option<Decimal>,
        /// Valid from date
        pub valid_from: Option<DateTime<Utc>>,
        /// Valid until date
        pub valid_until: Option<DateTime<Utc>>,
        /// Total usage limit
        pub usage_limit: Option<i32>,
        /// Usage limit per user
        pub usage_limit_per_user: Option<i32>,
        /// Tier restrictions (JSON)
        pub tier_restrictions: Option<serde_json::Value>,
        /// Customer segment (JSON)
        pub customer_segment: Option<serde_json::Value>,
        /// Initial status
        pub status: Option<CouponStatus>,
    }

    /// Update coupon request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UpdateCouponRequest {
        /// Updated name
        pub name: Option<String>,
        /// Updated description
        pub description: Option<String>,
        /// Updated terms and conditions
        pub terms_and_conditions: Option<String>,
        /// Updated value
        pub value: Option<Decimal>,
        /// Updated currency
        pub currency: Option<String>,
        /// Updated minimum spend
        pub minimum_spend: Option<Decimal>,
        /// Updated maximum discount
        pub maximum_discount: Option<Decimal>,
        /// Updated valid from
        pub valid_from: Option<DateTime<Utc>>,
        /// Updated valid until
        pub valid_until: Option<DateTime<Utc>>,
        /// Updated usage limit
        pub usage_limit: Option<i32>,
        /// Updated usage limit per user
        pub usage_limit_per_user: Option<i32>,
        /// Updated tier restrictions
        pub tier_restrictions: Option<serde_json::Value>,
        /// Updated customer segment
        pub customer_segment: Option<serde_json::Value>,
        /// Updated status
        pub status: Option<CouponStatus>,
    }

    /// Assign coupon request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct AssignCouponRequest {
        /// Coupon ID to assign
        #[serde(rename = "couponId")]
        pub coupon_id: Uuid,
        /// List of user IDs to assign to (1-100)
        #[serde(rename = "userIds")]
        pub user_ids: Vec<Uuid>,
        /// Reason for assignment
        #[serde(rename = "assignedReason")]
        pub assigned_reason: Option<String>,
        /// Custom expiry date
        #[serde(rename = "customExpiry")]
        pub custom_expiry: Option<DateTime<Utc>>,
    }

    /// Redeem coupon request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct RedeemCouponRequest {
        /// QR code of the user coupon
        #[serde(rename = "qrCode")]
        pub qr_code: String,
        /// Original amount before discount
        #[serde(rename = "originalAmount")]
        pub original_amount: Decimal,
        /// Transaction reference
        #[serde(rename = "transactionReference")]
        pub transaction_reference: Option<String>,
        /// Location of redemption
        pub location: Option<String>,
        /// Additional metadata
        pub metadata: Option<serde_json::Value>,
    }

    /// Redemption result
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct RedemptionResult {
        /// Whether redemption was successful
        pub success: bool,
        /// Result message
        #[schema(example = "Coupon redeemed successfully")]
        pub message: String,
        /// Original amount
        #[serde(rename = "originalAmount")]
        pub original_amount: Decimal,
        /// Discount amount applied
        #[serde(rename = "discountAmount")]
        pub discount_amount: Decimal,
        /// Final amount after discount
        #[serde(rename = "finalAmount")]
        pub final_amount: Decimal,
    }

    /// Coupon validation response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct CouponValidationResponse {
        /// Whether the coupon is valid
        pub valid: bool,
        /// Coupon data (if valid)
        pub data: Option<CouponValidationData>,
        /// Validation message
        #[schema(example = "Coupon is valid")]
        pub message: String,
    }

    /// Coupon validation data
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct CouponValidationData {
        /// Coupon name
        pub name: String,
        /// Coupon description
        pub description: Option<String>,
        /// Coupon type
        #[serde(rename = "type")]
        pub coupon_type: CouponType,
        /// Discount value
        pub value: Option<Decimal>,
        /// Currency
        pub currency: Option<String>,
        /// Minimum spend required
        #[serde(rename = "minimumSpend")]
        pub minimum_spend: Option<Decimal>,
        /// Maximum discount
        #[serde(rename = "maximumDiscount")]
        pub maximum_discount: Option<Decimal>,
        /// Valid until date
        #[serde(rename = "validUntil")]
        pub valid_until: Option<DateTime<Utc>>,
    }

    /// Coupon statistics
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct CouponStats {
        /// Total number of coupons
        #[serde(rename = "totalCoupons")]
        #[schema(example = 50)]
        pub total_coupons: i64,
        /// Number of active coupons
        #[serde(rename = "activeCoupons")]
        #[schema(example = 25)]
        pub active_coupons: i64,
        /// Total coupons assigned to users
        #[serde(rename = "totalAssigned")]
        #[schema(example = 500)]
        pub total_assigned: i64,
        /// Total coupons redeemed
        #[serde(rename = "totalRedeemed")]
        #[schema(example = 150)]
        pub total_redeemed: i64,
        /// Redemption rate percentage
        #[serde(rename = "redemptionRate")]
        #[schema(example = 30.0)]
        pub redemption_rate: f64,
    }

    /// Paginated coupons response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginatedCouponsResponse {
        /// List of coupons
        pub items: Vec<CouponResponse>,
        /// Total count
        pub total: i64,
        /// Current page
        pub page: u32,
        /// Items per page
        pub limit: u32,
        /// Total pages
        #[serde(rename = "totalPages")]
        pub total_pages: u32,
    }

    /// Paginated user coupons response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginatedUserCouponsResponse {
        /// List of user coupons with details
        pub items: Vec<UserCouponWithDetails>,
        /// Total count
        pub total: i64,
        /// Current page
        pub page: u32,
        /// Items per page
        pub limit: u32,
        /// Total pages
        #[serde(rename = "totalPages")]
        pub total_pages: u32,
    }

    // ============================================================================
    // Survey Schemas
    // ============================================================================

    /// Survey question type
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
    #[serde(rename_all = "snake_case")]
    pub enum SurveyQuestionType {
        /// Single choice (radio buttons)
        SingleChoice,
        /// Multiple choice (checkboxes)
        MultipleChoice,
        /// Short text input
        Text,
        /// Long text input (textarea)
        TextArea,
        /// Star rating
        Rating,
        /// Numeric scale
        Scale,
        /// Date picker
        Date,
        /// Number input
        Number,
        /// Email input
        Email,
        /// Phone input
        Phone,
    }

    /// Survey question option
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SurveyQuestionOption {
        /// Option ID
        pub id: String,
        /// Option text
        pub text: String,
        /// Option value
        pub value: Option<String>,
        /// Display order
        pub order: Option<i32>,
    }

    /// Survey question
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SurveyQuestion {
        /// Question ID
        pub id: String,
        /// Question type
        pub question_type: SurveyQuestionType,
        /// Question text
        pub text: String,
        /// Question description/help text
        pub description: Option<String>,
        /// Whether the question is required
        pub required: bool,
        /// Options for choice questions
        pub options: Option<Vec<SurveyQuestionOption>>,
        /// Validation rules
        pub validation: Option<serde_json::Value>,
        /// Display order
        pub order: i32,
    }

    /// Survey response DTO
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SurveyResponseDto {
        /// Survey ID
        pub id: Uuid,
        /// Survey title
        #[schema(example = "Customer Satisfaction Survey")]
        pub title: String,
        /// Survey description
        pub description: Option<String>,
        /// Survey questions
        pub questions: Vec<SurveyQuestion>,
        /// Survey status
        #[schema(example = "active")]
        pub status: Option<String>,
        /// Scheduled start date
        pub scheduled_start: Option<NaiveDateTime>,
        /// Scheduled end date
        pub scheduled_end: Option<NaiveDateTime>,
        /// Access type (public, invited)
        #[schema(example = "public")]
        pub access_type: String,
        /// Creation timestamp
        pub created_at: Option<NaiveDateTime>,
    }

    /// Create survey request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct CreateSurveyRequest {
        /// Survey title
        #[schema(example = "Customer Satisfaction Survey")]
        pub title: String,
        /// Survey description
        pub description: Option<String>,
        /// Survey questions
        pub questions: Vec<SurveyQuestion>,
        /// Target segment (JSON)
        pub target_segment: Option<serde_json::Value>,
        /// Initial status
        #[schema(example = "draft")]
        pub status: Option<String>,
        /// Scheduled start date
        pub scheduled_start: Option<NaiveDateTime>,
        /// Scheduled end date
        pub scheduled_end: Option<NaiveDateTime>,
        /// Access type
        #[schema(example = "public")]
        pub access_type: Option<String>,
    }

    /// Update survey request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct UpdateSurveyRequest {
        /// Updated title
        pub title: Option<String>,
        /// Updated description
        pub description: Option<String>,
        /// Updated questions
        pub questions: Option<Vec<SurveyQuestion>>,
        /// Updated target segment
        pub target_segment: Option<serde_json::Value>,
        /// Updated status
        pub status: Option<String>,
        /// Updated scheduled start
        pub scheduled_start: Option<NaiveDateTime>,
        /// Updated scheduled end
        pub scheduled_end: Option<NaiveDateTime>,
        /// Updated access type
        pub access_type: Option<String>,
    }

    /// Submit survey response request
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SubmitSurveyResponseRequest {
        /// Survey ID
        pub survey_id: Uuid,
        /// Answers as JSON (question_id -> answer)
        pub answers: serde_json::Value,
        /// Whether this is the final submission
        pub is_completed: bool,
    }

    /// Survey answer DTO
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SurveyAnswerDto {
        /// Response ID
        pub id: Uuid,
        /// Survey ID
        pub survey_id: Option<Uuid>,
        /// User ID
        pub user_id: Option<Uuid>,
        /// Answers as JSON
        pub answers: serde_json::Value,
        /// Whether response is completed
        pub is_completed: Option<bool>,
        /// Progress percentage (0-100)
        pub progress: Option<i32>,
        /// When the response was started
        pub started_at: Option<NaiveDateTime>,
        /// When the response was completed
        pub completed_at: Option<NaiveDateTime>,
    }

    /// Paginated surveys response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginatedSurveysResponse {
        /// List of surveys
        pub data: Vec<SurveyResponseDto>,
        /// Total count
        pub total: i64,
        /// Current page
        pub page: i32,
        /// Items per page
        pub limit: i32,
        /// Total pages
        pub total_pages: i32,
    }

    /// Paginated survey answers response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct PaginatedSurveyAnswersResponse {
        /// List of survey answers
        pub data: Vec<SurveyAnswerDto>,
        /// Total count
        pub total: i64,
        /// Current page
        pub page: i32,
        /// Items per page
        pub limit: i32,
        /// Total pages
        pub total_pages: i32,
    }

    // ============================================================================
    // SSE Schemas
    // ============================================================================

    /// SSE connection info response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SseInfoResponse {
        /// User ID
        #[serde(rename = "userId")]
        pub user_id: String,
        /// Number of connected clients for this user
        #[serde(rename = "connectedClients")]
        #[schema(example = 1)]
        pub connected_clients: usize,
        /// List of supported event types
        #[serde(rename = "supportedEvents")]
        pub supported_events: Vec<String>,
    }

    // ============================================================================
    // Generic Schemas
    // ============================================================================

    /// Generic success response
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct SuccessResponse {
        /// Success flag
        pub success: bool,
        /// Optional message
        #[serde(skip_serializing_if = "Option::is_none")]
        pub message: Option<String>,
        /// Optional data
        #[serde(skip_serializing_if = "Option::is_none")]
        pub data: Option<serde_json::Value>,
    }

    /// Generic API response wrapper
    #[derive(Debug, Serialize, Deserialize, ToSchema)]
    pub struct ApiResponse<T> {
        /// Success flag
        pub success: bool,
        /// Response data
        pub data: T,
        /// Optional message
        #[serde(skip_serializing_if = "Option::is_none")]
        pub message: Option<String>,
    }
}

/// Path operation definitions for OpenAPI
pub mod paths {
    #[allow(unused_imports)]
    use super::schemas::*;

    // ============================================================================
    // Health Endpoints
    // ============================================================================

    /// Basic health check
    #[utoipa::path(
        get,
        path = "/health",
        tag = "health",
        responses(
            (status = 200, description = "Service is healthy", body = HealthResponse)
        )
    )]
    pub async fn health_check() {}

    /// Database health check
    #[utoipa::path(
        get,
        path = "/health/db",
        tag = "health",
        responses(
            (status = 200, description = "Database is connected", body = DbHealthResponse),
            (status = 503, description = "Database is disconnected", body = DbHealthResponse)
        )
    )]
    pub async fn health_check_db() {}

    /// Redis health check
    #[utoipa::path(
        get,
        path = "/health/redis",
        tag = "health",
        responses(
            (status = 200, description = "Redis is connected", body = RedisHealthResponse),
            (status = 503, description = "Redis is disconnected", body = RedisHealthResponse)
        )
    )]
    pub async fn health_check_redis() {}

    /// Full system health check
    #[utoipa::path(
        get,
        path = "/health/full",
        tag = "health",
        responses(
            (status = 200, description = "All services are healthy", body = SystemHealthResponse),
            (status = 503, description = "One or more services are unhealthy", body = SystemHealthResponse)
        )
    )]
    pub async fn health_check_full() {}

    // ============================================================================
    // Auth Endpoints
    // ============================================================================

    /// Register a new user
    #[utoipa::path(
        post,
        path = "/auth/register",
        tag = "auth",
        request_body = RegisterRequest,
        responses(
            (status = 201, description = "User registered successfully", body = AuthResponse),
            (status = 400, description = "Invalid request or email already registered", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn auth_register() {}

    /// Login with email and password
    #[utoipa::path(
        post,
        path = "/auth/login",
        tag = "auth",
        request_body = LoginRequest,
        responses(
            (status = 200, description = "Login successful", body = AuthResponse),
            (status = 401, description = "Invalid credentials", body = ErrorResponse),
            (status = 403, description = "Account disabled", body = ErrorResponse)
        )
    )]
    pub async fn auth_login() {}

    /// Logout and invalidate refresh token
    #[utoipa::path(
        post,
        path = "/auth/logout",
        tag = "auth",
        request_body = LogoutRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Logged out successfully", body = MessageResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn auth_logout() {}

    /// Refresh access token
    #[utoipa::path(
        post,
        path = "/auth/refresh",
        tag = "auth",
        request_body = RefreshTokenRequest,
        responses(
            (status = 200, description = "Token refreshed successfully", body = TokenRefreshResponse),
            (status = 401, description = "Invalid or expired refresh token", body = ErrorResponse)
        )
    )]
    pub async fn auth_refresh() {}

    /// Request password reset
    #[utoipa::path(
        post,
        path = "/auth/forgot-password",
        tag = "auth",
        request_body = ForgotPasswordRequest,
        responses(
            (status = 200, description = "Reset email sent if account exists", body = MessageResponse)
        )
    )]
    pub async fn auth_forgot_password() {}

    /// Reset password with token
    #[utoipa::path(
        post,
        path = "/auth/reset-password",
        tag = "auth",
        request_body = ResetPasswordRequest,
        responses(
            (status = 200, description = "Password reset successfully", body = MessageResponse),
            (status = 400, description = "Invalid or expired token", body = ErrorResponse)
        )
    )]
    pub async fn auth_reset_password() {}

    /// Get current authenticated user
    #[utoipa::path(
        get,
        path = "/auth/me",
        tag = "auth",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Current user information", body = MeResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn auth_me() {}

    // ============================================================================
    // User Endpoints
    // ============================================================================

    /// Get current user's profile
    #[utoipa::path(
        get,
        path = "/users/me",
        tag = "users",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "User profile", body = SuccessResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn get_current_user() {}

    /// Update current user's profile
    #[utoipa::path(
        put,
        path = "/users/me",
        tag = "users",
        request_body = UpdateProfileRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Profile updated", body = SuccessResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn update_current_user() {}

    /// Change current user's password
    #[utoipa::path(
        put,
        path = "/users/me/password",
        tag = "users",
        request_body = ChangePasswordRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Password changed", body = SuccessResponse),
            (status = 400, description = "Current password incorrect", body = ErrorResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn change_password() {}

    /// Get current user's loyalty status
    #[utoipa::path(
        get,
        path = "/users/me/loyalty",
        tag = "users",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Loyalty status", body = LoyaltyStatusResponseUser),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn get_loyalty_status_user() {}

    /// List all users (admin only)
    #[utoipa::path(
        get,
        path = "/users",
        tag = "users",
        params(
            ("page" = Option<i64>, Query, description = "Page number (default: 1)"),
            ("limit" = Option<i64>, Query, description = "Items per page (default: 10, max: 100)"),
            ("search" = Option<String>, Query, description = "Search term for email, name, or membership ID")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "List of users", body = PaginatedUsersResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse)
        )
    )]
    pub async fn list_users() {}

    /// Get user by ID (admin only)
    #[utoipa::path(
        get,
        path = "/users/{id}",
        tag = "users",
        params(
            ("id" = uuid::Uuid, Path, description = "User ID")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "User profile", body = UserProfileResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "User not found", body = ErrorResponse)
        )
    )]
    pub async fn get_user_by_id() {}

    /// Delete current user's account
    #[utoipa::path(
        delete,
        path = "/users/account",
        tag = "users",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Account deleted", body = SuccessResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn delete_account() {}

    // ============================================================================
    // Loyalty Endpoints
    // ============================================================================

    /// Get all loyalty tiers
    #[utoipa::path(
        get,
        path = "/loyalty/tiers",
        tag = "loyalty",
        responses(
            (status = 200, description = "List of loyalty tiers", body = [TierResponse])
        )
    )]
    pub async fn get_tiers() {}

    /// Get current user's loyalty status
    #[utoipa::path(
        get,
        path = "/loyalty/status",
        tag = "loyalty",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Loyalty status", body = LoyaltyStatusResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 404, description = "Loyalty status not found", body = ErrorResponse)
        )
    )]
    pub async fn get_loyalty_status() {}

    /// Get current user's points transactions
    #[utoipa::path(
        get,
        path = "/loyalty/transactions",
        tag = "loyalty",
        params(
            ("page" = Option<i32>, Query, description = "Page number (default: 1)"),
            ("limit" = Option<i32>, Query, description = "Items per page (default: 20, max: 100)")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Transaction history", body = PaginatedTransactionsResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn get_transactions() {}

    /// Award points to a user (admin only)
    #[utoipa::path(
        post,
        path = "/loyalty/award",
        tag = "loyalty",
        request_body = AwardPointsRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Points awarded", body = AwardPointsResult),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "User loyalty record not found", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn award_points() {}

    /// Recalculate user's tier (admin only)
    #[utoipa::path(
        post,
        path = "/loyalty/recalculate/{userId}",
        tag = "loyalty",
        params(
            ("userId" = uuid::Uuid, Path, description = "User ID to recalculate tier for")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Tier recalculated", body = RecalculateTierResult),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "User loyalty record not found", body = ErrorResponse)
        )
    )]
    pub async fn recalculate_tier() {}

    // ============================================================================
    // Coupon Endpoints
    // ============================================================================

    /// List coupons
    #[utoipa::path(
        get,
        path = "/coupons",
        tag = "coupons",
        params(
            ("page" = Option<u32>, Query, description = "Page number (default: 1)"),
            ("limit" = Option<u32>, Query, description = "Items per page (default: 20, max: 50)"),
            ("status" = Option<String>, Query, description = "Filter by status (admin only)"),
            ("type" = Option<String>, Query, description = "Filter by coupon type"),
            ("search" = Option<String>, Query, description = "Search in code or name")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "List of coupons", body = PaginatedCouponsResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn list_coupons() {}

    /// Get coupon by ID
    #[utoipa::path(
        get,
        path = "/coupons/{id}",
        tag = "coupons",
        params(
            ("id" = uuid::Uuid, Path, description = "Coupon ID")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Coupon details", body = CouponResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 404, description = "Coupon not found", body = ErrorResponse)
        )
    )]
    pub async fn get_coupon() {}

    /// Create a new coupon (admin only)
    #[utoipa::path(
        post,
        path = "/coupons",
        tag = "coupons",
        request_body = CreateCouponRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 201, description = "Coupon created", body = CouponResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 409, description = "Coupon code already exists", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn create_coupon() {}

    /// Update a coupon (admin only)
    #[utoipa::path(
        put,
        path = "/coupons/{id}",
        tag = "coupons",
        params(
            ("id" = uuid::Uuid, Path, description = "Coupon ID")
        ),
        request_body = UpdateCouponRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Coupon updated", body = CouponResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "Coupon not found", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn update_coupon() {}

    /// Delete a coupon (admin only)
    #[utoipa::path(
        delete,
        path = "/coupons/{id}",
        tag = "coupons",
        params(
            ("id" = uuid::Uuid, Path, description = "Coupon ID")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Coupon deleted", body = SuccessResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "Coupon not found", body = ErrorResponse)
        )
    )]
    pub async fn delete_coupon() {}

    /// Get current user's coupons
    #[utoipa::path(
        get,
        path = "/coupons/my-coupons",
        tag = "coupons",
        params(
            ("page" = Option<u32>, Query, description = "Page number (default: 1)"),
            ("limit" = Option<u32>, Query, description = "Items per page (default: 20, max: 50)"),
            ("status" = Option<String>, Query, description = "Filter by status"),
            ("userId" = Option<String>, Query, description = "User ID to view (admin only)")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "User's coupons", body = PaginatedUserCouponsResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn get_user_coupons() {}

    /// Assign coupon to users (admin only)
    #[utoipa::path(
        post,
        path = "/coupons/assign",
        tag = "coupons",
        request_body = AssignCouponRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Coupon assigned", body = [UserCouponResponse]),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "Coupon not found", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn assign_coupon() {}

    /// Redeem a coupon
    #[utoipa::path(
        post,
        path = "/coupons/redeem",
        tag = "coupons",
        request_body = RedeemCouponRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Coupon redeemed", body = RedemptionResult),
            (status = 400, description = "Coupon not available or minimum spend not met", body = ErrorResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 404, description = "Invalid QR code", body = ErrorResponse)
        )
    )]
    pub async fn redeem_coupon() {}

    /// Validate coupon by QR code
    #[utoipa::path(
        get,
        path = "/coupons/validate/{qrCode}",
        tag = "coupons",
        params(
            ("qrCode" = String, Path, description = "QR code to validate")
        ),
        responses(
            (status = 200, description = "Validation result", body = CouponValidationResponse)
        )
    )]
    pub async fn validate_coupon() {}

    /// Get coupon statistics (admin only)
    #[utoipa::path(
        get,
        path = "/coupons/analytics/stats",
        tag = "coupons",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Coupon statistics", body = CouponStats),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse)
        )
    )]
    pub async fn get_coupon_stats() {}

    // ============================================================================
    // Survey Endpoints
    // ============================================================================

    /// List surveys
    #[utoipa::path(
        get,
        path = "/surveys",
        tag = "surveys",
        params(
            ("page" = Option<i32>, Query, description = "Page number (default: 1)"),
            ("limit" = Option<i32>, Query, description = "Items per page (default: 10, max: 100)"),
            ("active" = Option<bool>, Query, description = "Filter by active status (admin only)")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "List of surveys", body = PaginatedSurveysResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn list_surveys() {}

    /// Get survey by ID
    #[utoipa::path(
        get,
        path = "/surveys/{id}",
        tag = "surveys",
        params(
            ("id" = uuid::Uuid, Path, description = "Survey ID")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Survey details", body = SurveyResponseDto),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 404, description = "Survey not found", body = ErrorResponse)
        )
    )]
    pub async fn get_survey() {}

    /// Create a new survey (admin only)
    #[utoipa::path(
        post,
        path = "/surveys",
        tag = "surveys",
        request_body = CreateSurveyRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 201, description = "Survey created", body = SurveyResponseDto),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 422, description = "Validation error", body = ErrorResponse)
        )
    )]
    pub async fn create_survey() {}

    /// Update a survey (admin only)
    #[utoipa::path(
        put,
        path = "/surveys/{id}",
        tag = "surveys",
        params(
            ("id" = uuid::Uuid, Path, description = "Survey ID")
        ),
        request_body = UpdateSurveyRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Survey updated", body = SurveyResponseDto),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "Survey not found", body = ErrorResponse)
        )
    )]
    pub async fn update_survey() {}

    /// Submit a survey response
    #[utoipa::path(
        post,
        path = "/surveys/{id}/responses",
        tag = "surveys",
        params(
            ("id" = uuid::Uuid, Path, description = "Survey ID")
        ),
        request_body = SubmitSurveyResponseRequest,
        security(("bearer_auth" = [])),
        responses(
            (status = 201, description = "Response submitted", body = SurveyAnswerDto),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Not authorized to respond", body = ErrorResponse),
            (status = 404, description = "Survey not found", body = ErrorResponse)
        )
    )]
    pub async fn submit_survey_response() {}

    /// Get survey responses (admin only)
    #[utoipa::path(
        get,
        path = "/surveys/{surveyId}/responses",
        tag = "surveys",
        params(
            ("surveyId" = uuid::Uuid, Path, description = "Survey ID"),
            ("page" = Option<i32>, Query, description = "Page number"),
            ("limit" = Option<i32>, Query, description = "Items per page")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "Survey responses", body = PaginatedSurveyAnswersResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse),
            (status = 403, description = "Admin access required", body = ErrorResponse),
            (status = 404, description = "Survey not found", body = ErrorResponse)
        )
    )]
    pub async fn get_survey_responses() {}

    // ============================================================================
    // SSE Endpoints
    // ============================================================================

    /// Establish SSE connection for real-time events
    #[utoipa::path(
        get,
        path = "/sse/events",
        tag = "sse",
        params(
            ("token" = Option<String>, Query, description = "JWT token (alternative to Authorization header for EventSource)")
        ),
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "SSE stream established"),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn sse_events() {}

    /// Get SSE connection info
    #[utoipa::path(
        get,
        path = "/sse/info",
        tag = "sse",
        security(("bearer_auth" = [])),
        responses(
            (status = 200, description = "SSE connection info", body = SseInfoResponse),
            (status = 401, description = "Not authenticated", body = ErrorResponse)
        )
    )]
    pub async fn sse_info() {}
}

// ============================================================================
// Swagger UI Routes
// ============================================================================

/// Create Swagger UI routes for API documentation
///
/// This function creates routes for:
/// - `GET /api/docs` - Interactive Swagger UI
/// - `GET /api/openapi.json` - Raw OpenAPI specification in JSON format
///
/// # Returns
///
/// A Router with Swagger UI and OpenAPI spec endpoints configured
///
/// # Example
///
/// ```ignore
/// use loyalty_backend::openapi::swagger_routes;
///
/// let app = Router::new()
///     .merge(swagger_routes())
///     .merge(api_routes);
/// ```
pub fn swagger_routes() -> Router {
    Router::new().merge(
        SwaggerUi::new("/api/docs")
            .url("/api/openapi.json", ApiDoc::openapi()),
    )
}

/// Get the OpenAPI specification as a JSON string
///
/// Useful for generating static documentation, serving from custom endpoints,
/// or generating client SDKs.
///
/// # Returns
///
/// JSON string containing the complete OpenAPI specification
///
/// # Example
///
/// ```ignore
/// use loyalty_backend::openapi::get_openapi_spec;
///
/// let spec = get_openapi_spec();
/// std::fs::write("openapi.json", spec).unwrap();
/// ```
pub fn get_openapi_spec() -> String {
    ApiDoc::openapi()
        .to_pretty_json()
        .expect("Failed to serialize OpenAPI spec")
}

/// Get the OpenAPI specification as a YAML string
///
/// Alternative format for the OpenAPI specification.
///
/// # Returns
///
/// YAML string containing the complete OpenAPI specification
pub fn get_openapi_spec_yaml() -> String {
    ApiDoc::openapi()
        .to_yaml()
        .expect("Failed to serialize OpenAPI spec to YAML")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openapi_spec_generation() {
        let spec = ApiDoc::openapi();

        // Verify basic info
        assert_eq!(spec.info.title, "Loyalty App API");
        assert_eq!(spec.info.version, "1.0.0");

        // Verify tags exist
        let tags = spec.tags.as_ref().expect("Tags should be present");
        let tag_names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
        assert!(tag_names.contains(&"health"));
        assert!(tag_names.contains(&"auth"));
        assert!(tag_names.contains(&"users"));
        assert!(tag_names.contains(&"loyalty"));

        // Verify security scheme
        let components = spec.components.as_ref().expect("Components should be present");
        let security_schemes = &components.security_schemes;
        assert!(security_schemes.contains_key("bearer_auth"));

        // Verify paths exist
        let paths = &spec.paths;
        assert!(paths.paths.contains_key("/health"));
        assert!(paths.paths.contains_key("/auth/login"));
        assert!(paths.paths.contains_key("/auth/register"));
    }

    #[test]
    fn test_openapi_json_serialization() {
        let json = get_openapi_spec();

        // Should be valid JSON
        let parsed: serde_json::Value =
            serde_json::from_str(&json).expect("Should be valid JSON");

        // Verify structure
        assert!(parsed["openapi"].as_str().is_some());
        assert!(parsed["info"]["title"].as_str().is_some());
        assert!(parsed["paths"].is_object());
        assert!(parsed["components"]["schemas"].is_object());
    }

    #[test]
    fn test_openapi_yaml_serialization() {
        let yaml = get_openapi_spec_yaml();

        // Should not be empty
        assert!(!yaml.is_empty());

        // Should contain expected content
        assert!(yaml.contains("openapi:"));
        assert!(yaml.contains("Loyalty App API"));
    }

    #[test]
    fn test_swagger_routes_creation() {
        // Verify swagger routes can be created without panicking
        let _routes = swagger_routes();
    }
}
