//! JWT Authentication Middleware
//!
//! Extracts and validates JWT tokens from the Authorization header,
//! making user claims available to route handlers via request extensions.

use axum::{
    extract::Request,
    http::{header::AUTHORIZATION, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::cookie::Cookie;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::error::ErrorResponse;

// ============================================================================
// Refresh-token Cookie Helpers (Phase 1 of HttpOnly cookie migration)
// ============================================================================

/// Cookie name for the refresh token.
///
/// Phase 1 of the migration to HttpOnly-cookie refresh tokens. The cookie is
/// emitted alongside the existing JSON `refreshToken` field so the frontend
/// can keep using `localStorage` until Phase 2 switches it over.
pub const REFRESH_COOKIE_NAME: &str = "refresh_token";

/// Cookie path the refresh-token cookie is scoped to.
///
/// Limiting the path to `/api/auth` means the cookie is only sent on the
/// auth endpoints (login, logout, refresh) — not on every API call. This
/// reduces the blast radius if any future endpoint were to log raw cookies.
pub const REFRESH_COOKIE_PATH: &str = "/api/auth";

/// Build the `Set-Cookie` value for the refresh token.
///
/// Returns the fully-formatted `Set-Cookie` header value (without the field
/// name). Use [`refresh_cookie_for_jar`] to get an `axum_extra::Cookie` for
/// adding to a `CookieJar` extractor instead.
///
/// Attributes (defense-in-depth against XSS / CSRF):
/// - `HttpOnly`: prevents `document.cookie` access from JS, neutralising XSS
///   attempts to steal the refresh token.
/// - `Secure`: forces HTTPS-only transport. Production runs behind Cloudflare
///   over HTTPS, so this is unconditional. Local dev over plain HTTP simply
///   won't see the cookie applied — that's acceptable during the migration
///   because the JSON `refreshToken` field is still returned (Phase 1).
/// - `SameSite=Strict`: blocks cross-site requests from sending the cookie,
///   defending against CSRF.
/// - `Path=/api/auth`: scopes the cookie to the auth endpoints only.
/// - `Max-Age`: aligns with the refresh-token expiry stored server-side so
///   the browser drops the cookie at the same time the DB row expires.
///
/// We build the header string by hand rather than using `Cookie::build()...`
/// because the `cookie` crate's `max_age()` setter requires a `time::Duration`
/// from the `time` crate, which isn't a direct dependency. Hand-building keeps
/// the dependency surface minimal and makes the exact wire format obvious.
pub fn build_refresh_cookie_header(token: &str, max_age_secs: i64) -> String {
    let safe_max_age = max_age_secs.max(0);
    format!(
        "{name}={value}; Max-Age={max_age}; Path={path}; HttpOnly; Secure; SameSite=Strict",
        name = REFRESH_COOKIE_NAME,
        value = token,
        max_age = safe_max_age,
        path = REFRESH_COOKIE_PATH,
    )
}

/// Build a `Set-Cookie` value that clears the refresh-token cookie.
///
/// Setting `Max-Age=0` with the same `Path` and security attributes tells the
/// browser to drop the cookie immediately. Used by `/api/auth/logout`.
pub fn build_clear_refresh_cookie_header() -> String {
    build_refresh_cookie_header("", 0)
}

/// Build an `axum_extra::Cookie` for the refresh token suitable for adding to
/// a `CookieJar` returned from a handler.
///
/// Defers to [`build_refresh_cookie_header`] for the wire format and parses
/// the result back into a `Cookie`. The `Cookie::parse_encoded` round-trip
/// guarantees the two paths produce byte-identical headers and lets us reuse
/// one source of truth for cookie attributes.
pub fn build_refresh_cookie(token: String, max_age_secs: i64) -> Cookie<'static> {
    let header = build_refresh_cookie_header(&token, max_age_secs);
    Cookie::parse_encoded(header)
        .expect("refresh cookie header is well-formed by construction")
        .into_owned()
}

/// Build an `axum_extra::Cookie` that clears the refresh-token cookie when
/// added to a `CookieJar`.
pub fn build_clear_refresh_cookie() -> Cookie<'static> {
    let header = build_clear_refresh_cookie_header();
    Cookie::parse_encoded(header)
        .expect("clear cookie header is well-formed by construction")
        .into_owned()
}

/// JWT secret wrapper for injection via Extension layer.
///
/// This allows the auth middleware to read the JWT secret from AppState config
/// (injected in `create_router`) rather than from environment variables,
/// ensuring tests can provide their own secret via test config.
#[derive(Clone)]
pub struct JwtSecret(pub String);

