//! Data models module
//!
//! Contains struct definitions for database entities and API types.
//! Models are organized by domain and include both database entities
//! (with sqlx::FromRow) and DTOs for request/response handling.

pub mod booking;
pub mod coupon;
pub mod notification;
pub mod password_reset;
pub mod points_transaction;
pub mod survey;
pub mod tier;
pub mod user;
pub mod user_loyalty;
pub mod user_profile;

// Re-export commonly used types for convenience

// User models
pub use user::{CreateUserRequest, UpdateUserRequest, User, UserResponse, UserRole, UserSummary, UserWithProfile};

// User profile models
pub use user_profile::{
    CreateUserProfileRequest, UpdateUserProfileRequest, UserProfile, UserProfileResponse,
    UserProfileSummary,
};

// User loyalty models
pub use user_loyalty::{
    AdjustNightsRequest, AdjustPointsRequest, LoyaltySummary, UserLoyalty, UserLoyaltyResponse,
    UserLoyaltyWithTier, UserLoyaltyWithTierRow,
};

// Tier models
pub use tier::{
    CreateTierRequest, Tier, TierProgression, TierResponse, TierSummary, TierWithStats,
    UpdateTierRequest,
};

// Points transaction models
pub use points_transaction::{
    AwardStayPointsRequest, CreatePointsTransactionRequest, PaginatedTransactions,
    PointsTransaction, PointsTransactionResponse, PointsTransactionSummary, PointsTransactionType,
    RedeemPointsRequest, TransactionFilter,
};

// Coupon models
pub use coupon::{
    Coupon, CouponResponse, CouponStatus, CouponType, CreateCouponRequest, UpdateCouponRequest,
    UserCoupon, UserCouponResponse, UserCouponStatus,
};

// Survey models
pub use survey::{
    CreateSurveyRequest, SubmitSurveyResponseRequest, Survey, SurveyAnswerDto, SurveyInvitation,
    SurveyQuestion, SurveyQuestionOption, SurveyQuestionType, SurveyQuestionValidation,
    SurveyResponse, SurveyResponseDto, UpdateSurveyRequest,
};

// Booking models
pub use booking::{
    Booking, BookingResponse, BookingStatus, BookingSummary, CreateBookingRequest, RoomType,
    UpdateBookingRequest,
};

// Notification models
pub use notification::{
    CreateNotificationRequest, Notification, NotificationCountResponse, NotificationPreference,
    NotificationPreferenceResponse, NotificationResponse, NotificationType,
    PaginatedNotificationsResponse, UpdateNotificationPreferenceRequest, UpdateNotificationRequest,
};

// Password reset models
pub use password_reset::{
    EmailVerificationResponse, EmailVerificationToken, PasswordResetResponse, PasswordResetToken,
    RequestEmailVerificationRequest, RequestPasswordResetRequest, ResetPasswordRequest,
    VerifyEmailRequest,
};
