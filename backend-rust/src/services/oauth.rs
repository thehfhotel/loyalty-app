//! OAuth service module
//!
//! Provides OAuth2 authentication functionality for:
//! - Google OAuth
//! - LINE OAuth
//!
//! This service handles the OAuth flow including authorization URL generation,
//! code exchange for tokens, and user info retrieval.

use async_trait::async_trait;
use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    EndpointNotSet, EndpointSet, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use reqwest::Client as HttpClient;

/// Concrete `BasicClient` typestate for the OAuth flows used here:
/// authorization endpoint and token endpoint are set; device, introspection,
/// and revocation endpoints are not.
type ConfiguredBasicClient =
    BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;
use serde::{Deserialize, Serialize};
use tracing::{debug, error};

use crate::config::{GoogleOAuthConfig, LineOAuthConfig};
use crate::error::AppError;

// =============================================================================
// Structs for OAuth User Info
// =============================================================================

/// Google user information retrieved from the Google OAuth API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUserInfo {
    /// Google's unique user ID
    pub id: String,
    /// User's email address
    pub email: String,
    /// User's full display name
    pub name: Option<String>,
    /// URL to user's profile picture
    pub picture: Option<String>,
    /// Whether the email is verified
    pub verified_email: Option<bool>,
    /// User's given (first) name
    pub given_name: Option<String>,
    /// User's family (last) name
    pub family_name: Option<String>,
}

/// LINE user information retrieved from the LINE OAuth API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineUserInfo {
    /// LINE's unique user ID
    #[serde(rename = "userId")]
    pub user_id: String,
    /// User's display name on LINE
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// URL to user's profile picture
    #[serde(rename = "pictureUrl")]
    pub picture_url: Option<String>,
    /// User's status message
    #[serde(rename = "statusMessage")]
    pub status_message: Option<String>,
}

/// Unified OAuth user info for provider-agnostic handling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthUserInfo {
    /// Provider name (e.g., "google", "line")
    pub provider: String,
    /// Provider's unique user ID
    pub provider_id: String,
    /// User's email (may be None for LINE)
    pub email: Option<String>,
    /// User's first name
    pub first_name: Option<String>,
    /// User's last name
    pub last_name: Option<String>,
    /// User's full display name
    pub display_name: Option<String>,
    /// URL to user's avatar/profile picture
    pub avatar_url: Option<String>,
    /// Whether the email is verified (if email is present)
    pub email_verified: bool,
}

impl From<GoogleUserInfo> for OAuthUserInfo {
    fn from(google: GoogleUserInfo) -> Self {
        let (first_name, last_name) = if google.given_name.is_some() || google.family_name.is_some()
        {
            (google.given_name, google.family_name)
        } else if let Some(ref name) = google.name {
            let parts: Vec<&str> = name.splitn(2, ' ').collect();
            (
                parts.first().map(|s| s.to_string()),
                if parts.len() > 1 {
                    Some(parts[1..].join(" "))
                } else {
                    None
                },
            )
        } else {
            (None, None)
        };

        OAuthUserInfo {
            provider: "google".to_string(),
            provider_id: google.id,
            email: Some(google.email),
            first_name,
            last_name,
            display_name: google.name,
            avatar_url: google.picture,
            email_verified: google.verified_email.unwrap_or(false),
        }
    }
}

impl From<LineUserInfo> for OAuthUserInfo {
    fn from(line: LineUserInfo) -> Self {
        let (first_name, last_name) = {
            let parts: Vec<&str> = line.display_name.splitn(2, ' ').collect();
            (
                parts.first().map(|s| s.to_string()),
                if parts.len() > 1 {
                    Some(parts[1..].join(" "))
                } else {
                    None
                },
            )
        };

        OAuthUserInfo {
            provider: "line".to_string(),
            provider_id: line.user_id,
            email: None, // LINE doesn't provide email by default
            first_name,
            last_name,
            display_name: Some(line.display_name),
            avatar_url: line.picture_url,
            email_verified: false,
        }
    }
}

/// Google OAuth tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleTokens {
    /// Access token for API calls
    pub access_token: String,
    /// Optional refresh token
    pub refresh_token: Option<String>,
    /// Token expiration in seconds
    pub expires_in: Option<u64>,
    /// Token type (usually "Bearer")
    pub token_type: String,
    /// ID token for identity verification
    pub id_token: Option<String>,
}

/// LINE OAuth tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineTokens {
    /// Access token for API calls
    pub access_token: String,
    /// Optional refresh token
    pub refresh_token: Option<String>,
    /// Token expiration in seconds
    pub expires_in: Option<u64>,
    /// Token type (usually "Bearer")
    pub token_type: String,
    /// ID token for identity verification
    pub id_token: Option<String>,
}

