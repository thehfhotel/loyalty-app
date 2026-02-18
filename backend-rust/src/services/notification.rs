//! Notification service module
//!
//! Provides notification management functionality including:
//! - Listing notifications with filtering
//! - Getting unread notification count
//! - Creating notifications
//! - Marking notifications as read
//! - Deleting notifications

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::notification::Notification;
use crate::services::AppState;

/// Filters for listing notifications
#[derive(Debug, Clone, Default, Deserialize)]
pub struct NotificationFilters {
    /// Filter by notification type
    pub notification_type: Option<String>,
    /// Only include unread notifications
    pub unread_only: Option<bool>,
    /// Page number (1-indexed)
    pub page: Option<i32>,
    /// Number of items per page
    pub per_page: Option<i32>,
}

impl NotificationFilters {
    /// Get the page number (defaults to 1)
    pub fn page(&self) -> i32 {
        self.page.unwrap_or(1).max(1)
    }

    /// Get items per page (defaults to 20, max 100)
    pub fn per_page(&self) -> i32 {
        self.per_page.unwrap_or(20).min(100).max(1)
    }

    /// Calculate the offset for pagination
    pub fn offset(&self) -> i64 {
        ((self.page() - 1) * self.per_page()) as i64
    }
}

/// Data for creating a new notification
#[derive(Debug, Clone, Deserialize)]
pub struct CreateNotificationDto {
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    pub notification_type: Option<String>,
    pub data: Option<serde_json::Value>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Response containing paginated notifications
#[derive(Debug, Clone, Serialize)]
pub struct NotificationListResponse {
    pub notifications: Vec<Notification>,
    pub total: i64,
    pub unread: i64,
    pub page: i32,
    pub per_page: i32,
    pub total_pages: i32,
}

/// Notification service trait defining notification operations
#[async_trait]
pub trait NotificationService: Send + Sync {
    /// List notifications for a user with filtering and pagination
    async fn list_notifications(
        &self,
        user_id: Uuid,
        filters: NotificationFilters,
    ) -> Result<NotificationListResponse, AppError>;

    /// Get the count of unread notifications for a user
    async fn get_unread_count(&self, user_id: Uuid) -> Result<i64, AppError>;

    /// Create a new notification
    async fn create_notification(
        &self,
        data: CreateNotificationDto,
    ) -> Result<Notification, AppError>;

    /// Mark a specific notification as read
    async fn mark_as_read(
        &self,
        notification_id: Uuid,
        user_id: Uuid,
    ) -> Result<Notification, AppError>;

    /// Mark all notifications as read for a user
    async fn mark_all_as_read(&self, user_id: Uuid) -> Result<i64, AppError>;

    /// Delete a notification (only the owner can delete)
    async fn delete_notification(
        &self,
        notification_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), AppError>;
}

/// Implementation of the NotificationService trait
pub struct NotificationServiceImpl {
    state: AppState,
}

impl NotificationServiceImpl {
    /// Create a new NotificationServiceImpl instance
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

/// Internal row type for count queries
#[derive(FromRow)]
struct CountRow {
    total: i64,
    unread: i64,
}

#[async_trait]
impl NotificationService for NotificationServiceImpl {
    async fn list_notifications(
        &self,
        user_id: Uuid,
        filters: NotificationFilters,
    ) -> Result<NotificationListResponse, AppError> {
        let page = filters.page();
        let per_page = filters.per_page();
        let offset = filters.offset();
        let unread_only = filters.unread_only.unwrap_or(false);

        // Build the WHERE clause dynamically
        let mut where_conditions = vec![
            "user_id = $1".to_string(),
            "(expires_at IS NULL OR expires_at > NOW())".to_string(),
        ];

        if unread_only {
            where_conditions.push("read_at IS NULL".to_string());
        }

        if filters.notification_type.is_some() {
            where_conditions.push("type = $2".to_string());
        }

        let where_clause = where_conditions.join(" AND ");

        // Get total and unread counts
        let count_query = format!(
            r#"
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN read_at IS NULL THEN 1 END) as unread
            FROM notifications
            WHERE {}
            "#,
            where_clause
        );

