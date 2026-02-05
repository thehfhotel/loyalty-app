//! Application error types and handling
//!
//! This module provides a unified error handling system for the loyalty backend.
//! All errors are converted to appropriate HTTP responses with consistent JSON format.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Consistent JSON error response format
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// Machine-readable error code (e.g., "validation_error", "not_found")
    pub error: String,
    /// Human-readable error message
    pub message: String,
    /// Optional field-level error details (for validation errors)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, Vec<String>>>,
}

impl ErrorResponse {
    /// Create a new error response without details
    pub fn new(error: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            message: message.into(),
            details: None,
        }
    }

    /// Create a new error response with field-level details
    pub fn with_details(
        error: impl Into<String>,
        message: impl Into<String>,
        details: HashMap<String, Vec<String>>,
    ) -> Self {
        Self {
            error: error.into(),
            message: message.into(),
            details: Some(details),
        }
    }
}

/// Application-wide error type
#[derive(Debug, Error)]
pub enum AppError {
    // Database errors
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Database connection error: {0}")]
    DatabaseConnection(String),

    #[error("Database query error: {0}")]
    DatabaseQuery(String),

    // Redis errors
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("Redis connection error: {0}")]
    RedisConnection(String),

    #[error("Cache miss: {0}")]
    CacheMiss(String),

    // Authentication errors
    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Token expired")]
    TokenExpired,

    #[error("Invalid token: {0}")]
    InvalidToken(String),

    #[error("Missing authentication")]
    MissingAuth,

    #[error("Account locked: {0}")]
    AccountLocked(String),

    #[error("Account not verified")]
    AccountNotVerified,

    #[error("Session expired")]
    SessionExpired,

    // Authorization errors
    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Insufficient permissions: {0}")]
    InsufficientPermissions(String),

    #[error("Access denied")]
    AccessDenied,

    // Validation errors
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Validation errors")]
    ValidationWithDetails {
        message: String,
        details: HashMap<String, Vec<String>>,
    },

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    // Resource errors
    #[error("{0} not found")]
    NotFound(String),

    #[error("Resource already exists: {0}")]
    AlreadyExists(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    // Request errors
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Invalid format: {0}")]
    InvalidFormat(String),

    #[error("Payload too large")]
    PayloadTooLarge,

    #[error("Unsupported media type: {0}")]
    UnsupportedMediaType(String),

    // Rate limiting
    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Too many requests, retry after {0} seconds")]
    TooManyRequests(u64),

    // External service errors
    #[error("OAuth error: {0}")]
    OAuth(String),

    #[error("OAuth provider error: {provider}: {message}")]
    OAuthProvider { provider: String, message: String },

    #[error("SlipOK service error: {0}")]
    SlipOk(String),

    #[error("Email service error: {0}")]
    EmailService(String),

    #[error("External service unavailable: {0}")]
    ExternalServiceUnavailable(String),

    #[error("External service timeout: {0}")]
    ExternalServiceTimeout(String),

    // HTTP client errors
    #[error("HTTP request error: {0}")]
    HttpRequest(#[from] reqwest::Error),

    // Internal errors
    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    // JWT errors
    #[error("JWT error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    // Generic anyhow wrapper for unexpected errors
    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),
}

