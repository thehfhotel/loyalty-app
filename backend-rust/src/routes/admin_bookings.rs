//! Admin booking management routes
//!
//! Provides admin-only endpoints for the booking management UI:
//!
//! - `GET    /api/admin/bookings`               — paginated list + status counts
//! - `GET    /api/admin/bookings/room-types`    — dropdown source for the edit modal
//! - `GET    /api/admin/bookings/:id`           — full booking detail + slip + audit
//! - `PUT    /api/admin/bookings/:id`           — partial update (whitelisted fields)
//! - `POST   /api/admin/bookings/:id/discount`  — apply or update a discount
//! - `POST   /api/admin/bookings/:id/cancel`    — admin cancel (any user's booking)
//!
//! All routes require the `admin` role. The router returned by [`router`] is
//! merged into the parent admin router so the existing `auth_middleware`
//! layer covers these routes too.
//!
//! ## Auth contract: cancel — user vs admin
//!
//! The user-side `POST /api/bookings/:id/cancel` (in `routes::bookings`)
//! enforces ownership: a customer can only cancel their own booking, and
//! the booking must not already be in a terminal state. The admin variant
//! in this module deliberately drops the ownership check — an admin must
//! be able to cancel **any** user's booking — but still rejects
//! double-cancels. The two endpoints share a status terminality rule but
//! differ on the identity rule. Frontends that need both behaviours call
//! the route matching the caller's role; the JWT carries the role, so the
//! handler never has to negotiate.
//!
//! ## Audit log
//!
//! Every state-changing operation (PUT, discount, cancel) writes a row to
//! `booking_audit_log` **inside the same transaction** as the underlying
//! booking mutation. If the audit insert fails, the booking update rolls
//! back too — so the on-disk state is never inconsistent with the audit.
//! The `before_data` / `after_data` JSONB columns only contain the fields
//! the action actually changed, keeping rows small and the audit history
//! tab in the edit modal easy to render.
//!
//! ## sqlx note
//!
//! Compile-time `sqlx::query!` / `sqlx::query_as!` macros, validated
//! against the offline cache in `backend-rust/.sqlx/`. After adding or
//! changing a query, run `backend-rust/scripts/regen-sqlx-cache.sh` and
//! commit the resulting `.sqlx/*.json` files. CI runs `cargo sqlx prepare
//! --check`.

use axum::{
    extract::{Extension, Path, Query, State},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{has_role, AuthUser};
use crate::state::AppState;

// ============================================================================
// Helpers
// ============================================================================

/// Reject the request unless the caller has the `admin` role (or higher).
///
/// Mirrors `routes::admin::require_admin`. Duplicated so this module stays
/// independent of the parent file's private helpers.
fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }
    Ok(())
}

/// Parse the JWT subject into a UUID, surfacing a 401 (not 500) if the
/// token shape is unexpected.
fn auth_user_uuid(user: &AuthUser) -> AppResult<Uuid> {
    Uuid::parse_str(&user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))
}

/// Map an internal status enum string to one of the three buckets the
/// admin UI cares about. The bookings table allows seven values
/// (`pending`, `confirmed`, `checked_in`, `checked_out`, `completed`,
/// `cancelled`, `no_show`); the management page only renders three
/// tabs — confirmed / cancelled / completed. We treat the
/// pre-stay states as `confirmed`, terminal-positive as `completed`,
/// and `cancelled` / `no_show` as `cancelled` so every row lands in a
/// tab without losing information.
fn normalize_status(raw: &str) -> &'static str {
    match raw {
        "cancelled" | "no_show" => "cancelled",
        "completed" | "checked_out" => "completed",
        _ => "confirmed",
    }
}

// ============================================================================
// DTOs — List
// ============================================================================

/// Query parameters for `GET /api/admin/bookings`.
///
/// The frontend's React-Query key is
/// `{ page, limit, search, status, sortBy, sortOrder }`, so we keep the
/// field names aligned. `search` looks across the booking's user
/// (first/last name, email, membership_id) and the booking id prefix.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBookingsQuery {
    #[serde(default = "default_page")]
    pub page: i32,
    #[serde(default = "default_limit")]
    pub limit: i32,
    pub search: Option<String>,
    /// One of `confirmed` / `cancelled` / `completed` — the three tabs the
    /// management UI renders. Anything else is treated as "no filter".
    pub status: Option<String>,
    /// `created_at` / `check_in_date` / `room_type` / `status` /
    /// `total_price` / `user_name`. Anything else falls back to
    /// `created_at`.
    #[serde(default = "default_sort_by")]
    pub sort_by: String,
    /// `asc` or `desc` (case-insensitive). Defaults to `desc`.
    #[serde(default = "default_sort_order")]
    pub sort_order: String,
}

fn default_page() -> i32 {
    1
}
fn default_limit() -> i32 {
    10
}
fn default_sort_by() -> String {
    "created_at".to_string()
}
fn default_sort_order() -> String {
    "desc".to_string()
}

/// Per-tab counts surfaced under `statusCounts` on the list response —
/// used by the management page to render the tab badges.
#[derive(Debug, Serialize)]
pub struct StatusCounts {
    pub all: i64,
    pub confirmed: i64,
    pub cancelled: i64,
    pub completed: i64,
}

/// List response — flat shape matching what `BookingManagement.tsx`
/// destructures: `{ bookings, total, statusCounts }`. `page` and `limit`
/// are echoed back so the UI can sanity-check what it got versus what it
/// requested.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBookingsResponse {
    pub bookings: Vec<AdminBookingListItem>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub status_counts: StatusCounts,
}

// ============================================================================
// DTOs — Item / Detail
// ============================================================================

