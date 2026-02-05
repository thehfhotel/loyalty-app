//! Admin Authorization Middleware
//!
//! Checks if the authenticated user has admin privileges by verifying
//! their email against the configured admin list in admins.json.

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::sync::RwLock;

use crate::error::ErrorResponse;
use crate::middleware::auth::AuthUser;

/// Admin configuration loaded from admins.json
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdminConfig {
    /// List of email addresses with admin privileges
    #[serde(default)]
    pub admin_emails: Vec<String>,
    /// List of email addresses with super admin privileges
    #[serde(default)]
    pub super_admin_emails: Vec<String>,
    /// Description of the configuration
    #[serde(default)]
    pub description: String,
}

impl AdminConfig {
    /// Check if an email is in the admin list
    pub fn is_admin_email(&self, email: &str) -> bool {
        let normalized = email.to_lowercase().trim().to_string();
        self.admin_emails
            .iter()
            .any(|admin_email| admin_email.to_lowercase().trim() == normalized)
    }

    /// Check if an email is in the super admin list
    pub fn is_super_admin_email(&self, email: &str) -> bool {
        let normalized = email.to_lowercase().trim().to_string();
        self.super_admin_emails
            .iter()
            .any(|super_admin_email| super_admin_email.to_lowercase().trim() == normalized)
    }

    /// Get the required role for an email (super_admin takes precedence)
    pub fn get_required_role(&self, email: &str) -> Option<&'static str> {
        if self.is_super_admin_email(email) {
            Some("super_admin")
        } else if self.is_admin_email(email) {
            Some("admin")
        } else {
            None
        }
    }
}

/// Global admin configuration (lazily loaded)
static ADMIN_CONFIG: Lazy<RwLock<AdminConfig>> = Lazy::new(|| {
    RwLock::new(load_admin_config())
});

/// Default paths to check for admin config file
const CONFIG_PATHS: &[&str] = &[
    "/app/config/admins.json",           // Docker container path
    "./config/admins.json",               // Local development path
    "../config/admins.json",              // Alternative local path
];

/// Load admin configuration from file
fn load_admin_config() -> AdminConfig {
    // Try each config path in order
    for path_str in CONFIG_PATHS {
        let path = Path::new(path_str);
        if path.exists() {
            match load_config_from_path(path) {
                Ok(config) => {
                    tracing::info!(
                        path = %path_str,
                        admin_count = config.admin_emails.len(),
                        super_admin_count = config.super_admin_emails.len(),
                        "Admin config loaded"
                    );
                    return config;
                }
                Err(e) => {
                    tracing::warn!(
                        path = %path_str,
                        error = %e,
                        "Failed to load admin config from path"
                    );
                }
            }
        }
    }

    // Also try ADMIN_CONFIG_PATH environment variable
    if let Ok(env_path) = std::env::var("ADMIN_CONFIG_PATH") {
        let path = Path::new(&env_path);
        if path.exists() {
            match load_config_from_path(path) {
                Ok(config) => {
                    tracing::info!(
                        path = %env_path,
                        admin_count = config.admin_emails.len(),
                        super_admin_count = config.super_admin_emails.len(),
                        "Admin config loaded from ADMIN_CONFIG_PATH"
                    );
                    return config;
                }
                Err(e) => {
                    tracing::warn!(
                        path = %env_path,
                        error = %e,
                        "Failed to load admin config from ADMIN_CONFIG_PATH"
                    );
                }
            }
        }
    }

    tracing::warn!("Admin config file not found, no admin emails configured");
    AdminConfig::default()
}

/// Load configuration from a specific path
fn load_config_from_path(path: &Path) -> Result<AdminConfig, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))
}

/// Get the current admin configuration
pub fn get_admin_config() -> AdminConfig {
    ADMIN_CONFIG
        .read()
        .map(|config| config.clone())
        .unwrap_or_default()
}

/// Reload the admin configuration from file
pub fn reload_admin_config() {
    if let Ok(mut config) = ADMIN_CONFIG.write() {
        *config = load_admin_config();
        tracing::info!("Admin config reloaded");
    }
}

/// Check if a user has admin privileges
pub fn is_admin(user: &AuthUser) -> bool {
    // First check role from JWT
    if user.role == "admin" || user.role == "super_admin" {
        return true;
    }

    // Then check email against config (if email is available)
    if let Some(ref email) = user.email {
        let config = get_admin_config();
        return config.is_admin_email(email) || config.is_super_admin_email(email);
    }

    false
}

/// Check if a user has super admin privileges
pub fn is_super_admin(user: &AuthUser) -> bool {
    // First check role from JWT
    if user.role == "super_admin" {
        return true;
    }

    // Then check email against config (if email is available)
    if let Some(ref email) = user.email {
        let config = get_admin_config();
        return config.is_super_admin_email(email);
    }

    false
}

/// Admin authorization error
#[derive(Debug)]
pub enum AdminAuthError {
    NotAuthenticated,
    NotAdmin,
    NotSuperAdmin,
}

impl IntoResponse for AdminAuthError {
    fn into_response(self) -> Response {
        let (status, error, message) = match self {
            AdminAuthError::NotAuthenticated => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authentication required",
            ),
            AdminAuthError::NotAdmin => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Admin access required",
            ),
            AdminAuthError::NotSuperAdmin => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Super admin access required",
            ),
        };

        let body = Json(ErrorResponse {
            error: error.to_string(),
            message: message.to_string(),
            details: None,
        });

        (status, body).into_response()
    }
}

