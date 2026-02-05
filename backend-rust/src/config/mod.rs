//! Configuration management module
//!
//! Handles loading and validating application configuration from environment variables.
//! Uses the `config` crate with `dotenvy` for .env file support.

use config::{ConfigError, Environment as ConfigEnvironment, File};
use serde::Deserialize;
use std::env;
use thiserror::Error;

/// Configuration errors
#[derive(Error, Debug)]
pub enum ConfigurationError {
    #[error("Configuration loading error: {0}")]
    LoadError(#[from] ConfigError),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Invalid value for {field}: {message}")]
    InvalidValue { field: String, message: String },
}

/// Environment types
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    #[default]
    Development,
    Staging,
    Production,
}

impl Environment {
    pub fn as_str(&self) -> &'static str {
        match self {
            Environment::Development => "development",
            Environment::Staging => "staging",
            Environment::Production => "production",
        }
    }
}

impl std::fmt::Display for Environment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl From<String> for Environment {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "production" => Environment::Production,
            "staging" => Environment::Staging,
            _ => Environment::Development,
        }
    }
}

/// Database configuration
#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    /// PostgreSQL connection URL
    #[serde(default = "default_database_url")]
    pub url: String,

    /// Maximum number of connections in the pool
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,

    /// Minimum number of connections in the pool
    #[serde(default = "default_min_connections")]
    pub min_connections: u32,

    /// Connection timeout in seconds
    #[serde(default = "default_connection_timeout")]
    pub connection_timeout_secs: u64,
}

fn default_database_url() -> String {
    "postgresql://localhost:5432/loyalty_db".to_string()
}

fn default_max_connections() -> u32 {
    10
}

fn default_min_connections() -> u32 {
    1
}

fn default_connection_timeout() -> u64 {
    30
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: default_database_url(),
            max_connections: default_max_connections(),
            min_connections: default_min_connections(),
            connection_timeout_secs: default_connection_timeout(),
        }
    }
}

/// Redis configuration
#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    /// Redis connection URL
    #[serde(default = "default_redis_url")]
    pub url: String,

    /// Connection pool size
    #[serde(default = "default_redis_pool_size")]
    pub pool_size: u32,
}

fn default_redis_url() -> String {
    "redis://localhost:6379".to_string()
}

fn default_redis_pool_size() -> u32 {
    5
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: default_redis_url(),
            pool_size: default_redis_pool_size(),
        }
    }
}

/// Authentication configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    /// JWT secret for signing access tokens
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,

    /// JWT secret for signing refresh tokens
    #[serde(default = "default_jwt_refresh_secret")]
    pub jwt_refresh_secret: String,

    /// Session secret for cookie signing
    #[serde(default = "default_session_secret")]
    pub session_secret: String,

    /// Access token expiration in seconds (default: 15 minutes)
    #[serde(default = "default_access_token_expiry")]
    pub access_token_expiry_secs: u64,

    /// Refresh token expiration in seconds (default: 7 days)
    #[serde(default = "default_refresh_token_expiry")]
    pub refresh_token_expiry_secs: u64,
}

fn default_jwt_secret() -> String {
    "development-jwt-secret-change-in-production".to_string()
}

fn default_jwt_refresh_secret() -> String {
    "development-jwt-refresh-secret-change-in-production".to_string()
}

fn default_session_secret() -> String {
    "development-session-secret-change-in-production".to_string()
}

fn default_access_token_expiry() -> u64 {
    900 // 15 minutes
}

fn default_refresh_token_expiry() -> u64 {
    604800 // 7 days
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            jwt_secret: default_jwt_secret(),
            jwt_refresh_secret: default_jwt_refresh_secret(),
            session_secret: default_session_secret(),
            access_token_expiry_secs: default_access_token_expiry(),
            refresh_token_expiry_secs: default_refresh_token_expiry(),
        }
    }
}

/// Google OAuth configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct GoogleOAuthConfig {
    /// Google OAuth client ID
    pub client_id: Option<String>,

    /// Google OAuth client secret
    pub client_secret: Option<String>,

    /// Google OAuth callback URL
    #[serde(default = "default_google_callback_url")]
    pub callback_url: String,
}

fn default_google_callback_url() -> String {
    "http://localhost:4001/api/oauth/google/callback".to_string()
}

