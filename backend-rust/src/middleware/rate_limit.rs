//! Rate Limiting Middleware
//!
//! Provides rate limiting functionality to protect the API from abuse.
//! This is a placeholder implementation that can be extended with Redis-backed
//! distributed rate limiting.

use axum::{
    extract::{ConnectInfo, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
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

/// Extract client IP from the request's underlying TCP peer.
///
/// HIGH-2 (security-2026-05-13.md): `X-Forwarded-For` and `X-Real-IP` are
/// supplied by the client. nginx's `proxy_add_x_forwarded_for` previously
/// *appended* whatever the client sent, leaving the leftmost (read first)
/// value attacker-controlled — every rotated header value got its own
/// rate-limit bucket, defeating the strict 5/min auth limit and the
/// global 100/min limit. nginx is now configured to *replace* the header
/// with `$remote_addr`, but the limiter no longer trusts those headers
/// at all: it reads `axum::extract::ConnectInfo<SocketAddr>` which is the
/// actual TCP peer that opened the connection.
///
/// `ConnectInfo` is wired up in `main.rs` via
/// `into_make_service_with_connect_info::<SocketAddr>()`. If for some
/// reason the extension is missing (test harnesses, misconfiguration),
/// we fall back to `127.0.0.1` — that places every such request in a
/// single shared bucket, which is the safe-by-default behaviour.
fn get_client_ip(request: &Request) -> IpAddr {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip())
        .unwrap_or_else(|| {
            "127.0.0.1"
                .parse()
                .expect("127.0.0.1 is a valid IPv4 literal")
        })
}

/// The hops whose `X-Forwarded-For` this process is willing to believe.
///
/// Parsed once from `SecurityConfig::trusted_proxies` (a comma-separated
/// list of bare IPs and CIDR blocks) and then asked, per request, whether
/// the TCP peer is one of them.
///
/// The rule this type exists to keep honest: **a forwarding header is
/// evidence only about the hop that wrote it.** [`get_client_ip`] answers
/// the general case by refusing to read those headers at all (HIGH-2), and
/// that stays right for every authenticated route, where the peer being
/// nginx costs nothing — the limiter has a user id to count.
///
/// The public deposit routes have no user id. Their subject *is* the
/// client address, and behind nginx the peer is the nginx container for
/// every request on earth, so keying on the peer would put every guest in
/// the world in one bucket: three people paying at once would 429 each
/// other in the middle of a payment. There the header has to be read — and
/// [`resolve_client_ip`] reads it only when this type says the peer is a
/// hop we put there ourselves.
#[derive(Debug, Clone, Default)]
pub struct TrustedProxies {
    /// (network address, prefix length). An entry with no `/len` is stored
    /// as a full-width prefix, i.e. that single address.
    nets: Vec<(IpAddr, u8)>,
}

impl TrustedProxies {
    /// Parse a comma-separated list of IPs and CIDR blocks.
    ///
    /// The literal `none` (any case, alone or as an entry) trusts nothing.
    /// An entry that does not parse is dropped with a warning rather than
    /// failing startup: a typo in one CIDR must not take the service down,
    /// and dropping it fails in the safe direction (one fewer trusted hop).
    pub fn parse(list: &str) -> Self {
        let mut nets = Vec::new();
        for raw in list.split(',') {
            let entry = raw.trim();
            if entry.is_empty() || entry.eq_ignore_ascii_case("none") {
                continue;
            }
            match parse_cidr(entry) {
                Some(net) => nets.push(net),
                None => tracing::warn!(
                    entry = %entry,
                    "ignoring an unparseable TRUSTED_PROXIES entry"
                ),
            }
        }
        Self { nets }
    }

    /// Is this address one of the hops we trust to have set the header?
    pub fn contains(&self, ip: IpAddr) -> bool {
        self.nets
            .iter()
            .any(|&(net, bits)| ip_in_net(ip, net, bits))
    }

    /// True when nothing is trusted, i.e. every limiter keys on the peer.
    pub fn is_empty(&self) -> bool {
        self.nets.is_empty()
    }
}

/// `a.b.c.d`, `a.b.c.d/len`, `::1` or `2001:db8::/32`.
fn parse_cidr(entry: &str) -> Option<(IpAddr, u8)> {
    let (addr, bits) = match entry.split_once('/') {
        Some((addr, len)) => (addr, Some(len.parse::<u8>().ok()?)),
        None => (entry, None),
    };
    let addr: IpAddr = addr.parse().ok()?;
    let width = if addr.is_ipv4() { 32 } else { 128 };
    let bits = bits.unwrap_or(width);
    if bits > width {
        return None;
    }
    Some((addr, bits))
}

/// Prefix comparison. Mixed families never match — an IPv4-mapped IPv6
/// peer is deliberately not unwrapped, because a proxy that presents one
/// is not the deployment this list describes.
fn ip_in_net(ip: IpAddr, net: IpAddr, bits: u8) -> bool {
    match (ip, net) {
        (IpAddr::V4(a), IpAddr::V4(b)) => prefix_eq(&a.octets(), &b.octets(), bits),
        (IpAddr::V6(a), IpAddr::V6(b)) => prefix_eq(&a.octets(), &b.octets(), bits),
        _ => false,
    }
}

fn prefix_eq(a: &[u8], b: &[u8], bits: u8) -> bool {
    let bits = (bits as usize).min(a.len() * 8);
    let whole = bits / 8;
    if a[..whole] != b[..whole] {
        return false;
    }
    let rest = bits % 8;
    if rest == 0 {
        return true;
    }
    let mask = 0xffu8 << (8 - rest);
    (a[whole] & mask) == (b[whole] & mask)
}

/// The header nginx writes the client address into (`$remote_addr`, and it
/// **replaces** rather than appends — see nginx/nginx.conf).
const X_FORWARDED_FOR: &str = "x-forwarded-for";
/// Cloudflare's own client-address header, used as the fallback when the
/// trusted hop forwarded nothing.
const CF_CONNECTING_IP: &str = "cf-connecting-ip";

/// The address a public, unauthenticated route should count against.
///
/// - Peer not trusted (or nothing trusted): **the peer**, full stop. That
///   is [`get_client_ip`]'s rule and it is what protects the budget from a
///   client that invents its own `X-Forwarded-For`.
/// - Peer trusted: the **first** address in `X-Forwarded-For` — the one
///   furthest from us, i.e. the original client, as our own nginx writes
///   it. Falling back to `CF-Connecting-IP` when the header is absent or
///   unparseable, and to the peer when neither is usable.
///
/// The first entry is the right one *because* the trusted hop replaces the
/// header rather than appending to it. If nginx is ever changed back to
/// `proxy_add_x_forwarded_for`, the leftmost value becomes client-supplied
/// again and this function becomes a way to mint a fresh bucket per
/// request — the nginx config and this function are one decision, not two.
pub fn resolve_client_ip(
    peer: Option<IpAddr>,
    headers: &axum::http::HeaderMap,
    trusted: &TrustedProxies,
) -> IpAddr {
    let peer = peer.unwrap_or_else(|| {
        "127.0.0.1"
            .parse()
            .expect("127.0.0.1 is a valid IPv4 literal")
    });

    if !trusted.contains(peer) {
        return peer;
    }

    let forwarded = headers
        .get(X_FORWARDED_FOR)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .and_then(|first| first.trim().parse::<IpAddr>().ok());
    if let Some(ip) = forwarded {
        return ip;
    }

    headers
        .get(CF_CONNECTING_IP)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<IpAddr>().ok())
        .unwrap_or(peer)
}

