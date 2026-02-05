//! OAuth authentication routes
//!
//! Provides OAuth 2.0 authentication endpoints for Google and LINE providers.
//! Handles OAuth flow initiation, callbacks, and account linking.

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::Utc;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::state::AppState;

// =============================================================================
// Constants
// =============================================================================

/// OAuth 2.0 standard error codes (RFC 6749 Section 4.1.2.1)
const OAUTH_ERROR_CODES: &[&str] = &[
    "invalid_request",
    "unauthorized_client",
    "access_denied",
    "unsupported_response_type",
    "invalid_scope",
    "server_error",
    "temporarily_unavailable",
    "interaction_required",
    "login_required",
    "consent_required",
];

/// OAuth state expiration time in seconds (10 minutes)
const OAUTH_STATE_EXPIRY_SECS: u64 = 600;

// =============================================================================
// Types
// =============================================================================

/// OAuth state data stored in Redis for CSRF protection
#[derive(Debug, Serialize, Deserialize)]
struct OAuthStateData {
    /// Session ID (if available)
    session_id: Option<String>,
    /// User ID (for account linking)
    user_id: Option<String>,
    /// User agent string
    user_agent: String,
    /// Timestamp when state was created
    timestamp: i64,
    /// URL to return to after OAuth
    return_url: String,
    /// OAuth provider (google or line)
    provider: String,
    /// Original request URL
    original_url: String,
    /// Client IP address
    ip: String,
    /// Whether the request was secure (HTTPS)
    secure: bool,
    /// Request host
    host: String,
    /// Whether request came from PWA
    is_pwa: bool,
    /// Whether running in standalone mode
    is_standalone: bool,
    /// Platform (web, ios, android)
    platform: String,
}

/// Query parameters for OAuth initiation
#[derive(Debug, Deserialize)]
pub struct OAuthInitQuery {
    return_url: Option<String>,
    pwa: Option<String>,
    standalone: Option<String>,
    platform: Option<String>,
}

/// Query parameters for OAuth callback
#[derive(Debug, Deserialize)]
pub struct OAuthCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Request body for linking OAuth provider
#[derive(Debug, Deserialize)]
pub struct LinkProviderRequest {
    code: String,
}

/// Token response from OAuth providers
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OAuthTokenResponse {
    access_token: String,
    token_type: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

/// Google user info response
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GoogleUserInfo {
    id: String,
    email: Option<String>,
    verified_email: Option<bool>,
    name: Option<String>,
    given_name: Option<String>,
    family_name: Option<String>,
    picture: Option<String>,
}

/// LINE profile response
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LineProfile {
    user_id: String,
    display_name: String,
    #[serde(default)]
    picture_url: Option<String>,
    #[serde(default)]
    status_message: Option<String>,
}

/// Authentication result after OAuth processing
#[derive(Debug, Serialize)]
pub struct OAuthResult {
    user: UserResponse,
    tokens: TokenResponse,
    is_new_user: bool,
}

/// User response for OAuth result
#[derive(Debug, Serialize, Deserialize)]
pub struct UserResponse {
    id: String,
    email: Option<String>,
    role: String,
    is_active: bool,
    email_verified: bool,
    oauth_provider: Option<String>,
}

/// Token response for OAuth result
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenResponse {
    access_token: String,
    refresh_token: String,
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Validates and sanitizes OAuth return URLs to prevent open redirect attacks.
/// Only allows redirects to the same origin as the configured frontend URL.
fn validate_return_url(input_url: Option<&str>, frontend_url: &str) -> String {
    let default_url = frontend_url.to_string();

    let Some(url) = input_url else {
        return default_url;
    };

    // Extract origin from frontend URL for comparison
    let frontend_origin = extract_origin(frontend_url);
    let input_origin = extract_origin(url);

    // Only allow redirects to the same origin
    if let (Some(fo), Some(io)) = (frontend_origin, input_origin) {
        if fo == io {
            return url.to_string();
        }
    }

    tracing::warn!(
        attempted_url = url,
        allowed_origin = frontend_url,
        "[OAuth] Blocked potential open redirect attempt"
    );
    default_url
}

/// Extract origin (scheme + host + port) from a URL string
fn extract_origin(url: &str) -> Option<String> {
    // Handle URLs starting with http:// or https://
    let rest = if url.starts_with("https://") {
        &url[8..]
    } else if url.starts_with("http://") {
        &url[7..]
    } else {
        return None;
    };

    // Find the end of the host (first / or end of string)
    let host_end = rest.find('/').unwrap_or(rest.len());
    let host_port = &rest[..host_end];

    // Reconstruct origin
    let scheme = if url.starts_with("https://") {
        "https://"
    } else {
        "http://"
    };

    Some(format!("{}{}", scheme, host_port))
}

/// Validates if the error query parameter is a legitimate OAuth error code.
fn is_valid_oauth_error(error: &str) -> bool {
    OAUTH_ERROR_CODES.contains(&error)
}

/// Simple percent-encoding for URL query parameters
/// Encodes characters that are not unreserved according to RFC 3986
fn url_encode(input: &str) -> String {
    let mut result = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        match byte {
            // Unreserved characters (RFC 3986)
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            },
            // Encode everything else
            _ => {
                result.push('%');
                result.push_str(&format!("{:02X}", byte));
            },
        }
    }
    result
}

