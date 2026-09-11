//! Authentication routes
//!
//! Provides endpoints for user authentication including login, registration,
//! logout, token refresh, and password reset.

use axum::{
    extract::{Extension, State},
    http::HeaderMap,
    middleware,
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::cookie::CookieJar;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::error::AppError;
use crate::middleware::auth::{
    auth_middleware, build_clear_refresh_cookie, build_refresh_cookie, AuthUser,
    REFRESH_COOKIE_NAME,
};
use crate::services::cf_access;
use crate::services::email::{EmailService, EmailServiceImpl};
use crate::services::http::outbound;

/// Application state type alias for auth routes
/// Uses the main state from crate::state or a compatible state type
pub use crate::state::AppState;

// ============================================================================
// Request/Response Types
// ============================================================================

/// Registration request payload
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RegisterRequest {
    /// User's email address
    #[validate(email(message = "Invalid email format"))]
    pub email: String,

    /// User's password (minimum 8 characters)
    #[validate(length(min = 8, message = "Password must be at least 8 characters"))]
    pub password: String,

    /// User's first name
    #[validate(length(min = 1, message = "First name is required"))]
    #[serde(rename = "firstName")]
    pub first_name: String,

    /// User's last name
    #[validate(length(min = 1, message = "Last name is required"))]
    #[serde(rename = "lastName")]
    pub last_name: String,

    /// Optional phone number
    pub phone: Option<String>,
}

/// Login request payload
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct LoginRequest {
    /// User's email address
    #[validate(email(message = "Invalid email format"))]
    pub email: String,

    /// User's password
    #[validate(length(min = 1, message = "Password is required"))]
    pub password: String,

    /// Remember me option for extended session
    #[serde(default, rename = "rememberMe")]
    pub remember_me: bool,
}

// Phase 3 (PR follows #208): the JSON-body refresh-token contract has been
// removed. Logout and refresh both source the refresh token exclusively from
// the `refresh_token` HttpOnly cookie. `LogoutRequest` and
// `RefreshTokenRequest` no longer exist — see `logout` / `refresh` handlers.

/// Forgot password request payload
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct ForgotPasswordRequest {
    /// User's email address
    #[validate(email(message = "Invalid email format"))]
    pub email: String,
}

/// Reset password request payload
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct ResetPasswordRequest {
    /// Password reset token
    #[validate(length(min = 1, message = "Token is required"))]
    pub token: String,

    /// New password
    #[validate(length(min = 8, message = "Password must be at least 8 characters"))]
    pub password: String,
}

/// User role enumeration
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "user_role", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    #[default]
    Customer,
    Admin,
    SuperAdmin,
}

/// User response (safe, excludes password)
#[derive(Debug, Clone, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: Option<String>,
    pub role: UserRole,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
    #[serde(rename = "firstName", skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(rename = "lastName", skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(rename = "avatarUrl", skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(rename = "membershipId", skip_serializing_if = "Option::is_none")]
    pub membership_id: Option<String>,
}

/// Authentication tokens returned in the JSON body.
///
/// Phase 3 of the HttpOnly-cookie migration: only the access token is
/// returned in the JSON body. The refresh token is delivered exclusively
/// via the `refresh_token` HttpOnly cookie (`Set-Cookie`) — JavaScript
/// cannot read it, which removes the XSS exfiltration surface that the
/// pre-migration localStorage contract was exposed to.
#[derive(Debug, Clone, Serialize)]
pub struct AuthTokens {
    #[serde(rename = "accessToken")]
    pub access_token: String,
}

/// Registration/Login response
#[derive(Debug, Clone, Serialize)]
pub struct AuthResponse {
    pub user: UserResponse,
    pub tokens: AuthTokens,
}

/// Token refresh response
#[derive(Debug, Clone, Serialize)]
pub struct TokenRefreshResponse {
    pub tokens: AuthTokens,
}

/// Generic message response
#[derive(Debug, Clone, Serialize)]
pub struct MessageResponse {
    pub message: String,
}

/// Current user response
#[derive(Debug, Clone, Serialize)]
pub struct MeResponse {
    pub user: UserResponse,
}

// ============================================================================
// Database Row Types
// ============================================================================

/// User database row
#[derive(Debug, Clone, sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    email: Option<String>,
    password_hash: Option<String>,
    role: Option<UserRole>,
    is_active: Option<bool>,
    email_verified: Option<bool>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
}

/// User with profile database row
#[derive(Debug, Clone, sqlx::FromRow)]
struct UserWithProfileRow {
    id: Uuid,
    email: Option<String>,
    role: Option<UserRole>,
    is_active: Option<bool>,
    email_verified: Option<bool>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    first_name: Option<String>,
    last_name: Option<String>,
    phone: Option<String>,
    avatar_url: Option<String>,
    membership_id: Option<String>,
}

impl From<UserWithProfileRow> for UserResponse {
    fn from(row: UserWithProfileRow) -> Self {
        UserResponse {
            id: row.id.to_string(),
            email: row.email,
            role: row.role.unwrap_or_default(),
            is_active: row.is_active.unwrap_or(true),
            email_verified: row.email_verified.unwrap_or(false),
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
            first_name: row.first_name,
            last_name: row.last_name,
            phone: row.phone,
            avatar_url: row.avatar_url,
            membership_id: row.membership_id,
        }
    }
}

