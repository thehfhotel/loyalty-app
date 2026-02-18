//! Booking routes
//!
//! Provides endpoints for hotel room booking management including
//! listing, creating, updating, and cancelling bookings.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::models::booking::{BookingResponse, BookingStatus, RoomType};
use crate::state::AppState;

// ==================== REQUEST/RESPONSE TYPES ====================

/// Pagination query parameters
#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    #[serde(default = "default_page")]
    pub page: i32,
    #[serde(default = "default_limit")]
    pub limit: i32,
    pub status: Option<String>,
}

impl Default for PaginationQuery {
    fn default() -> Self {
        Self {
            page: default_page(),
            limit: default_limit(),
            status: None,
        }
    }
}

fn default_page() -> i32 {
    1
}

fn default_limit() -> i32 {
    20
}

/// Availability check query parameters
#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityQuery {
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub room_type: Option<String>,
}

/// Create booking request
#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateBookingRequest {
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub room_type: Option<String>,
    #[validate(range(min = 1, message = "At least 1 guest required"))]
    pub guests: i32,
    pub special_requests: Option<String>,
}

/// Update booking request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookingRequest {
    pub check_in: Option<NaiveDate>,
    pub check_out: Option<NaiveDate>,
    pub room_type: Option<String>,
    pub guests: Option<i32>,
    pub special_requests: Option<String>,
}

/// Cancel booking request
#[derive(Debug, Deserialize)]
pub struct CancelBookingRequest {
    pub reason: Option<String>,
}

/// Complete booking request (admin only)
#[derive(Debug, Deserialize)]
pub struct CompleteBookingRequest {
    pub notes: Option<String>,
}

/// Paginated booking list response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingListResponse {
    pub bookings: Vec<BookingResponse>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

/// Room availability response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityResponse {
    pub available: bool,
    pub room_type: Option<String>,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub available_rooms: i32,
    pub price_per_night: Option<Decimal>,
    pub total_price: Option<Decimal>,
}

/// Success response for operations
#[derive(Debug, Serialize)]
pub struct SuccessResponse {
    pub success: bool,
    pub message: String,
}

// ==================== ROUTE HANDLERS ====================

/// GET /api/bookings - List user's bookings (admin sees all)
///
/// Query parameters:
/// - page: Page number (default: 1)
/// - limit: Items per page (default: 20, max: 100)
/// - status: Filter by status (confirmed, cancelled, completed)
async fn list_bookings(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<PaginationQuery>,
) -> AppResult<Json<BookingListResponse>> {
    let page = params.page.max(1);
    let limit = params.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    // Validate status if provided
    if let Some(ref status) = params.status {
        let valid_statuses = ["confirmed", "cancelled", "completed"];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid status '{}'. Valid values: {:?}",
                status, valid_statuses
            )));
        }
    }

    // Admin can see all bookings, regular users only see their own
    let is_admin = has_role(&auth_user, "admin");
    let user_id_filter = if is_admin {
        None
    } else {
        Some(
            Uuid::parse_str(&auth_user.id)
                .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?,
        )
    };

    // Query bookings from database
    let (bookings, total) = query_bookings(
        state.db(),
        user_id_filter,
        params.status.as_deref(),
        limit,
        offset,
    )
    .await?;

    let total_pages = ((total as f64) / (limit as f64)).ceil() as i32;

    Ok(Json(BookingListResponse {
        bookings,
        total,
        page,
        limit,
        total_pages,
    }))
}

/// GET /api/bookings/:id - Get booking details
///
/// Returns booking details. Users can only view their own bookings,
/// admins can view any booking.
async fn get_booking(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(booking_id): Path<Uuid>,
) -> AppResult<Json<BookingResponse>> {
    let booking = query_booking_by_id(state.db(), booking_id).await?;

    // Check ownership or admin role
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    if booking.user_id != user_id && !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden(
            "You can only view your own bookings".to_string(),
        ));
    }

    Ok(Json(booking))
}