/// JWT claims structure matching the Node.js backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// User ID (UUID)
    pub id: String,
    /// User email (optional for OAuth users)
    pub email: Option<String>,
    /// User role (customer, admin, super_admin)
    pub role: String,
    /// Issued at timestamp
    pub iat: Option<i64>,
    /// Expiration timestamp
    pub exp: i64,
}

/// User context extracted from JWT, available in request extensions
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub email: Option<String>,
    pub role: String,
}

impl From<Claims> for AuthUser {
    fn from(claims: Claims) -> Self {
        Self {
            id: claims.id,
            email: claims.email,
            role: claims.role,
        }
    }
}

/// Authentication error types
#[derive(Debug)]
pub enum AuthError {
    MissingToken,
    InvalidToken,
    ExpiredToken,
    MalformedHeader,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, error, message) = match self {
            AuthError::MissingToken => (
                StatusCode::UNAUTHORIZED,
                "No token provided",
                "Missing authentication token",
            ),
            AuthError::InvalidToken => (
                StatusCode::UNAUTHORIZED,
                "Invalid token",
                "Invalid authentication token",
            ),
            AuthError::ExpiredToken => (
                StatusCode::UNAUTHORIZED,
                "Token expired",
                "Authentication token has expired",
            ),
            AuthError::MalformedHeader => (
                StatusCode::UNAUTHORIZED,
                "No token provided",
                "Malformed authorization header",
            ),
        };

        let body = Json(ErrorResponse {
            error: error.to_string(),
            message: message.to_string(),
            details: None,
        });

        (status, body).into_response()
    }
}

/// Extract Bearer token from Authorization header
fn extract_bearer_token(auth_header: &str) -> Result<&str, AuthError> {
    // Check for "Bearer " prefix (case-insensitive)
    if auth_header.len() < 7 {
        return Err(AuthError::MalformedHeader);
    }

    let prefix = &auth_header[..7];
    if !prefix.eq_ignore_ascii_case("bearer ") {
        return Err(AuthError::MalformedHeader);
    }

    let token = auth_header[7..].trim();
    if token.is_empty() {
        return Err(AuthError::MissingToken);
    }

    Ok(token)
}

/// Validate JWT token and extract claims
fn validate_token(token: &str, jwt_secret: &str) -> Result<Claims, AuthError> {
    let decoding_key = DecodingKey::from_secret(jwt_secret.as_bytes());

    let mut validation = Validation::new(Algorithm::HS256);
    // Allow some clock skew (60 seconds)
    validation.leeway = 60;

    match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(token_data) => Ok(token_data.claims),
        Err(err) => {
            tracing::debug!("JWT validation error: {:?}", err);
            match err.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => Err(AuthError::ExpiredToken),
                _ => Err(AuthError::InvalidToken),
            }
        },
    }
}

/// JWT authentication middleware
///
/// This middleware:
/// 1. Extracts the Bearer token from the Authorization header
/// 2. Validates the JWT signature and expiration
/// 3. Extracts user claims and adds AuthUser to request extensions
/// 4. Returns 401 Unauthorized for invalid/expired/missing tokens
///
/// # Usage
///
/// ```rust,ignore
/// use axum::{Router, middleware};
/// use loyalty_backend::middleware::auth::auth_middleware;
///
/// let protected_routes = Router::new()
///     .route("/protected", get(handler))
///     .layer(middleware::from_fn_with_state(state, auth_middleware));
/// ```
pub async fn auth_middleware(mut request: Request, next: Next) -> Result<Response, AuthError> {
    // The JwtSecret extension is injected at the top of the router tree by
    // `create_router`. A missing extension means the auth middleware is being
    // used outside that router (a routing/test bug). We refuse to validate
    // tokens in that case rather than silently fall back to an env var or a
    // hard-coded development secret — both of which previously masked exactly
    // this kind of misconfiguration in production.
    let jwt_secret = request
        .extensions()
        .get::<JwtSecret>()
        .map(|s| s.0.clone())
        .ok_or_else(|| {
            tracing::error!("auth_middleware reached without JwtSecret extension — routing bug");
            AuthError::InvalidToken
        })?;

    // Extract Authorization header
    let auth_header = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(AuthError::MissingToken)?;

    // Extract and validate token
    let token = extract_bearer_token(auth_header)?;
    let claims = validate_token(token, &jwt_secret)?;

    // Add user info to request extensions
    let auth_user = AuthUser::from(claims);
    request.extensions_mut().insert(auth_user);

    // Continue to next handler
    Ok(next.run(request).await)
}

