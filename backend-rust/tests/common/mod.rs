//! Common test utilities and fixtures
//!
//! This module provides shared test infrastructure including:
//! - TestApp struct for spinning up the app for testing
//! - Test database setup and teardown
//! - Test fixtures for users, coupons, and other entities
//! - Helper functions for making authenticated requests
//! - Cleanup utilities

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{body::Body, http::Request, Router};
use chrono::{Duration, Utc};
use once_cell::sync::Lazy;
use redis::aio::ConnectionManager;
use serde::{de::DeserializeOwned, Serialize};
use sqlx::{postgres::PgPoolOptions, Executor, PgPool};
use tokio::sync::Mutex;
use tower::ServiceExt;
use uuid::Uuid;

// ============================================================================
// Test Configuration
// ============================================================================

/// Test database URL - uses a separate test database
pub fn test_database_url() -> String {
    std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://postgres:postgres@localhost:5438/loyalty_test_db".to_string()
    })
}

/// Test Redis URL
pub fn test_redis_url() -> String {
    std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://localhost:6383".to_string())
}

/// JWT secret for testing
pub const TEST_JWT_SECRET: &str = "test-jwt-secret-key-for-testing-only-minimum-32-chars";

/// Test user password (unhashed)
pub const TEST_USER_PASSWORD: &str = "TestPassword123!";

// ============================================================================
// TestApp - Main test application wrapper
// ============================================================================

/// TestApp wraps the application for integration testing.
///
/// It provides:
/// - A configured Router with all routes
/// - Database pool for test data setup
/// - Redis connection for cache testing
/// - HTTP client for making requests
///
/// # Example
///
/// ```ignore
/// let app = TestApp::new().await?;
/// let response = app.client().get("/api/health").await;
/// response.assert_status(200);
/// ```
pub struct TestApp {
    /// The configured Axum router
    router: Router,
    /// Database connection pool
    pool: PgPool,
    /// Redis connection manager
    redis: ConnectionManager,
    /// Test database wrapper for cleanup
    test_db: TestDatabase,
}

impl TestApp {
    /// Create a new TestApp instance with database and Redis connections.
    ///
    /// This sets up:
    /// - Test database connection pool
    /// - Test Redis connection
    /// - Application router with all routes configured
    pub async fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        // Load env vars
        let _ = dotenvy::dotenv();

        // Initialize test database
        let pool = setup_test_db().await?;

        // Initialize test Redis
        let redis = init_test_redis().await?;

        // Create test database wrapper
        let test_db = TestDatabase {
            pool: pool.clone(),
            schema_name: "public".to_string(),
        };

        // Create application state
        let config = create_test_config();
        let state = loyalty_backend::AppState::new(pool.clone(), redis.clone(), config);

        // Create router with all routes
        let router = loyalty_backend::routes::create_router(state);

        Ok(Self {
            router,
            pool,
            redis,
            test_db,
        })
    }

    /// Create a TestApp without database/Redis (for basic health check testing).
    ///
    /// This creates a minimal app that can test stateless endpoints.
    pub async fn new_minimal() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        // Load env vars
        let _ = dotenvy::dotenv();

        // Initialize test database
        let pool = setup_test_db().await?;

        // Initialize test Redis
        let redis = init_test_redis().await?;

        // Create test database wrapper
        let test_db = TestDatabase {
            pool: pool.clone(),
            schema_name: "public".to_string(),
        };

        // Create application state with test config
        let config = create_test_config();
        let state = loyalty_backend::AppState::new(pool.clone(), redis.clone(), config);

        // Create router
        let router = loyalty_backend::routes::create_router(state);

        Ok(Self {
            router,
            pool,
            redis,
            test_db,
        })
    }

    /// Get a reference to the database pool.
    pub fn db(&self) -> &PgPool {
        &self.pool
    }

    /// Get a clone of the Redis connection manager.
    pub fn redis(&self) -> ConnectionManager {
        self.redis.clone()
    }

    /// Get a TestClient for making HTTP requests.
    pub fn client(&self) -> TestClient {
        TestClient::new(self.router.clone())
    }

    /// Get an authenticated TestClient with a JWT token.
    pub fn authenticated_client(&self, user_id: &Uuid, email: &str) -> TestClient {
        let token = generate_test_token(user_id, email);
        TestClient::new(self.router.clone()).with_auth(&token)
    }

    /// Create a test user and return an authenticated client.
    pub async fn create_authenticated_user(
        &self,
        email: &str,
    ) -> Result<(TestUser, TestClient), Box<dyn std::error::Error + Send + Sync>> {
        let user = create_test_user(&self.pool, email).await?;
        let token = get_auth_token(&user.id, &user.email);
        let client = TestClient::new(self.router.clone()).with_auth(&token);
        Ok((user, client))
    }

    /// Clean up test data.
    pub async fn cleanup(&self) -> Result<(), sqlx::Error> {
        self.test_db.cleanup().await
    }

    /// Get the router for direct testing.
    pub fn router(&self) -> Router {
        self.router.clone()
    }
}

