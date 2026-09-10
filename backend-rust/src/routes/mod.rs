//! Route definitions module
//!
//! Defines all API routes and their handlers.
//! All routes are nested under /api prefix via the create_router function.

pub mod admin;
pub mod admin_bookings;
pub mod admin_deposit_links;
pub mod admin_email;
pub mod admin_rooms;
pub mod admin_slips;
pub mod analytics;
pub mod auth;
pub mod bookings;
pub mod coupons;
pub mod deposit_links;
pub mod health;
pub mod line_webhook;
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
/// - /api/deposit -> PUBLIC deposit-request-link routes (no auth; the token is the capability)
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

    // Storage routes use a different state type, so mount separately.
    //
    // MED-6 (security-2026-05-13.md): the slip-serving handler needs DB
    // and Redis access to authorize per-slip access. We attach the
    // shared AppState onto the storage state so the slip handler can
    // run the `booking_slips → bookings → users` lookup + Redis cache
    // without forcing a global state-type unification.
    let storage_state = storage::StorageState::new(crate::services::storage::StorageService::new())
        .with_app_state(state.clone());
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

    // Public deposit-request links (B1). Unauthenticated by design — the
    // 43-character token in the path is the capability — so the whole
    // sub-router carries its own limiter, layered the same way the strict
    // auth limiter is above: 30 requests per minute per IP, production
    // only. The guest page polls the read endpoint every 5 seconds after
    // an upload (12/min), so a well-behaved page sits at well under half
    // the budget.
    //
    // The upload's tighter budgets (5 per hour per *link*, 20 per hour per
    // IP) live inside the handler, because the subject that matters most
    // there is the link, not the address a phone happens to be on.
    let deposit_routes = match &rate_limiters {
        Some(_) => deposit_links::routes().layer(middleware::from_fn_with_state(
            RedisRateLimiter::new(
                state.redis(),
                deposit_links::public_read_rate_limit(),
                "deposit_public",
            ),
            redis_rate_limit_middleware,
        )),
        None => deposit_links::routes(),
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
        .nest("/api/deposit", deposit_routes)
        .nest("/api/analytics", analytics::routes())
        .nest("/api/translation", translation::routes())
        // LINE Messaging API webhooks (per-property OA). Public by design —
        // authenticated by X-Line-Signature inside the handler.
        .nest("/api/line", line_webhook::routes())
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

    // Prometheus metrics. The layer measures every API request defined above
    // (request count, in-flight, and latency histograms by path/method/status).
    // The `/metrics` endpoint is added AFTER the layer so it is neither
    // measured nor rate-limited, and it lives at the top level — nginx only
    // proxies `/api` and `/storage` to the backend, so `/metrics` is reachable
    // only inside the Docker network (e.g. a Prometheus sidecar scraping
    // `backend:4001/metrics`), never from the public internet.
    // Install the recorder WITHOUT the exporter's HTTP listener. The convenience
    // `PrometheusMetricLayer::pair()` internally calls `PrometheusBuilder::build()`,
    // whose default config binds an HTTP listener on 0.0.0.0:9000 and then hands
    // back an exporter future that axum-prometheus discards — so the port is
    // bound, never served (we expose metrics via the `/metrics` route below), and
    // dropped. Harmless-looking in prod, but under parallel test processes the
    // bind races → `FailedToCreateHTTPListener("Address already in use")` and a
    // flaky integration-suite failure. `install_recorder()` installs the same
    // global recorder with no listener; the layer + handle below are the exact
    // pieces `pair()` returns (see axum-prometheus docs).
    let metric_handle = {
        use axum_prometheus::metrics_exporter_prometheus::{Matcher, PrometheusBuilder};
        PrometheusBuilder::new()
            .upkeep_timeout(std::time::Duration::from_secs(5))
            .set_buckets_for_metric(
                Matcher::Full(axum_prometheus::AXUM_HTTP_REQUESTS_DURATION_SECONDS.to_string()),
                axum_prometheus::utils::SECONDS_DURATION_BUCKETS,
            )
            .expect("valid metrics bucket configuration")
            .install_recorder()
            .expect("failed to install Prometheus recorder")
    };
    let prometheus_layer = axum_prometheus::PrometheusMetricLayer::new();

    app.layer(Extension(jwt_secret))
        .layer(prometheus_layer)
        .route(
            "/metrics",
            axum::routing::get(move || {
                let handle = metric_handle.clone();
                async move { handle.render() }
            }),
        )
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