/// Embedded user summary on each booking row.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingUser {
    pub id: Uuid,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub membership_id: Option<String>,
    pub phone: Option<String>,
}

/// Embedded room-type summary so the list/detail can render the type name
/// without a second roundtrip. Matches `BookingManagement.tsx`'s `RoomType`
/// interface (`{ id, name }`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingRoomType {
    pub id: Uuid,
    pub name: String,
}

/// Primary (most-recent) slip summary, surfaced inline on each row so the
/// management table's "slip status" column doesn't need an N+1 lookup.
/// `None` when the booking has no slips attached.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingSlipSummary {
    pub id: Uuid,
    pub image_url: String,
    pub uploaded_at: DateTime<Utc>,
    pub slipok_status: Option<String>,
    pub slipok_verified_at: Option<DateTime<Utc>>,
    pub admin_status: Option<String>,
    pub admin_verified_at: Option<DateTime<Utc>>,
    pub admin_verified_by: Option<Uuid>,
    pub admin_verified_by_name: Option<String>,
}

/// One row in the booking list. The full edit modal also reads from this
/// shape — we don't have a separate "detail" type because there's no
/// per-row data the modal needs that the list doesn't already include.
/// (Audit history is loaded by the detail endpoint separately.)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingListItem {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user: AdminBookingUser,
    pub room_type_id: Uuid,
    pub room_type: AdminBookingRoomType,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub number_of_guests: i32,
    pub total_price: Decimal,
    pub payment_type: Option<String>,
    pub payment_amount: Option<Decimal>,
    pub discount_amount: Option<Decimal>,
    pub discount_reason: Option<String>,
    /// One of `confirmed` / `cancelled` / `completed` (normalised from
    /// the seven raw statuses).
    pub status: String,
    pub notes: Option<String>,
    pub admin_notes: Option<String>,
    pub slip: Option<AdminBookingSlipSummary>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A single audit-log entry as surfaced to the edit modal.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingAuditEntry {
    pub id: Uuid,
    pub action: String,
    pub admin_id: Uuid,
    pub admin_name: String,
    /// JSON-encoded snapshot of the changed fields *before* the action;
    /// `null` for actions that don't have a meaningful "before" (e.g.
    /// initial creation).
    pub old_value: Option<String>,
    /// JSON-encoded snapshot of the changed fields *after* the action.
    pub new_value: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Full detail response = list-item shape + audit history.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingDetail {
    #[serde(flatten)]
    pub booking: AdminBookingListItem,
    pub audit_history: Vec<AdminBookingAuditEntry>,
}

// ============================================================================
// DTOs — Mutations
// ============================================================================

/// PUT body. All fields optional — we only update what's provided so the
/// modal can save just the fields the admin touched. Fields the schema
/// doesn't currently support (e.g. roomChanges arrays) are documented in
/// `docs/admin-backend-gaps.md` as a follow-up.
#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookingRequest {
    pub check_in_date: Option<NaiveDate>,
    pub check_out_date: Option<NaiveDate>,
    #[validate(range(min = 1, max = 100, message = "guests must be between 1 and 100"))]
    pub number_of_guests: Option<i32>,
    pub room_type_id: Option<Uuid>,
    pub notes: Option<String>,
    pub admin_notes: Option<String>,
    pub total_price: Option<Decimal>,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDiscountRequest {
    /// Discount amount in THB. Must be > 0 and <= the booking total
    /// (checked in the handler since the total isn't a request field).
    #[validate(range(min = 0.01, message = "discountAmount must be greater than 0"))]
    pub discount_amount: f64,
    #[validate(length(min = 1, max = 500, message = "reason is required (1-500 chars)"))]
    pub reason: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CancelBookingRequest {
    /// Optional free-text reason; recorded both on the booking row and
    /// the audit log entry.
    #[validate(length(max = 1000, message = "reason must be 1000 characters or fewer"))]
    pub reason: Option<String>,
}

// ============================================================================
// Row types
// ============================================================================

/// Row shape returned by the list/detail SELECT. Field order matches the
/// SELECT exactly so the `sqlx::query_as!` macro maps cleanly.
struct BookingRow {
    id: Uuid,
    user_id: Uuid,
    room_type_id: Uuid,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    num_guests: i32,
    total_price: Decimal,
    payment_type: Option<String>,
    payment_amount: Option<Decimal>,
    discount_amount: Option<Decimal>,
    discount_reason: Option<String>,
    status: String,
    notes: Option<String>,
    admin_notes: Option<String>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    // joined user (LEFT JOIN, so first_name/last_name/membership_id/phone
    // can be NULL even though the FK guarantees a user row exists)
    user_email: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    membership_id: Option<String>,
    phone: Option<String>,
    // joined room type
    rt_name: String,
    // most-recent slip (LEFT JOIN LATERAL — see queries below)
    slip_id: Option<Uuid>,
    slip_url: Option<String>,
    slip_uploaded_at: Option<DateTime<Utc>>,
    slip_slipok_status: Option<String>,
    slip_slipok_verified_at: Option<DateTime<Utc>>,
    slip_admin_status: Option<String>,
    slip_admin_verified_at: Option<DateTime<Utc>>,
    slip_admin_verified_by: Option<Uuid>,
    slip_admin_verified_by_name: Option<String>,
}

impl From<BookingRow> for AdminBookingListItem {
    fn from(row: BookingRow) -> Self {
        let slip = row.slip_id.map(|id| AdminBookingSlipSummary {
            id,
            image_url: row.slip_url.unwrap_or_default(),
            uploaded_at: row.slip_uploaded_at.unwrap_or_else(Utc::now),
            slipok_status: row.slip_slipok_status,
            slipok_verified_at: row.slip_slipok_verified_at,
            admin_status: row.slip_admin_status,
            admin_verified_at: row.slip_admin_verified_at,
            admin_verified_by: row.slip_admin_verified_by,
            admin_verified_by_name: row.slip_admin_verified_by_name,
        });

        let status = normalize_status(&row.status).to_string();

        AdminBookingListItem {
            id: row.id,
            user_id: row.user_id,
            user: AdminBookingUser {
                id: row.user_id,
                first_name: row.first_name,
                last_name: row.last_name,
                email: row.user_email,
                membership_id: row.membership_id,
                phone: row.phone,
            },
            room_type_id: row.room_type_id,
            room_type: AdminBookingRoomType {
                id: row.room_type_id,
                name: row.rt_name,
            },
            check_in_date: row.check_in_date,
            check_out_date: row.check_out_date,
            number_of_guests: row.num_guests,
            total_price: row.total_price,
            payment_type: row.payment_type,
            payment_amount: row.payment_amount,
            discount_amount: row.discount_amount,
            discount_reason: row.discount_reason,
            status,
            notes: row.notes,
            admin_notes: row.admin_notes,
            slip,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
        }
    }
}

// ============================================================================
// Handlers — Read
// ============================================================================

/// `GET /api/admin/bookings`
///
/// Returns a page of bookings plus the per-tab counts. Filters are inline
/// in the SQL (`$N::text IS NULL OR …`) so the query stays static — a
/// requirement for `sqlx::query_as!`. Sort field/direction are validated
/// to a small allow-list, then expanded into a `CASE WHEN sort_by = 'x'
/// THEN expr` so we still get compile-time checking.
async fn list_bookings(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Query(query): Query<ListBookingsQuery>,
) -> AppResult<Json<ListBookingsResponse>> {
    require_admin(&user)?;

    let page = query.page.max(1);
    let limit = query.limit.clamp(1, 200);
    let offset = (page - 1) * limit;

    // Validate sort + status filters to a known allow-list.
    let sort_by = match query.sort_by.as_str() {
        "created_at" | "check_in_date" | "room_type" | "status" | "total_price" | "user_name" => {
            query.sort_by.as_str()
        },
        _ => "created_at",
    };
    let sort_desc = !matches!(query.sort_order.to_lowercase().as_str(), "asc");

    // Map the frontend tab status to the raw enum subset it covers.
    let raw_statuses: Option<Vec<String>> = match query.status.as_deref() {
        Some("confirmed") => Some(vec![
            "pending".into(),
            "confirmed".into(),
            "checked_in".into(),
        ]),
        Some("cancelled") => Some(vec!["cancelled".into(), "no_show".into()]),
        Some("completed") => Some(vec!["completed".into(), "checked_out".into()]),
        _ => None,
    };

    let search_pattern = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s.to_lowercase()));

    // ---- Total count (filtered) -------------------------------------------
    // Run a count query that mirrors the row filters so the UI's pagination
    // is exact. `&raw_statuses.as_deref()` produces an `Option<&[String]>`
    // and Postgres treats `NULL = ANY(arr)` as the no-filter sentinel.
    let total: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!: i64"
          FROM bookings b
          LEFT JOIN users u           ON u.id = b.user_id
          LEFT JOIN user_profiles up  ON up.user_id = b.user_id
         WHERE ($1::text[] IS NULL OR b.status = ANY($1))
           AND (
             $2::text IS NULL
             OR LOWER(COALESCE(u.email, ''))         LIKE $2
             OR LOWER(COALESCE(up.first_name, ''))   LIKE $2
             OR LOWER(COALESCE(up.last_name, ''))    LIKE $2
             OR LOWER(COALESCE(up.membership_id, '')) LIKE $2
             OR LOWER(b.id::text)                    LIKE $2
           )
        "#,
        raw_statuses.as_deref(),
        search_pattern.as_deref(),
    )
    .fetch_one(state.db())
    .await?;

    // ---- Status-bucket counts (unfiltered by tab; respects search) --------
    // Surfaces the four counts the tab badges read. We keep these honest
    // to the search term but ignore the current tab filter so switching
    // tabs doesn't change the numbers.
    let counts_row = sqlx::query!(
        r#"
        SELECT
          COUNT(*) FILTER (WHERE b.status IN ('pending', 'confirmed', 'checked_in'))
            AS "confirmed!: i64",
          COUNT(*) FILTER (WHERE b.status IN ('cancelled', 'no_show'))
            AS "cancelled!: i64",
          COUNT(*) FILTER (WHERE b.status IN ('completed', 'checked_out'))
            AS "completed!: i64",
          COUNT(*)
            AS "all!: i64"
          FROM bookings b
          LEFT JOIN users u           ON u.id = b.user_id
          LEFT JOIN user_profiles up  ON up.user_id = b.user_id
         WHERE (
             $1::text IS NULL
             OR LOWER(COALESCE(u.email, ''))         LIKE $1
             OR LOWER(COALESCE(up.first_name, ''))   LIKE $1
             OR LOWER(COALESCE(up.last_name, ''))    LIKE $1
             OR LOWER(COALESCE(up.membership_id, '')) LIKE $1
             OR LOWER(b.id::text)                    LIKE $1
           )
        "#,
        search_pattern.as_deref(),
    )
    .fetch_one(state.db())
    .await?;

    let status_counts = StatusCounts {
        all: counts_row.all,
        confirmed: counts_row.confirmed,
        cancelled: counts_row.cancelled,
        completed: counts_row.completed,
    };

    // ---- Page rows --------------------------------------------------------
    // The ORDER BY is expressed via a `CASE` so the column is parameter-
    // driven without resorting to runtime string interpolation. Two CASE
    // chains (one ASC, one DESC) keep the macro happy; only one chain is
    // active per query thanks to the boolean guard.
    let rows = sqlx::query_as!(
        BookingRow,
        r#"
        SELECT
            b.id                            AS "id!",
            b.user_id                       AS "user_id!",
            b.room_type_id                  AS "room_type_id!",
            b.check_in_date                 AS "check_in_date!",
            b.check_out_date                AS "check_out_date!",
            b.num_guests                    AS "num_guests!",
            b.total_price                   AS "total_price!",
            b.payment_type                  AS "payment_type?",
            b.payment_amount                AS "payment_amount?",
            b.discount_amount               AS "discount_amount?",
            b.discount_reason               AS "discount_reason?",
            b.status                        AS "status!",
            b.notes                         AS "notes?",
            b.admin_notes                   AS "admin_notes?",
            b.created_at                    AS "created_at?",
            b.updated_at                    AS "updated_at?",
            u.email                         AS "user_email?",
            up.first_name                   AS "first_name?",
            up.last_name                    AS "last_name?",
            up.membership_id                AS "membership_id?",
            up.phone                        AS "phone?",
            rt.name                         AS "rt_name!",
            s.id                            AS "slip_id?",
            s.slip_url                      AS "slip_url?",
            s.uploaded_at                   AS "slip_uploaded_at?",
            s.slipok_status                 AS "slip_slipok_status?",
            s.slipok_verified_at            AS "slip_slipok_verified_at?",
            s.admin_status                  AS "slip_admin_status?",
            s.admin_verified_at             AS "slip_admin_verified_at?",
            s.admin_verified_by             AS "slip_admin_verified_by?",
            (vup.first_name || ' ' || vup.last_name) AS "slip_admin_verified_by_name?"
          FROM bookings b
          JOIN room_types rt              ON rt.id = b.room_type_id
          LEFT JOIN users u               ON u.id = b.user_id
          LEFT JOIN user_profiles up      ON up.user_id = b.user_id
          LEFT JOIN LATERAL (
              SELECT *
                FROM booking_slips bs
               WHERE bs.booking_id = b.id
               ORDER BY bs.uploaded_at DESC NULLS LAST, bs.created_at DESC NULLS LAST
               LIMIT 1
          ) s ON TRUE
          LEFT JOIN user_profiles vup     ON vup.user_id = s.admin_verified_by
         WHERE ($1::text[] IS NULL OR b.status = ANY($1))
           AND (
             $2::text IS NULL
             OR LOWER(COALESCE(u.email, ''))         LIKE $2
             OR LOWER(COALESCE(up.first_name, ''))   LIKE $2
             OR LOWER(COALESCE(up.last_name, ''))    LIKE $2
             OR LOWER(COALESCE(up.membership_id, '')) LIKE $2
             OR LOWER(b.id::text)                    LIKE $2
           )
         ORDER BY
            CASE WHEN $4::bool AND $3 = 'created_at'    THEN b.created_at    END DESC NULLS LAST,
            CASE WHEN $4::bool AND $3 = 'check_in_date' THEN b.check_in_date END DESC NULLS LAST,
            CASE WHEN $4::bool AND $3 = 'room_type'     THEN rt.name         END DESC NULLS LAST,
            CASE WHEN $4::bool AND $3 = 'status'        THEN b.status        END DESC NULLS LAST,
            CASE WHEN $4::bool AND $3 = 'total_price'   THEN b.total_price   END DESC NULLS LAST,
            CASE WHEN $4::bool AND $3 = 'user_name'
                 THEN COALESCE(up.last_name, '') || ' ' || COALESCE(up.first_name, '') END DESC NULLS LAST,
            CASE WHEN NOT $4::bool AND $3 = 'created_at'    THEN b.created_at    END ASC NULLS LAST,
            CASE WHEN NOT $4::bool AND $3 = 'check_in_date' THEN b.check_in_date END ASC NULLS LAST,
            CASE WHEN NOT $4::bool AND $3 = 'room_type'     THEN rt.name         END ASC NULLS LAST,
            CASE WHEN NOT $4::bool AND $3 = 'status'        THEN b.status        END ASC NULLS LAST,
            CASE WHEN NOT $4::bool AND $3 = 'total_price'   THEN b.total_price   END ASC NULLS LAST,
            CASE WHEN NOT $4::bool AND $3 = 'user_name'
                 THEN COALESCE(up.last_name, '') || ' ' || COALESCE(up.first_name, '') END ASC NULLS LAST,
            b.id ASC
         LIMIT $5 OFFSET $6
        "#,
        raw_statuses.as_deref(),
        search_pattern.as_deref(),
        sort_by,
        sort_desc,
        limit as i64,
        offset as i64,
    )
    .fetch_all(state.db())
    .await?;

    let bookings: Vec<AdminBookingListItem> = rows.into_iter().map(Into::into).collect();

    Ok(Json(ListBookingsResponse {
        bookings,
        total,
        page,
        limit,
        status_counts,
    }))
}