/// Generate a random state key for OAuth CSRF protection
fn generate_state_key() -> String {
    use rand::Rng;
    let bytes: [u8; 32] = rand::thread_rng().gen();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

/// Create OAuth state and store in Redis
async fn create_oauth_state(state: &AppState, data: OAuthStateData) -> AppResult<String> {
    let state_key = generate_state_key();
    let redis_key = format!("oauth_state:{}:{}", data.provider, state_key);

    let json_data =
        serde_json::to_string(&data).map_err(|e| AppError::Serialization(e.to_string()))?;

    let mut redis = state.redis();
    redis
        .set_ex::<_, _, ()>(&redis_key, &json_data, OAUTH_STATE_EXPIRY_SECS)
        .await
        .map_err(AppError::Redis)?;

    Ok(state_key)
}

/// Retrieve and validate OAuth state from Redis
async fn get_oauth_state(
    state: &AppState,
    state_key: &str,
    provider: &str,
) -> AppResult<Option<OAuthStateData>> {
    let redis_key = format!("oauth_state:{}:{}", provider, state_key);

    let mut redis = state.redis();
    let data: Option<String> = redis.get(&redis_key).await.map_err(AppError::Redis)?;

    match data {
        Some(json_data) => {
            let state_data: OAuthStateData = serde_json::from_str(&json_data)
                .map_err(|e| AppError::Serialization(e.to_string()))?;
            Ok(Some(state_data))
        },
        None => Ok(None),
    }
}

/// Delete OAuth state from Redis
async fn delete_oauth_state(state: &AppState, state_key: &str, provider: &str) -> AppResult<()> {
    let redis_key = format!("oauth_state:{}:{}", provider, state_key);

    let mut redis = state.redis();
    redis
        .del::<_, ()>(&redis_key)
        .await
        .map_err(AppError::Redis)?;

    Ok(())
}

/// Build mobile-friendly HTML redirect response
fn build_html_redirect(url: &str, message: &str) -> Response {
    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0;url={url}">
</head>
<body>
    <script>
        window.location.href = '{url}';
    </script>
    <p>{message}</p>
    <p>If you are not redirected automatically, <a href="{url}">click here</a>.</p>
</body>
</html>"#,
        url = url,
        message = message
    );

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
            (header::PRAGMA, "no-cache"),
        ],
        html,
    )
        .into_response()
}

/// Check if user agent indicates mobile Safari
fn is_mobile_safari(user_agent: &str) -> bool {
    let is_mobile = user_agent.contains("iPhone")
        || user_agent.contains("iPad")
        || user_agent.contains("iPod")
        || user_agent.contains("Android");
    let is_safari = user_agent.contains("Safari")
        && !user_agent.contains("Chrome")
        && !user_agent.contains("CriOS");
    is_mobile && is_safari
}

/// Generate JWT tokens for a user
async fn generate_tokens(
    state: &AppState,
    user_id: &str,
    email: Option<&str>,
    role: &str,
) -> AppResult<TokenResponse> {
    use jsonwebtoken::{encode, EncodingKey, Header};

    let now = Utc::now();
    let access_exp = now.timestamp() + state.jwt_expiration();
    let refresh_exp = now.timestamp() + (7 * 24 * 3600); // 7 days

    // Access token claims
    let access_claims = serde_json::json!({
        "id": user_id,
        "email": email,
        "role": role,
        "iat": now.timestamp(),
        "exp": access_exp,
    });

    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(state.jwt_secret().as_bytes()),
    )
    .map_err(AppError::Jwt)?;

    // Refresh token claims
    let refresh_claims = serde_json::json!({
        "id": user_id,
        "type": "refresh",
        "iat": now.timestamp(),
        "exp": refresh_exp,
    });

    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(state.jwt_secret().as_bytes()),
    )
    .map_err(AppError::Jwt)?;

    Ok(TokenResponse {
        access_token,
        refresh_token,
    })
}

// =============================================================================
// Google OAuth Handlers
// =============================================================================

/// GET /api/oauth/google - Initiate Google OAuth flow
async fn google_oauth_init(
    State(state): State<AppState>,
    Query(query): Query<OAuthInitQuery>,
    headers: axum::http::HeaderMap,
) -> Response {
    let config = state.config();
    let frontend_url = &config.server.frontend_url;

    // Check if Google OAuth is configured
    let Some(client_id) = config.oauth.google.client_id.as_ref() else {
        tracing::warn!("[OAuth] Google OAuth not configured");
        return Redirect::to(&format!(
            "{}/login?error=google_not_configured",
            frontend_url
        ))
        .into_response();
    };

    // Extract request metadata
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let return_url = validate_return_url(query.return_url.as_deref(), frontend_url);
    let is_pwa = query.pwa.as_deref() == Some("true");
    let is_standalone = query.standalone.as_deref() == Some("true");
    let platform = query.platform.clone().unwrap_or_else(|| "web".to_string());

    // Create OAuth state for CSRF protection
    let state_data = OAuthStateData {
        session_id: None,
        user_id: None,
        user_agent: user_agent.to_string(),
        timestamp: Utc::now().timestamp_millis(),
        return_url: return_url.clone(),
        provider: "google".to_string(),
        original_url: "/api/oauth/google".to_string(),
        ip: "unknown".to_string(),
        secure: true,
        host: headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("localhost")
            .to_string(),
        is_pwa,
        is_standalone,
        platform,
    };

    let state_key = match create_oauth_state(&state, state_data).await {
        Ok(key) => key,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Failed to create OAuth state");
            return Redirect::to(&format!("{}/login?error=oauth_error", frontend_url))
                .into_response();
        },
    };

    // Build Google OAuth URL
    let callback_url = &config.oauth.google.callback_url;
    let scope = "profile email";
    let google_oauth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
        url_encode(client_id),
        url_encode(callback_url),
        url_encode(scope),
        url_encode(&state_key)
    );

    tracing::debug!(
        state_key = %state_key,
        is_mobile_safari = is_mobile_safari(user_agent),
        "[OAuth] Initiating Google OAuth"
    );

    // Use HTML redirect for mobile Safari compatibility
    if is_mobile_safari(user_agent) {
        build_html_redirect(&google_oauth_url, "Redirecting to Google...")
    } else {
        Redirect::to(&google_oauth_url).into_response()
    }
}

