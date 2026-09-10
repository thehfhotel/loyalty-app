//! Loyalty App Backend - Main Entry Point
//!
//! This module initializes and starts the Axum web server with all configured
//! routes, middleware, and database/Redis connections.

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, Request};
use axum::http::HeaderName;
use axum::Router;
use tokio::net::TcpListener;
use tower_http::compression::CompressionLayer;
use tower_http::request_id::{
    MakeRequestUuid, PropagateRequestIdLayer, RequestId, SetRequestIdLayer,
};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::{self, TraceLayer};
use tracing::{error, info, warn, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// HTTP header used to carry a request's correlation ID into and out of
/// the backend. Lowercase per HTTP/2.
const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

/// Maximum time the server waits for in-flight requests to finish after a
/// shutdown signal before forcing exit. Picked just under docker compose's
/// default `--timeout 30` so the runtime returns control to the OS before
/// the container is killed.
const SHUTDOWN_GRACE_PERIOD_SECS: u64 = 25;

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
    services::email::is_valid_mailbox,
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
            // `{:#}` walks the anyhow cause chain so the underlying config /
            // dotenvy / env-var error is visible, not just the top frame.
            error!("Failed to load configuration: {:#}", e);
            return Err(anyhow::anyhow!("Configuration error: {:#}", e));
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
        error!("Refusing to start: {:#}", e);
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
            // `{:#}` walks the anyhow cause chain so the underlying sqlx /
            // io error (TLS handshake, DNS, auth, pool-acquire timeout) is
            // visible. The top frame alone is a generic "Database connection
            // error" that hides the root cause.
            error!("Failed to connect to PostgreSQL: {:#}", e);
            return Err(anyhow::anyhow!("Database connection error: {:#}", e));
        },
    };

    // Run database migrations
    info!("Running database migrations...");
    if let Err(e) = db::migrations::run_migrations(db.pool()).await {
        // `{:#}` walks the anyhow cause chain so the underlying sqlx /
        // Postgres error is visible in container logs. Without it the
        // chain stops at run_migrations()'s `.context(...)` wrapper and
        // every staging failure looks identical regardless of root cause.
        error!("Failed to run database migrations: {:#}", e);
        return Err(anyhow::anyhow!("Database migration error: {:#}", e));
    }

    // Seed essential data (runs in all environments)
    info!("Seeding essential data...");
    if let Err(e) = db::seed::seed_essential_data(db.pool()).await {
        // `{:#}` walks the anyhow cause chain — seed failures are non-fatal
        // here, so we want all the context the underlying sqlx error has.
        error!("Failed to seed essential data: {:#}", e);
        // Continue startup even if seeding fails - data may already exist
    }

    // Admin bootstrap sweep (issue #348): promote pre-existing 'customer'
    // rows whose email is on the ADMIN_BOOTSTRAP_EMAILS allowlist. The
    // in-transaction promotion in /api/auth/register covers new
    // registrations; this sweep covers rows created before the variable
    // was set (including OAuth-created accounts). Non-fatal, like seeding.
    let bootstrap_emails = config.admin_bootstrap.email_list();
    if !bootstrap_emails.is_empty() {
        // Staging deploys real user data too — warn anywhere that isn't
        // local development, not just production.
        if config.is_production() || config.is_staging() {
            warn!(
                "ADMIN_BOOTSTRAP_EMAILS is set in {} ({} entries) — remove it once the \
                 first admin exists: the first registration of a listed email becomes admin \
                 without proving ownership of the address",
                config.environment,
                bootstrap_emails.len()
            );
        }
        match db::seed::promote_bootstrap_admins(db.pool(), &bootstrap_emails).await {
            // A promotion is a privileged event: surface a non-zero sweep
            // at WARN (per-user WARN lines with ids come from
            // promote_bootstrap_admins itself).
            Ok(promoted) if promoted > 0 => warn!(
                "Admin bootstrap sweep: promoted {} user(s) to admin ({} allowlisted email(s))",
                promoted,
                bootstrap_emails.len()
            ),
            Ok(_) => info!(
                "Admin bootstrap sweep: nothing to promote ({} allowlisted email(s))",
                bootstrap_emails.len()
            ),
            Err(e) => error!("Admin bootstrap sweep failed: {:#}", e),
        }
    }

    // Seed sample data (development only)
    if config.environment == Environment::Development {
        info!("Seeding sample data (development mode)...");
        if let Err(e) = db::seed::seed_sample_data(db.pool()).await {
            error!("Failed to seed sample data: {:#}", e);
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
            // `{:#}` walks the anyhow cause chain to surface the underlying
            // redis crate / io error, not just the wrapper message.
            error!("Failed to connect to Redis: {:#}", e);
            return Err(anyhow::anyhow!("Redis connection error: {:#}", e));
        },
    };

    // Create application state
    let state = AppState::new(db.pool().clone(), redis.connection.clone(), config.clone());

    // Belt-and-braces sweep for channel-booking payment windows (ADR-0003):
    // releases PMS holds whose deposit never arrived and cancels the local
    // channel rows. The PMS runs its own expiry sweep too; both sides are
    // idempotent, so double-release is harmless.
    {
        let sweep_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                loyalty_backend::services::pms_channel::release_expired_holds(
                    sweep_state.db(),
                    sweep_state.config(),
                )
                .await;
            }
        });
    }

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

    // Serve with a graceful shutdown signal AND ConnectInfo wiring.
    //
    // `with_graceful_shutdown` (from #235): without it, every container
    // rotation (docker compose up / restart) drops in-flight slip uploads,
    // SSE long-poll connections, and any other request held when SIGTERM
    // lands.
    //
    // `into_make_service_with_connect_info::<SocketAddr>()` (from #236):
    // makes the peer's `SocketAddr` available to handlers and middleware
    // via `axum::extract::ConnectInfo<SocketAddr>`. The rate limiter
    // relies on this to bucket by the actual TCP peer instead of
    // client-supplied X-Forwarded-For headers (security HIGH-2).
    let serve_result = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await;

    // Close the db pool after the server has stopped accepting / completing
    // requests. Bound the close itself so a pathologically stuck connection
    // can't block container exit past the docker-compose stop timeout.
    if let Err(close_err) =
        tokio::time::timeout(Duration::from_secs(SHUTDOWN_GRACE_PERIOD_SECS), db.close()).await
    {
        warn!(
            "Database pool close did not complete within {}s grace period: {}",
            SHUTDOWN_GRACE_PERIOD_SECS, close_err
        );
    }

    serve_result?;

    info!("Server shutdown complete");
    Ok(())
}

