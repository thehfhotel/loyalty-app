//! Booking routes
//!
//! Provides endpoints for hotel room booking management including
//! listing, creating, updating, and cancelling bookings.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
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
use crate::services::pms_channel::{PmsChannelClient, PmsCreateBookingRequest, PmsGuest};
use crate::services::promptpay::PromptPayService;
use crate::state::AppState;
use crate::types::Property;

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

/// Add slip request — attach a previously-uploaded payment slip URL to a booking.
///
/// The frontend uploads the file via `POST /api/slips/upload` first, then sends
/// the returned URL here so it gets associated with the booking.
#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct AddSlipRequest {
    #[validate(length(
        min = 1,
        max = 1024,
        message = "Slip URL must be between 1 and 1024 characters"
    ))]
    pub slip_url: String,
}

/// Response for an added slip.
///
/// Mirrors the `BookingSlip` shape the frontend's `bookingService` expects:
/// `{ id, slipUrl, uploadedAt, slipokStatus, adminStatus }`.
///
/// `Deserialize` is needed for replaying the cached idempotency
/// response: the bytes stored in `idempotency_keys.response_body` have
/// to be parsed back into this type before being returned to the
/// client.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingSlipResponse {
    pub id: Uuid,
    pub booking_id: Uuid,
    pub slip_url: String,
    pub uploaded_by: Uuid,
    pub uploaded_at: DateTime<Utc>,
    /// Reserved for future SlipOK verification integration.
    pub slipok_status: Option<String>,
    /// Reserved for future admin review workflow.
    pub admin_status: Option<String>,
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

    // Tell the property's desk a guest is coming (B0). Fire-and-forget: this
    // never fails the create, and an idempotent replay of the same request
    // finds the event already claimed and stays quiet.
    //
    // An in-app booking sets no `property` yet, so the notifier routes it to
    // HF Ville and says "ยังไม่ระบุสาขา / property not set" in the body
    // rather than inventing one.
    crate::services::booking_notify::notify(
        &state,
        booking.id,
        crate::services::booking_notify::BookingNotifyEvent::BookingCreated,
    )
    .await;

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