/// GET /api/oauth/google/callback - Handle Google OAuth callback
async fn google_oauth_callback(
    State(state): State<AppState>,
    Query(query): Query<OAuthCallbackQuery>,
    headers: axum::http::HeaderMap,
) -> Response {
    let config = state.config();
    let frontend_url = &config.server.frontend_url;
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Check for OAuth errors
    if let Some(error) = &query.error {
        if is_valid_oauth_error(error) {
            tracing::error!(
                error = %error,
                description = query.error_description.as_deref().unwrap_or("No description"),
                "[OAuth] Google OAuth error"
            );
        }
        return build_error_redirect(frontend_url, "oauth_provider_error", user_agent);
    }

    // Validate required parameters
    let (code, state_key) = match (query.code.as_ref(), query.state.as_ref()) {
        (Some(c), Some(s)) if !c.is_empty() && !s.is_empty() => (c.as_str(), s.as_str()),
        _ => {
            tracing::error!("[OAuth] Google callback missing parameters");
            return build_error_redirect(frontend_url, "oauth_invalid", user_agent);
        },
    };

    // Retrieve and validate OAuth state
    let state_data = match get_oauth_state(&state, state_key, "google").await {
        Ok(Some(data)) => data,
        Ok(None) => {
            tracing::error!(state_key = %state_key, "[OAuth] Invalid or expired OAuth state");
            return build_error_redirect(frontend_url, "session_expired", user_agent);
        },
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Failed to retrieve OAuth state");
            return build_error_redirect(frontend_url, "oauth_error", user_agent);
        },
    };

    tracing::debug!(
        state_age_ms = Utc::now().timestamp_millis() - state_data.timestamp,
        "[OAuth] Google OAuth state recovered"
    );

    // Exchange code for tokens
    let tokens = match exchange_google_code(&state, code).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Google token exchange failed");
            return build_error_redirect(
                &validate_return_url(Some(&state_data.return_url), frontend_url),
                "oauth_token_failed",
                user_agent,
            );
        },
    };

    // Get user info from Google
    let user_info = match get_google_user_info(&tokens.access_token).await {
        Ok(info) => info,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Failed to get Google user info");
            return build_error_redirect(
                &validate_return_url(Some(&state_data.return_url), frontend_url),
                "oauth_profile_failed",
                user_agent,
            );
        },
    };

    // Process Google authentication
    let result = match process_google_auth(&state, user_info).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Google auth processing failed");
            return build_error_redirect(
                &validate_return_url(Some(&state_data.return_url), frontend_url),
                "oauth_processing_failed",
                user_agent,
            );
        },
    };

    // Clean up state
    if let Err(e) = delete_oauth_state(&state, state_key, "google").await {
        tracing::warn!(error = ?e, "[OAuth] Failed to delete OAuth state");
    }

    // Build success redirect URL
    let return_url = validate_return_url(Some(&state_data.return_url), frontend_url);
    let success_url = format!(
        "{}/oauth/success?token={}&refreshToken={}&isNewUser={}",
        return_url,
        url_encode(&result.tokens.access_token),
        url_encode(&result.tokens.refresh_token),
        result.is_new_user
    );

    tracing::info!(
        user_id = %result.user.id,
        email = result.user.email.as_deref().unwrap_or("none"),
        is_new_user = result.is_new_user,
        "[OAuth] Google OAuth success"
    );

    if is_mobile_safari(user_agent) {
        build_html_redirect(&success_url, "Authentication successful! Redirecting...")
    } else {
        Redirect::to(&success_url).into_response()
    }
}

/// Exchange Google authorization code for tokens
async fn exchange_google_code(state: &AppState, code: &str) -> AppResult<OAuthTokenResponse> {
    let config = state.config();
    let client_id =
        config.oauth.google.client_id.as_ref().ok_or_else(|| {
            AppError::Configuration("Google client ID not configured".to_string())
        })?;
    let client_secret = config.oauth.google.client_secret.as_ref().ok_or_else(|| {
        AppError::Configuration("Google client secret not configured".to_string())
    })?;

    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &config.oauth.google.callback_url),
        ("client_id", client_id),
        ("client_secret", client_secret),
    ];

    let client = reqwest::Client::new();
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(AppError::HttpRequest)?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        tracing::error!(error = %error_text, "[OAuth] Google token exchange failed");
        return Err(AppError::OAuth(format!(
            "Token exchange failed: {}",
            error_text
        )));
    }

    response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(AppError::HttpRequest)
}