/// The TCP peer, when the connection info is available.
///
/// Separate from [`get_client_ip`] because [`resolve_client_ip`] has to
/// tell "no peer known" from "the peer is loopback": the first has no
/// forwarding hop to trust, the second may well have one.
pub fn peer_ip(request: &Request) -> Option<IpAddr> {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip())
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

/// Redis-backed rate limiter for distributed deployments
///
/// Uses atomic Redis operations (INCR with EXPIRE) to track request counts
/// across multiple server instances. This is the recommended approach for
/// production deployments with load balancing.
///
/// # Key Format
/// Keys are stored as: `rate_limit:{prefix}:{ip}`
///
/// # Example
/// ```rust,ignore
/// use redis::aio::ConnectionManager;
/// use loyalty_backend::middleware::rate_limit::{RedisRateLimiter, RateLimitConfig};
///
/// let redis_conn = ConnectionManager::new(client).await?;
/// let limiter = RedisRateLimiter::new(redis_conn, RateLimitConfig::default(), "api");
///
/// // Check if request is allowed
/// limiter.check("192.168.1.1".parse().unwrap()).await?;
/// ```
#[derive(Clone)]
pub struct RedisRateLimiter {
    /// Redis connection manager (handles reconnection automatically)
    redis: redis::aio::ConnectionManager,
    /// Rate limit configuration
    config: RateLimitConfig,
    /// Key prefix for namespacing rate limit keys
    key_prefix: String,
}