/// POST /api/bookings - Create a new booking
///
/// Request body:
/// - checkIn: Check-in date (YYYY-MM-DD)
/// - checkOut: Check-out date (YYYY-MM-DD)
/// - roomType: Room type (standard, deluxe, suite, etc.)
/// - guests: Number of guests
/// - specialRequests: Optional special requests
async fn create_booking(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateBookingRequest>,
) -> AppResult<(StatusCode, Json<BookingResponse>)> {
    // Validate request
    req.validate()?;

    // Validate date range
    if req.check_out <= req.check_in {
        return Err(AppError::Validation(
            "Check-out date must be after check-in date".to_string(),
        ));
    }

    // Check-in must be today or in the future
    let today = Utc::now().date_naive();
    if req.check_in < today {
        return Err(AppError::Validation(
            "Check-in date cannot be in the past".to_string(),
        ));
    }

    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    // Parse room type if provided
    let room_type = req.room_type.as_deref().map(parse_room_type).transpose()?;

    // Create the booking
    let booking = insert_booking(
        state.db(),
        user_id,
        req.check_in,
        req.check_out,
        room_type,
        req.guests,
        req.special_requests,
    )
    .await?;

    tracing::info!(
        user_id = %auth_user.id,
        booking_id = %booking.id,
        "Booking created"
    );

    Ok((StatusCode::CREATED, Json(booking)))
}

/// PUT /api/bookings/:id - Update a booking
///
/// Users can only update their own bookings.
/// Admins can update any booking.
/// Cannot update cancelled or completed bookings.
async fn update_booking(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(booking_id): Path<Uuid>,
    Json(req): Json<UpdateBookingRequest>,
) -> AppResult<Json<BookingResponse>> {
    // Get existing booking
    let existing = query_booking_by_id(state.db(), booking_id).await?;

    // Check ownership or admin role
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    if existing.user_id != user_id && !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden(
            "You can only update your own bookings".to_string(),
        ));
    }

    // Cannot update cancelled or completed bookings
    if matches!(
        existing.status,
        BookingStatus::Cancelled | BookingStatus::CheckedOut
    ) {
        return Err(AppError::BadRequest(
            "Cannot update a cancelled or completed booking".to_string(),
        ));
    }

    // Validate dates if provided
    let check_in = req.check_in.unwrap_or(existing.check_in_date);
    let check_out = req.check_out.unwrap_or(existing.check_out_date);

    if check_out <= check_in {
        return Err(AppError::Validation(
            "Check-out date must be after check-in date".to_string(),
        ));
    }

    // Parse room type if provided
    let room_type = match &req.room_type {
        Some(rt) => Some(parse_room_type(rt)?),
        None => existing.room_type,
    };

    // Update the booking
    let updated = update_booking_in_db(
        state.db(),
        booking_id,
        check_in,
        check_out,
        room_type,
        req.guests.unwrap_or(existing.guest_count.unwrap_or(1)),
        req.special_requests.or(existing.special_requests),
    )
    .await?;

    tracing::info!(
        user_id = %auth_user.id,
        booking_id = %booking_id,
        "Booking updated"
    );

    Ok(Json(updated))
}

/// POST /api/bookings/:id/cancel - Cancel a booking
///
/// Users can only cancel their own bookings.
/// Admins can cancel any booking.
/// Cannot cancel already cancelled or completed bookings.
async fn cancel_booking(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(booking_id): Path<Uuid>,
    Json(req): Json<CancelBookingRequest>,
) -> AppResult<Json<BookingResponse>> {
    // Get existing booking
    let existing = query_booking_by_id(state.db(), booking_id).await?;

    // Check ownership or admin role
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    let is_admin = has_role(&auth_user, "admin");
    if existing.user_id != user_id && !is_admin {
        return Err(AppError::Forbidden(
            "You can only cancel your own bookings".to_string(),
        ));
    }

    // Cannot cancel already cancelled bookings
    if existing.status == BookingStatus::Cancelled {
        return Err(AppError::BadRequest(
            "Booking is already cancelled".to_string(),
        ));
    }

    // Cannot cancel completed bookings
    if existing.status == BookingStatus::CheckedOut {
        return Err(AppError::BadRequest(
            "Cannot cancel a completed booking".to_string(),
        ));
    }

    // Regular users cannot cancel after check-in date
    if !is_admin && existing.check_in_date <= Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Cannot cancel a booking after check-in date".to_string(),
        ));
    }

    // Cancel the booking
    let cancelled = cancel_booking_in_db(state.db(), booking_id, req.reason, is_admin).await?;

    tracing::info!(
        user_id = %auth_user.id,
        booking_id = %booking_id,
        admin_cancel = is_admin,
        "Booking cancelled"
    );

    Ok(Json(cancelled))
}

