//! Common test utilities and fixtures
//!
//! This module provides shared test infrastructure including:
//! - TestApp struct for spinning up the app for testing
//! - Per-test database isolation via CREATE DATABASE TEMPLATE
//! - Test fixtures for users, coupons, and other entities
//! - Helper functions for making authenticated requests
//! - Cleanup utilities

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

/// Base database URL (connects to "postgres" DB for admin operations)
fn admin_database_url() -> String {
    let url = test_database_url();
    // Replace the database name with "postgres" for admin operations
    if let Some(pos) = url.rfind('/') {
        format!("{}postgres", &url[..pos + 1])
    } else {
        url
    }
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
// Template Database Infrastructure
// ============================================================================

/// Admin pool connects to "postgres" DB for CREATE/DROP DATABASE operations
static ADMIN_POOL: Lazy<Arc<Mutex<Option<PgPool>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Whether the template database has been created
static TEMPLATE_READY: Lazy<Arc<Mutex<bool>>> = Lazy::new(|| Arc::new(Mutex::new(false)));

/// Template database name
const TEMPLATE_DB_NAME: &str = "loyalty_test_template";

/// Get or create the admin pool (connects to "postgres" database)
async fn get_admin_pool() -> Result<PgPool, sqlx::Error> {
    let mut guard = ADMIN_POOL.lock().await;
    if let Some(pool) = guard.as_ref() {
        return Ok(pool.clone());
    }

    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .idle_timeout(std::time::Duration::from_secs(5))
        .max_lifetime(std::time::Duration::from_secs(30))
        .connect(&admin_database_url())
        .await?;

    *guard = Some(pool.clone());
    Ok(pool)
}

/// Ensure the template database exists with migrations and seed data.
/// This is called once per test run (idempotent via TEMPLATE_READY flag).
async fn ensure_template_db() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut ready = TEMPLATE_READY.lock().await;
    if *ready {
        return Ok(());
    }

    let admin_pool = get_admin_pool().await?;

    // Terminate any connections to the template database
    let _ = sqlx::query(&format!(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
        TEMPLATE_DB_NAME
    ))
    .execute(&admin_pool)
    .await;

    // Drop and recreate the template database
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", TEMPLATE_DB_NAME))
        .execute(&admin_pool)
        .await;

    sqlx::query(&format!("CREATE DATABASE \"{}\"", TEMPLATE_DB_NAME))
        .execute(&admin_pool)
        .await?;

    // Connect to the template database to run migrations and seeds
    let template_url = {
        let url = test_database_url();
        if let Some(pos) = url.rfind('/') {
            format!("{}{}", &url[..pos + 1], TEMPLATE_DB_NAME)
        } else {
            url
        }
    };

    let template_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&template_url)
        .await?;

    // Run migrations
    let migration_sql = include_str!("../../migrations/20240101000000_init.sql");
    template_pool.execute(migration_sql).await?;

    // Seed tiers
    template_pool
        .execute(
            r#"
            INSERT INTO tiers (name, min_points, min_nights, benefits, color, sort_order, is_active)
            VALUES
                ('Bronze', 0, 0, '{"discount": 0}', '#CD7F32', 1, true),
                ('Silver', 0, 1, '{"discount": 5}', '#C0C0C0', 2, true),
                ('Gold', 0, 10, '{"discount": 10}', '#FFD700', 3, true),
                ('Platinum', 0, 20, '{"discount": 15}', '#E5E4E2', 4, true)
            ON CONFLICT (name) DO NOTHING
            "#,
        )
        .await?;

    // Seed membership_id_sequence
    template_pool
        .execute(
            r#"
            INSERT INTO membership_id_sequence (id, current_user_count)
            VALUES (1, 0)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .await?;

    // Close the template pool — required before using it as a TEMPLATE
    template_pool.close().await;

    // Clean up orphaned test databases from previous runs
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT datname FROM pg_database WHERE datname LIKE 'test_%' AND datistemplate = false",
    )
    .fetch_all(&admin_pool)
    .await
    .unwrap_or_default();

    for (db_name,) in rows {
        let _ = sqlx::query(&format!(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
            db_name
        ))
        .execute(&admin_pool)
        .await;
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", db_name))
            .execute(&admin_pool)
            .await;
    }

    *ready = true;
    Ok(())
}

// ============================================================================
// TestApp - Main test application wrapper
// ============================================================================

/// TestApp wraps the application for integration testing.
///
/// Each TestApp instance gets its own isolated database created from a
/// pre-migrated template. This allows tests to run in parallel without
/// data conflicts.
///
/// # Example
///
/// ```ignore
/// let app = TestApp::new().await.expect("Failed to create test app");
/// let response = app.client().get("/api/health").await;
/// response.assert_status(200);
/// app.cleanup().await.ok();
/// ```
pub struct TestApp {
    /// The configured Axum router
    router: Router,
    /// Database connection pool (to the per-test database)
    pool: PgPool,
    /// Redis connection manager
    redis: ConnectionManager,
    /// Per-test database name (for cleanup)
    db_name: String,
}