/// POST /api/bookings/:id/slips - Attach a payment slip URL to a booking
///
/// Request body:
/// - slipUrl: The URL returned by `POST /api/slips/upload`
///
/// Optional headers:
/// - `Idempotency-Key`: client-generated string. A retry with the same key
///   replays the original response instead of creating a duplicate slip row.
///   See `docs/audits/correctness-2026-05-13.md` (HIGH #5) for the audit
///   write-up that motivated this.
///
/// Authentication is required (provided by the router layer). The caller must
/// either own the booking or be an admin.
///
/// Returns 201 with the created `BookingSlipResponse` (camelCase JSON).
async fn add_booking_slip(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(booking_id): Path<Uuid>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AddSlipRequest>,
) -> AppResult<(StatusCode, Json<BookingSlipResponse>)> {
    // Validate the request body shape (length bounds on slip_url).
    req.validate()?;

    // Trim then re-check so payloads that are only whitespace are rejected.
    let slip_url = req.slip_url.trim().to_string();
    if slip_url.is_empty() {
        return Err(AppError::Validation("slipUrl cannot be empty".to_string()));
    }

    // MED-1 (security-2026-05-13.md): only accept slip URLs that point
    // at our own slip storage. The endpoint previously accepted any
    // string; a malicious customer could attach
    // `https://attacker.com/fake-paid-slip.png` to their booking and
    // an admin clicking through would land on a credential-harvest page.
    //
    // The legitimate path is `/storage/slips/<uuid>.<ext>`, which is
    // what `POST /api/slips/upload` returns. Anything else is rejected
    // up-front with 400.
    if !slip_url.starts_with("/storage/slips/") {
        return Err(AppError::BadRequest(
            "slipUrl must be a server-hosted /storage/slips/ path".to_string(),
        ));
    }

    // Look up the booking; surfaces a 404 when it doesn't exist.
    let booking = query_booking_by_id(state.db(), booking_id).await?;

    // Ownership / admin authorization. We do this AFTER the booking lookup so
    // that a missing booking returns 404 (not 403), matching the pattern used
    // by `get_booking`.
    let auth_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    let is_admin = has_role(&auth_user, "admin");
    if booking.user_id != auth_user_id && !is_admin {
        return Err(AppError::Forbidden(
            "You can only add slips to your own bookings".to_string(),
        ));
    }

    // Parse the optional `Idempotency-Key` header. When present, a retry
    // with the same key replays the original response payload byte-for-byte
    // rather than inserting a second slip row. See
    // `services/idempotency.rs` for the contract.
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Pre-check the pool for a previously-cached response. The cached
    // row was committed in a *different* transaction so we have to
    // read it before opening our own.
    if let Some(key) = idempotency_key.as_deref() {
        if let Some(cached) =
            crate::services::idempotency::load_cached_response(state.db(), auth_user_id, key)
                .await?
        {
            // An empty body means the original handler errored before it
            // could record a response — fall through and retry.
            if !cached.body.is_empty() {
                if let Ok(slip) = serde_json::from_slice::<BookingSlipResponse>(&cached.body) {
                    let status =
                        StatusCode::from_u16(cached.status as u16).unwrap_or(StatusCode::CREATED);
                    return Ok((status, Json(slip)));
                }
            }
        }
    }

    // Open one transaction for the placeholder + insert + cache so a
    // rollback removes the placeholder, letting a retry re-run cleanly.
    let mut tx = state.db().begin().await?;

    if let Some(key) = idempotency_key.as_deref() {
        let outcome = crate::services::idempotency::take_or_replay(
            &mut *tx,
            auth_user_id,
            key,
            "/api/bookings/:id/slips",
        )
        .await?;

        if matches!(
            outcome,
            crate::services::idempotency::IdempotencyOutcome::Replay(_)
        ) {
            // Another concurrent retry holds the placeholder. Surface a
            // 409 so the client knows to back off; the first request
            // will record the response shortly.
            tx.rollback().await?;
            return Err(AppError::Conflict(
                "A concurrent request with the same Idempotency-Key is in flight".to_string(),
            ));
        }
    }

    let slip = insert_booking_slip_tx(&mut tx, booking_id, &slip_url, auth_user_id).await?;

    let response_body = serde_json::to_vec(&slip).map_err(|e| {
        AppError::Internal(format!("Failed to serialize booking slip response: {e}"))
    })?;

    if let Some(key) = idempotency_key.as_deref() {
        crate::services::idempotency::record_response(
            &mut *tx,
            auth_user_id,
            key,
            StatusCode::CREATED.as_u16() as i32,
            &response_body,
        )
        .await?;
    }

    tx.commit().await?;

    tracing::info!(
        user_id = %auth_user.id,
        booking_id = %booking_id,
        slip_id = %slip.id,
        "Booking slip added"
    );

    // Automatic SlipOK verification. Runs inline (not `tokio::spawn`) so the
    // stored decision is deterministic the moment this response returns —
    // which is what makes it assertable in an integration test and visible
    // to the guest without a refetch.
    //
    // It can never fail the upload: the slip row is already committed, and
    // every error inside is swallowed into a WARN. A guest must not see an
    // error because our slip vendor had a bad day.
    //
    // The whole check runs under one explicit budget. The SlipOK client's
    // own timeout only covers the SlipOK call; a confirmation also talks to
    // the PMS, and without a ceiling here a hung downstream would hold the
    // guest's request until the router's 30s `TimeoutLayer` cut it — turning
    // a *successful* upload into a 408 for the guest. Blowing the budget
    // just abandons the check; the slip is then exactly where it was before
    // this feature existed, in the admin's queue.
    let budget = slipok_check_budget(&state);
    if tokio::time::timeout(
        budget,
        run_slipok_check(&state, slip.id, booking_id, &slip_url),
    )
    .await
    .is_err()
    {
        tracing::warn!(
            slip_id = %slip.id,
            booking_id = %booking_id,
            budget_secs = budget.as_secs(),
            "SlipOK check exceeded its latency budget; slip left for manual verification"
        );
    }

    Ok((StatusCode::CREATED, Json(slip)))
}

/// How long the whole inline check may take: the SlipOK client's own
/// timeout plus one PMS round trip (`pms_channel` caps its client too) plus
/// a little slack. Must stay comfortably under the router's `TimeoutLayer`,
/// which is what the guest's request is actually racing.
fn slipok_check_budget(state: &AppState) -> std::time::Duration {
    let slipok_timeout = state
        .slipok()
        .map(|s| s.timeout())
        .unwrap_or_else(|| std::time::Duration::from_secs(8));
    slipok_timeout
        + crate::services::pms_channel::PMS_REQUEST_TIMEOUT
        + std::time::Duration::from_secs(2)
}

// SlipOK status values written to `booking_slips.slipok_status`. Defined in
// `services::slip_match` beside the reason strings, because
// `services::slip_confirm::revert_auto_confirm` writes them too.
use crate::services::slip_match::{
    SLIPOK_STATUS_MANUAL, SLIPOK_STATUS_SHADOW_PASS, SLIPOK_STATUS_UNAVAILABLE,
    SLIPOK_STATUS_VERIFIED,
};

/// Run the automatic slip check and record its outcome. Infallible by
/// construction: anything that goes wrong is logged and the slip is left on
/// the manual admin path, which is exactly where it was before this existed.
async fn run_slipok_check(state: &AppState, slip_id: Uuid, booking_id: Uuid, slip_url: &str) {
    if let Err(e) = slipok_check(state, slip_id, booking_id, slip_url).await {
        tracing::warn!(
            slip_id = %slip_id,
            booking_id = %booking_id,
            error = %e,
            "SlipOK check failed; slip left for manual verification"
        );
    }
}

