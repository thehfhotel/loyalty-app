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
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{TestApp, TestCoupon, TestUser};

// ============================================================================
// Test Setup Helpers
// ============================================================================

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

// ============================================================================
// Test: List Coupons
// ============================================================================

#[tokio::test]
async fn test_list_coupons() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("coupon_list_user@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let coupon1 = TestCoupon::percentage("LIST10", 10.0);
    coupon1
        .insert(app.db())
        .await
        .expect("Failed to insert coupon 1");

    let coupon2 = TestCoupon::fixed_amount("LIST500", 500.0);
    coupon2
        .insert(app.db())
        .await
        .expect("Failed to insert coupon 2");

    // Create expired coupon (should not appear for regular users)
    let expired_coupon = TestCoupon::expired("EXPIRED10");
    expired_coupon
        .insert(app.db())
        .await
        .expect("Failed to insert expired coupon");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/coupons").await;

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

    let data = json.get("data").expect("Response should have data field");
    assert!(data.get("items").is_some(), "Data should have items array");
    assert!(data.get("total").is_some(), "Data should have total count");

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Get User Coupons
// ============================================================================

#[tokio::test]
async fn test_get_user_coupons() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("my_coupons_user@example.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let coupon = TestCoupon::percentage("MYTEST10", 10.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    insert_user_coupon(app.db(), user.id, coupon.id, "available")
        .await
        .expect("Failed to insert user coupon");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/coupons/my-coupons").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have data field");
    let items = data.get("items").and_then(|v| v.as_array());
    assert!(items.is_some(), "Data should have items array");

    let items = items.unwrap();
    assert!(
        !items.is_empty(),
        "User should have at least one assigned coupon"
    );

    let first_coupon = &items[0];
    assert!(
        first_coupon.get("qr_code").is_some(),
        "Coupon should have qr_code"
    );
    assert!(
        first_coupon.get("status").is_some(),
        "Coupon should have status"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Create Coupon (Admin Only)
// ============================================================================

#[tokio::test]
async fn test_create_coupon_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin_create_coupon@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

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

    let response = client.post("/api/coupons", &create_request).await;

    response.assert_status(201);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

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

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_create_coupon_non_admin_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("regular_user@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let client = app.authenticated_client(&user.id, &user.email);

    let create_request = json!({
        "code": "NOADMIN",
        "name": "Unauthorized Coupon",
        "coupon_type": "percentage",
        "value": 10.0
    });

    let response = client.post("/api/coupons", &create_request).await;

    response.assert_status(403);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Assign Coupon
// ============================================================================

#[tokio::test]
async fn test_assign_coupon() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin_assign@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    let user = TestUser::new("receiver@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let coupon = TestCoupon::percentage("ASSIGN10", 10.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let assign_request = json!({
        "couponId": coupon.id.to_string(),
        "userIds": [user.id.to_string()],
        "assignedReason": "Test assignment"
    });

    let response = client.post("/api/coupons/assign", &assign_request).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have data field");
    assert!(
        data.is_array(),
        "Data should be an array of assigned coupons"
    );

    let assignments = data.as_array().unwrap();
    assert_eq!(assignments.len(), 1, "Should have one assignment");

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

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Redeem Coupon
// ============================================================================

#[tokio::test]
async fn test_redeem_coupon() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("redeemer@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let coupon = TestCoupon::percentage("REDEEM20", 20.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    let (user_coupon_id, qr_code) = insert_user_coupon(app.db(), user.id, coupon.id, "available")
        .await
        .expect("Failed to insert user coupon");

    let client = app.authenticated_client(&user.id, &user.email);

    let redeem_request = json!({
        "qrCode": qr_code,
        "originalAmount": 1000.00,
        "transactionReference": "TXN-TEST-001"
    });

    let response = client.post("/api/coupons/redeem", &redeem_request).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

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
            .fetch_one(app.db())
            .await
            .expect("Failed to fetch coupon status");

    assert_eq!(coupon_status, "used", "Coupon status should be 'used'");

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Redeem Already Redeemed Coupon Fails
// ============================================================================

#[tokio::test]
async fn test_redeem_already_redeemed_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("double_redeemer@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let coupon = TestCoupon::percentage("DOUBLE10", 10.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    // Assign coupon to user with 'used' status (already redeemed)
    let (_user_coupon_id, qr_code) = insert_user_coupon(app.db(), user.id, coupon.id, "used")
        .await
        .expect("Failed to insert user coupon");

    let client = app.authenticated_client(&user.id, &user.email);

    let redeem_request = json!({
        "qrCode": qr_code,
        "originalAmount": 500.00
    });

    let response = client.post("/api/coupons/redeem", &redeem_request).await;

    // Should fail because coupon is already used
    // The exact status code depends on implementation (400, 422, or 200 with failure in body)
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
                "Redemption should indicate failure for already-used coupon"
            );
        }
    } else {
        let json: Value = response.json().expect("Response should be valid JSON");
        assert!(
            json.get("error").is_some() || json.get("message").is_some(),
            "Response should have error message"
        );
    }

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Redeem Expired Coupon Fails
// ============================================================================

#[tokio::test]
async fn test_redeem_expired_coupon_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("expired_redeemer@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let coupon = TestCoupon::percentage("EXPIRED20", 20.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    // Create user coupon with expires_at in the past
    let user_coupon_id = Uuid::new_v4();
    let qr_code = format!("QR-EXPIRED-{}", user_coupon_id);

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
    .execute(app.db())
    .await
    .expect("Failed to insert expired user coupon");

    let client = app.authenticated_client(&user.id, &user.email);

    let redeem_request = json!({
        "qrCode": qr_code,
        "originalAmount": 500.00
    });

    let response = client.post("/api/coupons/redeem", &redeem_request).await;

    // Should fail because coupon is expired
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

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Unauthenticated Access Fails
// ============================================================================

#[tokio::test]
async fn test_list_coupons_unauthenticated_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let response = client.get("/api/coupons").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_my_coupons_unauthenticated_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let response = client.get("/api/coupons/my-coupons").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Validate Coupon QR Code
// ============================================================================

#[tokio::test]
async fn test_validate_coupon_qr_code() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("validator@example.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    let coupon = TestCoupon::percentage("VALIDATE10", 10.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    let (_user_coupon_id, qr_code) = insert_user_coupon(app.db(), user.id, coupon.id, "available")
        .await
        .expect("Failed to insert user coupon");

    let client = app.client();

    let response = client
        .get(&format!("/api/coupons/validate/{}", qr_code))
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have data field");
    assert_eq!(
        data.get("valid").and_then(|v| v.as_bool()),
        Some(true),
        "Coupon should be valid"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_validate_invalid_qr_code() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let client = app.client();

    let response = client
        .get("/api/coupons/validate/INVALID-QR-CODE-12345")
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let data = json.get("data").expect("Response should have data field");

    assert_eq!(
        data.get("valid").and_then(|v| v.as_bool()),
        Some(false),
        "Invalid QR code should not be valid"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Test: Assign Coupon to Multiple Users
// ============================================================================

#[tokio::test]
async fn test_assign_coupon_to_multiple_users() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin_multi_assign@example.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin user");

    let user1 = TestUser::new("multi_receiver1@example.com");
    user1
        .insert(app.db())
        .await
        .expect("Failed to insert user 1");

    let user2 = TestUser::new("multi_receiver2@example.com");
    user2
        .insert(app.db())
        .await
        .expect("Failed to insert user 2");

    let user3 = TestUser::new("multi_receiver3@example.com");
    user3
        .insert(app.db())
        .await
        .expect("Failed to insert user 3");

    let coupon = TestCoupon::percentage("MULTI25", 25.0);
    coupon
        .insert(app.db())
        .await
        .expect("Failed to insert coupon");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let assign_request = json!({
        "couponId": coupon.id.to_string(),
        "userIds": [
            user1.id.to_string(),
            user2.id.to_string(),
            user3.id.to_string()
        ],
        "assignedReason": "Bulk test assignment"
    });

    let response = client.post("/api/coupons/assign", &assign_request).await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Success should be true"
    );

    let data = json.get("data").expect("Response should have data field");
    let assignments = data.as_array().expect("Data should be an array");
    assert_eq!(assignments.len(), 3, "Should have three assignments");

    // Verify each user got a unique QR code
    let qr_codes: Vec<&str> = assignments
        .iter()
        .filter_map(|a| a.get("qr_code").and_then(|v| v.as_str()))
        .collect();
    assert_eq!(qr_codes.len(), 3, "All assignments should have QR codes");

    let mut unique_qr_codes = qr_codes.clone();
    unique_qr_codes.sort();
    unique_qr_codes.dedup();
    assert_eq!(unique_qr_codes.len(), 3, "All QR codes should be unique");

    app.cleanup().await.ok();
}
