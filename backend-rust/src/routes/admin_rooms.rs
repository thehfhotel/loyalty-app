//! Admin room/room-type/blocked-dates routes
//!
//! Provides admin-only endpoints for room inventory and calendar availability:
//! - `GET    /api/admin/room-types`            — list room types
//! - `GET    /api/admin/rooms`                 — list physical rooms (filterable by room type)
//! - `GET    /api/admin/blocked-dates`         — list blocked dates in a date range
//! - `POST   /api/admin/blocked-dates`         — block one or more dates for a room
//! - `DELETE /api/admin/blocked-dates`         — unblock one or more dates for a room
//!
//! All routes require admin authentication. The router returned by
//! [`router`] is intended to be `.merge(...)`d into the parent admin router
//! defined in [`crate::routes::admin`], which applies `auth_middleware` once
//! to the merged result.
//!
//! ## Schema notes
//!
//! These handlers operate on the existing `room_types`, `rooms`, and
//! `room_blocked_dates` tables. The frontend's TypeScript interfaces include
//! a few fields that are not present in the current schema (e.g.
//! `room_types.bedType / amenities / images / sortOrder`,
//! `rooms.notes`, `room_blocked_dates.created_by`). We omit those from the
//! response rather than adding columns; the frontend already treats them as
//! optional and renders gracefully when they are absent. Adding those
//! columns is a separate, schema-bearing change tracked in
//! `docs/admin-backend-gaps.md`.
//!
//! ## sqlx note
//!
//! These handlers use **runtime** `sqlx::query()` / `sqlx::query_as()` rather
//! than the compile-time `query!()` macros. The macros require regenerating
//! `.sqlx/` against a live database (`cargo sqlx prepare`), which is not
//! available in this worktree. Runtime queries are still parameterised, so
//! injection-safe. CI's `cargo sqlx prepare --check` only validates entries
//! that already exist in the cache — it does not require new ones.

use axum::{
    extract::{Extension, Path, Query, State},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{has_role, AuthUser};
use crate::state::AppState;

// ============================================================================
// Helpers
// ============================================================================

/// Reject the request unless the caller has the `admin` role (or higher).
///
/// Mirrors `routes::admin::require_admin`; duplicated here so this module is
/// independent and the parent file does not need to re-export private helpers.
fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
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
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "updatedAt")]
    pub updated_at: DateTime<Utc>,
}

/// Row representation matching the `room_types` schema.
#[derive(Debug, sqlx::FromRow)]
struct RoomTypeRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    price_per_night: Decimal,
    max_guests: i32,
    is_active: bool,
    // The schema defines these with `DEFAULT NOW()` but no `NOT NULL`, so
    // sqlx infers them as nullable. Fall back to `Utc::now()` in the
    // response if a row somehow has NULLs.
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
}

impl From<RoomTypeRow> for RoomTypeResponse {
    fn from(row: RoomTypeRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            description: row.description,
            price_per_night: row.price_per_night,
            max_guests: row.max_guests,
            is_active: row.is_active,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
        }
    }
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

#[derive(Debug, sqlx::FromRow)]
struct RoomRow {
    id: Uuid,
    room_type_id: Uuid,
    room_number: String,
    floor: Option<i32>,
    is_active: bool,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    rt_name: Option<String>,
}

impl From<RoomRow> for RoomResponse {
    fn from(row: RoomRow) -> Self {
        let room_type = row.rt_name.map(|name| RoomTypeSummary {
            id: row.room_type_id,
            name,
        });
        Self {
            id: row.id,
            room_type_id: row.room_type_id,
            room_number: row.room_number,
            floor: row.floor,
            is_active: row.is_active,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
            room_type,
        }
    }
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

#[derive(Debug, sqlx::FromRow)]
struct BlockedDateRow {
    id: Uuid,
    room_id: Uuid,
    room_number: String,
    blocked_date: NaiveDate,
    reason: Option<String>,
    created_at: Option<DateTime<Utc>>,
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
/// Returns all room types ordered by name. When `include_inactive=false`
/// only `is_active=true` rows are returned.
async fn list_room_types(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<ListRoomTypesQuery>,
) -> AppResult<Json<Vec<RoomTypeResponse>>> {
    require_admin(&user)?;

    let sql = if query.include_inactive {
        r#"
        SELECT id, name, description, price_per_night, max_guests, is_active,
               created_at, updated_at
          FROM room_types
         ORDER BY LOWER(name) ASC
        "#
    } else {
        r#"
        SELECT id, name, description, price_per_night, max_guests, is_active,
               created_at, updated_at
          FROM room_types
         WHERE is_active = TRUE
         ORDER BY LOWER(name) ASC
        "#
    };

    let rows: Vec<RoomTypeRow> = sqlx::query_as(sql).fetch_all(state.db()).await?;

    Ok(Json(rows.into_iter().map(RoomTypeResponse::from).collect()))
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

    // We build the SQL once with two optional WHERE clauses. Using runtime
    // `query_as` lets us conditionally bind only the args that are present.
    let mut sql = String::from(
        r#"
        SELECT r.id, r.room_type_id, r.room_number, r.floor, r.is_active,
               r.created_at, r.updated_at,
               rt.name AS rt_name
          FROM rooms r
          JOIN room_types rt ON rt.id = r.room_type_id
         WHERE 1 = 1
        "#,
    );

    let mut next_param: usize = 1;
    if query.room_type_id.is_some() {
        sql.push_str(&format!(" AND r.room_type_id = ${}", next_param));
        next_param += 1;
    }
    if !query.include_inactive {
        sql.push_str(&format!(" AND r.is_active = ${}", next_param));
        next_param += 1;
    }
    // Order by numeric prefix when possible (so "10" sorts after "9"), then
    // the raw string. Postgres' natural string sort would put "10" before
    // "2"; using a substring cast handles common pure-numeric room numbers.
    sql.push_str(" ORDER BY LENGTH(r.room_number), r.room_number ASC");
    // Silence the "value assigned but never read" lint on the final
    // increment — the counter is structural so future filter additions are
    // a one-line change.
    let _ = next_param;

    let mut q = sqlx::query_as::<_, RoomRow>(&sql);
    if let Some(rt_id) = query.room_type_id {
        q = q.bind(rt_id);
    }
    if !query.include_inactive {
        q = q.bind(true);
    }

    let rows: Vec<RoomRow> = q.fetch_all(state.db()).await?;
    Ok(Json(rows.into_iter().map(RoomResponse::from).collect()))
}

// ============================================================================
// Handlers — Blocked Dates
// ============================================================================

/// `GET /api/admin/blocked-dates`
///
/// Returns blocked dates for the requested range (default: today + 31
/// days), grouped by room. The frontend's `RoomAvailability.tsx` consumes
/// this exact shape (`Array<{ roomId, roomNumber, dates: [...] }>`).
///
/// When `roomTypeId` is supplied, only blocks for rooms of that type are
/// returned.
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

