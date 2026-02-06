//! Loyalty endpoint integration tests
//!
//! Tests for the /api/loyalty endpoints including:
//! - Get loyalty status
//! - Get transactions (paginated)
//! - Get tier definitions
//! - Award points (admin only)
//! - Tier recalculation

use axum::Router;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{
    generate_test_token, generate_test_token_with_role, init_test_db, setup_test, teardown_test,
    TestClient, TestUser,
};

// ============================================================================
// Test Setup
// ============================================================================

/// Create a router for loyalty testing with database state
async fn create_loyalty_router() -> Result<Router, Box<dyn std::error::Error>> {
    use loyalty_backend::routes::loyalty::routes_with_app_state;
    use loyalty_backend::state::AppState;
    use loyalty_backend::Settings;

    let pool = init_test_db().await?;
    let redis = crate::common::init_test_redis().await?;
    let config = Settings::default();
    let state = AppState::new(pool, redis, config);

    Ok(Router::new().nest("/api/loyalty", routes_with_app_state(state)))
}

/// Insert a user with loyalty record into the test database
async fn insert_user_with_loyalty(
    pool: &sqlx::PgPool,
    user: &TestUser,
    initial_points: i32,
    initial_nights: i32,
) -> Result<Uuid, sqlx::Error> {
    // Insert user
    user.insert(pool).await?;

    // Get Bronze tier ID (default tier for 0 nights)
    let tier_id: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM tiers WHERE min_nights <= $1 ORDER BY min_nights DESC LIMIT 1",
    )
    .bind(initial_nights)
    .fetch_optional(pool)
    .await?;

    let tier_id = tier_id.map(|t| t.0);

    // Create user_loyalty record
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user.id)
    .bind(tier_id)
    .bind(initial_points)
    .bind(initial_nights)
    .execute(pool)
    .await?;

    Ok(user.id)
}