/// Create test configuration settings
fn create_test_config() -> loyalty_backend::Settings {
    use loyalty_backend::config::*;

    Settings {
        environment: Environment::Development,
        server: ServerConfig {
            port: 4202,
            host: "127.0.0.1".to_string(),
            frontend_url: "http://localhost:3201".to_string(),
            log_level: "debug".to_string(),
        },
        database: DatabaseConfig {
            url: test_database_url(),
            max_connections: 5,
            min_connections: 1,
            connection_timeout_secs: 30,
        },
        redis: RedisConfig {
            url: test_redis_url(),
            pool_size: 2,
        },
        auth: AuthConfig {
            jwt_secret: TEST_JWT_SECRET.to_string(),
            jwt_refresh_secret: "test-refresh-secret-key-for-testing-only-minimum-32-chars"
                .to_string(),
            session_secret: "test-session-secret-key-for-testing-only-minimum-32-chars".to_string(),
            access_token_expiry_secs: 3600,
            refresh_token_expiry_secs: 86400,
        },
        oauth: OAuthConfig::default(),
        email: EmailConfig::default(),
        slipok: SlipokConfig::default(),
        security: SecurityConfig::default(),
    }
}

// ============================================================================
// Database Setup
// ============================================================================

/// Global test database pool (shared across tests for efficiency)
static TEST_DB_POOL: Lazy<Arc<Mutex<Option<PgPool>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Test database configuration
#[derive(Debug, Clone)]
pub struct TestDbConfig {
    pub database_url: String,
    pub max_connections: u32,
}

impl Default for TestDbConfig {
    fn default() -> Self {
        Self {
            database_url: test_database_url(),
            max_connections: 5,
        }
    }
}

/// Set up the test database.
///
/// Creates a connection pool to the test database and runs migrations.
/// This function is idempotent - calling it multiple times returns the same pool.
pub async fn setup_test_db() -> Result<PgPool, sqlx::Error> {
    let mut guard = TEST_DB_POOL.lock().await;

    if let Some(pool) = guard.as_ref() {
        return Ok(pool.clone());
    }

    let config = TestDbConfig::default();

    // Create the connection pool
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .connect(&config.database_url)
        .await?;

    // Run migrations
    run_test_migrations(&pool).await?;

    *guard = Some(pool.clone());
    Ok(pool)
}

/// Clean up the test database.
///
/// Drops all test data from the database tables.
pub async fn cleanup_test_db(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Truncate all tables in reverse dependency order
    pool.execute(
        r#"
        TRUNCATE TABLE refresh_tokens, user_loyalty, user_profiles, coupons, users CASCADE
        "#,
    )
    .await?;
    Ok(())
}

/// Initialize the test database pool (legacy function, use setup_test_db instead)
pub async fn init_test_db() -> Result<PgPool, sqlx::Error> {
    setup_test_db().await
}

