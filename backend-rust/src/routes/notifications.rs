//! Notification routes
//!
//! Provides endpoints for notification management including:
//! - Listing notifications with pagination
//! - Getting unread count
//! - Marking notifications as read (single and all)
//! - Deleting notifications

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::state::AppState;

// ==================== REQUEST/RESPONSE TYPES ====================

/// Query parameters for listing notifications
#[derive(Debug, Deserialize)]
pub struct ListNotificationsQuery {
    /// Page number (1-indexed, defaults to 1)
    pub page: Option<i32>,
    /// Number of items per page (defaults to 20, max 50)
    pub limit: Option<i32>,
    /// If true, only return unread notifications
    pub unread_only: Option<bool>,
}

/// Notification response DTO
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct NotificationDto {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    #[sqlx(rename = "type")]
    pub notification_type: String,
    pub data: Option<serde_json::Value>,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Notification in API response format
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub data: Option<serde_json::Value>,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub is_read: bool,
}

impl From<NotificationDto> for NotificationResponse {
    fn from(n: NotificationDto) -> Self {
        let is_read = n.read_at.is_some();
        Self {
            id: n.id,
            user_id: n.user_id,
            title: n.title,
            message: n.message,
            notification_type: n.notification_type,
            data: n.data,
            read_at: n.read_at,
            created_at: n.created_at,
            expires_at: n.expires_at,
            is_read,
        }
    }
}

/// Response for listing notifications
#[derive(Debug, Serialize)]
pub struct NotificationsListResponse {
    pub notifications: Vec<NotificationResponse>,
    pub pagination: PaginationInfo,
}

/// Pagination information
#[derive(Debug, Serialize)]
pub struct PaginationInfo {
    pub page: i32,
    pub limit: i32,
    pub total: i64,
    pub pages: i32,
}

/// Response for unread count endpoint
#[derive(Debug, Serialize)]
pub struct UnreadCountResponse {
    pub success: bool,
    pub data: UnreadCountData,
}

#[derive(Debug, Serialize)]
pub struct UnreadCountData {
    #[serde(rename = "unreadCount")]
    pub unread_count: i64,
}

/// Response for mark as read endpoint
#[derive(Debug, Serialize)]
pub struct MarkAsReadResponse {
    pub success: bool,
    pub notification: NotificationResponse,
}

/// Response for mark all as read endpoint
#[derive(Debug, Serialize)]
pub struct MarkAllReadResponse {
    pub success: bool,
    #[serde(rename = "markedRead")]
    pub marked_read: i64,
}

/// Response for delete endpoint
#[derive(Debug, Serialize)]
pub struct DeleteNotificationResponse {
    pub success: bool,
    pub message: String,
}

/// Single notification preference entry
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationPreference {
    #[serde(rename = "type")]
    pub pref_type: String,
    pub enabled: bool,
}

/// Notification preferences response
#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationPreferencesResponse {
    pub user_id: Uuid,
    pub preferences: Vec<NotificationPreference>,
}

/// Update notification preferences request
#[derive(Debug, Deserialize)]
pub struct UpdatePreferencesRequest {
    pub preferences: Vec<NotificationPreference>,
}

/// Cleanup response
#[derive(Debug, Serialize)]
pub struct CleanupResponse {
    pub success: bool,
    pub deleted_count: i64,
}

/// Internal row type for count queries
#[derive(FromRow)]
struct CountRow {
    count: i64,
}

// ==================== ROUTE HANDLERS ====================