/// `GET /api/admin/bookings/room-types`
///
/// Convenience alias for the dropdown the edit modal opens. Returns the
/// minimal `{ id, name }` shape; the management page that needs the full
/// row uses `/api/admin/room-types` directly. We keep this scoped to
/// active room types — the modal would otherwise let admins select a
/// hidden type.
async fn list_room_types_for_modal(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> AppResult<Json<Vec<AdminBookingRoomType>>> {
    require_admin(&user)?;

    let rows = sqlx::query!(
        r#"
        SELECT id AS "id!", name AS "name!"
          FROM room_types
         WHERE is_active
         ORDER BY LOWER(name) ASC
        "#,
    )
    .fetch_all(state.db())
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|r| AdminBookingRoomType {
                id: r.id,
                name: r.name,
            })
            .collect(),
    ))
}

/// `GET /api/admin/bookings/:id`
///
/// Full detail = list-item shape + the booking's audit history (newest
/// first). The audit pulls the admin's display name from
/// `user_profiles.first_name || last_name`; falls back to the email if
/// the profile row is missing.
async fn get_booking_detail(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(booking_id): Path<Uuid>,
) -> AppResult<Json<AdminBookingDetail>> {
    require_admin(&user)?;

    let row = sqlx::query_as!(
        BookingRow,
        r#"
        SELECT
            b.id                            AS "id!",
            b.user_id                       AS "user_id!",
            b.room_type_id                  AS "room_type_id!",
            b.check_in_date                 AS "check_in_date!",
            b.check_out_date                AS "check_out_date!",
            b.num_guests                    AS "num_guests!",
            b.total_price                   AS "total_price!",
            b.payment_type                  AS "payment_type?",
            b.payment_amount                AS "payment_amount?",
            b.discount_amount               AS "discount_amount?",
            b.discount_reason               AS "discount_reason?",
            b.status                        AS "status!",
            b.notes                         AS "notes?",
            b.admin_notes                   AS "admin_notes?",
            b.created_at                    AS "created_at?",
            b.updated_at                    AS "updated_at?",
            u.email                         AS "user_email?",
            up.first_name                   AS "first_name?",
            up.last_name                    AS "last_name?",
            up.membership_id                AS "membership_id?",
            up.phone                        AS "phone?",
            rt.name                         AS "rt_name!",
            s.id                            AS "slip_id?",
            s.slip_url                      AS "slip_url?",
            s.uploaded_at                   AS "slip_uploaded_at?",
            s.slipok_status                 AS "slip_slipok_status?",
            s.slipok_verified_at            AS "slip_slipok_verified_at?",
            s.admin_status                  AS "slip_admin_status?",
            s.admin_verified_at             AS "slip_admin_verified_at?",
            s.admin_verified_by             AS "slip_admin_verified_by?",
            (vup.first_name || ' ' || vup.last_name) AS "slip_admin_verified_by_name?"
          FROM bookings b
          JOIN room_types rt              ON rt.id = b.room_type_id
          LEFT JOIN users u               ON u.id = b.user_id
          LEFT JOIN user_profiles up      ON up.user_id = b.user_id
          LEFT JOIN LATERAL (
              SELECT *
                FROM booking_slips bs
               WHERE bs.booking_id = b.id
               ORDER BY bs.uploaded_at DESC NULLS LAST, bs.created_at DESC NULLS LAST
               LIMIT 1
          ) s ON TRUE
          LEFT JOIN user_profiles vup     ON vup.user_id = s.admin_verified_by
         WHERE b.id = $1
        "#,
        booking_id,
    )
    .fetch_optional(state.db())
    .await?
    .ok_or_else(|| AppError::NotFound("Booking".to_string()))?;

    let booking: AdminBookingListItem = row.into();

    let audit_history = fetch_audit_history(state.db(), booking_id).await?;

    Ok(Json(AdminBookingDetail {
        booking,
        audit_history,
    }))
}

