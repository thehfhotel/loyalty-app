//! User Profile model and related types
//!
//! This module contains the UserProfile entity that maps to the `user_profiles`
//! table in the database. Profiles store additional user information separate
//! from authentication data.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// User profile entity representing a record in the `user_profiles` table
///
/// Stores personal information and preferences for a user.
/// Has a one-to-one relationship with the User entity.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    /// Foreign key to users table (also serves as primary key)
    pub user_id: Uuid,

    /// User's first name
    pub first_name: Option<String>,

    /// User's last name
    pub last_name: Option<String>,

    /// User's phone number
    pub phone: Option<String>,

    /// User's date of birth
    pub date_of_birth: Option<NaiveDate>,

    /// User preferences stored as JSON
    /// Example: { "language": "en", "notifications": true }
    pub preferences: Option<JsonValue>,

    /// URL to user's avatar image
    pub avatar_url: Option<String>,

    /// Timestamp when the profile was created
    pub created_at: Option<DateTime<Utc>>,

    /// Timestamp when the profile was last updated
    pub updated_at: Option<DateTime<Utc>>,

    /// Unique membership ID (8-character alphanumeric)
    /// Generated automatically during user registration
    pub membership_id: String,
}

impl UserProfile {
    /// Get the user's full name
    pub fn full_name(&self) -> Option<String> {
        match (&self.first_name, &self.last_name) {
            (Some(first), Some(last)) => Some(format!("{} {}", first, last)),
            (Some(first), None) => Some(first.clone()),
            (None, Some(last)) => Some(last.clone()),
            (None, None) => None,
        }
    }

    /// Get the user's display name (full name or membership ID)
    pub fn display_name(&self) -> String {
        self.full_name()
            .unwrap_or_else(|| format!("Member {}", self.membership_id))
    }

    /// Check if the profile is complete (has required fields)
    pub fn is_complete(&self) -> bool {
        self.first_name.is_some() && self.last_name.is_some()
    }
}

/// Request payload for creating a new user profile
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateUserProfileRequest {
    /// User's first name
    #[validate(length(min = 1, max = 100, message = "First name must be 1-100 characters"))]
    pub first_name: Option<String>,

    /// User's last name
    #[validate(length(min = 1, max = 100, message = "Last name must be 1-100 characters"))]
    pub last_name: Option<String>,

    /// User's phone number
    #[validate(length(max = 20, message = "Phone number too long"))]
    pub phone: Option<String>,

    /// User's date of birth (ISO 8601 format: YYYY-MM-DD)
    pub date_of_birth: Option<NaiveDate>,

    /// User preferences as JSON object
    pub preferences: Option<JsonValue>,

    /// URL to avatar image
    #[validate(url(message = "Invalid avatar URL"))]
    pub avatar_url: Option<String>,
}

/// Request payload for updating an existing user profile
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateUserProfileRequest {
    /// Updated first name
    #[validate(length(min = 1, max = 100, message = "First name must be 1-100 characters"))]
    pub first_name: Option<String>,

    /// Updated last name
    #[validate(length(min = 1, max = 100, message = "Last name must be 1-100 characters"))]
    pub last_name: Option<String>,

    /// Updated phone number
    #[validate(length(max = 20, message = "Phone number too long"))]
    pub phone: Option<String>,

    /// Updated date of birth
    pub date_of_birth: Option<NaiveDate>,

    /// Updated preferences (will be merged with existing)
    pub preferences: Option<JsonValue>,

    /// Updated avatar URL
    #[validate(url(message = "Invalid avatar URL"))]
    pub avatar_url: Option<String>,
}

/// Safe user profile response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileResponse {
    /// User ID
    pub user_id: Uuid,

    /// First name
    pub first_name: Option<String>,

    /// Last name
    pub last_name: Option<String>,

    /// Full name (computed)
    pub full_name: Option<String>,

    /// Phone number
    pub phone: Option<String>,

    /// Date of birth
    pub date_of_birth: Option<NaiveDate>,

    /// User preferences
    pub preferences: JsonValue,

    /// Avatar URL
    pub avatar_url: Option<String>,

    /// Membership ID
    pub membership_id: String,

    /// Profile creation timestamp
    pub created_at: DateTime<Utc>,

    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
}

impl From<UserProfile> for UserProfileResponse {
    fn from(profile: UserProfile) -> Self {
        let full_name = profile.full_name();
        UserProfileResponse {
            user_id: profile.user_id,
            first_name: profile.first_name,
            last_name: profile.last_name,
            full_name,
            phone: profile.phone,
            date_of_birth: profile.date_of_birth,
            preferences: profile.preferences.unwrap_or(serde_json::json!({})),
            avatar_url: profile.avatar_url,
            membership_id: profile.membership_id,
            created_at: profile.created_at.unwrap_or_else(Utc::now),
            updated_at: profile.updated_at.unwrap_or_else(Utc::now),
        }
    }
}

/// Minimal profile info for listings and references
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserProfileSummary {
    /// User ID
    pub user_id: Uuid,

    /// First name
    pub first_name: Option<String>,

    /// Last name
    pub last_name: Option<String>,

    /// Membership ID
    pub membership_id: String,

    /// Avatar URL
    pub avatar_url: Option<String>,
}

impl UserProfileSummary {
    /// Get the display name for this profile
    pub fn display_name(&self) -> String {
        match (&self.first_name, &self.last_name) {
            (Some(first), Some(last)) => format!("{} {}", first, last),
            (Some(first), None) => first.clone(),
            (None, Some(last)) => last.clone(),
            (None, None) => format!("Member {}", self.membership_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_full_name() {
        let profile = UserProfile {
            user_id: Uuid::new_v4(),
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            phone: None,
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            created_at: None,
            updated_at: None,
            membership_id: "ABC12345".to_string(),
        };

        assert_eq!(profile.full_name(), Some("John Doe".to_string()));
    }

    #[test]
    fn test_display_name_fallback() {
        let profile = UserProfile {
            user_id: Uuid::new_v4(),
            first_name: None,
            last_name: None,
            phone: None,
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            created_at: None,
            updated_at: None,
            membership_id: "XYZ99999".to_string(),
        };

        assert_eq!(profile.display_name(), "Member XYZ99999");
    }

    #[test]
    fn test_is_complete() {
        let mut profile = UserProfile {
            user_id: Uuid::new_v4(),
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            phone: None,
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            created_at: None,
            updated_at: None,
            membership_id: "ABC12345".to_string(),
        };

        assert!(profile.is_complete());

        profile.first_name = None;
        assert!(!profile.is_complete());
    }
}