/// Resolve when the process should begin graceful shutdown.
///
/// SIGINT (`Ctrl-C`) covers interactive use; SIGTERM is what `docker stop` /
/// `docker compose` / `kubectl rollout` send before SIGKILL. We race both
/// and resolve on whichever fires first.
///
/// On non-Unix targets only the Ctrl-C branch is active.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C signal handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received SIGINT (Ctrl-C); beginning graceful shutdown");
        },
        _ = terminate => {
            info!("Received SIGTERM; beginning graceful shutdown");
        },
    }
}

/// Initialize tracing/logging subscriber.
///
/// In non-development environments (staging / production / anything other
/// than `RUST_ENV=development`) the subscriber emits JSON-line output so
/// downstream log aggregators (Loki, ELK, Cloudflare Logs, etc.) can
/// parse structured fields out of the box. In development it emits
/// human-readable text, which is far easier to scan in a terminal.
///
/// Settings::new() runs *after* init_tracing, so we can't lean on the
/// parsed `Environment` enum here — we read the same env vars
/// (`RUST_ENV`, fallback `NODE_ENV`) that the config layer does.
fn init_tracing() {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // Default log levels for different modules
        "loyalty_backend=info,tower_http=info,axum=info,sqlx=warn".into()
    });

    let registry = tracing_subscriber::registry().with(env_filter);

    if is_development_env() {
        // Pretty / human-readable for dev.
        registry
            .with(
                tracing_subscriber::fmt::layer()
                    .with_target(true)
                    .with_thread_ids(false)
                    .with_file(false)
                    .with_line_number(false),
            )
            .init();
    } else {
        // JSON-line output for staging / production. `with_current_span` +
        // `with_span_list` carry the http_request span and any nested
        // spans onto every log line so a single request's logs are easy
        // to correlate even before request IDs land.
        registry
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_current_span(true)
                    .with_span_list(true)
                    .with_target(true)
                    .with_thread_ids(false)
                    .with_file(false)
                    .with_line_number(false),
            )
            .init();
    }
}