/// Get user info from Google using access token
async fn get_google_user_info(access_token: &str) -> AppResult<GoogleUserInfo> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(AppError::HttpRequest)?;

    if !response.status().is_success() {
        return Err(AppError::OAuth("Failed to get user info".to_string()));
    }

    response
        .json::<GoogleUserInfo>()
        .await
        .map_err(AppError::HttpRequest)
}

/// Process Google authentication and create/update user
async fn process_google_auth(
    state: &AppState,
    user_info: GoogleUserInfo,
) -> AppResult<OAuthResult> {
    let email = user_info
        .email
        .as_ref()
        .ok_or_else(|| AppError::OAuth("No email provided by Google".to_string()))?;

    tracing::debug!(
        email = %email,
        google_id = %user_info.id,
        "[OAuth] Processing Google auth"
    );

    let db = state.db();

    // Check if user exists by email or OAuth provider ID
    let existing_user: Option<(String, Option<String>, String, bool, bool, Option<String>)> =
        sqlx::query_as(
            r#"SELECT id::text, email, role::text, is_active, email_verified, oauth_provider
           FROM users
           WHERE email = $1 OR (oauth_provider = 'google' AND oauth_provider_id = $2)"#,
        )
        .bind(email)
        .bind(&user_info.id)
        .fetch_optional(db)
        .await
        .map_err(AppError::Database)?;

    let (user, is_new_user) = if let Some((
        id,
        user_email,
        role,
        is_active,
        email_verified,
        oauth_provider,
    )) = existing_user
    {
        tracing::debug!(user_id = %id, "[OAuth] Existing Google user found");

        // Update profile if needed
        let first_name = user_info.given_name.as_deref().unwrap_or("");
        let last_name = user_info.family_name.as_deref().unwrap_or("");
        let avatar_url = user_info.picture.as_deref();

        if !first_name.is_empty() || !last_name.is_empty() || avatar_url.is_some() {
            sqlx::query(
                r#"UPDATE user_profiles
                   SET first_name = COALESCE(NULLIF($2, ''), first_name),
                       last_name = COALESCE(NULLIF($3, ''), last_name),
                       avatar_url = CASE
                         WHEN avatar_url IS NULL OR (avatar_url NOT LIKE '/storage/%' AND avatar_url NOT LIKE 'emoji:%')
                         THEN COALESCE(NULLIF($4, ''), avatar_url)
                         ELSE avatar_url
                       END,
                       updated_at = NOW()
                   WHERE user_id = $1::uuid"#,
            )
            .bind(&id)
            .bind(first_name)
            .bind(last_name)
            .bind(avatar_url)
            .execute(db)
            .await
            .map_err(AppError::Database)?;
        }

        // Mark email as verified if not already
        if !email_verified {
            sqlx::query(
                "UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1::uuid",
            )
            .bind(&id)
            .execute(db)
            .await
            .map_err(AppError::Database)?;
        }

        // Update OAuth provider info if not set
        if oauth_provider.is_none() {
            sqlx::query(
                "UPDATE users SET oauth_provider = 'google', oauth_provider_id = $2, updated_at = NOW() WHERE id = $1::uuid",
            )
            .bind(&id)
            .bind(&user_info.id)
            .execute(db)
            .await
            .map_err(AppError::Database)?;
        }

        let user = UserResponse {
            id,
            email: user_email,
            role,
            is_active,
            email_verified: true,
            oauth_provider: Some("google".to_string()),
        };

        (user, false)
    } else {
        // Create new user
        tracing::debug!(email = %email, "[OAuth] Creating new Google user");

        let user_id = Uuid::new_v4();
        let first_name = user_info
            .given_name
            .as_deref()
            .or_else(|| {
                user_info
                    .name
                    .as_ref()
                    .map(|n| n.split(' ').next().unwrap_or(""))
            })
            .unwrap_or("");
        let last_name = user_info
            .family_name
            .clone()
            .or_else(|| {
                user_info.name.as_ref().map(|n| {
                    let parts: Vec<&str> = n.split(' ').collect();
                    if parts.len() > 1 {
                        parts[1..].join(" ")
                    } else {
                        String::new()
                    }
                })
            })
            .unwrap_or_default();
        let avatar_url = user_info.picture.as_deref();

        // Create user
        sqlx::query(
            r#"INSERT INTO users (id, email, password_hash, email_verified, oauth_provider, oauth_provider_id, role, is_active)
               VALUES ($1, $2, '', true, 'google', $3, 'customer', true)"#,
        )
        .bind(user_id)
        .bind(email)
        .bind(&user_info.id)
        .execute(db)
        .await
        .map_err(AppError::Database)?;

        // Generate membership ID
        let membership_id = generate_membership_id(state).await?;

        // Create user profile
        sqlx::query(
            r#"INSERT INTO user_profiles (user_id, first_name, last_name, avatar_url, membership_id)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(user_id)
        .bind(first_name)
        .bind(&last_name)
        .bind(avatar_url)
        .bind(&membership_id)
        .execute(db)
        .await
        .map_err(AppError::Database)?;

        // Create default notification preferences
        if let Err(e) = create_default_notification_preferences(db, user_id).await {
            tracing::warn!(error = ?e, "[OAuth] Failed to create notification preferences");
        }

        // Ensure loyalty enrollment
        if let Err(e) = ensure_loyalty_enrollment(db, user_id).await {
            tracing::warn!(error = ?e, "[OAuth] Failed to ensure loyalty enrollment");
        }

        let user = UserResponse {
            id: user_id.to_string(),
            email: Some(email.to_string()),
            role: "customer".to_string(),
            is_active: true,
            email_verified: true,
            oauth_provider: Some("google".to_string()),
        };

        (user, true)
    };

    // Log OAuth login
    sqlx::query("INSERT INTO user_audit_log (user_id, action, details) VALUES ($1::uuid, $2, $3)")
        .bind(&user.id)
        .bind("oauth_login")
        .bind(serde_json::json!({ "provider": "google", "isNewUser": is_new_user }))
        .execute(db)
        .await
        .map_err(AppError::Database)?;

    // Generate JWT tokens
    let tokens = generate_tokens(state, &user.id, user.email.as_deref(), &user.role).await?;

    Ok(OAuthResult {
        user,
        tokens,
        is_new_user,
    })
}

// =============================================================================
// LINE OAuth Handlers
// =============================================================================

/// GET /api/oauth/line - Initiate LINE OAuth flow
async fn line_oauth_init(
    State(state): State<AppState>,
    Query(query): Query<OAuthInitQuery>,
    headers: axum::http::HeaderMap,
) -> Response {
    let config = state.config();
    let frontend_url = &config.server.frontend_url;

    // Check if LINE OAuth is configured
    let Some(client_id) = config.oauth.line.client_id.as_ref() else {
        tracing::warn!("[OAuth] LINE OAuth not configured");
        return Redirect::to(&format!("{}/login?error=line_not_configured", frontend_url))
            .into_response();
    };

    // Extract request metadata
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let return_url = validate_return_url(query.return_url.as_deref(), frontend_url);
    let is_pwa = query.pwa.as_deref() == Some("true");
    let is_standalone = query.standalone.as_deref() == Some("true");
    let platform = query.platform.clone().unwrap_or_else(|| "web".to_string());

    // Create OAuth state for CSRF protection
    let state_data = OAuthStateData {
        session_id: None,
        user_id: None,
        user_agent: user_agent.to_string(),
        timestamp: Utc::now().timestamp_millis(),
        return_url: return_url.clone(),
        provider: "line".to_string(),
        original_url: "/api/oauth/line".to_string(),
        ip: "unknown".to_string(),
        secure: true,
        host: headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("localhost")
            .to_string(),
        is_pwa,
        is_standalone,
        platform,
    };

    let state_key = match create_oauth_state(&state, state_data).await {
        Ok(key) => key,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Failed to create OAuth state");
            return Redirect::to(&format!("{}/login?error=oauth_error", frontend_url))
                .into_response();
        },
    };

    // Build LINE OAuth URL
    let callback_url = &config.oauth.line.callback_url;
    let scope = "profile openid email";
    let line_oauth_url = format!(
        "https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id={}&redirect_uri={}&state={}&scope={}",
        url_encode(client_id),
        url_encode(callback_url),
        url_encode(&state_key),
        url_encode(scope)
    );

    tracing::debug!(
        state_key = %state_key,
        is_mobile_safari = is_mobile_safari(user_agent),
        "[OAuth] Initiating LINE OAuth"
    );

    // Use HTML redirect for mobile Safari compatibility
    if is_mobile_safari(user_agent) {
        build_html_redirect(&line_oauth_url, "Redirecting to LINE...")
    } else {
        Redirect::to(&line_oauth_url).into_response()
    }
}