/// The body of the check. Returns `Err` only on problems the caller should
/// log — the guest's response is already decided by the time this runs.
async fn slipok_check(
    state: &AppState,
    slip_id: Uuid,
    booking_id: Uuid,
    slip_url: &str,
) -> AppResult<()> {
    use crate::services::slip_match::{self, SlipDecision};

    // Not configured: record why, then behave exactly as before.
    let Some(slipok) = state.slipok() else {
        record_slipok_result(
            state.db(),
            slip_id,
            SLIPOK_STATUS_UNAVAILABLE,
            Some("not_configured"),
            None,
        )
        .await?;
        return Ok(());
    };

    // What we expect to have been paid, to whom, and whether the booking can
    // still accept a payment at all. `amount_due_now` is the deposit for a
    // deposit50 booking and the full price otherwise; both columns are
    // DECIMAL(10,2) baht.
    let (amount_due, property, booking_status, hold_expires_at): (
        Decimal,
        Option<String>,
        Option<String>,
        Option<DateTime<Utc>>,
    ) = sqlx::query_as(
        "SELECT COALESCE(amount_due_now, total_price), property, status, hold_expires_at \
         FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_one(state.db())
    .await?;

    let Some(expected_satang) = slip_match::to_satang(amount_due) else {
        return Err(AppError::Internal(format!(
            "Booking {} has an unrepresentable amount due",
            booking_id
        )));
    };

    // A booking with no property tells us nothing about which account the
    // guest was shown, and `id_for_property("")` would silently fall back to
    // the legacy single account — i.e. match the payee against a possibly
    // unrelated company. The QR endpoint refuses to serve a booking it
    // cannot price to an account; the matcher refuses to judge one.
    let receiving_id = property
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .and_then(|p| state.config().promptpay.id_for_property(p))
        .cloned();
    let Some(receiving_id) = receiving_id else {
        // Nothing to match the payee against — the check cannot be trusted.
        record_slipok_result(
            state.db(),
            slip_id,
            SLIPOK_STATUS_UNAVAILABLE,
            Some("not_configured"),
            None,
        )
        .await?;
        return Ok(());
    };

    let image = crate::services::storage::read_slip_bytes(slip_url).await?;

    let result = match slipok.verify_slip(image).await {
        Ok(result) => result,
        Err(e) => {
            // A transport-level failure: SlipOK never gave a verdict.
            let reason = match e {
                AppError::ExternalServiceTimeout(_) => "timeout",
                _ => "api_error",
            };
            record_slipok_result(
                state.db(),
                slip_id,
                SLIPOK_STATUS_UNAVAILABLE,
                Some(reason),
                None,
            )
            .await?;
            tracing::warn!(
                slip_id = %slip_id,
                booking_id = %booking_id,
                reason = %reason,
                "SlipOK gave no verdict; slip left for manual verification"
            );
            return Ok(());
        },
    };

    // Duplicate defence, first half: has this bank reference already been
    // stored against another slip? The partial unique index on
    // `slipok_trans_ref` is the other half, for the racing case.
    let trans_ref = result
        .transaction_id
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string);
    let already_seen = match trans_ref.as_deref() {
        Some(reference) => sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM booking_slips WHERE slipok_trans_ref = $1 AND id <> $2)",
        )
        .bind(reference)
        .bind(slip_id)
        .fetch_one(state.db())
        .await?,
        None => false,
    };

    let decision = slip_match::decide(&result, expected_satang, &receiving_id, already_seen);
    let auto_verify = state.config().slipok.auto_verify;

    // A slip can be perfect and still not be something a machine may act on.
    // `add_booking_slip` accepts a slip against a booking in any state, and
    // the hold-expiry sweep cancels a channel booking whose PMS hold ran
    // out — confirming one of those would post a payment event against a
    // room the PMS has already released. An admin may still override it by
    // hand (that is a human decision); the automatic path may not.
    let payable = booking_status.as_deref() == Some("pending")
        && hold_expires_at.map_or(true, |expires| expires > Utc::now());

    // The reference is stored only when every check passed. A rejected slip
    // must not occupy the unique index: the guest may legitimately re-upload
    // the same transfer once the mismatch is sorted out.
    let (status, reason, stored_ref) = match &decision {
        SlipDecision::Confirm { .. } if !payable => (
            SLIPOK_STATUS_MANUAL,
            Some(slip_match::REASON_BOOKING_NOT_PAYABLE),
            None,
        ),
        SlipDecision::Confirm { trans_ref } if auto_verify => {
            (SLIPOK_STATUS_VERIFIED, None, Some(trans_ref.clone()))
        },
        SlipDecision::Confirm { trans_ref } => {
            (SLIPOK_STATUS_SHADOW_PASS, None, Some(trans_ref.clone()))
        },
        SlipDecision::Manual { reason } => (SLIPOK_STATUS_MANUAL, Some(*reason), None),
        SlipDecision::Unavailable { reason } => (SLIPOK_STATUS_UNAVAILABLE, Some(*reason), None),
    };

    let status = record_slipok_result(state.db(), slip_id, status, reason, stored_ref.as_deref())
        .await?
        .unwrap_or(status);

    if status == SLIPOK_STATUS_VERIFIED {
        // Same function the admin's Verify button runs, with no actor.
        //
        // If it fails part-way — the slip transaction commits and then the
        // PMS refuses the payment event — nobody retries: there is no admin
        // holding a button. Compensate instead, so the slip lands back in
        // the manual queue rather than sitting there reading `verified`
        // against a booking that is still pending, and log at ERROR so the
        // failure is pageable.
        if let Err(e) =
            crate::services::slip_confirm::confirm_slip(state, slip_id, booking_id, None).await
        {
            tracing::error!(
                slip_id = %slip_id,
                booking_id = %booking_id,
                error = %e,
                "SlipOK auto-confirm failed after the slip passed every check; \
                 returning the slip to manual verification"
            );
            crate::services::slip_confirm::revert_auto_confirm(state.db(), slip_id).await?;
            return Ok(());
        }
    }

    tracing::info!(
        slip_id = %slip_id,
        booking_id = %booking_id,
        decision = %status,
        reason = reason.unwrap_or("none"),
        auto_verify_enabled = auto_verify,
        "SlipOK decision recorded"
    );

    // The desk is told about a deposit the machine accepted (B0). Shadow
    // passes send too — during the shadow window a human still has to look,
    // and the email says so. `manual`, `unavailable` and `pending` do not:
    // they reach the desk through the admin queue, not the mailbox.
    if status == SLIPOK_STATUS_VERIFIED || status == SLIPOK_STATUS_SHADOW_PASS {
        crate::services::booking_notify::notify(
            state,
            booking_id,
            crate::services::booking_notify::BookingNotifyEvent::DepositVerified { slip_id },
        )
        .await;
    }

    Ok(())
}

