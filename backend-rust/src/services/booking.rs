//! Booking service module
//!
//! Provides booking/reservation functionality including:
//! - Listing bookings with filters
//! - Getting single booking details
//! - Creating new bookings
//! - Updating existing bookings
//! - Cancelling bookings
//! - Checking room availability
//! - Completing bookings (with points/nights award)

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::loyalty::{AwardPointsParamsUuid, LoyaltyService, LoyaltyServiceImpl};
use crate::services::AppState;

// ==================== DTOs ====================

/// Filter options for listing bookings
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BookingFilters {
    /// Filter by booking status
    pub status: Option<BookingStatus>,
    /// Filter by user ID
    pub user_id: Option<Uuid>,
    /// Filter by room type ID
    pub room_type_id: Option<Uuid>,
    /// Filter bookings with check-in date on or after this date
    pub from_date: Option<NaiveDate>,
    /// Filter bookings with check-out date on or before this date
    pub to_date: Option<NaiveDate>,
    /// Maximum number of results to return (default: 20)
    pub limit: Option<i64>,
    /// Number of results to skip (default: 0)
    pub offset: Option<i64>,
}

/// Data for creating a new booking
#[derive(Debug, Clone, Deserialize)]
pub struct CreateBookingDto {
    /// User ID making the booking
    pub user_id: Uuid,
    /// Room type ID for the booking
    pub room_type_id: Uuid,
    /// Check-in date
    pub check_in_date: NaiveDate,
    /// Check-out date
    pub check_out_date: NaiveDate,
    /// Number of guests
    pub num_guests: i32,
    /// Optional notes for the booking
    pub notes: Option<String>,
    /// Total booking amount
    pub total_amount: Decimal,
    /// Currency code (default: THB)
    pub currency: Option<String>,
    /// Optional special requests
    pub special_requests: Option<String>,
}

/// Data for updating an existing booking
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateBookingDto {
    /// Update booking status
    pub status: Option<BookingStatus>,
    /// Update check-in date
    pub check_in_date: Option<NaiveDate>,
    /// Update check-out date
    pub check_out_date: Option<NaiveDate>,
    /// Update number of guests
    pub num_guests: Option<i32>,
    /// Update notes
    pub notes: Option<String>,
    /// Update total amount
    pub total_amount: Option<Decimal>,
    /// Update special requests
    pub special_requests: Option<String>,
}

// ==================== Enums ====================

/// Booking status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "varchar")]
#[sqlx(rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum BookingStatus {
    /// Booking is confirmed and active
    Confirmed,
    /// Booking has been cancelled
    Cancelled,
    /// Booking has been completed (guest checked out)
    Completed,
}

impl Default for BookingStatus {
    fn default() -> Self {
        Self::Confirmed
    }
}

impl std::fmt::Display for BookingStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BookingStatus::Confirmed => write!(f, "confirmed"),
            BookingStatus::Cancelled => write!(f, "cancelled"),
            BookingStatus::Completed => write!(f, "completed"),
        }
    }
}

impl std::str::FromStr for BookingStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "confirmed" => Ok(BookingStatus::Confirmed),
            "cancelled" => Ok(BookingStatus::Cancelled),
            "completed" => Ok(BookingStatus::Completed),
            _ => Err(format!("Invalid booking status: {}", s)),
        }
    }
}

// ==================== Models ====================

/// Booking entity from the database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Booking {
    pub id: Uuid,
    pub user_id: Uuid,
    pub room_id: Uuid,
    pub room_type_id: Uuid,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub num_guests: i32,
    pub total_price: Decimal,
    pub points_earned: i32,
    pub status: String,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
    pub cancelled_by: Option<Uuid>,
    pub cancelled_by_admin: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Joined fields (optional)
    #[sqlx(default)]
    pub room_number: Option<String>,
    #[sqlx(default)]
    pub room_type_name: Option<String>,
    #[sqlx(default)]
    pub user_email: Option<String>,
    #[sqlx(default)]
    pub user_name: Option<String>,
}