/// POST /api/bookings/:id/complete - Mark booking as completed (admin only)
///
/// Awards points and nights to the user.
async fn complete_booking(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(booking_id): Path<Uuid>,
    Json(_req): Json<CompleteBookingRequest>,
) -> AppResult<Json<BookingResponse>> {
    // Admin only endpoint
    if !has_role(&auth_user, "admin") {
        return Err(AppError::Forbidden(
            "Only administrators can mark bookings as completed".to_string(),
        ));
    }

    // Get existing booking
    let existing = query_booking_by_id(state.db(), booking_id).await?;

    // Can only complete confirmed or checked-in bookings
    if !matches!(
        existing.status,
        BookingStatus::Confirmed | BookingStatus::CheckedIn
    ) {
        return Err(AppError::BadRequest(format!(
            "Cannot complete a booking with status '{:?}'",
            existing.status
        )));
    }

    // Mark as completed and award points
    let completed = complete_booking_in_db(state.db(), booking_id).await?;

    // Award loyalty points (10 points per THB spent)
    let points_to_award = (completed
        .total_amount
        .to_string()
        .parse::<f64>()
        .unwrap_or(0.0)
        * 10.0) as i32;

    if points_to_award > 0 {
        award_loyalty_points(
            state.db(),
            completed.user_id,
            points_to_award,
            completed.nights_count,
            booking_id,
        )
        .await?;
    }

    tracing::info!(
        admin_id = %auth_user.id,
        booking_id = %booking_id,
        points_awarded = points_to_award,
        nights = completed.nights_count,
        "Booking completed"
    );

    Ok(Json(completed))
}

/// GET /api/bookings/availability - Check room availability
///
/// Query parameters:
/// - checkIn: Check-in date (YYYY-MM-DD)
/// - checkOut: Check-out date (YYYY-MM-DD)
/// - roomType: Optional room type filter
async fn check_availability(
    State(state): State<AppState>,
    Query(params): Query<AvailabilityQuery>,
) -> AppResult<Json<AvailabilityResponse>> {
    // Validate date range
    if params.check_out <= params.check_in {
        return Err(AppError::Validation(
            "Check-out date must be after check-in date".to_string(),
        ));
    }

    // Parse room type if provided
    let room_type = params
        .room_type
        .as_deref()
        .map(parse_room_type)
        .transpose()?;

    // Check availability in database
    let availability =
        check_room_availability(state.db(), params.check_in, params.check_out, room_type).await?;

    Ok(Json(availability))
}

// ==================== DATABASE ROW TYPES ====================

/// Database row for booking with room info
#[derive(Debug, FromRow)]
#[allow(dead_code)]
struct BookingRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub room_id: Uuid,
    pub room_type_id: Uuid,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub num_guests: i32,
    pub total_price: Decimal,
    pub points_earned: Option<i32>,
    pub status: String,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    // Joined fields
    pub room_number: Option<String>,
    pub room_type_name: Option<String>,
}

