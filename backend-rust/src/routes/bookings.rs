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
use chrono::{NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
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
        Some(Uuid::parse_str(&auth_user.id).map_err(|_| {
            AppError::InvalidToken("Invalid user ID in token".to_string())
        })?)
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
    let room_type = req
        .room_type
        .as_deref()
        .map(parse_room_type)
        .transpose()?;

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
    let points_to_award =
        (completed.total_amount.to_string().parse::<f64>().unwrap_or(0.0) * 10.0) as i32;

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

// ==================== DATABASE OPERATIONS ====================
// Note: These are placeholder implementations. In a real application,
// these would interact with the actual database using sqlx.

async fn query_bookings(
    _db: &sqlx::PgPool,
    _user_id: Option<Uuid>,
    _status: Option<&str>,
    _limit: i32,
    _offset: i32,
) -> AppResult<(Vec<BookingResponse>, i64)> {
    // TODO: Implement actual database query
    // This is a placeholder that returns empty results
    Ok((Vec::new(), 0))
}

async fn query_booking_by_id(
    _db: &sqlx::PgPool,
    booking_id: Uuid,
) -> AppResult<BookingResponse> {
    // TODO: Implement actual database query
    // This is a placeholder that returns a not found error
    Err(AppError::NotFound(format!("Booking {}", booking_id)))
}

async fn insert_booking(
    _db: &sqlx::PgPool,
    user_id: Uuid,
    check_in: NaiveDate,
    check_out: NaiveDate,
    room_type: Option<RoomType>,
    guests: i32,
    special_requests: Option<String>,
) -> AppResult<BookingResponse> {
    // TODO: Implement actual database insert
    // This is a placeholder implementation
    let nights = (check_out - check_in).num_days() as i32;
    let price_per_night = Decimal::new(1500, 0); // 1500 THB placeholder
    let total = price_per_night * Decimal::from(nights);

    Ok(BookingResponse {
        id: Uuid::new_v4(),
        user_id,
        booking_reference: format!("BK{}", Uuid::new_v4().to_string()[..8].to_uppercase()),
        status: BookingStatus::Confirmed,
        check_in_date: check_in,
        check_out_date: check_out,
        nights_count: nights,
        room_type,
        room_number: None,
        total_amount: total,
        currency: "THB".to_string(),
        guest_count: Some(guests),
        special_requests,
        confirmation_number: Some(format!("CNF{}", chrono::Utc::now().timestamp())),
        points_earned: None,
        points_redeemed: None,
        created_at: Some(Utc::now()),
    })
}

async fn update_booking_in_db(
    _db: &sqlx::PgPool,
    _booking_id: Uuid,
    _check_in: NaiveDate,
    _check_out: NaiveDate,
    _room_type: Option<RoomType>,
    _guests: i32,
    _special_requests: Option<String>,
) -> AppResult<BookingResponse> {
    // TODO: Implement actual database update
    Err(AppError::NotFound("Booking".to_string()))
}

async fn cancel_booking_in_db(
    _db: &sqlx::PgPool,
    _booking_id: Uuid,
    _reason: Option<String>,
    _admin_cancel: bool,
) -> AppResult<BookingResponse> {
    // TODO: Implement actual database update
    Err(AppError::NotFound("Booking".to_string()))
}

async fn complete_booking_in_db(
    _db: &sqlx::PgPool,
    _booking_id: Uuid,
) -> AppResult<BookingResponse> {
    // TODO: Implement actual database update
    Err(AppError::NotFound("Booking".to_string()))
}

async fn check_room_availability(
    _db: &sqlx::PgPool,
    check_in: NaiveDate,
    check_out: NaiveDate,
    room_type: Option<RoomType>,
) -> AppResult<AvailabilityResponse> {
    // TODO: Implement actual availability check
    // This is a placeholder implementation
    let nights = (check_out - check_in).num_days() as i32;
    let price_per_night = Decimal::new(1500, 0);

    Ok(AvailabilityResponse {
        available: true,
        room_type: room_type.map(|rt| format!("{:?}", rt).to_lowercase()),
        check_in,
        check_out,
        available_rooms: 5, // Placeholder
        price_per_night: Some(price_per_night),
        total_price: Some(price_per_night * Decimal::from(nights)),
    })
}

async fn award_loyalty_points(
    _db: &sqlx::PgPool,
    _user_id: Uuid,
    _points: i32,
    _nights: i32,
    _booking_id: Uuid,
) -> AppResult<()> {
    // TODO: Implement loyalty points awarding using stored procedure
    // This would call: SELECT award_points(user_id, points, 'booking', 'BOOKING-{booking_id}', nights)
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
        .route("/bookings/availability", get(check_availability))
        // User booking routes
        .route("/bookings", get(list_bookings))
        .route("/bookings", post(create_booking))
        .route("/bookings/:id", get(get_booking))
        .route("/bookings/:id", put(update_booking))
        .route("/bookings/:id/cancel", post(cancel_booking))
        // Admin routes
        .route("/bookings/:id/complete", post(complete_booking))
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
        .route("/bookings/availability", get(check_availability))
        .route("/bookings", get(list_bookings))
        .route("/bookings", post(create_booking))
        .route("/bookings/:id", get(get_booking))
        .route("/bookings/:id", put(update_booking))
        .route("/bookings/:id/cancel", post(cancel_booking))
        .route("/bookings/:id/complete", post(complete_booking))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_room_type_valid() {
        assert!(matches!(parse_room_type("standard"), Ok(RoomType::Standard)));
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