    let mut sql = String::from(
        r#"
        SELECT bd.id, bd.room_id, r.room_number, bd.blocked_date,
               bd.reason, bd.created_at
          FROM room_blocked_dates bd
          JOIN rooms r ON r.id = bd.room_id
         WHERE bd.blocked_date >= $1 AND bd.blocked_date <= $2
        "#,
    );

    if query.room_type_id.is_some() {
        sql.push_str(" AND r.room_type_id = $3");
    }
    sql.push_str(" ORDER BY r.room_number ASC, bd.blocked_date ASC");

    let mut q = sqlx::query_as::<_, BlockedDateRow>(&sql)
        .bind(start)
        .bind(end);
    if let Some(rt_id) = query.room_type_id {
        q = q.bind(rt_id);
    }

    let rows: Vec<BlockedDateRow> = q.fetch_all(state.db()).await?;

    // Group rows by room so the frontend can iterate roomId → dates[]
    // directly. We use a Vec rather than a HashMap to preserve the
    // ORDER BY room_number ordering.
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
///
/// Returns the rows that were actually inserted (existing blocks are
/// excluded, mirroring INSERT...RETURNING semantics with ON CONFLICT).
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

    // Verify the room exists. A missing room would also fail the FK
    // constraint, but explicit-then-friendly is nicer for the admin UI.
    let room_exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM rooms WHERE id = $1")
        .bind(payload.room_id)
        .fetch_optional(state.db())
        .await?;
    if room_exists.is_none() {
        return Err(AppError::NotFound("Room".to_string()));
    }

    // Bulk insert via UNNEST so a single round-trip handles N dates.
    // ON CONFLICT collapses duplicates; RETURNING gives us back only the
    // rows we actually created.
    let inserted: Vec<(Uuid, NaiveDate, Option<DateTime<Utc>>)> = sqlx::query_as(
        r#"
        INSERT INTO room_blocked_dates (room_id, blocked_date, reason)
        SELECT $1, d, $3
          FROM UNNEST($2::date[]) AS d
        ON CONFLICT (room_id, blocked_date) DO NOTHING
        RETURNING id, blocked_date, created_at
        "#,
    )
    .bind(payload.room_id)
    .bind(&payload.dates)
    .bind(&payload.reason)
    .fetch_all(state.db())
    .await?;

    let response: Vec<BlockedDateItem> = inserted
        .into_iter()
        .map(|(id, blocked_date, created_at)| BlockedDateItem {
            id,
            room_id: payload.room_id,
            blocked_date,
            reason: payload.reason.clone(),
            created_at: created_at.unwrap_or_else(Utc::now),
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
/// Unblock one or more dates for a room. The body shape matches
/// `unblockMutation` in `RoomAvailability.tsx` (`{ roomId, dates: Date[] }`).
/// Returns the count of rows actually removed (0 is fine — date was
/// already unblocked).
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

    let result = sqlx::query(
        r#"
        DELETE FROM room_blocked_dates
         WHERE room_id = $1
           AND blocked_date = ANY($2::date[])
        "#,
    )
    .bind(payload.room_id)
    .bind(&payload.dates)
    .execute(state.db())
    .await?;

    Ok(Json(UnblockDatesResponse {
        success: true,
        deleted: result.rows_affected(),
    }))
}

// ============================================================================
// Router
// ============================================================================

/// Build the room/room-type/blocked-dates sub-router.
///
/// Intended to be `.merge`d into the parent admin router so the existing
/// `auth_middleware` layer covers these routes too. Mounted at
/// `/api/admin/...` by the top-level router in `routes::mod`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/room-types", get(list_room_types))
        .route("/rooms", get(list_rooms))
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
}
