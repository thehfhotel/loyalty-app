//! Notification models
//!
//! Contains structs for the notification center and user notification preferences.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use uuid::Uuid;

/// Notification type enum
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "notification_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    #[default]
    Info,
    Success,
    Warning,
    Error,
    System,
    Reward,
    Coupon,
    Survey,
    Profile,
    TierChange,
    Points,
}

/// Notification database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    #[sqlx(rename = "type")]
    pub notification_type: String,
    pub data: Option<serde_json::Value>,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Notification preference database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct NotificationPreference {
    pub id: Uuid,
    pub user_id: Uuid,
    #[sqlx(rename = "type")]
    pub notification_type: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Create notification request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNotificationRequest {
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    pub notification_type: Option<NotificationType>,
    pub data: Option<serde_json::Value>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Update notification request DTO (mainly for marking as read)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNotificationRequest {
    pub read_at: Option<DateTime<Utc>>,
}

/// Notification response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub message: String,
    pub notification_type: String,
    pub data: Option<serde_json::Value>,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub is_read: bool,
}

/// Update notification preference request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNotificationPreferenceRequest {
    pub notification_type: String,
    pub enabled: bool,
}

/// Notification preference response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPreferenceResponse {
    pub id: Uuid,
    pub notification_type: String,
    pub enabled: bool,
}

/// Notification count response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationCountResponse {
    pub total: i64,
    pub unread: i64,
}

/// Paginated notifications response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedNotificationsResponse {
    pub notifications: Vec<NotificationResponse>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
    pub total_pages: i32,
}

impl From<Notification> for NotificationResponse {
    fn from(notification: Notification) -> Self {
        let is_read = notification.read_at.is_some();
        Self {
            id: notification.id,
            user_id: notification.user_id,
            title: notification.title,
            message: notification.message,
            notification_type: notification.notification_type,
            data: notification.data,
            read_at: notification.read_at,
            created_at: notification.created_at,
            expires_at: notification.expires_at,
            is_read,
        }
    }
}

impl From<NotificationPreference> for NotificationPreferenceResponse {
    fn from(pref: NotificationPreference) -> Self {
        Self {
            id: pref.id,
            notification_type: pref.notification_type,
            enabled: pref.enabled,
        }
    }
}

impl Notification {
    /// Check if the notification is read
    pub fn is_read(&self) -> bool {
        self.read_at.is_some()
    }

    /// Check if the notification has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            return expires_at < Utc::now();
        }
        false
    }
}