// =============================================================================
// OAuth Service Trait
// =============================================================================

/// OAuth service trait defining OAuth operations
#[async_trait]
pub trait OAuthService: Send + Sync {
    // Google OAuth methods
    /// Generate Google OAuth authorization URL
    fn get_google_auth_url(&self) -> Result<(String, CsrfToken), AppError>;

    /// Exchange Google authorization code for tokens
    async fn exchange_google_code(&self, code: &str) -> Result<GoogleTokens, AppError>;

    /// Get Google user info using access token
    async fn get_google_user_info(&self, access_token: &str) -> Result<GoogleUserInfo, AppError>;

    // LINE OAuth methods
    /// Generate LINE OAuth authorization URL
    fn get_line_auth_url(&self) -> Result<(String, CsrfToken), AppError>;

    /// Exchange LINE authorization code for tokens
    async fn exchange_line_code(&self, code: &str) -> Result<LineTokens, AppError>;

    /// Get LINE user info using access token
    async fn get_line_user_info(&self, access_token: &str) -> Result<LineUserInfo, AppError>;

    // Common methods
    /// Check if Google OAuth is configured
    fn is_google_configured(&self) -> bool;

    /// Check if LINE OAuth is configured
    fn is_line_configured(&self) -> bool;
}

// =============================================================================
// OAuth Service Implementation
// =============================================================================

/// Implementation of the OAuthService trait
pub struct OAuthServiceImpl {
    http_client: HttpClient,
    google_config: GoogleOAuthConfig,
    line_config: LineOAuthConfig,
}

impl OAuthServiceImpl {
    /// Create a new OAuthServiceImpl instance.
    ///
    /// Takes no `AppState`: this service owns no database work. The
    /// provisioning path that used one (`find_or_create_oauth_user`) was
    /// deleted once `routes::oauth` became the only live OAuth flow, and
    /// what is left here is the provider round-trip — authorization URLs,
    /// code exchange and userinfo — which needs nothing but the HTTP client
    /// and the two provider configs.
    pub fn new(google_config: GoogleOAuthConfig, line_config: LineOAuthConfig) -> Self {
        // oauth2 v5 requires the HTTP client used for token exchange to
        // reject redirects (SSRF mitigation per the upstream upgrade guide).
        // The same client is reused for plain userinfo GETs — userinfo
        // endpoints normally respond 200 directly without redirects.
        //
        // It is the app's shared client (#434) rather than one built here.
        // The one built here had **no timeouts at all** —
        // `reqwest::Client::builder()` starts from none and only the
        // redirect policy was set — so a Google or LINE token endpoint that
        // accepted the connection and then said nothing held a guest's
        // login open until the router's own 30 s `TimeoutLayer` turned it
        // into a 408. `outbound_no_redirect()` is that policy with the
        // shared connect/total budget and one connection pool for the whole
        // process, instead of a fresh pool per `OAuthServiceImpl`.
        let http_client = crate::services::http::outbound_no_redirect().clone();

        Self {
            http_client,
            google_config,
            line_config,
        }
    }

    /// Create Google OAuth2 client
    fn create_google_client(&self) -> Result<ConfiguredBasicClient, AppError> {
        let client_id = self.google_config.client_id.as_ref().ok_or_else(|| {
            AppError::Configuration("Google OAuth client ID not configured".to_string())
        })?;

        let client_secret = self.google_config.client_secret.as_ref().ok_or_else(|| {
            AppError::Configuration("Google OAuth client secret not configured".to_string())
        })?;

        let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
            .map_err(|e| AppError::Configuration(format!("Invalid Google auth URL: {}", e)))?;

        let token_url = TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
            .map_err(|e| AppError::Configuration(format!("Invalid Google token URL: {}", e)))?;

        let redirect_url = RedirectUrl::new(self.google_config.callback_url.clone())
            .map_err(|e| AppError::Configuration(format!("Invalid Google redirect URL: {}", e)))?;

        let client = BasicClient::new(ClientId::new(client_id.clone()))
            .set_client_secret(ClientSecret::new(client_secret.clone()))
            .set_auth_uri(auth_url)
            .set_token_uri(token_url)
            .set_redirect_uri(redirect_url);

        Ok(client)
    }