// ============================================================================
// JWT Claims
// ============================================================================

/// JWT claims structure
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    /// User ID
    id: String,
    /// User email
    email: Option<String>,
    /// User role
    role: String,
    /// Expiration timestamp
    exp: i64,
    /// Issued at timestamp
    iat: i64,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Hash a password using Argon2
async fn hash_password(password: &str) -> Result<String, AppError> {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))
}

/// Verify a password against a hash
async fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };

    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Invalid password hash format: {}", e)))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Generate JWT access token
fn generate_access_token(
    user_id: &Uuid,
    email: Option<&str>,
    role: &str,
    jwt_secret: &str,
    expiration_secs: i64,
) -> Result<String, AppError> {
    use jsonwebtoken::{encode, EncodingKey, Header};

    let now = Utc::now();
    let claims = Claims {
        id: user_id.to_string(),
        email: email.map(String::from),
        role: role.to_string(),
        exp: (now + Duration::seconds(expiration_secs)).timestamp(),
        iat: now.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to generate access token: {}", e)))
}

/// Generate a random refresh token
fn generate_refresh_token_string() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use rand::RngCore;

    let mut token_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut token_bytes);
    URL_SAFE_NO_PAD.encode(token_bytes)
}

/// Generate a random membership ID string
pub(crate) fn generate_random_membership_id() -> String {
    use rand::Rng;

    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const ID_LENGTH: usize = 8;

    let mut rng = rand::thread_rng();
    (0..ID_LENGTH)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Generate a unique membership ID (8 alphanumeric characters)
pub(crate) async fn generate_membership_id(db: &sqlx::PgPool) -> Result<String, AppError> {
    // Try up to 10 times to generate a unique ID
    for _ in 0..10 {
        // Generate random ID in sync context (rng is not Send)
        let id = generate_random_membership_id();

        // Check if ID already exists
        let exists: Option<(i64,)> =
            sqlx::query_as("SELECT 1 FROM user_profiles WHERE membership_id = $1")
                .bind(&id)
                .fetch_optional(db)
                .await
                .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

        if exists.is_none() {
            return Ok(id);
        }
    }

    Err(AppError::Internal(
        "Failed to generate unique membership ID".to_string(),
    ))
}

/// Get user profile by ID
async fn get_user_profile(db: &sqlx::PgPool, user_id: &Uuid) -> Result<UserResponse, AppError> {
    let row: UserWithProfileRow = sqlx::query_as(
        r#"
        SELECT
            u.id,
            u.email,
            u.role,
            u.is_active,
            u.email_verified,
            u.created_at,
            u.updated_at,
            up.first_name,
            up.last_name,
            up.phone,
            up.avatar_url,
            up.membership_id
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    Ok(row.into())
}

// ============================================================================
// Route Handlers
// ============================================================================

/// POST /api/auth/register
///
/// Creates a new user account. Phase 3: the refresh token is delivered
/// exclusively in the `refresh_token` HttpOnly cookie — it is no longer
/// returned in the JSON body.
#[axum::debug_handler]
async fn register(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<RegisterRequest>,
) -> Result<(CookieJar, Json<AuthResponse>), AppError> {
    // Validate request
    payload
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let db = state.db();

    // Hash password before opening the transaction so we don't hold a
    // transaction open for the duration of bcrypt.
    let password_hash = hash_password(&payload.password).await?;

    // Generate membership ID
    let membership_id = generate_membership_id(db).await?;

    // Start transaction
    let mut tx = db
        .begin()
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Create user. We use `ON CONFLICT (email) DO NOTHING RETURNING ...`
    // so two concurrent registrations for the same email can't both
    // succeed even if they pass an earlier existence check; the UNIQUE
    // constraint on `users.email` (migration `20260513000000`) is the
    // single source of truth. The loser of the race gets `None` from
    // `fetch_optional` and we surface a 409 Conflict — matching the
    // behaviour the previous read-then-insert was trying (and failing
    // under concurrency) to produce.
    let user_row: Option<UserRow> = sqlx::query_as(
        r#"
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2)
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email, password_hash, role, is_active, email_verified, created_at, updated_at
        "#,
    )
    .bind(&payload.email)
    .bind(&password_hash)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let mut user_row = match user_row {
        Some(row) => row,
        None => return Err(AppError::Conflict("Email already registered".to_string())),
    };

    // Admin bootstrap (issue #348): when the registering email is on the
    // ADMIN_BOOTSTRAP_EMAILS allowlist, promote the freshly inserted row
    // to 'admin' inside the same transaction, so the very first JWT (and
    // the response body below) already carry role=admin.
    //
    // SECURITY: `payload.email` is USER INPUT, not operator config — the
    // allowlist match only proves the submitted address collides
    // case-insensitively with a configured entry. `users.email`
    // uniqueness is byte-exact, so a case variant of a listed address is
    // a DISTINCT row that still satisfies `contains()`. Promotion is
    // therefore one-shot and unambiguous; it happens only when:
    //
    // (a) no OTHER user row matches the entry case-insensitively (the
    //     only candidate is the row just inserted) — ambiguity means a
    //     case-variant row exists and we refuse;
    // (b) no matching row already holds admin/super_admin — implied by
    //     (a) here, because the sole matching row is the one this
    //     transaction just inserted with role 'customer';
    // (c) no prior bootstrap promotion is recorded for the entry — the
    //     `admin_bootstrap_promotion` row in `user_audit_log` is the
    //     one-shot marker shared with the startup sweep.
    //
    // Checks, role UPDATE, and marker INSERT all run in this
    // transaction, so the promotion cannot half-apply. The raw email is
    // never logged (user input, PII) — only its stable hash.
    if state.config().admin_bootstrap.contains(&payload.email) {
        let entry = payload.email.trim().to_lowercase();
        let entry_hash = crate::utils::hash_email(&entry);

        // Serialize concurrent promotions for the same entry (two case
        // variants registering at once would otherwise each see zero
        // "other" rows under READ COMMITTED). Transaction-scoped lock,
        // shared with the startup sweep; released on commit/rollback.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
            .bind(format!("admin_bootstrap:{entry}"))
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

        // (a) rows OTHER than the one just inserted.
        let other_matches: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE lower(email) = $1 AND id <> $2")
                .bind(&entry)
                .bind(user_row.id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

        // (c) one-shot marker.
        let prior_promotions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_audit_log \
             WHERE action = 'admin_bootstrap_promotion' AND details->>'email_hash' = $1",
        )
        .bind(&entry_hash)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

        if other_matches > 0 {
            tracing::warn!(
                email_hash = %entry_hash,
                user_id = %user_row.id,
                other_matching_rows = other_matches,
                "Admin bootstrap: refusing register-path promotion — {} other user row(s) \
                 match the allowlist entry case-insensitively (ambiguous; possible \
                 case-variant escalation attempt). Registering as customer.",
                other_matches
            );
        } else if prior_promotions > 0 {
            tracing::warn!(
                email_hash = %entry_hash,
                user_id = %user_row.id,
                "Admin bootstrap: refusing register-path promotion — a promotion for this \
                 entry is already recorded (one-shot). Registering as customer."
            );
        } else {
            sqlx::query(
                r#"
                UPDATE users
                SET role = 'admin'::user_role, updated_at = NOW()
                WHERE id = $1 AND role = 'customer'::user_role
                "#,
            )
            .bind(user_row.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

            // One-shot marker + audit trail, same transaction as the UPDATE.
            sqlx::query(
                "INSERT INTO user_audit_log (user_id, action, details) \
                 VALUES ($1, 'admin_bootstrap_promotion', $2)",
            )
            .bind(user_row.id)
            .bind(serde_json::json!({ "email_hash": entry_hash, "source": "register" }))
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

            user_row.role = Some(UserRole::Admin);
            tracing::info!(
                email_hash = %entry_hash,
                user_id = %user_row.id,
                "Admin bootstrap: promoted registering user to admin (ADMIN_BOOTSTRAP_EMAILS)"
            );
        }
    }

    // Create user profile
    sqlx::query(
        r#"
        INSERT INTO user_profiles (user_id, first_name, last_name, phone, membership_id)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(&user_row.id)
    .bind(&payload.first_name)
    .bind(&payload.last_name)
    .bind(&payload.phone)
    .bind(&membership_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Generate tokens
    let role_str = format!("{:?}", user_row.role.unwrap_or_default()).to_lowercase();
    let config = state.config();
    let access_token = generate_access_token(
        &user_row.id,
        user_row.email.as_deref(),
        &role_str,
        &config.auth.jwt_secret,
        config.auth.access_token_expiry_secs as i64,
    )?;

    let refresh_token = generate_refresh_token_string();
    let refresh_expires_at = Utc::now() + Duration::days(7);

    // Store refresh token
    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(&user_row.id)
    .bind(&refresh_token)
    .bind(&refresh_expires_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Create initial loyalty record (default tier, 0 points, 0 nights).
    // Default tier = lowest active tier by min_nights, not a name match —
    // 'Bronze' is renameable through the admin tier editor.
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, current_points, total_nights, tier_id)
        SELECT $1, 0, 0, id
        FROM tiers
        WHERE is_active = true
        ORDER BY min_nights ASC, sort_order ASC
        LIMIT 1
        "#,
    )
    .bind(&user_row.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Log registration action
    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details)
        VALUES ($1, 'register', $2)
        "#,
    )
    .bind(&user_row.id)
    .bind(serde_json::json!({ "email": payload.email }))
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Commit transaction
    tx.commit()
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Build response
    let user_response = UserResponse {
        id: user_row.id.to_string(),
        email: user_row.email,
        role: user_row.role.unwrap_or_default(),
        is_active: user_row.is_active.unwrap_or(true),
        email_verified: user_row.email_verified.unwrap_or(false),
        created_at: user_row.created_at.unwrap_or_else(Utc::now),
        updated_at: user_row.updated_at.unwrap_or_else(Utc::now),
        first_name: Some(payload.first_name),
        last_name: Some(payload.last_name),
        phone: payload.phone,
        avatar_url: None,
        membership_id: Some(membership_id),
    };

    tracing::info!("User registered: {}", user_response.id);

    // Phase 3: deliver the refresh token via HttpOnly cookie only.
    // Max-Age aligns with the DB row's expiry so the browser drops the
    // cookie when the server-side token expires.
    let refresh_max_age_secs = (refresh_expires_at - Utc::now()).num_seconds().max(0);
    let jar = jar.add(build_refresh_cookie(refresh_token, refresh_max_age_secs));

    // Note: Returns 200 OK instead of 201 CREATED for compatibility
    Ok((
        jar,
        Json(AuthResponse {
            user: user_response,
            tokens: AuthTokens { access_token },
        }),
    ))
}

/// POST /api/auth/login
/// Authenticates a user with email and password.
///
/// Phase 3 of the HttpOnly-cookie migration: the refresh token is delivered
/// EXCLUSIVELY via the `refresh_token` HttpOnly cookie. It is no longer
/// returned in the JSON body — JavaScript (including any XSS payload)
/// cannot read it. See `crate::middleware::auth::build_refresh_cookie` for
/// the cookie attributes and rationale.
async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<LoginRequest>,
) -> Result<(CookieJar, Json<AuthResponse>), AppError> {
    // Validate request
    payload
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let db = state.db();

    // Find user by email
    let user_row: Option<UserRow> = sqlx::query_as(
        r#"
        SELECT id, email, password_hash, role, is_active, email_verified, created_at, updated_at
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(&payload.email)
    .fetch_optional(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let user_row =
        user_row.ok_or_else(|| AppError::Unauthorized("Invalid email or password".to_string()))?;

    // Check if user is active
    if !user_row.is_active.unwrap_or(true) {
        return Err(AppError::Forbidden(
            "Account is disabled. Please contact support.".to_string(),
        ));
    }

    // Check if user has a password (might be OAuth-only account)
    let password_hash = user_row.password_hash.as_ref().ok_or_else(|| {
        AppError::BadRequest(
            "This account uses social login. Please sign in with Google/LINE or reset your password.".to_string()
        )
    })?;

    // Verify password
    let is_valid = verify_password(&payload.password, password_hash).await?;
    if !is_valid {
        return Err(AppError::Unauthorized(
            "Invalid email or password".to_string(),
        ));
    }

    // Generate tokens
    let role_str = format!("{:?}", user_row.role.unwrap_or_default()).to_lowercase();
    let config = state.config();
    let access_expiration = if payload.remember_me {
        7200 // 2 hours
    } else {
        config.auth.access_token_expiry_secs as i64
    };

    let access_token = generate_access_token(
        &user_row.id,
        user_row.email.as_deref(),
        &role_str,
        &config.auth.jwt_secret,
        access_expiration,
    )?;

    let refresh_token = generate_refresh_token_string();
    let refresh_expires_days = if payload.remember_me { 30 } else { 7 };
    let refresh_expires_at = Utc::now() + Duration::days(refresh_expires_days);

    // Store refresh token
    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(&user_row.id)
    .bind(&refresh_token)
    .bind(&refresh_expires_at)
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Log login action
    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details)
        VALUES ($1, 'login', $2)
        "#,
    )
    .bind(&user_row.id)
    .bind(serde_json::json!({ "email": payload.email }))
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Get full user profile
    let user_response = get_user_profile(db, &user_row.id).await?;

    tracing::info!("User logged in: {}", user_response.id);

    // Phase 3: the refresh token is delivered only via the HttpOnly cookie.
    // Cookie's Max-Age aligns with the DB row expiry so the browser drops
    // the cookie when the server-side token expires.
    let refresh_max_age_secs = (refresh_expires_at - Utc::now()).num_seconds().max(0);
    let jar = jar.add(build_refresh_cookie(refresh_token, refresh_max_age_secs));

    Ok((
        jar,
        Json(AuthResponse {
            user: user_response,
            tokens: AuthTokens { access_token },
        }),
    ))
}

/// LIFF login request (POST /api/auth/liff)
#[derive(Debug, Deserialize)]
pub struct LiffLoginRequest {
    #[serde(rename = "idToken")]
    pub id_token: String,
}

/// POST /api/auth/liff - Silent login from inside LINE (LIFF).
///
/// Verifies the LIFF ID token with LINE, finds-or-creates the member from
/// the LINE identity (silent enrollment — docs/launch-plan.md), and issues
/// the exact same access-token + HttpOnly-refresh-cookie contract as
/// /api/auth/login. The LIFF app is attached to the LINE Login channel, so
/// the userId matches web "Sign in with LINE" accounts (ADR-0002).
async fn liff_login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<LiffLoginRequest>,
) -> Result<(CookieJar, Json<AuthResponse>), AppError> {
    if payload.id_token.trim().is_empty() {
        return Err(AppError::Validation("idToken is required".to_string()));
    }

    let config = state.config();
    let client_id = config
        .oauth
        .line
        .client_id
        .clone()
        .ok_or_else(|| AppError::Configuration("LINE login is not configured".to_string()))?;

    // 1. Verify the ID token with LINE.
    let claims = crate::services::line::verify_liff_id_token(&payload.id_token, &client_id).await?;

    // 2. Silent enrollment: find-or-create the member by LINE userId.
    let profile = super::oauth::LineProfile {
        user_id: claims.sub,
        display_name: claims.name.unwrap_or_else(|| "LINE Member".to_string()),
        picture_url: claims.picture,
        status_message: None,
    };
    let (oauth_user, is_new_user) = super::oauth::upsert_line_user(&state, &profile).await?;
    let user_id: Uuid = oauth_user
        .id
        .parse()
        .map_err(|_| AppError::Internal("Invalid user id from enrollment".to_string()))?;

    // 3. Same token + cookie contract as login().
    let access_token = generate_access_token(
        &user_id,
        oauth_user.email.as_deref(),
        &oauth_user.role,
        &config.auth.jwt_secret,
        config.auth.access_token_expiry_secs as i64,
    )?;

    let refresh_token = generate_refresh_token_string();
    let refresh_expires_at = Utc::now() + Duration::days(7);

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(&refresh_token)
    .bind(refresh_expires_at)
    .execute(state.db())
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details)
        VALUES ($1, 'login', $2)
        "#,
    )
    .bind(user_id)
    .bind(serde_json::json!({ "method": "liff", "isNewUser": is_new_user }))
    .execute(state.db())
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let user_response = get_user_profile(state.db(), &user_id).await?;

    tracing::info!(user_id = %user_id, is_new_user, "LIFF login");

    let refresh_max_age_secs = (refresh_expires_at - Utc::now()).num_seconds().max(0);
    let jar = jar.add(build_refresh_cookie(refresh_token, refresh_max_age_secs));

    Ok((
        jar,
        Json(AuthResponse {
            user: user_response,
            tokens: AuthTokens { access_token },
        }),
    ))
}