impl BookingRow {
    fn into_response(self) -> BookingResponse {
        let nights = (self.check_out_date - self.check_in_date).num_days() as i32;
        let room_type =
            self.room_type_name
                .as_deref()
                .and_then(|name| match name.to_lowercase().as_str() {
                    "standard" => Some(RoomType::Standard),
                    "deluxe" => Some(RoomType::Deluxe),
                    "suite" => Some(RoomType::Suite),
                    "executive" => Some(RoomType::Executive),
                    "presidential" => Some(RoomType::Presidential),
                    _ => None,
                });

        let status = match self.status.as_str() {
            "pending" => BookingStatus::Pending,
            "confirmed" => BookingStatus::Confirmed,
            "checked_in" => BookingStatus::CheckedIn,
            "checked_out" | "completed" => BookingStatus::CheckedOut,
            "cancelled" => BookingStatus::Cancelled,
            "no_show" => BookingStatus::NoShow,
            _ => BookingStatus::Confirmed,
        };

        BookingResponse {
            id: self.id,
            user_id: self.user_id,
            booking_reference: format!("BK{}", self.id.to_string()[..8].to_uppercase()),
            status,
            check_in_date: self.check_in_date,
            check_out_date: self.check_out_date,
            nights_count: nights,
            room_type,
            room_number: self.room_number,
            total_amount: self.total_price,
            currency: "THB".to_string(),
            guest_count: Some(self.num_guests),
            special_requests: self.notes,
            confirmation_number: Some(format!("CNF{}", self.id.to_string()[..12].to_uppercase())),
            points_earned: self.points_earned,
            points_redeemed: None,
            created_at: self.created_at,
        }
    }
}

/// Room type row for availability check
#[derive(Debug, FromRow)]
struct RoomTypeRow {
    pub id: Uuid,
    pub name: String,
    pub price_per_night: Decimal,
}

// ==================== DATABASE OPERATIONS ====================

