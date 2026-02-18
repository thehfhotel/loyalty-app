//! Booking endpoint integration tests
//!
//! Tests for the /api/bookings endpoints including:
//! - Listing bookings
//! - Creating bookings
//! - Getting booking details
//! - Cancelling bookings
//! - Completing bookings (admin)
//! - Checking room availability

use chrono::{Duration, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Test Setup
// ============================================================================

/// Create a test booking in the database.
/// Tables (room_types, rooms, bookings) already exist from migration.
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
async fn test_list_bookings_returns_user_bookings() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-list@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let _ = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");
    let _ = create_test_booking(app.db(), user.id, "confirmed", 14, 17)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/bookings").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(
        json.get("bookings").is_some(),
        "Response should have 'bookings' field"
    );

    let bookings = json.get("bookings").and_then(|v| v.as_array());
    assert!(bookings.is_some(), "Bookings should be an array");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_list_bookings_requires_authentication() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let response = client.get("/api/bookings").await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_list_bookings_with_status_filter() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-filter@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let _ = create_test_booking(app.db(), user.id, "confirmed", 7, 10).await;
    let _ = create_test_booking(app.db(), user.id, "cancelled", 14, 17).await;

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/bookings?status=confirmed").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let bookings = json.get("bookings").and_then(|v| v.as_array()).unwrap();

    for booking in bookings {
        assert_eq!(
            booking.get("status").and_then(|v| v.as_str()),
            Some("confirmed"),
            "All bookings should have confirmed status"
        );
    }

    app.cleanup().await.ok();
}

// ============================================================================
// test_create_booking - POST /api/bookings
// ============================================================================

#[tokio::test]
async fn test_create_booking_success() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-create@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

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

    let response = client.post("/api/bookings", &booking_request).await;

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

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_create_booking_invalid_dates() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-invalid@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

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

    let response = client.post("/api/bookings", &booking_request).await;

    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid dates, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_create_booking_past_date() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-past@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

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

    let response = client.post("/api/bookings", &booking_request).await;

    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for past check-in date, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

// ============================================================================
// test_get_booking - GET /api/bookings/:id
// ============================================================================

#[tokio::test]
async fn test_get_booking_returns_details() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-get@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get(&format!("/api/bookings/{}", booking_id)).await;

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

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_booking_not_found() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-notfound@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let fake_id = Uuid::new_v4();
    let response = client.get(&format!("/api/bookings/{}", fake_id)).await;

    response.assert_status(404);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_get_booking_forbidden_for_other_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let owner = TestUser::new("booking-owner@test.com");
    owner
        .insert(app.db())
        .await
        .expect("Failed to insert owner");

    let other_user = TestUser::new("other-user@test.com");
    other_user
        .insert(app.db())
        .await
        .expect("Failed to insert other user");

    let booking_id = create_test_booking(app.db(), owner.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    // Authenticate as the OTHER user (not the owner)
    let client = app.authenticated_client(&other_user.id, &other_user.email);

    let response = client.get(&format!("/api/bookings/{}", booking_id)).await;

    response.assert_status(403);

    app.cleanup().await.ok();
}

// ============================================================================
// test_cancel_booking - POST /api/bookings/:id/cancel
// ============================================================================

#[tokio::test]
async fn test_cancel_booking_success() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-cancel@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let cancel_request = json!({
        "reason": "Change of plans"
    });

    let response = client
        .post(
            &format!("/api/bookings/{}/cancel", booking_id),
            &cancel_request,
        )
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("cancelled"),
        "Booking status should be cancelled"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_cancel_booking_already_cancelled() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-double-cancel@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "cancelled", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let cancel_request = json!({
        "reason": "Trying to cancel again"
    });

    let response = client
        .post(
            &format!("/api/bookings/{}/cancel", booking_id),
            &cancel_request,
        )
        .await;

    response.assert_status(400);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_cancel_booking_completed_fails() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-cancel-completed@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "completed", -10, -7)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let cancel_request = json!({
        "reason": "Trying to cancel completed booking"
    });

    let response = client
        .post(
            &format!("/api/bookings/{}/cancel", booking_id),
            &cancel_request,
        )
        .await;

    response.assert_status(400);

    app.cleanup().await.ok();
}

// ============================================================================
// test_complete_booking_awards_points - POST /api/bookings/:id/complete (admin)
// ============================================================================

