//! Admin room/room-type/blocked-dates routes
//!
//! Provides admin-only endpoints for room inventory and calendar availability:
//! - `GET    /api/admin/room-types`            — list room types
//! - `POST   /api/admin/room-types`            — create a room type
//! - `PATCH  /api/admin/room-types/:id`        — partial update of a room type
//! - `DELETE /api/admin/room-types/:id`        — delete a room type (409 when rooms attached)
//! - `GET    /api/admin/rooms`                 — list physical rooms (filterable by room type)
//! - `POST   /api/admin/rooms`                 — create a room
//! - `PATCH  /api/admin/rooms/:id`             — partial update of a room
//! - `DELETE /api/admin/rooms/:id`             — delete a room
//! - `GET    /api/admin/blocked-dates`         — list blocked dates in a date range
//! - `POST   /api/admin/blocked-dates`         — block one or more dates for a room
//! - `DELETE /api/admin/blocked-dates`         — unblock one or more dates for a room
//!
//! All routes require admin authentication. The router returned by
//! [`router`] is intended to be `.merge(...)`d into the parent admin router
//! defined in [`crate::routes::admin`], which applies `auth_middleware` once
//! to the merged result.
//!
//! ## sqlx note
//!
//! All database queries use **compile-time** macros (`sqlx::query!`,
//! `sqlx::query_as!`). The `.sqlx/` offline cache must be regenerated whenever
//! the queries here change — run `backend-rust/scripts/regen-sqlx-cache.sh`
//! and commit the resulting `.sqlx/*.json` files.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{has_role, AuthUser};
use crate::state::AppState;

// ============================================================================
// Helpers
// ============================================================================

/// Reject the request unless the caller has the `admin` role (or higher).
fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }
    Ok(())
}

/// Allowed values for `room_types.bed_type`. Mirrors the CHECK constraint
/// and the frontend's BED_TYPE_OPTIONS list.
const BED_TYPES: &[&str] = &["single", "double", "twin", "king"];

fn validate_bed_type(value: &str) -> Result<(), validator::ValidationError> {
    if BED_TYPES.contains(&value) {
        Ok(())
    } else {
        Err(validator::ValidationError::new("bed_type"))
    }
}

/// `rust_decimal::Decimal` does not implement the numeric traits
/// `validator`'s built-in `range(min = ..)` macro requires. We do the
/// non-negative check by hand instead — the only constraint we need.
fn validate_non_negative_price(value: &Decimal) -> Result<(), validator::ValidationError> {
    if *value < Decimal::ZERO {
        return Err(validator::ValidationError::new("pricePerNight"));
    }
    Ok(())
}

// ============================================================================
// DTOs — Room Types
// ============================================================================

/// Query params for `GET /room-types`. The frontend always wants every row
/// (active and inactive) for the management page but only active ones for
/// dropdowns. Default: include inactive (matches the management page's
/// query key `{ includeInactive: true }`); set `?include_inactive=false`
/// to filter to active rows only.
#[derive(Debug, Deserialize)]
pub struct ListRoomTypesQuery {
    #[serde(default = "default_true")]
    pub include_inactive: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct RoomTypeResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    /// Stored as `DECIMAL(10,2)` — serialised as a JSON number with two
    /// decimal places by `rust_decimal`'s serde impl.
    #[serde(rename = "pricePerNight")]
    pub price_per_night: Decimal,
    #[serde(rename = "maxGuests")]
    pub max_guests: i32,
    #[serde(rename = "bedType")]
    pub bed_type: Option<String>,
    pub amenities: Vec<String>,
    pub images: Vec<String>,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
}

/// Body for `POST /room-types`. Field names mirror the frontend payload
/// in `RoomTypeManagement.tsx::handleCreate`.
#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomTypeRequest {
    #[validate(length(min = 1, max = 100, message = "name must be 1-100 characters"))]
    pub name: String,
    pub description: Option<String>,
    /// Frontend sends a number. We accept any non-negative decimal.
    #[validate(custom(function = "validate_non_negative_price"))]
    pub price_per_night: Decimal,
    #[validate(range(min = 1, max = 20, message = "maxGuests must be 1-20"))]
    pub max_guests: i32,
    /// Optional; must be one of the BED_TYPES values when present.
    #[validate(custom(function = "validate_bed_type"))]
    pub bed_type: Option<String>,
    #[serde(default)]
    pub amenities: Vec<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
    /// Frontend defaults to 0 when the admin doesn't set it.
    #[serde(default)]
    #[validate(range(min = 0, message = "sortOrder must be >= 0"))]
    pub sort_order: i32,
}