impl GoogleOAuthConfig {
    pub fn is_configured(&self) -> bool {
        self.client_id.is_some() && self.client_secret.is_some()
    }
}

/// LINE OAuth configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LineOAuthConfig {
    /// LINE channel ID
    pub client_id: Option<String>,

    /// LINE channel secret
    pub client_secret: Option<String>,

    /// LINE OAuth callback URL
    #[serde(default = "default_line_callback_url")]
    pub callback_url: String,
}

fn default_line_callback_url() -> String {
    "http://localhost:4001/api/oauth/line/callback".to_string()
}

impl LineOAuthConfig {
    pub fn is_configured(&self) -> bool {
        self.client_id.is_some() && self.client_secret.is_some()
    }
}

/// Combined OAuth configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OAuthConfig {
    pub google: GoogleOAuthConfig,
    pub line: LineOAuthConfig,
}

/// SMTP email configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SmtpConfig {
    /// SMTP server host
    pub host: Option<String>,

    /// SMTP server port
    #[serde(default = "default_smtp_port")]
    pub port: u16,

    /// SMTP username
    pub user: Option<String>,

    /// SMTP password
    pub pass: Option<String>,

    /// Use TLS for SMTP connection
    #[serde(default = "default_smtp_tls")]
    pub use_tls: bool,
}

fn default_smtp_port() -> u16 {
    587
}

fn default_smtp_tls() -> bool {
    true
}

impl SmtpConfig {
    pub fn is_configured(&self) -> bool {
        self.host.is_some() && self.user.is_some() && self.pass.is_some()
    }
}

/// IMAP email configuration (for receiving emails)
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ImapConfig {
    /// IMAP server host
    pub host: Option<String>,

    /// IMAP server port
    #[serde(default = "default_imap_port")]
    pub port: u16,

    /// IMAP username
    pub user: Option<String>,

    /// IMAP password
    pub pass: Option<String>,

    /// Use TLS for IMAP connection
    #[serde(default = "default_imap_tls")]
    pub use_tls: bool,
}

fn default_imap_port() -> u16 {
    993
}

fn default_imap_tls() -> bool {
    true
}

impl ImapConfig {
    pub fn is_configured(&self) -> bool {
        self.host.is_some() && self.user.is_some() && self.pass.is_some()
    }
}

/// Combined email configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct EmailConfig {
    pub smtp: SmtpConfig,
    pub imap: ImapConfig,
}

/// SlipOK payment integration configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SlipokConfig {
    /// SlipOK branch ID
    pub branch_id: Option<String>,

    /// SlipOK API key
    pub api_key: Option<String>,
}

impl SlipokConfig {
    pub fn is_configured(&self) -> bool {
        self.branch_id.is_some() && self.api_key.is_some()
    }
}

/// Server configuration
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    /// Server port
    #[serde(default = "default_port")]
    pub port: u16,

    /// Server host
    #[serde(default = "default_host")]
    pub host: String,

    /// Frontend URL for CORS
    #[serde(default = "default_frontend_url")]
    pub frontend_url: String,

    /// Log level
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_port() -> u16 {
    4001
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_frontend_url() -> String {
    "http://localhost:4001".to_string()
}

fn default_log_level() -> String {
    "info".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            host: default_host(),
            frontend_url: default_frontend_url(),
            log_level: default_log_level(),
        }
    }
}

/// Security configuration
#[derive(Debug, Clone, Deserialize)]
pub struct SecurityConfig {
    /// Maximum file upload size in bytes
    #[serde(default = "default_max_file_size")]
    pub max_file_size: usize,

    /// Rate limit window in milliseconds
    #[serde(default = "default_rate_limit_window")]
    pub rate_limit_window_ms: u64,

    /// Maximum requests per rate limit window
    #[serde(default = "default_rate_limit_max")]
    pub rate_limit_max_requests: u32,
}

fn default_max_file_size() -> usize {
    5_242_880 // 5MB
}

fn default_rate_limit_window() -> u64 {
    900_000 // 15 minutes
}

fn default_rate_limit_max() -> u32 {
    10_000
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            max_file_size: default_max_file_size(),
            rate_limit_window_ms: default_rate_limit_window(),
            rate_limit_max_requests: default_rate_limit_max(),
        }
    }
}

