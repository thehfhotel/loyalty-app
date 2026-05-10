//! Custom middleware module
//!
//! Contains middleware for authentication, CORS, rate limiting, admin authorization,
//! and request processing.

pub mod admin;
pub mod auth;
pub mod cors;
pub mod rate_limit;

// Re-export commonly used items for convenience
pub use admin::{
    admin_middleware, get_admin_config, is_admin, is_super_admin, reload_admin_config,
    super_admin_middleware, AdminAuthError, AdminConfig,
};
pub use auth::{
    auth_middleware, build_clear_refresh_cookie, build_clear_refresh_cookie_header,
    build_refresh_cookie, build_refresh_cookie_header, optional_auth_middleware, AuthUser, Claims,
    REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH,
};
pub use cors::{cors_layer, cors_layer_permissive};
pub use rate_limit::{
    default_rate_limit_layer, rate_limit_middleware, strict_rate_limit_layer, RateLimitConfig,
    RateLimiter,
};