impl RedisRateLimiter {
    /// Create a new Redis-backed rate limiter
    ///
    /// # Arguments
    /// * `redis` - Redis connection manager from AppState
    /// * `config` - Rate limit configuration
    /// * `key_prefix` - Prefix for Redis keys (e.g., "api", "auth", "login")
    pub fn new(
        redis: redis::aio::ConnectionManager,
        config: RateLimitConfig,
        key_prefix: impl Into<String>,
    ) -> Self {
        Self {
            redis,
            config,
            key_prefix: key_prefix.into(),
        }
    }

    /// Create a rate limiter with default configuration
    pub fn with_defaults(
        redis: redis::aio::ConnectionManager,
        key_prefix: impl Into<String>,
    ) -> Self {
        Self::new(redis, RateLimitConfig::default(), key_prefix)
    }

    /// Create a strict rate limiter for sensitive endpoints
    pub fn strict(redis: redis::aio::ConnectionManager, key_prefix: impl Into<String>) -> Self {
        Self::new(redis, RateLimitConfig::strict(), key_prefix)
    }

    /// Check if a request from the given IP should be allowed
    ///
    /// Uses Redis INCR with EXPIRE for atomic rate limiting.
    /// The expiration is only set on the first request in a window (NX flag).
    ///
    /// # Returns
    /// - `Ok(())` if the request is allowed
    /// - `Err(RateLimitError::TooManyRequests)` if the limit is exceeded
    /// - `Err(RateLimitError::RedisError)` if Redis communication fails
    pub async fn check(&self, ip: IpAddr) -> Result<(), RateLimitError> {
        self.check_subject(&ip.to_string()).await
    }

    /// Check a request against an arbitrary subject rather than an IP.
    ///
    /// Every limiter in the codebase counts per client IP, which is the
    /// right subject when the caller is identified by nothing else. The
    /// public deposit-link upload has a second subject that matters more:
    /// the link itself. A guest re-uploading a slip from a phone that
    /// changes IP between attempts is still one link, and one link is the
    /// unit the "5 uploads per hour" budget is about.
    ///
    /// `subject` must never be a raw capability token — pass a hash. The
    /// key lands in Redis and in the log line on a Redis failure, and a
    /// token in either is a live link in a place it does not belong.
    pub async fn check_subject(&self, subject: &str) -> Result<(), RateLimitError> {
        let key = format!("rate_limit:{}:{}", self.key_prefix, subject);
        let window_secs = self.config.window.as_secs() as i64;
        let mut conn = self.redis.clone();

        // Atomic increment and get current count
        // Uses a Lua script to ensure atomicity of INCR + EXPIRE NX
        let script = redis::Script::new(
            r#"
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
                redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            local ttl = redis.call('TTL', KEYS[1])
            return {current, ttl}
            "#,
        );

        let result: Result<(i64, i64), redis::RedisError> = script
            .key(&key)
            .arg(window_secs)
            .invoke_async(&mut conn)
            .await;

        match result {
            Ok((count, ttl)) => {
                if count > self.config.max_requests as i64 {
                    let retry_after = if ttl > 0 {
                        ttl as u32
                    } else {
                        window_secs as u32
                    };
                    return Err(RateLimitError::TooManyRequests { retry_after });
                }
                Ok(())
            },
            Err(e) => {
                // Log the error but fail open to prevent blocking legitimate requests
                // when Redis is temporarily unavailable
                tracing::warn!("Redis rate limit check failed: {}. Allowing request.", e);
                Ok(())
            },
        }
    }