    /// Create LINE OAuth2 client
    fn create_line_client(&self) -> Result<ConfiguredBasicClient, AppError> {
        let client_id = self.line_config.client_id.as_ref().ok_or_else(|| {
            AppError::Configuration("LINE OAuth client ID not configured".to_string())
        })?;

        let client_secret = self.line_config.client_secret.as_ref().ok_or_else(|| {
            AppError::Configuration("LINE OAuth client secret not configured".to_string())
        })?;

        let auth_url = AuthUrl::new("https://access.line.me/oauth2/v2.1/authorize".to_string())
            .map_err(|e| AppError::Configuration(format!("Invalid LINE auth URL: {}", e)))?;

        let token_url = TokenUrl::new("https://api.line.me/oauth2/v2.1/token".to_string())
            .map_err(|e| AppError::Configuration(format!("Invalid LINE token URL: {}", e)))?;

        let redirect_url = RedirectUrl::new(self.line_config.callback_url.clone())
            .map_err(|e| AppError::Configuration(format!("Invalid LINE redirect URL: {}", e)))?;

        let client = BasicClient::new(ClientId::new(client_id.clone()))
            .set_client_secret(ClientSecret::new(client_secret.clone()))
            .set_auth_uri(auth_url)
            .set_token_uri(token_url)
            .set_redirect_uri(redirect_url);

        Ok(client)
    }
}

#[async_trait]
impl OAuthService for OAuthServiceImpl {
    fn is_google_configured(&self) -> bool {
        self.google_config.is_configured()
    }

    fn is_line_configured(&self) -> bool {
        self.line_config.is_configured()
    }

    fn get_google_auth_url(&self) -> Result<(String, CsrfToken), AppError> {
        if !self.is_google_configured() {
            return Err(AppError::Configuration(
                "Google OAuth is not configured".to_string(),
            ));
        }

        let client = self.create_google_client()?;

        let (auth_url, csrf_token) = client
            .authorize_url(CsrfToken::new_random)
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .url();

        debug!("Generated Google auth URL: {}", auth_url);

        Ok((auth_url.to_string(), csrf_token))
    }

    async fn exchange_google_code(&self, code: &str) -> Result<GoogleTokens, AppError> {
        if !self.is_google_configured() {
            return Err(AppError::Configuration(
                "Google OAuth is not configured".to_string(),
            ));
        }

        let client = self.create_google_client()?;

        let token_result = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| {
                error!("Google token exchange failed: {:?}", e);
                AppError::OAuth(format!("Failed to exchange Google code: {:?}", e))
            })?;