async fn query_bookings(
    db: &PgPool,
    user_id: Option<Uuid>,
    status: Option<&str>,
    limit: i32,
    offset: i32,
) -> AppResult<(Vec<BookingResponse>, i64)> {
    // Build query dynamically based on filters
    let (bookings, total) = if let Some(uid) = user_id {
        // User-specific query
        if let Some(st) = status {
            let total: (i64,) =
                sqlx::query_as("SELECT COUNT(*) FROM bookings WHERE user_id = $1 AND status = $2")
                    .bind(uid)
                    .bind(st)
                    .fetch_one(db)
                    .await?;

            let rows: Vec<BookingRow> = sqlx::query_as(
                r#"
                SELECT
                    b.id, b.user_id, b.room_id, b.room_type_id,
                    b.check_in_date, b.check_out_date, b.num_guests,
                    b.total_price, b.points_earned, b.status,
                    b.cancelled_at, b.cancellation_reason, b.notes,
                    b.created_at, b.updated_at,
                    r.room_number, rt.name as room_type_name
                FROM bookings b
                LEFT JOIN rooms r ON b.room_id = r.id
                LEFT JOIN room_types rt ON b.room_type_id = rt.id
                WHERE b.user_id = $1 AND b.status = $2
                ORDER BY b.created_at DESC
                LIMIT $3 OFFSET $4
                "#,
            )
            .bind(uid)
            .bind(st)
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

            (rows, total.0)
        } else {
            let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM bookings WHERE user_id = $1")
                .bind(uid)
                .fetch_one(db)
                .await?;

            let rows: Vec<BookingRow> = sqlx::query_as(
                r#"
                SELECT
                    b.id, b.user_id, b.room_id, b.room_type_id,
                    b.check_in_date, b.check_out_date, b.num_guests,
                    b.total_price, b.points_earned, b.status,
                    b.cancelled_at, b.cancellation_reason, b.notes,
                    b.created_at, b.updated_at,
                    r.room_number, rt.name as room_type_name
                FROM bookings b
                LEFT JOIN rooms r ON b.room_id = r.id
                LEFT JOIN room_types rt ON b.room_type_id = rt.id
                WHERE b.user_id = $1
                ORDER BY b.created_at DESC
                LIMIT $2 OFFSET $3
                "#,
            )
            .bind(uid)
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

            (rows, total.0)
        }
    } else {
        // Admin query - all bookings
        if let Some(st) = status {
            let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM bookings WHERE status = $1")
                .bind(st)
                .fetch_one(db)
                .await?;

            let rows: Vec<BookingRow> = sqlx::query_as(
                r#"
                SELECT
                    b.id, b.user_id, b.room_id, b.room_type_id,
                    b.check_in_date, b.check_out_date, b.num_guests,
                    b.total_price, b.points_earned, b.status,
                    b.cancelled_at, b.cancellation_reason, b.notes,
                    b.created_at, b.updated_at,
                    r.room_number, rt.name as room_type_name
                FROM bookings b
                LEFT JOIN rooms r ON b.room_id = r.id
                LEFT JOIN room_types rt ON b.room_type_id = rt.id
                WHERE b.status = $1
                ORDER BY b.created_at DESC
                LIMIT $2 OFFSET $3
                "#,
            )
            .bind(st)
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

            (rows, total.0)
        } else {
            let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM bookings")
                .fetch_one(db)
                .await?;

            let rows: Vec<BookingRow> = sqlx::query_as(
                r#"
                SELECT
                    b.id, b.user_id, b.room_id, b.room_type_id,
                    b.check_in_date, b.check_out_date, b.num_guests,
                    b.total_price, b.points_earned, b.status,
                    b.cancelled_at, b.cancellation_reason, b.notes,
                    b.created_at, b.updated_at,
                    r.room_number, rt.name as room_type_name
                FROM bookings b
                LEFT JOIN rooms r ON b.room_id = r.id
                LEFT JOIN room_types rt ON b.room_type_id = rt.id
                ORDER BY b.created_at DESC
                LIMIT $1 OFFSET $2
                "#,
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

            (rows, total.0)
        }
    };

    let responses: Vec<BookingResponse> = bookings.into_iter().map(|r| r.into_response()).collect();
    Ok((responses, total))
}

async fn query_booking_by_id(db: &PgPool, booking_id: Uuid) -> AppResult<BookingResponse> {
    let row: BookingRow = sqlx::query_as(
        r#"
        SELECT
            b.id, b.user_id, b.room_id, b.room_type_id,
            b.check_in_date, b.check_out_date, b.num_guests,
            b.total_price, b.points_earned, b.status,
            b.cancelled_at, b.cancellation_reason, b.notes,
            b.created_at, b.updated_at,
            r.room_number, rt.name as room_type_name
        FROM bookings b
        LEFT JOIN rooms r ON b.room_id = r.id
        LEFT JOIN room_types rt ON b.room_type_id = rt.id
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Booking {}", booking_id)))?;

    Ok(row.into_response())
}

async fn insert_booking(
    db: &PgPool,
    user_id: Uuid,
    check_in: NaiveDate,
    check_out: NaiveDate,
    room_type: Option<RoomType>,
    guests: i32,
    special_requests: Option<String>,
) -> AppResult<BookingResponse> {
    // Get room type info and find an available room
    let room_type_name = room_type
        .map(|rt| format!("{:?}", rt))
        .unwrap_or_else(|| "Standard".to_string());

    // Find the room type
    let room_type_row: RoomTypeRow = sqlx::query_as(
        r#"
        SELECT id, name, price_per_night
        FROM room_types
        WHERE LOWER(name) = LOWER($1) AND is_active = true
        "#,
    )
    .bind(&room_type_name)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::BadRequest(format!("Room type '{}' not found", room_type_name)))?;

    // Find an available room of this type
    let room_id: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT r.id
        FROM rooms r
        WHERE r.room_type_id = $1
          AND r.is_active = true
          AND r.id NOT IN (
            -- Exclude rooms with existing bookings that overlap
            SELECT DISTINCT b.room_id
            FROM bookings b
            WHERE b.status NOT IN ('cancelled')
              AND b.check_in_date < $3
              AND b.check_out_date > $2
          )
          AND r.id NOT IN (
            -- Exclude rooms with blocked dates in the range
            SELECT DISTINCT rbd.room_id
            FROM room_blocked_dates rbd
            WHERE rbd.blocked_date >= $2 AND rbd.blocked_date < $3
          )
        LIMIT 1
        "#,
    )
    .bind(room_type_row.id)
    .bind(check_in)
    .bind(check_out)
    .fetch_optional(db)
    .await?;

    let room_id = room_id
        .ok_or_else(|| AppError::BadRequest("No rooms available for selected dates".to_string()))?
        .0;

    // Calculate total price
    let nights = (check_out - check_in).num_days() as i32;
    let total_price = room_type_row.price_per_night * Decimal::from(nights);

    // Insert booking
    let row: BookingRow = sqlx::query_as(
        r#"
        INSERT INTO bookings (user_id, room_id, room_type_id, check_in_date, check_out_date, num_guests, total_price, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed')
        RETURNING
            id, user_id, room_id, room_type_id, check_in_date, check_out_date,
            num_guests, total_price, points_earned, status, cancelled_at,
            cancellation_reason, notes, created_at, updated_at,
            NULL::varchar as room_number, NULL::varchar as room_type_name
        "#
    )
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_row.id)
    .bind(check_in)
    .bind(check_out)
    .bind(guests)
    .bind(total_price)
    .bind(&special_requests)
    .fetch_one(db)
    .await?;

    // Fetch full booking with joins
    query_booking_by_id(db, row.id).await
}