/// Room type entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoomType {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub price_per_night: Decimal,
    pub max_guests: i32,
    pub bed_type: Option<String>,
    pub amenities: serde_json::Value,
    pub images: serde_json::Value,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Room entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Room {
    pub id: Uuid,
    pub room_type_id: Uuid,
    pub room_number: String,
    pub floor: Option<i32>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Booking response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub room_id: Uuid,
    pub room_type_id: Uuid,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights_count: i32,
    pub num_guests: i32,
    pub total_price: Decimal,
    pub points_earned: i32,
    pub status: BookingStatus,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Joined fields
    pub room_number: Option<String>,
    pub room_type_name: Option<String>,
}

impl From<Booking> for BookingResponse {
    fn from(booking: Booking) -> Self {
        let nights_count = (booking.check_out_date - booking.check_in_date).num_days() as i32;
        let status = booking.status.parse().unwrap_or(BookingStatus::Confirmed);

        Self {
            id: booking.id,
            user_id: booking.user_id,
            room_id: booking.room_id,
            room_type_id: booking.room_type_id,
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            nights_count,
            num_guests: booking.num_guests,
            total_price: booking.total_price,
            points_earned: booking.points_earned,
            status,
            cancelled_at: booking.cancelled_at,
            cancellation_reason: booking.cancellation_reason,
            notes: booking.notes,
            created_at: booking.created_at,
            updated_at: booking.updated_at,
            room_number: booking.room_number,
            room_type_name: booking.room_type_name,
        }
    }
}

// ==================== Service Trait ====================

/// Booking service trait defining booking operations
#[async_trait]
pub trait BookingService: Send + Sync {
    /// List bookings for a user with optional filters
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `user_id` - User ID to filter bookings (i32 for compatibility)
    /// * `filters` - Additional filter options
    ///
    /// # Returns
    /// Vector of bookings matching the filters
    async fn list_bookings(
        &self,
        user_id: i32,
        filters: BookingFilters,
    ) -> Result<Vec<BookingResponse>, AppError>;

    /// Get a single booking by ID
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `booking_id` - Booking ID (i32 for compatibility)
    ///
    /// # Returns
    /// The booking if found, None otherwise
    async fn get_booking(&self, booking_id: i32) -> Result<Option<BookingResponse>, AppError>;

    /// Create a new booking
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `data` - Booking creation data
    ///
    /// # Returns
    /// The created booking
    async fn create_booking(&self, data: CreateBookingDto) -> Result<BookingResponse, AppError>;

    /// Update an existing booking
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `booking_id` - Booking ID to update (i32 for compatibility)
    /// * `data` - Booking update data
    ///
    /// # Returns
    /// The updated booking
    async fn update_booking(
        &self,
        booking_id: i32,
        data: UpdateBookingDto,
    ) -> Result<BookingResponse, AppError>;

    /// Cancel a booking
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `booking_id` - Booking ID to cancel (i32 for compatibility)
    ///
    /// # Returns
    /// The cancelled booking
    async fn cancel_booking(&self, booking_id: i32) -> Result<BookingResponse, AppError>;

    /// Complete a booking (marks as completed and awards points/nights to user)
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `booking_id` - Booking ID to complete (i32 for compatibility)
    ///
    /// # Returns
    /// The completed booking
    async fn complete_booking(&self, booking_id: i32) -> Result<BookingResponse, AppError>;

    /// Check room availability for given dates
    ///
    /// # Arguments
    /// * `db` - Database pool (accessed via self.state)
    /// * `check_in` - Check-in date
    /// * `check_out` - Check-out date
    /// * `room_type` - Optional room type name to filter by
    ///
    /// # Returns
    /// true if rooms are available, false otherwise
    async fn check_availability(
        &self,
        check_in: NaiveDate,
        check_out: NaiveDate,
        room_type: Option<String>,
    ) -> Result<bool, AppError>;
}

// ==================== Service Implementation ====================

/// Implementation of the BookingService trait
pub struct BookingServiceImpl {
    state: AppState,
}

impl BookingServiceImpl {
    /// Create a new BookingServiceImpl instance
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    /// Get a reference to the database pool
    fn pool(&self) -> &PgPool {
        self.state.db.pool()
    }

