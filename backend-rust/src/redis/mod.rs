//! Redis connection and operations module
//!
//! Provides Redis connectivity with automatic reconnection support and helper functions
//! for common operations including session management.

use anyhow::{Context, Result};
use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use redis::{AsyncCommands, Client};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use tracing::{debug, info};

/// Default TTL for sessions (24 hours)
const DEFAULT_SESSION_TTL_SECS: u64 = 86400;

/// Session key prefix
const SESSION_PREFIX: &str = "session:";

/// How many times a lost connection is retried before the reconnect future
/// gives up and resolves with an error.
///
/// Every command issued while a reconnect is in flight *awaits that
/// reconnect*, so this number is not "how hard we try", it is "how long a
/// request waits before it is told the truth".
const RECONNECT_RETRIES: usize = 3;

/// Ceiling on the delay between reconnect attempts.
///
/// See [`connection_manager_config`] for why the default is not a ceiling
/// anybody would choose on purpose.
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(2);

/// Growth factor between reconnect attempts.
///
/// `backon` starts at a 1 s minimum delay and multiplies by this each
/// attempt, so 1 s → 2 s → 2 s (clamped by [`RECONNECT_MAX_DELAY`]):
/// a failed reconnect cycle resolves in about five seconds.
const RECONNECT_FACTOR: u64 = 2;

/// Bound the connection manager's reconnect loop.
///
/// **Why this exists.** `ConnectionManager::new` uses
/// `ConnectionManagerConfig::default()`, and redis 0.27 feeds that
/// config's `factor` — documented there as a *millisecond* multiplier and
/// defaulting to `100` — straight into `backon`'s `ExponentialBuilder`,
/// where `factor` is the *exponential growth factor* instead
/// (`redis-0.27.6/src/aio/connection_manager.rs`, `with_factor(config.factor as f32)`).
/// `backon`'s own defaults then supply a 1 s minimum delay and a 60 s
/// maximum, and redis only overrides the maximum when `max_delay` is set —
/// which by default it is not. The result is a reconnect that backs off
/// 1 s, 100 s (clamped to 60 s), 60 s, 60 s, 60 s, 60 s: **just over five
/// minutes** before the attempt resolves as failed, six retries deep.
///
/// That is not merely slow reconnection. `ConnectionManager` shares one
/// reconnect future between all callers, so every command issued while it
/// is in flight *waits for it*. During a Redis outage a guest's request
/// therefore hangs for minutes instead of failing, which is what made one
/// integration test take 23 minutes (CI run 34475250785).
///
/// So: three retries, a 2 s ceiling on the delay, and a 2 s cap on each
/// connect attempt so a black-holed address cannot stall the loop either.
/// `exponent_base` is deliberately not set — redis 0.27 never reads it.
///
/// The reconnect bound is defence in depth, not the guarantee: callers on
/// a guest-facing path bound their own Redis calls with
/// [`crate::middleware::rate_limit::REDIS_CALL_TIMEOUT`].
pub fn connection_manager_config() -> ConnectionManagerConfig {
    ConnectionManagerConfig::new()
        .set_factor(RECONNECT_FACTOR)
        .set_number_of_retries(RECONNECT_RETRIES)
        .set_max_delay(RECONNECT_MAX_DELAY.as_millis() as u64)
        .set_connection_timeout(RECONNECT_MAX_DELAY)
}

/// Redis connection manager wrapper with automatic reconnection
#[derive(Clone)]
pub struct RedisManager {
    /// Connection manager that handles reconnection automatically
    pub connection: ConnectionManager,
}

impl RedisManager {
    /// Initialize a new Redis connection manager from the provided URL
    ///
    /// The connection manager automatically handles reconnection on failure.
    ///
    /// # Arguments
    /// * `redis_url` - Redis connection URL (e.g., "redis://localhost:6379")
    ///
    /// # Returns
    /// * `Result<Self>` - RedisManager instance or error
    pub async fn new(redis_url: &str) -> Result<Self> {
        let sanitized = Self::sanitize_url(redis_url);
        info!("Initializing Redis connection to {}", sanitized);

        let client = Client::open(redis_url).context("Failed to create Redis client")?;

        // ConnectionManager provides automatic reconnection — bounded, so a
        // Redis outage fails requests instead of parking them for minutes.
        // See `connection_manager_config`.
        let connection = ConnectionManager::new_with_config(client, connection_manager_config())
            .await
            .context("Failed to establish Redis connection")?;

        info!("Redis connection established successfully");

        Ok(Self { connection })
    }