#[tokio::test]
async fn test_complete_booking_awards_points() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin-complete@test.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin");

    let user = TestUser::new("user-with-booking@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert user");

    // Create user_loyalty record for the user
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, current_points, lifetime_points, total_nights)
        VALUES ($1, 0, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
        "#,
    )
    .bind(user.id)
    .execute(app.db())
    .await
    .expect("Failed to create user_loyalty");

    // Create a booking that's ready to complete (check-out date has passed)
    let booking_id = create_test_booking(app.db(), user.id, "confirmed", -5, -2)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let complete_request = json!({
        "notes": "Completed by admin"
    });

    let response = client
        .post(
            &format!("/api/bookings/{}/complete", booking_id),
            &complete_request,
        )
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert_eq!(
        json.get("status").and_then(|v| v.as_str()),
        Some("completed"),
        "Booking status should be completed"
    );

    assert!(
        json.get("pointsEarned").is_some() || json.get("points_earned").is_some(),
        "Response should include points earned"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_complete_booking_requires_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("regular-user@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", -5, -2)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let complete_request = json!({
        "notes": "Trying to complete as regular user"
    });

    let response = client
        .post(
            &format!("/api/bookings/{}/complete", booking_id),
            &complete_request,
        )
        .await;

    response.assert_status(403);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_complete_booking_cannot_complete_cancelled() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin-cancel-complete@test.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin");

    let user = TestUser::new("user-cancelled@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert user");

    let booking_id = create_test_booking(app.db(), user.id, "cancelled", -5, -2)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let complete_request = json!({
        "notes": "Trying to complete cancelled booking"
    });

    let response = client
        .post(
            &format!("/api/bookings/{}/complete", booking_id),
            &complete_request,
        )
        .await;

    response.assert_status(400);

    app.cleanup().await.ok();
}

// ============================================================================
// test_check_availability - GET /api/bookings/availability
// ============================================================================

#[tokio::test]
async fn test_check_availability_returns_availability() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("availability-check@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(30);
    let check_out = today + Duration::days(33);

    let response = client
        .get(&format!(
            "/api/bookings/availability?checkIn={}&checkOut={}",
            check_in.format("%Y-%m-%d"),
            check_out.format("%Y-%m-%d")
        ))
        .await;

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

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_check_availability_with_room_type() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("availability-roomtype@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(30);
    let check_out = today + Duration::days(33);

    let response = client
        .get(&format!(
            "/api/bookings/availability?checkIn={}&checkOut={}&roomType=deluxe",
            check_in.format("%Y-%m-%d"),
            check_out.format("%Y-%m-%d")
        ))
        .await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(
        json.get("available").is_some(),
        "Response should have 'available' field"
    );

    if let Some(room_type) = json.get("roomType").or(json.get("room_type")) {
        assert!(
            room_type
                .as_str()
                .map(|s| s.to_lowercase().contains("deluxe"))
                .unwrap_or(false),
            "Room type should be deluxe"
        );
    }

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_check_availability_invalid_dates() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("availability-invalid@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let today = Utc::now().date_naive();
    // Check-out before check-in (invalid)
    let check_in = today + Duration::days(33);
    let check_out = today + Duration::days(30);

    let response = client
        .get(&format!(
            "/api/bookings/availability?checkIn={}&checkOut={}",
            check_in.format("%Y-%m-%d"),
            check_out.format("%Y-%m-%d")
        ))
        .await;

    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid dates, got {}",
        response.status
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

#[tokio::test]
async fn test_list_bookings_pagination() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("booking-pagination@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    for i in 0..5 {
        let _ = create_test_booking(app.db(), user.id, "confirmed", 7 + i * 5, 10 + i * 5).await;
    }

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client.get("/api/bookings?page=1&limit=2").await;

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

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_admin_can_view_all_bookings() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("admin-viewall@test.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin");

    let user1 = TestUser::new("user1-bookings@test.com");
    user1
        .insert(app.db())
        .await
        .expect("Failed to insert user1");
    let _ = create_test_booking(app.db(), user1.id, "confirmed", 7, 10).await;

    let user2 = TestUser::new("user2-bookings@test.com");
    user2
        .insert(app.db())
        .await
        .expect("Failed to insert user2");
    let _ = create_test_booking(app.db(), user2.id, "confirmed", 14, 17).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let response = client.get("/api/bookings").await;

    response.assert_status(200);

    let json: Value = response.json().expect("Response should be valid JSON");
    let bookings = json.get("bookings").and_then(|v| v.as_array());

    if let Some(bookings) = bookings {
        assert!(
            bookings.len() >= 2,
            "Admin should see bookings from multiple users"
        );
    }

    app.cleanup().await.ok();
}