/// GET /api/notifications
///
/// Lists user's notifications with pagination.
/// Requires authentication.
///
/// Query parameters:
/// - page: Page number (default: 1)
/// - limit: Items per page (default: 20, max: 50)
/// - unread_only: If true, only return unread notifications
async fn list_notifications(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<ListNotificationsQuery>,
) -> AppResult<Json<NotificationsListResponse>> {
    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    // Normalize pagination parameters
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let offset = ((page - 1) * limit) as i64;
    let unread_only = query.unread_only.unwrap_or(false);

    // Get total count
    let total = if unread_only {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM notifications
            WHERE user_id = $1
              AND (expires_at IS NULL OR expires_at > NOW())
              AND read_at IS NULL
            "#,
        )
        .bind(user_id)
        .fetch_one(state.db())
        .await?
        .count
    } else {
        sqlx::query_as::<_, CountRow>(
            r#"
            SELECT COUNT(*) as count
            FROM notifications
            WHERE user_id = $1
              AND (expires_at IS NULL OR expires_at > NOW())
            "#,
        )
        .bind(user_id)
        .fetch_one(state.db())
        .await?
        .count
    };

    // Get paginated notifications
    let notifications = if unread_only {
        sqlx::query_as::<_, NotificationDto>(
            r#"
            SELECT
                id,
                user_id,
                title,
                message,
                type,
                data,
                read_at,
                created_at,
                expires_at
            FROM notifications
            WHERE user_id = $1
              AND (expires_at IS NULL OR expires_at > NOW())
              AND read_at IS NULL
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit as i64)
        .bind(offset)
        .fetch_all(state.db())
        .await?
    } else {
        sqlx::query_as::<_, NotificationDto>(
            r#"
            SELECT
                id,
                user_id,
                title,
                message,
                type,
                data,
                read_at,
                created_at,
                expires_at
            FROM notifications
            WHERE user_id = $1
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit as i64)
        .bind(offset)
        .fetch_all(state.db())
        .await?
    };

    // Calculate total pages
    let total_pages = if total > 0 {
        ((total as f64) / (limit as f64)).ceil() as i32
    } else {
        1
    };

    // Convert to response format
    let notifications: Vec<NotificationResponse> = notifications
        .into_iter()
        .map(NotificationResponse::from)
        .collect();

    tracing::debug!(
        user_id = %auth_user.id,
        page = page,
        limit = limit,
        total = total,
        returned = notifications.len(),
        "Listed notifications"
    );

    Ok(Json(NotificationsListResponse {
        notifications,
        pagination: PaginationInfo {
            page,
            limit,
            total,
            pages: total_pages,
        },
    }))
}