/// Body for `PATCH /room-types/:id`. Every field is optional; only those
/// present in the body are touched. Implemented with `COALESCE($n, current)`
/// so absent fields are preserved without reading the row first.
///
/// NOTE: Because `Option<Option<T>>` is awkward to consume from JSON, we
/// treat `Option<T> == None` as "do not change" for every field. Today's
/// frontend always sends a full record on PATCH (it loads the row into the
/// edit form first), so the "clear a nullable field" case is academic and
/// can be addressed in a follow-up if needed.
#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomTypeRequest {
    #[validate(length(min = 1, max = 100, message = "name must be 1-100 characters"))]
    pub name: Option<String>,
    pub description: Option<String>,
    #[validate(custom(function = "validate_non_negative_price"))]
    pub price_per_night: Option<Decimal>,
    #[validate(range(min = 1, max = 20, message = "maxGuests must be 1-20"))]
    pub max_guests: Option<i32>,
    #[validate(custom(function = "validate_bed_type"))]
    pub bed_type: Option<String>,
    pub amenities: Option<Vec<String>>,
    pub images: Option<Vec<String>>,
    pub is_active: Option<bool>,
    #[validate(range(min = 0, message = "sortOrder must be >= 0"))]
    pub sort_order: Option<i32>,
}

// ============================================================================
// DTOs — Rooms
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ListRoomsQuery {
    /// Filter by room type. Frontend sends this from the RoomAvailability
    /// page when an admin selects a specific room type.
    #[serde(rename = "roomTypeId")]
    pub room_type_id: Option<Uuid>,
    /// Whether to include `is_active = false` rows. Default true (matches
    /// the management page).
    #[serde(default = "default_true", rename = "includeInactive")]
    pub include_inactive: bool,
}

#[derive(Debug, Serialize)]
pub struct RoomResponse {
    pub id: Uuid,
    #[serde(rename = "roomTypeId")]
    pub room_type_id: Uuid,
    #[serde(rename = "roomNumber")]
    pub room_number: String,
    pub floor: Option<i32>,
    pub notes: Option<String>,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
    /// Embedded room-type summary so the management table can show the type
    /// name without a second roundtrip. The frontend already treats this as
    /// optional (`room.roomType?.name`).
    #[serde(rename = "roomType", skip_serializing_if = "Option::is_none")]
    pub room_type: Option<RoomTypeSummary>,
}

