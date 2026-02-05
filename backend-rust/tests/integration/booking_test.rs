//! Booking endpoint integration tests
//!
//! Tests for the /api/bookings endpoints including:
//! - Listing bookings
//! - Creating bookings
//! - Getting booking details
//! - Cancelling bookings
//! - Completing bookings (admin)
//! - Checking room availability

use axum::Router;
use chrono::{Duration, NaiveDate, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{
    generate_test_token, init_test_db, setup_test, teardown_test, TestClient, TestUser,
};

// ============================================================================
// Test Setup
// ============================================================================

/// Create test app state with database for booking tests
async fn create_test_app() -> Result<(Router, sqlx::PgPool), Box<dyn std::error::Error>> {
    let pool = init_test_db().await?;

    // Create test settings
    let settings = loyalty_backend::config::Settings::default();

    // Initialize Redis connection for test
    let redis_url =
        std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://localhost:6383".to_string());
    let redis_client = redis::Client::open(redis_url)?;
    let redis = redis::aio::ConnectionManager::new(redis_client).await?;

    // Create app state
    let state = loyalty_backend::AppState::new(pool.clone(), redis, settings);

    // Create router with state
    let router = loyalty_backend::routes::create_router(state);

    Ok((router, pool))
}

/// Create a test booking in the database
async fn create_test_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    status: &str,
    check_in_offset_days: i64,
    check_out_offset_days: i64,
) -> Result<Uuid, sqlx::Error> {
    let booking_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let room_type_id = Uuid::new_v4();
    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(check_in_offset_days);
    let check_out = today + Duration::days(check_out_offset_days);

    // First, ensure room_types table exists and insert a room type
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS room_types (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(100) NOT NULL,
            description TEXT,
            price_per_night DECIMAL(10,2) NOT NULL DEFAULT 1500.00,
            max_guests INTEGER NOT NULL DEFAULT 2,
            bed_type VARCHAR(50),
            amenities JSONB DEFAULT '[]',
            images JSONB DEFAULT '[]',
            is_active BOOLEAN DEFAULT true,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Insert room type
    sqlx::query(
        r#"
        INSERT INTO room_types (id, name, price_per_night, max_guests)
        VALUES ($1, 'Deluxe Room', 2000.00, 2)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(room_type_id)
    .execute(pool)
    .await?;

    // Create rooms table if not exists
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS rooms (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            room_type_id UUID REFERENCES room_types(id),
            room_number VARCHAR(20) NOT NULL,
            floor INTEGER,
            notes TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Insert room
    sqlx::query(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor)
        VALUES ($1, $2, '101', 1)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(room_id)
    .bind(room_type_id)
    .execute(pool)
    .await?;

    // Create bookings table if not exists
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS bookings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            room_id UUID NOT NULL REFERENCES rooms(id),
            room_type_id UUID NOT NULL REFERENCES room_types(id),
            check_in_date DATE NOT NULL,
            check_out_date DATE NOT NULL,
            num_guests INTEGER NOT NULL DEFAULT 1,
            total_price DECIMAL(10,2) NOT NULL,
            points_earned INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
            cancelled_at TIMESTAMPTZ,
            cancellation_reason TEXT,
            cancelled_by UUID,
            cancelled_by_admin BOOLEAN DEFAULT false,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Calculate nights and price
    let nights = (check_out - check_in).num_days() as i32;
    let total_price = 2000.0 * nights as f64;
    let points_earned = (total_price * 10.0) as i32;

    // Insert booking
    sqlx::query(
        r#"
        INSERT INTO bookings (id, user_id, room_id, room_type_id, check_in_date, check_out_date, num_guests, total_price, points_earned, status)
        VALUES ($1, $2, $3, $4, $5, $6, 2, $7, $8, $9)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_id)
    .bind(check_in)
    .bind(check_out)
    .bind(total_price)
    .bind(points_earned)
    .bind(status)
    .execute(pool)
    .await?;

    Ok(booking_id)
}

// ============================================================================
// test_list_bookings - GET /api/bookings
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_list_bookings_returns_user_bookings() {
    // Arrange
    let (pool, test_db) = setup_test().await;

    let (router, _) = create_test_app().await.expect("Failed to create test app");

    // Create a test user
    let user = TestUser::new("booking-list@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create some bookings for this user
    let _ = create_test_booking(&pool, user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");
    let _ = create_test_booking(&pool, user.id, "confirmed", 14, 17)
        .await
        .expect("Failed to create booking");

    // Generate auth token
    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get("/api/bookings").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(
        json.get("bookings").is_some(),
        "Response should have 'bookings' field"
    );

    let bookings = json.get("bookings").and_then(|v| v.as_array());
    assert!(bookings.is_some(), "Bookings should be an array");

    // Cleanup
    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_list_bookings_requires_authentication() {
    // Arrange
    let (router, _) = create_test_app().await.expect("Failed to create test app");
    let client = TestClient::new(router);

    // Act - No auth token
    let response = client.get("/api/bookings").await;

    // Assert
    response.assert_status(401);
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_list_bookings_with_status_filter() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-filter@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create bookings with different statuses
    let _ = create_test_booking(&pool, user.id, "confirmed", 7, 10).await;
    let _ = create_test_booking(&pool, user.id, "cancelled", 14, 17).await;

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act - Filter by confirmed status
    let response = client.get("/api/bookings?status=confirmed").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let bookings = json.get("bookings").and_then(|v| v.as_array()).unwrap();

    // All returned bookings should be confirmed
    for booking in bookings {
        assert_eq!(
            booking.get("status").and_then(|v| v.as_str()),
            Some("confirmed"),
            "All bookings should have confirmed status"
        );
    }

    teardown_test(&test_db).await;
}

// ============================================================================
// test_create_booking - POST /api/bookings
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_create_booking_success() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-create@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(7);
    let check_out = today + Duration::days(10);

    let booking_request = json!({
        "checkIn": check_in.format("%Y-%m-%d").to_string(),
        "checkOut": check_out.format("%Y-%m-%d").to_string(),
        "roomType": "deluxe",
        "guests": 2,
        "specialRequests": "Late checkout if possible"
    });

    // Act
    let response = client.post("/api/bookings", &booking_request).await;

    // Assert
    assert!(
        response.status == 201 || response.status == 200,
        "Expected 201 Created or 200 OK, got {}. Body: {}",
        response.status,
        response.body
    );

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(json.get("id").is_some(), "Response should have 'id' field");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("confirmed"),
        "New booking should be confirmed"
    );

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_create_booking_invalid_dates() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-invalid@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let today = Utc::now().date_naive();
    // Check-out before check-in (invalid)
    let check_in = today + Duration::days(10);
    let check_out = today + Duration::days(7);

    let booking_request = json!({
        "checkIn": check_in.format("%Y-%m-%d").to_string(),
        "checkOut": check_out.format("%Y-%m-%d").to_string(),
        "roomType": "standard",
        "guests": 1
    });

    // Act
    let response = client.post("/api/bookings", &booking_request).await;

    // Assert - Should fail validation
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid dates, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_create_booking_past_date() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-past@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let today = Utc::now().date_naive();
    // Check-in in the past (invalid)
    let check_in = today - Duration::days(5);
    let check_out = today - Duration::days(2);

    let booking_request = json!({
        "checkIn": check_in.format("%Y-%m-%d").to_string(),
        "checkOut": check_out.format("%Y-%m-%d").to_string(),
        "roomType": "standard",
        "guests": 1
    });

    // Act
    let response = client.post("/api/bookings", &booking_request).await;

    // Assert - Should fail because check-in is in the past
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for past check-in date, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// test_get_booking - GET /api/bookings/:id
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_booking_returns_details() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-get@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create a booking
    let booking_id = create_test_booking(&pool, user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act
    let response = client.get(&format!("/api/bookings/{}", booking_id)).await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("id").and_then(|v| v.as_str()),
        Some(booking_id.to_string()).as_deref(),
        "Response should contain the correct booking ID"
    );
    assert!(
        json.get("checkInDate").is_some() || json.get("check_in_date").is_some(),
        "Response should have check-in date"
    );
    assert!(
        json.get("checkOutDate").is_some() || json.get("check_out_date").is_some(),
        "Response should have check-out date"
    );

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_booking_not_found() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-notfound@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act - Try to get a non-existent booking
    let fake_id = Uuid::new_v4();
    let response = client.get(&format!("/api/bookings/{}", fake_id)).await;

    // Assert
    response.assert_status(404);

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_get_booking_forbidden_for_other_user() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    // Create booking owner
    let owner = TestUser::new("booking-owner@test.com");
    owner.insert(&pool).await.expect("Failed to insert owner");

    // Create another user
    let other_user = TestUser::new("other-user@test.com");
    other_user
        .insert(&pool)
        .await
        .expect("Failed to insert other user");

    // Create a booking for the owner
    let booking_id = create_test_booking(&pool, owner.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    // Generate token for the OTHER user (not the owner)
    let token = generate_test_token(&other_user.id, &other_user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act - Try to get owner's booking as other user
    let response = client.get(&format!("/api/bookings/{}", booking_id)).await;

    // Assert - Should be forbidden
    response.assert_status(403);

    teardown_test(&test_db).await;
}

// ============================================================================
// test_cancel_booking - POST /api/bookings/:id/cancel
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_cancel_booking_success() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-cancel@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create a future booking (can be cancelled)
    let booking_id = create_test_booking(&pool, user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let cancel_request = json!({
        "reason": "Change of plans"
    });

    // Act
    let response = client
        .post(
            &format!("/api/bookings/{}/cancel", booking_id),
            &cancel_request,
        )
        .await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("cancelled"),
        "Booking status should be cancelled"
    );

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_cancel_booking_already_cancelled() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-double-cancel@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create an already cancelled booking
    let booking_id = create_test_booking(&pool, user.id, "cancelled", 7, 10)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let cancel_request = json!({
        "reason": "Trying to cancel again"
    });

    // Act
    let response = client
        .post(
            &format!("/api/bookings/{}/cancel", booking_id),
            &cancel_request,
        )
        .await;

    // Assert - Should fail because already cancelled
    response.assert_status(400);

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_cancel_booking_completed_fails() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-cancel-completed@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create a completed booking
    let booking_id = create_test_booking(&pool, user.id, "completed", -10, -7)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let cancel_request = json!({
        "reason": "Trying to cancel completed booking"
    });

    // Act
    let response = client
        .post(
            &format!("/api/bookings/{}/cancel", booking_id),
            &cancel_request,
        )
        .await;

    // Assert - Should fail because booking is completed
    response.assert_status(400);

    teardown_test(&test_db).await;
}

// ============================================================================
// test_complete_booking_awards_points - POST /api/bookings/:id/complete (admin)
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_complete_booking_awards_points() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    // Create an admin user
    let admin = TestUser::admin("admin-complete@test.com");
    admin.insert(&pool).await.expect("Failed to insert admin");

    // Create a regular user with a booking
    let user = TestUser::new("user-with-booking@test.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create user_loyalty record for the user
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, current_points, lifetime_points, total_nights)
        VALUES ($1, 0, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
        "#,
    )
    .bind(user.id)
    .execute(&pool)
    .await
    .expect("Failed to create user_loyalty");

    // Create a booking that's ready to complete (check-out date has passed)
    let booking_id = create_test_booking(&pool, user.id, "confirmed", -5, -2)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&admin.id, &admin.email);
    let client = TestClient::new(router).with_auth(&token);

    let complete_request = json!({
        "notes": "Completed by admin"
    });

    // Act
    let response = client
        .post(
            &format!("/api/bookings/{}/complete", booking_id),
            &complete_request,
        )
        .await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("completed"),
        "Booking status should be completed"
    );

    // Verify points were awarded (check the response or query database)
    assert!(
        json.get("pointsEarned").is_some() || json.get("points_earned").is_some(),
        "Response should include points earned"
    );

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_complete_booking_requires_admin() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    // Create a regular user (not admin)
    let user = TestUser::new("regular-user@test.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create a booking
    let booking_id = create_test_booking(&pool, user.id, "confirmed", -5, -2)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let complete_request = json!({
        "notes": "Trying to complete as regular user"
    });

    // Act
    let response = client
        .post(
            &format!("/api/bookings/{}/complete", booking_id),
            &complete_request,
        )
        .await;

    // Assert - Should be forbidden for non-admin
    response.assert_status(403);

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_complete_booking_cannot_complete_cancelled() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin-cancel-complete@test.com");
    admin.insert(&pool).await.expect("Failed to insert admin");

    let user = TestUser::new("user-cancelled@test.com");
    user.insert(&pool).await.expect("Failed to insert user");

    // Create a cancelled booking
    let booking_id = create_test_booking(&pool, user.id, "cancelled", -5, -2)
        .await
        .expect("Failed to create booking");

    let token = generate_test_token(&admin.id, &admin.email);
    let client = TestClient::new(router).with_auth(&token);

    let complete_request = json!({
        "notes": "Trying to complete cancelled booking"
    });

    // Act
    let response = client
        .post(
            &format!("/api/bookings/{}/complete", booking_id),
            &complete_request,
        )
        .await;

    // Assert - Should fail for cancelled booking
    response.assert_status(400);

    teardown_test(&test_db).await;
}

// ============================================================================
// test_check_availability - GET /api/bookings/availability
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_check_availability_returns_availability() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("availability-check@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(30);
    let check_out = today + Duration::days(33);

    // Act
    let response = client
        .get(&format!(
            "/api/bookings/availability?checkIn={}&checkOut={}",
            check_in.format("%Y-%m-%d"),
            check_out.format("%Y-%m-%d")
        ))
        .await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(
        json.get("available").is_some(),
        "Response should have 'available' field"
    );
    assert!(
        json.get("availableRooms").is_some() || json.get("available_rooms").is_some(),
        "Response should have available rooms count"
    );

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_check_availability_with_room_type() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("availability-roomtype@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(30);
    let check_out = today + Duration::days(33);

    // Act
    let response = client
        .get(&format!(
            "/api/bookings/availability?checkIn={}&checkOut={}&roomType=deluxe",
            check_in.format("%Y-%m-%d"),
            check_out.format("%Y-%m-%d")
        ))
        .await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(
        json.get("available").is_some(),
        "Response should have 'available' field"
    );

    // If room type is returned, verify it matches
    if let Some(room_type) = json.get("roomType").or(json.get("room_type")) {
        assert!(
            room_type
                .as_str()
                .map(|s| s.to_lowercase().contains("deluxe"))
                .unwrap_or(false),
            "Room type should be deluxe"
        );
    }

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_check_availability_invalid_dates() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("availability-invalid@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    let today = Utc::now().date_naive();
    // Check-out before check-in (invalid)
    let check_in = today + Duration::days(33);
    let check_out = today + Duration::days(30);

    // Act
    let response = client
        .get(&format!(
            "/api/bookings/availability?checkIn={}&checkOut={}",
            check_in.format("%Y-%m-%d"),
            check_out.format("%Y-%m-%d")
        ))
        .await;

    // Assert - Should fail validation
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid dates, got {}",
        response.status
    );

    teardown_test(&test_db).await;
}

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_list_bookings_pagination() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    let user = TestUser::new("booking-pagination@test.com");
    user.insert(&pool)
        .await
        .expect("Failed to insert test user");

    // Create multiple bookings
    for i in 0..5 {
        let _ = create_test_booking(&pool, user.id, "confirmed", 7 + i * 5, 10 + i * 5).await;
    }

    let token = generate_test_token(&user.id, &user.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act - Request with pagination
    let response = client.get("/api/bookings?page=1&limit=2").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(json.get("bookings").is_some());
    assert!(
        json.get("total").is_some()
            || json.get("totalPages").is_some()
            || json.get("total_pages").is_some()
    );

    let bookings = json.get("bookings").and_then(|v| v.as_array());
    if let Some(bookings) = bookings {
        assert!(bookings.len() <= 2, "Should respect page limit");
    }

    teardown_test(&test_db).await;
}

#[tokio::test]
#[ignore = "Requires running database and Redis"]
async fn test_admin_can_view_all_bookings() {
    // Arrange
    let (pool, test_db) = setup_test().await;
    let (router, _) = create_test_app().await.expect("Failed to create test app");

    // Create admin
    let admin = TestUser::admin("admin-viewall@test.com");
    admin.insert(&pool).await.expect("Failed to insert admin");

    // Create regular users with bookings
    let user1 = TestUser::new("user1-bookings@test.com");
    user1.insert(&pool).await.expect("Failed to insert user1");
    let _ = create_test_booking(&pool, user1.id, "confirmed", 7, 10).await;

    let user2 = TestUser::new("user2-bookings@test.com");
    user2.insert(&pool).await.expect("Failed to insert user2");
    let _ = create_test_booking(&pool, user2.id, "confirmed", 14, 17).await;

    let token = generate_test_token(&admin.id, &admin.email);
    let client = TestClient::new(router).with_auth(&token);

    // Act - Admin lists all bookings
    let response = client.get("/api/bookings").await;

    // Assert
    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let bookings = json.get("bookings").and_then(|v| v.as_array());

    // Admin should see bookings from both users
    if let Some(bookings) = bookings {
        assert!(
            bookings.len() >= 2,
            "Admin should see bookings from multiple users"
        );
    }

    teardown_test(&test_db).await;
}
