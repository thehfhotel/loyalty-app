//! CSRF token routes
//!
//! Provides endpoint for CSRF token generation using double-submit cookie pattern.

use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, HeaderValue},
    routing::get,
    Json, Router,
};
use rand::Rng;
use serde::Serialize;

use crate::state::AppState;

/// CSRF token response
#[derive(Serialize)]
pub struct CsrfTokenResponse {
    #[serde(rename = "csrfToken")]
    pub csrf_token: String,
}

/// Generate a cryptographically secure CSRF token
fn generate_csrf_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// Determine if cookies should be secure (HTTPS only)
fn should_use_secure_cookies(state: &AppState) -> bool {
    state.is_production()
}

/// CSRF token endpoint handler
/// Returns a CSRF token and sets it in an HttpOnly cookie
///
/// Client flow:
/// 1. Call GET /api/csrf-token to get token
/// 2. Include token in X-CSRF-Token header for subsequent POST/PUT/DELETE requests
/// 3. Server validates header matches cookie value
async fn get_csrf_token(State(state): State<AppState>) -> (HeaderMap, Json<CsrfTokenResponse>) {
    let token = generate_csrf_token();

    // Build cookie attributes
    let secure = if should_use_secure_cookies(&state) {
        "; Secure"
    } else {
        ""
    };

    let cookie_value = format!(
        "XSRF-TOKEN={}; HttpOnly; SameSite=Strict; Max-Age=86400; Path=/{}",
        token, secure
    );

    let mut headers = HeaderMap::new();
    if let Ok(header_value) = HeaderValue::from_str(&cookie_value) {
        headers.insert(SET_COOKIE, header_value);
    }

    (headers, Json(CsrfTokenResponse { csrf_token: token }))
}

/// Create CSRF routes
pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(get_csrf_token))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_csrf_token() {
        let token = generate_csrf_token();
        assert_eq!(token.len(), 64); // 32 bytes = 64 hex chars
    }

    #[test]
    fn test_csrf_token_uniqueness() {
        let token1 = generate_csrf_token();
        let token2 = generate_csrf_token();
        assert_ne!(token1, token2);
    }
}
