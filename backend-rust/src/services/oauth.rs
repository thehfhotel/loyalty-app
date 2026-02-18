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
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl,
    Scope, TokenResponse, TokenUrl,
};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::config::{GoogleOAuthConfig, LineOAuthConfig};
use crate::error::AppError;
use crate::services::AppState;

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

/// OAuth user from database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OAuthUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub email_verified: Option<bool>,
    pub oauth_provider: Option<String>,
    pub oauth_provider_id: Option<String>,
}

/// Result of OAuth authentication including user and tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthAuthResult {
    /// The authenticated user
    pub user: OAuthUser,
    /// JWT access token
    pub access_token: String,
    /// Refresh token
    pub refresh_token: String,
    /// Whether this is a new user registration
    pub is_new_user: bool,
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
    /// Find or create a user from OAuth info
    async fn find_or_create_oauth_user(
        &self,
        user_info: OAuthUserInfo,
    ) -> Result<OAuthAuthResult, AppError>;

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
    state: AppState,
    http_client: HttpClient,
    google_config: GoogleOAuthConfig,
    line_config: LineOAuthConfig,
}

impl OAuthServiceImpl {
    /// Create a new OAuthServiceImpl instance
    pub fn new(
        state: AppState,
        google_config: GoogleOAuthConfig,
        line_config: LineOAuthConfig,
    ) -> Self {
        Self {
            state,
            http_client: HttpClient::new(),
            google_config,
            line_config,
        }
    }

    /// Create Google OAuth2 client
    fn create_google_client(&self) -> Result<BasicClient, AppError> {
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

        let client = BasicClient::new(
            ClientId::new(client_id.clone()),
            Some(ClientSecret::new(client_secret.clone())),
            auth_url,
            Some(token_url),
        )
        .set_redirect_uri(redirect_url);

        Ok(client)
    }

    /// Create LINE OAuth2 client
    fn create_line_client(&self) -> Result<BasicClient, AppError> {
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

        let client = BasicClient::new(
            ClientId::new(client_id.clone()),
            Some(ClientSecret::new(client_secret.clone())),
            auth_url,
            Some(token_url),
        )
        .set_redirect_uri(redirect_url);

        Ok(client)
    }