impl TestApp {
    /// Create a new TestApp instance with an isolated per-test database.
    ///
    /// This:
    /// 1. Ensures the template database exists (one-time)
    /// 2. Creates a unique per-test database from the template
    /// 3. Connects to it and builds the full application router
    pub async fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let _ = dotenvy::dotenv();

        // Ensure template DB is ready
        ensure_template_db().await?;

        // Create a unique per-test database
        let db_name = format!("test_{}", Uuid::new_v4().simple());
        let admin_pool = get_admin_pool().await?;

        sqlx::query(&format!(
            "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
            db_name, TEMPLATE_DB_NAME
        ))
        .execute(&admin_pool)
        .await?;

        // Connect to the new per-test database
        let test_url = {
            let url = test_database_url();
            if let Some(pos) = url.rfind('/') {
                format!("{}{}", &url[..pos + 1], db_name)
            } else {
                url
            }
        };

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(30))
            .idle_timeout(std::time::Duration::from_secs(5))
            .max_lifetime(std::time::Duration::from_secs(30))
            .connect(&test_url)
            .await?;

        // Initialize test Redis
        let redis = init_test_redis().await?;

        // Create application state and router
        let config = create_test_config();
        let state = loyalty_backend::AppState::new(pool.clone(), redis.clone(), config);
        let router = loyalty_backend::routes::create_router(state);

        Ok(Self {
            router,
            pool,
            redis,
            db_name,
        })
    }

    /// Get a reference to the database pool.
    pub fn db(&self) -> &PgPool {
        &self.pool
    }

    /// Get a clone of the Redis connection manager.
    #[allow(dead_code)]
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

    /// Get an authenticated TestClient with a specific role.
    pub fn authenticated_client_with_role(
        &self,
        user_id: &Uuid,
        email: &str,
        role: &str,
    ) -> TestClient {
        let token = generate_test_token_with_role(user_id, email, role);
        TestClient::new(self.router.clone()).with_auth(&token)
    }

    /// Create a test user and return an authenticated client.
    #[allow(dead_code)]
    pub async fn create_authenticated_user(
        &self,
        email: &str,
    ) -> Result<(TestUser, TestClient), Box<dyn std::error::Error + Send + Sync>> {
        let user = create_test_user(&self.pool, email).await?;
        let token = get_auth_token(&user.id, &user.email);
        let client = TestClient::new(self.router.clone()).with_auth(&token);
        Ok((user, client))
    }

    /// Clean up: close pool and drop the per-test database.
    pub async fn cleanup(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Close pool first (required before DROP DATABASE)
        self.pool.close().await;

        // Drop the per-test database
        let admin_pool = get_admin_pool().await?;

        // Terminate any remaining connections
        let _ = sqlx::query(&format!(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
            self.db_name
        ))
        .execute(&admin_pool)
        .await;

        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", self.db_name))
            .execute(&admin_pool)
            .await;

        Ok(())
    }

    /// Get the router for direct testing.
    #[allow(dead_code)]
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
            min_connections: 0,
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
// Legacy Setup Functions (backward-compatible, now with per-test DB isolation)
// ============================================================================