/// Create points_transactions table if it doesn't exist
async fn ensure_points_transactions_table(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    // Create points_transaction_type enum if it doesn't exist
    sqlx::query(
        r#"
        DO $$ BEGIN
            CREATE TYPE points_transaction_type AS ENUM (
                'earned_stay', 'earned_referral', 'earned_promotion',
                'redeemed', 'expired', 'admin_award', 'admin_deduct', 'adjustment'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        "#,
    )
    .execute(pool)
    .await?;

    // Create points_transactions table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS points_transactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            points INTEGER NOT NULL,
            type points_transaction_type NOT NULL,
            description TEXT,
            reference_id VARCHAR(255),
            admin_user_id UUID REFERENCES users(id),
            admin_reason TEXT,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            nights_stayed INTEGER DEFAULT 0
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Add additional columns to user_loyalty table if needed
async fn ensure_user_loyalty_columns(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    // Add tier_updated_at and points_updated_at columns if they don't exist
    sqlx::query(
        r#"
        DO $$ BEGIN
            ALTER TABLE user_loyalty ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ;
            ALTER TABLE user_loyalty ADD COLUMN IF NOT EXISTS points_updated_at TIMESTAMPTZ;
        END $$;
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Add additional columns to tiers table if needed
async fn ensure_tiers_columns(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DO $$ BEGIN
            ALTER TABLE tiers ADD COLUMN IF NOT EXISTS min_points INTEGER DEFAULT 0;
            ALTER TABLE tiers ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#CD7F32';
            ALTER TABLE tiers ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
            ALTER TABLE tiers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
            ALTER TABLE tiers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        END $$;
        "#,
    )
    .execute(pool)
    .await?;

    // Update sort_order for existing tiers
    sqlx::query(
        r#"
        UPDATE tiers SET sort_order = CASE name
            WHEN 'Bronze' THEN 0
            WHEN 'Silver' THEN 1
            WHEN 'Gold' THEN 2
            WHEN 'Platinum' THEN 3
            ELSE 0
        END,
        color = CASE name
            WHEN 'Bronze' THEN '#CD7F32'
            WHEN 'Silver' THEN '#C0C0C0'
            WHEN 'Gold' THEN '#FFD700'
            WHEN 'Platinum' THEN '#E5E4E2'
            ELSE '#CD7F32'
        END
        WHERE sort_order = 0 OR sort_order IS NULL
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Insert sample transactions for a user
async fn insert_sample_transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    count: i32,
) -> Result<(), sqlx::Error> {
    for i in 0..count {
        sqlx::query(
            r#"
            INSERT INTO points_transactions (user_id, points, type, description, nights_stayed)
            VALUES ($1, $2, 'earned_stay'::points_transaction_type, $3, $4)
            "#,
        )
        .bind(user_id)
        .bind(100 * (i + 1))
        .bind(format!("Test transaction {}", i + 1))
        .bind(i + 1)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// ============================================================================
// Test: GET /api/loyalty/status
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_get_loyalty_status() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure required columns exist
    ensure_user_loyalty_columns(&pool)
        .await
        .expect("Failed to add user_loyalty columns");
    ensure_tiers_columns(&pool)
        .await
        .expect("Failed to add tiers columns");

    let user = TestUser::new("loyalty_status@example.com");
    let user_id = insert_user_with_loyalty(&pool, &user, 500, 5)
        .await
        .expect("Failed to insert user with loyalty");

    let token = generate_test_token(&user_id, &user.email);

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/api/loyalty/status").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(json
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false));

    let data = json.get("data").expect("Response should have 'data' field");

    assert_eq!(
        data.get("user_id").and_then(|v| v.as_str()),
        Some(user_id.to_string().as_str()),
        "user_id should match"
    );
    assert_eq!(
        data.get("current_points").and_then(|v| v.as_i64()),
        Some(500),
        "current_points should be 500"
    );
    assert_eq!(
        data.get("total_nights").and_then(|v| v.as_i64()),
        Some(5),
        "total_nights should be 5"
    );

    // Check tier info is present
    assert!(
        data.get("tier").is_some(),
        "Response should have 'tier' field"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_get_loyalty_status_unauthenticated() {
    // Arrange
    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router); // No auth token

    // Act
    let response = client.get("/api/loyalty/status").await;

    // Assert - should return 401 Unauthorized
    response.assert_status(401);
}

// ============================================================================
// Test: GET /api/loyalty/transactions
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_get_transactions() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_points_transactions_table(&pool)
        .await
        .expect("Failed to create points_transactions table");

    let user = TestUser::new("transactions@example.com");
    let user_id = insert_user_with_loyalty(&pool, &user, 1000, 10)
        .await
        .expect("Failed to insert user with loyalty");

    // Insert sample transactions
    insert_sample_transactions(&pool, user_id, 5)
        .await
        .expect("Failed to insert sample transactions");

    let token = generate_test_token(&user_id, &user.email);

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/api/loyalty/transactions").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(json
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false));

    let data = json.get("data").expect("Response should have 'data' field");

    // Check pagination fields
    assert!(
        data.get("transactions")
            .and_then(|v| v.as_array())
            .is_some(),
        "Response should have 'transactions' array"
    );
    assert!(
        data.get("total").and_then(|v| v.as_i64()).is_some(),
        "Response should have 'total' field"
    );
    assert!(
        data.get("page").and_then(|v| v.as_i64()).is_some(),
        "Response should have 'page' field"
    );
    assert!(
        data.get("limit").and_then(|v| v.as_i64()).is_some(),
        "Response should have 'limit' field"
    );
    assert!(
        data.get("total_pages").and_then(|v| v.as_i64()).is_some(),
        "Response should have 'total_pages' field"
    );

    let transactions = data.get("transactions").unwrap().as_array().unwrap();
    assert_eq!(transactions.len(), 5, "Should have 5 transactions");

    // Cleanup
    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_get_transactions_pagination() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_points_transactions_table(&pool)
        .await
        .expect("Failed to create points_transactions table");

    let user = TestUser::new("transactions_paginated@example.com");
    let user_id = insert_user_with_loyalty(&pool, &user, 1000, 10)
        .await
        .expect("Failed to insert user with loyalty");

    // Insert 25 sample transactions
    insert_sample_transactions(&pool, user_id, 25)
        .await
        .expect("Failed to insert sample transactions");

    let token = generate_test_token(&user_id, &user.email);

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Act - request page 2 with limit 10
    let response = client
        .get("/api/loyalty/transactions?page=2&limit=10")
        .await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have 'data' field");

    assert_eq!(
        data.get("page").and_then(|v| v.as_i64()),
        Some(2),
        "Page should be 2"
    );
    assert_eq!(
        data.get("limit").and_then(|v| v.as_i64()),
        Some(10),
        "Limit should be 10"
    );
    assert_eq!(
        data.get("total").and_then(|v| v.as_i64()),
        Some(25),
        "Total should be 25"
    );
    assert_eq!(
        data.get("total_pages").and_then(|v| v.as_i64()),
        Some(3),
        "Total pages should be 3"
    );

    let transactions = data.get("transactions").unwrap().as_array().unwrap();
    assert_eq!(
        transactions.len(),
        10,
        "Should have 10 transactions on page 2"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: GET /api/loyalty/tiers
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_get_tiers() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_tiers_columns(&pool)
        .await
        .expect("Failed to add tiers columns");

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router); // No auth required for tiers endpoint

    // Act
    let response = client.get("/api/loyalty/tiers").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(json
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false));

    let data = json.get("data").expect("Response should have 'data' field");

    assert!(data.is_array(), "Data should be an array of tiers");

    let tiers = data.as_array().unwrap();
    assert!(
        tiers.len() >= 4,
        "Should have at least 4 default tiers (Bronze, Silver, Gold, Platinum)"
    );

    // Check first tier (Bronze) structure
    let first_tier = &tiers[0];
    assert!(first_tier.get("id").is_some(), "Tier should have 'id'");
    assert!(first_tier.get("name").is_some(), "Tier should have 'name'");
    assert!(
        first_tier.get("min_nights").is_some(),
        "Tier should have 'min_nights'"
    );
    assert!(
        first_tier.get("benefits").is_some(),
        "Tier should have 'benefits'"
    );
    assert!(
        first_tier.get("color").is_some(),
        "Tier should have 'color'"
    );

    // Verify tiers are sorted by sort_order
    let tier_names: Vec<&str> = tiers
        .iter()
        .filter_map(|t| t.get("name").and_then(|v| v.as_str()))
        .collect();

    assert!(tier_names.contains(&"Bronze"), "Should contain Bronze tier");
    assert!(
        tier_names.contains(&"Platinum"),
        "Should contain Platinum tier"
    );

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: POST /api/loyalty/award (Admin Only)
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_award_points_admin() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_points_transactions_table(&pool)
        .await
        .expect("Failed to create points_transactions table");
    ensure_user_loyalty_columns(&pool)
        .await
        .expect("Failed to add user_loyalty columns");
    ensure_tiers_columns(&pool)
        .await
        .expect("Failed to add tiers columns");

    // Create admin user
    let admin_user = TestUser::admin("admin_award@example.com");
    admin_user
        .insert(&pool)
        .await
        .expect("Failed to insert admin user");
    let admin_token = generate_test_token_with_role(&admin_user.id, &admin_user.email, "admin");

    // Create target user
    let target_user = TestUser::new("target_user@example.com");
    let target_user_id = insert_user_with_loyalty(&pool, &target_user, 100, 2)
        .await
        .expect("Failed to insert target user");

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&admin_token);

    // Act - Award 500 points and 3 nights
    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 500,
        "nights": 3,
        "source": "admin_award",
        "description": "Test points award"
    });

    let response = client.post("/api/loyalty/award", &payload).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(json
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false));

    let data = json.get("data").expect("Response should have 'data' field");

    assert!(
        data.get("transaction_id").is_some(),
        "Response should have 'transaction_id'"
    );
    assert_eq!(
        data.get("points_awarded").and_then(|v| v.as_i64()),
        Some(500),
        "points_awarded should be 500"
    );
    assert_eq!(
        data.get("nights_added").and_then(|v| v.as_i64()),
        Some(3),
        "nights_added should be 3"
    );
    assert_eq!(
        data.get("new_total_points").and_then(|v| v.as_i64()),
        Some(600), // 100 + 500
        "new_total_points should be 600"
    );
    assert_eq!(
        data.get("new_total_nights").and_then(|v| v.as_i64()),
        Some(5), // 2 + 3
        "new_total_nights should be 5"
    );

    // Verify points were actually increased in the database
    let loyalty: (i32, i32) =
        sqlx::query_as("SELECT current_points, total_nights FROM user_loyalty WHERE user_id = $1")
            .bind(target_user_id)
            .fetch_one(&pool)
            .await
            .expect("Failed to fetch updated loyalty");

    assert_eq!(loyalty.0, 600, "Database should show 600 points");
    assert_eq!(loyalty.1, 5, "Database should show 5 nights");

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: POST /api/loyalty/award - Non-Admin Fails
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_award_points_non_admin_fails() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_points_transactions_table(&pool)
        .await
        .expect("Failed to create points_transactions table");
    ensure_user_loyalty_columns(&pool)
        .await
        .expect("Failed to add user_loyalty columns");

    // Create regular user (not admin)
    let regular_user = TestUser::new("regular_user@example.com");
    let regular_user_id = insert_user_with_loyalty(&pool, &regular_user, 100, 2)
        .await
        .expect("Failed to insert regular user");
    let regular_token = generate_test_token(&regular_user_id, &regular_user.email);

    // Create target user
    let target_user = TestUser::new("target_user2@example.com");
    let target_user_id = insert_user_with_loyalty(&pool, &target_user, 100, 2)
        .await
        .expect("Failed to insert target user");

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&regular_token);

    // Act - Try to award points as non-admin
    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 500,
        "nights": 3
    });

    let response = client.post("/api/loyalty/award", &payload).await;

    // Assert - Should return 403 Forbidden
    response.assert_status(403);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(
        json.get("error").is_some() || json.get("message").is_some(),
        "Response should have error information"
    );

    // Verify points were NOT changed
    let loyalty: (i32,) =
        sqlx::query_as("SELECT current_points FROM user_loyalty WHERE user_id = $1")
            .bind(target_user_id)
            .fetch_one(&pool)
            .await
            .expect("Failed to fetch loyalty");

    assert_eq!(loyalty.0, 100, "Points should remain unchanged at 100");

    // Cleanup
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Tier Recalculation
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_tier_recalculation() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_points_transactions_table(&pool)
        .await
        .expect("Failed to create points_transactions table");
    ensure_user_loyalty_columns(&pool)
        .await
        .expect("Failed to add user_loyalty columns");
    ensure_tiers_columns(&pool)
        .await
        .expect("Failed to add tiers columns");

    // Create admin user
    let admin_user = TestUser::admin("admin_tier@example.com");
    admin_user
        .insert(&pool)
        .await
        .expect("Failed to insert admin user");
    let admin_token = generate_test_token_with_role(&admin_user.id, &admin_user.email, "admin");

    // Create target user with 8 nights (Silver tier: 1+ nights)
    let target_user = TestUser::new("tier_upgrade@example.com");
    let target_user_id = insert_user_with_loyalty(&pool, &target_user, 500, 8)
        .await
        .expect("Failed to insert target user");

    // Get initial tier (should be Silver)
    let initial_tier: (Option<String>,) = sqlx::query_as(
        r#"
        SELECT t.name
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(target_user_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch initial tier");

    assert!(
        initial_tier.0.as_deref() == Some("Silver") || initial_tier.0.as_deref() == Some("Bronze"),
        "Initial tier should be Silver or Bronze, got {:?}",
        initial_tier.0
    );

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&admin_token);

    // Act - Award enough nights to upgrade to Gold (10+ nights)
    // Need to add at least 2 more nights (8 + 2 = 10)
    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 200,
        "nights": 12,  // Add 12 nights to reach Platinum (20+)
        "description": "Test tier upgrade"
    });

    let response = client.post("/api/loyalty/award", &payload).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have 'data' field");

    // Check if tier changed
    let tier_changed = data
        .get("tier_changed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let new_tier_name = data.get("new_tier_name").and_then(|v| v.as_str());

    // User should have upgraded
    assert!(tier_changed, "Tier should have changed");
    assert_eq!(
        new_tier_name,
        Some("Platinum"),
        "New tier should be Platinum (20+ nights)"
    );

    // Verify in database
    let final_tier: (Option<String>, i32) = sqlx::query_as(
        r#"
        SELECT t.name, ul.total_nights
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(target_user_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch final tier");

    assert_eq!(
        final_tier.0.as_deref(),
        Some("Platinum"),
        "Database tier should be Platinum"
    );
    assert_eq!(final_tier.1, 20, "Database nights should be 20 (8 + 12)");

    // Cleanup
    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database"]
async fn test_tier_recalculation_no_change() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    ensure_points_transactions_table(&pool)
        .await
        .expect("Failed to create points_transactions table");
    ensure_user_loyalty_columns(&pool)
        .await
        .expect("Failed to add user_loyalty columns");
    ensure_tiers_columns(&pool)
        .await
        .expect("Failed to add tiers columns");

    // Create admin user
    let admin_user = TestUser::admin("admin_no_change@example.com");
    admin_user
        .insert(&pool)
        .await
        .expect("Failed to insert admin user");
    let admin_token = generate_test_token_with_role(&admin_user.id, &admin_user.email, "admin");

    // Create target user with 5 nights (Silver tier)
    let target_user = TestUser::new("tier_no_change@example.com");
    let target_user_id = insert_user_with_loyalty(&pool, &target_user, 500, 5)
        .await
        .expect("Failed to insert target user");

    let router = create_loyalty_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&admin_token);

    // Act - Award small amount of nights (not enough to change tier)
    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 100,
        "nights": 2,  // 5 + 2 = 7 nights, still Silver (< 10 for Gold)
        "description": "Small award"
    });

    let response = client.post("/api/loyalty/award", &payload).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have 'data' field");

    // Tier should NOT have changed
    let tier_changed = data
        .get("tier_changed")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    assert!(!tier_changed, "Tier should NOT have changed");

    // Verify nights increased but tier remains Silver
    let final_data: (Option<String>, i32) = sqlx::query_as(
        r#"
        SELECT t.name, ul.total_nights
        FROM user_loyalty ul
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE ul.user_id = $1
        "#,
    )
    .bind(target_user_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch final data");

    assert_eq!(
        final_data.0.as_deref(),
        Some("Silver"),
        "Tier should remain Silver"
    );
    assert_eq!(final_data.1, 7, "Nights should be 7");

    // Cleanup
    teardown_test(&test_db).await;
}