/// GET /api/oauth/line/callback - Handle LINE OAuth callback
async fn line_oauth_callback(
    State(state): State<AppState>,
    Query(query): Query<OAuthCallbackQuery>,
    headers: axum::http::HeaderMap,
) -> Response {
    let config = state.config();
    let frontend_url = &config.server.frontend_url;
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Check for OAuth errors
    if let Some(error) = &query.error {
        if is_valid_oauth_error(error) {
            tracing::error!(
                error = %error,
                description = query.error_description.as_deref().unwrap_or("No description"),
                "[OAuth] LINE OAuth error"
            );
        }
        return build_error_redirect(frontend_url, "oauth_provider_error", user_agent);
    }

    // Validate required parameters
    let (code, state_key) = match (query.code.as_ref(), query.state.as_ref()) {
        (Some(c), Some(s)) if !c.is_empty() && !s.is_empty() => (c.as_str(), s.as_str()),
        _ => {
            tracing::error!("[OAuth] LINE callback missing parameters");
            return build_error_redirect(frontend_url, "oauth_invalid", user_agent);
        },
    };

    // Retrieve and validate OAuth state
    let state_data = match get_oauth_state(&state, state_key, "line").await {
        Ok(Some(data)) => data,
        Ok(None) => {
            tracing::error!(state_key = %state_key, "[OAuth] Invalid or expired OAuth state");
            return build_error_redirect(frontend_url, "session_expired", user_agent);
        },
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Failed to retrieve OAuth state");
            return build_error_redirect(frontend_url, "oauth_error", user_agent);
        },
    };

    tracing::debug!(
        state_age_ms = Utc::now().timestamp_millis() - state_data.timestamp,
        "[OAuth] LINE OAuth state recovered"
    );

    // Exchange code for tokens
    let tokens = match exchange_line_code(&state, code).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] LINE token exchange failed");
            return build_error_redirect(
                &validate_return_url(Some(&state_data.return_url), frontend_url),
                "oauth_token_failed",
                user_agent,
            );
        },
    };

    // Get user profile from LINE
    let profile = match get_line_profile(&tokens.access_token).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] Failed to get LINE profile");
            return build_error_redirect(
                &validate_return_url(Some(&state_data.return_url), frontend_url),
                "oauth_profile_failed",
                user_agent,
            );
        },
    };

    // Process LINE authentication
    let result = match process_line_auth(&state, profile).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = ?e, "[OAuth] LINE auth processing failed");
            return build_error_redirect(
                &validate_return_url(Some(&state_data.return_url), frontend_url),
                "oauth_processing_failed",
                user_agent,
            );
        },
    };

    // Clean up state
    if let Err(e) = delete_oauth_state(&state, state_key, "line").await {
        tracing::warn!(error = ?e, "[OAuth] Failed to delete OAuth state");
    }

    // Build success redirect URL
    let return_url = validate_return_url(Some(&state_data.return_url), frontend_url);
    let success_url = format!(
        "{}/oauth/success?token={}&refreshToken={}&isNewUser={}",
        return_url,
        url_encode(&result.tokens.access_token),
        url_encode(&result.tokens.refresh_token),
        result.is_new_user
    );

    tracing::info!(
        user_id = %result.user.id,
        is_new_user = result.is_new_user,
        "[OAuth] LINE OAuth success"
    );

    if is_mobile_safari(user_agent) {
        build_html_redirect(&success_url, "Authentication successful! Redirecting...")
    } else {
        Redirect::to(&success_url).into_response()
    }
}

