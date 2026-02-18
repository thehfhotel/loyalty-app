//! Loyalty endpoint integration tests
//!
//! Tests for the /api/loyalty endpoints including:
//! - Get loyalty status
//! - Get transactions (paginated)
//! - Get tier definitions
//! - Award points (admin only)
//! - Tier recalculation

use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Test Setup Helpers
// ============================================================================

/// Insert a user with loyalty record into the test database
async fn insert_user_with_loyalty(
    pool: &sqlx::PgPool,
    user: &TestUser,
    initial_points: i32,
    initial_nights: i32,
) -> Result<Uuid, sqlx::Error> {
    user.insert(pool).await?;

    let tier_id: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM tiers WHERE min_nights <= $1 ORDER BY min_nights DESC LIMIT 1",
    )
    .bind(initial_nights)
    .fetch_optional(pool)
    .await?;

    let tier_id = tier_id.map(|t| t.0);

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
async fn test_get_loyalty_status() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("loyalty_status@example.com");
    let user_id = insert_user_with_loyalty(app.db(), &user, 500, 5)
        .await
        .expect("Failed to insert user with loyalty");

    let client = app.authenticated_client(&user_id, &user.email);
    let response = client.get("/api/loyalty/status").await;

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

    assert!(
        data.get("tier").is_some(),
        "Response should have 'tier' field"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_loyalty_status_unauthenticated() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/loyalty/status").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: GET /api/loyalty/transactions
// ============================================================================

#[tokio::test]
async fn test_get_transactions() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("transactions@example.com");
    let user_id = insert_user_with_loyalty(app.db(), &user, 1000, 10)
        .await
        .expect("Failed to insert user with loyalty");

    insert_sample_transactions(app.db(), user_id, 5)
        .await
        .expect("Failed to insert sample transactions");

    let client = app.authenticated_client(&user_id, &user.email);
    let response = client.get("/api/loyalty/transactions").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");

    assert!(json
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false));

    let data = json.get("data").expect("Response should have 'data' field");

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

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_transactions_pagination() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("transactions_paginated@example.com");
    let user_id = insert_user_with_loyalty(app.db(), &user, 1000, 10)
        .await
        .expect("Failed to insert user with loyalty");

    insert_sample_transactions(app.db(), user_id, 25)
        .await
        .expect("Failed to insert sample transactions");

    let client = app.authenticated_client(&user_id, &user.email);
    let response = client
        .get("/api/loyalty/transactions?page=2&limit=10")
        .await;

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

    app.cleanup().await.ok();
}

// ============================================================================
// Test: GET /api/loyalty/tiers
// ============================================================================

#[tokio::test]
async fn test_get_tiers() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/loyalty/tiers").await;

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

    let tier_names: Vec<&str> = tiers
        .iter()
        .filter_map(|t| t.get("name").and_then(|v| v.as_str()))
        .collect();

    assert!(tier_names.contains(&"Bronze"), "Should contain Bronze tier");
    assert!(
        tier_names.contains(&"Platinum"),
        "Should contain Platinum tier"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: POST /api/loyalty/award (Admin Only)
// ============================================================================

#[tokio::test]
async fn test_award_points_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin_award@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    let target_user = TestUser::new("target_user@example.com");
    let target_user_id = insert_user_with_loyalty(app.db(), &target_user, 100, 2)
        .await
        .expect("Failed to insert target user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 500,
        "nights": 3,
        "source": "admin_award",
        "description": "Test points award"
    });

    let response = client.post("/api/loyalty/award", &payload).await;

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
            .fetch_one(app.db())
            .await
            .expect("Failed to fetch updated loyalty");

    assert_eq!(loyalty.0, 600, "Database should show 600 points");
    assert_eq!(loyalty.1, 5, "Database should show 5 nights");

    app.cleanup().await.ok();
}

// ============================================================================
// Test: POST /api/loyalty/award - Non-Admin Fails
// ============================================================================

#[tokio::test]
async fn test_award_points_non_admin_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let regular_user = TestUser::new("regular_user@example.com");
    let regular_user_id = insert_user_with_loyalty(app.db(), &regular_user, 100, 2)
        .await
        .expect("Failed to insert regular user");

    let target_user = TestUser::new("target_user2@example.com");
    let target_user_id = insert_user_with_loyalty(app.db(), &target_user, 100, 2)
        .await
        .expect("Failed to insert target user");

    let client = app.authenticated_client(&regular_user_id, &regular_user.email);

    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 500,
        "nights": 3
    });

    let response = client.post("/api/loyalty/award", &payload).await;

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
            .fetch_one(app.db())
            .await
            .expect("Failed to fetch loyalty");

    assert_eq!(loyalty.0, 100, "Points should remain unchanged at 100");

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Tier Recalculation
// ============================================================================

#[tokio::test]
async fn test_tier_recalculation() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin_tier@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    // Create target user with 8 nights (Silver tier: 1+ nights)
    let target_user = TestUser::new("tier_upgrade@example.com");
    let target_user_id = insert_user_with_loyalty(app.db(), &target_user, 500, 8)
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
    .fetch_one(app.db())
    .await
    .expect("Failed to fetch initial tier");

    assert!(
        initial_tier.0.as_deref() == Some("Silver") || initial_tier.0.as_deref() == Some("Bronze"),
        "Initial tier should be Silver or Bronze, got {:?}",
        initial_tier.0
    );

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Award enough nights to upgrade to Platinum (20+ nights)
    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 200,
        "nights": 12,  // Add 12 nights to reach Platinum (8 + 12 = 20)
        "description": "Test tier upgrade"
    });

    let response = client.post("/api/loyalty/award", &payload).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have 'data' field");

    let tier_changed = data
        .get("tier_changed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let new_tier_name = data.get("new_tier_name").and_then(|v| v.as_str());

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
    .fetch_one(app.db())
    .await
    .expect("Failed to fetch final tier");

    assert_eq!(
        final_tier.0.as_deref(),
        Some("Platinum"),
        "Database tier should be Platinum"
    );
    assert_eq!(final_tier.1, 20, "Database nights should be 20 (8 + 12)");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_tier_recalculation_no_change() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin_no_change@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    // Create target user with 5 nights (Silver tier)
    let target_user = TestUser::new("tier_no_change@example.com");
    let target_user_id = insert_user_with_loyalty(app.db(), &target_user, 500, 5)
        .await
        .expect("Failed to insert target user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    // Award small amount of nights (not enough to change tier)
    let payload = json!({
        "userId": target_user_id.to_string(),
        "points": 100,
        "nights": 2,  // 5 + 2 = 7 nights, still Silver (< 10 for Gold)
        "description": "Small award"
    });

    let response = client.post("/api/loyalty/award", &payload).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have 'data' field");

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
    .fetch_one(app.db())
    .await
    .expect("Failed to fetch final data");

    assert_eq!(
        final_data.0.as_deref(),
        Some("Silver"),
        "Tier should remain Silver"
    );
    assert_eq!(final_data.1, 7, "Nights should be 7");

    app.cleanup().await.ok();
}