/// Map a Cloudflare Access verification failure onto the app's error type.
///
/// `FetchFailed` (JWKS unreachable) is a transient infrastructure problem,
/// not a caller mistake, so it maps to a 5xx. Every other variant means the
/// presented token itself is invalid, missing, or untrusted, which is a
/// client-side 401/403 — deliberately vague ("invalid Cloudflare Access
/// token") rather than echoing the specific validation failure back to the
/// caller.
fn cf_access_error_to_app_error(err: cf_access::CfAccessError) -> AppError {
    match err {
        cf_access::CfAccessError::FetchFailed(e) => AppError::Internal(format!(
            "Cloudflare Access verification temporarily unavailable: {e}"
        )),
        other => {
            tracing::warn!(error = %other, "Cloudflare Access token rejected");
            AppError::Forbidden("Invalid Cloudflare Access token".to_string())
        },
    }
}

/// POST /api/auth/cf-exchange
///
/// STRICTLY ADDITIVE admin auto-login: exchanges a verified Cloudflare
/// Access identity (Google SSO behind the `loyalty.saichon.com/admin*`
/// Access application) for this app's normal session — the exact same
/// access-token + refresh-cookie contract `login` produces. It changes
/// NOTHING about guest/customer authentication: email+password login
/// (`login`, above) and the Google/LINE OAuth flows in `routes::oauth` are
/// completely untouched, and this endpoint only ever succeeds for a user
/// row whose `role` is `admin` or `super_admin`.
///
/// The Cloudflare Access JWT is read from the `Cf-Access-Jwt-Assertion`
/// header (present on every request that passed the Access policy) or the
/// `CF_Authorization` cookie (carried over on this same-origin `/api/*`
/// call even though `/api/*` isn't itself Access-gated). After verifying it
/// against Cloudflare's JWKS, the verified email is looked up against
/// `users`; only an active admin/super_admin row is allowed through — any
/// other outcome (no CF token, invalid CF token, unmapped email, customer
/// role, inactive account) is a 401/403 and the frontend falls back to the
/// normal login form.
async fn cf_exchange(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<(CookieJar, Json<AuthResponse>), AppError> {
    let config = state.config();

    if !config.cf_access.enabled {
        return Err(AppError::Forbidden(
            "Cloudflare Access exchange is disabled".to_string(),
        ));
    }

    let token = cf_access::extract_cf_access_token(&headers, &jar).ok_or_else(|| {
        AppError::Unauthorized("No Cloudflare Access token presented".to_string())
    })?;

    // Shared and bounded: a JWKS endpoint that accepts the connection and
    // then stalls used to hold this admin login open until the router's own
    // timeout cut it. See `services::http`.
    let jwks = cf_access::get_cached_jwks(outbound(), &config.cf_access.jwks_url)
        .await
        .map_err(cf_access_error_to_app_error)?;

    let cf_email = cf_access::verify_cf_access_jwt(
        &token,
        &jwks,
        &config.cf_access.issuer,
        &config.cf_access.aud,
    )
    .map_err(cf_access_error_to_app_error)?;

    let db = state.db();

    // Only an active admin/super_admin row may exchange a Cloudflare
    // identity for a session — a verified Access login with no matching
    // (or non-admin) local account is a 403, not an account creation
    // trigger. We never provision users here.
    let user_row: Option<UserRow> = sqlx::query_as(
        r#"
        SELECT id, email, password_hash, role, is_active, email_verified, created_at, updated_at
        FROM users
        WHERE lower(email) = lower($1)
          AND role::text IN ('admin', 'super_admin')
          AND is_active
        "#,
    )
    .bind(&cf_email)
    .fetch_optional(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let user_row = user_row.ok_or_else(|| {
        tracing::warn!(
            email = %cf_email,
            "Cloudflare Access identity verified but no matching active admin account"
        );
        AppError::Forbidden(format!(
            "No active admin account found for {cf_email}. Ask an existing admin to grant access."
        ))
    })?;

    // Mint the exact same session `login` does: HS256 access token in the
    // JSON body, opaque refresh token stored server-side and delivered via
    // the HttpOnly cookie.
    let role_str = format!("{:?}", user_row.role.unwrap_or_default()).to_lowercase();
    let access_token = generate_access_token(
        &user_row.id,
        user_row.email.as_deref(),
        &role_str,
        &config.auth.jwt_secret,
        config.auth.access_token_expiry_secs as i64,
    )?;

    let refresh_token = generate_refresh_token_string();
    let refresh_expires_at = Utc::now() + Duration::days(7);

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(&user_row.id)
    .bind(&refresh_token)
    .bind(&refresh_expires_at)
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details)
        VALUES ($1, 'cf_access_login', $2)
        "#,
    )
    .bind(&user_row.id)
    .bind(serde_json::json!({ "email": cf_email }))
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let user_response = get_user_profile(db, &user_row.id).await?;

    tracing::info!(
        "Admin logged in via Cloudflare Access: {}",
        user_response.id
    );

    let refresh_max_age_secs = (refresh_expires_at - Utc::now()).num_seconds().max(0);
    let jar = jar.add(build_refresh_cookie(refresh_token, refresh_max_age_secs));

    Ok((
        jar,
        Json(AuthResponse {
            user: user_response,
            tokens: AuthTokens { access_token },
        }),
    ))
}