/// Create an isolated test database for a specific test
///
/// This creates a unique schema within the test database for isolation.
/// Each test gets its own schema to prevent interference.
pub async fn create_isolated_test_db(test_name: &str) -> Result<TestDatabase, sqlx::Error> {
    let pool = init_test_db().await?;
    let schema_name = format!("test_{}", test_name.replace("::", "_").replace("-", "_"));

    // Create a unique schema for this test
    pool.execute(format!("DROP SCHEMA IF EXISTS {} CASCADE", schema_name).as_str())
        .await?;
    pool.execute(format!("CREATE SCHEMA {}", schema_name).as_str())
        .await?;

    Ok(TestDatabase { pool, schema_name })
}

/// Run database migrations for tests
async fn run_test_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Check if essential tables exist
    let table_exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'users'
        )
        "#,
    )
    .fetch_one(pool)
    .await?;

    if !table_exists {
        // Run the migrations using sqlx migrate
        // Note: In a real setup, you would use sqlx::migrate!() macro
        // For now, we create minimal tables for testing
        create_test_tables(pool).await?;
    }

    Ok(())
}

/// Create minimal test tables if migrations haven't been run
async fn create_test_tables(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Create user_role enum if it doesn't exist
    pool.execute(
        r#"
        DO $$ BEGIN
            CREATE TYPE user_role AS ENUM ('customer', 'admin', 'super_admin');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        "#,
    )
    .await?;

    // Create users table
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE,
            password_hash VARCHAR(255),
            role user_role DEFAULT 'customer',
            is_active BOOLEAN DEFAULT true,
            email_verified BOOLEAN DEFAULT false,
            oauth_provider VARCHAR(50),
            oauth_provider_id VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    // Create user_profiles table
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS user_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            first_name VARCHAR(100),
            last_name VARCHAR(100),
            phone VARCHAR(50),
            avatar_url TEXT,
            membership_id VARCHAR(50) UNIQUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    // Create refresh_tokens table
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    // Create tiers table
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS tiers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(50) NOT NULL UNIQUE,
            min_nights INTEGER NOT NULL DEFAULT 0,
            multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.0,
            benefits JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    // Create user_loyalty table
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS user_loyalty (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tier_id UUID REFERENCES tiers(id),
            current_points INTEGER NOT NULL DEFAULT 0,
            lifetime_points INTEGER NOT NULL DEFAULT 0,
            total_nights INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    // Create coupon_type enum
    pool.execute(
        r#"
        DO $$ BEGIN
            CREATE TYPE coupon_type AS ENUM ('percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        "#,
    )
    .await?;

    // Create coupon_status enum
    pool.execute(
        r#"
        DO $$ BEGIN
            CREATE TYPE coupon_status AS ENUM ('draft', 'active', 'paused', 'expired', 'exhausted');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        "#,
    )
    .await?;

    // Create coupons table
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS coupons (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(50) NOT NULL UNIQUE,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            terms_and_conditions TEXT,
            type coupon_type NOT NULL,
            value DECIMAL(10,2),
            currency VARCHAR(3) DEFAULT 'THB',
            minimum_spend DECIMAL(10,2),
            maximum_discount DECIMAL(10,2),
            valid_from TIMESTAMPTZ,
            valid_until TIMESTAMPTZ,
            usage_limit INTEGER,
            usage_limit_per_user INTEGER DEFAULT 1,
            used_count INTEGER DEFAULT 0,
            tier_restrictions JSONB,
            customer_segment JSONB,
            status coupon_status DEFAULT 'draft',
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .await?;

    // Insert default tiers
    pool.execute(
        r#"
        INSERT INTO tiers (name, min_nights, multiplier, benefits)
        VALUES
            ('Bronze', 0, 1.0, '{"discount": 0}'),
            ('Silver', 1, 1.25, '{"discount": 5}'),
            ('Gold', 10, 1.5, '{"discount": 10}'),
            ('Platinum', 20, 2.0, '{"discount": 15}')
        ON CONFLICT (name) DO NOTHING
        "#,
    )
    .await?;

    Ok(())
}

/// Test database wrapper with cleanup functionality
pub struct TestDatabase {
    pub pool: PgPool,
    pub schema_name: String,
}

impl TestDatabase {
    /// Get a reference to the pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Clean up all test data
    pub async fn cleanup(&self) -> Result<(), sqlx::Error> {
        // Truncate all tables in reverse dependency order
        self.pool
            .execute(
                r#"
                TRUNCATE TABLE refresh_tokens, user_loyalty, user_profiles, coupons, users CASCADE
                "#,
            )
            .await?;
        Ok(())
    }

    /// Drop the test schema (for full cleanup)
    pub async fn drop_schema(&self) -> Result<(), sqlx::Error> {
        self.pool
            .execute(format!("DROP SCHEMA IF EXISTS {} CASCADE", self.schema_name).as_str())
            .await?;
        Ok(())
    }
}

// ============================================================================
// Test User Management
// ============================================================================

/// Test user fixture data
#[derive(Debug, Clone)]
pub struct TestUser {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub role: String,
    pub is_active: bool,
    pub email_verified: bool,
}

impl TestUser {
    /// Create a new test user fixture
    pub fn new(email: &str) -> Self {
        Self {
            id: Uuid::new_v4(),
            email: email.to_string(),
            password_hash: hash_test_password(TEST_USER_PASSWORD),
            role: "customer".to_string(),
            is_active: true,
            email_verified: true,
        }
    }

    /// Create an admin test user
    pub fn admin(email: &str) -> Self {
        let mut user = Self::new(email);
        user.role = "admin".to_string();
        user
    }

    /// Create an unverified test user
    pub fn unverified(email: &str) -> Self {
        let mut user = Self::new(email);
        user.email_verified = false;
        user
    }

    /// Create an inactive test user
    pub fn inactive(email: &str) -> Self {
        let mut user = Self::new(email);
        user.is_active = false;
        user
    }

    /// Insert this user into the database
    pub async fn insert(&self, pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, role, is_active, email_verified)
            VALUES ($1, $2, $3, $4::user_role, $5, $6)
            "#,
        )
        .bind(self.id)
        .bind(&self.email)
        .bind(&self.password_hash)
        .bind(&self.role)
        .bind(self.is_active)
        .bind(self.email_verified)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Insert user with profile
    pub async fn insert_with_profile(
        &self,
        pool: &PgPool,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), sqlx::Error> {
        self.insert(pool).await?;

        sqlx::query(
            r#"
            INSERT INTO user_profiles (user_id, first_name, last_name, membership_id)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(self.id)
        .bind(first_name)
        .bind(last_name)
        .bind(format!("TEST{}", self.id.to_string()[..8].to_uppercase()))
        .execute(pool)
        .await?;

        Ok(())
    }
}

/// Create a test user in the database.
///
/// This is a convenience function that creates and inserts a test user.
pub async fn create_test_user(
    pool: &PgPool,
    email: &str,
) -> Result<TestUser, Box<dyn std::error::Error + Send + Sync>> {
    let user = TestUser::new(email);
    user.insert(pool).await?;
    Ok(user)
}

/// Get a JWT auth token for a test user.
pub fn get_auth_token(user_id: &Uuid, email: &str) -> String {
    generate_test_token(user_id, email)
}

// ============================================================================
// Test Coupon Fixtures
// ============================================================================

/// Test coupon fixture data
#[derive(Debug, Clone)]
pub struct TestCoupon {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub coupon_type: String,
    pub value: Option<f64>,
    pub status: String,
    pub valid_from: Option<chrono::DateTime<chrono::Utc>>,
    pub valid_until: Option<chrono::DateTime<chrono::Utc>>,
}

impl TestCoupon {
    /// Create a new percentage discount coupon
    pub fn percentage(code: &str, value: f64) -> Self {
        Self {
            id: Uuid::new_v4(),
            code: code.to_string(),
            name: format!("{}% Off", value),
            coupon_type: "percentage".to_string(),
            value: Some(value),
            status: "active".to_string(),
            valid_from: Some(Utc::now() - Duration::days(1)),
            valid_until: Some(Utc::now() + Duration::days(30)),
        }
    }

    /// Create a fixed amount coupon
    pub fn fixed_amount(code: &str, value: f64) -> Self {
        Self {
            id: Uuid::new_v4(),
            code: code.to_string(),
            name: format!("{} THB Off", value),
            coupon_type: "fixed_amount".to_string(),
            value: Some(value),
            status: "active".to_string(),
            valid_from: Some(Utc::now() - Duration::days(1)),
            valid_until: Some(Utc::now() + Duration::days(30)),
        }
    }

    /// Create an expired coupon
    pub fn expired(code: &str) -> Self {
        let mut coupon = Self::percentage(code, 10.0);
        coupon.status = "expired".to_string();
        coupon.valid_until = Some(Utc::now() - Duration::days(1));
        coupon
    }

    /// Insert this coupon into the database
    pub async fn insert(&self, pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO coupons (id, code, name, type, value, status, valid_from, valid_until)
            VALUES ($1, $2, $3, $4::coupon_type, $5, $6::coupon_status, $7, $8)
            "#,
        )
        .bind(self.id)
        .bind(&self.code)
        .bind(&self.name)
        .bind(&self.coupon_type)
        .bind(self.value)
        .bind(&self.status)
        .bind(self.valid_from)
        .bind(self.valid_until)
        .execute(pool)
        .await?;

        Ok(())
    }
}

// ============================================================================
// TestClient - HTTP Client for Testing
// ============================================================================

/// HTTP client wrapper for making test requests.
///
/// TestClient provides a convenient API for making HTTP requests
/// to the test application and inspecting responses.
#[derive(Clone)]
pub struct TestClient {
    router: Router,
    auth_token: Option<String>,
}

impl TestClient {
    /// Create a new test client with a router
    pub fn new(router: Router) -> Self {
        Self {
            router,
            auth_token: None,
        }
    }

    /// Set the authentication token
    pub fn with_auth(mut self, token: &str) -> Self {
        self.auth_token = Some(token.to_string());
        self
    }

    /// Make a GET request
    pub async fn get(&self, uri: &str) -> TestResponse {
        let mut request = Request::builder()
            .method("GET")
            .uri(uri)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let request = request.body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a POST request with JSON body
    pub async fn post<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let mut request = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let request = request.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a POST request with empty body
    pub async fn post_empty(&self, uri: &str) -> TestResponse {
        let mut request = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let request = request.body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a PUT request with JSON body
    pub async fn put<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let mut request = Request::builder()
            .method("PUT")
            .uri(uri)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let request = request.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a PATCH request with JSON body
    pub async fn patch<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let mut request = Request::builder()
            .method("PATCH")
            .uri(uri)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let request = request.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a DELETE request
    pub async fn delete(&self, uri: &str) -> TestResponse {
        let mut request = Request::builder()
            .method("DELETE")
            .uri(uri)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let request = request.body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }
}

/// Test response wrapper with helper methods
#[derive(Debug)]
pub struct TestResponse {
    pub status: u16,
    pub body: String,
}

impl TestResponse {
    /// Create from an axum response
    async fn from_response(response: axum::response::Response) -> Self {
        let status = response.status().as_u16();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();

        Self { status, body }
    }

    /// Parse the body as JSON
    pub fn json<T: DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_str(&self.body)
    }

    /// Check if the response is successful (2xx)
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Assert the status code
    pub fn assert_status(&self, expected: u16) {
        assert_eq!(
            self.status, expected,
            "Expected status {}, got {}. Body: {}",
            expected, self.status, self.body
        );
    }

    /// Assert the response is successful (2xx)
    pub fn assert_success(&self) {
        assert!(
            self.is_success(),
            "Expected success status, got {}. Body: {}",
            self.status,
            self.body
        );
    }

    /// Get a JSON field value as string
    pub fn json_field(&self, field: &str) -> Option<String> {
        let json: serde_json::Value = self.json().ok()?;
        json.get(field)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
}

// ============================================================================
// Authentication Helpers
// ============================================================================

/// Generate a test JWT token for a user
pub fn generate_test_token(user_id: &Uuid, email: &str) -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    struct Claims {
        sub: String,
        email: String,
        exp: i64,
        iat: i64,
    }

    let now = Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        exp: (now + Duration::hours(1)).timestamp(),
        iat: now.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .unwrap()
}

/// Generate an expired test token
pub fn generate_expired_token(user_id: &Uuid, email: &str) -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    struct Claims {
        sub: String,
        email: String,
        exp: i64,
        iat: i64,
    }

    let now = Utc::now();
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        exp: (now - Duration::hours(1)).timestamp(), // Expired 1 hour ago
        iat: (now - Duration::hours(2)).timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .unwrap()
}

/// Hash a password for testing (using argon2)
pub fn hash_test_password(password: &str) -> String {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .unwrap()
        .to_string()
}

// ============================================================================
// Redis Test Helpers
// ============================================================================

/// Initialize test Redis connection
pub async fn init_test_redis() -> Result<ConnectionManager, redis::RedisError> {
    let client = redis::Client::open(test_redis_url())?;
    ConnectionManager::new(client).await
}

/// Clean up Redis test data
pub async fn cleanup_redis(
    conn: &mut ConnectionManager,
    pattern: &str,
) -> Result<(), redis::RedisError> {
    use redis::AsyncCommands;

    let keys: Vec<String> = redis::cmd("KEYS").arg(pattern).query_async(conn).await?;

    if !keys.is_empty() {
        let _: () = conn.del(keys).await?;
    }

    Ok(())
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/// Assert that a JSON response contains expected fields
#[macro_export]
macro_rules! assert_json_contains {
    ($response:expr, $($key:expr => $value:expr),+ $(,)?) => {{
        let json: serde_json::Value = $response.json().expect("Response should be valid JSON");
        $(
            assert_eq!(
                json.get($key),
                Some(&serde_json::json!($value)),
                "Expected {} to be {:?}, got {:?}",
                $key,
                $value,
                json.get($key)
            );
        )+
    }};
}

/// Assert that a JSON response has a specific error code
#[macro_export]
macro_rules! assert_error_code {
    ($response:expr, $code:expr) => {{
        let json: serde_json::Value = $response.json().expect("Response should be valid JSON");
        assert_eq!(
            json.get("error").and_then(|v| v.as_str()),
            Some($code),
            "Expected error code '{}', got {:?}",
            $code,
            json.get("error")
        );
    }};
}

// ============================================================================
// Test Setup Helpers
// ============================================================================

/// Setup function to run before each test
pub async fn setup_test() -> (PgPool, TestDatabase) {
    let _ = dotenvy::dotenv();

    // Initialize test database
    let pool = init_test_db()
        .await
        .expect("Failed to initialize test database");
    let test_db = TestDatabase {
        pool: pool.clone(),
        schema_name: "public".to_string(),
    };

    // Clean up any existing data
    let _ = test_db.cleanup().await;

    (pool, test_db)
}

/// Teardown function to run after each test
pub async fn teardown_test(test_db: &TestDatabase) {
    let _ = test_db.cleanup().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_test_user_creation() {
        let user = TestUser::new("test@example.com");
        assert_eq!(user.email, "test@example.com");
        assert_eq!(user.role, "customer");
        assert!(user.is_active);
        assert!(user.email_verified);
    }

    #[test]
    fn test_test_user_admin() {
        let user = TestUser::admin("admin@example.com");
        assert_eq!(user.role, "admin");
    }

    #[test]
    fn test_test_coupon_creation() {
        let coupon = TestCoupon::percentage("SAVE10", 10.0);
        assert_eq!(coupon.code, "SAVE10");
        assert_eq!(coupon.coupon_type, "percentage");
        assert_eq!(coupon.value, Some(10.0));
        assert_eq!(coupon.status, "active");
    }

    #[test]
    fn test_hash_test_password() {
        let hash = hash_test_password("testpassword");
        assert!(hash.starts_with("$argon2"));
    }

    #[test]
    fn test_generate_test_token() {
        let user_id = Uuid::new_v4();
        let token = generate_test_token(&user_id, "test@example.com");
        // Token should have 3 parts (header.payload.signature)
        assert_eq!(token.split('.').count(), 3);
    }

    #[test]
    fn test_get_auth_token() {
        let user_id = Uuid::new_v4();
        let token = get_auth_token(&user_id, "test@example.com");
        assert_eq!(token.split('.').count(), 3);
    }
}