/// Exchange LINE authorization code for tokens
async fn exchange_line_code(state: &AppState, code: &str) -> AppResult<OAuthTokenResponse> {
    let config = state.config();
    let client_id = config
        .oauth
        .line
        .client_id
        .as_ref()
        .ok_or_else(|| AppError::Configuration("LINE client ID not configured".to_string()))?;
    let client_secret =
        config.oauth.line.client_secret.as_ref().ok_or_else(|| {
            AppError::Configuration("LINE client secret not configured".to_string())
        })?;

    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &config.oauth.line.callback_url),
        ("client_id", client_id),
        ("client_secret", client_secret),
    ];

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.line.me/oauth2/v2.1/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("User-Agent", "loyalty-app/1.0")
        .form(&params)
        .send()
        .await
        .map_err(AppError::HttpRequest)?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        tracing::error!(error = %error_text, "[OAuth] LINE token exchange failed");
        return Err(AppError::OAuth(format!(
            "Token exchange failed: {}",
            error_text
        )));
    }

    response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(AppError::HttpRequest)
}

/// Get user profile from LINE using access token
async fn get_line_profile(access_token: &str) -> AppResult<LineProfile> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.line.me/v2/profile")
        .bearer_auth(access_token)
        .header("User-Agent", "loyalty-app/1.0")
        .send()
        .await
        .map_err(AppError::HttpRequest)?;

    if !response.status().is_success() {
        return Err(AppError::OAuth("Failed to get LINE profile".to_string()));
    }

    response
        .json::<LineProfile>()
        .await
        .map_err(AppError::HttpRequest)
}