    /// Initialize from REDIS_URL environment variable
    ///
    /// Falls back to "redis://localhost:6379" if not set
    pub async fn from_env() -> Result<Self> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());

        Self::new(&redis_url).await
    }

    /// Sanitize URL for logging (hide password if present)
    fn sanitize_url(url: &str) -> String {
        if let Some(at_pos) = url.find('@') {
            if let Some(colon_pos) = url[..at_pos].rfind(':') {
                let prefix = &url[..colon_pos + 1];
                let suffix = &url[at_pos..];
                return format!("{}****{}", prefix, suffix);
            }
        }
        url.to_string()
    }

    /// Get a mutable connection reference
    fn conn(&mut self) -> &mut ConnectionManager {
        &mut self.connection
    }

    // =========================================================================
    // Basic Operations
    // =========================================================================

    /// Get a string value by key
    ///
    /// # Arguments
    /// * `key` - The key to retrieve
    ///
    /// # Returns
    /// * `Result<Option<String>>` - The value if found, None if key doesn't exist
    pub async fn get(&mut self, key: &str) -> Result<Option<String>> {
        let result: Option<String> = self
            .conn()
            .get(key)
            .await
            .context("Failed to get key from Redis")?;

        debug!("Redis GET {}: {:?}", key, result.is_some());
        Ok(result)
    }

    /// Get and deserialize a JSON value by key
    ///
    /// # Arguments
    /// * `key` - The key to retrieve
    ///
    /// # Returns
    /// * `Result<Option<T>>` - The deserialized value if found
    pub async fn get_json<T: DeserializeOwned>(&mut self, key: &str) -> Result<Option<T>> {
        let value: Option<String> = self.get(key).await?;

        match value {
            Some(json_str) => {
                let parsed = serde_json::from_str(&json_str)
                    .context("Failed to deserialize JSON from Redis")?;
                Ok(Some(parsed))
            },
            None => Ok(None),
        }
    }

    /// Set a string value
    ///
    /// # Arguments
    /// * `key` - The key to set
    /// * `value` - The value to store
    pub async fn set(&mut self, key: &str, value: &str) -> Result<()> {
        let _: () = self
            .conn()
            .set(key, value)
            .await
            .context("Failed to set key in Redis")?;

        debug!("Redis SET {}", key);
        Ok(())
    }

    /// Set a string value with TTL (time to live)
    ///
    /// # Arguments
    /// * `key` - The key to set
    /// * `value` - The value to store
    /// * `ttl_secs` - Time to live in seconds
    pub async fn set_ex(&mut self, key: &str, value: &str, ttl_secs: u64) -> Result<()> {
        let _: () = self
            .conn()
            .set_ex(key, value, ttl_secs)
            .await
            .context("Failed to set key with TTL in Redis")?;

        debug!("Redis SETEX {} (TTL: {}s)", key, ttl_secs);
        Ok(())
    }

    /// Set a JSON-serializable value with optional TTL
    ///
    /// # Arguments
    /// * `key` - The key to set
    /// * `value` - The value to serialize and store
    /// * `ttl_secs` - Optional time to live in seconds
    pub async fn set_json<T: Serialize>(
        &mut self,
        key: &str,
        value: &T,
        ttl_secs: Option<u64>,
    ) -> Result<()> {
        let json_str = serde_json::to_string(value).context("Failed to serialize value to JSON")?;

        match ttl_secs {
            Some(ttl) => self.set_ex(key, &json_str, ttl).await,
            None => self.set(key, &json_str).await,
        }
    }

    /// Delete a key
    ///
    /// # Arguments
    /// * `key` - The key to delete
    ///
    /// # Returns
    /// * `Result<bool>` - True if key was deleted, false if it didn't exist
    pub async fn delete(&mut self, key: &str) -> Result<bool> {
        let deleted: i32 = self
            .conn()
            .del(key)
            .await
            .context("Failed to delete key from Redis")?;

        debug!("Redis DEL {}: {}", key, deleted > 0);
        Ok(deleted > 0)
    }

    /// Delete multiple keys
    ///
    /// # Arguments
    /// * `keys` - The keys to delete
    ///
    /// # Returns
    /// * `Result<i32>` - Number of keys deleted
    pub async fn delete_many(&mut self, keys: &[&str]) -> Result<i32> {
        if keys.is_empty() {
            return Ok(0);
        }

        let deleted: i32 = self
            .conn()
            .del(keys)
            .await
            .context("Failed to delete keys from Redis")?;

        debug!("Redis DEL {:?}: {} deleted", keys, deleted);
        Ok(deleted)
    }

    /// Check if a key exists
    ///
    /// # Arguments
    /// * `key` - The key to check
    ///
    /// # Returns
    /// * `Result<bool>` - True if key exists
    pub async fn exists(&mut self, key: &str) -> Result<bool> {
        let exists: bool = self
            .conn()
            .exists(key)
            .await
            .context("Failed to check key existence in Redis")?;

        debug!("Redis EXISTS {}: {}", key, exists);
        Ok(exists)
    }

    /// Set TTL on an existing key
    ///
    /// # Arguments
    /// * `key` - The key to expire
    /// * `ttl_secs` - Time to live in seconds
    ///
    /// # Returns
    /// * `Result<bool>` - True if TTL was set, false if key doesn't exist
    pub async fn expire(&mut self, key: &str, ttl_secs: u64) -> Result<bool> {
        let result: bool = self
            .conn()
            .expire(key, ttl_secs as i64)
            .await
            .context("Failed to set TTL in Redis")?;

        debug!("Redis EXPIRE {} {}s: {}", key, ttl_secs, result);
        Ok(result)
    }

    /// Get the remaining TTL of a key
    ///
    /// # Arguments
    /// * `key` - The key to check
    ///
    /// # Returns
    /// * `Result<Option<i64>>` - TTL in seconds, None if key doesn't exist or has no TTL
    pub async fn ttl(&mut self, key: &str) -> Result<Option<i64>> {
        let ttl: i64 = self
            .conn()
            .ttl(key)
            .await
            .context("Failed to get TTL from Redis")?;

        // Redis returns -2 if key doesn't exist, -1 if no TTL
        let result = if ttl >= 0 { Some(ttl) } else { None };
        debug!("Redis TTL {}: {:?}", key, result);
        Ok(result)
    }

    // =========================================================================
    // Session Storage Helpers
    // =========================================================================

    /// Store a user session
    ///
    /// # Arguments
    /// * `session_id` - Unique session identifier
    /// * `session_data` - Session data to store (must be serializable)
    /// * `ttl_secs` - Optional TTL in seconds (defaults to 24 hours)
    pub async fn set_session<T: Serialize>(
        &mut self,
        session_id: &str,
        session_data: &T,
        ttl_secs: Option<u64>,
    ) -> Result<()> {
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        let ttl = ttl_secs.unwrap_or(DEFAULT_SESSION_TTL_SECS);

        self.set_json(&key, session_data, Some(ttl)).await?;
        info!("Session stored: {} (TTL: {}s)", session_id, ttl);
        Ok(())
    }

    /// Retrieve a user session
    ///
    /// # Arguments
    /// * `session_id` - Session identifier to retrieve
    ///
    /// # Returns
    /// * `Result<Option<T>>` - Session data if found
    pub async fn get_session<T: DeserializeOwned>(
        &mut self,
        session_id: &str,
    ) -> Result<Option<T>> {
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        let session = self.get_json(&key).await?;

        if session.is_some() {
            debug!("Session retrieved: {}", session_id);
        } else {
            debug!("Session not found: {}", session_id);
        }

        Ok(session)
    }

    /// Delete a user session
    ///
    /// # Arguments
    /// * `session_id` - Session identifier to delete
    ///
    /// # Returns
    /// * `Result<bool>` - True if session was deleted
    pub async fn delete_session(&mut self, session_id: &str) -> Result<bool> {
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        let deleted = self.delete(&key).await?;

        if deleted {
            info!("Session deleted: {}", session_id);
        }

        Ok(deleted)
    }

    /// Refresh session TTL (extend expiration)
    ///
    /// # Arguments
    /// * `session_id` - Session identifier
    /// * `ttl_secs` - New TTL in seconds (defaults to 24 hours)
    ///
    /// # Returns
    /// * `Result<bool>` - True if session was refreshed, false if not found
    pub async fn refresh_session(
        &mut self,
        session_id: &str,
        ttl_secs: Option<u64>,
    ) -> Result<bool> {
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        let ttl = ttl_secs.unwrap_or(DEFAULT_SESSION_TTL_SECS);

        let refreshed = self.expire(&key, ttl).await?;

        if refreshed {
            debug!("Session refreshed: {} (new TTL: {}s)", session_id, ttl);
        }

        Ok(refreshed)
    }

    /// Check if a session exists
    ///
    /// # Arguments
    /// * `session_id` - Session identifier to check
    ///
    /// # Returns
    /// * `Result<bool>` - True if session exists
    pub async fn session_exists(&mut self, session_id: &str) -> Result<bool> {
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        self.exists(&key).await
    }

    // =========================================================================
    // Health Check
    // =========================================================================

    /// Check Redis connectivity
    ///
    /// # Returns
    /// * `Result<()>` - Ok if Redis is reachable
    pub async fn health_check(&mut self) -> Result<()> {
        redis::cmd("PING")
            .query_async::<String>(self.conn())
            .await
            .context("Redis health check failed")?;

        debug!("Redis health check passed");
        Ok(())
    }

    /// Get Redis info for monitoring
    pub async fn info(&mut self) -> Result<String> {
        let info: String = redis::cmd("INFO")
            .query_async::<String>(self.conn())
            .await
            .context("Failed to get Redis info")?;

        Ok(info)
    }
}

