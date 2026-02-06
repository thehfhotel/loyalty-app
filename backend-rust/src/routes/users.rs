//! User routes
//!
//! Provides endpoints for user profile management, settings, avatar,
//! and admin user management operations.

use axum::{
    extract::{Extension, Multipart, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, put},
    Json, Router,
};
use bytes::Bytes;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::services::storage::{AllowedMimeTypes, StorageService};
use crate::state::AppState as FullAppState;

// ============================================================================
// Request/Response Types
// ============================================================================

/// User profile response with combined user and profile data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileResponse {
    pub id: Uuid,
    pub email: Option<String>,
    pub role: String,
    pub is_active: bool,
    pub email_verified: bool,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub avatar_url: Option<String>,
    pub membership_id: Option<String>,
    pub preferences: Option<JsonValue>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Database row for user with profile join
#[derive(Debug, Clone, FromRow)]
struct UserWithProfileRow {
    // User fields
    id: Uuid,
    email: Option<String>,
    role: Option<String>,
    is_active: Option<bool>,
    email_verified: Option<bool>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    // Profile fields (nullable due to LEFT JOIN)
    first_name: Option<String>,
    last_name: Option<String>,
    phone: Option<String>,
    date_of_birth: Option<NaiveDate>,
    avatar_url: Option<String>,
    membership_id: Option<String>,
    preferences: Option<JsonValue>,
}

impl From<UserWithProfileRow> for UserProfileResponse {
    fn from(row: UserWithProfileRow) -> Self {
        UserProfileResponse {
            id: row.id,
            email: row.email,
            role: row.role.unwrap_or_else(|| "customer".to_string()),
            is_active: row.is_active.unwrap_or(true),
            email_verified: row.email_verified.unwrap_or(false),
            first_name: row.first_name,
            last_name: row.last_name,
            phone: row.phone,
            date_of_birth: row.date_of_birth,
            avatar_url: row.avatar_url,
            membership_id: row.membership_id,
            preferences: row.preferences,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
        }
    }
}

/// Request payload for updating user profile
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateProfileRequest {
    #[validate(length(min = 1, max = 100, message = "First name must be 1-100 characters"))]
    pub first_name: Option<String>,

    #[validate(length(min = 1, max = 100, message = "Last name must be 1-100 characters"))]
    pub last_name: Option<String>,

    #[validate(length(max = 20, message = "Phone number too long"))]
    pub phone: Option<String>,

    pub date_of_birth: Option<NaiveDate>,

    pub preferences: Option<JsonValue>,
}

/// Request payload for changing password
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct ChangePasswordRequest {
    #[validate(length(min = 1, message = "Current password is required"))]
    pub current_password: String,

    #[validate(length(min = 8, message = "New password must be at least 8 characters"))]
    pub new_password: String,
}

/// Query parameters for listing users (admin)
#[derive(Debug, Clone, Deserialize)]
pub struct ListUsersQuery {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_limit")]
    pub limit: i64,
    pub search: Option<String>,
}

fn default_page() -> i64 {
    1
}

fn default_limit() -> i64 {
    10
}

/// Pagination metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginationMeta {
    pub page: i64,
    pub limit: i64,
    pub total: i64,
    pub pages: i64,
}

/// Paginated users response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedUsersResponse {
    pub success: bool,
    pub data: Vec<UserProfileResponse>,
    pub pagination: PaginationMeta,
}

/// Loyalty status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyStatusResponse {
    pub user_id: Uuid,
    pub current_points: i32,
    pub total_nights: i32,
    pub tier: Option<TierInfo>,
    pub tier_updated_at: Option<DateTime<Utc>>,
    pub points_updated_at: Option<DateTime<Utc>>,
}

/// Tier information for loyalty status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierInfo {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub min_nights: i32,
    pub benefits: JsonValue,
}