/// Process LINE authentication and create/update user
async fn process_line_auth(state: &AppState, profile: LineProfile) -> AppResult<OAuthResult> {
    let line_id = &profile.user_id;

    tracing::debug!(
        line_id = %line_id,
        display_name = %profile.display_name,
        "[OAuth] Processing LINE auth"
    );

    let db = state.db();

    // Check if user exists by LINE ID
    let existing_user: Option<(String, Option<String>, String, bool, bool)> = sqlx::query_as(
        r#"SELECT id::text, email, role::text, is_active, email_verified
           FROM users
           WHERE oauth_provider = 'line' AND oauth_provider_id = $1"#,
    )
    .bind(line_id)
    .fetch_optional(db)
    .await
    .map_err(AppError::Database)?;

    let (user, is_new_user) = if let Some((id, email, role, is_active, email_verified)) =
        existing_user
    {
        tracing::debug!(user_id = %id, "[OAuth] Existing LINE user found");

        // Update profile if needed
        let display_name = &profile.display_name;
        let first_name = display_name.split(' ').next().unwrap_or("");
        let last_name = display_name
            .split(' ')
            .skip(1)
            .collect::<Vec<_>>()
            .join(" ");
        let avatar_url = profile.picture_url.as_deref();

        if !first_name.is_empty() || !last_name.is_empty() || avatar_url.is_some() {
            sqlx::query(
                r#"UPDATE user_profiles
                   SET first_name = COALESCE(NULLIF($2, ''), first_name),
                       last_name = COALESCE(NULLIF($3, ''), last_name),
                       avatar_url = CASE
                         WHEN avatar_url IS NULL OR (avatar_url NOT LIKE '/storage/%' AND avatar_url NOT LIKE 'emoji:%')
                         THEN COALESCE(NULLIF($4, ''), avatar_url)
                         ELSE avatar_url
                       END,
                       updated_at = NOW()
                   WHERE user_id = $1::uuid"#,
            )
            .bind(&id)
            .bind(first_name)
            .bind(&last_name)
            .bind(avatar_url)
            .execute(db)
            .await
            .map_err(AppError::Database)?;
        }

        let user = UserResponse {
            id,
            email,
            role,
            is_active,
            email_verified,
            oauth_provider: Some("line".to_string()),
        };

        (user, false)
    } else {
        // Create new user
        tracing::debug!(line_id = %line_id, "[OAuth] Creating new LINE user");

        let user_id = Uuid::new_v4();
        let display_name = &profile.display_name;
        let first_name = display_name.split(' ').next().unwrap_or("");
        let last_name = display_name
            .split(' ')
            .skip(1)
            .collect::<Vec<_>>()
            .join(" ");
        let avatar_url = profile.picture_url.as_deref();

        // Create user (no email for LINE users without email permission)
        sqlx::query(
            r#"INSERT INTO users (id, email, password_hash, email_verified, oauth_provider, oauth_provider_id, role, is_active)
               VALUES ($1, NULL, '', false, 'line', $2, 'customer', true)"#,
        )
        .bind(user_id)
        .bind(line_id)
        .execute(db)
        .await
        .map_err(AppError::Database)?;

        // Generate membership ID
        let membership_id = generate_membership_id(state).await?;

        // Create user profile
        sqlx::query(
            r#"INSERT INTO user_profiles (user_id, first_name, last_name, avatar_url, membership_id)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(user_id)
        .bind(first_name)
        .bind(&last_name)
        .bind(avatar_url)
        .bind(&membership_id)
        .execute(db)
        .await
        .map_err(AppError::Database)?;

        // Create default notification preferences
        if let Err(e) = create_default_notification_preferences(db, user_id).await {
            tracing::warn!(error = ?e, "[OAuth] Failed to create notification preferences");
        }

        // Ensure loyalty enrollment
        if let Err(e) = ensure_loyalty_enrollment(db, user_id).await {
            tracing::warn!(error = ?e, "[OAuth] Failed to ensure loyalty enrollment");
        }

        let user = UserResponse {
            id: user_id.to_string(),
            email: None,
            role: "customer".to_string(),
            is_active: true,
            email_verified: false,
            oauth_provider: Some("line".to_string()),
        };

        (user, true)
    };

    // Log OAuth login
    sqlx::query("INSERT INTO user_audit_log (user_id, action, details) VALUES ($1::uuid, $2, $3)")
        .bind(&user.id)
        .bind("oauth_login")
        .bind(
            serde_json::json!({ "provider": "line", "isNewUser": is_new_user, "lineId": line_id }),
        )
        .execute(db)
        .await
        .map_err(AppError::Database)?;

    // Generate JWT tokens
    let tokens = generate_tokens(state, &user.id, user.email.as_deref(), &user.role).await?;

    Ok(OAuthResult {
        user,
        tokens,
        is_new_user,
    })
}

// =============================================================================
// Account Linking Handler
// =============================================================================

/// POST /api/oauth/link/:provider - Link OAuth provider to existing account
async fn link_provider(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(provider): Path<String>,
    Json(body): Json<LinkProviderRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let valid_providers = ["google", "line"];
    if !valid_providers.contains(&provider.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid provider: {}. Must be one of: {:?}",
            provider, valid_providers
        )));
    }

    let db = state.db();
    let user_id = &auth_user.id;

    // Exchange code for tokens and get profile based on provider
    match provider.as_str() {
        "google" => {
            let tokens = exchange_google_code(&state, &body.code).await?;
            let user_info = get_google_user_info(&tokens.access_token).await?;

            // Check if this Google account is already linked to another user
            let existing: Option<(String,)> = sqlx::query_as(
                "SELECT id::text FROM users WHERE oauth_provider = 'google' AND oauth_provider_id = $1 AND id != $2::uuid",
            )
            .bind(&user_info.id)
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(AppError::Database)?;

            if existing.is_some() {
                return Err(AppError::Conflict(
                    "This Google account is already linked to another user".to_string(),
                ));
            }

            // Link the account
            sqlx::query(
                "UPDATE users SET oauth_provider = 'google', oauth_provider_id = $2, updated_at = NOW() WHERE id = $1::uuid",
            )
            .bind(user_id)
            .bind(&user_info.id)
            .execute(db)
            .await
            .map_err(AppError::Database)?;

            tracing::info!(
                user_id = %user_id,
                provider = "google",
                "[OAuth] Account linked successfully"
            );
        },
        "line" => {
            let tokens = exchange_line_code(&state, &body.code).await?;
            let profile = get_line_profile(&tokens.access_token).await?;

            // Check if this LINE account is already linked to another user
            let existing: Option<(String,)> = sqlx::query_as(
                "SELECT id::text FROM users WHERE oauth_provider = 'line' AND oauth_provider_id = $1 AND id != $2::uuid",
            )
            .bind(&profile.user_id)
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(AppError::Database)?;

            if existing.is_some() {
                return Err(AppError::Conflict(
                    "This LINE account is already linked to another user".to_string(),
                ));
            }

            // Link the account
            sqlx::query(
                "UPDATE users SET oauth_provider = 'line', oauth_provider_id = $2, updated_at = NOW() WHERE id = $1::uuid",
            )
            .bind(user_id)
            .bind(&profile.user_id)
            .execute(db)
            .await
            .map_err(AppError::Database)?;

            tracing::info!(
                user_id = %user_id,
                provider = "line",
                "[OAuth] Account linked successfully"
            );
        },
        _ => unreachable!(),
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("{} account linked successfully", provider)
    })))
}