        let counts = if let Some(ref notif_type) = filters.notification_type {
            sqlx::query_as::<_, CountRow>(&count_query)
                .bind(user_id)
                .bind(notif_type)
                .fetch_optional(self.state.db.pool())
                .await?
        } else {
            sqlx::query_as::<_, CountRow>(&count_query)
                .bind(user_id)
                .fetch_optional(self.state.db.pool())
                .await?
        };

        let (total, unread) = counts.map(|c| (c.total, c.unread)).unwrap_or((0, 0));

        // Get paginated notifications
        let notifications = if let Some(ref notif_type) = filters.notification_type {
            sqlx::query_as::<_, Notification>(&format!(
                r#"
                    SELECT
                        id,
                        user_id,
                        title,
                        message,
                        type as notification_type,
                        data,
                        read_at,
                        created_at,
                        updated_at,
                        expires_at
                    FROM notifications
                    WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
                    {} {}
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                    "#,
                if unread_only {
                    "AND read_at IS NULL"
                } else {
                    ""
                },
                "AND type = $4"
            ))
            .bind(user_id)
            .bind(per_page as i64)
            .bind(offset)
            .bind(notif_type)
            .fetch_all(self.state.db.pool())
            .await?
        } else {
            sqlx::query_as::<_, Notification>(&format!(
                r#"
                    SELECT
                        id,
                        user_id,
                        title,
                        message,
                        type as notification_type,
                        data,
                        read_at,
                        created_at,
                        updated_at,
                        expires_at
                    FROM notifications
                    WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
                    {}
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                    "#,
                if unread_only {
                    "AND read_at IS NULL"
                } else {
                    ""
                }
            ))
            .bind(user_id)
            .bind(per_page as i64)
            .bind(offset)
            .fetch_all(self.state.db.pool())
            .await?
        };

        let total_pages = ((total as f64) / (per_page as f64)).ceil() as i32;

        Ok(NotificationListResponse {
            notifications,
            total,
            unread,
            page,
            per_page,
            total_pages: total_pages.max(1),
        })
    }

    async fn get_unread_count(&self, user_id: Uuid) -> Result<i64, AppError> {
        let count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!: i64"
            FROM notifications
            WHERE user_id = $1
              AND read_at IS NULL
              AND (expires_at IS NULL OR expires_at > NOW())
            "#,
            user_id,
        )
        .fetch_one(self.state.db.pool())
        .await?;

        Ok(count)
    }

    async fn create_notification(
        &self,
        data: CreateNotificationDto,
    ) -> Result<Notification, AppError> {
        let notification_type = data.notification_type.unwrap_or_else(|| "info".to_string());

        let row = sqlx::query!(
            r#"
            INSERT INTO notifications (
                user_id, title, message, type, data, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
                id,
                user_id,
                title,
                message,
                type as notification_type,
                data,
                read_at,
                created_at,
                updated_at,
                expires_at
            "#,
            data.user_id,
            &data.title,
            &data.message,
            &notification_type,
            data.data as Option<serde_json::Value>,
            data.expires_at,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to create notification: {}", e);
            AppError::Database(e)
        })?;

        let notification = Notification {
            id: row.id,
            user_id: row.user_id,
            title: row.title,
            message: row.message,
            notification_type: row.notification_type,
            data: row.data,
            read_at: row.read_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            expires_at: row.expires_at,
        };

        tracing::info!(
            notification_id = %notification.id,
            user_id = %data.user_id,
            notification_type = %notification_type,
            "Notification created"
        );

        Ok(notification)
    }