/// Admin authorization middleware
///
/// This middleware checks if the authenticated user has admin privileges.
/// It must be used after auth_middleware to ensure AuthUser is available.
///
/// # Usage
///
/// ```rust,ignore
/// use axum::{Router, middleware};
/// use loyalty_backend::middleware::admin::admin_middleware;
/// use loyalty_backend::middleware::auth::auth_middleware;
///
/// let admin_routes = Router::new()
///     .route("/admin", get(admin_handler))
///     .layer(middleware::from_fn(admin_middleware))
///     .layer(middleware::from_fn(auth_middleware));
/// ```
pub async fn admin_middleware(
    request: Request,
    next: Next,
) -> Result<Response, AdminAuthError> {
    // Get authenticated user from request extensions
    let auth_user = request
        .extensions()
        .get::<AuthUser>()
        .ok_or(AdminAuthError::NotAuthenticated)?;

    // Check if user has admin privileges
    if !is_admin(auth_user) {
        tracing::warn!(
            user_id = %auth_user.id,
            role = %auth_user.role,
            "Admin access denied"
        );
        return Err(AdminAuthError::NotAdmin);
    }

    tracing::debug!(
        user_id = %auth_user.id,
        role = %auth_user.role,
        "Admin access granted"
    );

    Ok(next.run(request).await)
}

/// Super admin authorization middleware
///
/// This middleware checks if the authenticated user has super admin privileges.
/// It must be used after auth_middleware to ensure AuthUser is available.
pub async fn super_admin_middleware(
    request: Request,
    next: Next,
) -> Result<Response, AdminAuthError> {
    // Get authenticated user from request extensions
    let auth_user = request
        .extensions()
        .get::<AuthUser>()
        .ok_or(AdminAuthError::NotAuthenticated)?;

    // Check if user has super admin privileges
    if !is_super_admin(auth_user) {
        tracing::warn!(
            user_id = %auth_user.id,
            role = %auth_user.role,
            "Super admin access denied"
        );
        return Err(AdminAuthError::NotSuperAdmin);
    }

    tracing::debug!(
        user_id = %auth_user.id,
        role = %auth_user.role,
        "Super admin access granted"
    );

    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> AdminConfig {
        AdminConfig {
            admin_emails: vec![
                "admin@example.com".to_string(),
                "ADMIN2@EXAMPLE.COM".to_string(),
            ],
            super_admin_emails: vec![
                "superadmin@example.com".to_string(),
            ],
            description: "Test config".to_string(),
        }
    }

    #[test]
    fn test_is_admin_email() {
        let config = create_test_config();

        // Exact match
        assert!(config.is_admin_email("admin@example.com"));

        // Case insensitive
        assert!(config.is_admin_email("ADMIN@EXAMPLE.COM"));
        assert!(config.is_admin_email("admin2@example.com"));

        // Not an admin
        assert!(!config.is_admin_email("user@example.com"));

        // Whitespace handling
        assert!(config.is_admin_email(" admin@example.com "));
    }

    #[test]
    fn test_is_super_admin_email() {
        let config = create_test_config();

        assert!(config.is_super_admin_email("superadmin@example.com"));
        assert!(config.is_super_admin_email("SUPERADMIN@EXAMPLE.COM"));
        assert!(!config.is_super_admin_email("admin@example.com"));
    }

    #[test]
    fn test_get_required_role() {
        let config = create_test_config();

        // Super admin takes precedence
        assert_eq!(config.get_required_role("superadmin@example.com"), Some("super_admin"));

        // Regular admin
        assert_eq!(config.get_required_role("admin@example.com"), Some("admin"));

        // Not in config
        assert_eq!(config.get_required_role("user@example.com"), None);
    }

    #[test]
    fn test_is_admin_by_role() {
        let admin_user = AuthUser {
            id: "user-1".to_string(),
            email: None,
            role: "admin".to_string(),
        };

        let super_admin_user = AuthUser {
            id: "user-2".to_string(),
            email: None,
            role: "super_admin".to_string(),
        };

        let customer_user = AuthUser {
            id: "user-3".to_string(),
            email: None,
            role: "customer".to_string(),
        };

        assert!(is_admin(&admin_user));
        assert!(is_admin(&super_admin_user));
        assert!(!is_admin(&customer_user));
    }

    #[test]
    fn test_is_super_admin_by_role() {
        let admin_user = AuthUser {
            id: "user-1".to_string(),
            email: None,
            role: "admin".to_string(),
        };

        let super_admin_user = AuthUser {
            id: "user-2".to_string(),
            email: None,
            role: "super_admin".to_string(),
        };

        assert!(!is_super_admin(&admin_user));
        assert!(is_super_admin(&super_admin_user));
    }

    #[test]
    fn test_default_admin_config() {
        let config = AdminConfig::default();

        assert!(config.admin_emails.is_empty());
        assert!(config.super_admin_emails.is_empty());
        assert!(!config.is_admin_email("any@example.com"));
    }

    #[test]
    fn test_admin_config_deserialize() {
        let json = r#"{
            "adminEmails": ["admin@test.com"],
            "superAdminEmails": ["super@test.com"],
            "description": "Test"
        }"#;

        let config: AdminConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.admin_emails, vec!["admin@test.com"]);
        assert_eq!(config.super_admin_emails, vec!["super@test.com"]);
        assert_eq!(config.description, "Test");
    }

    #[test]
    fn test_admin_config_deserialize_missing_fields() {
        // Should handle missing optional fields gracefully
        let json = r#"{
            "adminEmails": ["admin@test.com"]
        }"#;

        let config: AdminConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.admin_emails, vec!["admin@test.com"]);
        assert!(config.super_admin_emails.is_empty());
        assert!(config.description.is_empty());
    }
}
