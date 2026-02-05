//! Booking models
//!
//! Contains structs for booking/reservation management.
//! Note: The booking model is not explicitly defined in the Prisma schema,
//! but points transactions reference bookings through reference_id.
//! This provides a struct for external booking system integration.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Booking status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookingStatus {
    Pending,
    Confirmed,
    CheckedIn,
    CheckedOut,
    Cancelled,
    NoShow,
}

/// Room type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoomType {
    Standard,
    Deluxe,
    Suite,
    Executive,
    Presidential,
}

/// Booking entity
/// Represents a hotel booking/reservation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Booking {
    pub id: Uuid,
    pub user_id: Uuid,
    pub booking_reference: String,
    pub status: BookingStatus,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights_count: i32,
    pub room_type: Option<RoomType>,
    pub room_number: Option<String>,
    pub total_amount: rust_decimal::Decimal,
    pub currency: String,
    pub guest_count: Option<i32>,
    pub special_requests: Option<String>,
    pub confirmation_number: Option<String>,
    pub external_booking_id: Option<String>,
    pub points_earned: Option<i32>,
    pub points_redeemed: Option<i32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: Option<String>,
}

/// Create booking request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBookingRequest {
    pub user_id: Uuid,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub room_type: Option<RoomType>,
    pub guest_count: Option<i32>,
    pub special_requests: Option<String>,
    pub total_amount: rust_decimal::Decimal,
    pub currency: Option<String>,
    pub external_booking_id: Option<String>,
}

/// Update booking request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateBookingRequest {
    pub status: Option<BookingStatus>,
    pub check_in_date: Option<NaiveDate>,
    pub check_out_date: Option<NaiveDate>,
    pub room_type: Option<RoomType>,
    pub room_number: Option<String>,
    pub guest_count: Option<i32>,
    pub special_requests: Option<String>,
    pub total_amount: Option<rust_decimal::Decimal>,
}

/// Booking response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub booking_reference: String,
    pub status: BookingStatus,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights_count: i32,
    pub room_type: Option<RoomType>,
    pub room_number: Option<String>,
    pub total_amount: rust_decimal::Decimal,
    pub currency: String,
    pub guest_count: Option<i32>,
    pub special_requests: Option<String>,
    pub confirmation_number: Option<String>,
    pub points_earned: Option<i32>,
    pub points_redeemed: Option<i32>,
    pub created_at: Option<DateTime<Utc>>,
}

/// Booking summary for user dashboard
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingSummary {
    pub total_bookings: i64,
    pub total_nights: i64,
    pub upcoming_bookings: i32,
    pub completed_bookings: i32,
    pub total_spent: rust_decimal::Decimal,
    pub points_earned_from_bookings: i64,
}

impl From<Booking> for BookingResponse {
    fn from(booking: Booking) -> Self {
        Self {
            id: booking.id,
            user_id: booking.user_id,
            booking_reference: booking.booking_reference,
            status: booking.status,
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            nights_count: booking.nights_count,
            room_type: booking.room_type,
            room_number: booking.room_number,
            total_amount: booking.total_amount,
            currency: booking.currency,
            guest_count: booking.guest_count,
            special_requests: booking.special_requests,
            confirmation_number: booking.confirmation_number,
            points_earned: booking.points_earned,
            points_redeemed: booking.points_redeemed,
            created_at: booking.created_at,
        }
    }
}

impl Booking {
    /// Calculate the number of nights between check-in and check-out
    pub fn calculate_nights(&self) -> i32 {
        (self.check_out_date - self.check_in_date).num_days() as i32
    }

    /// Check if the booking is upcoming (check-in date is in the future)
    pub fn is_upcoming(&self) -> bool {
        self.check_in_date > chrono::Utc::now().date_naive()
    }

    /// Check if the booking is currently active (guest is checked in)
    pub fn is_active(&self) -> bool {
        matches!(self.status, BookingStatus::CheckedIn)
    }

    /// Check if the booking is completed
    pub fn is_completed(&self) -> bool {
        matches!(self.status, BookingStatus::CheckedOut)
    }
}