/// POST /api/auth/logout
/// Invalidates the user's refresh token and clears the refresh-token cookie.
///
/// Phase 3: takes no JSON body — the refresh token to invalidate is read
/// exclusively from the `refresh_token` HttpOnly cookie. The response
/// always emits a `Set-Cookie: refresh_token=; Max-Age=0` so the browser
/// drops the cookie even if it was already expired/missing.
async fn logout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<MessageResponse>), AppError> {
    let db = state.db();

    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::Unauthorized("Invalid user ID".to_string()))?;

    // Delete the server-side refresh-token row if the cookie carried one.
    // If the cookie is missing we still proceed — the user's authenticated
    // session is being torn down regardless, and the row (if any) will be
    // garbage-collected on its `expires_at`.
    if let Some(cookie_token) = jar.get(REFRESH_COOKIE_NAME).map(|c| c.value().to_string()) {
        sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2")
            .bind(&user_id)
            .bind(&cookie_token)
            .execute(db)
            .await
            .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;
    }

    // Log logout action
    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details)
        VALUES ($1, 'logout', '{}')
        "#,
    )
    .bind(&user_id)
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    tracing::info!("User logged out: {}", user_id);

    // Always clear the cookie, even if no refresh_token was supplied.
    let jar = jar.add(build_clear_refresh_cookie());

    Ok((
        jar,
        Json(MessageResponse {
            message: "Logged out successfully".to_string(),
        }),
    ))
}

