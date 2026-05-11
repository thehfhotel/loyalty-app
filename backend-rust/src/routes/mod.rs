//! Route definitions module
//!
//! Defines all API routes and their handlers.
//! All routes are nested under /api prefix via the create_router function.

pub mod admin;
pub mod admin_rooms;
pub mod analytics;
pub mod auth;
pub mod bookings;
pub mod coupons;
pub mod health;
pub mod loyalty;
pub mod membership;
pub mod notifications;
pub mod oauth;
pub mod payments;
pub mod slips;
pub mod sse;
pub mod storage;
pub mod surveys;
pub mod translation;
pub mod users;

use axum::{middleware, Extension, Router};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::middleware::auth::JwtSecret;
use crate::middleware::rate_limit::{redis_rate_limit_middleware, RedisRateLimiter};
use crate::openapi::ApiDoc;
use crate::state::AppState;

/// Create the main application router with all routes nested under /api
///
/// This creates the full router with all API endpoints properly nested:
/// - /api/health -> health routes (basic health checks, db, redis)
/// - /api/auth -> authentication routes (login, register, etc.)
/// - /api/users -> user management routes
/// - /api/oauth -> OAuth provider routes (Google, LINE)
/// - /api/loyalty -> loyalty program routes (points, tiers)
/// - /api/coupons -> coupon management routes
/// - /api/surveys -> survey routes
/// - /api/bookings -> booking routes
/// - /api/notifications -> notification routes
/// - /api/admin -> admin panel routes
/// - /api/sse -> server-sent events routes
/// - /api/membership -> membership ID management routes
/// - /api/payments -> payment QR code generation routes (PromptPay)
/// - /api/slips -> payment slip upload routes
/// - /api/analytics -> analytics tracking routes
/// - /api/translation -> content translation routes
/// - /api/docs -> Swagger UI for API documentation
/// - /api/openapi.json -> OpenAPI specification JSON
///
/// Note: Storage routes are not included here as they require a different state type.
/// Use `storage::routes_with_state(StorageState)` separately if needed.
///
/// # Arguments
///
/// * `state` - Application state containing database pool, Redis connection, and config
///
/// # Returns
///
/// An Axum Router with all routes configured and state attached
pub fn create_router(state: AppState) -> Router {
    // Extract JWT secret from config to inject as Extension for auth middleware
    let jwt_secret = JwtSecret(state.config().auth.jwt_secret.clone());

    // Rate limiters are only attached in production. In development and test
    // we disable them so iterative testing (login retries, integration suites
    // hitting the same endpoints from 127.0.0.1) doesn't trip the strict
    // 5/min threshold. The limiter itself fails open if Redis is unavailable,
    // so leaving it on in dev would still mostly work — but disabling is
    // simpler and avoids flaky tests.
    let rate_limiters = if state.is_production() {
        Some((
            RedisRateLimiter::with_defaults(state.redis(), "api"),
            RedisRateLimiter::strict(state.redis(), "auth"),
        ))
    } else {
        None
    };

    // Storage routes use a different state type, so mount separately
    let storage_state = storage::StorageState::new(crate::services::storage::StorageService::new());
    let storage_router =
        Router::new().nest("/api/storage", storage::routes().with_state(storage_state));

    // Auth routes get a tighter (strict) rate limit on top of the global one
    // when running in production. The strict layer is applied per-router so
    // it stacks under the global limiter in main.rs.
    let auth_routes = match &rate_limiters {
        Some((_default, strict)) => auth::routes().layer(middleware::from_fn_with_state(
            strict.clone(),
            redis_rate_limit_middleware,
        )),
        None => auth::routes(),
    };

    let app = Router::new()
        .nest("/api/health", health::routes())
        .nest("/api/auth", auth_routes)
        .nest("/api/users", users::routes())
        .nest("/api/oauth", oauth::routes())
        .nest("/api/loyalty", loyalty::routes())
        .nest("/api/coupons", coupons::routes())
        .nest("/api/surveys", surveys::routes())
        .nest("/api/bookings", bookings::routes())
        .nest("/api/notifications", notifications::routes())
        .nest("/api/admin", admin::routes())
        .nest("/api/sse", sse::routes())
        .nest("/api/membership", membership::routes())
        .nest("/api/payments", payments::routes())
        .nest("/api/slips", slips::routes())
        .nest("/api/analytics", analytics::routes())
        .nest("/api/translation", translation::routes())
        // OpenAPI documentation routes
        .merge(SwaggerUi::new("/api/docs").url("/api/openapi.json", ApiDoc::openapi()))
        .with_state(state)
        // Merge storage routes (separate state type)
        .merge(storage_router);

    // Apply the global default rate limiter (production only) on top of
    // everything, then inject the JWT secret so auth_middleware can read it.
    let app = match rate_limiters {
        Some((default_limiter, _strict)) => app.layer(middleware::from_fn_with_state(
            default_limiter,
            redis_rate_limit_middleware,
        )),
        None => app,
    };

    app.layer(Extension(jwt_secret))
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify all modules are accessible
        // This is a compile-time check that all modules exist
    }
}
