//! Loyalty App Backend - Main Entry Point
//!
//! This module initializes and starts the Axum web server with all configured
//! routes, middleware, and database/Redis connections.

use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use tokio::net::TcpListener;
use tower_http::compression::CompressionLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::{self, TraceLayer};
use tracing::{error, info, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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
        }
    };

    info!(
        environment = %config.environment,
        port = config.server.port,
        log_level = %config.server.log_level,
        "Configuration loaded"
    );

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
        }
        Err(e) => {
            error!("Failed to connect to PostgreSQL: {}", e);
            return Err(anyhow::anyhow!("Database connection error: {}", e));
        }
    };

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
        }
        Err(e) => {
            error!("Failed to connect to Redis: {}", e);
            return Err(anyhow::anyhow!("Redis connection error: {}", e));
        }
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
                "loyalty_backend=debug,tower_http=debug,axum=trace,sqlx=warn".into()
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