/// POST /api/auth/refresh
/// Issues a new access token using a refresh token.
///
/// Phase 3: the refresh token is read EXCLUSIVELY from the `refresh_token`
/// HttpOnly cookie. The JSON-body `refreshToken` field accepted in Phase 1
/// is no longer supported — clients that previously sent it must rely on
/// the browser-managed cookie (axios `withCredentials: true`). Missing or
/// empty cookies return 401.
async fn refresh(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<TokenRefreshResponse>), AppError> {
    let db = state.db();

    // Phase 3: cookie-only. An empty cookie value is treated as missing so
    // a stale `Set-Cookie: refresh_token=` (e.g., from a prior logout race)
    // still produces a clean 401.
    let supplied_token = jar
        .get(REFRESH_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Unauthorized("Missing refresh token cookie".to_string()))?;

    // Find valid refresh token
    let token_row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT user_id
        FROM refresh_tokens
        WHERE token = $1 AND expires_at > NOW()
        "#,
    )
    .bind(&supplied_token)
    .fetch_optional(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let (user_id,) = token_row
        .ok_or_else(|| AppError::Unauthorized("Invalid or expired refresh token".to_string()))?;

    // Get user
    let user_row: Option<UserRow> = sqlx::query_as(
        r#"
        SELECT id, email, password_hash, role, is_active, email_verified, created_at, updated_at
        FROM users
        WHERE id = $1 AND is_active = true
        "#,
    )
    .bind(&user_id)
    .fetch_optional(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let user_row =
        user_row.ok_or_else(|| AppError::Unauthorized("User not found or inactive".to_string()))?;

    // Generate new tokens
    let role_str = format!("{:?}", user_row.role.unwrap_or_default()).to_lowercase();
    let config = state.config();
    let access_token = generate_access_token(
        &user_row.id,
        user_row.email.as_deref(),
        &role_str,
        &config.auth.jwt_secret,
        config.auth.access_token_expiry_secs as i64,
    )?;

    let new_refresh_token = generate_refresh_token_string();
    let refresh_expires_at = Utc::now() + Duration::days(7);

    // Delete old refresh token and insert new one
    sqlx::query("DELETE FROM refresh_tokens WHERE token = $1")
        .bind(&supplied_token)
        .execute(db)
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(&user_row.id)
    .bind(&new_refresh_token)
    .bind(&refresh_expires_at)
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    tracing::debug!("Token refreshed for user: {}", user_row.id);

    // Phase 3: the rotated refresh token is delivered solely via the
    // Set-Cookie header — never in the JSON body. Max-Age matches the new
    // DB row's expiry.
    let refresh_max_age_secs = (refresh_expires_at - Utc::now()).num_seconds().max(0);
    let jar = jar.add(build_refresh_cookie(
        new_refresh_token,
        refresh_max_age_secs,
    ));

    Ok((
        jar,
        Json(TokenRefreshResponse {
            tokens: AuthTokens { access_token },
        }),
    ))
}

/// POST /api/auth/forgot-password (or /api/auth/reset-password/request)
/// Initiates the password reset process
async fn forgot_password(
    State(state): State<AppState>,
    Json(payload): Json<ForgotPasswordRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    // Validate request
    payload
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let db = state.db();

    // Find user by email (don't reveal if email exists)
    let user_row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id, email FROM users WHERE email = $1")
            .bind(&payload.email)
            .fetch_optional(db)
            .await
            .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    if let Some((user_id, _email)) = user_row {
        // Generate the reset token + its argon2 hash up front. The plain
        // token rides into the email; the hash is what we persist.
        let reset_token = Uuid::new_v4().to_string();
        let hashed_token = hash_password(&reset_token).await?;

        // LOW-1 (correctness-2026-05-13.md): application-level cooldown
        // on top of the existing HTTP rate limiter (strict 5/min on
        // `/api/auth/forgot-password` per routes/mod.rs). Even within the
        // 5/min budget an attacker can produce up to 5 token rows per
        // minute per IP for a single victim; the cooldown caps that to
        // one *useful* token per minute per user_id regardless of caller
        // IP. The guard inserts only when no unused, unexpired token
        // exists that's newer than one minute. We detect the cooldown
        // hit by checking the returned row id — when the guard short-
        // circuits the INSERT, we silently skip the email send and the
        // response stays generic (still no email enumeration).
        let inserted_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            INSERT INTO password_reset_tokens (user_id, token, expires_at)
            SELECT $1, $2, NOW() + INTERVAL '1 hour'
            WHERE NOT EXISTS (
                SELECT 1
                  FROM password_reset_tokens
                 WHERE user_id = $1
                   AND COALESCE(used, false) = false
                   AND expires_at > NOW()
                   AND created_at > NOW() - INTERVAL '1 minute'
            )
            RETURNING id
            "#,
        )
        .bind(&user_id)
        .bind(&hashed_token)
        .fetch_optional(db)
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

        if inserted_id.is_none() {
            // Cooldown hit — a fresh, unused token already exists. Log
            // the suppression and skip the email send. Still fall through
            // to the generic "if the email exists..." response so
            // attackers can't probe for known emails via timing.
            tracing::info!(
                "Password reset cooldown hit for user {} — skipping new token",
                user_id
            );
        } else {
            // Log action only when a new token was actually issued.
            sqlx::query(
                r#"
                INSERT INTO user_audit_log (user_id, action, details)
                VALUES ($1, 'password_reset_request', '{}')
                "#,
            )
            .bind(&user_id)
            .execute(db)
            .await
            .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

            // Send email with reset link containing reset_token
            let email_service = EmailServiceImpl::from_smtp_config(
                &state.config().email.smtp,
                &state.config().server.frontend_url,
            );

            if email_service.is_configured() {
                if let Err(e) = email_service
                    .send_password_reset_email(&_email, &reset_token)
                    .await
                {
                    // Log error but don't fail the request - we still want
                    // to return success to prevent email enumeration.
                    tracing::error!("Failed to send password reset email: {}", e);
                } else {
                    tracing::info!("Password reset email sent to user: {}", user_id);
                }
            } else {
                // In development, log that email would have been sent
                tracing::warn!(
                    "SMTP not configured, skipping password reset email for user: {}",
                    user_id
                );
            }

            tracing::info!("Password reset requested for user: {}", user_id);
        }
    } else {
        // Log attempt for non-existent email (don't reveal to user)
        tracing::info!("Password reset requested for non-existent email");
    }

    // Always return success to prevent email enumeration
    Ok(Json(MessageResponse {
        message: "If the email exists, a password reset link has been sent".to_string(),
    }))
}