impl AppError {
    /// Get the error code for this error type
    pub fn error_code(&self) -> &'static str {
        match self {
            // Database errors
            Self::Database(_) => "database_error",
            Self::DatabaseConnection(_) => "database_connection_error",
            Self::DatabaseQuery(_) => "database_query_error",

            // Redis errors
            Self::Redis(_) => "redis_error",
            Self::RedisConnection(_) => "redis_connection_error",
            Self::CacheMiss(_) => "cache_miss",

            // Authentication errors
            Self::InvalidCredentials => "invalid_credentials",
            Self::TokenExpired => "token_expired",
            Self::InvalidToken(_) => "invalid_token",
            Self::MissingAuth => "missing_auth",
            Self::AccountLocked(_) => "account_locked",
            Self::AccountNotVerified => "account_not_verified",
            Self::SessionExpired => "session_expired",

            // Authorization errors
            Self::Unauthorized(_) => "unauthorized",
            Self::Forbidden(_) => "forbidden",
            Self::InsufficientPermissions(_) => "insufficient_permissions",
            Self::AccessDenied => "access_denied",

            // Validation errors
            Self::Validation(_) => "validation_error",
            Self::ValidationWithDetails { .. } => "validation_error",
            Self::InvalidInput(_) => "invalid_input",

            // Resource errors
            Self::NotFound(_) => "not_found",
            Self::AlreadyExists(_) => "already_exists",
            Self::Conflict(_) => "conflict",

            // Request errors
            Self::BadRequest(_) => "bad_request",
            Self::MissingField(_) => "missing_field",
            Self::InvalidFormat(_) => "invalid_format",
            Self::PayloadTooLarge => "payload_too_large",
            Self::UnsupportedMediaType(_) => "unsupported_media_type",

            // Rate limiting
            Self::RateLimitExceeded => "rate_limit_exceeded",
            Self::TooManyRequests(_) => "too_many_requests",

            // External service errors
            Self::OAuth(_) => "oauth_error",
            Self::OAuthProvider { .. } => "oauth_provider_error",
            Self::SlipOk(_) => "slipok_error",
            Self::EmailService(_) => "email_service_error",
            Self::ExternalServiceUnavailable(_) => "external_service_unavailable",
            Self::ExternalServiceTimeout(_) => "external_service_timeout",

            // HTTP client errors
            Self::HttpRequest(_) => "http_request_error",

            // Internal errors
            Self::Internal(_) => "internal_error",
            Self::Configuration(_) => "configuration_error",
            Self::Serialization(_) => "serialization_error",

            // JWT errors
            Self::Jwt(_) => "jwt_error",

            // Generic errors
            Self::Anyhow(_) => "internal_error",
        }
    }

    /// Get the HTTP status code for this error
    pub fn status_code(&self) -> StatusCode {
        match self {
            // Database errors - 500 (don't expose internal details)
            Self::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::DatabaseConnection(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::DatabaseQuery(_) => StatusCode::INTERNAL_SERVER_ERROR,

            // Redis errors
            Self::Redis(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::RedisConnection(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::CacheMiss(_) => StatusCode::NOT_FOUND,

            // Authentication errors - 401
            Self::InvalidCredentials => StatusCode::UNAUTHORIZED,
            Self::TokenExpired => StatusCode::UNAUTHORIZED,
            Self::InvalidToken(_) => StatusCode::UNAUTHORIZED,
            Self::MissingAuth => StatusCode::UNAUTHORIZED,
            Self::AccountLocked(_) => StatusCode::UNAUTHORIZED,
            Self::AccountNotVerified => StatusCode::UNAUTHORIZED,
            Self::SessionExpired => StatusCode::UNAUTHORIZED,

            // Authorization errors - 401/403
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::InsufficientPermissions(_) => StatusCode::FORBIDDEN,
            Self::AccessDenied => StatusCode::FORBIDDEN,

            // Validation errors - 400/422
            Self::Validation(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::ValidationWithDetails { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            Self::InvalidInput(_) => StatusCode::BAD_REQUEST,

            // Resource errors
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::AlreadyExists(_) => StatusCode::CONFLICT,
            Self::Conflict(_) => StatusCode::CONFLICT,

            // Request errors - 400
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::MissingField(_) => StatusCode::BAD_REQUEST,
            Self::InvalidFormat(_) => StatusCode::BAD_REQUEST,
            Self::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UnsupportedMediaType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,

            // Rate limiting - 429
            Self::RateLimitExceeded => StatusCode::TOO_MANY_REQUESTS,
            Self::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,

            // External service errors - 502/503/504
            Self::OAuth(_) => StatusCode::BAD_GATEWAY,
            Self::OAuthProvider { .. } => StatusCode::BAD_GATEWAY,
            Self::SlipOk(_) => StatusCode::BAD_GATEWAY,
            Self::EmailService(_) => StatusCode::BAD_GATEWAY,
            Self::ExternalServiceUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::ExternalServiceTimeout(_) => StatusCode::GATEWAY_TIMEOUT,

            // HTTP client errors
            Self::HttpRequest(_) => StatusCode::BAD_GATEWAY,

            // Internal errors - 500
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Configuration(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Serialization(_) => StatusCode::INTERNAL_SERVER_ERROR,

            // JWT errors - typically 401
            Self::Jwt(_) => StatusCode::UNAUTHORIZED,

            // Generic errors - 500
            Self::Anyhow(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// Create a user-facing message (hides internal details for security)
    pub fn user_message(&self) -> String {
        match self {
            // Hide internal database/redis details
            Self::Database(_) => "A database error occurred".to_string(),
            Self::DatabaseConnection(_) => "Database is temporarily unavailable".to_string(),
            Self::DatabaseQuery(_) => "A database error occurred".to_string(),
            Self::Redis(_) => "A cache error occurred".to_string(),
            Self::RedisConnection(_) => "Cache service is temporarily unavailable".to_string(),

            // Authentication - safe to expose
            Self::InvalidCredentials => "Invalid email or password".to_string(),
            Self::TokenExpired => "Your session has expired, please log in again".to_string(),
            Self::InvalidToken(_) => "Invalid authentication token".to_string(),
            Self::MissingAuth => "Authentication required".to_string(),
            Self::AccountLocked(reason) => format!("Account locked: {}", reason),
            Self::AccountNotVerified => "Please verify your email address".to_string(),
            Self::SessionExpired => "Your session has expired, please log in again".to_string(),

            // Authorization - safe to expose
            Self::Unauthorized(msg) => msg.clone(),
            Self::Forbidden(msg) => msg.clone(),
            Self::InsufficientPermissions(msg) => msg.clone(),
            Self::AccessDenied => "You don't have access to this resource".to_string(),

            // Validation - safe to expose
            Self::Validation(msg) => msg.clone(),
            Self::ValidationWithDetails { message, .. } => message.clone(),
            Self::InvalidInput(msg) => msg.clone(),

            // Resource errors - safe to expose
            Self::NotFound(resource) => format!("{} not found", resource),
            Self::AlreadyExists(msg) => msg.clone(),
            Self::Conflict(msg) => msg.clone(),

            // Request errors - safe to expose
            Self::BadRequest(msg) => msg.clone(),
            Self::MissingField(field) => format!("Missing required field: {}", field),
            Self::InvalidFormat(msg) => msg.clone(),
            Self::PayloadTooLarge => "Request payload is too large".to_string(),
            Self::UnsupportedMediaType(media_type) => {
                format!("Unsupported media type: {}", media_type)
            },

            // Rate limiting - safe to expose
            Self::RateLimitExceeded => "Too many requests, please try again later".to_string(),
            Self::TooManyRequests(seconds) => {
                format!("Too many requests, please retry after {} seconds", seconds)
            },

            // External services - hide details
            Self::OAuth(_) => "Authentication service error".to_string(),
            Self::OAuthProvider { provider, .. } => {
                format!("Error connecting to {} authentication", provider)
            },
            Self::SlipOk(_) => "Payment verification service error".to_string(),
            Self::EmailService(_) => "Email service temporarily unavailable".to_string(),
            Self::ExternalServiceUnavailable(service) => {
                format!("{} is temporarily unavailable", service)
            },
            Self::ExternalServiceTimeout(service) => {
                format!("{} request timed out", service)
            },

            // HTTP client errors - hide details
            Self::HttpRequest(_) => "External service error".to_string(),

            // Internal errors - hide details
            Self::Internal(_) => "An internal error occurred".to_string(),
            Self::Configuration(_) => "Server configuration error".to_string(),
            Self::Serialization(_) => "Data processing error".to_string(),

            // JWT errors
            Self::Jwt(_) => "Invalid authentication token".to_string(),

            // Generic errors - hide details
            Self::Anyhow(_) => "An unexpected error occurred".to_string(),

            // Cache miss is somewhat safe
            Self::CacheMiss(key) => format!("Cache key not found: {}", key),
        }
    }

    /// Log the full error details (for server-side logging)
    pub fn log_message(&self) -> String {
        format!("{}", self)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Log the error for debugging (full details)
        tracing::error!(
            error_code = self.error_code(),
            status = %self.status_code(),
            details = %self.log_message(),
            "Request error"
        );

        let status = self.status_code();
        let error_code = self.error_code().to_string();
        let message = self.user_message();

        // Build the response based on error type
        let body = match &self {
            AppError::ValidationWithDetails { details, .. } => {
                ErrorResponse::with_details(error_code, message, details.clone())
            },
            _ => ErrorResponse::new(error_code, message),
        };

        (status, Json(body)).into_response()
    }
}

/// Result type alias using AppError
pub type AppResult<T> = Result<T, AppError>;

/// Helper trait for converting Option to AppError::NotFound
pub trait OptionExt<T> {
    fn ok_or_not_found(self, resource: impl Into<String>) -> AppResult<T>;
}

impl<T> OptionExt<T> for Option<T> {
    fn ok_or_not_found(self, resource: impl Into<String>) -> AppResult<T> {
        self.ok_or_else(|| AppError::NotFound(resource.into()))
    }
}

/// Conversion from validator errors
impl From<validator::ValidationErrors> for AppError {
    fn from(errors: validator::ValidationErrors) -> Self {
        let mut details: HashMap<String, Vec<String>> = HashMap::new();

        for (field, field_errors) in errors.field_errors() {
            let messages: Vec<String> = field_errors
                .iter()
                .map(|e| {
                    e.message
                        .clone()
                        .map(|m| m.to_string())
                        .unwrap_or_else(|| format!("Invalid value for {}", field))
                })
                .collect();
            details.insert(field.to_string(), messages);
        }

        AppError::ValidationWithDetails {
            message: "Validation failed".to_string(),
            details,
        }
    }
}

/// Conversion from serde_json errors
impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Serialization(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_response_new() {
        let response = ErrorResponse::new("test_error", "Test message");
        assert_eq!(response.error, "test_error");
        assert_eq!(response.message, "Test message");
        assert!(response.details.is_none());
    }

    #[test]
    fn test_error_response_with_details() {
        let mut details = HashMap::new();
        details.insert(
            "email".to_string(),
            vec!["Invalid email format".to_string()],
        );

        let response =
            ErrorResponse::with_details("validation_error", "Validation failed", details);
        assert_eq!(response.error, "validation_error");
        assert!(response.details.is_some());
        assert!(response.details.unwrap().contains_key("email"));
    }

    #[test]
    fn test_app_error_status_codes() {
        assert_eq!(
            AppError::InvalidCredentials.status_code(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            AppError::Forbidden("test".to_string()).status_code(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            AppError::NotFound("User".to_string()).status_code(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            AppError::BadRequest("test".to_string()).status_code(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            AppError::RateLimitExceeded.status_code(),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            AppError::Internal("test".to_string()).status_code(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_app_error_codes() {
        assert_eq!(
            AppError::InvalidCredentials.error_code(),
            "invalid_credentials"
        );
        assert_eq!(AppError::TokenExpired.error_code(), "token_expired");
        assert_eq!(
            AppError::NotFound("test".to_string()).error_code(),
            "not_found"
        );
        assert_eq!(
            AppError::RateLimitExceeded.error_code(),
            "rate_limit_exceeded"
        );
    }

    #[test]
    fn test_user_message_hides_internal_details() {
        // Internal errors should not expose details
        let db_error = AppError::Internal("SQL syntax error at line 42".to_string());
        assert_eq!(db_error.user_message(), "An internal error occurred");

        // User-facing errors should show the message
        let not_found = AppError::NotFound("User".to_string());
        assert_eq!(not_found.user_message(), "User not found");
    }

    #[test]
    fn test_option_ext_ok_or_not_found() {
        let some_value: Option<i32> = Some(42);
        assert!(some_value.ok_or_not_found("Value").is_ok());

        let none_value: Option<i32> = None;
        let result = none_value.ok_or_not_found("Value");
        assert!(result.is_err());

        if let Err(AppError::NotFound(msg)) = result {
            assert_eq!(msg, "Value");
        } else {
            panic!("Expected NotFound error");
        }
    }
}
