//! Loyalty App Backend - Main Entry Point
//!
//! This module initializes and starts the Axum web server with all configured
//! routes, middleware, and database/Redis connections.

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use tokio::net::TcpListener;
use tower_http::compression::CompressionLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::{self, TraceLayer};
use tracing::{error, info, warn, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Global request body limit. 16 MiB matches `client_max_body_size 15M` in
/// nginx/nginx.conf with a small headroom for multipart framing overhead;
/// per-route handlers (e.g. JSON endpoints) can tighten this further.
const DEFAULT_BODY_LIMIT_BYTES: usize = 16 * 1024 * 1024;

use loyalty_backend::{
    config::{Environment, Settings},
    db,
    middleware::cors::{cors_layer, cors_layer_multiple_origins},
    redis::RedisManager,
    routes,
    state::AppState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file
    if let Err(e) = dotenvy::dotenv() {
        // Only log if file exists but couldn't be loaded
        if !matches!(e, dotenvy::Error::Io(_)) {
            eprintln!("Warning: Failed to load .env file: {}", e);
        }
    }

    // Initialize tracing/logging
    init_tracing();

    info!("Starting Loyalty App Backend (Rust)");
    info!("Version: {}", env!("CARGO_PKG_VERSION"));

    // Load configuration
    let config = match Settings::new() {
        Ok(cfg) => cfg,
        Err(e) => {
            error!("Failed to load configuration: {}", e);
            return Err(anyhow::anyhow!("Configuration error: {}", e));
        },
    };

    info!(
        environment = %config.environment,
        port = config.server.port,
        log_level = %config.server.log_level,
        "Configuration loaded"
    );

    // Refuse to boot in production with well-known development credentials.
    // In dev/staging this only emits a warning so iteration is unblocked.
    if let Err(e) = enforce_safe_database_url(&config.database.url, &config.environment) {
        error!("Refusing to start: {}", e);
        return Err(e);
    }

    // Connect to database with configured connection pool settings
    info!("Connecting to PostgreSQL...");
    let db_config = db::DbConfig {
        max_connections: config.database.max_connections,
        min_connections: config.database.min_connections,
        acquire_timeout: Duration::from_secs(config.database.connection_timeout_secs),
        idle_timeout: Duration::from_secs(600), // 10 minutes
    };
    let db = match db::init_pool_with_url(&config.database.url, Some(db_config)).await {
        Ok(db) => {
            info!("PostgreSQL connection established");
            db
        },
        Err(e) => {
            error!("Failed to connect to PostgreSQL: {}", e);
            return Err(anyhow::anyhow!("Database connection error: {}", e));
        },
    };

    // Run database migrations
    info!("Running database migrations...");
    if let Err(e) = db::migrations::run_migrations(db.pool()).await {
        error!("Failed to run database migrations: {}", e);
        return Err(anyhow::anyhow!("Database migration error: {}", e));
    }

    // Seed essential data (runs in all environments)
    info!("Seeding essential data...");
    if let Err(e) = db::seed::seed_essential_data(db.pool()).await {
        error!("Failed to seed essential data: {}", e);
        // Continue startup even if seeding fails - data may already exist
    }

    // Seed sample data (development only)
    if config.environment == Environment::Development {
        info!("Seeding sample data (development mode)...");
        if let Err(e) = db::seed::seed_sample_data(db.pool()).await {
            error!("Failed to seed sample data: {}", e);
            // Continue startup even if sample seeding fails
        }
    }

    // Connect to Redis
    info!("Connecting to Redis...");
    let redis = match RedisManager::new(&config.redis.url).await {
        Ok(r) => {
            info!("Redis connection established");
            r
        },
        Err(e) => {
            error!("Failed to connect to Redis: {}", e);
            return Err(anyhow::anyhow!("Redis connection error: {}", e));
        },
    };

    // Create application state
    let state = AppState::new(db.pool().clone(), redis.connection.clone(), config.clone());

    // Build the application router with all routes and middleware
    let app = create_app(state, &config);

    // Create the socket address
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port));
    info!("Starting server on http://{}", addr);

    // Create TCP listener and serve
    let listener = TcpListener::bind(addr).await?;
    info!(
        "Server is ready to accept connections on port {}",
        config.server.port
    );

    // Log configured features
    log_startup_info(&config);

    axum::serve(listener, app).await?;

    Ok(())
}

/// Initialize tracing/logging subscriber
fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                // Default log levels for different modules
                "loyalty_backend=info,tower_http=info,axum=info,sqlx=warn".into()
            }),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false),
        )
        .init();
}