/// GET /api/notifications/unread-count
///
/// Returns count of unread notifications.
/// Requires authentication.
async fn get_unread_count(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<UnreadCountResponse>> {
    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    // Get unread count
    let count = sqlx::query_as::<_, CountRow>(
        r#"
        SELECT COUNT(*) as count
        FROM notifications
        WHERE user_id = $1
          AND read_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        "#,
    )
    .bind(user_id)
    .fetch_one(state.db())
    .await?
    .count;

    tracing::debug!(
        user_id = %auth_user.id,
        unread_count = count,
        "Retrieved unread notification count"
    );

    Ok(Json(UnreadCountResponse {
        success: true,
        data: UnreadCountData {
            unread_count: count,
        },
    }))
}

/// PUT /api/notifications/:id/read
///
/// Marks a specific notification as read.
/// Requires authentication. Only the owner can mark their notification as read.
async fn mark_notification_read(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(notification_id): Path<Uuid>,
) -> AppResult<Json<MarkAsReadResponse>> {
    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    // Mark notification as read and return it
    let notification = sqlx::query_as::<_, NotificationDto>(
        r#"
        UPDATE notifications
        SET read_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id,
            user_id,
            title,
            message,
            type,
            data,
            read_at,
            created_at,
            expires_at
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Notification not found".to_string()))?;

    tracing::info!(
        user_id = %auth_user.id,
        notification_id = %notification_id,
        "Marked notification as read"
    );

    Ok(Json(MarkAsReadResponse {
        success: true,
        notification: NotificationResponse::from(notification),
    }))
}

/// PUT /api/notifications/read-all
///
/// Marks all notifications as read for the authenticated user.
/// Requires authentication.
async fn mark_all_notifications_read(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<MarkAllReadResponse>> {
    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    // Mark all notifications as read
    let result = sqlx::query(
        r#"
        UPDATE notifications
        SET read_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND read_at IS NULL
        "#,
    )
    .bind(user_id)
    .execute(state.db())
    .await?;

    let marked_count = result.rows_affected() as i64;

    tracing::info!(
        user_id = %auth_user.id,
        marked_count = marked_count,
        "Marked all notifications as read"
    );

    Ok(Json(MarkAllReadResponse {
        success: true,
        marked_read: marked_count,
    }))
}

/// DELETE /api/notifications/:id
///
/// Deletes a specific notification.
/// Requires authentication. Only the owner can delete their notification.
async fn delete_notification(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(notification_id): Path<Uuid>,
) -> AppResult<Json<DeleteNotificationResponse>> {
    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    // Delete the notification
    let result = sqlx::query(
        r#"
        DELETE FROM notifications
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .execute(state.db())
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Notification not found or already deleted".to_string(),
        ));
    }

    tracing::info!(
        user_id = %auth_user.id,
        notification_id = %notification_id,
        "Deleted notification"
    );

    Ok(Json(DeleteNotificationResponse {
        success: true,
        message: "Notification deleted successfully".to_string(),
    }))
}

/// GET /api/notifications/preferences
async fn get_notification_preferences(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<NotificationPreferencesResponse>> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    let rows: Vec<(String, bool)> = sqlx::query_as(
        "SELECT type, enabled FROM notification_preferences WHERE user_id = $1 ORDER BY type",
    )
    .bind(user_id)
    .fetch_all(state.db())
    .await?;

    let preferences: Vec<NotificationPreference> = rows
        .into_iter()
        .map(|(pref_type, enabled)| NotificationPreference { pref_type, enabled })
        .collect();

    Ok(Json(NotificationPreferencesResponse {
        user_id,
        preferences,
    }))
}

/// PUT /api/notifications/preferences
async fn update_notification_preferences(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<UpdatePreferencesRequest>,
) -> AppResult<Json<NotificationPreferencesResponse>> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID".to_string()))?;

    // Upsert each preference row
    for pref in &payload.preferences {
        sqlx::query(
            r#"
            INSERT INTO notification_preferences (user_id, type, enabled)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, type) DO UPDATE SET
                enabled = $3,
                updated_at = NOW()
            "#,
        )
        .bind(user_id)
        .bind(&pref.pref_type)
        .bind(pref.enabled)
        .execute(state.db())
        .await?;
    }

    // Fetch all preferences for user
    let rows: Vec<(String, bool)> = sqlx::query_as(
        "SELECT type, enabled FROM notification_preferences WHERE user_id = $1 ORDER BY type",
    )
    .bind(user_id)
    .fetch_all(state.db())
    .await?;

    let preferences: Vec<NotificationPreference> = rows
        .into_iter()
        .map(|(pref_type, enabled)| NotificationPreference { pref_type, enabled })
        .collect();

    Ok(Json(NotificationPreferencesResponse {
        user_id,
        preferences,
    }))
}

/// POST /api/notifications/admin/cleanup
async fn cleanup_notifications(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<CleanupResponse>> {
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }

    let result = sqlx::query(
        "DELETE FROM notifications WHERE expires_at IS NOT NULL AND expires_at < NOW()",
    )
    .execute(state.db())
    .await?;

    Ok(Json(CleanupResponse {
        success: true,
        deleted_count: result.rows_affected() as i64,
    }))
}

// ==================== ROUTER ====================

/// Create notification router
///
/// All routes require authentication.
/// Routes are protected via auth_middleware.
///
/// Returns a Router<AppState> with the following endpoints (nested under /api/notifications):
/// - GET / - List user's notifications
/// - GET /unread-count - Get unread count
/// - PUT /:id/read - Mark as read
/// - PUT /read-all - Mark all as read
/// - DELETE /:id - Delete notification
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_notifications))
        .route("/unread-count", get(get_unread_count))
        .route("/:id/read", put(mark_notification_read))
        .route("/read-all", put(mark_all_notifications_read))
        .route("/:id", delete(delete_notification))
        .route("/preferences", get(get_notification_preferences))
        .route("/preferences", put(update_notification_preferences))
        .route("/admin/cleanup", post(cleanup_notifications))
        .layer(middleware::from_fn(auth_middleware))
}

/// Alias for router() - backwards compatibility
pub fn routes() -> Router<AppState> {
    router()
}

/// Not implemented response (for routes without state)
#[derive(Serialize)]
pub struct NotImplementedResponse {
    pub error: String,
    pub message: String,
}