/// Store the SlipOK outcome on the slip row.
///
/// Deliberately a **runtime** `sqlx::query` rather than the compile-time
/// macro: the four `slipok_*` columns are new in migration
/// `20260910000000_booking_slips_slipok.sql`, and a runtime query is not
/// validated against the offline cache in `.sqlx/`, so this change needs no
/// `cargo sqlx prepare` run (and cannot go stale against it).
///
/// Returns `Some(status)` when the write had to fall back to a different
/// status than the one asked for — today only when the unique index on
/// `slipok_trans_ref` rejects the reference because a concurrent upload of
/// the same transfer won the race, which is a duplicate by definition.
async fn record_slipok_result(
    db: &PgPool,
    slip_id: Uuid,
    status: &'static str,
    reason: Option<&str>,
    trans_ref: Option<&str>,
) -> AppResult<Option<&'static str>> {
    const SQL: &str = r#"
        UPDATE booking_slips
        SET slipok_status     = $1,
            slipok_reason     = $2,
            slipok_trans_ref  = $3,
            slipok_checked_at = NOW()
        WHERE id = $4
    "#;

    let outcome = sqlx::query(SQL)
        .bind(status)
        .bind(reason)
        .bind(trans_ref)
        .bind(slip_id)
        .execute(db)
        .await;

    match outcome {
        Ok(_) => Ok(None),
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
            tracing::warn!(
                slip_id = %slip_id,
                "SlipOK reference already stored by a concurrent upload; recording duplicate"
            );
            sqlx::query(SQL)
                .bind(SLIPOK_STATUS_MANUAL)
                .bind(Some(crate::services::slip_match::REASON_DUPLICATE))
                .bind(Option::<&str>::None)
                .bind(slip_id)
                .execute(db)
                .await?;
            Ok(Some(SLIPOK_STATUS_MANUAL))
        },
        Err(e) => Err(e.into()),
    }
}

