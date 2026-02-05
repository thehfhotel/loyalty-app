use std::sync::Arc;

use redis::aio::ConnectionManager;
use sqlx::PgPool;

use crate::config::Settings;

/// Application state shared across all request handlers.
///
/// This struct is designed to be cheaply cloneable (all inner types use Arc or are Clone),
/// making it suitable for use with Axum's state extraction.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool
    db: PgPool,
    /// Redis connection manager for async operations
    redis: ConnectionManager,
    /// Application configuration
    config: Arc<Settings>,
}

impl AppState {
    /// Creates a new AppState instance.
    ///
    /// # Arguments
    ///
    /// * `db` - PostgreSQL connection pool
    /// * `redis` - Redis connection manager
    /// * `config` - Application settings
    pub fn new(db: PgPool, redis: ConnectionManager, config: Settings) -> Self {
        Self {
            db,
            redis,
            config: Arc::new(config),
        }
    }

    /// Returns a reference to the database connection pool.
    ///
    /// Use this to execute database queries:
    /// ```ignore
    /// let users = sqlx::query_as!(User, "SELECT * FROM users")
    ///     .fetch_all(state.db())
    ///     .await?;
    /// ```
    #[inline]
    pub fn db(&self) -> &PgPool {
        &self.db
    }

    /// Returns a clone of the Redis connection manager.
    ///
    /// The ConnectionManager implements Clone and handles reconnection automatically.
    /// Each clone shares the same underlying connection.
    #[inline]
    pub fn redis(&self) -> ConnectionManager {
        self.redis.clone()
    }

    /// Returns a reference to the application configuration.
    #[inline]
    pub fn config(&self) -> &Settings {
        &self.config
    }

    /// Returns the JWT secret from configuration.
    ///
    /// Convenience method for authentication handlers.
    #[inline]
    pub fn jwt_secret(&self) -> &str {
        &self.config.auth.jwt_secret
    }

    /// Returns the JWT expiration time in seconds.
    #[inline]
    pub fn jwt_expiration(&self) -> i64 {
        self.config.auth.access_token_expiry_secs as i64
    }

    /// Returns the configured server port.
    #[inline]
    pub fn port(&self) -> u16 {
        self.config.server.port
    }

    /// Returns whether the application is running in production mode.
    #[inline]
    pub fn is_production(&self) -> bool {
        self.config.is_production()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Full integration tests would require actual database and Redis connections.
    // Unit tests here focus on the struct's design and Clone implementation.

    #[test]
    fn app_state_is_send_and_sync() {
        // Ensure AppState can be shared across threads (required by Axum)
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AppState>();
    }
}
