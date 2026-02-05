//! CORS Configuration Middleware
//!
//! Configures Cross-Origin Resource Sharing (CORS) for the API,
//! allowing the frontend to make requests to the backend.

use axum::http::{HeaderValue, Method};
use tower_http::cors::{Any, CorsLayer};

/// Creates a CORS layer configured for the loyalty app
///
/// Configuration:
/// - Origin: Allowed from FRONTEND_URL environment variable (defaults to localhost:3000)
/// - Credentials: Allowed (for cookie-based auth)
/// - Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
/// - Headers: Content-Type, Authorization, X-Requested-With
/// - Max age: 1 hour (3600 seconds)
///
/// # Usage
///
/// ```rust,ignore
/// use axum::Router;
/// use loyalty_backend::middleware::cors::cors_layer;
///
/// let app = Router::new()
///     .route("/api/health", get(health))
///     .layer(cors_layer());
/// ```
pub fn cors_layer() -> CorsLayer {
    // Get frontend URL from environment, default to localhost for development
    let frontend_url = std::env::var("FRONTEND_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());

    // Parse the frontend URL into an allowed origin
    let allowed_origin = frontend_url
        .parse::<HeaderValue>()
        .unwrap_or_else(|_| HeaderValue::from_static("http://localhost:3000"));

    CorsLayer::new()
        // Allow the frontend origin
        .allow_origin(allowed_origin)
        // Allow credentials (cookies, authorization headers)
        .allow_credentials(true)
        // Allow common HTTP methods
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        // Allow common headers
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ACCEPT,
            axum::http::header::ORIGIN,
            axum::http::header::HeaderName::from_static("x-requested-with"),
        ])
        // Expose headers that the frontend can read
        .expose_headers([
            axum::http::header::CONTENT_LENGTH,
            axum::http::header::CONTENT_TYPE,
        ])
        // Cache preflight requests for 1 hour
        .max_age(std::time::Duration::from_secs(3600))
}

/// Creates a permissive CORS layer for development
///
/// WARNING: This should only be used in development environments.
/// It allows any origin to make requests.
///
/// # Usage
///
/// ```rust,ignore
/// use loyalty_backend::middleware::cors::cors_layer_permissive;
///
/// let cors = if cfg!(debug_assertions) {
///     cors_layer_permissive()
/// } else {
///     cors_layer()
/// };
/// ```
pub fn cors_layer_permissive() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_credentials(false) // Cannot use credentials with Any origin
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ACCEPT,
            axum::http::header::ORIGIN,
            axum::http::header::HeaderName::from_static("x-requested-with"),
        ])
        .max_age(std::time::Duration::from_secs(3600))
}

/// Creates a CORS layer with multiple allowed origins
///
/// Useful when the API needs to be accessed from multiple frontend URLs
/// (e.g., staging and production, or multiple subdomains).
///
/// # Arguments
///
/// * `origins` - List of allowed origin URLs
///
/// # Usage
///
/// ```rust,ignore
/// use loyalty_backend::middleware::cors::cors_layer_multiple_origins;
///
/// let cors = cors_layer_multiple_origins(vec![
///     "https://app.example.com",
///     "https://staging.example.com",
/// ]);
/// ```
pub fn cors_layer_multiple_origins(origins: Vec<&str>) -> CorsLayer {
    let allowed_origins: Vec<HeaderValue> = origins
        .into_iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ACCEPT,
            axum::http::header::ORIGIN,
            axum::http::header::HeaderName::from_static("x-requested-with"),
        ])
        .expose_headers([
            axum::http::header::CONTENT_LENGTH,
            axum::http::header::CONTENT_TYPE,
        ])
        .max_age(std::time::Duration::from_secs(3600))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cors_layer_creation() {
        // Just verify that the layer can be created without panicking
        let _layer = cors_layer();
    }

    #[test]
    fn test_cors_layer_permissive_creation() {
        let _layer = cors_layer_permissive();
    }

    #[test]
    fn test_cors_layer_multiple_origins_creation() {
        let _layer = cors_layer_multiple_origins(vec![
            "http://localhost:3000",
            "https://example.com",
        ]);
    }

    #[test]
    fn test_cors_layer_multiple_origins_filters_invalid() {
        // Invalid origins should be filtered out, not cause a panic
        let _layer = cors_layer_multiple_origins(vec![
            "http://localhost:3000",
            "", // Invalid
            "https://example.com",
        ]);
    }
}