async fn update_booking_in_db(
    db: &PgPool,
    booking_id: Uuid,
    check_in: NaiveDate,
    check_out: NaiveDate,
    room_type: Option<RoomType>,
    guests: i32,
    special_requests: Option<String>,
) -> AppResult<BookingResponse> {
    // Get current booking
    let current = query_booking_by_id(db, booking_id).await?;

    // If room type changed, find new room
    let (room_id, room_type_id, total_price) = if room_type != current.room_type {
        let room_type_name = room_type
            .map(|rt| format!("{:?}", rt))
            .unwrap_or_else(|| "Standard".to_string());

        let room_type_row: RoomTypeRow = sqlx::query_as(
            r#"
            SELECT id, name, price_per_night
            FROM room_types
            WHERE LOWER(name) = LOWER($1) AND is_active = true
            "#,
        )
        .bind(&room_type_name)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::BadRequest(format!("Room type '{}' not found", room_type_name)))?;

        // Find available room (excluding current booking)
        let room_id: Option<(Uuid,)> = sqlx::query_as(
            r#"
            SELECT r.id
            FROM rooms r
            WHERE r.room_type_id = $1
              AND r.is_active = true
              AND r.id NOT IN (
                SELECT DISTINCT b.room_id
                FROM bookings b
                WHERE b.status NOT IN ('cancelled')
                  AND b.id != $4
                  AND b.check_in_date < $3
                  AND b.check_out_date > $2
              )
            LIMIT 1
            "#,
        )
        .bind(room_type_row.id)
        .bind(check_in)
        .bind(check_out)
        .bind(booking_id)
        .fetch_optional(db)
        .await?;

        let room_id = room_id
            .ok_or_else(|| {
                AppError::BadRequest("No rooms available for selected dates".to_string())
            })?
            .0;

        let nights = (check_out - check_in).num_days() as i32;
        let total = room_type_row.price_per_night * Decimal::from(nights);

        (room_id, room_type_row.id, total)
    } else {
        // Recalculate price with current room type
        let room_info: (Uuid, Uuid, Decimal) = sqlx::query_as(
            r#"
            SELECT b.room_id, b.room_type_id, rt.price_per_night
            FROM bookings b
            JOIN room_types rt ON b.room_type_id = rt.id
            WHERE b.id = $1
            "#,
        )
        .bind(booking_id)
        .fetch_one(db)
        .await?;

        let nights = (check_out - check_in).num_days() as i32;
        let total = room_info.2 * Decimal::from(nights);

        (room_info.0, room_info.1, total)
    };

    // Update booking
    sqlx::query(
        r#"
        UPDATE bookings
        SET room_id = $2, room_type_id = $3, check_in_date = $4, check_out_date = $5,
            num_guests = $6, total_price = $7, notes = $8, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(booking_id)
    .bind(room_id)
    .bind(room_type_id)
    .bind(check_in)
    .bind(check_out)
    .bind(guests)
    .bind(total_price)
    .bind(&special_requests)
    .execute(db)
    .await?;

    query_booking_by_id(db, booking_id).await
}

