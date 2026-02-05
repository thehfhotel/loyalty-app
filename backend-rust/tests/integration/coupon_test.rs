//! Coupon endpoint integration tests
//!
//! Tests for the /api/coupons endpoints including:
//! - Listing active coupons
//! - Getting user's assigned coupons
//! - Creating coupons (admin only)
//! - Assigning coupons to users
//! - Redeeming coupons
//! - Redemption validation

use chrono::{Duration, Utc};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{
    generate_test_token, init_test_db, setup_test, teardown_test, TestClient, TestCoupon, TestUser,
};

// ============================================================================
// Test Setup Helpers
// ============================================================================

/// Create a test router with coupon routes
async fn create_coupon_router() -> Result<axum::Router, Box<dyn std::error::Error>> {
    use loyalty_backend::routes::coupons;
    use loyalty_backend::state::AppState;
    use loyalty_backend::Settings;

    let pool = init_test_db().await?;
    let redis = crate::common::init_test_redis().await?;

    let config = Settings::default();
    let state = AppState::new(pool, redis, config);

    Ok(coupons::routes().with_state(state))
}

/// Insert a user_coupon directly into the database for testing
async fn insert_user_coupon(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    coupon_id: Uuid,
    status: &str,
) -> Result<(Uuid, String), sqlx::Error> {
    let user_coupon_id = Uuid::new_v4();
    let qr_code = format!("QR-TEST-{}", user_coupon_id);

    sqlx::query(
        r#"
        INSERT INTO user_coupons (id, user_id, coupon_id, status, qr_code, created_at, updated_at)
        VALUES ($1, $2, $3, $4::user_coupon_status, $5, NOW(), NOW())
        "#,
    )
    .bind(user_coupon_id)
    .bind(user_id)
    .bind(coupon_id)
    .bind(status)
    .bind(&qr_code)
    .execute(pool)
    .await?;

    Ok((user_coupon_id, qr_code))
}