    /// Get the current request count for an IP without incrementing
    ///
    /// Useful for debugging and monitoring.
    pub async fn get_count(&self, ip: IpAddr) -> Result<u32, RateLimitError> {
        use redis::AsyncCommands;

        let key = format!("rate_limit:{}:{}", self.key_prefix, ip);
        let mut conn = self.redis.clone();

        match conn.get::<_, Option<u32>>(&key).await {
            Ok(Some(count)) => Ok(count),
            Ok(None) => Ok(0),
            Err(e) => {
                tracing::warn!("Redis get_count failed: {}", e);
                Ok(0)
            },
        }
    }

    /// Reset the rate limit for an IP
    ///
    /// Useful for testing or manual intervention.
    pub async fn reset(&self, ip: IpAddr) -> Result<(), RateLimitError> {
        let key = format!("rate_limit:{}:{}", self.key_prefix, ip);
        let mut conn = self.redis.clone();

        let result: Result<(), redis::RedisError> =
            redis::cmd("DEL").arg(&key).query_async(&mut conn).await;

        if let Err(e) = result {
            tracing::warn!("Redis reset failed: {}", e);
        }
        Ok(())
    }

    /// Get the remaining requests for an IP in the current window
    pub async fn get_remaining(&self, ip: IpAddr) -> Result<u32, RateLimitError> {
        let count = self.get_count(ip).await?;
        let remaining = self.config.max_requests.saturating_sub(count);
        Ok(remaining)
    }
}

