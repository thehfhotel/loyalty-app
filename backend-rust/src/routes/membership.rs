//! Membership routes
//!
//! Provides endpoints for membership ID management including lookup,
//! statistics, and regeneration.
//!
//! ## Endpoints
//!
//! - `GET /my-id` - Get current user's membership ID (authenticated)
//! - `GET /lookup/:membershipId` - Look up user by membership ID (admin only)
//! - `GET /stats` - Get membership ID statistics (admin only)
//! - `POST /regenerate/:userId` - Regenerate membership ID for user (super_admin only)

use axum::{
    extract::{Extension, Path, State},
    middleware,
    routing::{get, post},
    Json, Router,
};
use regex_lite::Regex;
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::state::AppState;

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

/// User info returned from membership lookup
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MembershipUserInfo {
    #[sqlx(rename = "userId")]
    #[serde(rename = "userId")]
    pub user_id: Uuid,
    #[sqlx(rename = "membershipId")]
    #[serde(rename = "membershipId")]
    pub membership_id: String,
    #[sqlx(rename = "firstName")]
    #[serde(rename = "firstName")]
    pub first_name: Option<String>,
    #[sqlx(rename = "lastName")]
    #[serde(rename = "lastName")]
    pub last_name: Option<String>,
    pub email: String,
    pub phone: Option<String>,
    #[sqlx(rename = "isActive")]
    #[serde(rename = "isActive")]
    pub is_active: bool,
}

/// User's own membership ID response
#[derive(Debug, Serialize)]
pub struct MyMembershipIdResponse {
    #[serde(rename = "membershipId")]
    pub membership_id: String,
}

/// Membership ID statistics
#[derive(Debug, Serialize)]
pub struct MembershipStats {
    #[serde(rename = "totalUsers")]
    pub total_users: i64,
    #[serde(rename = "usersWithMembershipId")]
    pub users_with_membership_id: i64,
    #[serde(rename = "usersWithoutMembershipId")]
    pub users_without_membership_id: i64,
    #[serde(rename = "currentUserCount")]
    pub current_user_count: i64,
    #[serde(rename = "currentBlock")]
    pub current_block: i64,
    #[serde(rename = "currentBlockRange")]
    pub current_block_range: String,
    #[serde(rename = "blocksInUse")]
    pub blocks_in_use: i64,
}

/// Regenerate membership ID response
#[derive(Debug, Serialize)]
pub struct RegenerateMembershipResponse {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "newMembershipId")]
    pub new_membership_id: String,
}

// ============================================================================
// Validation
// ============================================================================

/// Validate membership ID format (8 digits starting with 269)
fn validate_membership_id(membership_id: &str) -> bool {
    let re = Regex::new(r"^269\d{5}$").unwrap();
    re.is_match(membership_id)
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /membership/my-id
/// Get current user's membership ID
async fn get_my_membership_id(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiResponse<MyMembershipIdResponse>>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let result: Option<(String,)> =
        sqlx::query_as("SELECT membership_id FROM user_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(state.db())
            .await?;

    let membership_id = result
        .ok_or_else(|| AppError::NotFound("User profile not found".to_string()))?
        .0;

    Ok(Json(ApiResponse::success(MyMembershipIdResponse {
        membership_id,
    })))
}

/// GET /membership/lookup/:membershipId
/// Look up user information by membership ID (admin only)
async fn lookup_membership(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(membership_id): Path<String>,
) -> Result<Json<ApiResponse<MembershipUserInfo>>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    // Validate membership ID format
    if membership_id.is_empty() || membership_id == "undefined" {
        return Err(AppError::BadRequest(
            "Membership ID is required".to_string(),
        ));
    }

    if !validate_membership_id(&membership_id) {
        return Err(AppError::BadRequest(
            "Invalid membership ID format. Must be 8 digits starting with 269.".to_string(),
        ));
    }

    // Look up user by membership ID
    let user_info: Option<MembershipUserInfo> = sqlx::query_as(
        r#"
        SELECT
            u.id AS "userId",
            up.membership_id AS "membershipId",
            up.first_name AS "firstName",
            up.last_name AS "lastName",
            u.email,
            up.phone,
            u.is_active AS "isActive"
        FROM users u
        JOIN user_profiles up ON u.id = up.user_id
        WHERE up.membership_id = $1
        "#,
    )
    .bind(&membership_id)
    .fetch_optional(state.db())
    .await?;

    let user = user_info
        .ok_or_else(|| AppError::NotFound("User not found with this membership ID".to_string()))?;

    if !user.is_active {
        return Err(AppError::Forbidden("User account is disabled".to_string()));
    }

    Ok(Json(ApiResponse::success(user)))
}

/// GET /membership/stats
/// Get membership ID statistics (admin only)
async fn get_membership_stats(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ApiResponse<MembershipStats>>, AppError> {
    // Check admin role
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    // Get user statistics
    let stats: Option<(i64, i64, i64)> = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_users,
            COUNT(up.membership_id) as users_with_membership_id,
            COUNT(*) - COUNT(up.membership_id) as users_without_membership_id
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        "#,
    )
    .fetch_optional(state.db())
    .await?;

    let (total_users, users_with_membership_id, users_without_membership_id) =
        stats.unwrap_or((0, 0, 0));

    // Get sequence information
    let sequence_info: Option<(i64,)> =
        sqlx::query_as("SELECT current_user_count FROM membership_id_sequence LIMIT 1")
            .fetch_optional(state.db())
            .await?;

    let current_user_count = sequence_info.map(|s| s.0).unwrap_or(0);
    let block_size: i64 = 100;
    let current_block = if current_user_count > 0 {
        (current_user_count - 1) / block_size
    } else {
        0
    };
    let block_start = current_block * block_size + 1;
    let block_end = (current_block + 1) * block_size;
    let blocks_in_use = if current_user_count > 0 {
        (current_user_count - 1) / block_size + 1
    } else {
        0
    };

    Ok(Json(ApiResponse::success(MembershipStats {
        total_users,
        users_with_membership_id,
        users_without_membership_id,
        current_user_count,
        current_block,
        current_block_range: format!("{}-{}", block_start, block_end),
        blocks_in_use: blocks_in_use.max(0),
    })))
}

/// POST /membership/regenerate/:userId
/// Regenerate membership ID for a user (super_admin only)
async fn regenerate_membership_id(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(user_id): Path<String>,
) -> Result<Json<ApiResponse<RegenerateMembershipResponse>>, AppError> {
    // Check super_admin role
    if !has_role(&auth_user, "super_admin") {
        return Err(AppError::Forbidden(
            "Super admin access required".to_string(),
        ));
    }

    let user_uuid = Uuid::parse_str(&user_id)
        .map_err(|_| AppError::BadRequest("Valid user ID is required".to_string()))?;

    // Generate new membership ID using a simplified approach
    // In production, you'd want to implement the full block-based algorithm
    let new_membership_id = generate_membership_id(state.db()).await?;

    // Update user's membership ID
    let result = sqlx::query(
        "UPDATE user_profiles SET membership_id = $1, updated_at = NOW() WHERE user_id = $2",
    )
    .bind(&new_membership_id)
    .bind(user_uuid)
    .execute(state.db())
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("User profile not found".to_string()));
    }

    tracing::info!(
        "Membership ID regenerated for user {}: {}",
        user_id,
        new_membership_id
    );

    Ok(Json(ApiResponse::with_message(
        RegenerateMembershipResponse {
            user_id,
            new_membership_id,
        },
        "Membership ID regenerated successfully",
    )))
}