/// POST /api/auth/reset-password
/// Resets the user's password using a reset token
async fn reset_password(
    State(state): State<AppState>,
    Json(payload): Json<ResetPasswordRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    // Validate request
    payload
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let db = state.db();

    // Find valid reset token
    let token_row: Option<(Uuid, String)> = sqlx::query_as(
        r#"
        SELECT user_id, token
        FROM password_reset_tokens
        WHERE expires_at > NOW() AND used = false
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    let (user_id, hashed_token) = token_row
        .ok_or_else(|| AppError::BadRequest("Invalid or expired reset token".to_string()))?;

    // Verify token
    let is_valid = verify_password(&payload.token, &hashed_token).await?;
    if !is_valid {
        return Err(AppError::BadRequest(
            "Invalid or expired reset token".to_string(),
        ));
    }

    // Hash new password
    let new_password_hash = hash_password(&payload.password).await?;

    // Update password
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&new_password_hash)
        .bind(&user_id)
        .execute(db)
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Mark token as used
    sqlx::query("UPDATE password_reset_tokens SET used = true WHERE token = $1")
        .bind(&hashed_token)
        .execute(db)
        .await
        .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    // Log action
    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details)
        VALUES ($1, 'password_reset_complete', '{}')
        "#,
    )
    .bind(&user_id)
    .execute(db)
    .await
    .map_err(|e| AppError::DatabaseQuery(e.to_string()))?;

    tracing::info!("Password reset completed for user: {}", user_id);

    Ok(Json(MessageResponse {
        message: "Password reset successfully".to_string(),
    }))
}

