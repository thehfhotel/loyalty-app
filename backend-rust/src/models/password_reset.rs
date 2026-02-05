//! Password reset models
//!
//! Contains structs for password reset tokens and email verification tokens.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Password reset token database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PasswordResetToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub used: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
}

/// Email verification token database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct EmailVerificationToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub new_email: String,
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub used: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
}

/// Request password reset DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestPasswordResetRequest {
    pub email: String,
}

/// Reset password DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
    pub confirm_password: String,
}

/// Request email verification DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestEmailVerificationRequest {
    pub new_email: String,
}

/// Verify email DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyEmailRequest {
    pub code: String,
}

/// Password reset response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordResetResponse {
    pub success: bool,
    pub message: String,
}

/// Email verification response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailVerificationResponse {
    pub success: bool,
    pub message: String,
    pub new_email: Option<String>,
}

impl PasswordResetToken {
    /// Check if the token has expired
    pub fn is_expired(&self) -> bool {
        self.expires_at < Utc::now()
    }

    /// Check if the token has been used
    pub fn is_used(&self) -> bool {
        self.used.unwrap_or(false)
    }

    /// Check if the token is valid (not expired and not used)
    pub fn is_valid(&self) -> bool {
        !self.is_expired() && !self.is_used()
    }
}

impl EmailVerificationToken {
    /// Check if the token has expired
    pub fn is_expired(&self) -> bool {
        self.expires_at < Utc::now()
    }

    /// Check if the token has been used
    pub fn is_used(&self) -> bool {
        self.used.unwrap_or(false)
    }

    /// Check if the token is valid (not expired and not used)
    pub fn is_valid(&self) -> bool {
        !self.is_expired() && !self.is_used()
    }
}
