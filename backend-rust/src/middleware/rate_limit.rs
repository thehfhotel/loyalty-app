//! Rate Limiting Middleware
//!
//! Provides rate limiting functionality to protect the API from abuse.
//! This is a placeholder implementation that can be extended with Redis-backed
//! distributed rate limiting.

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::error::ErrorResponse;

/// Rate limit configuration
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Maximum number of requests allowed in the window
    pub max_requests: u32,
    /// Time window duration
    pub window: Duration,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests: 100,
            window: Duration::from_secs(60),
        }
    }
}

impl RateLimitConfig {
    /// Create a new rate limit config
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            max_requests,
            window: Duration::from_secs(window_secs),
        }
    }

    /// Strict rate limit for sensitive endpoints (e.g., login)
    pub fn strict() -> Self {
        Self {
            max_requests: 5,
            window: Duration::from_secs(60),
        }
    }

    /// Relaxed rate limit for read-heavy endpoints
    pub fn relaxed() -> Self {
        Self {
            max_requests: 1000,
            window: Duration::from_secs(60),
        }
    }
}

/// Track request counts per IP
#[derive(Debug)]
struct RequestTracker {
    count: u32,
    window_start: Instant,
}

/// In-memory rate limiter state
///
/// Note: This is suitable for single-instance deployments.
/// For distributed deployments, use Redis-backed rate limiting.
#[derive(Debug, Clone)]
pub struct RateLimiter {
    config: RateLimitConfig,
    requests: Arc<RwLock<HashMap<IpAddr, RequestTracker>>>,
}

impl RateLimiter {
    /// Create a new rate limiter with the given config
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            requests: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Check if a request from the given IP should be allowed
    pub async fn check(&self, ip: IpAddr) -> Result<(), RateLimitError> {
        let mut requests = self.requests.write().await;
        let now = Instant::now();

        let tracker = requests.entry(ip).or_insert(RequestTracker {
            count: 0,
            window_start: now,
        });

        // Reset window if expired
        if now.duration_since(tracker.window_start) >= self.config.window {
            tracker.count = 0;
            tracker.window_start = now;
        }

        // Check if limit exceeded
        if tracker.count >= self.config.max_requests {
            let retry_after =
                self.config.window.as_secs() - now.duration_since(tracker.window_start).as_secs();
            return Err(RateLimitError::TooManyRequests {
                retry_after: retry_after as u32,
            });
        }

        // Increment counter
        tracker.count += 1;
        Ok(())
    }

    /// Clean up expired entries to prevent memory growth
    pub async fn cleanup(&self) {
        let mut requests = self.requests.write().await;
        let now = Instant::now();
        let window = self.config.window;

        requests.retain(|_, tracker| now.duration_since(tracker.window_start) < window);
    }
}

/// Rate limit error
#[derive(Debug)]
pub enum RateLimitError {
    TooManyRequests { retry_after: u32 },
}

impl IntoResponse for RateLimitError {
    fn into_response(self) -> Response {
        match self {
            RateLimitError::TooManyRequests { retry_after } => {
                let body = Json(ErrorResponse {
                    error: "rate_limit_exceeded".to_string(),
                    message: format!(
                        "Too many requests. Please try again in {} seconds.",
                        retry_after
                    ),
                    details: None,
                });

                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(axum::http::header::RETRY_AFTER, retry_after.to_string())],
                    body,
                )
                    .into_response()
            },
        }
    }
}

/// Extract client IP from request
///
/// Checks X-Forwarded-For and X-Real-IP headers first (for reverse proxy setups),
/// then falls back to the connection IP.
fn get_client_ip(request: &Request) -> IpAddr {
    // Try X-Forwarded-For header first
    if let Some(forwarded) = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
    {
        // X-Forwarded-For can contain multiple IPs, take the first one
        if let Some(ip_str) = forwarded.split(',').next() {
            if let Ok(ip) = ip_str.trim().parse() {
                return ip;
            }
        }
    }

    // Try X-Real-IP header
    if let Some(real_ip) = request
        .headers()
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
    {
        if let Ok(ip) = real_ip.trim().parse() {
            return ip;
        }
    }

    // Fallback to loopback (in production, this should be the actual connection IP)
    // Note: Axum's ConnectInfo extractor should be used for production
    "127.0.0.1".parse().unwrap()
}