/// Main application settings
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Settings {
    /// Application environment
    #[serde(default)]
    pub environment: Environment,

    /// Server configuration
    #[serde(default)]
    pub server: ServerConfig,

    /// Database configuration
    #[serde(default)]
    pub database: DatabaseConfig,

    /// Redis configuration
    #[serde(default)]
    pub redis: RedisConfig,

    /// Authentication configuration
    #[serde(default)]
    pub auth: AuthConfig,

    /// OAuth providers configuration
    #[serde(default)]
    pub oauth: OAuthConfig,

    /// Email configuration
    #[serde(default)]
    pub email: EmailConfig,

    /// SlipOK payment configuration
    #[serde(default)]
    pub slipok: SlipokConfig,

    /// Security configuration
    #[serde(default)]
    pub security: SecurityConfig,
}

impl Settings {
    /// Load settings from environment variables and optional config files
    pub fn new() -> Result<Self, ConfigurationError> {
        // Load .env file if present (ignore errors if not found)
        let _ = dotenvy::dotenv();

        // Build configuration
        let settings = config::Config::builder()
            // Start with defaults
            .set_default("environment", "development")?
            .set_default("server.port", 4001)?
            .set_default("server.host", "0.0.0.0")?
            .set_default("server.frontend_url", "http://localhost:4001")?
            .set_default("server.log_level", "info")?
            .set_default("database.url", "postgresql://localhost:5432/loyalty_db")?
            .set_default("database.max_connections", 10)?
            .set_default("database.min_connections", 1)?
            .set_default("database.connection_timeout_secs", 30)?
            .set_default("redis.url", "redis://localhost:6379")?
            .set_default("redis.pool_size", 5)?
            .set_default("auth.access_token_expiry_secs", 900)?
            .set_default("auth.refresh_token_expiry_secs", 604800)?
            .set_default("email.smtp.port", 587)?
            .set_default("email.smtp.use_tls", true)?
            .set_default("email.imap.port", 993)?
            .set_default("email.imap.use_tls", true)?
            .set_default("security.max_file_size", 5_242_880)?
            .set_default("security.rate_limit_window_ms", 900_000)?
            .set_default("security.rate_limit_max_requests", 10_000)?
            // Load from config file if present
            .add_source(File::with_name("config/default").required(false))
            .add_source(File::with_name("config/local").required(false))
            // Load from environment variables with prefix mapping
            .add_source(
                ConfigEnvironment::default()
                    .separator("__")
                    // Map flat env vars to nested structure
                    .try_parsing(true),
            )
            // Manual overrides from specific environment variables
            .set_override_option(
                "environment",
                env::var("RUST_ENV")
                    .or_else(|_| env::var("NODE_ENV"))
                    .ok(),
            )?
            .set_override_option("server.port", env::var("PORT").ok())?
            .set_override_option("server.frontend_url", env::var("FRONTEND_URL").ok())?
            .set_override_option("server.log_level", env::var("LOG_LEVEL").ok())?
            .set_override_option("database.url", env::var("DATABASE_URL").ok())?
            .set_override_option("redis.url", env::var("REDIS_URL").ok())?
            .set_override_option("auth.jwt_secret", env::var("JWT_SECRET").ok())?
            .set_override_option("auth.jwt_refresh_secret", env::var("JWT_REFRESH_SECRET").ok())?
            .set_override_option("auth.session_secret", env::var("SESSION_SECRET").ok())?
            .set_override_option("oauth.google.client_id", env::var("GOOGLE_CLIENT_ID").ok())?
            .set_override_option(
                "oauth.google.client_secret",
                env::var("GOOGLE_CLIENT_SECRET").ok(),
            )?
            .set_override_option(
                "oauth.google.callback_url",
                env::var("GOOGLE_CALLBACK_URL").ok(),
            )?
            .set_override_option("oauth.line.client_id", env::var("LINE_CLIENT_ID").ok())?
            .set_override_option(
                "oauth.line.client_secret",
                env::var("LINE_CLIENT_SECRET").ok(),
            )?
            .set_override_option(
                "oauth.line.callback_url",
                env::var("LINE_CALLBACK_URL").ok(),
            )?
            .set_override_option("email.smtp.host", env::var("SMTP_HOST").ok())?
            .set_override_option("email.smtp.port", env::var("SMTP_PORT").ok())?
            .set_override_option("email.smtp.user", env::var("SMTP_USER").ok())?
            .set_override_option("email.smtp.pass", env::var("SMTP_PASS").ok())?
            .set_override_option("email.imap.host", env::var("IMAP_HOST").ok())?
            .set_override_option("email.imap.port", env::var("IMAP_PORT").ok())?
            .set_override_option("email.imap.user", env::var("IMAP_USER").ok())?
            .set_override_option("email.imap.pass", env::var("IMAP_PASS").ok())?
            .set_override_option("slipok.branch_id", env::var("SLIPOK_BRANCH_ID").ok())?
            .set_override_option("slipok.api_key", env::var("SLIPOK_API_KEY").ok())?
            .set_override_option("security.max_file_size", env::var("MAX_FILE_SIZE").ok())?
            .set_override_option(
                "security.rate_limit_window_ms",
                env::var("RATE_LIMIT_WINDOW_MS").ok(),
            )?
            .set_override_option(
                "security.rate_limit_max_requests",
                env::var("RATE_LIMIT_MAX_REQUESTS").ok(),
            )?
            .build()?;

        let settings: Settings = settings.try_deserialize()?;

        // Validate the settings
        settings.validate()?;

        Ok(settings)
    }