/// Generate a new unique membership ID
async fn generate_membership_id(db: &sqlx::PgPool) -> Result<String, AppError> {
    // Increment user count and get new value
    let result: (i64,) = sqlx::query_as(
        r#"
        UPDATE membership_id_sequence
        SET current_user_count = current_user_count + 1,
            updated_at = NOW()
        RETURNING current_user_count
        "#,
    )
    .fetch_one(db)
    .await?;

    let user_count = result.0;
    let block_size: i64 = 100;
    let block_number = (user_count - 1) / block_size;

    // Try to find a unique ID within the block
    for _ in 0..100 {
        let block_start = block_number * block_size + 1;
        let random_within_block = block_start + (rand::random::<i64>() % block_size).abs();
        let candidate_id = format!("269{:05}", random_within_block);

        // Check if ID exists
        let exists: Option<(bool,)> = sqlx::query_as(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM user_profiles WHERE membership_id = $1
                UNION
                SELECT 1 FROM reserved_membership_ids WHERE membership_id = $1
            ) as exists
            "#,
        )
        .bind(&candidate_id)
        .fetch_optional(db)
        .await?;

        if !exists.map(|e| e.0).unwrap_or(false) {
            return Ok(candidate_id);
        }
    }

    Err(AppError::Internal(
        "Failed to generate unique membership ID after 100 attempts".to_string(),
    ))
}

// ============================================================================
// Router
// ============================================================================

/// Create membership routes
///
/// These routes are intended to be nested under /api/membership via the main router.
/// All routes require authentication.
///
/// ## Endpoints
///
/// - `GET /my-id` - Get current user's membership ID (authenticated)
/// - `GET /lookup/:membershipId` - Look up user by membership ID (admin only)
/// - `GET /stats` - Get membership ID statistics (admin only)
/// - `POST /regenerate/:userId` - Regenerate membership ID for user (super_admin only)
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/my-id", get(get_my_membership_id))
        .route("/lookup/:membershipId", get(lookup_membership))
        .route("/stats", get(get_membership_stats))
        .route("/regenerate/:userId", post(regenerate_membership_id))
        .layer(middleware::from_fn(auth_middleware))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_membership_id_valid() {
        assert!(validate_membership_id("26900001"));
        assert!(validate_membership_id("26912345"));
        assert!(validate_membership_id("26999999"));
    }

    #[test]
    fn test_validate_membership_id_invalid() {
        assert!(!validate_membership_id("12345678")); // Doesn't start with 269
        assert!(!validate_membership_id("269123")); // Too short
        assert!(!validate_membership_id("2691234567")); // Too long
        assert!(!validate_membership_id("26912a45")); // Contains letter
        assert!(!validate_membership_id("")); // Empty
    }

    #[test]
    fn test_api_response_success() {
        let response = ApiResponse::success(MyMembershipIdResponse {
            membership_id: "26900001".to_string(),
        });
        assert!(response.success);
        assert!(response.message.is_none());
    }

    #[test]
    fn test_api_response_with_message() {
        let response = ApiResponse::with_message("data", "Operation completed");
        assert!(response.success);
        assert_eq!(response.message, Some("Operation completed".to_string()));
    }
}
