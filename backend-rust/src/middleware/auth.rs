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
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};

use crate::error::ErrorResponse;

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
        let (status, message) = match self {
            AuthError::MissingToken => (StatusCode::UNAUTHORIZED, "Missing authentication token"),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid authentication token"),
            AuthError::ExpiredToken => (StatusCode::UNAUTHORIZED, "Authentication token has expired"),
            AuthError::MalformedHeader => (StatusCode::UNAUTHORIZED, "Malformed authorization header"),
        };

        let body = Json(ErrorResponse {
            error: "unauthorized".to_string(),
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
        }
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
pub async fn auth_middleware(
    mut request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    // Get JWT secret from environment
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "development-secret-change-in-production".to_string());

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
pub async fn optional_auth_middleware(
    mut request: Request,
    next: Next,
) -> Response {
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "development-secret-change-in-production".to_string());

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
    let auth_user = request
        .extensions()
        .get::<AuthUser>()
        .ok_or_else(|| {
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
    use jsonwebtoken::{encode, EncodingKey, Header};
    use chrono::Utc;

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
        let secret = "test-secret-key";
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
        let secret = "test-secret-key";
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
}