/// Log startup information about configured features
fn log_startup_info(config: &Settings) {
    info!("=== Server Configuration ===");
    info!("  Environment: {}", config.environment);
    info!("  Port: {}", config.server.port);
    info!("  Frontend URL: {}", config.server.frontend_url);

    // Log OAuth configuration status
    if config.oauth.google.is_configured() {
        info!("  Google OAuth: Enabled");
    } else {
        info!("  Google OAuth: Not configured");
    }

    if config.oauth.line.is_configured() {
        info!("  LINE OAuth: Enabled");
    } else {
        info!("  LINE OAuth: Not configured");
    }

    // Log email configuration status
    if config.email.smtp.is_configured() {
        info!("  SMTP Email: Enabled");
    } else {
        info!("  SMTP Email: Not configured");
    }

    // Log SlipOK configuration status
    if config.slipok.is_configured() {
        info!("  SlipOK Payment: Enabled");
    } else {
        info!("  SlipOK Payment: Not configured");
    }

    info!("============================");
}

/// Creates the main application with all routes and middleware
///
/// Routes are organized under /api prefix:
/// - /api/health - Health check endpoints
/// - /api/auth - Authentication (login, register, logout, etc.)
/// - /api/users - User profile and management
/// - /api/oauth - OAuth provider authentication (Google, LINE)
/// - /api/loyalty - Loyalty points and tiers
/// - /api/coupons - Coupon management
/// - /api/surveys - Survey system
/// - /api/bookings - Booking management
/// - /api/notifications - User notifications
/// - /api/storage - File uploads and storage
/// - /api/admin - Admin panel operations
/// - /api/sse - Server-Sent Events for real-time updates
fn create_app(state: AppState, config: &Settings) -> Router {
    // Build the application router with all routes
    // The routes::create_router function handles setting up all API endpoints
    let app = routes::create_router(state);

    // Apply middleware layers (order matters - applied bottom to top)
    app
        // Compression (gzip, deflate, br)
        .layer(CompressionLayer::new())
        // Cap incoming request bodies. axum's default is 2 MiB which would
        // reject every legitimate file upload; nginx's 15 MiB limit only
        // protects requests that pass through the reverse proxy, so we
        // enforce an equivalent (with a touch of headroom) here too.
        .layer(DefaultBodyLimit::max(DEFAULT_BODY_LIMIT_BYTES))
        // Request timeout (30 seconds default)
        .layer(TimeoutLayer::new(Duration::from_secs(30)))
        // Request tracing/logging
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(trace::DefaultMakeSpan::new().level(Level::INFO))
                .on_response(trace::DefaultOnResponse::new().level(Level::INFO))
                .on_failure(trace::DefaultOnFailure::new().level(Level::ERROR)),
        )
        // CORS configuration based on environment
        .layer(build_cors_layer(config))
}

/// Build CORS layer based on configuration
fn build_cors_layer(config: &Settings) -> tower_http::cors::CorsLayer {
    if config.is_development() {
        // In development, allow multiple localhost origins
        let origins = config.cors_origins();
        let origin_strs: Vec<&str> = origins.iter().map(|s| s.as_str()).collect();
        cors_layer_multiple_origins(origin_strs)
    } else {
        // In production/staging, use the configured CORS layer
        cors_layer()
    }
}

/// Well-known development/example credentials that must never reach production.
///
/// Each entry is a substring search against `DATABASE_URL`. Centralized so the
/// guard and its unit tests share a single source of truth.
const FORBIDDEN_DB_CREDENTIAL_PATTERNS: &[&str] = &[
    "loyalty:loyalty_pass",
    "loyalty_dev:loyalty_dev_pass",
    "CHANGE_ME_PASSWORD",
    "CHANGE_ME_USER",
    "password@",
    ":password:",
];

/// Reject boot when `DATABASE_URL` matches a well-known dev/example credential
/// pattern in production. In non-production environments this only warns.
///
/// Catches:
/// - The legacy `loyalty:loyalty_pass` literal that the base compose file used
///   to bake into the backend container.
/// - The dev compose's `loyalty_dev:loyalty_dev_pass` placeholder.
/// - The `CHANGE_ME_*` placeholders shipped in `.env.production.example`.
/// - Trivial `password` user/secret choices (`password@` and `:password:`).
/// - An empty password segment (e.g. `postgres://user:@host/db`).
fn enforce_safe_database_url(
    database_url: &str,
    environment: &Environment,
) -> anyhow::Result<()> {
    let matched_pattern = forbidden_pattern_match(database_url);

    let Some(pattern) = matched_pattern else {
        return Ok(());
    };

    if matches!(environment, Environment::Production) {
        return Err(anyhow::anyhow!(
            "DATABASE_URL contains a forbidden development credential pattern \
             ({pattern:?}); refusing to start in production. Rotate the database \
             password and update the deploy secret before retrying."
        ));
    }

    warn!(
        pattern = pattern,
        environment = %environment,
        "DATABASE_URL contains a development credential pattern. \
         This will refuse-to-boot in production."
    );
    Ok(())
}