/// Rate limiting middleware
///
/// # Usage
///
/// ```rust,ignore
/// use axum::{Router, middleware};
/// use loyalty_backend::middleware::rate_limit::{rate_limit_middleware, RateLimiter, RateLimitConfig};
///
/// let rate_limiter = RateLimiter::new(RateLimitConfig::default());
///
/// let app = Router::new()
///     .route("/api/login", post(login))
///     .layer(middleware::from_fn_with_state(
///         rate_limiter,
///         rate_limit_middleware,
///     ));
/// ```
pub async fn rate_limit_middleware(
    axum::extract::State(limiter): axum::extract::State<RateLimiter>,
    request: Request,
    next: Next,
) -> Result<Response, RateLimitError> {
    let ip = get_client_ip(&request);
    limiter.check(ip).await?;
    Ok(next.run(request).await)
}

/// Create a rate limit layer with default configuration
///
/// This is a convenience function for common use cases.
pub fn default_rate_limit_layer() -> RateLimiter {
    RateLimiter::new(RateLimitConfig::default())
}

/// Create a strict rate limit layer for sensitive endpoints
pub fn strict_rate_limit_layer() -> RateLimiter {
    RateLimiter::new(RateLimitConfig::strict())
}

// TODO: Implement Redis-backed rate limiting for distributed deployments
//
// pub struct RedisRateLimiter {
//     client: redis::Client,
//     config: RateLimitConfig,
//     key_prefix: String,
// }
//
// impl RedisRateLimiter {
//     pub async fn check(&self, ip: IpAddr) -> Result<(), RateLimitError> {
//         // Use Redis INCR with EXPIRE for atomic rate limiting
//         // Key format: rate_limit:{prefix}:{ip}
//         // MULTI
//         // INCR key
//         // EXPIRE key window_secs NX
//         // EXEC
//     }
// }

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rate_limiter_allows_requests() {
        let limiter = RateLimiter::new(RateLimitConfig::new(5, 60));
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // First 5 requests should succeed
        for _ in 0..5 {
            assert!(limiter.check(ip).await.is_ok());
        }
    }

    #[tokio::test]
    async fn test_rate_limiter_blocks_excess_requests() {
        let limiter = RateLimiter::new(RateLimitConfig::new(3, 60));
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // First 3 requests should succeed
        for _ in 0..3 {
            assert!(limiter.check(ip).await.is_ok());
        }

        // 4th request should fail
        let result = limiter.check(ip).await;
        assert!(matches!(
            result,
            Err(RateLimitError::TooManyRequests { .. })
        ));
    }

    #[tokio::test]
    async fn test_rate_limiter_different_ips_independent() {
        let limiter = RateLimiter::new(RateLimitConfig::new(2, 60));
        let ip1: IpAddr = "192.168.1.1".parse().unwrap();
        let ip2: IpAddr = "192.168.1.2".parse().unwrap();

        // Both IPs should get their own quota
        assert!(limiter.check(ip1).await.is_ok());
        assert!(limiter.check(ip1).await.is_ok());
        assert!(limiter.check(ip2).await.is_ok());
        assert!(limiter.check(ip2).await.is_ok());

        // Both should now be limited
        assert!(limiter.check(ip1).await.is_err());
        assert!(limiter.check(ip2).await.is_err());
    }

    #[tokio::test]
    async fn test_rate_limiter_cleanup() {
        let limiter = RateLimiter::new(RateLimitConfig::new(100, 1));
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // Make a request to create an entry
        assert!(limiter.check(ip).await.is_ok());

        // Entry should exist
        assert!(!limiter.requests.read().await.is_empty());

        // Wait for window to expire
        tokio::time::sleep(Duration::from_secs(2)).await;

        // Cleanup should remove expired entries
        limiter.cleanup().await;
        assert!(limiter.requests.read().await.is_empty());
    }

    #[test]
    fn test_config_presets() {
        let default = RateLimitConfig::default();
        assert_eq!(default.max_requests, 100);
        assert_eq!(default.window, Duration::from_secs(60));

        let strict = RateLimitConfig::strict();
        assert_eq!(strict.max_requests, 5);

        let relaxed = RateLimitConfig::relaxed();
        assert_eq!(relaxed.max_requests, 1000);
    }
}