    /// Validate the configuration
    fn validate(&self) -> Result<(), ConfigurationError> {
        let mut errors: Vec<String> = Vec::new();

        // In production, enforce strict secret requirements
        if self.environment == Environment::Production {
            // JWT secret must be at least 64 characters
            if self.auth.jwt_secret.len() < 64 {
                errors.push(format!(
                    "JWT_SECRET must be at least 64 characters in production (got {})",
                    self.auth.jwt_secret.len()
                ));
            }

            // JWT refresh secret must be at least 64 characters
            if self.auth.jwt_refresh_secret.len() < 64 {
                errors.push(format!(
                    "JWT_REFRESH_SECRET must be at least 64 characters in production (got {})",
                    self.auth.jwt_refresh_secret.len()
                ));
            }

            // Session secret must be at least 64 characters
            if self.auth.session_secret.len() < 64 {
                errors.push(format!(
                    "SESSION_SECRET must be at least 64 characters in production (got {})",
                    self.auth.session_secret.len()
                ));
            }

            // Check for default/weak secrets
            let weak_secrets = [
                "development-jwt-secret-change-in-production",
                "development-jwt-refresh-secret-change-in-production",
                "development-session-secret-change-in-production",
                "your-secret-key",
                "your-refresh-secret",
                "default-secret",
                "changeme",
                "secret",
                "123456",
            ];

            if weak_secrets.contains(&self.auth.jwt_secret.as_str()) {
                errors.push("JWT_SECRET appears to be a default value".to_string());
            }
            if weak_secrets.contains(&self.auth.jwt_refresh_secret.as_str()) {
                errors.push("JWT_REFRESH_SECRET appears to be a default value".to_string());
            }
            if weak_secrets.contains(&self.auth.session_secret.as_str()) {
                errors.push("SESSION_SECRET appears to be a default value".to_string());
            }

            // Warn about localhost database in production
            if self.database.url.contains("localhost") {
                errors.push(
                    "Production environment should not use localhost database".to_string(),
                );
            }
        } else {
            // In development/staging, just validate minimum requirements
            if self.auth.jwt_secret.len() < 32 {
                errors.push(format!(
                    "JWT_SECRET must be at least 32 characters (got {})",
                    self.auth.jwt_secret.len()
                ));
            }
            if self.auth.jwt_refresh_secret.len() < 32 {
                errors.push(format!(
                    "JWT_REFRESH_SECRET must be at least 32 characters (got {})",
                    self.auth.jwt_refresh_secret.len()
                ));
            }
        }

        // Validate port range
        if self.server.port == 0 {
            errors.push("Server port cannot be 0".to_string());
        }

        // Validate database URL format
        if !self.database.url.starts_with("postgresql://")
            && !self.database.url.starts_with("postgres://")
        {
            errors.push("DATABASE_URL must be a valid PostgreSQL connection string".to_string());
        }

        // Validate Redis URL format
        if !self.redis.url.starts_with("redis://") && !self.redis.url.starts_with("rediss://") {
            errors.push("REDIS_URL must be a valid Redis connection string".to_string());
        }

        if !errors.is_empty() {
            return Err(ConfigurationError::ValidationError(errors.join("; ")));
        }

        Ok(())
    }