/// GET /api/auth/me
/// Returns the authenticated user's profile
async fn me(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<MeResponse>, AppError> {
    let db = state.db();

    // Parse user ID
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::Unauthorized("Invalid user ID".to_string()))?;

    // Get user profile
    let user_response = get_user_profile(db, &user_id).await?;

    Ok(Json(MeResponse {
        user: user_response,
    }))
}

// ============================================================================
// Router Configuration
// ============================================================================

/// Create auth routes with state support
///
/// Returns a Router that expects AppState to be provided via `.with_state()`
/// when merged into the main router.
pub fn routes() -> Router<AppState> {
    // Protected routes (require authentication)
    let protected_routes = Router::<AppState>::new()
        .route("/logout", post(logout))
        .route("/me", get(me))
        .layer(middleware::from_fn(auth_middleware));

    // Public routes (no authentication required)
    let public_routes = Router::<AppState>::new()
        .route("/login", post(login))
        .route("/liff", post(liff_login))
        .route("/register", post(register))
        .route("/refresh", post(refresh))
        .route("/reset-password/request", post(forgot_password))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
        // Admin-only Cloudflare Access exchange. Public (no auth_middleware)
        // by necessity — it's what MINTS the session — but it only ever
        // succeeds for a verified Cloudflare identity mapped to an active
        // admin/super_admin user row. See `cf_exchange` doc comment.
        .route("/cf-exchange", post(cf_exchange));

    Router::<AppState>::new()
        .merge(protected_routes)
        .merge(public_routes)
}