/// DELETE /api/bookings/slips/:slip_id - Remove a payment slip
///
/// Path parameter:
/// - `slip_id`: The UUID of the slip row to delete.
///
/// Authentication is required (provided by the router layer). The caller must
/// either be the user that originally uploaded the slip OR an admin; everyone
/// else gets 403.
///
/// Returns 204 No Content on success. Returns 404 if the slip does not exist,
/// matching the lookup-then-authorize ordering used by `add_booking_slip` and
/// `get_booking`.
async fn delete_booking_slip(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(slip_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    // Look up the slip first; surfaces a 404 when it doesn't exist so callers
    // can distinguish "you're not allowed" from "it isn't there".
    let slip = query_booking_slip_by_id(state.db(), slip_id).await?;

    // Ownership / admin authorization. Done AFTER the lookup so a missing slip
    // returns 404 rather than 403 (matches `get_booking` / `add_booking_slip`).
    let auth_user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    let is_admin = has_role(&auth_user, "admin");
    if slip.uploaded_by != auth_user_id && !is_admin {
        return Err(AppError::Forbidden(
            "You can only delete slips you uploaded".to_string(),
        ));
    }

    delete_booking_slip_by_id(state.db(), slip_id).await?;

    tracing::info!(
        user_id = %auth_user.id,
        slip_id = %slip_id,
        booking_id = %slip.booking_id,
        admin_delete = is_admin && slip.uploaded_by != auth_user_id,
        "Booking slip deleted"
    );

    Ok(StatusCode::NO_CONTENT)
}

// Legacy local-inventory availability (check_availability /
// check_room_availability) was removed with ADR-0003: availability truth
// lives in the PMS; see channel_availability below.

// ==================== DATABASE ROW TYPES ====================

/// Database row for booking with room info
#[derive(Debug, FromRow)]
#[allow(dead_code)]
struct BookingRow {
    pub id: Uuid,
    pub user_id: Uuid,
    // Nullable since the PMS booking channel (ADR-0003): channel bookings
    // carry no local room — the PMS assigns physical rooms.
    pub room_id: Option<Uuid>,
    pub room_type_id: Option<Uuid>,
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

/// Room type row for legacy booking creation (price lookup)
#[derive(Debug, FromRow)]
struct RoomTypeRow {
    pub id: Uuid,
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

/// Insert a booking, holding a row-level lock on the candidate room for
/// the full SELECT→INSERT window so two concurrent overlapping requests
/// can't both observe the room as free.
///
/// The defensive `bookings_no_overlap` EXCLUDE constraint (migration
/// `20260513020000`) is the canonical fix — Postgres rejects the INSERT
/// atomically if any other transaction commits an overlapping row first.
/// This function still wraps the read+insert in a single transaction and
/// takes `SELECT ... FOR UPDATE` on the room row, so the *common* case
/// hands the loser a clean 409 Conflict rather than relying on the
/// constraint violation to bubble up.
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

    // Find the room type (read-only, safe to do outside the transaction)
    let room_type_row: RoomTypeRow = sqlx::query_as(
        r#"
        SELECT id, price_per_night
        FROM room_types
        WHERE LOWER(name) = LOWER($1) AND is_active = true
        "#,
    )
    .bind(&room_type_name)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::BadRequest(format!("Room type '{}' not found", room_type_name)))?;

    let mut tx = db.begin().await?;

    // Find and lock an available room of this type. The `FOR UPDATE` on
    // `r.id` serialises overlapping inserts for the same room: the
    // second transaction blocks until the first commits, then re-runs
    // the availability check under the lock and either finds no rooms
    // (= 400) or — if a different room is available — proceeds. The
    // EXCLUDE constraint added in `20260513020000_bookings_no_overlap.sql`
    // is the absolute fallback: even if a future caller forgets the
    // transaction, the DB enforces non-overlap.
    let room_id: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT r.id
        FROM rooms r
        WHERE r.room_type_id = $1
          AND r.is_active = true
          AND r.id NOT IN (
            -- Exclude rooms with existing bookings that overlap.
            -- room_id IS NOT NULL guards the NOT-IN-with-NULL trap:
            -- channel bookings (ADR-0003) have no local room.
            SELECT DISTINCT b.room_id
            FROM bookings b
            WHERE b.room_id IS NOT NULL
              AND b.status NOT IN ('cancelled', 'no_show')
              AND b.check_in_date < $3
              AND b.check_out_date > $2
          )
          AND r.id NOT IN (
            -- Exclude rooms with blocked dates in the range
            SELECT DISTINCT rbd.room_id
            FROM room_blocked_dates rbd
            WHERE rbd.blocked_date >= $2 AND rbd.blocked_date < $3
          )
        ORDER BY r.id
        LIMIT 1
        FOR UPDATE OF r
        "#,
    )
    .bind(room_type_row.id)
    .bind(check_in)
    .bind(check_out)
    .fetch_optional(&mut *tx)
    .await?;

    let room_id = room_id
        .ok_or_else(|| AppError::BadRequest("No rooms available for selected dates".to_string()))?
        .0;

    // Calculate total price
    let nights = (check_out - check_in).num_days() as i32;
    let total_price = room_type_row.price_per_night * Decimal::from(nights);

    // Insert booking. If a concurrent transaction managed to commit an
    // overlapping booking between our `FOR UPDATE` lock acquisition and
    // this INSERT (which shouldn't be possible while we hold the row
    // lock, but the EXCLUDE constraint is here as belt-and-braces),
    // the DB raises `exclusion_violation` (SQLSTATE 23P01) and we map
    // it to a 409 Conflict so the client can retry.
    let row: Result<BookingRow, sqlx::Error> = sqlx::query_as(
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
    .fetch_one(&mut *tx)
    .await;

    let row = match row {
        Ok(row) => row,
        Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("23P01") => {
            // EXCLUDE constraint violation — another transaction
            // committed an overlapping booking for this room before
            // we could insert. Roll back implicitly (tx dropped via
            // `?` below would normally do the same, but we want to
            // explicitly surface a 409 to the caller).
            tx.rollback().await?;
            return Err(AppError::Conflict(
                "Room is no longer available for the selected dates".to_string(),
            ));
        },
        Err(other) => return Err(AppError::from(other)),
    };

    tx.commit().await?;

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
            SELECT id, price_per_night
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
                -- room_id IS NOT NULL guards the NOT-IN-with-NULL trap:
                -- channel bookings (ADR-0003) have no local room.
                SELECT DISTINCT b.room_id
                FROM bookings b
                WHERE b.room_id IS NOT NULL
                  AND b.status NOT IN ('cancelled')
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

// check_room_availability was removed with ADR-0003 (see note above).

async fn award_loyalty_points(
    db: &PgPool,
    user_id: Uuid,
    points: i32,
    nights: i32,
    booking_id: Uuid,
) -> AppResult<()> {
    let reference_id = format!("BOOKING-{}", booking_id);

    // Insert points transaction directly (avoids stored procedure type resolution issues)
    sqlx::query(
        r#"
        INSERT INTO points_transactions (user_id, points, type, description, reference_id, nights_stayed)
        VALUES ($1, $2, 'earned_stay'::text::points_transaction_type, 'Points earned from booking', $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(points)
    .bind(&reference_id)
    .bind(nights)
    .execute(db)
    .await?;

    // Update user loyalty totals
    sqlx::query(
        r#"
        UPDATE user_loyalty
        SET current_points = current_points + $2,
            total_nights = COALESCE(total_nights, 0) + $3,
            points_updated_at = NOW(),
            updated_at = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .bind(points)
    .bind(nights)
    .execute(db)
    .await?;

    // Recalculate tier if nights were awarded
    if nights > 0 {
        sqlx::query("SELECT * FROM recalculate_user_tier_by_nights($1)")
            .bind(user_id)
            .execute(db)
            .await?;
    }

    // Update the booking with points earned
    sqlx::query("UPDATE bookings SET points_earned = $2 WHERE id = $1")
        .bind(booking_id)
        .bind(points)
        .execute(db)
        .await?;

    Ok(())
}

/// Raw `booking_slips` row used by slip insert/query/delete helpers.
///
/// `uploaded_at` is nullable in the schema (the column carries a
/// `DEFAULT CURRENT_TIMESTAMP` but no `NOT NULL`); the response substitutes
/// "now" if it is somehow NULL on read. Kept private to this module —
/// handlers convert it to `BookingSlipResponse` via the `From` impl below
/// before serialising, and the delete handler inspects `uploaded_by`
/// directly to authorize the caller.
#[derive(Debug, FromRow)]
struct BookingSlipRow {
    pub id: Uuid,
    pub booking_id: Uuid,
    pub slip_url: String,
    pub uploaded_by: Uuid,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub slipok_status: Option<String>,
    pub admin_status: Option<String>,
}

impl From<BookingSlipRow> for BookingSlipResponse {
    fn from(row: BookingSlipRow) -> Self {
        Self {
            id: row.id,
            booking_id: row.booking_id,
            slip_url: row.slip_url,
            uploaded_by: row.uploaded_by,
            uploaded_at: row.uploaded_at.unwrap_or_else(Utc::now),
            slipok_status: row.slipok_status,
            admin_status: row.admin_status,
        }
    }
}

/// Insert a slip row and return it as a response DTO.
///
/// The `slipok_status` and `admin_status` columns default to `'pending'` in
/// the schema, so they are returned in the response immediately — clients
/// don't have to wait for the SlipOK / admin review workflows to fire
/// before seeing a status value.
/// Transaction-scoped slip insert used by the idempotency-aware
/// `add_booking_slip` handler — the placeholder reservation, slip
/// insert, and response cache live in one transaction so a rollback
/// removes all three.
async fn insert_booking_slip_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
    slip_url: &str,
    uploaded_by: Uuid,
) -> AppResult<BookingSlipResponse> {
    let row = sqlx::query_as!(
        BookingSlipRow,
        r#"
        INSERT INTO booking_slips (booking_id, slip_url, uploaded_by)
        VALUES ($1, $2, $3)
        RETURNING id, booking_id, slip_url, uploaded_by, uploaded_at,
                  slipok_status, admin_status
        "#,
        booking_id,
        slip_url,
        uploaded_by,
    )
    .fetch_one(&mut **tx)
    .await?;

    Ok(row.into())
}

/// Fetch a slip row by id, surfacing a 404 when it doesn't exist.
///
/// We need the raw row (not the response DTO) because the delete handler has
/// to authorize against `uploaded_by`, which the response DTO carries but is
/// also used for logging the originating `booking_id`.
async fn query_booking_slip_by_id(db: &PgPool, slip_id: Uuid) -> AppResult<BookingSlipRow> {
    sqlx::query_as!(
        BookingSlipRow,
        r#"
        SELECT id, booking_id, slip_url, uploaded_by, uploaded_at,
               slipok_status, admin_status
        FROM booking_slips
        WHERE id = $1
        "#,
        slip_id,
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Slip {}", slip_id)))
}

/// Delete a slip row by id.
///
/// The caller is responsible for authorization; this function unconditionally
/// removes the row. Returns an error if the row is missing — the handler
/// should have already verified existence via `query_booking_slip_by_id`, so
/// hitting that branch here means the row was deleted concurrently.
async fn delete_booking_slip_by_id(db: &PgPool, slip_id: Uuid) -> AppResult<()> {
    let result = sqlx::query!("DELETE FROM booking_slips WHERE id = $1", slip_id)
        .execute(db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Slip {}", slip_id)));
    }

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
// ==================== PMS BOOKING CHANNEL (ADR-0003) ====================
// Locked contract: docs/launch-plan.md. The app holds no inventory —
// availability comes live from the PMS and confirmed bookings are created
// there; the local row is a channel record for history/slips/payment.

#[derive(Debug, Deserialize)]
pub struct ChannelAvailabilityQuery {
    pub property: Property,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub guests: i32,
}

#[derive(Debug, Serialize)]
pub struct ChannelRoomTypeResponse {
    pub room_type_id: String,
    pub name: String,
    pub description: Option<String>,
    /// Reserved for catalog enrichment; the PMS carries no photos yet.
    pub photo_url: Option<String>,
    pub nightly_price: f64,
    pub available_count: i32,
}

#[derive(Debug, Serialize)]
pub struct ChannelAvailabilityResponse {
    pub property: Property,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub room_types: Vec<ChannelRoomTypeResponse>,
}

fn validate_channel_dates(check_in: NaiveDate, check_out: NaiveDate) -> AppResult<()> {
    if check_out <= check_in {
        return Err(AppError::Validation(
            "check_out must be after check_in".to_string(),
        ));
    }
    if check_in < Utc::now().date_naive() {
        return Err(AppError::Validation(
            "check_in cannot be in the past".to_string(),
        ));
    }
    Ok(())
}

/// GET /api/bookings/availability — live availability from the PMS.
async fn channel_availability(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(query): Query<ChannelAvailabilityQuery>,
) -> AppResult<Json<ChannelAvailabilityResponse>> {
    use rust_decimal::prelude::ToPrimitive;

    validate_channel_dates(query.check_in, query.check_out)?;
    if !(1..=10).contains(&query.guests) {
        return Err(AppError::Validation(
            "guests must be between 1 and 10".to_string(),
        ));
    }

    let pms = PmsChannelClient::from_settings(state.config())?;
    let availability = pms
        .availability(
            query.property,
            query.check_in,
            query.check_out,
            query.guests,
        )
        .await?;

    let room_types = availability
        .room_types
        .into_iter()
        .map(|rt| ChannelRoomTypeResponse {
            room_type_id: rt.room_type_id,
            name: rt.name,
            description: rt.description,
            photo_url: None,
            nightly_price: rt.nightly_price.to_f64().unwrap_or(0.0),
            available_count: rt.available_count,
        })
        .collect();

    Ok(Json(ChannelAvailabilityResponse {
        property: query.property,
        check_in: query.check_in,
        check_out: query.check_out,
        room_types,
    }))
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelBookingRequest {
    pub property: Property,
    pub room_type_id: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub guests: i32,
    pub guest_name: String,
    pub guest_phone: String,
    /// "deposit50" | "full" — 50% deposit or pay in full (guest's choice).
    pub payment_option: String,
}

#[derive(Debug, Serialize)]
pub struct ChannelBookingResponse {
    pub booking_id: Uuid,
    pub pms_booking_id: String,
    pub total_amount: f64,
    pub amount_due_now: f64,
    pub balance_due_at_checkin: f64,
    /// Raw EMVCo PromptPay payload — the frontend renders it as a QR.
    pub promptpay_qr_payload: String,
    pub hold_expires_at: DateTime<Utc>,
}

/// POST /api/bookings/channel — create a held booking in the PMS, generate
/// the property-specific PromptPay payload, and record the channel row.
async fn create_channel_booking(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(payload): Json<CreateChannelBookingRequest>,
) -> AppResult<(StatusCode, Json<ChannelBookingResponse>)> {
    use rust_decimal::prelude::ToPrimitive;

    validate_channel_dates(payload.check_in, payload.check_out)?;
    if !(1..=10).contains(&payload.guests) {
        return Err(AppError::Validation(
            "guests must be between 1 and 10".to_string(),
        ));
    }
    if !matches!(payload.payment_option.as_str(), "deposit50" | "full") {
        return Err(AppError::Validation(
            "payment_option must be deposit50 or full".to_string(),
        ));
    }
    let guest_name = payload.guest_name.trim();
    let guest_phone = payload.guest_phone.trim();
    if guest_name.is_empty() || guest_phone.is_empty() {
        return Err(AppError::Validation(
            "guest_name and guest_phone are required".to_string(),
        ));
    }

    let user_uuid = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::InvalidInput("Invalid user ID format".to_string()))?;

    // PromptPay must be configured for this property BEFORE we create the
    // PMS hold — fail fast rather than holding a room we can't charge for.
    let promptpay_id = state
        .config()
        .promptpay
        .id_for_property(payload.property.as_str())
        .cloned()
        .ok_or_else(|| {
            AppError::Configuration(format!(
                "PromptPay account for {} is not configured",
                payload.property
            ))
        })?;
    let promptpay = PromptPayService::new(promptpay_id)?;

    // Pass the membership through so the PMS links the guest profile —
    // the Link is what makes checkout accrual work (docs/launch-plan.md).
    let membership_id: Option<String> = sqlx::query_scalar!(
        r#"SELECT membership_id FROM user_profiles WHERE user_id = $1"#,
        user_uuid
    )
    .fetch_optional(state.db())
    .await?;

    let pms = PmsChannelClient::from_settings(state.config())?;
    let created = pms
        .create_booking(&PmsCreateBookingRequest {
            property: payload.property,
            room_type_id: payload.room_type_id.clone(),
            check_in: payload.check_in,
            check_out: payload.check_out,
            guests: payload.guests,
            guest: PmsGuest {
                name: guest_name.to_string(),
                phone: guest_phone.to_string(),
            },
            membership_id,
            payment: payload.payment_option.clone(),
        })
        .await?;

    let balance_due = created.total - created.amount_due_now;
    let amount_due_now_f64 = created
        .amount_due_now
        .to_f64()
        .ok_or_else(|| AppError::Internal("PMS returned a non-representable amount".to_string()))?;
    let qr_payload = promptpay.generate_payload(amount_due_now_f64)?;

    // Record the channel row. If this fails, release the PMS hold so we
    // never strand inventory behind a booking the guest can't see.
    let booking_id = Uuid::new_v4();
    let inserted = sqlx::query!(
        r#"
        INSERT INTO bookings (
            id, user_id, check_in_date, check_out_date, num_guests,
            total_price, status, property, pms_booking_id, pms_room_type_id,
            guest_name, guest_phone, payment_option, amount_due_now,
            balance_due, hold_expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12, $13, $14, $15)
        "#,
        booking_id,
        user_uuid,
        payload.check_in,
        payload.check_out,
        payload.guests,
        created.total,
        payload.property.as_str(),
        created.pms_booking_id,
        payload.room_type_id,
        guest_name,
        guest_phone,
        payload.payment_option,
        created.amount_due_now,
        balance_due,
        created.hold_expires_at,
    )
    .execute(state.db())
    .await;

    if let Err(e) = inserted {
        tracing::error!(error = %e, pms_booking_id = %created.pms_booking_id,
            "channel record insert failed; releasing PMS hold");
        if let Err(release_err) = pms.release(&created.pms_booking_id).await {
            tracing::error!(error = %release_err, pms_booking_id = %created.pms_booking_id,
                "failed to release PMS hold after insert failure");
        }
        return Err(e.into());
    }

    tracing::info!(
        booking_id = %booking_id,
        pms_booking_id = %created.pms_booking_id,
        property = %payload.property,
        payment_option = %payload.payment_option,
        "channel booking held"
    );

    // Same notification as the in-app path, after the insert succeeded (B0).
    crate::services::booking_notify::notify(
        &state,
        booking_id,
        crate::services::booking_notify::BookingNotifyEvent::BookingCreated,
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(ChannelBookingResponse {
            booking_id,
            pms_booking_id: created.pms_booking_id,
            total_amount: created.total.to_f64().unwrap_or(0.0),
            amount_due_now: amount_due_now_f64,
            balance_due_at_checkin: balance_due.to_f64().unwrap_or(0.0),
            promptpay_qr_payload: qr_payload,
            hold_expires_at: created.hold_expires_at,
        }),
    ))
}

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
/// - POST /api/bookings/:id/slips - Attach a payment slip URL to a booking
/// - DELETE /api/bookings/slips/:slip_id - Remove a payment slip
/// - POST /api/bookings/:id/complete - Mark booking as completed (admin only)
/// - GET /api/bookings/availability - Check room availability
///
/// All routes require authentication via the auth_middleware.
/// Admin-only operations are protected with role checks within handlers.
pub fn router() -> Router<AppState> {
    Router::new()
        // Live availability from the PMS (ADR-0003). Replaces the old
        // local-inventory availability check.
        .route("/availability", get(channel_availability))
        // Create a held booking in the PMS + local channel record.
        .route("/channel", post(create_channel_booking))
        // User booking routes
        .route("/", get(list_bookings))
        .route("/", post(create_booking))
        .route("/:id", get(get_booking))
        .route("/:id", put(update_booking))
        .route("/:id/cancel", post(cancel_booking))
        .route("/:id/slips", post(add_booking_slip))
        // Slip routes are flat (not nested under booking id) to match the
        // contract the frontend already calls: `DELETE /api/bookings/slips/:id`.
        .route("/slips/:slip_id", delete(delete_booking_slip))
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
        .route("/", get(list_bookings))
        .route("/", post(create_booking))
        .route("/:id", get(get_booking))
        .route("/:id", put(update_booking))
        .route("/:id/cancel", post(cancel_booking))
        .route("/:id/slips", post(add_booking_slip))
        .route("/slips/:slip_id", delete(delete_booking_slip))
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