async fn fetch_audit_history(
    db: &sqlx::PgPool,
    booking_id: Uuid,
) -> AppResult<Vec<AdminBookingAuditEntry>> {
    let rows = sqlx::query!(
        r#"
        SELECT
            al.id          AS "id!",
            al.action      AS "action!",
            al.admin_id    AS "admin_id!",
            al.before_data AS "before_data?",
            al.after_data  AS "after_data?",
            al.reason      AS "reason?",
            al.occurred_at AS "occurred_at!",
            COALESCE(NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''),
                     u.email)
                AS "admin_name?"
          FROM booking_audit_log al
          LEFT JOIN users u            ON u.id = al.admin_id
          LEFT JOIN user_profiles up   ON up.user_id = al.admin_id
         WHERE al.booking_id = $1
         ORDER BY al.occurred_at DESC, al.id DESC
        "#,
        booking_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| AdminBookingAuditEntry {
            id: r.id,
            action: r.action,
            admin_id: r.admin_id,
            admin_name: r.admin_name.unwrap_or_default(),
            old_value: r.before_data.map(|v| v.to_string()),
            new_value: r.after_data.map(|v| v.to_string()),
            notes: r.reason,
            created_at: r.occurred_at,
        })
        .collect())
}

// ============================================================================
// Handlers — Mutations
// ============================================================================