#[derive(Debug, Serialize)]
pub struct RoomTypeSummary {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomRequest {
    pub room_type_id: Uuid,
    #[validate(length(min = 1, max = 20, message = "roomNumber must be 1-20 characters"))]
    pub room_number: String,
    pub floor: Option<i32>,
    pub notes: Option<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoomRequest {
    pub room_type_id: Option<Uuid>,
    #[validate(length(min = 1, max = 20, message = "roomNumber must be 1-20 characters"))]
    pub room_number: Option<String>,
    pub floor: Option<i32>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

// ============================================================================
// DTOs — Blocked Dates
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ListBlockedDatesQuery {
    /// Inclusive start of the date range. Defaults to "today" when omitted.
    #[serde(rename = "startDate")]
    pub start_date: Option<NaiveDate>,
    /// Inclusive end of the date range. Defaults to start + 31 days when
    /// omitted.
    #[serde(rename = "endDate")]
    pub end_date: Option<NaiveDate>,
    /// Restrict to rooms of a particular room type — useful when the
    /// availability calendar is filtered.
    #[serde(rename = "roomTypeId")]
    pub room_type_id: Option<Uuid>,
}

/// One blocked date entry returned to the frontend. Shape mirrors the
/// `BlockedDateItem` interface in `RoomAvailability.tsx`.
#[derive(Debug, Serialize)]
pub struct BlockedDateItem {
    pub id: Uuid,
    #[serde(rename = "roomId")]
    pub room_id: Uuid,
    #[serde(rename = "blockedDate")]
    pub blocked_date: NaiveDate,
    pub reason: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    /// Schema does not currently track who created the block; always
    /// `null`. Frontend already handles this as optional.
    #[serde(rename = "createdBy")]
    pub created_by: Option<Uuid>,
}

/// Grouped-by-room response shape — matches `RoomBlockedDates` in the
/// frontend (`{ roomId, roomNumber, dates: [...] }`).
#[derive(Debug, Serialize)]
pub struct RoomBlockedDatesGroup {
    #[serde(rename = "roomId")]
    pub room_id: Uuid,
    #[serde(rename = "roomNumber")]
    pub room_number: String,
    pub dates: Vec<BlockedDateItem>,
}

#[derive(Debug, Deserialize)]
pub struct BlockDatesRequest {
    #[serde(rename = "roomId")]
    pub room_id: Uuid,
    /// One or more dates to block. The frontend sends the dates the admin
    /// dragged-selected on the calendar.
    pub dates: Vec<NaiveDate>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnblockDatesRequest {
    #[serde(rename = "roomId")]
    pub room_id: Uuid,
    pub dates: Vec<NaiveDate>,
}

// ============================================================================
// Handlers — Room Types
// ============================================================================

/// `GET /api/admin/room-types`
///
/// Returns all room types ordered by sort_order then name. When
/// `include_inactive=false` only `is_active=true` rows are returned.
async fn list_room_types(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<ListRoomTypesQuery>,
) -> AppResult<Json<Vec<RoomTypeResponse>>> {
    require_admin(&user)?;

    // One query with a NULL-tolerant predicate so the macro can compile-time
    // check it. `$1` is the include-inactive flag — when true, the second
    // half of the OR short-circuits to keep every row; when false, only
    // `is_active = TRUE` rows survive.
    let rows = sqlx::query!(
        r#"
        SELECT id, name, description, price_per_night, max_guests,
               bed_type, amenities, images, is_active, sort_order,
               created_at, updated_at
          FROM room_types
         WHERE ($1::boolean OR is_active = TRUE)
         ORDER BY sort_order ASC, LOWER(name) ASC
        "#,
        query.include_inactive,
    )
    .fetch_all(state.db())
    .await?;

    let response = rows
        .into_iter()
        .map(|r| RoomTypeResponse {
            id: r.id,
            name: r.name,
            description: r.description,
            price_per_night: r.price_per_night,
            max_guests: r.max_guests,
            bed_type: r.bed_type,
            amenities: r.amenities,
            images: r.images,
            is_active: r.is_active,
            sort_order: r.sort_order,
            created_at: r.created_at.unwrap_or_else(Utc::now),
            updated_at: r.updated_at.unwrap_or_else(Utc::now),
        })
        .collect();

    Ok(Json(response))
}

/// `POST /api/admin/room-types`
///
/// Creates a room type. Returns 201 with the created row.
/// 409 if the name (case-insensitively) is already taken — the
/// `idx_room_types_name` unique index enforces this.
async fn create_room_type(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateRoomTypeRequest>,
) -> AppResult<(StatusCode, Json<RoomTypeResponse>)> {
    require_admin(&user)?;
    payload.validate()?;

    let row = sqlx::query!(
        r#"
        INSERT INTO room_types (
            name, description, price_per_night, max_guests,
            bed_type, amenities, images, is_active, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, name, description, price_per_night, max_guests,
                  bed_type, amenities, images, is_active, sort_order,
                  created_at, updated_at
        "#,
        payload.name,
        payload.description,
        payload.price_per_night,
        payload.max_guests,
        payload.bed_type,
        &payload.amenities,
        &payload.images,
        payload.is_active,
        payload.sort_order,
    )
    .fetch_one(state.db())
    .await
    .map_err(map_room_type_conflict)?;

    let response = RoomTypeResponse {
        id: row.id,
        name: row.name,
        description: row.description,
        price_per_night: row.price_per_night,
        max_guests: row.max_guests,
        bed_type: row.bed_type,
        amenities: row.amenities,
        images: row.images,
        is_active: row.is_active,
        sort_order: row.sort_order,
        created_at: row.created_at.unwrap_or_else(Utc::now),
        updated_at: row.updated_at.unwrap_or_else(Utc::now),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

/// `PATCH /api/admin/room-types/:id`
///
/// Partial update: only the fields present in the body are touched. Uses
/// `COALESCE($n, current_value)` so absent fields are preserved without
/// reading the row first.
///
/// 404 if the id doesn't exist; 409 if a name change collides with another
/// existing room type.
async fn update_room_type(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateRoomTypeRequest>,
) -> AppResult<Json<RoomTypeResponse>> {
    require_admin(&user)?;
    payload.validate()?;

    let row = sqlx::query!(
        r#"
        UPDATE room_types
           SET name            = COALESCE($2, name),
               description     = COALESCE($3, description),
               price_per_night = COALESCE($4, price_per_night),
               max_guests      = COALESCE($5, max_guests),
               bed_type        = COALESCE($6, bed_type),
               amenities       = COALESCE($7, amenities),
               images           = COALESCE($8, images),
               is_active       = COALESCE($9, is_active),
               sort_order      = COALESCE($10, sort_order),
               updated_at      = NOW()
         WHERE id = $1
         RETURNING id, name, description, price_per_night, max_guests,
                   bed_type, amenities, images, is_active, sort_order,
                   created_at, updated_at
        "#,
        id,
        payload.name,
        payload.description,
        payload.price_per_night,
        payload.max_guests,
        payload.bed_type,
        payload.amenities.as_deref(),
        payload.images.as_deref(),
        payload.is_active,
        payload.sort_order,
    )
    .fetch_optional(state.db())
    .await
    .map_err(map_room_type_conflict)?
    .ok_or_else(|| AppError::NotFound("Room type".to_string()))?;

    Ok(Json(RoomTypeResponse {
        id: row.id,
        name: row.name,
        description: row.description,
        price_per_night: row.price_per_night,
        max_guests: row.max_guests,
        bed_type: row.bed_type,
        amenities: row.amenities,
        images: row.images,
        is_active: row.is_active,
        sort_order: row.sort_order,
        created_at: row.created_at.unwrap_or_else(Utc::now),
        updated_at: row.updated_at.unwrap_or_else(Utc::now),
    }))
}

#[derive(Debug, Serialize)]
struct RoomsAttachedConflict {
    /// Number of rooms currently referencing this room type. The frontend
    /// surfaces this so the admin knows how many rooms need to be removed
    /// or reassigned first.
    #[serde(rename = "roomsAttached")]
    rooms_attached: i64,
}

/// `DELETE /api/admin/room-types/:id`
///
/// Rejects with 409 Conflict when one or more rooms still reference the
/// room type. The FK declares `ON DELETE CASCADE`, which would silently
/// nuke those rooms — almost certainly never what an admin wants. We
/// instead force the admin to delete or reassign the rooms first.
async fn delete_room_type(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<axum::response::Response> {
    require_admin(&user)?;

    // Check for attached rooms first so we can return a structured 409 body.
    // Run inside a transaction so the count + delete are consistent if
    // another writer is racing us.
    let mut tx = state.db().begin().await?;

    let attached: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM rooms WHERE room_type_id = $1"#,
        id
    )
    .fetch_one(&mut *tx)
    .await?;

    if attached > 0 {
        tx.rollback().await?;
        return Ok((
            StatusCode::CONFLICT,
            Json(RoomsAttachedConflict {
                rooms_attached: attached,
            }),
        )
            .into_response());
    }

    let deleted = sqlx::query!("DELETE FROM room_types WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;

    if deleted.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(AppError::NotFound("Room type".to_string()));
    }

    tx.commit().await?;
    Ok((StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response())
}

// ============================================================================
// Handlers — Rooms
// ============================================================================

/// `GET /api/admin/rooms`
///
/// Returns all rooms (joined with their room type for the `roomType.name`
/// field the frontend wants), optionally filtered by `roomTypeId` and
/// active flag. Ordered by room number for stable display.
async fn list_rooms(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<ListRoomsQuery>,
) -> AppResult<Json<Vec<RoomResponse>>> {
    require_admin(&user)?;

    // Single compile-time-checked query. `$1::uuid IS NULL` collapses the
    // room-type filter when no id is provided; `$2::boolean` short-circuits
    // the include-inactive flag.
    let rows = sqlx::query!(
        r#"
        SELECT r.id, r.room_type_id, r.room_number, r.floor, r.notes,
               r.is_active, r.created_at, r.updated_at,
               rt.name AS rt_name
          FROM rooms r
          JOIN room_types rt ON rt.id = r.room_type_id
         WHERE ($1::uuid IS NULL OR r.room_type_id = $1)
           AND ($2::boolean OR r.is_active = TRUE)
         ORDER BY LENGTH(r.room_number), r.room_number ASC
        "#,
        query.room_type_id,
        query.include_inactive,
    )
    .fetch_all(state.db())
    .await?;

    let response = rows
        .into_iter()
        .map(|r| RoomResponse {
            id: r.id,
            room_type_id: r.room_type_id,
            room_number: r.room_number,
            floor: r.floor,
            notes: r.notes,
            is_active: r.is_active,
            created_at: r.created_at.unwrap_or_else(Utc::now),
            updated_at: r.updated_at.unwrap_or_else(Utc::now),
            room_type: Some(RoomTypeSummary {
                id: r.room_type_id,
                name: r.rt_name,
            }),
        })
        .collect();

    Ok(Json(response))
}

/// `POST /api/admin/rooms`
///
/// Creates a physical room. Returns 201 with the row. 404 if the
/// `room_type_id` does not exist; 409 if the `room_number` is already
/// taken (UNIQUE constraint on `rooms.room_number`).
async fn create_room(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateRoomRequest>,
) -> AppResult<(StatusCode, Json<RoomResponse>)> {
    require_admin(&user)?;
    payload.validate()?;

    // Verify the room type exists. The FK would also catch this, but the
    // explicit check returns a friendlier 404 with a clear resource name.
    let room_type = sqlx::query!(
        r#"SELECT id, name FROM room_types WHERE id = $1"#,
        payload.room_type_id
    )
    .fetch_optional(state.db())
    .await?;
    let room_type = room_type.ok_or_else(|| AppError::NotFound("Room type".to_string()))?;

    let row = sqlx::query!(
        r#"
        INSERT INTO rooms (room_type_id, room_number, floor, notes, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, room_type_id, room_number, floor, notes, is_active,
                  created_at, updated_at
        "#,
        payload.room_type_id,
        payload.room_number,
        payload.floor,
        payload.notes,
        payload.is_active,
    )
    .fetch_one(state.db())
    .await
    .map_err(map_room_conflict)?;

    let response = RoomResponse {
        id: row.id,
        room_type_id: row.room_type_id,
        room_number: row.room_number,
        floor: row.floor,
        notes: row.notes,
        is_active: row.is_active,
        created_at: row.created_at.unwrap_or_else(Utc::now),
        updated_at: row.updated_at.unwrap_or_else(Utc::now),
        room_type: Some(RoomTypeSummary {
            id: room_type.id,
            name: room_type.name,
        }),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

/// `PATCH /api/admin/rooms/:id`
///
/// Partial update: only the fields present in the body are touched.
/// 404 when the id doesn't exist; 409 when room_number collides.
async fn update_room(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateRoomRequest>,
) -> AppResult<Json<RoomResponse>> {
    require_admin(&user)?;
    payload.validate()?;

    // If a room_type_id is being changed, verify it exists first (FK would
    // throw a 500-shaped error otherwise).
    if let Some(rt_id) = payload.room_type_id {
        let exists = sqlx::query_scalar!(r#"SELECT id FROM room_types WHERE id = $1"#, rt_id)
            .fetch_optional(state.db())
            .await?;
        if exists.is_none() {
            return Err(AppError::NotFound("Room type".to_string()));
        }
    }

    let row = sqlx::query!(
        r#"
        UPDATE rooms
           SET room_type_id = COALESCE($2, room_type_id),
               room_number  = COALESCE($3, room_number),
               floor        = COALESCE($4, floor),
               notes        = COALESCE($5, notes),
               is_active    = COALESCE($6, is_active),
               updated_at   = NOW()
         WHERE id = $1
         RETURNING id, room_type_id, room_number, floor, notes, is_active,
                   created_at, updated_at
        "#,
        id,
        payload.room_type_id,
        payload.room_number,
        payload.floor,
        payload.notes,
        payload.is_active,
    )
    .fetch_optional(state.db())
    .await
    .map_err(map_room_conflict)?
    .ok_or_else(|| AppError::NotFound("Room".to_string()))?;

    let rt = sqlx::query!(
        r#"SELECT id, name FROM room_types WHERE id = $1"#,
        row.room_type_id
    )
    .fetch_optional(state.db())
    .await?;

    Ok(Json(RoomResponse {
        id: row.id,
        room_type_id: row.room_type_id,
        room_number: row.room_number,
        floor: row.floor,
        notes: row.notes,
        is_active: row.is_active,
        created_at: row.created_at.unwrap_or_else(Utc::now),
        updated_at: row.updated_at.unwrap_or_else(Utc::now),
        room_type: rt.map(|r| RoomTypeSummary {
            id: r.id,
            name: r.name,
        }),
    }))
}

#[derive(Debug, Serialize)]
struct BookingsAttachedConflict {
    /// Number of bookings currently referencing this room. The admin UI
    /// surfaces this so the operator knows how many bookings would be
    /// destroyed by the cascade — see `delete_room` for the policy.
    #[serde(rename = "bookingsAttached")]
    bookings_attached: i64,
}

/// `DELETE /api/admin/rooms/:id`
///
/// Hard delete with a preflight count of attached bookings. If any
/// bookings reference the room, the handler returns `409 Conflict` with
/// `bookingsAttached: <count>` so the admin UI can prompt the operator
/// to reassign or soft-delete instead.
///
/// LOW-3 (security-2026-05-13.md): mirrors `delete_room_type`'s
/// pattern. The previous implementation did a blind
/// `DELETE FROM rooms WHERE id = $1`, relying on the `ON DELETE CASCADE`
/// foreign key from `bookings` to do the right thing. That destroyed
/// historical booking data — including loyalty-points accrual records
/// — silently. The new check makes the admin acknowledge the data loss
/// explicitly. The recommended fallback is soft-delete via
/// `PATCH /api/admin/rooms/:id` with `is_active = false`, which leaves
/// historical bookings intact and just removes the room from new
/// availability queries.
async fn delete_room(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<axum::response::Response> {
    require_admin(&user)?;

    // Run inside a transaction so the count + delete stay consistent
    // if another writer is racing us. Same pattern as `delete_room_type`.
    let mut tx = state.db().begin().await?;

    let attached: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM bookings WHERE room_id = $1"#,
        id
    )
    .fetch_one(&mut *tx)
    .await?;

    if attached > 0 {
        tx.rollback().await?;
        return Ok((
            StatusCode::CONFLICT,
            Json(BookingsAttachedConflict {
                bookings_attached: attached,
            }),
        )
            .into_response());
    }

    let deleted = sqlx::query!("DELETE FROM rooms WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;

    if deleted.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(AppError::NotFound("Room".to_string()));
    }

    tx.commit().await?;
    Ok((StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response())
}

// ============================================================================
// Handlers — Blocked Dates
// ============================================================================

/// `GET /api/admin/blocked-dates`
///
/// Returns blocked dates for the requested range (default: today + 31
/// days), grouped by room. The frontend's `RoomAvailability.tsx` consumes
/// this exact shape (`Array<{ roomId, roomNumber, dates: [...] }>`).
async fn list_blocked_dates(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<ListBlockedDatesQuery>,
) -> AppResult<Json<Vec<RoomBlockedDatesGroup>>> {
    require_admin(&user)?;

    let start = query.start_date.unwrap_or_else(|| Utc::now().date_naive());
    let end = query
        .end_date
        .unwrap_or_else(|| start + chrono::Duration::days(31));

    if end < start {
        return Err(AppError::BadRequest(
            "endDate must be on or after startDate".to_string(),
        ));
    }

    let rows = sqlx::query!(
        r#"
        SELECT bd.id, bd.room_id, r.room_number, bd.blocked_date,
               bd.reason, bd.created_at
          FROM room_blocked_dates bd
          JOIN rooms r ON r.id = bd.room_id
         WHERE bd.blocked_date >= $1
           AND bd.blocked_date <= $2
           AND ($3::uuid IS NULL OR r.room_type_id = $3)
         ORDER BY r.room_number ASC, bd.blocked_date ASC
        "#,
        start,
        end,
        query.room_type_id,
    )
    .fetch_all(state.db())
    .await?;

    let mut groups: Vec<RoomBlockedDatesGroup> = Vec::new();
    for row in rows {
        let item = BlockedDateItem {
            id: row.id,
            room_id: row.room_id,
            blocked_date: row.blocked_date,
            reason: row.reason,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            created_by: None,
        };
        match groups.last_mut() {
            Some(g) if g.room_id == row.room_id => g.dates.push(item),
            _ => groups.push(RoomBlockedDatesGroup {
                room_id: row.room_id,
                room_number: row.room_number,
                dates: vec![item],
            }),
        }
    }

    Ok(Json(groups))
}

/// `POST /api/admin/blocked-dates`
///
/// Block one or more dates for a room. Idempotent: re-blocking an already
/// blocked date is a no-op (`ON CONFLICT DO NOTHING` against the
/// `(room_id, blocked_date)` unique key).
async fn block_dates(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<BlockDatesRequest>,
) -> AppResult<Json<Vec<BlockedDateItem>>> {
    require_admin(&user)?;

    if payload.dates.is_empty() {
        return Err(AppError::BadRequest(
            "At least one date is required".to_string(),
        ));
    }

    let room_exists = sqlx::query_scalar!(r#"SELECT id FROM rooms WHERE id = $1"#, payload.room_id)
        .fetch_optional(state.db())
        .await?;
    if room_exists.is_none() {
        return Err(AppError::NotFound("Room".to_string()));
    }

    let inserted = sqlx::query!(
        r#"
        INSERT INTO room_blocked_dates (room_id, blocked_date, reason)
        SELECT $1, d, $3
          FROM UNNEST($2::date[]) AS d
        ON CONFLICT (room_id, blocked_date) DO NOTHING
        RETURNING id, blocked_date, created_at
        "#,
        payload.room_id,
        &payload.dates,
        payload.reason,
    )
    .fetch_all(state.db())
    .await?;

    let response: Vec<BlockedDateItem> = inserted
        .into_iter()
        .map(|r| BlockedDateItem {
            id: r.id,
            room_id: payload.room_id,
            blocked_date: r.blocked_date,
            reason: payload.reason.clone(),
            created_at: r.created_at.unwrap_or_else(Utc::now),
            created_by: None,
        })
        .collect();

    Ok(Json(response))
}

#[derive(Debug, Serialize)]
pub struct UnblockDatesResponse {
    pub success: bool,
    pub deleted: u64,
}

/// `DELETE /api/admin/blocked-dates`
///
/// Unblock one or more dates for a room.
async fn unblock_dates(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Json(payload): Json<UnblockDatesRequest>,
) -> AppResult<Json<UnblockDatesResponse>> {
    require_admin(&user)?;

    if payload.dates.is_empty() {
        return Err(AppError::BadRequest(
            "At least one date is required".to_string(),
        ));
    }

    let result = sqlx::query!(
        r#"
        DELETE FROM room_blocked_dates
         WHERE room_id = $1
           AND blocked_date = ANY($2::date[])
        "#,
        payload.room_id,
        &payload.dates,
    )
    .execute(state.db())
    .await?;

    Ok(Json(UnblockDatesResponse {
        success: true,
        deleted: result.rows_affected(),
    }))
}

// ============================================================================
// Error helpers
// ============================================================================

/// Detect the room_types name unique-violation (`idx_room_types_name`) and
/// rewrite it as a 409 Conflict. Other sqlx errors pass through unchanged
/// so they surface as 500s with the original message.
fn map_room_type_conflict(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(ref db_err) = err {
        if db_err.code().as_deref() == Some("23505") {
            return AppError::Conflict("A room type with this name already exists".to_string());
        }
    }
    AppError::from(err)
}

/// Detect the rooms.room_number unique-violation and rewrite as 409.
fn map_room_conflict(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(ref db_err) = err {
        if db_err.code().as_deref() == Some("23505") {
            return AppError::Conflict("A room with this number already exists".to_string());
        }
    }
    AppError::from(err)
}

// ============================================================================
// Router
// ============================================================================

/// Build the room/room-type/blocked-dates sub-router.
pub fn router() -> Router<AppState> {
    Router::new()
        // Room types
        .route("/room-types", get(list_room_types))
        .route("/room-types", post(create_room_type))
        .route("/room-types/:id", patch(update_room_type))
        .route("/room-types/:id", delete(delete_room_type))
        // Rooms
        .route("/rooms", get(list_rooms))
        .route("/rooms", post(create_room))
        .route("/rooms/:id", patch(update_room))
        .route("/rooms/:id", delete(delete_room))
        // Blocked dates
        .route("/blocked-dates", get(list_blocked_dates))
        .route("/blocked-dates", post(block_dates))
        .route("/blocked-dates", delete(unblock_dates))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_room_types_query_default_includes_inactive() {
        let q: ListRoomTypesQuery = serde_json::from_str("{}").unwrap();
        assert!(q.include_inactive, "default should include inactive rows");
    }

    #[test]
    fn list_rooms_query_default_includes_inactive_and_no_filter() {
        let q: ListRoomsQuery = serde_json::from_str("{}").unwrap();
        assert!(q.include_inactive);
        assert!(q.room_type_id.is_none());
    }

    #[test]
    fn block_dates_request_round_trips() {
        let json = r#"{"roomId":"00000000-0000-0000-0000-000000000001","dates":["2026-06-01","2026-06-02"],"reason":"maintenance"}"#;
        let req: BlockDatesRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.dates.len(), 2);
        assert_eq!(req.reason.as_deref(), Some("maintenance"));
    }

    #[test]
    fn create_room_type_request_round_trips_camel_case() {
        let json = r#"{
            "name": "Deluxe",
            "description": "Sea view",
            "pricePerNight": "2500.00",
            "maxGuests": 2,
            "bedType": "king",
            "amenities": ["wifi", "minibar"],
            "images": ["https://example.com/1.jpg"],
            "isActive": true,
            "sortOrder": 10
        }"#;
        let req: CreateRoomTypeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "Deluxe");
        assert_eq!(req.max_guests, 2);
        assert_eq!(req.bed_type.as_deref(), Some("king"));
        assert_eq!(req.amenities, vec!["wifi", "minibar"]);
        assert_eq!(req.sort_order, 10);
    }

    #[test]
    fn create_room_type_request_validates_bed_type() {
        let req = CreateRoomTypeRequest {
            name: "Deluxe".into(),
            description: None,
            price_per_night: Decimal::new(100, 0),
            max_guests: 2,
            bed_type: Some("waterbed".into()),
            amenities: vec![],
            images: vec![],
            is_active: true,
            sort_order: 0,
        };
        assert!(req.validate().is_err(), "waterbed must fail validation");
    }

    #[test]
    fn create_room_type_request_rejects_negative_price() {
        let req = CreateRoomTypeRequest {
            name: "Deluxe".into(),
            description: None,
            price_per_night: Decimal::new(-1, 0),
            max_guests: 2,
            bed_type: None,
            amenities: vec![],
            images: vec![],
            is_active: true,
            sort_order: 0,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn create_room_request_round_trips_camel_case() {
        let json = r#"{
            "roomTypeId": "00000000-0000-0000-0000-000000000001",
            "roomNumber": "101",
            "floor": 1,
            "notes": "near elevator",
            "isActive": true
        }"#;
        let req: CreateRoomRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_number, "101");
        assert_eq!(req.floor, Some(1));
    }

    #[test]
    fn update_room_type_request_all_fields_optional() {
        let req: UpdateRoomTypeRequest = serde_json::from_str("{}").unwrap();
        assert!(req.name.is_none());
        assert!(req.price_per_night.is_none());
        assert!(req.amenities.is_none());
    }
}