/// Setup function to run before each test.
/// Now creates an isolated per-test database.
pub async fn setup_test() -> (PgPool, TestDatabase) {
    let _ = dotenvy::dotenv();

    // Ensure template is ready
    ensure_template_db()
        .await
        .expect("Failed to ensure template database");

    // Create a unique per-test database
    let db_name = format!("test_{}", Uuid::new_v4().simple());
    let admin_pool = get_admin_pool().await.expect("Failed to get admin pool");

    sqlx::query(&format!(
        "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
        db_name, TEMPLATE_DB_NAME
    ))
    .execute(&admin_pool)
    .await
    .expect("Failed to create per-test database");

    // Connect to the new per-test database
    let test_url = {
        let url = test_database_url();
        if let Some(pos) = url.rfind('/') {
            format!("{}{}", &url[..pos + 1], db_name)
        } else {
            url
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .idle_timeout(std::time::Duration::from_secs(5))
        .max_lifetime(std::time::Duration::from_secs(30))
        .connect(&test_url)
        .await
        .expect("Failed to connect to per-test database");

    let test_db = TestDatabase {
        pool: pool.clone(),
        db_name,
    };

    (pool, test_db)
}

/// Teardown function to run after each test.
/// Drops the per-test database.
pub async fn teardown_test(test_db: &TestDatabase) {
    let _ = test_db.drop_database().await;
}

/// Initialize the test database pool (legacy compatibility).
/// Now creates a per-test database.
pub async fn init_test_db() -> Result<PgPool, sqlx::Error> {
    let _ = dotenvy::dotenv();

    ensure_template_db()
        .await
        .map_err(|e| sqlx::Error::Configuration(e.to_string().into()))?;

    let db_name = format!("test_{}", Uuid::new_v4().simple());
    let admin_pool = get_admin_pool().await?;

    sqlx::query(&format!(
        "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
        db_name, TEMPLATE_DB_NAME
    ))
    .execute(&admin_pool)
    .await?;

    let test_url = {
        let url = test_database_url();
        if let Some(pos) = url.rfind('/') {
            format!("{}{}", &url[..pos + 1], db_name)
        } else {
            url
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .idle_timeout(std::time::Duration::from_secs(5))
        .max_lifetime(std::time::Duration::from_secs(30))
        .connect(&test_url)
        .await?;

    // Store the db_name so it can be cleaned up
    // We leak it via a global registry for legacy callers
    register_test_db(db_name);

    Ok(pool)
}

/// Set up the test database (legacy alias).
pub async fn setup_test_db() -> Result<PgPool, sqlx::Error> {
    init_test_db().await
}

/// Registry for test databases created via init_test_db() so they get cleaned up
static TEST_DB_REGISTRY: Lazy<Arc<Mutex<Vec<String>>>> =
    Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

fn register_test_db(name: String) {
    // Use try_lock to avoid blocking; it's okay if we miss one
    if let Ok(mut registry) = TEST_DB_REGISTRY.try_lock() {
        registry.push(name);
    }
}

// ============================================================================
// Test Database Wrapper
// ============================================================================

/// Test database wrapper with per-test isolation
pub struct TestDatabase {
    pub pool: PgPool,
    /// Per-test database name for cleanup
    pub db_name: String,
}

impl TestDatabase {
    /// Get a reference to the pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Clean up: close pool and drop the per-test database
    pub async fn cleanup(&self) -> Result<(), sqlx::Error> {
        self.drop_database().await
    }

    /// Drop the per-test database
    pub async fn drop_database(&self) -> Result<(), sqlx::Error> {
        self.pool.close().await;

        if let Ok(admin_pool) = get_admin_pool().await {
            let _ = sqlx::query(&format!(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
                self.db_name
            ))
            .execute(&admin_pool)
            .await;

            let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", self.db_name))
                .execute(&admin_pool)
                .await;
        }
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
    #[allow(dead_code)]
    pub fn unverified(email: &str) -> Self {
        let mut user = Self::new(email);
        user.email_verified = false;
        user
    }

    /// Create an inactive test user
    #[allow(dead_code)]
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

        // Generate a unique membership_id (8-char uppercase hex from UUID)
        let membership_id = self.id.to_string()[..8].to_uppercase();

        sqlx::query(
            r#"
            INSERT INTO user_profiles (user_id, first_name, last_name, membership_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO NOTHING
            "#,
        )
        .bind(self.id)
        .bind(first_name)
        .bind(last_name)
        .bind(membership_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}

/// Create a test user in the database.
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
    #[allow(dead_code)]
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
    #[allow(dead_code)]
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
    #[allow(dead_code)]
    pub fn assert_success(&self) {
        assert!(
            self.is_success(),
            "Expected success status, got {}. Body: {}",
            self.status,
            self.body
        );
    }

    /// Get a JSON field value as string
    #[allow(dead_code)]
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
    generate_test_token_with_role(user_id, email, "customer")
}

/// Generate a test JWT token for a user with a specific role
pub fn generate_test_token_with_role(user_id: &Uuid, email: &str, role: &str) -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    struct Claims {
        id: String,
        email: Option<String>,
        role: String,
        exp: i64,
        iat: Option<i64>,
    }

    let now = Utc::now();
    let claims = Claims {
        id: user_id.to_string(),
        email: Some(email.to_string()),
        role: role.to_string(),
        exp: (now + Duration::hours(1)).timestamp(),
        iat: Some(now.timestamp()),
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
        id: String,
        email: Option<String>,
        role: String,
        exp: i64,
        iat: Option<i64>,
    }

    let now = Utc::now();
    let claims = Claims {
        id: user_id.to_string(),
        email: Some(email.to_string()),
        role: "customer".to_string(),
        exp: (now - Duration::hours(1)).timestamp(), // Expired 1 hour ago
        iat: Some((now - Duration::hours(2)).timestamp()),
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
#[allow(dead_code)]
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
// Legacy cleanup (no longer needed with per-test DB isolation, but kept for compat)
// ============================================================================

/// Clean up the test database (legacy - no-op with per-test isolation).
#[allow(dead_code)]
pub async fn cleanup_test_db(_pool: &PgPool) -> Result<(), sqlx::Error> {
    // No-op: each test has its own database that gets dropped on cleanup
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