    /// Get an available room for the given room type and date range
    async fn get_available_room(
        &self,
        room_type_id: Uuid,
        check_in: NaiveDate,
        check_out: NaiveDate,
    ) -> Result<Option<Room>, AppError> {
        let room = sqlx::query_as::<_, Room>(
            r#"
            SELECT r.id, r.room_type_id, r.room_number, r.floor, r.notes,
                   r.is_active, r.created_at, r.updated_at
            FROM rooms r
            WHERE r.room_type_id = $1
              AND r.is_active = true
              AND r.id NOT IN (
                  -- Exclude rooms with blocked dates in the range
                  SELECT DISTINCT room_id FROM room_blocked_dates
                  WHERE blocked_date >= $2 AND blocked_date < $3
              )
              AND r.id NOT IN (
                  -- Exclude rooms with existing bookings in the range
                  SELECT DISTINCT room_id FROM bookings
                  WHERE status = 'confirmed'
                    AND check_in_date < $3
                    AND check_out_date > $2
              )
            ORDER BY r.room_number ASC
            LIMIT 1
            "#,
        )
        .bind(room_type_id)
        .bind(check_in)
        .bind(check_out)
        .fetch_optional(self.pool())
        .await?;

        Ok(room)
    }

    /// Get room type by ID
    async fn get_room_type(&self, room_type_id: Uuid) -> Result<Option<RoomType>, AppError> {
        let room_type = sqlx::query_as::<_, RoomType>(
            r#"
            SELECT id, name, description, price_per_night, max_guests, bed_type,
                   amenities, images, is_active, sort_order, created_at, updated_at
            FROM room_types
            WHERE id = $1 AND is_active = true
            "#,
        )
        .bind(room_type_id)
        .fetch_optional(self.pool())
        .await?;

        Ok(room_type)
    }

    /// Award points and nights to user via loyalty service
    async fn award_booking_points(
        &self,
        user_id: Uuid,
        points: i32,
        nights: i32,
        booking_id: Uuid,
        room_type_name: &str,
    ) -> Result<(), AppError> {
        let loyalty_service = LoyaltyServiceImpl::new(self.pool().clone());

        let award_params = AwardPointsParamsUuid {
            user_id,
            points,
            nights: Some(nights),
            source: "booking_completion".to_string(),
            description: format!("Completed booking: {} ({} nights)", room_type_name, nights),
            reference_id: Some(format!("BOOKING-{}", booking_id)),
            admin_user_id: None,
            admin_reason: None,
        };

        loyalty_service.award_points(award_params).await?;
        Ok(())
    }

    /// Convert i32 to Uuid for database queries
    /// Note: In production, you'd want a proper ID mapping strategy
    fn i32_to_uuid(id: i32) -> Uuid {
        // Use a deterministic UUID generation based on the i32 value
        // This creates a valid UUID v5 with a namespace
        let namespace = Uuid::NAMESPACE_OID;
        Uuid::new_v5(&namespace, id.to_string().as_bytes())
    }

    /// Get room type by name
    async fn get_room_type_by_name(&self, name: &str) -> Result<Option<RoomType>, AppError> {
        let room_type = sqlx::query_as::<_, RoomType>(
            r#"
            SELECT id, name, description, price_per_night, max_guests, bed_type,
                   amenities, images, is_active, sort_order, created_at, updated_at
            FROM room_types
            WHERE LOWER(name) = LOWER($1) AND is_active = true
            "#,
        )
        .bind(name)
        .fetch_optional(self.pool())
        .await?;

        Ok(room_type)
    }
}