/// Session data structure for user sessions
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct UserSession {
    /// User ID
    pub user_id: uuid::Uuid,
    /// User email
    pub email: String,
    /// User role
    pub role: String,
    /// Session creation timestamp
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Last activity timestamp
    pub last_activity: chrono::DateTime<chrono::Utc>,
    /// IP address of the session
    pub ip_address: Option<String>,
    /// User agent string
    pub user_agent: Option<String>,
}

impl UserSession {
    /// Create a new user session
    pub fn new(
        user_id: uuid::Uuid,
        email: String,
        role: String,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Self {
        let now = chrono::Utc::now();
        Self {
            user_id,
            email,
            role,
            created_at: now,
            last_activity: now,
            ip_address,
            user_agent,
        }
    }

    /// Update last activity timestamp
    pub fn touch(&mut self) {
        self.last_activity = chrono::Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_url_with_password() {
        let url = "redis://:mypassword@localhost:6379";
        let sanitized = RedisManager::sanitize_url(url);
        assert_eq!(sanitized, "redis://:****@localhost:6379");
    }

    #[test]
    fn test_sanitize_url_without_password() {
        let url = "redis://localhost:6379";
        let sanitized = RedisManager::sanitize_url(url);
        assert_eq!(sanitized, "redis://localhost:6379");
    }

    #[test]
    fn test_sanitize_url_with_user_and_password() {
        let url = "redis://user:password@localhost:6379";
        let sanitized = RedisManager::sanitize_url(url);
        assert_eq!(sanitized, "redis://user:****@localhost:6379");
    }

    #[test]
    fn test_session_key_prefix() {
        assert_eq!(SESSION_PREFIX, "session:");
    }

    #[test]
    fn test_default_session_ttl() {
        assert_eq!(DEFAULT_SESSION_TTL_SECS, 86400); // 24 hours
    }

    #[test]
    fn test_user_session_new() {
        let user_id = uuid::Uuid::new_v4();
        let session = UserSession::new(
            user_id,
            "test@example.com".to_string(),
            "user".to_string(),
            Some("127.0.0.1".to_string()),
            Some("Mozilla/5.0".to_string()),
        );

        assert_eq!(session.user_id, user_id);
        assert_eq!(session.email, "test@example.com");
        assert_eq!(session.role, "user");
        assert_eq!(session.ip_address, Some("127.0.0.1".to_string()));
        assert_eq!(session.user_agent, Some("Mozilla/5.0".to_string()));
        assert_eq!(session.created_at, session.last_activity);
    }

    #[test]
    fn test_user_session_touch() {
        let user_id = uuid::Uuid::new_v4();
        let mut session = UserSession::new(
            user_id,
            "test@example.com".to_string(),
            "user".to_string(),
            None,
            None,
        );

        let original_created_at = session.created_at;
        std::thread::sleep(std::time::Duration::from_millis(10));
        session.touch();

        assert_eq!(session.created_at, original_created_at);
        assert!(session.last_activity >= original_created_at);
    }
}
