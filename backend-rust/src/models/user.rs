//! User model and related types
//!
//! This module contains the User entity that maps to the `users` table
//! in the database, along with related DTOs for API operations.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// User role enumeration matching the PostgreSQL enum `user_role`
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "user_role", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    /// Regular customer user
    #[default]
    Customer,
    /// Administrative user with elevated permissions
    Admin,
    /// Super administrator with full system access
    SuperAdmin,
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserRole::Customer => write!(f, "customer"),
            UserRole::Admin => write!(f, "admin"),
            UserRole::SuperAdmin => write!(f, "super_admin"),
        }
    }
}

/// User entity representing a record in the `users` table
///
/// This is the core authentication and identity entity. Each user
/// can have an associated profile, loyalty record, and various
/// relationships to other entities in the system.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    /// Unique identifier (UUID v4)
    pub id: Uuid,

    /// User's email address (unique, used for authentication)
    /// Optional for OAuth-only users
    pub email: Option<String>,

    /// Argon2 hashed password
    /// Optional for OAuth-only users
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,

    /// User's role determining permissions
    pub role: Option<UserRole>,

    /// Whether the user account is active
    pub is_active: Option<bool>,

    /// Whether the email address has been verified
    pub email_verified: Option<bool>,

    /// Timestamp when the user was created
    pub created_at: Option<DateTime<Utc>>,

    /// Timestamp when the user was last updated
    pub updated_at: Option<DateTime<Utc>>,

    /// OAuth provider name (e.g., "google", "facebook")
    pub oauth_provider: Option<String>,

    /// OAuth provider's user ID
    pub oauth_provider_id: Option<String>,
}

impl User {
    /// Check if the user has admin privileges
    pub fn is_admin(&self) -> bool {
        matches!(
            self.role,
            Some(UserRole::Admin) | Some(UserRole::SuperAdmin)
        )
    }

    /// Check if the user is a super admin
    pub fn is_super_admin(&self) -> bool {
        matches!(self.role, Some(UserRole::SuperAdmin))
    }

    /// Check if the user account is active and verified
    pub fn is_active_and_verified(&self) -> bool {
        self.is_active.unwrap_or(false) && self.email_verified.unwrap_or(false)
    }
}

/// Request payload for creating a new user
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateUserRequest {
    /// User's email address
    #[validate(email(message = "Invalid email format"))]
    pub email: String,

    /// User's password (will be hashed before storage)
    #[validate(length(min = 8, message = "Password must be at least 8 characters"))]
    pub password: String,

    /// Optional role assignment (defaults to Customer)
    pub role: Option<UserRole>,
}

/// Request payload for updating an existing user
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateUserRequest {
    /// New email address (optional)
    #[validate(email(message = "Invalid email format"))]
    pub email: Option<String>,

    /// New password (optional, will be hashed)
    #[validate(length(min = 8, message = "Password must be at least 8 characters"))]
    pub password: Option<String>,

    /// Update role (admin only)
    pub role: Option<UserRole>,

    /// Update active status (admin only)
    pub is_active: Option<bool>,
}

/// Safe user response DTO (excludes sensitive fields like password_hash)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserResponse {
    /// Unique identifier
    pub id: Uuid,

    /// User's email address
    pub email: Option<String>,

    /// User's role
    pub role: UserRole,

    /// Whether the account is active
    pub is_active: bool,

    /// Whether email is verified
    pub email_verified: bool,

    /// OAuth provider (if applicable)
    pub oauth_provider: Option<String>,

    /// Account creation timestamp
    pub created_at: DateTime<Utc>,

    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        UserResponse {
            id: user.id,
            email: user.email,
            role: user.role.unwrap_or_default(),
            is_active: user.is_active.unwrap_or(true),
            email_verified: user.email_verified.unwrap_or(false),
            oauth_provider: user.oauth_provider,
            created_at: user.created_at.unwrap_or_else(Utc::now),
            updated_at: user.updated_at.unwrap_or_else(Utc::now),
        }
    }
}

/// User with associated profile data (for joined queries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserWithProfile {
    /// User entity
    #[serde(flatten)]
    pub user: UserResponse,

    /// User's profile information
    pub profile: Option<super::user_profile::UserProfileResponse>,
}

/// Minimal user info for references in other entities
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserSummary {
    /// User ID
    pub id: Uuid,

    /// User's email
    pub email: Option<String>,

    /// User's role
    pub role: Option<UserRole>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_role_default() {
        assert_eq!(UserRole::default(), UserRole::Customer);
    }

    #[test]
    fn test_user_is_admin() {
        let mut user = User {
            id: Uuid::new_v4(),
            email: Some("test@example.com".to_string()),
            password_hash: None,
            role: Some(UserRole::Admin),
            is_active: Some(true),
            email_verified: Some(true),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
            oauth_provider: None,
            oauth_provider_id: None,
        };

        assert!(user.is_admin());
        assert!(!user.is_super_admin());

        user.role = Some(UserRole::SuperAdmin);
        assert!(user.is_admin());
        assert!(user.is_super_admin());

        user.role = Some(UserRole::Customer);
        assert!(!user.is_admin());
    }
}