/// Optional authentication middleware
///
/// Similar to auth_middleware, but does not fail on missing/invalid tokens.
/// Instead, it simply doesn't add AuthUser to extensions if authentication fails.
/// Useful for routes that work differently for authenticated vs unauthenticated users.
pub async fn optional_auth_middleware(mut request: Request, next: Next) -> Response {
    // No JwtSecret extension means we cannot validate tokens; treat the
    // request as anonymous (the same outcome a missing/invalid token would
    // produce). Falling back to env vars or hard-coded secrets here is
    // dangerous — see auth_middleware.
    let Some(jwt_secret) = request.extensions().get::<JwtSecret>().map(|s| s.0.clone()) else {
        tracing::warn!(
            "optional_auth_middleware reached without JwtSecret extension — treating request as anonymous"
        );
        return next.run(request).await;
    };

    // Try to extract and validate token, but don't fail if not present
    if let Some(auth_header) = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        if let Ok(token) = extract_bearer_token(auth_header) {
            if let Ok(claims) = validate_token(token, &jwt_secret) {
                let auth_user = AuthUser::from(claims);
                request.extensions_mut().insert(auth_user);
            }
        }
    }

    next.run(request).await
}

/// Role-based authorization check
///
/// Returns true if the user has the required role or higher privilege level.
/// Role hierarchy: super_admin > admin > customer
pub fn has_role(user: &AuthUser, required_role: &str) -> bool {
    match required_role {
        "customer" => true, // Any authenticated user
        "admin" => user.role == "admin" || user.role == "super_admin",
        "super_admin" => user.role == "super_admin",
        _ => false,
    }
}