async fn not_implemented() -> (StatusCode, Json<NotImplementedResponse>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(NotImplementedResponse {
            error: "not_implemented".to_string(),
            message: "This endpoint is not yet implemented".to_string(),
        }),
    )
}

/// Create notification routes without state (stub version)
///
/// Returns routes that will return 501 Not Implemented.
/// Used when running without database/Redis.
pub fn routes_stub() -> Router {
    Router::new()
        .route("/", get(not_implemented))
        .route("/unread-count", get(not_implemented))
        .route("/:id/read", put(not_implemented))
        .route("/read-all", put(not_implemented))
        .route("/:id", delete(not_implemented))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_notifications_query_defaults() {
        let query = ListNotificationsQuery {
            page: None,
            limit: None,
            unread_only: None,
        };

        let page = query.page.unwrap_or(1).max(1);
        let limit = query.limit.unwrap_or(20).clamp(1, 50);

        assert_eq!(page, 1);
        assert_eq!(limit, 20);
    }

    #[test]
    fn test_list_notifications_query_bounds() {
        // Test minimum bounds
        let query = ListNotificationsQuery {
            page: Some(-5),
            limit: Some(-10),
            unread_only: None,
        };

        let page = query.page.unwrap_or(1).max(1);
        let limit = query.limit.unwrap_or(20).clamp(1, 50);

        assert_eq!(page, 1);
        assert_eq!(limit, 1);

        // Test maximum bounds
        let query = ListNotificationsQuery {
            page: Some(100),
            limit: Some(200),
            unread_only: Some(true),
        };

        let page = query.page.unwrap_or(1).max(1);
        let limit = query.limit.unwrap_or(20).clamp(1, 50);

        assert_eq!(page, 100);
        assert_eq!(limit, 50);
    }

    #[test]
    fn test_pagination_info_serialization() {
        let pagination = PaginationInfo {
            page: 2,
            limit: 20,
            total: 45,
            pages: 3,
        };

        let json = serde_json::to_string(&pagination).unwrap();
        assert!(json.contains("\"page\":2"));
        assert!(json.contains("\"limit\":20"));
        assert!(json.contains("\"total\":45"));
        assert!(json.contains("\"pages\":3"));
    }

    #[test]
    fn test_unread_count_response_serialization() {
        let response = UnreadCountResponse {
            success: true,
            data: UnreadCountData { unread_count: 5 },
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"unreadCount\":5"));
    }

    #[test]
    fn test_mark_all_read_response_serialization() {
        let response = MarkAllReadResponse {
            success: true,
            marked_read: 10,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"markedRead\":10"));
    }

    #[test]
    fn test_delete_response_serialization() {
        let response = DeleteNotificationResponse {
            success: true,
            message: "Notification deleted successfully".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"message\":\"Notification deleted successfully\""));
    }

    #[test]
    fn test_notification_response_from_dto() {
        let dto = NotificationDto {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            title: "Test Title".to_string(),
            message: "Test Message".to_string(),
            notification_type: "info".to_string(),
            data: Some(serde_json::json!({"key": "value"})),
            read_at: None,
            created_at: Utc::now(),
            expires_at: None,
        };

        let response = NotificationResponse::from(dto.clone());

        assert_eq!(response.id, dto.id);
        assert_eq!(response.title, dto.title);
        assert_eq!(response.message, dto.message);
        assert!(!response.is_read);

        // Test with read notification
        let mut read_dto = dto;
        read_dto.read_at = Some(Utc::now());

        let read_response = NotificationResponse::from(read_dto);
        assert!(read_response.is_read);
    }

    #[test]
    fn test_notification_response_type_field_serialization() {
        let response = NotificationResponse {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            title: "Test".to_string(),
            message: "Test".to_string(),
            notification_type: "reward".to_string(),
            data: None,
            read_at: None,
            created_at: Utc::now(),
            expires_at: None,
            is_read: false,
        };

        let json = serde_json::to_string(&response).unwrap();
        // Verify the field is serialized as "type" not "notification_type"
        assert!(json.contains("\"type\":\"reward\""));
        assert!(!json.contains("\"notification_type\""));
    }
}