// =============================================================================
// Helper Functions for User Creation
// =============================================================================

/// Generate a unique membership ID
async fn generate_membership_id(state: &AppState) -> AppResult<String> {
    let db = state.db();

    // Get next sequence value
    let result: (i64,) = sqlx::query_as("SELECT nextval('membership_id_sequence')")
        .fetch_one(db)
        .await
        .map_err(AppError::Database)?;

    let sequence_num = result.0;
    let membership_id = format!("MBRX{:08}", sequence_num);

    Ok(membership_id)
}

/// Create default notification preferences for a user
async fn create_default_notification_preferences(
    db: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO notification_preferences (user_id, email_notifications, push_notifications, sms_notifications)
           VALUES ($1, true, true, false)
           ON CONFLICT (user_id) DO NOTHING"#,
    )
    .bind(user_id)
    .execute(db)
    .await?;

    Ok(())
}

/// Ensure user is enrolled in loyalty program
async fn ensure_loyalty_enrollment(db: &sqlx::PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    // Check if already enrolled
    let existing: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM user_loyalty WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(db)
        .await?;

    if existing.is_none() {
        // Get default tier (Bronze)
        let tier: Option<(i32,)> =
            sqlx::query_as("SELECT id FROM tiers WHERE name = 'Bronze' LIMIT 1")
                .fetch_optional(db)
                .await?;

        let tier_id = tier.map(|t| t.0).unwrap_or(1);

        sqlx::query(
            r#"INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights, lifetime_points)
               VALUES ($1, $2, 0, 0, 0)
               ON CONFLICT (user_id) DO NOTHING"#,
        )
        .bind(user_id)
        .bind(tier_id)
        .execute(db)
        .await?;
    }

    Ok(())
}

/// Build error redirect response
fn build_error_redirect(base_url: &str, error_code: &str, user_agent: &str) -> Response {
    let error_url = format!("{}/login?error={}", base_url, error_code);

    if is_mobile_safari(user_agent) {
        build_html_redirect(&error_url, "Authentication failed. Redirecting...")
    } else {
        Redirect::to(&error_url).into_response()
    }
}

// =============================================================================
// Route Configuration
// =============================================================================

/// Create OAuth routes
pub fn routes() -> Router<AppState> {
    Router::new()
        // Google OAuth
        .route("/oauth/google", get(google_oauth_init))
        .route("/oauth/google/callback", get(google_oauth_callback))
        // LINE OAuth
        .route("/oauth/line", get(line_oauth_init))
        .route("/oauth/line/callback", get(line_oauth_callback))
        // Account linking (requires authentication)
        .route("/oauth/link/:provider", post(link_provider))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_return_url_valid_same_origin() {
        let frontend = "https://app.example.com";
        let result = validate_return_url(Some("https://app.example.com/dashboard"), frontend);
        assert_eq!(result, "https://app.example.com/dashboard");
    }

    #[test]
    fn test_validate_return_url_blocks_different_origin() {
        let frontend = "https://app.example.com";
        let result = validate_return_url(Some("https://evil.com/phishing"), frontend);
        assert_eq!(result, "https://app.example.com");
    }

    #[test]
    fn test_validate_return_url_handles_none() {
        let frontend = "https://app.example.com";
        let result = validate_return_url(None, frontend);
        assert_eq!(result, "https://app.example.com");
    }

    #[test]
    fn test_validate_return_url_handles_invalid_url() {
        let frontend = "https://app.example.com";
        let result = validate_return_url(Some("not-a-valid-url"), frontend);
        assert_eq!(result, "https://app.example.com");
    }

    #[test]
    fn test_is_valid_oauth_error() {
        assert!(is_valid_oauth_error("access_denied"));
        assert!(is_valid_oauth_error("invalid_request"));
        assert!(!is_valid_oauth_error("some_random_error"));
        assert!(!is_valid_oauth_error(""));
    }

    #[test]
    fn test_is_mobile_safari() {
        // iPhone Safari
        assert!(is_mobile_safari(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
        ));

        // Desktop Safari
        assert!(!is_mobile_safari(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15"
        ));

        // Chrome on iPhone (not Safari)
        assert!(!is_mobile_safari(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/107.0.5304.66 Mobile/15E148 Safari/604.1"
        ));

        // Android Chrome
        assert!(!is_mobile_safari(
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.5304.105 Mobile Safari/537.36"
        ));
    }

    #[test]
    fn test_url_encode() {
        // Simple text
        assert_eq!(url_encode("hello"), "hello");

        // Spaces
        assert_eq!(url_encode("hello world"), "hello%20world");

        // Special characters
        assert_eq!(url_encode("a=b&c=d"), "a%3Db%26c%3Dd");

        // URL
        assert_eq!(
            url_encode("https://example.com/path"),
            "https%3A%2F%2Fexample.com%2Fpath"
        );

        // Unreserved characters should not be encoded
        assert_eq!(url_encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn test_extract_origin() {
        assert_eq!(
            extract_origin("https://example.com/path"),
            Some("https://example.com".to_string())
        );

        assert_eq!(
            extract_origin("http://localhost:4001/api/oauth"),
            Some("http://localhost:4001".to_string())
        );

        assert_eq!(extract_origin("not-a-url"), None);
        assert_eq!(extract_origin("ftp://example.com"), None);
    }
}