/// Rate limiting middleware using Redis-backed limiter
///
/// # Usage
/// ```rust,ignore
/// use axum::{Router, middleware};
/// use loyalty_backend::middleware::rate_limit::{redis_rate_limit_middleware, RedisRateLimiter};
///
/// let limiter = RedisRateLimiter::new(redis_conn, RateLimitConfig::default(), "api");
///
/// let app = Router::new()
///     .route("/api/login", post(login))
///     .layer(middleware::from_fn_with_state(
///         limiter,
///         redis_rate_limit_middleware,
///     ));
/// ```
pub async fn redis_rate_limit_middleware(
    axum::extract::State(limiter): axum::extract::State<RedisRateLimiter>,
    request: Request,
    next: Next,
) -> Result<Response, RateLimitError> {
    let ip = get_client_ip(&request);
    limiter.check(ip).await?;
    Ok(next.run(request).await)
}

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

    // ----------------------------------------------------------------
    // get_client_ip — HIGH-2 regression guard
    //
    // The limiter must read the actual TCP peer from
    // `ConnectInfo<SocketAddr>` and IGNORE attacker-controlled
    // `X-Forwarded-For` / `X-Real-IP` headers. These tests assemble a
    // synthetic `Request` with both a `ConnectInfo` extension and
    // spoofed headers, then assert the chosen IP comes from
    // `ConnectInfo`.
    // ----------------------------------------------------------------

    use axum::body::Body;

    #[test]
    fn get_client_ip_reads_connect_info_extension() {
        let peer: SocketAddr = "203.0.113.42:54321".parse().unwrap();
        let mut req = axum::http::Request::builder()
            .uri("/api/health")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(ConnectInfo(peer));

        let ip = get_client_ip(&req);

        assert_eq!(ip, "203.0.113.42".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn get_client_ip_ignores_spoofed_x_forwarded_for() {
        let peer: SocketAddr = "203.0.113.42:54321".parse().unwrap();
        let mut req = axum::http::Request::builder()
            .uri("/api/auth/login")
            .header("x-forwarded-for", "1.1.1.1, 2.2.2.2")
            .header("x-real-ip", "9.9.9.9")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(ConnectInfo(peer));

        // Even with attacker-supplied forwarding headers present, the
        // chosen IP must be the TCP peer from ConnectInfo, not 1.1.1.1
        // or 9.9.9.9 — otherwise an attacker could rotate header values
        // and get a fresh rate-limit bucket per request.
        let ip = get_client_ip(&req);
        assert_eq!(ip, "203.0.113.42".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn get_client_ip_falls_back_to_loopback_without_connect_info() {
        // No ConnectInfo extension (would be a routing/test bug in real
        // code). The function must not panic and should return a stable
        // value so all such requests share a single bucket.
        let req = axum::http::Request::builder()
            .uri("/")
            .header("x-forwarded-for", "8.8.8.8")
            .body(Body::empty())
            .unwrap();

        let ip = get_client_ip(&req);
        assert_eq!(ip, "127.0.0.1".parse::<IpAddr>().unwrap());
    }

    // ----------------------------------------------------------------
    // TrustedProxies / resolve_client_ip
    //
    // The public deposit routes count per client IP, and behind nginx the
    // TCP peer is the same container for every guest on earth. These
    // tests pin the two halves of the rule: the header is read ONLY when
    // the peer is a hop we put there, and when it is read it is the first
    // address (our nginx replaces the header rather than appending).
    // ----------------------------------------------------------------

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test IP literal")
    }

    fn headers(pairs: &[(&str, &str)]) -> axum::http::HeaderMap {
        let mut map = axum::http::HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                axum::http::HeaderValue::from_str(value).expect("header value"),
            );
        }
        map
    }

    fn compose_default() -> TrustedProxies {
        TrustedProxies::parse("127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    }

    #[test]
    fn trusted_proxies_matches_cidr_blocks_and_bare_addresses() {
        let trusted = compose_default();
        assert!(trusted.contains(ip("172.18.0.7")), "compose bridge network");
        assert!(trusted.contains(ip("127.0.0.1")));
        assert!(trusted.contains(ip("10.1.2.3")));
        assert!(trusted.contains(ip("192.168.1.9")));
        assert!(trusted.contains(ip("::1")));
        // Outside every listed block.
        assert!(!trusted.contains(ip("203.0.113.9")));
        assert!(!trusted.contains(ip("172.32.0.1")), "just past 172.16/12");
        assert!(!trusted.contains(ip("2001:db8::1")));

        let single = TrustedProxies::parse(" 203.0.113.7 ");
        assert!(single.contains(ip("203.0.113.7")));
        assert!(!single.contains(ip("203.0.113.8")));
    }

    #[test]
    fn trusted_proxies_none_and_junk_trust_nothing() {
        assert!(TrustedProxies::parse("none").is_empty());
        assert!(TrustedProxies::parse("NONE").is_empty());
        assert!(TrustedProxies::parse("").is_empty());
        assert!(TrustedProxies::parse("   ,  ").is_empty());
        // A typo drops that entry and keeps the rest.
        let mixed = TrustedProxies::parse("172.16.0.0/12,not-an-ip,10.0.0.0/99");
        assert!(mixed.contains(ip("172.20.0.1")));
        assert!(!mixed.contains(ip("10.0.0.1")), "/99 is not a v4 prefix");
    }

    #[test]
    fn resolve_client_ip_reads_the_forwarded_client_behind_a_trusted_hop() {
        let trusted = compose_default();
        let resolved = resolve_client_ip(
            Some(ip("172.18.0.5")),
            &headers(&[("x-forwarded-for", "203.0.113.9")]),
            &trusted,
        );
        assert_eq!(resolved, ip("203.0.113.9"));
    }

    #[test]
    fn resolve_client_ip_takes_the_first_forwarded_address() {
        // If a hop ever appends instead of replacing, the leftmost value
        // is the original client — and the one this function must use.
        let resolved = resolve_client_ip(
            Some(ip("172.18.0.5")),
            &headers(&[("x-forwarded-for", " 203.0.113.9 , 10.0.0.4 ")]),
            &compose_default(),
        );
        assert_eq!(resolved, ip("203.0.113.9"));
    }

    #[test]
    fn resolve_client_ip_ignores_the_header_from_an_untrusted_peer() {
        // The whole HIGH-2 lesson: a client that opens a connection to us
        // directly can claim any address it likes, and must not be
        // believed.
        let resolved = resolve_client_ip(
            Some(ip("203.0.113.42")),
            &headers(&[
                ("x-forwarded-for", "1.1.1.1"),
                ("cf-connecting-ip", "9.9.9.9"),
            ]),
            &compose_default(),
        );
        assert_eq!(resolved, ip("203.0.113.42"));

        // ...and with nothing trusted at all, not even the compose peer.
        let resolved = resolve_client_ip(
            Some(ip("172.18.0.5")),
            &headers(&[("x-forwarded-for", "1.1.1.1")]),
            &TrustedProxies::parse("none"),
        );
        assert_eq!(resolved, ip("172.18.0.5"));
    }

    #[test]
    fn resolve_client_ip_falls_back_to_cf_connecting_ip_then_to_the_peer() {
        let trusted = compose_default();
        assert_eq!(
            resolve_client_ip(
                Some(ip("172.18.0.5")),
                &headers(&[("cf-connecting-ip", "198.51.100.7")]),
                &trusted,
            ),
            ip("198.51.100.7"),
            "no XFF, so Cloudflare's header is the next best evidence"
        );
        assert_eq!(
            resolve_client_ip(
                Some(ip("172.18.0.5")),
                &headers(&[
                    ("x-forwarded-for", "unknown"),
                    ("cf-connecting-ip", "198.51.100.7"),
                ]),
                &trusted,
            ),
            ip("198.51.100.7"),
            "an unparseable XFF is no evidence at all"
        );
        assert_eq!(
            resolve_client_ip(Some(ip("172.18.0.5")), &headers(&[]), &trusted),
            ip("172.18.0.5"),
            "nothing forwarded: the peer is all we know"
        );
    }

    #[test]
    fn resolve_client_ip_without_connect_info_reads_the_header() {
        // The test harness drives the router with `oneshot`, which
        // inserts no `ConnectInfo`. Treating "no peer" as loopback keeps
        // that path on the trusted side, so a test can present two
        // clients by setting the header — exactly what production does.
        assert_eq!(
            resolve_client_ip(
                None,
                &headers(&[("x-forwarded-for", "203.0.113.9")]),
                &compose_default(),
            ),
            ip("203.0.113.9")
        );
    }

    // Redis rate limiter tests require a running Redis instance
    // These are integration tests that should be run with:
    // cargo test -- --ignored

    #[tokio::test]
    #[ignore = "Requires running Redis instance"]
    async fn test_redis_rate_limiter_allows_requests() {
        use redis::aio::ConnectionManager;

        let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let conn = ConnectionManager::new(client).await.unwrap();
        let limiter = RedisRateLimiter::new(conn, RateLimitConfig::new(5, 60), "test");
        let ip: IpAddr = "192.168.100.1".parse().unwrap();

        // Reset any existing state
        limiter.reset(ip).await.unwrap();

        // First 5 requests should succeed
        for _ in 0..5 {
            assert!(limiter.check(ip).await.is_ok());
        }

        // 6th request should fail
        let result = limiter.check(ip).await;
        assert!(matches!(
            result,
            Err(RateLimitError::TooManyRequests { .. })
        ));

        // Cleanup
        limiter.reset(ip).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "Requires running Redis instance"]
    async fn test_redis_rate_limiter_get_remaining() {
        use redis::aio::ConnectionManager;

        let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let conn = ConnectionManager::new(client).await.unwrap();
        let limiter = RedisRateLimiter::new(conn, RateLimitConfig::new(10, 60), "test_remaining");
        let ip: IpAddr = "192.168.100.2".parse().unwrap();

        // Reset any existing state
        limiter.reset(ip).await.unwrap();

        // Initially should have all requests remaining
        let remaining = limiter.get_remaining(ip).await.unwrap();
        assert_eq!(remaining, 10);

        // Make 3 requests
        for _ in 0..3 {
            limiter.check(ip).await.unwrap();
        }

        // Should have 7 remaining
        let remaining = limiter.get_remaining(ip).await.unwrap();
        assert_eq!(remaining, 7);

        // Cleanup
        limiter.reset(ip).await.unwrap();
    }
}