        Ok(GoogleTokens {
            access_token: token_result.access_token().secret().clone(),
            refresh_token: token_result.refresh_token().map(|t| t.secret().clone()),
            expires_in: token_result.expires_in().map(|d| d.as_secs()),
            token_type: "Bearer".to_string(),
            id_token: None, // Would need to parse from extra_fields if needed
        })
    }

    async fn get_google_user_info(&self, access_token: &str) -> Result<GoogleUserInfo, AppError> {
        let response = self
            .http_client
            .get("https://www.googleapis.com/oauth2/v2/userinfo")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to fetch Google user info: {}", e);
                AppError::OAuth(format!("Failed to fetch Google user info: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("Google user info request failed: {} - {}", status, body);
            return Err(AppError::OAuthProvider {
                provider: "google".to_string(),
                message: format!("API error: {} - {}", status, body),
            });
        }

        let user_info: GoogleUserInfo = response.json().await.map_err(|e| {
            error!("Failed to parse Google user info: {}", e);
            AppError::OAuth(format!("Failed to parse Google user info: {}", e))
        })?;

        debug!("Retrieved Google user info for: {}", user_info.email);

        Ok(user_info)
    }

    fn get_line_auth_url(&self) -> Result<(String, CsrfToken), AppError> {
        if !self.is_line_configured() {
            return Err(AppError::Configuration(
                "LINE OAuth is not configured".to_string(),
            ));
        }

        let client = self.create_line_client()?;

        let (auth_url, csrf_token) = client
            .authorize_url(CsrfToken::new_random)
            .add_scope(Scope::new("profile".to_string()))
            .add_scope(Scope::new("openid".to_string()))
            .url();

        debug!("Generated LINE auth URL: {}", auth_url);

        Ok((auth_url.to_string(), csrf_token))
    }

    async fn exchange_line_code(&self, code: &str) -> Result<LineTokens, AppError> {
        if !self.is_line_configured() {
            return Err(AppError::Configuration(
                "LINE OAuth is not configured".to_string(),
            ));
        }

        let client_id = self.line_config.client_id.as_ref().ok_or_else(|| {
            AppError::Configuration("LINE OAuth client ID not configured".to_string())
        })?;

        let client_secret = self.line_config.client_secret.as_ref().ok_or_else(|| {
            AppError::Configuration("LINE OAuth client secret not configured".to_string())
        })?;

        // LINE requires form-urlencoded POST for token exchange
        let params = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &self.line_config.callback_url),
            ("client_id", client_id),
            ("client_secret", client_secret),
        ];

        let response = self
            .http_client
            .post("https://api.line.me/oauth2/v2.1/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| {
                error!("LINE token exchange request failed: {}", e);
                AppError::OAuth(format!("Failed to exchange LINE code: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("LINE token exchange failed: {} - {}", status, body);
            return Err(AppError::OAuthProvider {
                provider: "line".to_string(),
                message: format!("API error: {} - {}", status, body),
            });
        }

        #[derive(Deserialize)]
        struct LineTokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: Option<u64>,
            token_type: String,
            id_token: Option<String>,
        }

        let token_response: LineTokenResponse = response.json().await.map_err(|e| {
            error!("Failed to parse LINE token response: {}", e);
            AppError::OAuth(format!("Failed to parse LINE token response: {}", e))
        })?;

        Ok(LineTokens {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_in: token_response.expires_in,
            token_type: token_response.token_type,
            id_token: token_response.id_token,
        })
    }

    async fn get_line_user_info(&self, access_token: &str) -> Result<LineUserInfo, AppError> {
        let response = self
            .http_client
            .get("https://api.line.me/v2/profile")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to fetch LINE user info: {}", e);
                AppError::OAuth(format!("Failed to fetch LINE user info: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("LINE user info request failed: {} - {}", status, body);
            return Err(AppError::OAuthProvider {
                provider: "line".to_string(),
                message: format!("API error: {} - {}", status, body),
            });
        }

        let user_info: LineUserInfo = response.json().await.map_err(|e| {
            error!("Failed to parse LINE user info: {}", e);
            AppError::OAuth(format!("Failed to parse LINE user info: {}", e))
        })?;

        debug!("Retrieved LINE user info for: {}", user_info.display_name);

        Ok(user_info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_google_user_info_to_oauth_user_info() {
        let google = GoogleUserInfo {
            id: "123456".to_string(),
            email: "test@example.com".to_string(),
            name: Some("John Doe".to_string()),
            picture: Some("https://example.com/avatar.jpg".to_string()),
            verified_email: Some(true),
            given_name: Some("John".to_string()),
            family_name: Some("Doe".to_string()),
        };

        let oauth: OAuthUserInfo = google.into();

        assert_eq!(oauth.provider, "google");
        assert_eq!(oauth.provider_id, "123456");
        assert_eq!(oauth.email, Some("test@example.com".to_string()));
        assert_eq!(oauth.first_name, Some("John".to_string()));
        assert_eq!(oauth.last_name, Some("Doe".to_string()));
        assert!(oauth.email_verified);
    }

    #[test]
    fn test_line_user_info_to_oauth_user_info() {
        let line = LineUserInfo {
            user_id: "U123456".to_string(),
            display_name: "John Doe".to_string(),
            picture_url: Some("https://profile.line-scdn.net/avatar.jpg".to_string()),
            status_message: None,
        };

        let oauth: OAuthUserInfo = line.into();

        assert_eq!(oauth.provider, "line");
        assert_eq!(oauth.provider_id, "U123456");
        assert!(oauth.email.is_none()); // LINE doesn't provide email by default
        assert_eq!(oauth.first_name, Some("John".to_string()));
        assert_eq!(oauth.last_name, Some("Doe".to_string()));
        assert_eq!(oauth.display_name, Some("John Doe".to_string()));
        assert!(!oauth.email_verified);
    }

    #[test]
    fn test_google_user_info_name_parsing_fallback() {
        // Test when given_name and family_name are not provided
        let google = GoogleUserInfo {
            id: "123456".to_string(),
            email: "test@example.com".to_string(),
            name: Some("John Michael Doe".to_string()),
            picture: None,
            verified_email: Some(false),
            given_name: None,
            family_name: None,
        };

        let oauth: OAuthUserInfo = google.into();

        assert_eq!(oauth.first_name, Some("John".to_string()));
        assert_eq!(oauth.last_name, Some("Michael Doe".to_string()));
    }

    #[test]
    fn test_line_single_name() {
        let line = LineUserInfo {
            user_id: "U123456".to_string(),
            display_name: "John".to_string(),
            picture_url: None,
            status_message: None,
        };

        let oauth: OAuthUserInfo = line.into();

        assert_eq!(oauth.first_name, Some("John".to_string()));
        assert!(oauth.last_name.is_none());
    }
}