    /// Generate membership ID using database sequence
    async fn generate_membership_id(&self) -> Result<String, AppError> {
        let membership_id: String = sqlx::query_scalar!(
            r#"SELECT 'LYL' || LPAD(nextval('membership_id_sequence')::text, 8, '0') as "id!: String""#,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to generate membership ID: {}", e)))?;

        Ok(membership_id)
    }

    /// Generate JWT tokens for a user
    ///
    /// Creates access and refresh JWT tokens directly using jsonwebtoken,
    /// encoding the UUID as a string in the claims for proper user identification.
    fn generate_tokens(&self, user_id: Uuid, email: &str) -> Result<(String, String), AppError> {
        use chrono::{Duration, Utc};
        use jsonwebtoken::{encode, EncodingKey, Header};
        use serde::{Deserialize, Serialize};

        #[derive(Debug, Serialize, Deserialize)]
        struct AccessClaims {
            sub: String,
            email: String,
            exp: i64,
            iat: i64,
        }

        #[derive(Debug, Serialize, Deserialize)]
        struct RefreshClaims {
            sub: String,
            exp: i64,
            iat: i64,
            token_type: String,
        }

        let now = Utc::now();
        let access_expiration = now + Duration::seconds(self.state.jwt_expiration);
        let refresh_expiration = now + Duration::seconds(self.state.refresh_token_expiration);

        let access_claims = AccessClaims {
            sub: user_id.to_string(),
            email: email.to_string(),
            exp: access_expiration.timestamp(),
            iat: now.timestamp(),
        };

        let refresh_claims = RefreshClaims {
            sub: user_id.to_string(),
            exp: refresh_expiration.timestamp(),
            iat: now.timestamp(),
            token_type: "refresh".to_string(),
        };

        let encoding_key = EncodingKey::from_secret(self.state.jwt_secret.as_bytes());

        let access_token = encode(&Header::default(), &access_claims, &encoding_key)
            .map_err(|e| AppError::Internal(format!("Failed to generate access token: {}", e)))?;

        let refresh_token = encode(&Header::default(), &refresh_claims, &encoding_key)
            .map_err(|e| AppError::Internal(format!("Failed to generate refresh token: {}", e)))?;

        Ok((access_token, refresh_token))
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
            .request_async(oauth2::reqwest::async_http_client)
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

    async fn find_or_create_oauth_user(
        &self,
        user_info: OAuthUserInfo,
    ) -> Result<OAuthAuthResult, AppError> {
        debug!(
            "[OAuth Service] Processing {} auth for provider_id: {}",
            user_info.provider, user_info.provider_id
        );

        // Try to find existing user by OAuth provider ID
        let existing_user: Option<OAuthUser> = sqlx::query_as!(
            OAuthUser,
            r#"
            SELECT id, email, role::text as role, is_active, email_verified,
                   oauth_provider, oauth_provider_id
            FROM users
            WHERE oauth_provider = $1 AND oauth_provider_id = $2
            "#,
            &user_info.provider,
            &user_info.provider_id,
        )
        .fetch_optional(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to find user by OAuth ID: {}", e)))?;

        if let Some(user) = existing_user {
            info!(
                "[OAuth Service] Existing {} user found: {:?}",
                user_info.provider, user.id
            );

            // Update profile if needed (avatar, name)
            self.update_oauth_user_profile(&user.id, &user_info).await?;

            let email = user.email.as_deref().unwrap_or("");
            let (access_token, refresh_token) = self.generate_tokens(user.id, email)?;

            // Log OAuth login
            self.log_oauth_login(&user.id, &user_info.provider, false)
                .await?;

            return Ok(OAuthAuthResult {
                user,
                access_token,
                refresh_token,
                is_new_user: false,
            });
        }

        // If user has email, try to find by email
        if let Some(ref email) = user_info.email {
            let existing_by_email: Option<OAuthUser> = sqlx::query_as!(
                OAuthUser,
                r#"
                SELECT id, email, role::text as role, is_active, email_verified,
                       oauth_provider, oauth_provider_id
                FROM users
                WHERE email = $1
                "#,
                email,
            )
            .fetch_optional(self.state.db.pool())
            .await
            .map_err(|e| AppError::DatabaseQuery(format!("Failed to find user by email: {}", e)))?;

            if let Some(user) = existing_by_email {
                info!(
                    "[OAuth Service] Linking {} OAuth to existing email account: {}",
                    user_info.provider, email
                );

                // Update OAuth provider info
                sqlx::query!(
                    r#"
                    UPDATE users
                    SET oauth_provider = $1, oauth_provider_id = $2,
                        email_verified = CASE WHEN $3 THEN true ELSE email_verified END,
                        updated_at = NOW()
                    WHERE id = $4
                    "#,
                    &user_info.provider,
                    &user_info.provider_id,
                    user_info.email_verified,
                    user.id,
                )
                .execute(self.state.db.pool())
                .await
                .map_err(|e| {
                    AppError::DatabaseQuery(format!("Failed to update OAuth provider: {}", e))
                })?;

                // Update profile
                self.update_oauth_user_profile(&user.id, &user_info).await?;

                let (access_token, refresh_token) = self.generate_tokens(user.id, email)?;

                // Log OAuth login
                self.log_oauth_login(&user.id, &user_info.provider, false)
                    .await?;

                // Refresh user data after update
                let updated_user: OAuthUser = sqlx::query_as!(
                    OAuthUser,
                    r#"
                    SELECT id, email, role::text as role, is_active, email_verified,
                           oauth_provider, oauth_provider_id
                    FROM users
                    WHERE id = $1
                    "#,
                    user.id,
                )
                .fetch_one(self.state.db.pool())
                .await
                .map_err(|e| AppError::DatabaseQuery(format!("Failed to refresh user: {}", e)))?;

                return Ok(OAuthAuthResult {
                    user: updated_user,
                    access_token,
                    refresh_token,
                    is_new_user: false,
                });
            }
        }

        // Create new user
        info!("[OAuth Service] Creating new {} user", user_info.provider);

        let membership_id = self.generate_membership_id().await?;

        let new_user: OAuthUser = sqlx::query_as!(
            OAuthUser,
            r#"
            INSERT INTO users (email, password_hash, email_verified, oauth_provider, oauth_provider_id)
            VALUES ($1, '', $2, $3, $4)
            RETURNING id, email, role::text as role, is_active, email_verified,
                      oauth_provider, oauth_provider_id
            "#,
            user_info.email.as_deref(),
            user_info.email_verified,
            &user_info.provider,
            &user_info.provider_id,
        )
        .fetch_one(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to create OAuth user: {}", e)))?;

        // Create user profile
        sqlx::query!(
            r#"
            INSERT INTO user_profiles (user_id, first_name, last_name, avatar_url, membership_id)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            new_user.id,
            user_info.first_name.as_deref(),
            user_info.last_name.as_deref(),
            user_info.avatar_url.as_deref(),
            &membership_id,
        )
        .execute(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to create user profile: {}", e)))?;

        // Create default notification preferences (using trigger as fallback)
        let _ = sqlx::query!(
            r#"
            INSERT INTO notification_preferences (user_id)
            VALUES ($1)
            ON CONFLICT (user_id) DO NOTHING
            "#,
            new_user.id,
        )
        .execute(self.state.db.pool())
        .await;

        let email = new_user.email.as_deref().unwrap_or("");
        let (access_token, refresh_token) = self.generate_tokens(new_user.id, email)?;

        // Log OAuth login
        self.log_oauth_login(&new_user.id, &user_info.provider, true)
            .await?;

        // Enroll in loyalty program
        self.ensure_loyalty_enrollment(&new_user.id).await?;

        Ok(OAuthAuthResult {
            user: new_user,
            access_token,
            refresh_token,
            is_new_user: true,
        })
    }
}

impl OAuthServiceImpl {
    /// Update OAuth user's profile with new information
    async fn update_oauth_user_profile(
        &self,
        user_id: &Uuid,
        user_info: &OAuthUserInfo,
    ) -> Result<(), AppError> {
        // Only update avatar if there's no local avatar (starting with /storage/ or emoji:)
        sqlx::query!(
            r#"
            UPDATE user_profiles
            SET first_name = COALESCE(NULLIF($2, ''), first_name),
                last_name = COALESCE(NULLIF($3, ''), last_name),
                avatar_url = CASE
                    WHEN avatar_url IS NULL OR (NOT avatar_url LIKE '/storage/%' AND NOT avatar_url LIKE 'emoji:%')
                    THEN COALESCE(NULLIF($4, ''), avatar_url)
                    ELSE avatar_url
                END,
                updated_at = NOW()
            WHERE user_id = $1
            "#,
            user_id,
            user_info.first_name.as_deref().unwrap_or(""),
            user_info.last_name.as_deref().unwrap_or(""),
            user_info.avatar_url.as_deref().unwrap_or(""),
        )
        .execute(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to update user profile: {}", e)))?;

        Ok(())
    }

    /// Log OAuth login event to audit log
    async fn log_oauth_login(
        &self,
        user_id: &Uuid,
        provider: &str,
        is_new_user: bool,
    ) -> Result<(), AppError> {
        let details = serde_json::json!({
            "provider": provider,
            "isNewUser": is_new_user
        });

        sqlx::query!(
            r#"
            INSERT INTO user_audit_log (user_id, action, details)
            VALUES ($1, 'oauth_login', $2)
            "#,
            user_id,
            details,
        )
        .execute(self.state.db.pool())
        .await
        .map_err(|e| {
            warn!("Failed to log OAuth login: {}", e);
            AppError::DatabaseQuery(format!("Failed to log OAuth login: {}", e))
        })?;

        Ok(())
    }

    /// Ensure user is enrolled in the loyalty program
    async fn ensure_loyalty_enrollment(&self, user_id: &Uuid) -> Result<(), AppError> {
        // Check if user already has loyalty record
        let existing = sqlx::query_scalar!(
            r#"SELECT user_id FROM user_loyalty WHERE user_id = $1"#,
            user_id,
        )
        .fetch_optional(self.state.db.pool())
        .await
        .map_err(|e| {
            AppError::DatabaseQuery(format!("Failed to check loyalty enrollment: {}", e))
        })?;

        if existing.is_some() {
            return Ok(());
        }

        // Get default tier (Bronze)
        let tier_id: Option<Uuid> =
            sqlx::query_scalar!(r#"SELECT id FROM tiers WHERE name = 'Bronze' LIMIT 1"#,)
                .fetch_optional(self.state.db.pool())
                .await
                .map_err(|e| {
                    AppError::DatabaseQuery(format!("Failed to get default tier: {}", e))
                })?;

        let tier_id =
            tier_id.ok_or_else(|| AppError::NotFound("Default tier not found".to_string()))?;

        // Create loyalty record
        sqlx::query!(
            r#"
            INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights)
            VALUES ($1, $2, 0, 0)
            ON CONFLICT (user_id) DO NOTHING
            "#,
            user_id,
            tier_id,
        )
        .execute(self.state.db.pool())
        .await
        .map_err(|e| AppError::DatabaseQuery(format!("Failed to create loyalty record: {}", e)))?;

        info!(
            "[OAuth Service] Created loyalty enrollment for user: {}",
            user_id
        );

        Ok(())
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