/// `PUT /api/admin/bookings/:id`
///
/// Partial update of the editable fields on a booking. Runs in a single
/// transaction together with the `booking_audit_log` insert, so the
/// audit row and the row it describes are always written atomically.
/// Fields the schema doesn't yet support (e.g. multi-room edits) are
/// silently ignored; they're tracked in `docs/admin-backend-gaps.md`.
async fn update_booking(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(booking_id): Path<Uuid>,
    Json(payload): Json<UpdateBookingRequest>,
) -> AppResult<Json<AdminBookingDetail>> {
    require_admin(&user)?;
    payload.validate().map_err(AppError::from)?;
    let admin_id = auth_user_uuid(&user)?;

    let mut tx = state.db().begin().await?;

    // Snapshot the current row (locked) so the audit's before_data is exact
    // and so concurrent admins serialise on this booking.
    let before = sqlx::query_as!(
        BeforeRow,
        r#"
        SELECT
            check_in_date  AS "check_in_date!",
            check_out_date AS "check_out_date!",
            num_guests     AS "num_guests!",
            room_type_id   AS "room_type_id!",
            notes          AS "notes?",
            admin_notes    AS "admin_notes?",
            total_price    AS "total_price!",
            status         AS "status!"
          FROM bookings
         WHERE id = $1
         FOR UPDATE
        "#,
        booking_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Booking".to_string()))?;

    // Disallow edits to terminal bookings — matches the user-side rule.
    if matches!(
        before.status.as_str(),
        "cancelled" | "no_show" | "completed" | "checked_out"
    ) {
        return Err(AppError::BadRequest(
            "Cannot update a cancelled or completed booking".to_string(),
        ));
    }

    // If room_type_id is changing, verify the new type exists and is
    // active. Sending a stale UUID would otherwise fail at FK check with
    // a 500.
    if let Some(new_rt) = payload.room_type_id {
        let exists = sqlx::query_scalar!(
            r#"SELECT id FROM room_types WHERE id = $1 AND is_active"#,
            new_rt,
        )
        .fetch_optional(&mut *tx)
        .await?;
        if exists.is_none() {
            return Err(AppError::BadRequest(
                "Selected room type does not exist or is inactive".to_string(),
            ));
        }
    }

    // Compute final values. NULL on the request = keep current.
    let new_check_in = payload.check_in_date.unwrap_or(before.check_in_date);
    let new_check_out = payload.check_out_date.unwrap_or(before.check_out_date);
    let new_guests = payload.number_of_guests.unwrap_or(before.num_guests);
    let new_room_type = payload.room_type_id.unwrap_or(before.room_type_id);
    let new_notes = match &payload.notes {
        Some(s) => Some(s.clone()),
        None => before.notes.clone(),
    };
    let new_admin_notes = match &payload.admin_notes {
        Some(s) => Some(s.clone()),
        None => before.admin_notes.clone(),
    };
    let new_total = payload.total_price.unwrap_or(before.total_price);

    if new_check_out <= new_check_in {
        return Err(AppError::Validation(
            "checkOutDate must be after checkInDate".to_string(),
        ));
    }

    // Apply the update. We touch every editable column with COALESCE so a
    // single static query handles partial payloads.
    sqlx::query!(
        r#"
        UPDATE bookings
           SET check_in_date  = $2,
               check_out_date = $3,
               num_guests     = $4,
               room_type_id   = $5,
               notes          = $6,
               admin_notes    = $7,
               total_price    = $8,
               updated_at     = NOW()
         WHERE id = $1
        "#,
        booking_id,
        new_check_in,
        new_check_out,
        new_guests,
        new_room_type,
        new_notes,
        new_admin_notes,
        new_total,
    )
    .execute(&mut *tx)
    .await?;

    // Build the before/after JSON snapshots — only fields whose value
    // actually changed are included, so an audit row never lies about
    // touching something it didn't.
    let (before_json, after_json) = build_update_diff(
        &before,
        new_check_in,
        new_check_out,
        new_guests,
        new_room_type,
        new_notes.as_deref(),
        new_admin_notes.as_deref(),
        new_total,
    );

    insert_audit_row(
        &mut *tx,
        booking_id,
        admin_id,
        "booking_updated",
        Some(before_json),
        Some(after_json),
        None,
    )
    .await?;

    tx.commit().await?;

    // Re-read the full detail through the same code path the GET uses so
    // the response always matches what a subsequent fetch would return.
    let detail = read_detail_after_mutation(state.db(), booking_id).await?;
    Ok(Json(detail))
}

/// `POST /api/admin/bookings/:id/discount`
///
/// Sets (or updates) the discount on a booking. The discount column was
/// added in the `booking_admin_fields` migration; the constraint on the
/// column rejects negatives, so the only sanity-checks left here are
/// "the value doesn't exceed the booking total" and "the booking isn't
/// terminal".
async fn apply_discount(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(booking_id): Path<Uuid>,
    Json(payload): Json<ApplyDiscountRequest>,
) -> AppResult<Json<AdminBookingDetail>> {
    require_admin(&user)?;
    payload.validate().map_err(AppError::from)?;
    let admin_id = auth_user_uuid(&user)?;

    let discount = Decimal::from_f64_retain(payload.discount_amount)
        .ok_or_else(|| AppError::Validation("discountAmount is not a valid number".to_string()))?;

    let mut tx = state.db().begin().await?;

    let before = sqlx::query!(
        r#"
        SELECT discount_amount, discount_reason, total_price, status
          FROM bookings
         WHERE id = $1
         FOR UPDATE
        "#,
        booking_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Booking".to_string()))?;

    if matches!(
        before.status.as_str(),
        "cancelled" | "no_show" | "completed" | "checked_out"
    ) {
        return Err(AppError::BadRequest(
            "Cannot apply a discount to a cancelled or completed booking".to_string(),
        ));
    }

    if discount > before.total_price {
        return Err(AppError::Validation(
            "discountAmount cannot exceed the booking total".to_string(),
        ));
    }

    sqlx::query!(
        r#"
        UPDATE bookings
           SET discount_amount = $2,
               discount_reason = $3,
               updated_at      = NOW()
         WHERE id = $1
        "#,
        booking_id,
        discount,
        payload.reason,
    )
    .execute(&mut *tx)
    .await?;

    let before_json = json!({
        "discountAmount": before.discount_amount,
        "discountReason": before.discount_reason,
    });
    let after_json = json!({
        "discountAmount": discount,
        "discountReason": payload.reason,
    });

    insert_audit_row(
        &mut *tx,
        booking_id,
        admin_id,
        "discount_applied",
        Some(before_json),
        Some(after_json),
        Some(payload.reason.clone()),
    )
    .await?;

    tx.commit().await?;

    let detail = read_detail_after_mutation(state.db(), booking_id).await?;
    Ok(Json(detail))
}

/// `POST /api/admin/bookings/:id/cancel`
///
/// Admin-only cancel: no ownership check (the user-side route in
/// `routes::bookings` enforces ownership; admins use this one). Refuses
/// to double-cancel an already-cancelled booking.
async fn cancel_booking(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(booking_id): Path<Uuid>,
    Json(payload): Json<CancelBookingRequest>,
) -> AppResult<Json<AdminBookingDetail>> {
    require_admin(&user)?;
    payload.validate().map_err(AppError::from)?;
    let admin_id = auth_user_uuid(&user)?;

    let mut tx = state.db().begin().await?;

    let before = sqlx::query!(
        r#"
        SELECT status, cancellation_reason
          FROM bookings
         WHERE id = $1
         FOR UPDATE
        "#,
        booking_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Booking".to_string()))?;

    if matches!(before.status.as_str(), "cancelled" | "no_show") {
        return Err(AppError::BadRequest(
            "Booking is already cancelled".to_string(),
        ));
    }
    if matches!(before.status.as_str(), "completed" | "checked_out") {
        return Err(AppError::BadRequest(
            "Cannot cancel a completed booking".to_string(),
        ));
    }

    sqlx::query!(
        r#"
        UPDATE bookings
           SET status              = 'cancelled',
               cancelled_at        = NOW(),
               cancellation_reason = $2,
               updated_at          = NOW()
         WHERE id = $1
        "#,
        booking_id,
        payload.reason.as_deref(),
    )
    .execute(&mut *tx)
    .await?;

    let before_json = json!({ "status": before.status });
    let after_json = json!({ "status": "cancelled" });

    insert_audit_row(
        &mut *tx,
        booking_id,
        admin_id,
        "booking_cancelled",
        Some(before_json),
        Some(after_json),
        payload.reason.clone(),
    )
    .await?;

    tx.commit().await?;

    let detail = read_detail_after_mutation(state.db(), booking_id).await?;
    Ok(Json(detail))
}

// ============================================================================
// Shared post-mutation read + audit helpers
// ============================================================================

/// Re-read a booking by id outside of the mutation's transaction. Used
/// after every state change so the response body matches what a fresh
/// `GET /api/admin/bookings/:id` would return.
async fn read_detail_after_mutation(
    db: &sqlx::PgPool,
    booking_id: Uuid,
) -> AppResult<AdminBookingDetail> {
    let row = sqlx::query_as!(
        BookingRow,
        r#"
        SELECT
            b.id                            AS "id!",
            b.user_id                       AS "user_id!",
            b.room_type_id                  AS "room_type_id!",
            b.check_in_date                 AS "check_in_date!",
            b.check_out_date                AS "check_out_date!",
            b.num_guests                    AS "num_guests!",
            b.total_price                   AS "total_price!",
            b.payment_type                  AS "payment_type?",
            b.payment_amount                AS "payment_amount?",
            b.discount_amount               AS "discount_amount?",
            b.discount_reason               AS "discount_reason?",
            b.status                        AS "status!",
            b.notes                         AS "notes?",
            b.admin_notes                   AS "admin_notes?",
            b.created_at                    AS "created_at?",
            b.updated_at                    AS "updated_at?",
            u.email                         AS "user_email?",
            up.first_name                   AS "first_name?",
            up.last_name                    AS "last_name?",
            up.membership_id                AS "membership_id?",
            up.phone                        AS "phone?",
            rt.name                         AS "rt_name!",
            s.id                            AS "slip_id?",
            s.slip_url                      AS "slip_url?",
            s.uploaded_at                   AS "slip_uploaded_at?",
            s.slipok_status                 AS "slip_slipok_status?",
            s.slipok_verified_at            AS "slip_slipok_verified_at?",
            s.admin_status                  AS "slip_admin_status?",
            s.admin_verified_at             AS "slip_admin_verified_at?",
            s.admin_verified_by             AS "slip_admin_verified_by?",
            (vup.first_name || ' ' || vup.last_name) AS "slip_admin_verified_by_name?"
          FROM bookings b
          JOIN room_types rt              ON rt.id = b.room_type_id
          LEFT JOIN users u               ON u.id = b.user_id
          LEFT JOIN user_profiles up      ON up.user_id = b.user_id
          LEFT JOIN LATERAL (
              SELECT *
                FROM booking_slips bs
               WHERE bs.booking_id = b.id
               ORDER BY bs.uploaded_at DESC NULLS LAST, bs.created_at DESC NULLS LAST
               LIMIT 1
          ) s ON TRUE
          LEFT JOIN user_profiles vup     ON vup.user_id = s.admin_verified_by
         WHERE b.id = $1
        "#,
        booking_id,
    )
    .fetch_one(db)
    .await?;

    let booking: AdminBookingListItem = row.into();
    let audit_history = fetch_audit_history(db, booking_id).await?;
    Ok(AdminBookingDetail {
        booking,
        audit_history,
    })
}

/// Insert one audit row in the caller's transaction. We accept a generic
/// `Executor` so the same helper can be reused outside the four core
/// mutations if a future PR adds more admin actions.
async fn insert_audit_row<'c, E>(
    executor: E,
    booking_id: Uuid,
    admin_id: Uuid,
    action: &str,
    before_data: Option<JsonValue>,
    after_data: Option<JsonValue>,
    reason: Option<String>,
) -> AppResult<()>
where
    E: sqlx::Executor<'c, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO booking_audit_log
            (booking_id, admin_id, action, before_data, after_data, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        booking_id,
        admin_id,
        action,
        before_data,
        after_data,
        reason,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Compute the before/after diff JSON for the booking_updated audit row.
/// Only fields whose value actually changed are emitted, so reading the
/// history doesn't drown in unchanged-but-included noise.
#[allow(clippy::too_many_arguments)]
fn build_update_diff(
    before: &BeforeRow,
    new_check_in: NaiveDate,
    new_check_out: NaiveDate,
    new_guests: i32,
    new_room_type: Uuid,
    new_notes: Option<&str>,
    new_admin_notes: Option<&str>,
    new_total: Decimal,
) -> (JsonValue, JsonValue) {
    let mut before_map = serde_json::Map::new();
    let mut after_map = serde_json::Map::new();

    if before.check_in_date != new_check_in {
        before_map.insert("checkInDate".into(), json!(before.check_in_date));
        after_map.insert("checkInDate".into(), json!(new_check_in));
    }
    if before.check_out_date != new_check_out {
        before_map.insert("checkOutDate".into(), json!(before.check_out_date));
        after_map.insert("checkOutDate".into(), json!(new_check_out));
    }
    if before.num_guests != new_guests {
        before_map.insert("numberOfGuests".into(), json!(before.num_guests));
        after_map.insert("numberOfGuests".into(), json!(new_guests));
    }
    if before.room_type_id != new_room_type {
        before_map.insert("roomTypeId".into(), json!(before.room_type_id));
        after_map.insert("roomTypeId".into(), json!(new_room_type));
    }
    if before.notes.as_deref() != new_notes {
        before_map.insert("notes".into(), json!(before.notes));
        after_map.insert("notes".into(), json!(new_notes));
    }
    if before.admin_notes.as_deref() != new_admin_notes {
        before_map.insert("adminNotes".into(), json!(before.admin_notes));
        after_map.insert("adminNotes".into(), json!(new_admin_notes));
    }
    if before.total_price != new_total {
        before_map.insert("totalPrice".into(), json!(before.total_price));
        after_map.insert("totalPrice".into(), json!(new_total));
    }

    (JsonValue::Object(before_map), JsonValue::Object(after_map))
}

/// The subset of bookings columns the PUT handler re-reads inside its
/// transaction. Mirrors the SELECT used by `update_booking`.
struct BeforeRow {
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    num_guests: i32,
    room_type_id: Uuid,
    notes: Option<String>,
    admin_notes: Option<String>,
    total_price: Decimal,
    status: String,
}

// ============================================================================
// Router
// ============================================================================

/// Build the admin-bookings sub-router. Merged into the parent admin
/// router by `routes::admin::router`, which applies `auth_middleware`
/// once for all merged routes.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/bookings", get(list_bookings))
        .route("/bookings/room-types", get(list_room_types_for_modal))
        .route("/bookings/:id", get(get_booking_detail))
        .route("/bookings/:id", put(update_booking))
        .route("/bookings/:id/discount", post(apply_discount))
        .route("/bookings/:id/cancel", post(cancel_booking))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_status_buckets_correctly() {
        assert_eq!(normalize_status("pending"), "confirmed");
        assert_eq!(normalize_status("confirmed"), "confirmed");
        assert_eq!(normalize_status("checked_in"), "confirmed");
        assert_eq!(normalize_status("checked_out"), "completed");
        assert_eq!(normalize_status("completed"), "completed");
        assert_eq!(normalize_status("cancelled"), "cancelled");
        assert_eq!(normalize_status("no_show"), "cancelled");
        // Unknown values fall back to "confirmed" so the UI still renders
        // them in a sensible tab rather than dropping them on the floor.
        assert_eq!(normalize_status("future_state"), "confirmed");
    }

    #[test]
    fn list_query_defaults() {
        let q: ListBookingsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(q.page, 1);
        assert_eq!(q.limit, 10);
        assert_eq!(q.sort_by, "created_at");
        assert_eq!(q.sort_order, "desc");
        assert!(q.search.is_none());
        assert!(q.status.is_none());
    }

    #[test]
    fn apply_discount_request_round_trips() {
        let json =
            r#"{"discountAmount": 250.5, "reason": "complimentary upgrade for tier upgrade"}"#;
        let req: ApplyDiscountRequest = serde_json::from_str(json).unwrap();
        assert!((req.discount_amount - 250.5).abs() < f64::EPSILON);
        assert_eq!(req.reason, "complimentary upgrade for tier upgrade");
    }

    #[test]
    fn build_update_diff_only_includes_changed_fields() {
        let before = BeforeRow {
            check_in_date: NaiveDate::from_ymd_opt(2030, 1, 1).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2030, 1, 5).unwrap(),
            num_guests: 2,
            room_type_id: Uuid::nil(),
            notes: None,
            admin_notes: Some("old admin note".into()),
            total_price: Decimal::new(1000, 0),
            status: "confirmed".into(),
        };

        // Only change `num_guests` and `admin_notes`.
        let (before_json, after_json) = build_update_diff(
            &before,
            before.check_in_date,
            before.check_out_date,
            5,
            before.room_type_id,
            None,
            Some("new admin note"),
            before.total_price,
        );

        let before_obj = before_json.as_object().unwrap();
        let after_obj = after_json.as_object().unwrap();

        assert_eq!(before_obj.len(), 2, "only two fields changed");
        assert_eq!(after_obj.len(), 2);
        assert!(before_obj.contains_key("numberOfGuests"));
        assert!(before_obj.contains_key("adminNotes"));
        assert_eq!(after_obj.get("numberOfGuests"), Some(&json!(5)));
        assert_eq!(after_obj.get("adminNotes"), Some(&json!("new admin note")));
    }
}