/// Read `RUST_ENV` (falling back to `NODE_ENV`) and report whether we're
/// in development. Matches `Settings::new()`'s parsing rule so logging
/// and config agree about which environment they're in.
fn is_development_env() -> bool {
    let env_str = std::env::var("RUST_ENV")
        .or_else(|_| std::env::var("NODE_ENV"))
        .unwrap_or_else(|_| "development".to_string());
    matches!(
        env_str.to_lowercase().as_str(),
        "development" | "dev" | "local"
    )
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

    // Log email configuration status, including the effective From address.
    //
    // The From address ships in the header of every outgoing message, so it
    // is not a secret — and printing it is the only way an operator can tell
    // whether SMTP_FROM actually reached the container or whether the app
    // silently fell back to SMTP_USER (issue #352). `{:?}` keeps a stray
    // newline in the value from forging a log line.
    //
    // A malformed value is an ERROR, not a warning: it fails *every* send,
    // and until now did so at request time with nothing at startup to point
    // at the cause.
    if config.email.smtp.is_configured() {
        match config.email.smtp.from_address() {
            Some(from) => {
                info!("  SMTP Email: Enabled (From: {:?})", from);
                if !is_valid_mailbox(from) {
                    error!(
                        "  SMTP From address {:?} is not a valid mailbox — every outgoing \
                         email will fail. Expected `user@example.com` or \
                         `Name <user@example.com>`. Check the SMTP_FROM secret \
                         (it falls back to SMTP_USER when unset).",
                        from
                    );
                }
            },
            // Unreachable while is_configured() requires a user, but reported
            // rather than assumed away.
            None => info!("  SMTP Email: Enabled (From: unset)"),
        }
    } else {
        info!("  SMTP Email: Not configured");
    }

    // Log SlipOK configuration status. Which of the three states we are in
    // decides whether a guest's slip can be verified without an admin, so
    // the startup line names it explicitly rather than just "Enabled".
    if config.slipok.is_configured() {
        if config.slipok.auto_verify {
            info!("  SlipOK Payment: Enabled — auto-verify ON (a passing slip confirms itself)");
        } else {
            info!(
                "  SlipOK Payment: Enabled — shadow mode (decisions recorded, \
                 admin verify still required; set SLIPOK_AUTO_VERIFY=true to enable)"
            );
        }
    } else {
        info!("  SlipOK Payment: Not configured — every slip goes to manual verify");
    }
    // SLIPOK_API_URL is a test/staging affordance. If it is ever set in a
    // real deployment, every guest's slip image and the API key go to that
    // host, and the only symptom is that slips quietly stop verifying — so
    // say so loudly at boot rather than leaving it invisible.
    if let Some(api_url) = config.slipok.api_url.as_deref() {
        if !api_url.starts_with("https://api.slipok.com") {
            warn!(
                "  SlipOK Payment: SLIPOK_API_URL overrides the vendor endpoint ({}). \
                 Slip images and the API key are being sent there. Unset it outside tests.",
                api_url
            );
        }
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

    // Apply middleware layers.
    //
    // Layer ordering note (axum / tower): `.layer(X)` wraps the inner
    // service in X, so the LAST `.layer` call is the OUTERMOST layer the
    // request hits. Conversely, layers earlier in the source see the
    // response after later ones. Order matters for request-id propagation:
    //
    //   request flow:    set_request_id → trace → ... → handler
    //   response flow:   handler → ... → trace → propagate_request_id
    //
    // so we add set_request_id LAST (outermost) and propagate_request_id
    // SECOND-LAST so it wraps everything below trace but is wrapped by
    // set_request_id.
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
        // Request tracing/logging — `make_span_with` injects the
        // request_id (set by SetRequestIdLayer above us in the request
        // flow) into the span so every log line for the request carries
        // the same correlation field.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(make_http_span)
                .on_response(trace::DefaultOnResponse::new().level(Level::INFO))
                .on_failure(trace::DefaultOnFailure::new().level(Level::ERROR)),
        )
        // CORS configuration based on environment
        .layer(build_cors_layer(config))
        // Echo the request_id back to the caller as `x-request-id`. Must
        // wrap the trace layer (request flow) so the response header is
        // set after the handler has returned but before the response
        // leaves the trace span.
        .layer(PropagateRequestIdLayer::new(REQUEST_ID_HEADER))
        // Generate (or accept and pass through) `x-request-id`. v4 UUID.
        // Must be the outermost layer so every downstream layer sees the
        // ID and the trace span can include it.
        .layer(SetRequestIdLayer::new(REQUEST_ID_HEADER, MakeRequestUuid))
}

/// Build the per-request tracing span. Threads the `x-request-id` header
/// (set by `SetRequestIdLayer`) onto the span so every log line emitted
/// while handling the request carries the same correlation field.
fn make_http_span(request: &Request) -> tracing::Span {
    let request_id = request
        .extensions()
        .get::<RequestId>()
        .and_then(|id| id.header_value().to_str().ok())
        .unwrap_or("");

    tracing::info_span!(
        "http_request",
        method = %request.method(),
        uri = %request.uri().path(),
        request_id = %request_id,
    )
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
fn enforce_safe_database_url(database_url: &str, environment: &Environment) -> anyhow::Result<()> {
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
        let url = "postgresql://prod_user_28a:F8q!7vXr2sH9pZdL3kN@db.internal:5432/loyalty_prod_db";
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