/// Returns the first forbidden pattern matched by `database_url`, if any.
fn forbidden_pattern_match(database_url: &str) -> Option<&'static str> {
    for pattern in FORBIDDEN_DB_CREDENTIAL_PATTERNS {
        if database_url.contains(pattern) {
            return Some(pattern);
        }
    }
    if has_empty_password_segment(database_url) {
        return Some("<empty-password>");
    }
    None
}

/// Detects URLs of the form `scheme://user:@host/...` (empty password segment).
fn has_empty_password_segment(database_url: &str) -> bool {
    let Some(after_scheme) = database_url.split_once("://").map(|(_, rest)| rest) else {
        return false;
    };
    let Some(authority) = after_scheme.split('@').next() else {
        return false;
    };
    // Authority is `user:password` if creds are present. Skip URLs without creds.
    let Some((_user, password)) = authority.split_once(':') else {
        return false;
    };
    // True empty password is `user:` with nothing between `:` and `@`.
    password.is_empty() && after_scheme.contains('@')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforce_safe_database_url_rejects_legacy_loyalty_pass_in_production() {
        let url = "postgresql://loyalty:loyalty_pass@postgres:5432/loyalty_db";
        let err = enforce_safe_database_url(url, &Environment::Production)
            .expect_err("should refuse legacy loyalty_pass in production");
        let msg = err.to_string();
        assert!(
            msg.contains("loyalty:loyalty_pass"),
            "error should mention the matched pattern: {msg}"
        );
    }

    #[test]
    fn enforce_safe_database_url_rejects_dev_creds_in_production() {
        let url = "postgresql://loyalty_dev:loyalty_dev_pass@postgres:5432/loyalty_dev_db";
        assert!(enforce_safe_database_url(url, &Environment::Production).is_err());
    }

    #[test]
    fn enforce_safe_database_url_rejects_change_me_password_in_production() {
        let url = "postgresql://prod_user:CHANGE_ME_PASSWORD@postgres:5432/prod_db";
        assert!(enforce_safe_database_url(url, &Environment::Production).is_err());
    }

    #[test]
    fn enforce_safe_database_url_rejects_literal_password_creds_in_production() {
        let url = "postgresql://admin:password@postgres:5432/prod_db";
        // matches `password@`
        assert!(enforce_safe_database_url(url, &Environment::Production).is_err());
    }

    #[test]
    fn enforce_safe_database_url_rejects_password_in_path_in_production() {
        let url = "postgresql://admin:password:extra@postgres:5432/db";
        // matches `:password:`
        assert!(enforce_safe_database_url(url, &Environment::Production).is_err());
    }

    #[test]
    fn enforce_safe_database_url_rejects_empty_password_segment_in_production() {
        let url = "postgresql://admin:@postgres:5432/db";
        let err = enforce_safe_database_url(url, &Environment::Production)
            .expect_err("should refuse empty password in production");
        assert!(err.to_string().contains("empty-password"));
    }

    #[test]
    fn enforce_safe_database_url_warns_in_development() {
        let url = "postgresql://loyalty_dev:loyalty_dev_pass@postgres:5432/loyalty_dev_db";
        // Dev should warn, not refuse.
        assert!(enforce_safe_database_url(url, &Environment::Development).is_ok());
    }

    #[test]
    fn enforce_safe_database_url_warns_in_staging() {
        let url = "postgresql://loyalty_dev:loyalty_dev_pass@postgres:5432/loyalty_dev_db";
        // Staging is treated as non-production (per task spec) — warn only.
        assert!(enforce_safe_database_url(url, &Environment::Staging).is_ok());
    }

    #[test]
    fn enforce_safe_database_url_accepts_strong_creds_in_production() {
        let url =
            "postgresql://prod_user_28a:F8q!7vXr2sH9pZdL3kN@db.internal:5432/loyalty_prod_db";
        assert!(enforce_safe_database_url(url, &Environment::Production).is_ok());
    }

    #[test]
    fn has_empty_password_segment_detects_empty_password() {
        assert!(has_empty_password_segment(
            "postgresql://user:@host:5432/db"
        ));
    }

    #[test]
    fn has_empty_password_segment_ignores_filled_password() {
        assert!(!has_empty_password_segment(
            "postgresql://user:strongpw@host:5432/db"
        ));
    }

    #[test]
    fn has_empty_password_segment_ignores_url_without_creds() {
        assert!(!has_empty_password_segment("postgresql://host:5432/db"));
    }
}