/// Require specific role middleware factory
///
/// Creates a middleware that checks if the authenticated user has the required role.
/// Must be used after auth_middleware.
///
/// # Usage
///
/// ```rust,ignore
/// use axum::{Router, middleware};
/// use loyalty_backend::middleware::auth::{auth_middleware, require_role};
///
/// let admin_routes = Router::new()
///     .route("/admin", get(admin_handler))
///     .layer(middleware::from_fn(|req, next| require_role(req, next, "admin")))
///     .layer(middleware::from_fn(auth_middleware));
/// ```
pub async fn require_role(
    request: Request,
    next: Next,
    required_role: &'static str,
) -> Result<Response, Response> {
    let auth_user = request.extensions().get::<AuthUser>().ok_or_else(|| {
        let body = Json(ErrorResponse {
            error: "unauthorized".to_string(),
            message: "Authentication required".to_string(),
            details: None,
        });
        (StatusCode::UNAUTHORIZED, body).into_response()
    })?;

    if !has_role(auth_user, required_role) {
        let body = Json(ErrorResponse {
            error: "forbidden".to_string(),
            message: format!("Insufficient permissions. Required role: {}", required_role),
            details: None,
        });
        return Err((StatusCode::FORBIDDEN, body).into_response());
    }

    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use jsonwebtoken::{encode, EncodingKey, Header};

    fn create_test_token(claims: &Claims, secret: &str) -> String {
        encode(
            &Header::default(),
            claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    #[test]
    fn test_extract_bearer_token_valid() {
        let token = extract_bearer_token("Bearer abc123").unwrap();
        assert_eq!(token, "abc123");
    }

    #[test]
    fn test_extract_bearer_token_case_insensitive() {
        let token = extract_bearer_token("bearer abc123").unwrap();
        assert_eq!(token, "abc123");
    }

    #[test]
    fn test_extract_bearer_token_missing_token() {
        let result = extract_bearer_token("Bearer ");
        assert!(matches!(result, Err(AuthError::MissingToken)));
    }

    #[test]
    fn test_extract_bearer_token_malformed() {
        let result = extract_bearer_token("Basic abc123");
        assert!(matches!(result, Err(AuthError::MalformedHeader)));
    }

    #[test]
    fn test_validate_token_valid() {
        let secret = "test-secret-for-jsonwebtoken-10-min-32-bytes-hs256-padding-x";
        let claims = Claims {
            id: "user-123".to_string(),
            email: Some("test@example.com".to_string()),
            role: "customer".to_string(),
            iat: Some(Utc::now().timestamp()),
            exp: Utc::now().timestamp() + 3600,
        };

        let token = create_test_token(&claims, secret);
        let result = validate_token(&token, secret).unwrap();

        assert_eq!(result.id, "user-123");
        assert_eq!(result.email, Some("test@example.com".to_string()));
        assert_eq!(result.role, "customer");
    }

    #[test]
    fn test_validate_token_expired() {
        let secret = "test-secret-for-jsonwebtoken-10-min-32-bytes-hs256-padding-x";
        let claims = Claims {
            id: "user-123".to_string(),
            email: Some("test@example.com".to_string()),
            role: "customer".to_string(),
            iat: Some(Utc::now().timestamp() - 7200),
            exp: Utc::now().timestamp() - 3600, // Expired 1 hour ago
        };

        let token = create_test_token(&claims, secret);
        let result = validate_token(&token, secret);

        assert!(matches!(result, Err(AuthError::ExpiredToken)));
    }

    #[test]
    fn test_validate_token_invalid_signature() {
        let claims = Claims {
            id: "user-123".to_string(),
            email: Some("test@example.com".to_string()),
            role: "customer".to_string(),
            iat: Some(Utc::now().timestamp()),
            exp: Utc::now().timestamp() + 3600,
        };

        let token = create_test_token(&claims, "secret1");
        let result = validate_token(&token, "secret2");

        assert!(matches!(result, Err(AuthError::InvalidToken)));
    }

    #[test]
    fn test_has_role_customer() {
        let user = AuthUser {
            id: "1".to_string(),
            email: None,
            role: "customer".to_string(),
        };

        assert!(has_role(&user, "customer"));
        assert!(!has_role(&user, "admin"));
        assert!(!has_role(&user, "super_admin"));
    }

    #[test]
    fn test_has_role_admin() {
        let user = AuthUser {
            id: "1".to_string(),
            email: None,
            role: "admin".to_string(),
        };

        assert!(has_role(&user, "customer"));
        assert!(has_role(&user, "admin"));
        assert!(!has_role(&user, "super_admin"));
    }

    #[test]
    fn test_has_role_super_admin() {
        let user = AuthUser {
            id: "1".to_string(),
            email: None,
            role: "super_admin".to_string(),
        };

        assert!(has_role(&user, "customer"));
        assert!(has_role(&user, "admin"));
        assert!(has_role(&user, "super_admin"));
    }

    // ------------------------------------------------------------------
    // Refresh-token cookie helper tests
    // ------------------------------------------------------------------

    #[test]
    fn test_build_refresh_cookie_header_has_all_required_attributes() {
        let header = build_refresh_cookie_header("token-value-abc", 604_800);

        assert!(header.starts_with("refresh_token=token-value-abc"));
        assert!(header.contains("HttpOnly"));
        assert!(header.contains("Secure"));
        assert!(header.contains("SameSite=Strict"));
        assert!(header.contains("Path=/api/auth"));
        assert!(header.contains("Max-Age=604800"));
    }

    #[test]
    fn test_build_refresh_cookie_header_clamps_negative_max_age_to_zero() {
        // Defensive: if the caller passes a negative duration (e.g. computed
        // from a stale `expires_at` timestamp), we clamp to 0 rather than
        // emitting a malformed `Max-Age=-N` that browsers would reject.
        let header = build_refresh_cookie_header("tok", -42);
        assert!(header.contains("Max-Age=0"), "header was: {header}");
    }

    #[test]
    fn test_build_refresh_cookie_returns_axum_extra_cookie_with_same_attrs() {
        // The CookieJar-friendly variant must produce exactly the same wire
        // format as the raw header builder — both paths share one source of
        // truth so login (which uses CookieJar) and OAuth callbacks (which
        // append a raw header) cannot drift apart.
        let cookie = build_refresh_cookie("xyz".to_string(), 3600);
        let serialised = cookie.to_string();

        assert!(serialised.contains("refresh_token=xyz"));
        assert!(serialised.contains("HttpOnly"));
        assert!(serialised.contains("Secure"));
        assert!(serialised.contains("SameSite=Strict"));
        assert!(serialised.contains("Path=/api/auth"));
        assert!(serialised.contains("Max-Age=3600"));
    }

    #[test]
    fn test_build_clear_refresh_cookie_header_is_zero_max_age_with_empty_value() {
        let header = build_clear_refresh_cookie_header();

        assert!(header.starts_with("refresh_token=;"));
        assert!(header.contains("Max-Age=0"));
        assert!(header.contains("HttpOnly"));
        assert!(header.contains("Secure"));
        assert!(header.contains("SameSite=Strict"));
        assert!(header.contains("Path=/api/auth"));
    }

    #[test]
    fn test_build_clear_refresh_cookie_returns_cookiejar_compatible_clear_cookie() {
        let cookie = build_clear_refresh_cookie();
        let serialised = cookie.to_string();

        assert!(
            serialised.starts_with("refresh_token=") && !serialised.starts_with("refresh_token=x"),
            "Cookie value should be empty so the browser drops the entry: {serialised}"
        );
        assert!(serialised.contains("Max-Age=0"), "header was: {serialised}");
        assert!(serialised.contains("HttpOnly"));
        assert!(serialised.contains("Secure"));
        assert!(serialised.contains("SameSite=Strict"));
        assert!(serialised.contains("Path=/api/auth"));
    }
}