#[async_trait]
impl BookingService for BookingServiceImpl {
    async fn list_bookings(
        &self,
        user_id: i32,
        filters: BookingFilters,
    ) -> Result<Vec<BookingResponse>, AppError> {
        let limit = filters.limit.unwrap_or(20).min(100);
        let offset = filters.offset.unwrap_or(0);

        // Convert i32 user_id to Uuid for query
        let user_uuid = Self::i32_to_uuid(user_id);

        // Build dynamic query with conditions
        let mut conditions = vec!["b.user_id = $1".to_string()];
        let mut param_count = 1;

        if filters.status.is_some() {
            param_count += 1;
            conditions.push(format!("b.status = ${}", param_count));
        }

        if filters.room_type_id.is_some() {
            param_count += 1;
            conditions.push(format!("b.room_type_id = ${}", param_count));
        }

        if filters.from_date.is_some() {
            param_count += 1;
            conditions.push(format!("b.check_in_date >= ${}", param_count));
        }

        if filters.to_date.is_some() {
            param_count += 1;
            conditions.push(format!("b.check_out_date <= ${}", param_count));
        }

        let where_clause = format!("WHERE {}", conditions.join(" AND "));

        let query = format!(
            r#"
            SELECT
                b.id, b.user_id, b.room_id, b.room_type_id,
                b.check_in_date, b.check_out_date, b.num_guests,
                b.total_price, b.points_earned, b.status,
                b.cancelled_at, b.cancellation_reason,
                b.cancelled_by, COALESCE(b.cancelled_by_admin, false) as cancelled_by_admin,
                b.notes, b.created_at, b.updated_at,
                r.room_number, rt.name as room_type_name,
                NULL::text as user_email, NULL::text as user_name
            FROM bookings b
            JOIN rooms r ON b.room_id = r.id
            JOIN room_types rt ON b.room_type_id = rt.id
            {}
            ORDER BY b.created_at DESC
            LIMIT ${} OFFSET ${}
            "#,
            where_clause,
            param_count + 1,
            param_count + 2
        );

        // Build and execute query with dynamic bindings
        let mut query_builder = sqlx::query_as::<_, Booking>(&query);

        query_builder = query_builder.bind(user_uuid);

        if let Some(status) = &filters.status {
            query_builder = query_builder.bind(status.to_string());
        }
        if let Some(room_type_id) = filters.room_type_id {
            query_builder = query_builder.bind(room_type_id);
        }
        if let Some(from_date) = filters.from_date {
            query_builder = query_builder.bind(from_date);
        }
        if let Some(to_date) = filters.to_date {
            query_builder = query_builder.bind(to_date);
        }

        query_builder = query_builder.bind(limit).bind(offset);

        let bookings = query_builder.fetch_all(self.pool()).await?;

        Ok(bookings.into_iter().map(BookingResponse::from).collect())
    }

    async fn get_booking(&self, booking_id: i32) -> Result<Option<BookingResponse>, AppError> {
        // Convert i32 booking_id to Uuid for query
        let booking_uuid = Self::i32_to_uuid(booking_id);

        let booking = sqlx::query_as::<_, Booking>(
            r#"
            SELECT
                b.id, b.user_id, b.room_id, b.room_type_id,
                b.check_in_date, b.check_out_date, b.num_guests,
                b.total_price, b.points_earned, b.status,
                b.cancelled_at, b.cancellation_reason,
                b.cancelled_by, COALESCE(b.cancelled_by_admin, false) as cancelled_by_admin,
                b.notes, b.created_at, b.updated_at,
                r.room_number, rt.name as room_type_name,
                NULL::text as user_email, NULL::text as user_name
            FROM bookings b
            JOIN rooms r ON b.room_id = r.id
            JOIN room_types rt ON b.room_type_id = rt.id
            WHERE b.id = $1
            "#,
        )
        .bind(booking_uuid)
        .fetch_optional(self.pool())
        .await?;

        Ok(booking.map(BookingResponse::from))
    }

