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
    let today = Utc::now().date_naive();
    let check_in = today + Duration::days(check_in_offset_days);
    let check_out = today + Duration::days(check_out_offset_days);

    // Get or create the test room type (unique index is on LOWER(name))
    let room_type_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM room_types WHERE LOWER(name) = LOWER('Deluxe Room')",
    )
    .fetch_optional(pool)
    .await?
    {
        Some(id) => id,
        None => {
            sqlx::query_scalar(
                r#"
                INSERT INTO room_types (id, name, price_per_night, max_guests)
                VALUES ($1, 'Deluxe Room', 2000.00, 2)
                RETURNING id
                "#,
            )
            .bind(Uuid::new_v4())
            .fetch_one(pool)
            .await?
        },
    };

    // Get or create the test room
    let room_id: Uuid =
        match sqlx::query_scalar::<_, Uuid>("SELECT id FROM rooms WHERE room_number = '101'")
            .fetch_optional(pool)
            .await?
        {
            Some(id) => id,
            None => {
                sqlx::query_scalar(
                    r#"
                INSERT INTO rooms (id, room_type_id, room_number, floor)
                VALUES ($1, $2, '101', 1)
                RETURNING id
                "#,
                )
                .bind(Uuid::new_v4())
                .bind(room_type_id)
                .fetch_one(pool)
                .await?
            },
        };

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

    // Seed a Deluxe room type and room so the booking can be created
    let room_type_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO room_types (id, name, price_per_night, max_guests, is_active)
        VALUES ($1, 'Deluxe', 2000.00, 2, true)
        "#,
    )
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room type");

    sqlx::query(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor, is_active)
        VALUES ($1, $2, '501', 5, true)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room");

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