    /// Check if running in production
    pub fn is_production(&self) -> bool {
        self.environment == Environment::Production
    }

    /// Check if running in development
    pub fn is_development(&self) -> bool {
        self.environment == Environment::Development
    }

    /// Check if running in staging
    pub fn is_staging(&self) -> bool {
        self.environment == Environment::Staging
    }

    /// Get allowed CORS origins based on environment
    pub fn cors_origins(&self) -> Vec<String> {
        let mut origins = vec![self.server.frontend_url.clone()];

        // In development, also allow localhost variants
        if self.is_development() {
            origins.push("http://localhost:3000".to_string());
            origins.push("http://localhost:3001".to_string());
            origins.push("http://localhost:4001".to_string());
            origins.push("http://127.0.0.1:3000".to_string());
            origins.push("http://127.0.0.1:4001".to_string());
        }

        origins
    }
}

/// Legacy Config struct for backward compatibility
/// Use Settings for new code
#[derive(Debug, Clone)]
pub struct Config {
    /// Server port
    pub port: u16,
    /// Database URL
    pub database_url: String,
    /// Redis URL
    pub redis_url: String,
    /// JWT secret for authentication
    pub jwt_secret: String,
    /// Environment (development, staging, production)
    pub environment: String,
}

impl Config {
    /// Load configuration from environment variables (legacy method)
    pub fn from_env() -> anyhow::Result<Self> {
        let settings = Settings::new()?;

        Ok(Self {
            port: settings.server.port,
            database_url: settings.database.url,
            redis_url: settings.redis.url,
            jwt_secret: settings.auth.jwt_secret,
            environment: settings.environment.to_string(),
        })
    }

    /// Check if running in production
    pub fn is_production(&self) -> bool {
        self.environment == "production"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_environment_from_string() {
        assert_eq!(
            Environment::from("production".to_string()),
            Environment::Production
        );
        assert_eq!(
            Environment::from("staging".to_string()),
            Environment::Staging
        );
        assert_eq!(
            Environment::from("development".to_string()),
            Environment::Development
        );
        assert_eq!(
            Environment::from("unknown".to_string()),
            Environment::Development
        );
    }

    #[test]
    fn test_environment_display() {
        assert_eq!(Environment::Production.to_string(), "production");
        assert_eq!(Environment::Staging.to_string(), "staging");
        assert_eq!(Environment::Development.to_string(), "development");
    }

    #[test]
    fn test_default_settings() {
        let settings = Settings::default();
        assert_eq!(settings.environment, Environment::Development);
        assert_eq!(settings.server.port, 4001);
        assert_eq!(settings.database.max_connections, 10);
        assert_eq!(settings.redis.pool_size, 5);
    }

    #[test]
    fn test_google_oauth_configured() {
        let mut config = GoogleOAuthConfig::default();
        assert!(!config.is_configured());

        config.client_id = Some("test-id".to_string());
        assert!(!config.is_configured());

        config.client_secret = Some("test-secret".to_string());
        assert!(config.is_configured());
    }

    #[test]
    fn test_line_oauth_configured() {
        let mut config = LineOAuthConfig::default();
        assert!(!config.is_configured());

        config.client_id = Some("test-id".to_string());
        config.client_secret = Some("test-secret".to_string());
        assert!(config.is_configured());
    }

    #[test]
    fn test_smtp_configured() {
        let mut config = SmtpConfig::default();
        assert!(!config.is_configured());

        config.host = Some("smtp.example.com".to_string());
        config.user = Some("user".to_string());
        config.pass = Some("pass".to_string());
        assert!(config.is_configured());
    }

    #[test]
    fn test_cors_origins_development() {
        let mut settings = Settings::default();
        settings.environment = Environment::Development;
        settings.server.frontend_url = "http://localhost:3000".to_string();

        let origins = settings.cors_origins();
        assert!(origins.contains(&"http://localhost:3000".to_string()));
        assert!(origins.contains(&"http://localhost:4001".to_string()));
    }

    #[test]
    fn test_cors_origins_production() {
        let mut settings = Settings::default();
        settings.environment = Environment::Production;
        settings.server.frontend_url = "https://app.example.com".to_string();

        let origins = settings.cors_origins();
        assert_eq!(origins.len(), 1);
        assert!(origins.contains(&"https://app.example.com".to_string()));
    }
}