/// Create test user_coupons table if not exists
async fn ensure_user_coupons_table(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    // Create user_coupon_status enum if it doesn't exist
    sqlx::query(
        r#"
        DO $$ BEGIN
            CREATE TYPE user_coupon_status AS ENUM ('available', 'used', 'expired', 'revoked');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
        "#,
    )
    .execute(pool)
    .await?;

    // Create user_coupons table if not exists
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user_coupons (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
            status user_coupon_status DEFAULT 'available',
            qr_code TEXT NOT NULL UNIQUE,
            used_at TIMESTAMPTZ,
            used_by_admin UUID,
            redemption_location VARCHAR(255),
            redemption_details JSONB DEFAULT '{}',
            assigned_by UUID,
            assigned_reason TEXT,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

// ============================================================================
// Test: List Coupons
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_list_coupons() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Create test user
    let user = TestUser::new("coupon_list_user@example.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create test coupons
    let coupon1 = TestCoupon::percentage("LIST10", 10.0);
    coupon1
        .insert(&pool)
        .await
        .expect("Failed to insert coupon 1");

    let coupon2 = TestCoupon::fixed_amount("LIST500", 500.0);
    coupon2
        .insert(&pool)
        .await
        .expect("Failed to insert coupon 2");

    // Create expired coupon (should not appear for regular users)
    let expired_coupon = TestCoupon::expired("EXPIRED10");
    expired_coupon
        .insert(&pool)
        .await
        .expect("Failed to insert expired coupon");

    // Generate auth token
    let token = generate_test_token(&user.id, &user.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/coupons").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(
        json.get("success").is_some(),
        "Response should have success field"
    );
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Check data structure
    let data = json.get("data").expect("Response should have data field");
    assert!(data.get("items").is_some(), "Data should have items array");
    assert!(data.get("total").is_some(), "Data should have total count");

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Get User Coupons
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_user_coupons() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create test user
    let user = TestUser::new("my_coupons_user@example.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create test coupon
    let coupon = TestCoupon::percentage("MYTEST10", 10.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Assign coupon to user
    insert_user_coupon(&pool, user.id, coupon.id, "available")
        .await
        .expect("Failed to insert user coupon");

    // Generate auth token
    let token = generate_test_token(&user.id, &user.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/coupons/my-coupons").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Check data structure
    let data = json.get("data").expect("Response should have data field");
    let items = data.get("items").and_then(|v| v.as_array());
    assert!(items.is_some(), "Data should have items array");

    // Should have at least one coupon
    let items = items.unwrap();
    assert!(
        !items.is_empty(),
        "User should have at least one assigned coupon"
    );

    // Verify the coupon data
    let first_coupon = &items[0];
    assert!(
        first_coupon.get("qr_code").is_some(),
        "Coupon should have qr_code"
    );
    assert!(
        first_coupon.get("status").is_some(),
        "Coupon should have status"
    );

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Create Coupon (Admin Only)
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_create_coupon_admin() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Create admin user
    let admin = TestUser::admin("admin_create_coupon@example.com");
    admin
        .insert(&pool)
        .await
        .expect("Failed to insert admin user");

    // Generate admin auth token
    let token = generate_test_token(&admin.id, &admin.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare create coupon request
    let create_request = json!({
        "code": "ADMIN20",
        "name": "Admin Created Coupon",
        "description": "A coupon created by admin for testing",
        "coupon_type": "percentage",
        "value": 20.0,
        "currency": "THB",
        "status": "active",
        "valid_from": Utc::now().to_rfc3339(),
        "valid_until": (Utc::now() + Duration::days(30)).to_rfc3339(),
        "usage_limit": 100,
        "usage_limit_per_user": 1
    });

    // Act
    let response = client.post("/coupons", &create_request).await;

    // Assert
    response.assert_status(201);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Verify created coupon data
    let data = json.get("data").expect("Response should have data field");
    assert_eq!(
        data.get("code").and_then(|v| v.as_str()),
        Some("ADMIN20"),
        "Coupon code should match"
    );
    assert_eq!(
        data.get("name").and_then(|v| v.as_str()),
        Some("Admin Created Coupon"),
        "Coupon name should match"
    );

    // Clean up
    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_create_coupon_non_admin_fails() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Create regular user (not admin)
    let user = TestUser::new("regular_user@example.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Generate regular user auth token
    let token = generate_test_token(&user.id, &user.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare create coupon request
    let create_request = json!({
        "code": "NOADMIN",
        "name": "Unauthorized Coupon",
        "coupon_type": "percentage",
        "value": 10.0
    });

    // Act
    let response = client.post("/coupons", &create_request).await;

    // Assert - Should fail with 403 Forbidden
    response.assert_status(403);

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Assign Coupon
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_assign_coupon() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create admin user
    let admin = TestUser::admin("admin_assign@example.com");
    admin
        .insert(&pool)
        .await
        .expect("Failed to insert admin user");

    // Create regular user to receive coupon
    let user = TestUser::new("receiver@example.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create test coupon
    let coupon = TestCoupon::percentage("ASSIGN10", 10.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Generate admin auth token
    let token = generate_test_token(&admin.id, &admin.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare assign request
    let assign_request = json!({
        "couponId": coupon.id.to_string(),
        "userIds": [user.id.to_string()],
        "assignedReason": "Test assignment"
    });

    // Act
    let response = client.post("/coupons/assign", &assign_request).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Verify assignment data
    let data = json.get("data").expect("Response should have data field");
    assert!(
        data.is_array(),
        "Data should be an array of assigned coupons"
    );

    let assignments = data.as_array().unwrap();
    assert_eq!(assignments.len(), 1, "Should have one assignment");

    // Verify the assignment
    let assignment = &assignments[0];
    assert!(
        assignment.get("qr_code").is_some(),
        "Assignment should have qr_code"
    );
    assert_eq!(
        assignment.get("user_id").and_then(|v| v.as_str()),
        Some(user.id.to_string().as_str()),
        "User ID should match"
    );

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Redeem Coupon
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_redeem_coupon() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create test user
    let user = TestUser::new("redeemer@example.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create test coupon (percentage discount)
    let coupon = TestCoupon::percentage("REDEEM20", 20.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Assign coupon to user
    let (user_coupon_id, qr_code) = insert_user_coupon(&pool, user.id, coupon.id, "available")
        .await
        .expect("Failed to insert user coupon");

    // Generate auth token
    let token = generate_test_token(&user.id, &user.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare redeem request
    let redeem_request = json!({
        "qrCode": qr_code,
        "originalAmount": 1000.00,
        "transactionReference": "TXN-TEST-001"
    });

    // Act
    let response = client.post("/coupons/redeem", &redeem_request).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Verify redemption data
    let data = json.get("data").expect("Response should have data field");
    assert_eq!(
        data.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Redemption should be successful"
    );

    // For a 20% coupon on 1000 THB, discount should be 200 THB
    let discount_amount = data
        .get("discountAmount")
        .and_then(|v| v.as_f64())
        .or_else(|| data.get("discount_amount").and_then(|v| v.as_f64()));
    assert!(
        discount_amount.is_some(),
        "Response should have discount amount"
    );

    let final_amount = data
        .get("finalAmount")
        .and_then(|v| v.as_f64())
        .or_else(|| data.get("final_amount").and_then(|v| v.as_f64()));
    assert!(final_amount.is_some(), "Response should have final amount");

    // Verify coupon status in database
    let coupon_status: String =
        sqlx::query_scalar("SELECT status::text FROM user_coupons WHERE id = $1")
            .bind(user_coupon_id)
            .fetch_one(&pool)
            .await
            .expect("Failed to fetch coupon status");

    assert_eq!(coupon_status, "used", "Coupon status should be 'used'");

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Redeem Already Redeemed Coupon Fails
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_redeem_already_redeemed_fails() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create test user
    let user = TestUser::new("double_redeemer@example.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create test coupon
    let coupon = TestCoupon::percentage("DOUBLE10", 10.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Assign coupon to user with 'used' status (already redeemed)
    let (_user_coupon_id, qr_code) = insert_user_coupon(&pool, user.id, coupon.id, "used")
        .await
        .expect("Failed to insert user coupon");

    // Generate auth token
    let token = generate_test_token(&user.id, &user.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare redeem request for already-used coupon
    let redeem_request = json!({
        "qrCode": qr_code,
        "originalAmount": 500.00
    });

    // Act
    let response = client.post("/coupons/redeem", &redeem_request).await;

    // Assert - Should fail because coupon is already used
    // The exact status code depends on implementation (400 Bad Request or 422 Unprocessable Entity)
    assert!(
        response.status == 400 || response.status == 422 || response.status == 200,
        "Response should indicate failure"
    );

    // If status is 200, check the response body for failure indication
    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");
        let data = json.get("data");

        if let Some(data) = data {
            // The response might indicate failure in the data
            let success = data.get("success").and_then(|v| v.as_bool());
            let valid = data.get("valid").and_then(|v| v.as_bool());

            assert!(
                success == Some(false) || valid == Some(false),
                "Redemption should indicate failure for already-used coupon"
            );
        }
    } else {
        // Check error response
        let json: Value = response.json().expect("Response should be valid JSON");
        assert!(
            json.get("error").is_some() || json.get("message").is_some(),
            "Response should have error message"
        );
    }

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Redeem Expired Coupon Fails
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_redeem_expired_coupon_fails() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create test user
    let user = TestUser::new("expired_redeemer@example.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create test coupon
    let coupon = TestCoupon::percentage("EXPIRED20", 20.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Create user coupon with expired status
    let user_coupon_id = Uuid::new_v4();
    let qr_code = format!("QR-EXPIRED-{}", user_coupon_id);

    // Insert with expires_at in the past
    sqlx::query(
        r#"
        INSERT INTO user_coupons (id, user_id, coupon_id, status, qr_code, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, 'available'::user_coupon_status, $4, $5, NOW(), NOW())
        "#,
    )
    .bind(user_coupon_id)
    .bind(user.id)
    .bind(coupon.id)
    .bind(&qr_code)
    .bind(Utc::now() - Duration::days(1)) // Expired yesterday
    .execute(&pool)
    .await
    .expect("Failed to insert expired user coupon");

    // Generate auth token
    let token = generate_test_token(&user.id, &user.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare redeem request for expired coupon
    let redeem_request = json!({
        "qrCode": qr_code,
        "originalAmount": 500.00
    });

    // Act
    let response = client.post("/coupons/redeem", &redeem_request).await;

    // Assert - Should fail because coupon is expired
    assert!(
        response.status == 400 || response.status == 422 || response.status == 200,
        "Response should indicate failure"
    );

    if response.status == 200 {
        let json: Value = response.json().expect("Response should be valid JSON");
        let data = json.get("data");

        if let Some(data) = data {
            let success = data.get("success").and_then(|v| v.as_bool());
            let valid = data.get("valid").and_then(|v| v.as_bool());

            assert!(
                success == Some(false) || valid == Some(false),
                "Redemption should indicate failure for expired coupon"
            );
        }
    }

    // Clean up
    teardown_test(&test_db).await;
}

// ============================================================================
// Test: Unauthenticated Access Fails
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_list_coupons_unauthenticated_fails() {
    // Arrange
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router); // No auth token

    // Act
    let response = client.get("/coupons").await;

    // Assert - Should fail with 401 Unauthorized
    response.assert_status(401);
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_my_coupons_unauthenticated_fails() {
    // Arrange
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router); // No auth token

    // Act
    let response = client.get("/coupons/my-coupons").await;

    // Assert - Should fail with 401 Unauthorized
    response.assert_status(401);
}

// ============================================================================
// Test: Validate Coupon QR Code
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_validate_coupon_qr_code() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create test user
    let user = TestUser::new("validator@example.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create test coupon
    let coupon = TestCoupon::percentage("VALIDATE10", 10.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Assign coupon to user
    let (_user_coupon_id, qr_code) = insert_user_coupon(&pool, user.id, coupon.id, "available")
        .await
        .expect("Failed to insert user coupon");

    // Create router and client (validate endpoint is public)
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router);

    // Act
    let response = client.get(&format!("/coupons/validate/{}", qr_code)).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Verify validation data
    let data = json.get("data").expect("Response should have data field");
    assert_eq!(
        data.get("valid").and_then(|v| v.as_bool()),
        Some(true),
        "Coupon should be valid"
    );

    // Clean up
    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_validate_invalid_qr_code() {
    // Arrange
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router);

    // Act - Use a non-existent QR code
    let response = client.get("/coupons/validate/INVALID-QR-CODE-12345").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have data field");

    assert_eq!(
        data.get("valid").and_then(|v| v.as_bool()),
        Some(false),
        "Invalid QR code should not be valid"
    );
}

// ============================================================================
// Test: Assign Coupon to Multiple Users
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_assign_coupon_to_multiple_users() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    // Ensure user_coupons table exists
    ensure_user_coupons_table(&pool)
        .await
        .expect("Failed to ensure user_coupons table");

    // Create admin user
    let admin = TestUser::admin("admin_multi_assign@example.com");
    admin
        .insert(&pool)
        .await
        .expect("Failed to insert admin user");

    // Create multiple users to receive coupons
    let user1 = TestUser::new("multi_receiver1@example.com");
    user1.insert(&pool).await.expect("Failed to insert user 1");

    let user2 = TestUser::new("multi_receiver2@example.com");
    user2.insert(&pool).await.expect("Failed to insert user 2");

    let user3 = TestUser::new("multi_receiver3@example.com");
    user3.insert(&pool).await.expect("Failed to insert user 3");

    // Create test coupon
    let coupon = TestCoupon::percentage("MULTI25", 25.0);
    coupon.insert(&pool).await.expect("Failed to insert coupon");

    // Generate admin auth token
    let token = generate_test_token(&admin.id, &admin.email);

    // Create router and client
    let router = create_coupon_router()
        .await
        .expect("Failed to create router");
    let client = TestClient::new(router).with_auth(&token);

    // Prepare assign request with multiple users
    let assign_request = json!({
        "couponId": coupon.id.to_string(),
        "userIds": [
            user1.id.to_string(),
            user2.id.to_string(),
            user3.id.to_string()
        ],
        "assignedReason": "Bulk test assignment"
    });

    // Act
    let response = client.post("/coupons/assign", &assign_request).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    // Verify all assignments were created
    let data = json.get("data").expect("Response should have data field");
    let assignments = data.as_array().expect("Data should be an array");
    assert_eq!(assignments.len(), 3, "Should have three assignments");

    // Verify each user got a unique QR code
    let qr_codes: Vec<&str> = assignments
        .iter()
        .filter_map(|a| a.get("qr_code").and_then(|v| v.as_str()))
        .collect();
    assert_eq!(qr_codes.len(), 3, "All assignments should have QR codes");

    // Verify all QR codes are unique
    let mut unique_qr_codes = qr_codes.clone();
    unique_qr_codes.sort();
    unique_qr_codes.dedup();
    assert_eq!(unique_qr_codes.len(), 3, "All QR codes should be unique");

    // Clean up
    teardown_test(&test_db).await;
}