async fn cancel_booking_in_db(
    db: &PgPool,
    booking_id: Uuid,
    reason: Option<String>,
    _admin_cancel: bool,
) -> AppResult<BookingResponse> {
    sqlx::query(
        r#"
        UPDATE bookings
        SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(booking_id)
    .bind(&reason)
    .execute(db)
    .await?;

    query_booking_by_id(db, booking_id).await
}

async fn complete_booking_in_db(db: &PgPool, booking_id: Uuid) -> AppResult<BookingResponse> {
    sqlx::query(
        r#"
        UPDATE bookings
        SET status = 'completed', updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(booking_id)
    .execute(db)
    .await?;

    query_booking_by_id(db, booking_id).await
}

async fn check_room_availability(
    db: &PgPool,
    check_in: NaiveDate,
    check_out: NaiveDate,
    room_type: Option<RoomType>,
) -> AppResult<AvailabilityResponse> {
    let nights = (check_out - check_in).num_days() as i32;

    if let Some(rt) = room_type {
        let room_type_name = format!("{:?}", rt);

        // Get room type info
        let room_type_info: Option<RoomTypeRow> = sqlx::query_as(
            r#"
            SELECT id, name, price_per_night
            FROM room_types
            WHERE LOWER(name) = LOWER($1) AND is_active = true
            "#,
        )
        .bind(&room_type_name)
        .fetch_optional(db)
        .await?;

        if let Some(rt_info) = room_type_info {
            // Count available rooms
            let available_count: (i64,) = sqlx::query_as(
                r#"
                SELECT COUNT(*)
                FROM rooms r
                WHERE r.room_type_id = $1
                  AND r.is_active = true
                  AND r.id NOT IN (
                    SELECT DISTINCT b.room_id
                    FROM bookings b
                    WHERE b.status NOT IN ('cancelled')
                      AND b.check_in_date < $3
                      AND b.check_out_date > $2
                  )
                  AND r.id NOT IN (
                    SELECT DISTINCT rbd.room_id
                    FROM room_blocked_dates rbd
                    WHERE rbd.blocked_date >= $2 AND rbd.blocked_date < $3
                  )
                "#,
            )
            .bind(rt_info.id)
            .bind(check_in)
            .bind(check_out)
            .fetch_one(db)
            .await?;

            let total_price = rt_info.price_per_night * Decimal::from(nights);

            Ok(AvailabilityResponse {
                available: available_count.0 > 0,
                room_type: Some(rt_info.name.to_lowercase()),
                check_in,
                check_out,
                available_rooms: available_count.0 as i32,
                price_per_night: Some(rt_info.price_per_night),
                total_price: Some(total_price),
            })
        } else {
            Ok(AvailabilityResponse {
                available: false,
                room_type: Some(room_type_name.to_lowercase()),
                check_in,
                check_out,
                available_rooms: 0,
                price_per_night: None,
                total_price: None,
            })
        }
    } else {
        // Check all room types
        let total_available: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM rooms r
            WHERE r.is_active = true
              AND r.id NOT IN (
                SELECT DISTINCT b.room_id
                FROM bookings b
                WHERE b.status NOT IN ('cancelled')
                  AND b.check_in_date < $2
                  AND b.check_out_date > $1
              )
              AND r.id NOT IN (
                SELECT DISTINCT rbd.room_id
                FROM room_blocked_dates rbd
                WHERE rbd.blocked_date >= $1 AND rbd.blocked_date < $2
              )
            "#,
        )
        .bind(check_in)
        .bind(check_out)
        .fetch_one(db)
        .await?;

        // Get cheapest room type for price reference
        let cheapest: Option<(Decimal,)> =
            sqlx::query_as("SELECT MIN(price_per_night) FROM room_types WHERE is_active = true")
                .fetch_optional(db)
                .await?;

        let price_per_night = cheapest.map(|c| c.0);
        let total_price = price_per_night.map(|p| p * Decimal::from(nights));

        Ok(AvailabilityResponse {
            available: total_available.0 > 0,
            room_type: None,
            check_in,
            check_out,
            available_rooms: total_available.0 as i32,
            price_per_night,
            total_price,
        })
    }
}

async fn award_loyalty_points(
    db: &PgPool,
    user_id: Uuid,
    points: i32,
    nights: i32,
    booking_id: Uuid,
) -> AppResult<()> {
    // Use the award_points stored procedure
    // award_points(p_user_id, p_points, p_type, p_description, p_reference_id, p_nights_stayed)
    let reference_id = format!("BOOKING-{}", booking_id);

    sqlx::query(
        r#"
        SELECT award_points($1, $2, 'earned_stay'::points_transaction_type, 'Points earned from booking', $3, $4)
        "#
    )
    .bind(user_id)
    .bind(points)
    .bind(&reference_id)
    .bind(nights)
    .execute(db)
    .await?;

    // Update the booking with points earned
    sqlx::query("UPDATE bookings SET points_earned = $2 WHERE id = $1")
        .bind(booking_id)
        .bind(points)
        .execute(db)
        .await?;

    Ok(())
}

// ==================== HELPER FUNCTIONS ====================

/// Parse room type string to enum
fn parse_room_type(room_type: &str) -> AppResult<RoomType> {
    match room_type.to_lowercase().as_str() {
        "standard" => Ok(RoomType::Standard),
        "deluxe" => Ok(RoomType::Deluxe),
        "suite" => Ok(RoomType::Suite),
        "executive" => Ok(RoomType::Executive),
        "presidential" => Ok(RoomType::Presidential),
        _ => Err(AppError::Validation(format!(
            "Invalid room type '{}'. Valid types: standard, deluxe, suite, executive, presidential",
            room_type
        ))),
    }
}

// ==================== ROUTER ====================

/// Create booking routes
///
/// All routes require authentication.
/// Admin-only routes are protected with role checks within handlers.
pub fn routes() -> Router<AppState> {
    router()
}

/// Create booking router
///
/// Returns a Router<AppState> with all booking endpoints:
/// - GET /api/bookings - List user's bookings (admin sees all)
/// - GET /api/bookings/:id - Get booking details
/// - POST /api/bookings - Create a new booking
/// - PUT /api/bookings/:id - Update a booking
/// - POST /api/bookings/:id/cancel - Cancel a booking
/// - POST /api/bookings/:id/complete - Mark booking as completed (admin only)
/// - GET /api/bookings/availability - Check room availability
///
/// All routes require authentication via the auth_middleware.
/// Admin-only operations are protected with role checks within handlers.
pub fn router() -> Router<AppState> {
    Router::new()
        // Public availability check (but still requires auth for rate limiting)
        .route("/availability", get(check_availability))
        // User booking routes
        .route("/", get(list_bookings))
        .route("/", post(create_booking))
        .route("/:id", get(get_booking))
        .route("/:id", put(update_booking))
        .route("/:id/cancel", post(cancel_booking))
        // Admin routes
        .route("/:id/complete", post(complete_booking))
        // Apply authentication middleware to all routes
        .layer(middleware::from_fn(auth_middleware))
}

/// Create booking routes without authentication (for testing)
#[cfg(test)]
pub fn routes_without_auth() -> Router<AppState> {
    router_without_auth()
}

/// Create booking router without authentication (for testing)
///
/// Returns a Router<AppState> with all booking endpoints but without
/// the authentication middleware. Use only for testing purposes.
#[cfg(test)]
pub fn router_without_auth() -> Router<AppState> {
    Router::new()
        .route("/availability", get(check_availability))
        .route("/", get(list_bookings))
        .route("/", post(create_booking))
        .route("/:id", get(get_booking))
        .route("/:id", put(update_booking))
        .route("/:id/cancel", post(cancel_booking))
        .route("/:id/complete", post(complete_booking))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_room_type_valid() {
        assert!(matches!(
            parse_room_type("standard"),
            Ok(RoomType::Standard)
        ));
        assert!(matches!(parse_room_type("DELUXE"), Ok(RoomType::Deluxe)));
        assert!(matches!(parse_room_type("Suite"), Ok(RoomType::Suite)));
        assert!(matches!(
            parse_room_type("executive"),
            Ok(RoomType::Executive)
        ));
        assert!(matches!(
            parse_room_type("presidential"),
            Ok(RoomType::Presidential)
        ));
    }

    #[test]
    fn test_parse_room_type_invalid() {
        let result = parse_room_type("invalid");
        assert!(result.is_err());
    }

    #[test]
    fn test_default_pagination() {
        let query = PaginationQuery::default();
        assert_eq!(query.page, 1);
        assert_eq!(query.limit, 20);
        assert!(query.status.is_none());
    }
}
