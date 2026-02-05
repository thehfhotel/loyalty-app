//! Business logic services module
//!
//! Contains the core business logic for the loyalty application.
//! Services are defined as traits to allow for easy testing and mocking.

pub mod auth;
pub mod booking;
pub mod coupon;
pub mod email;
pub mod loyalty;
pub mod membership_id;
pub mod notification;
pub mod oauth;
pub mod slipok;
pub mod sse;
pub mod storage;
pub mod survey;
pub mod user;

// Re-export service traits and implementations
pub use auth::{AuthService, AuthServiceImpl, Claims, RefreshClaims};
pub use booking::{
    BookingFilters, BookingResponse, BookingService, BookingServiceImpl, BookingStatus,
    CreateBookingDto, UpdateBookingDto,
};
pub use coupon::{
    CouponFilters, CouponListResponse, CouponService, CouponServiceImpl, CreateCouponDto,
    UpdateCouponDto, UserCouponListResponse, UserCouponWithDetailsResponse,
};
pub use email::{EmailConfig, EmailService, EmailServiceImpl, NoOpEmailService};
pub use loyalty::{
    AwardPointsParams, AwardPointsParamsUuid, LoyaltyService, LoyaltyServiceImpl,
    PointsTransaction, PointsTransactionType, Tier, TierRecalculationResult, TransactionPagination,
    UserLoyalty, UserLoyaltyWithTier,
};
pub use membership_id::{generate_membership_id, validate_membership_id};
pub use notification::{
    CreateNotificationDto, NotificationFilters, NotificationListResponse, NotificationService,
    NotificationServiceImpl,
};
pub use oauth::{
    GoogleTokens, GoogleUserInfo, LineTokens, LineUserInfo, OAuthAuthResult, OAuthService,
    OAuthServiceImpl, OAuthUser, OAuthUserInfo,
};
pub use slipok::{
    SlipOKConfig, SlipOKHealthStatus, SlipOKService, SlipOkService, SlipVerificationResult,
    VerificationStatus,
};
pub use sse::{get_sse_service, SseConnectionManager, SseEvent, SseEventType};
pub use storage::{AllowedMimeTypes, StorageConfig, StorageReport, StorageService, StorageStats};
pub use survey::{SurveyService, SurveyServiceImpl};
pub use user::{
    CreateUserDto, PaginatedResult, Pagination, UpdateProfileDto, UpdateUserDto, UserService,
    UserServiceImpl, UserWithProfile,
};

use crate::db::Database;
use crate::redis::RedisClient;
use std::sync::Arc;

/// Application state shared across all routes and services
#[derive(Clone)]
pub struct AppState {
    /// Database connection pool
    pub db: Arc<Database>,
    /// Redis client for caching and sessions
    pub redis: Arc<RedisClient>,
    /// JWT secret for token signing
    pub jwt_secret: String,
    /// JWT expiration time in seconds
    pub jwt_expiration: i64,
    /// Refresh token expiration time in seconds
    pub refresh_token_expiration: i64,
}

impl AppState {
    /// Create a new AppState instance
    pub fn new(
        db: Database,
        redis: RedisClient,
        jwt_secret: String,
        jwt_expiration: i64,
        refresh_token_expiration: i64,
    ) -> Self {
        Self {
            db: Arc::new(db),
            redis: Arc::new(redis),
            jwt_secret,
            jwt_expiration,
            refresh_token_expiration,
        }
    }
}
