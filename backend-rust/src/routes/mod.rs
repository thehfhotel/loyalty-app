//! Route definitions module
//!
//! Defines all API routes and their handlers.
//! All routes are nested under /api prefix via the create_router function.

pub mod admin;
pub mod analytics;
pub mod auth;
pub mod bookings;
pub mod coupons;
pub mod csrf;
pub mod health;
pub mod loyalty;
pub mod membership;
pub mod notifications;
pub mod oauth;
pub mod slips;
pub mod sse;
pub mod storage;
pub mod surveys;
pub mod translation;
pub mod users;

use axum::Router;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

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
    // Storage routes use a different state type, so mount separately
    let storage_state =
        storage::StorageState::new(crate::services::storage::StorageService::new());
    let storage_router =
        Router::new().nest("/api/storage", storage::routes().with_state(storage_state));

    Router::new()
        .nest("/api/health", health::routes())
        .nest("/api/csrf-token", csrf::routes())
        .nest("/api/auth", auth::routes())
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
        .nest("/api/slips", slips::routes())
        .nest("/api/analytics", analytics::routes())
        .nest("/api/translation", translation::routes())
        // OpenAPI documentation routes
        .merge(SwaggerUi::new("/api/docs").url("/api/openapi.json", ApiDoc::openapi()))
        .with_state(state)
        // Merge storage routes (separate state type)
        .merge(storage_router)
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