/// Two concurrent booking requests for overlapping dates against the
/// same single-room inventory must result in exactly one success and
/// one conflict. This demonstrates the fix for the TOCTOU race in
/// `insert_booking` described in `docs/audits/correctness-2026-05-13.md`
/// (Correctness CRITICAL #2): on the pre-fix code both POSTs would
/// observe the room as free and both INSERT, producing two confirmed
/// bookings on the same room for the same dates.
#[tokio::test]
async fn test_create_booking_concurrent_overlap_yields_one_conflict() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user_a = TestUser::new("booking-race-a@test.com");
    user_a
        .insert(app.db())
        .await
        .expect("Failed to insert user a");
    let user_b = TestUser::new("booking-race-b@test.com");
    user_b
        .insert(app.db())
        .await
        .expect("Failed to insert user b");

    // Seed exactly one room of the requested type so two overlapping
    // requests cannot both succeed for legitimate inventory reasons.
    let room_type_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO room_types (id, name, price_per_night, max_guests, is_active)
        VALUES ($1, 'Deluxe', 2000.00, 2, true)
        "#,
    )
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room type");

    sqlx::query(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor, is_active)
        VALUES ($1, $2, '777', 7, true)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room");

    let today = chrono::Utc::now().date_naive();
    let check_in = today + chrono::Duration::days(14);
    let check_out = today + chrono::Duration::days(17);

    let body = json!({
        "checkIn": check_in.format("%Y-%m-%d").to_string(),
        "checkOut": check_out.format("%Y-%m-%d").to_string(),
        "roomType": "deluxe",
        "guests": 2,
    });

    let client_a = app.authenticated_client(&user_a.id, &user_a.email);
    let client_b = app.authenticated_client(&user_b.id, &user_b.email);

    let body_a = body.clone();
    let body_b = body.clone();
    let (response_a, response_b) = tokio::join!(
        client_a.post("/api/bookings", &body_a),
        client_b.post("/api/bookings", &body_b),
    );

    let statuses = [response_a.status, response_b.status];
    let successes = statuses.iter().filter(|s| **s == 200 || **s == 201).count();
    let conflicts = statuses
        .iter()
        .filter(|s| **s == 400 || **s == 409)
        .count();

    assert_eq!(
        successes, 1,
        "Exactly one concurrent booking should succeed. statuses: {:?}, bodies: [{}, {}]",
        statuses, response_a.body, response_b.body
    );
    assert_eq!(
        conflicts, 1,
        "Exactly one concurrent booking should fail with 4xx. statuses: {:?}",
        statuses
    );

    // The database must hold exactly one confirmed booking row for this room/date.
    let row_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM bookings
        WHERE check_in_date = $1
          AND check_out_date = $2
          AND status = 'confirmed'
        "#,
    )
    .bind(check_in)
    .bind(check_out)
    .fetch_one(app.db())
    .await
    .expect("Failed to count bookings");
    assert_eq!(
        row_count.0, 1,
        "Exactly one confirmed booking row should exist for the contested dates"
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
    user.insert(app.db()).await.expect("Failed to insert user");

    // Create user_loyalty record for the user
    sqlx::query(
        r#"
        INSERT INTO user_loyalty (user_id, current_points, total_nights)
        VALUES ($1, 0, 0)
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
    assert!(
        matches!(
            json.get("status").and_then(|v| v.as_str()),
            Some("completed") | Some("checked_out")
        ),
        "Booking status should be completed or checked_out, got: {:?}",
        json.get("status")
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
    user.insert(app.db()).await.expect("Failed to insert user");

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
    user.insert(app.db()).await.expect("Failed to insert user");

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

    // Seed room_types and rooms so the availability query has data
    let room_type_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO room_types (id, name, price_per_night, max_guests, is_active)
        VALUES ($1, 'Standard Room', 1500.00, 2, true)
        "#,
    )
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room type");

    sqlx::query(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor, is_active)
        VALUES ($1, $2, '201', 2, true)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room");

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

    // Seed a Deluxe room type and room so the availability query has data
    let room_type_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO room_types (id, name, price_per_night, max_guests, is_active)
        VALUES ($1, 'Deluxe', 2500.00, 2, true)
        "#,
    )
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room type");

    sqlx::query(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor, is_active)
        VALUES ($1, $2, '301', 3, true)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .execute(app.db())
    .await
    .expect("Failed to insert room");

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

// ============================================================================
// test_add_booking_slip - POST /api/bookings/:id/slips
// ============================================================================

/// Two POSTs with the same `Idempotency-Key` must produce only one
/// `booking_slips` row. Demonstrates the fix for the audit's
/// HIGH-#5 finding: prior to this commit a network retry would
/// attach the same slip twice and burn through SlipOK verification
/// quota for nothing.
#[tokio::test]
async fn test_add_booking_slip_idempotent_on_same_key() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("slip-idem@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);
    let key = Uuid::new_v4().to_string();
    let body = json!({ "slipUrl": "/storage/slips/idem-1.jpg" });

    let response_a = client
        .post_with_headers(
            &format!("/api/bookings/{}/slips", booking_id),
            &body,
            &[("Idempotency-Key", key.as_str())],
        )
        .await;
    assert!(
        response_a.status == 201 || response_a.status == 200,
        "First call should succeed. status: {}, body: {}",
        response_a.status,
        response_a.body
    );

    let response_b = client
        .post_with_headers(
            &format!("/api/bookings/{}/slips", booking_id),
            &body,
            &[("Idempotency-Key", key.as_str())],
        )
        .await;
    assert!(
        response_b.status == 201 || response_b.status == 200,
        "Retry with same key should replay successfully. status: {}, body: {}",
        response_b.status,
        response_b.body
    );

    // Both responses must reference the same slip id — the second one
    // is a replay of the first, not a new insert.
    let json_a: Value = response_a.json().expect("Response A should be valid JSON");
    let json_b: Value = response_b.json().expect("Response B should be valid JSON");
    assert_eq!(
        json_a.get("id"),
        json_b.get("id"),
        "Replayed response must reference the original slip id"
    );

    // Confirm at the DB level that we wrote exactly one row.
    let row_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM booking_slips WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(app.db())
            .await
            .expect("Failed to count slips");
    assert_eq!(
        row_count.0, 1,
        "Exactly one slip row should exist; the second request must be a replay"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_add_booking_slip_success() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("slip-add-success@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let body = json!({
        "slipUrl": "/storage/slips/test-slip-1.jpg",
    });

    let response = client
        .post(&format!("/api/bookings/{}/slips", booking_id), &body)
        .await;

    assert!(
        response.status == 201 || response.status == 200,
        "Expected 201 or 200, got {}. Body: {}",
        response.status,
        response.body
    );

    let json: Value = response.json().expect("Response should be valid JSON");
    assert!(json.get("id").is_some(), "Response should include slip id");
    assert_eq!(
        json.get("slipUrl").and_then(|v| v.as_str()),
        Some("/storage/slips/test-slip-1.jpg"),
        "Response should echo the submitted slip URL"
    );
    assert_eq!(
        json.get("bookingId").and_then(|v| v.as_str()),
        Some(booking_id.to_string()).as_deref(),
        "Response should reference the correct booking"
    );
    assert!(
        json.get("uploadedAt").is_some(),
        "Response should include uploaded_at timestamp"
    );

    // Verify the row was actually persisted.
    let row_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM booking_slips WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(app.db())
            .await
            .expect("Failed to count slips");
    assert_eq!(row_count.0, 1, "Exactly one slip row should be persisted");

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_add_booking_slip_requires_authentication() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let fake_booking_id = Uuid::new_v4();
    let body = json!({ "slipUrl": "/storage/slips/anon.jpg" });

    let response = client
        .post(&format!("/api/bookings/{}/slips", fake_booking_id), &body)
        .await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_add_booking_slip_forbidden_for_other_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let owner = TestUser::new("slip-owner@test.com");
    owner
        .insert(app.db())
        .await
        .expect("Failed to insert owner");

    let intruder = TestUser::new("slip-intruder@test.com");
    intruder
        .insert(app.db())
        .await
        .expect("Failed to insert other user");

    let booking_id = create_test_booking(app.db(), owner.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    // Authenticated as the OTHER user, not the owner.
    let client = app.authenticated_client(&intruder.id, &intruder.email);

    let body = json!({ "slipUrl": "/storage/slips/intruder.jpg" });
    let response = client
        .post(&format!("/api/bookings/{}/slips", booking_id), &body)
        .await;

    response.assert_status(403);

    // And nothing should have been written.
    let row_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM booking_slips WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(app.db())
            .await
            .expect("Failed to count slips");
    assert_eq!(
        row_count.0, 0,
        "No slip should be persisted when authorization fails"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_add_booking_slip_not_found_for_missing_booking() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("slip-missing-booking@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let fake_booking_id = Uuid::new_v4();
    let body = json!({ "slipUrl": "/storage/slips/ghost.jpg" });
    let response = client
        .post(&format!("/api/bookings/{}/slips", fake_booking_id), &body)
        .await;

    response.assert_status(404);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_add_booking_slip_admin_can_add_for_other_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("slip-admin@test.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin");

    let user = TestUser::new("slip-customer@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert customer");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let body = json!({ "slipUrl": "/storage/slips/admin-attached.jpg" });
    let response = client
        .post(&format!("/api/bookings/{}/slips", booking_id), &body)
        .await;

    assert!(
        response.status == 201 || response.status == 200,
        "Admin should be allowed to attach slips. Got {}. Body: {}",
        response.status,
        response.body
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_add_booking_slip_rejects_empty_url() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("slip-empty-url@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let client = app.authenticated_client(&user.id, &user.email);

    let body = json!({ "slipUrl": "" });
    let response = client
        .post(&format!("/api/bookings/{}/slips", booking_id), &body)
        .await;

    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400/422 for empty slipUrl, got {}. Body: {}",
        response.status,
        response.body
    );

    app.cleanup().await.ok();
}

// ============================================================================
// test_delete_booking_slip - DELETE /api/bookings/slips/:slip_id
// ============================================================================

/// Insert a slip row directly via SQL and return its id.
///
/// We use raw SQL (rather than going through `POST /api/bookings/:id/slips`)
/// so each test can seed exactly the slip it needs without coupling the
/// delete-path tests to the upload path.
async fn insert_test_slip(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    uploaded_by: Uuid,
    slip_url: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        INSERT INTO booking_slips (booking_id, slip_url, uploaded_by)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
    )
    .bind(booking_id)
    .bind(slip_url)
    .bind(uploaded_by)
    .fetch_one(pool)
    .await
}

#[tokio::test]
async fn test_delete_booking_slip_success() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("slip-delete-owner@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let booking_id = create_test_booking(app.db(), user.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let slip_id = insert_test_slip(
        app.db(),
        booking_id,
        user.id,
        "/storage/slips/owner-delete.jpg",
    )
    .await
    .expect("Failed to insert test slip");

    let client = app.authenticated_client(&user.id, &user.email);

    let response = client
        .delete(&format!("/api/bookings/slips/{}", slip_id))
        .await;

    response.assert_status(204);

    // Verify the row is gone.
    let row_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_one(app.db())
        .await
        .expect("Failed to count slips");
    assert_eq!(
        row_count.0, 0,
        "Slip row should be deleted from the database"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_booking_slip_requires_authentication() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let client = app.client();

    let fake_slip_id = Uuid::new_v4();
    let response = client
        .delete(&format!("/api/bookings/slips/{}", fake_slip_id))
        .await;

    response.assert_status(401);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_booking_slip_forbidden_for_other_user() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let owner = TestUser::new("slip-delete-owner-other@test.com");
    owner
        .insert(app.db())
        .await
        .expect("Failed to insert owner");

    let intruder = TestUser::new("slip-delete-intruder@test.com");
    intruder
        .insert(app.db())
        .await
        .expect("Failed to insert intruder");

    let booking_id = create_test_booking(app.db(), owner.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let slip_id = insert_test_slip(
        app.db(),
        booking_id,
        owner.id,
        "/storage/slips/owner-protected.jpg",
    )
    .await
    .expect("Failed to insert test slip");

    // Authenticated as the OTHER (non-admin) user.
    let client = app.authenticated_client(&intruder.id, &intruder.email);

    let response = client
        .delete(&format!("/api/bookings/slips/{}", slip_id))
        .await;

    response.assert_status(403);

    // Row must still exist — authorization failure must not delete anything.
    let row_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_one(app.db())
        .await
        .expect("Failed to count slips");
    assert_eq!(
        row_count.0, 1,
        "Slip row should still exist when authorization fails"
    );

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_booking_slip_not_found_for_missing_slip() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let user = TestUser::new("slip-delete-missing@test.com");
    user.insert(app.db())
        .await
        .expect("Failed to insert test user");

    let client = app.authenticated_client(&user.id, &user.email);

    let fake_slip_id = Uuid::new_v4();
    let response = client
        .delete(&format!("/api/bookings/slips/{}", fake_slip_id))
        .await;

    response.assert_status(404);

    app.cleanup().await.ok();
}

#[tokio::test]
async fn test_delete_booking_slip_admin_can_delete_other_users_slip() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = TestUser::admin("slip-delete-admin@test.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin");

    let owner = TestUser::new("slip-delete-customer@test.com");
    owner
        .insert(app.db())
        .await
        .expect("Failed to insert customer");

    let booking_id = create_test_booking(app.db(), owner.id, "confirmed", 7, 10)
        .await
        .expect("Failed to create booking");

    let slip_id = insert_test_slip(
        app.db(),
        booking_id,
        owner.id,
        "/storage/slips/admin-removed.jpg",
    )
    .await
    .expect("Failed to insert test slip");

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let response = client
        .delete(&format!("/api/bookings/slips/{}", slip_id))
        .await;

    response.assert_status(204);

    // Verify the row is gone.
    let row_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_one(app.db())
        .await
        .expect("Failed to count slips");
    assert_eq!(
        row_count.0, 0,
        "Admin should be able to delete another user's slip"
    );

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