/// Create auth routes with application state
pub fn routes_with_state(state: AppState) -> Router {
    // Protected routes (require authentication)
    let protected_routes = Router::<AppState>::new()
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .layer(middleware::from_fn(auth_middleware));

    // Public routes (no authentication required)
    let public_routes = Router::<AppState>::new()
        .route("/auth/login", post(login))
        .route("/auth/liff", post(liff_login))
        .route("/auth/register", post(register))
        .route("/auth/refresh", post(refresh))
        .route("/auth/reset-password/request", post(forgot_password))
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
        .route("/auth/cf-exchange", post(cf_exchange));

    Router::<AppState>::new()
        .merge(protected_routes)
        .merge(public_routes)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_role_default() {
        assert_eq!(UserRole::default(), UserRole::Customer);
    }

    #[test]
    fn test_register_request_validation() {
        let valid_request = RegisterRequest {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            phone: None,
        };
        assert!(valid_request.validate().is_ok());

        let invalid_email = RegisterRequest {
            email: "invalid-email".to_string(),
            password: "password123".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            phone: None,
        };
        assert!(invalid_email.validate().is_err());

        let short_password = RegisterRequest {
            email: "test@example.com".to_string(),
            password: "short".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            phone: None,
        };
        assert!(short_password.validate().is_err());
    }

    #[test]
    fn test_login_request_validation() {
        let valid_request = LoginRequest {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            remember_me: false,
        };
        assert!(valid_request.validate().is_ok());

        let invalid_email = LoginRequest {
            email: "invalid".to_string(),
            password: "password123".to_string(),
            remember_me: false,
        };
        assert!(invalid_email.validate().is_err());
    }

    #[test]
    fn test_generate_refresh_token_string() {
        let token1 = generate_refresh_token_string();
        let token2 = generate_refresh_token_string();

        // Tokens should be 43 characters (32 bytes base64 encoded)
        assert_eq!(token1.len(), 43);
        assert_eq!(token2.len(), 43);

        // Tokens should be unique
        assert_ne!(token1, token2);
    }

    #[test]
    fn test_auth_tokens_serialization_omits_refresh_token() {
        // Phase 3 contract: the AuthTokens body struct must only contain
        // `accessToken`. A regression that re-adds `refreshToken` here
        // would leak the token into JSON responses again.
        let tokens = AuthTokens {
            access_token: "header.payload.signature".to_string(),
        };
        let json = serde_json::to_string(&tokens).unwrap();
        assert!(
            json.contains("\"accessToken\":\"header.payload.signature\""),
            "Serialized AuthTokens must carry accessToken: {json}"
        );
        assert!(
            !json.contains("refreshToken"),
            "Phase 3: AuthTokens JSON MUST NOT contain a refreshToken field: {json}"
        );
        assert!(
            !json.contains("refresh_token"),
            "Phase 3: AuthTokens JSON MUST NOT contain a refresh_token field: {json}"
        );
    }

    #[test]
    fn test_user_response_serialization() {
        let user = UserResponse {
            id: "123".to_string(),
            email: Some("test@example.com".to_string()),
            role: UserRole::Customer,
            is_active: true,
            email_verified: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            phone: None,
            avatar_url: None,
            membership_id: Some("ABC12345".to_string()),
        };

        let json = serde_json::to_string(&user).unwrap();
        assert!(json.contains("\"isActive\":true"));
        assert!(json.contains("\"emailVerified\":false"));
        assert!(json.contains("\"firstName\":\"John\""));
        assert!(json.contains("\"membershipId\":\"ABC12345\""));
        // phone should be omitted when None
        assert!(!json.contains("\"phone\":null"));
    }
}