    async fn create_booking(&self, data: CreateBookingDto) -> Result<BookingResponse, AppError> {
        // Validate dates
        if data.check_out_date <= data.check_in_date {
            return Err(AppError::BadRequest(
                "Check-out date must be after check-in date".to_string(),
            ));
        }

        let today = Utc::now().date_naive();
        if data.check_in_date < today {
            return Err(AppError::BadRequest(
                "Check-in date cannot be in the past".to_string(),
            ));
        }

        // Get room type
        let room_type = self
            .get_room_type(data.room_type_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Room type not found".to_string()))?;

        // Validate guest count
        if data.num_guests > room_type.max_guests {
            return Err(AppError::BadRequest(format!(
                "Maximum {} guests allowed for this room type",
                room_type.max_guests
            )));
        }

        // Find available room
        let room = self
            .get_available_room(data.room_type_id, data.check_in_date, data.check_out_date)
            .await?
            .ok_or_else(|| {
                AppError::BadRequest("No rooms available for the selected dates".to_string())
            })?;

        // Calculate nights and points
        // Note: nights_count is recalculated from BookingResponse::from(), so we don't need it here
        let _nights = (data.check_out_date - data.check_in_date).num_days() as i32;
        let total_price = data.total_amount;
        // 10 points per THB spent (matching Node.js logic)
        let points_earned = (total_price * Decimal::from(10)).to_string().parse::<i32>().unwrap_or(0);

        // Create booking
        let booking = sqlx::query_as::<_, Booking>(
            r#"
            INSERT INTO bookings (
                user_id, room_id, room_type_id, check_in_date, check_out_date,
                num_guests, total_price, points_earned, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed')
            RETURNING
                id, user_id, room_id, room_type_id,
                check_in_date, check_out_date, num_guests,
                total_price, points_earned, status,
                cancelled_at, cancellation_reason,
                cancelled_by, COALESCE(cancelled_by_admin, false) as cancelled_by_admin,
                notes, created_at, updated_at,
                NULL::text as room_number, NULL::text as room_type_name,
                NULL::text as user_email, NULL::text as user_name
            "#,
        )
        .bind(data.user_id)
        .bind(room.id)
        .bind(data.room_type_id)
        .bind(data.check_in_date)
        .bind(data.check_out_date)
        .bind(data.num_guests)
        .bind(total_price)
        .bind(points_earned)
        .bind(&data.notes)
        .fetch_one(self.pool())
        .await?;

        let mut response = BookingResponse::from(booking);
        response.room_number = Some(room.room_number);
        response.room_type_name = Some(room_type.name);

        tracing::info!(
            booking_id = %response.id,
            user_id = %data.user_id,
            "Booking created"
        );

        Ok(response)
    }

    async fn update_booking(
        &self,
        booking_id: i32,
        data: UpdateBookingDto,
    ) -> Result<BookingResponse, AppError> {
        // Convert i32 booking_id to Uuid for query
        let booking_uuid = Self::i32_to_uuid(booking_id);

        // Check booking exists
        let existing = self.get_booking(booking_id).await?
            .ok_or_else(|| AppError::NotFound("Booking not found".to_string()))?;

        // Can't update cancelled or completed bookings
        if existing.status != BookingStatus::Confirmed {
            return Err(AppError::BadRequest(
                "Cannot update a cancelled or completed booking".to_string(),
            ));
        }

        // Validate dates if provided
        let check_in = data.check_in_date.unwrap_or(existing.check_in_date);
        let check_out = data.check_out_date.unwrap_or(existing.check_out_date);

        if check_out <= check_in {
            return Err(AppError::BadRequest(
                "Check-out date must be after check-in date".to_string(),
            ));
        }

        // If dates changed, verify availability (excluding current booking's room)
        if data.check_in_date.is_some() || data.check_out_date.is_some() {
            let conflicts = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT COUNT(*) FROM bookings
                WHERE room_id = $1
                  AND id != $2
                  AND status = 'confirmed'
                  AND check_in_date < $4
                  AND check_out_date > $3
                "#,
            )
            .bind(existing.room_id)
            .bind(booking_uuid)
            .bind(check_in)
            .bind(check_out)
            .fetch_one(self.pool())
            .await?;

            if conflicts > 0 {
                return Err(AppError::Conflict(
                    "Room is not available for the new dates".to_string(),
                ));
            }
        }

        // Update booking
        let booking = sqlx::query_as::<_, Booking>(
            r#"
            UPDATE bookings SET
                check_in_date = COALESCE($2, check_in_date),
                check_out_date = COALESCE($3, check_out_date),
                num_guests = COALESCE($4, num_guests),
                notes = COALESCE($5, notes),
                total_price = COALESCE($6, total_price),
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id, user_id, room_id, room_type_id,
                check_in_date, check_out_date, num_guests,
                total_price, points_earned, status,
                cancelled_at, cancellation_reason,
                cancelled_by, COALESCE(cancelled_by_admin, false) as cancelled_by_admin,
                notes, created_at, updated_at,
                NULL::text as room_number, NULL::text as room_type_name,
                NULL::text as user_email, NULL::text as user_name
            "#,
        )
        .bind(booking_uuid)
        .bind(data.check_in_date)
        .bind(data.check_out_date)
        .bind(data.num_guests)
        .bind(&data.notes)
        .bind(data.total_amount)
        .fetch_one(self.pool())
        .await?;

        tracing::info!(booking_id = booking_id, "Booking updated");

        Ok(BookingResponse::from(booking))
    }

    async fn cancel_booking(&self, booking_id: i32) -> Result<BookingResponse, AppError> {
        // Convert i32 booking_id to Uuid for query
        let booking_uuid = Self::i32_to_uuid(booking_id);

        // Check booking exists and is cancellable
        let existing = self.get_booking(booking_id).await?
            .ok_or_else(|| AppError::NotFound("Booking not found".to_string()))?;

        if existing.status == BookingStatus::Cancelled {
            return Err(AppError::BadRequest(
                "Booking is already cancelled".to_string(),
            ));
        }

        if existing.status == BookingStatus::Completed {
            return Err(AppError::BadRequest(
                "Cannot cancel a completed booking".to_string(),
            ));
        }

        // Update booking status
        let booking = sqlx::query_as::<_, Booking>(
            r#"
            UPDATE bookings SET
                status = 'cancelled',
                cancelled_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id, user_id, room_id, room_type_id,
                check_in_date, check_out_date, num_guests,
                total_price, points_earned, status,
                cancelled_at, cancellation_reason,
                cancelled_by, COALESCE(cancelled_by_admin, false) as cancelled_by_admin,
                notes, created_at, updated_at,
                NULL::text as room_number, NULL::text as room_type_name,
                NULL::text as user_email, NULL::text as user_name
            "#,
        )
        .bind(booking_uuid)
        .fetch_one(self.pool())
        .await?;

        tracing::info!(
            booking_id = booking_id,
            "Booking cancelled"
        );

        Ok(BookingResponse::from(booking))
    }

    async fn complete_booking(&self, booking_id: i32) -> Result<BookingResponse, AppError> {
        // Convert i32 booking_id to Uuid for query
        let booking_uuid = Self::i32_to_uuid(booking_id);

        // Get booking with room type info
        let existing = self.get_booking(booking_id).await?
            .ok_or_else(|| AppError::NotFound("Booking not found".to_string()))?;

        if existing.status != BookingStatus::Confirmed {
            return Err(AppError::BadRequest(
                "Only confirmed bookings can be completed".to_string(),
            ));
        }

        // Check that checkout date has arrived or passed
        let today = Utc::now().date_naive();
        if existing.check_out_date > today {
            return Err(AppError::BadRequest(
                "Cannot complete booking before check-out date".to_string(),
            ));
        }

        // Update booking status to completed
        let booking = sqlx::query_as::<_, Booking>(
            r#"
            UPDATE bookings SET
                status = 'completed',
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id, user_id, room_id, room_type_id,
                check_in_date, check_out_date, num_guests,
                total_price, points_earned, status,
                cancelled_at, cancellation_reason,
                cancelled_by, COALESCE(cancelled_by_admin, false) as cancelled_by_admin,
                notes, created_at, updated_at,
                NULL::text as room_number, NULL::text as room_type_name,
                NULL::text as user_email, NULL::text as user_name
            "#,
        )
        .bind(booking_uuid)
        .fetch_one(self.pool())
        .await?;

        let response = BookingResponse::from(booking);

        // Award points and nights to the user
        let room_type_name = existing.room_type_name.as_deref().unwrap_or("Room");

        // Try to award points; log error but don't fail if it doesn't work
        if let Err(e) = self
            .award_booking_points(
                response.user_id,
                response.points_earned,
                response.nights_count,
                booking_uuid,
                room_type_name,
            )
            .await
        {
            tracing::error!(
                booking_id = booking_id,
                user_id = %response.user_id,
                error = %e,
                "Failed to award points for completed booking"
            );
        }

        tracing::info!(
            booking_id = booking_id,
            user_id = %response.user_id,
            points = response.points_earned,
            nights = response.nights_count,
            "Booking completed and points awarded"
        );

        Ok(response)
    }

    async fn check_availability(
        &self,
        check_in: NaiveDate,
        check_out: NaiveDate,
        room_type: Option<String>,
    ) -> Result<bool, AppError> {
        // Validate dates
        if check_out <= check_in {
            return Err(AppError::BadRequest(
                "Check-out date must be after check-in date".to_string(),
            ));
        }

        // If room type name is provided, look it up
        let room_type_id = if let Some(ref room_type_name) = room_type {
            let rt = self.get_room_type_by_name(room_type_name).await?
                .ok_or_else(|| AppError::NotFound(format!("Room type '{}' not found", room_type_name)))?;
            Some(rt.id)
        } else {
            None
        };

        // Check for available rooms
        if let Some(rt_id) = room_type_id {
            // Check specific room type
            let available_room = self.get_available_room(rt_id, check_in, check_out).await?;
            Ok(available_room.is_some())
        } else {
            // Check all room types - at least one room must be available
            let available_count = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT COUNT(*) FROM rooms r
                JOIN room_types rt ON r.room_type_id = rt.id
                WHERE r.is_active = true
                  AND rt.is_active = true
                  AND r.id NOT IN (
                      SELECT DISTINCT room_id FROM room_blocked_dates
                      WHERE blocked_date >= $1 AND blocked_date < $2
                  )
                  AND r.id NOT IN (
                      SELECT DISTINCT room_id FROM bookings
                      WHERE status = 'confirmed'
                        AND check_in_date < $2
                        AND check_out_date > $1
                  )
                "#,
            )
            .bind(check_in)
            .bind(check_out)
            .fetch_one(self.pool())
            .await?;

            Ok(available_count > 0)
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_booking_status_display() {
        assert_eq!(BookingStatus::Confirmed.to_string(), "confirmed");
        assert_eq!(BookingStatus::Cancelled.to_string(), "cancelled");
        assert_eq!(BookingStatus::Completed.to_string(), "completed");
    }

    #[test]
    fn test_booking_status_from_str() {
        assert_eq!(
            "confirmed".parse::<BookingStatus>().unwrap(),
            BookingStatus::Confirmed
        );
        assert_eq!(
            "CANCELLED".parse::<BookingStatus>().unwrap(),
            BookingStatus::Cancelled
        );
        assert_eq!(
            "Completed".parse::<BookingStatus>().unwrap(),
            BookingStatus::Completed
        );
        assert!("invalid".parse::<BookingStatus>().is_err());
    }

    #[test]
    fn test_booking_filters_default() {
        let filters = BookingFilters::default();
        assert!(filters.status.is_none());
        assert!(filters.user_id.is_none());
        assert!(filters.room_type_id.is_none());
        assert!(filters.from_date.is_none());
        assert!(filters.to_date.is_none());
        assert!(filters.limit.is_none());
        assert!(filters.offset.is_none());
    }

    #[test]
    fn test_booking_response_from_booking() {
        use rust_decimal_macros::dec;

        let booking = Booking {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            room_id: Uuid::new_v4(),
            room_type_id: Uuid::new_v4(),
            check_in_date: NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2024, 1, 3).unwrap(),
            num_guests: 2,
            total_price: dec!(2000),
            points_earned: 20000,
            status: "confirmed".to_string(),
            cancelled_at: None,
            cancellation_reason: None,
            cancelled_by: None,
            cancelled_by_admin: false,
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            room_number: Some("101".to_string()),
            room_type_name: Some("Deluxe".to_string()),
            user_email: None,
            user_name: None,
        };

        let response = BookingResponse::from(booking);
        assert_eq!(response.nights_count, 2);
        assert_eq!(response.status, BookingStatus::Confirmed);
        assert_eq!(response.room_number, Some("101".to_string()));
    }

    #[test]
    fn test_create_booking_dto() {
        use rust_decimal_macros::dec;

        let dto = CreateBookingDto {
            user_id: Uuid::new_v4(),
            room_type_id: Uuid::new_v4(),
            check_in_date: NaiveDate::from_ymd_opt(2024, 6, 1).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2024, 6, 5).unwrap(),
            num_guests: 2,
            notes: Some("Early check-in requested".to_string()),
            total_amount: dec!(5000),
            currency: Some("THB".to_string()),
            special_requests: None,
        };

        assert_eq!(dto.num_guests, 2);
        assert_eq!(
            (dto.check_out_date - dto.check_in_date).num_days(),
            4
        );
    }
}