/// Database row for loyalty with tier join
#[derive(Debug, Clone, FromRow)]
struct LoyaltyWithTierRow {
    user_id: Uuid,
    current_points: Option<i32>,
    total_nights: Option<i32>,
    tier_id: Option<Uuid>,
    tier_updated_at: Option<DateTime<Utc>>,
    points_updated_at: Option<DateTime<Utc>>,
    // Tier fields (nullable due to LEFT JOIN)
    tier_name: Option<String>,
    tier_color: Option<String>,
    tier_min_nights: Option<i32>,
    tier_benefits: Option<JsonValue>,
}

/// Generic success response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T> SuccessResponse<T> {
    pub fn new(data: T) -> Self {
        Self {
            success: true,
            message: None,
            data: Some(data),
        }
    }

    pub fn with_message(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: Some(message.into()),
            data: None,
        }
    }
}

/// Profile response wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileResponseWrapper {
    pub profile: UserProfileResponse,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// GET /api/users/me - Get current user's profile
///
/// Returns the authenticated user's profile including personal information,
/// preferences, and membership details.
async fn get_current_user(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SuccessResponse<ProfileResponseWrapper>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let row = sqlx::query_as::<_, UserWithProfileRow>(
        r#"
        SELECT
            u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
            u.created_at, u.updated_at,
            p.first_name, p.last_name, p.phone, p.date_of_birth,
            p.avatar_url, p.membership_id, p.preferences
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        WHERE u.id = $1 AND u.is_active = true
        "#,
    )
    .bind(user_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let profile: UserProfileResponse = row.into();

    Ok(Json(SuccessResponse::new(ProfileResponseWrapper {
        profile,
    })))
}

/// PUT /api/users/me - Update current user's profile
///
/// Updates the authenticated user's profile information.
/// Only updates fields that are provided in the request.
async fn update_current_user(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<SuccessResponse<ProfileResponseWrapper>>, AppError> {
    // Validate request
    payload
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Check if user exists
    let user_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND is_active = true)")
            .bind(user_id)
            .fetch_one(state.db())
            .await?;

    if !user_exists {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    // Upsert profile (insert or update)
    sqlx::query(
        r#"
        INSERT INTO user_profiles (user_id, first_name, last_name, phone, date_of_birth, preferences, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            first_name = COALESCE($2, user_profiles.first_name),
            last_name = COALESCE($3, user_profiles.last_name),
            phone = COALESCE($4, user_profiles.phone),
            date_of_birth = COALESCE($5, user_profiles.date_of_birth),
            preferences = COALESCE($6, user_profiles.preferences),
            updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(&payload.first_name)
    .bind(&payload.last_name)
    .bind(&payload.phone)
    .bind(&payload.date_of_birth)
    .bind(&payload.preferences)
    .execute(state.db())
    .await?;

    // Fetch updated profile
    let row = sqlx::query_as::<_, UserWithProfileRow>(
        r#"
        SELECT
            u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
            u.created_at, u.updated_at,
            p.first_name, p.last_name, p.phone, p.date_of_birth,
            p.avatar_url, p.membership_id, p.preferences
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(state.db())
    .await?;

    let profile: UserProfileResponse = row.into();

    Ok(Json(SuccessResponse::new(ProfileResponseWrapper {
        profile,
    })))
}

/// PUT /api/users/me/password - Change current user's password
///
/// Changes the authenticated user's password after verifying the current password.
async fn change_password(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<Json<SuccessResponse<()>>, AppError> {
    // Validate request
    payload
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Get current password hash
    let current_hash: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1 AND is_active = true")
            .bind(user_id)
            .fetch_optional(state.db())
            .await?
            .flatten();

    let current_hash = current_hash.ok_or_else(|| {
        AppError::BadRequest("User not found or account uses OAuth authentication".to_string())
    })?;

    // Verify current password using argon2
    use argon2::{
        password_hash::{
            rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
        },
        Argon2,
    };

    let parsed_hash = PasswordHash::new(&current_hash)
        .map_err(|_| AppError::Internal("Failed to parse password hash".to_string()))?;

    Argon2::default()
        .verify_password(payload.current_password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::BadRequest("Current password is incorrect".to_string()))?;

    // Hash new password
    let salt = SaltString::generate(&mut OsRng);
    let new_hash = Argon2::default()
        .hash_password(payload.new_password.as_bytes(), &salt)
        .map_err(|_| AppError::Internal("Failed to hash password".to_string()))?
        .to_string();

    // Update password
    sqlx::query("UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1")
        .bind(user_id)
        .bind(new_hash)
        .execute(state.db())
        .await?;

    Ok(Json(SuccessResponse::with_message(
        "Password changed successfully",
    )))
}

/// GET /api/users/me/loyalty - Get current user's loyalty status
///
/// Returns the authenticated user's loyalty program status including
/// points, nights, and current tier information.
async fn get_loyalty_status(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SuccessResponse<LoyaltyStatusResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let row = sqlx::query_as::<_, LoyaltyWithTierRow>(
        r#"
        SELECT
            ul.user_id,
            ul.current_points,
            ul.total_nights,
            ul.tier_id,
            ul.tier_updated_at,
            ul.points_updated_at,
            t.name as tier_name,
            t.color as tier_color,
            t.min_nights as tier_min_nights,
            t.benefits as tier_benefits
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(state.db())
    .await?;

    let loyalty_status = match row {
        Some(r) => {
            let tier = r.tier_id.map(|id| TierInfo {
                id,
                name: r.tier_name.unwrap_or_else(|| "Unknown".to_string()),
                color: r.tier_color.unwrap_or_else(|| "#808080".to_string()),
                min_nights: r.tier_min_nights.unwrap_or(0),
                benefits: r.tier_benefits.unwrap_or(serde_json::json!({})),
            });

            LoyaltyStatusResponse {
                user_id: r.user_id,
                current_points: r.current_points.unwrap_or(0),
                total_nights: r.total_nights.unwrap_or(0),
                tier,
                tier_updated_at: r.tier_updated_at,
                points_updated_at: r.points_updated_at,
            }
        },
        None => {
            // User has no loyalty record yet, return default values
            LoyaltyStatusResponse {
                user_id,
                current_points: 0,
                total_nights: 0,
                tier: None,
                tier_updated_at: None,
                points_updated_at: None,
            }
        },
    };

    Ok(Json(SuccessResponse::new(loyalty_status)))
}

/// GET /api/users/:id - Get user by ID (admin only)
///
/// Returns a specific user's profile by their ID.
/// Requires admin or super_admin role.
async fn get_user_by_id(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<SuccessResponse<UserProfileResponse>>, AppError> {
    // Check admin permission
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let row = sqlx::query_as::<_, UserWithProfileRow>(
        r#"
        SELECT
            u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
            u.created_at, u.updated_at,
            p.first_name, p.last_name, p.phone, p.date_of_birth,
            p.avatar_url, p.membership_id, p.preferences
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let profile: UserProfileResponse = row.into();

    Ok(Json(SuccessResponse::new(profile)))
}

/// GET /api/users - List users with pagination (admin only)
///
/// Returns a paginated list of users with optional search.
/// Requires admin or super_admin role.
async fn list_users(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<ListUsersQuery>,
) -> Result<Json<PaginatedUsersResponse>, AppError> {
    // Check admin permission
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let page = query.page.max(1);
    let limit = query.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    // Build search condition
    let search_pattern = query
        .search
        .as_ref()
        .map(|s| format!("%{}%", s.to_lowercase()));

    // Get total count
    let total: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM users u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE LOWER(u.email) LIKE $1
               OR LOWER(p.first_name) LIKE $1
               OR LOWER(p.last_name) LIKE $1
               OR LOWER(p.membership_id) LIKE $1
            "#,
        )
        .bind(pattern)
        .fetch_one(state.db())
        .await?
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(state.db())
            .await?
    };

    // Get users
    let rows: Vec<UserWithProfileRow> = if let Some(ref pattern) = search_pattern {
        sqlx::query_as(
            r#"
            SELECT
                u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
                u.created_at, u.updated_at,
                p.first_name, p.last_name, p.phone, p.date_of_birth,
                p.avatar_url, p.membership_id, p.preferences
            FROM users u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            WHERE LOWER(u.email) LIKE $1
               OR LOWER(p.first_name) LIKE $1
               OR LOWER(p.last_name) LIKE $1
               OR LOWER(p.membership_id) LIKE $1
            ORDER BY u.created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(state.db())
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT
                u.id, u.email, u.role::text as role, u.is_active, u.email_verified,
                u.created_at, u.updated_at,
                p.first_name, p.last_name, p.phone, p.date_of_birth,
                p.avatar_url, p.membership_id, p.preferences
            FROM users u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            ORDER BY u.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(state.db())
        .await?
    };

    let users: Vec<UserProfileResponse> = rows.into_iter().map(|r| r.into()).collect();
    let pages = (total as f64 / limit as f64).ceil() as i64;

    Ok(Json(PaginatedUsersResponse {
        success: true,
        data: users,
        pagination: PaginationMeta {
            page,
            limit,
            total,
            pages,
        },
    }))
}

/// Avatar upload response with URL
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvatarUploadResponse {
    #[serde(rename = "avatarUrl")]
    pub avatar_url: String,
}

/// Upload avatar handler
///
/// Accepts multipart form data with an 'avatar' field containing the image file.
/// Supported formats: jpeg, jpg, png, gif, webp
/// Maximum file size: 15MB
async fn upload_avatar(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Result<Json<SuccessResponse<AvatarUploadResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Extract the avatar file from multipart form data
    let mut file_data: Option<Bytes> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read multipart data: {}", e)))?
    {
        let name = field.name().unwrap_or_default().to_string();
        if name == "avatar" {
            // Get content type
            content_type = field
                .content_type()
                .map(|ct| ct.to_string())
                .or_else(|| Some("image/jpeg".to_string()));

            // Read file data
            file_data =
                Some(field.bytes().await.map_err(|e| {
                    AppError::BadRequest(format!("Failed to read file data: {}", e))
                })?);
            break;
        }
    }

    let data =
        file_data.ok_or_else(|| AppError::BadRequest("No avatar file uploaded".to_string()))?;
    let mime_type = content_type.unwrap_or_else(|| "image/jpeg".to_string());

    // Validate content type
    if !AllowedMimeTypes::is_valid_avatar_type(&mime_type) {
        return Err(AppError::BadRequest(format!(
            "Only image files are allowed (jpeg, jpg, png, gif, webp). Got: {}",
            mime_type
        )));
    }

    // Validate file size (15MB max for avatar processing)
    const MAX_AVATAR_SIZE: usize = 15 * 1024 * 1024;
    if data.len() > MAX_AVATAR_SIZE {
        return Err(AppError::BadRequest(format!(
            "File size too large. Maximum size is {}MB",
            MAX_AVATAR_SIZE / (1024 * 1024)
        )));
    }

    // Save avatar using storage service
    let storage = StorageService::new();
    storage.initialize().await?;

    let relative_path = storage
        .save_avatar(&user_id.to_string(), data, &mime_type)
        .await?;

    // Build the full URL path for the avatar
    let avatar_url = format!("/storage/{}", relative_path);

    // Update the user's profile with the new avatar URL
    sqlx::query("UPDATE user_profiles SET avatar_url = $2, updated_at = NOW() WHERE user_id = $1")
        .bind(user_id)
        .bind(&avatar_url)
        .execute(state.db())
        .await?;

    tracing::info!("Avatar uploaded for user {}: {}", user_id, avatar_url);

    Ok(Json(SuccessResponse {
        success: true,
        message: Some("Avatar uploaded successfully".to_string()),
        data: Some(AvatarUploadResponse { avatar_url }),
    }))
}

/// Delete avatar handler
async fn delete_avatar(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SuccessResponse<()>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    sqlx::query(
        "UPDATE user_profiles SET avatar_url = NULL, updated_at = NOW() WHERE user_id = $1",
    )
    .bind(user_id)
    .execute(state.db())
    .await?;

    Ok(Json(SuccessResponse::with_message(
        "Avatar deleted successfully",
    )))
}

/// Delete account handler
async fn delete_account(
    State(state): State<FullAppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SuccessResponse<()>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Soft delete: set is_active to false
    let result = sqlx::query(
        "UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true",
    )
    .bind(user_id)
    .execute(state.db())
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    Ok(Json(SuccessResponse::with_message(
        "Account deleted successfully",
    )))
}

// ============================================================================
// Router Configuration
// ============================================================================

/// Create user routes with state support
///
/// Returns a Router that expects AppState to be provided via `.with_state()`
/// when merged into the main router.
pub fn routes() -> Router<FullAppState> {
    Router::new()
        // Current user routes
        .route("/me", get(get_current_user))
        .route("/me", put(update_current_user))
        .route("/me/password", put(change_password))
        .route("/me/loyalty", get(get_loyalty_status))
        // Avatar routes
        .route("/avatar", put(upload_avatar))
        .route("/avatar", delete(delete_avatar))
        // Account management
        .route("/account", delete(delete_account))
        // Admin routes (authorization checked in handlers)
        .route("/", get(list_users))
        .route("/:id", get(get_user_by_id))
        // Apply authentication middleware to all routes
        .layer(middleware::from_fn(auth_middleware))
}

/// Not implemented response for placeholder routes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotImplementedResponse {
    pub error: String,
    pub message: String,
}

#[allow(dead_code)]
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

/// Create user routes with application state
///
/// Returns fully functional routes with database access and authentication.
pub fn routes_with_state(state: FullAppState) -> Router {
    // Protected routes requiring authentication
    Router::new()
        // Current user routes
        .route("/users/me", get(get_current_user))
        .route("/users/me", put(update_current_user))
        .route("/users/me/password", put(change_password))
        .route("/users/me/loyalty", get(get_loyalty_status))
        // Avatar routes
        .route("/users/avatar", put(upload_avatar))
        .route("/users/avatar", delete(delete_avatar))
        // Account management
        .route("/users/account", delete(delete_account))
        // Admin routes (authorization checked in handlers)
        .route("/users", get(list_users))
        .route("/users/:id", get(get_user_by_id))
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_pagination() {
        assert_eq!(default_page(), 1);
        assert_eq!(default_limit(), 10);
    }

    #[test]
    fn test_success_response_new() {
        let response = SuccessResponse::new("test data");
        assert!(response.success);
        assert_eq!(response.data, Some("test data"));
        assert!(response.message.is_none());
    }

    #[test]
    fn test_success_response_with_message() {
        let response: SuccessResponse<()> = SuccessResponse::with_message("Operation completed");
        assert!(response.success);
        assert_eq!(response.message, Some("Operation completed".to_string()));
        assert!(response.data.is_none());
    }

    #[test]
    fn test_list_users_query_defaults() {
        let query = ListUsersQuery {
            page: 1,
            limit: 10,
            search: None,
        };
        assert_eq!(query.page, 1);
        assert_eq!(query.limit, 10);
        assert!(query.search.is_none());
    }

    #[test]
    fn test_pagination_meta() {
        let meta = PaginationMeta {
            page: 2,
            limit: 10,
            total: 45,
            pages: 5,
        };
        assert_eq!(meta.page, 2);
        assert_eq!(meta.pages, 5);
    }
}