    async fn mark_as_read(
        &self,
        notification_id: Uuid,
        user_id: Uuid,
    ) -> Result<Notification, AppError> {
        let row = sqlx::query!(
            r#"
            UPDATE notifications
            SET read_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING
                id,
                user_id,
                title,
                message,
                type as notification_type,
                data,
                read_at,
                created_at,
                updated_at,
                expires_at
            "#,
            notification_id,
            user_id,
        )
        .fetch_optional(self.state.db.pool())
        .await?
        .ok_or_else(|| AppError::NotFound("Notification not found".to_string()))?;

        let notification = Notification {
            id: row.id,
            user_id: row.user_id,
            title: row.title,
            message: row.message,
            notification_type: row.notification_type,
            data: row.data,
            read_at: row.read_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            expires_at: row.expires_at,
        };

        tracing::info!(
            notification_id = %notification_id,
            user_id = %user_id,
            "Notification marked as read"
        );

        Ok(notification)
    }

    async fn mark_all_as_read(&self, user_id: Uuid) -> Result<i64, AppError> {
        let result = sqlx::query!(
            r#"
            UPDATE notifications
            SET read_at = NOW(), updated_at = NOW()
            WHERE user_id = $1 AND read_at IS NULL
            "#,
            user_id,
        )
        .execute(self.state.db.pool())
        .await?;

        let marked_count = result.rows_affected() as i64;

        tracing::info!(
            user_id = %user_id,
            marked_count = marked_count,
            "All notifications marked as read"
        );

        Ok(marked_count)
    }

    async fn delete_notification(
        &self,
        notification_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), AppError> {
        let result = sqlx::query!(
            r#"
            DELETE FROM notifications
            WHERE id = $1 AND user_id = $2
            "#,
            notification_id,
            user_id,
        )
        .execute(self.state.db.pool())
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Notification not found".to_string()));
        }

        tracing::info!(
            notification_id = %notification_id,
            user_id = %user_id,
            "Notification deleted"
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notification_filters_defaults() {
        let filters = NotificationFilters::default();
        assert_eq!(filters.page(), 1);
        assert_eq!(filters.per_page(), 20);
        assert_eq!(filters.offset(), 0);
    }

    #[test]
    fn test_notification_filters_pagination() {
        let filters = NotificationFilters {
            page: Some(3),
            per_page: Some(50),
            ..Default::default()
        };
        assert_eq!(filters.page(), 3);
        assert_eq!(filters.per_page(), 50);
        assert_eq!(filters.offset(), 100); // (3-1) * 50
    }

    #[test]
    fn test_notification_filters_bounds() {
        // Test minimum bounds
        let filters = NotificationFilters {
            page: Some(-5),
            per_page: Some(-10),
            ..Default::default()
        };
        assert_eq!(filters.page(), 1); // Should clamp to 1
        assert_eq!(filters.per_page(), 1); // Should clamp to 1

        // Test maximum bounds
        let filters = NotificationFilters {
            per_page: Some(500),
            ..Default::default()
        };
        assert_eq!(filters.per_page(), 100); // Should clamp to 100
    }

    #[test]
    fn test_create_notification_dto() {
        let dto = CreateNotificationDto {
            user_id: Uuid::new_v4(),
            title: "Test Title".to_string(),
            message: "Test Message".to_string(),
            notification_type: Some("info".to_string()),
            data: Some(serde_json::json!({"key": "value"})),
            expires_at: None,
        };

        assert_eq!(dto.title, "Test Title");
        assert_eq!(dto.message, "Test Message");
        assert!(dto.notification_type.is_some());
    }

    #[test]
    fn test_notification_list_response() {
        let response = NotificationListResponse {
            notifications: vec![],
            total: 100,
            unread: 25,
            page: 2,
            per_page: 20,
            total_pages: 5,
        };

        assert_eq!(response.total, 100);
        assert_eq!(response.unread, 25);
        assert_eq!(response.total_pages, 5);
    }
}
