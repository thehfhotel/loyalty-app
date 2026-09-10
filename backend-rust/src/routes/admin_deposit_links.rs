//! Admin deposit-request-link routes — the reception half of workstream B1
//!
//! Reception has already taken the booking (phone, LINE, walk-in). These
//! endpoints turn it into an app booking plus one link the guest can pay
//! against, and give the desk the three things it needs afterwards: see
//! the links, kill one, mint a replacement.
//!
//! ## Endpoints
//!
//! - `POST /api/admin/deposit-links`             — create booking + link
//! - `GET  /api/admin/deposit-links`             — list, filtered by state
//! - `POST /api/admin/deposit-links/:id/revoke`  — kill a link
//! - `POST /api/admin/deposit-links/:id/reissue` — kill it and mint another
//!
//! Mounted by merging into `routes::admin`, which applies
//! `auth_middleware`; each handler then calls `require_admin`, the pattern
//! `routes::admin_slips` uses.
//!
//! ## The booking these create
//!
//! An ordinary `bookings` row: `status = 'pending'`, `room_id` NULL,
//! `room_type_id` set (so the row shows up in the existing admin booking
//! list, which inner-joins `room_types`), `booking_source =
//! 'deposit_link'`, `pms_booking_id` **NULL**, and the iHOTEL number — if
//! reception typed one — in `pms_ref`.
//!
//! `pms_booking_id` is the trap. `services::slip_confirm` treats a
//! non-null value there as a PMS channel booking and calls
//! `pms.payment_verified()`; the channel is dark, so the admin's Verify
//! button would 500 and the automatic path would revert the slip with
//! `confirm_failed`. `pms_ref` exists precisely so nothing reads it.
//!
//! `hold_expires_at` is set to the link's expiry, which is what makes a
//! late slip land on `booking_not_payable` for free. It is safe: the
//! channel expiry sweep is guarded on `pms_booking_id IS NOT NULL`.
//!
//! ## The token
//!
//! Minted here, returned **once**, and never stored in plaintext — see
//! `routes::deposit_links`. Losing it means Reissue.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{require_admin, AuthUser};
use crate::routes::deposit_links::{
    generate_token, token_hash, BOOKING_SOURCE_DEPOSIT_LINK, DEPOSIT_LINK_SYSTEM_USER_ID,
};
use crate::state::AppState;
use crate::types::Property;

// ============================================================================
// Policy constants
// ============================================================================

/// Default link lifetime when reception does not choose one.
const DEFAULT_EXPIRY_HOURS: i64 = 48;
/// Hard cap. A payment link that outlives a week is a liability, not a
/// convenience.
const MAX_EXPIRY_HOURS: i64 = 24 * 7;
/// Thailand has no DST, so a fixed offset is exact rather than an
/// approximation. Same construction `services::slipok` uses to read SlipOK
/// timestamps.
const BANGKOK_UTC_OFFSET_SECONDS: i32 = 7 * 3600;

/// Audit actions. Distinct strings so the desk's history panel can tell
/// "a link was issued for this booking" from "the link was replaced".
const ACTION_LINK_ISSUED: &str = "deposit_link_issued";
const ACTION_LINK_REVOKED: &str = "deposit_link_revoked";
const ACTION_LINK_REISSUED: &str = "deposit_link_reissued";

// ============================================================================
// DTOs
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateDepositLinkRequest {
    pub property: Property,
    #[validate(length(
        min = 1,
        max = 255,
        message = "guestName must be between 1 and 255 characters"
    ))]
    pub guest_name: String,
    #[validate(length(
        min = 1,
        max = 32,
        message = "guestPhone must be between 1 and 32 characters"
    ))]
    pub guest_phone: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    #[validate(range(min = 1, max = 10, message = "guests must be between 1 and 10"))]
    pub guests: i32,
    pub room_type_id: Uuid,
    pub total_price: Decimal,
    /// Optional override of the 50% default. Must land inside
    /// `[1, totalPrice]`; the override is written to the audit row.
    pub amount_due_now: Option<Decimal>,
    #[validate(length(max = 100, message = "pmsRef must be 100 characters or fewer"))]
    pub pms_ref: Option<String>,
    pub expires_in_hours: Option<i64>,
    #[validate(length(max = 1000, message = "note must be 1000 characters or fewer"))]
    pub note: Option<String>,
}

/// The one time the token is ever visible.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositLinkCreatedResponse {
    pub link_id: Uuid,
    pub booking_id: Uuid,
    /// Shown to the issuing admin once and never again.
    pub token: String,
    /// **The link itself, and the primary action in the modal.**
    /// `https://<FRONTEND_URL>/d#<token>` — the token in the fragment, so
    /// no server on the way ever sees it. See [`guest_link_url`].
    ///
    /// Reception copies this and sends it by whatever channel the guest
    /// actually uses: LINE, SMS, WhatsApp, Messenger, a phone call read
    /// out loud. Copying hands the link to nobody but reception, which is
    /// why it is the primary action and [`Self::line_share_url`] is the
    /// second one.
    pub url: String,
    /// Pre-composed LINE share intent, Thai-first and with no vendor name.
    ///
    /// **Tapping this hands the link to LINE.** The token is inside the
    /// `text` parameter of a `line.me/R/share` URL, so it goes to LINE's
    /// servers as part of composing the message, and then to whatever
    /// chat reception picks. That is not a leak to route around — sharing
    /// a link *through* LINE necessarily transmits the link, and this is
    /// how reception has always sent these — but it is the reason the
    /// plain [`url`](Self::url) above is the primary action: a guest who
    /// is not on LINE, or a reception desk that would rather send an SMS,
    /// must never have to go through LINE to deliver a payment link.
    ///
    /// The token is a bearer capability, so both fields are as sensitive
    /// as each other; neither is ever logged.
    pub line_share_url: String,
    pub total_amount: f64,
    pub amount_due_now: f64,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReissueDepositLinkRequest {
    pub expires_in_hours: Option<i64>,
}

impl ReissueDepositLinkRequest {
    /// Parse the request body, which §2 makes optional.
    ///
    /// Not `Option<Json<Self>>`: that yields `None` for an *absent* body
    /// and, indistinguishably, for a body that failed to deserialize or
    /// arrived without a JSON content-type. `{"expiresInHours": "24"}` —
    /// a string, which is what a form field bound straight to an input
    /// produces — would then fall through to the 48-hour default, answer
    /// 201, and never tell reception their 24 was ignored. It would also
    /// silently swallow any field added to this body later.
    fn parse(body: &[u8]) -> AppResult<Self> {
        if body.iter().all(|b| b.is_ascii_whitespace()) {
            return Ok(Self::default());
        }
        serde_json::from_slice(body).map_err(|e| {
            AppError::Validation(format!("Could not read the reissue request body: {e}"))
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDepositLinksQuery {
    /// `open` | `paid` | `expired` | `revoked`. Absent means all.
    pub status: Option<String>,
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_page() -> i64 {
    1
}
fn default_limit() -> i64 {
    20
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositLinkSummary {
    pub link_id: Uuid,
    pub booking_id: Uuid,
    pub property: Option<String>,
    pub guest_name: Option<String>,
    pub amount_due_now: f64,
    pub state: String,
    pub expires_at: DateTime<Utc>,
    pub issued_by_name: String,
    pub issued_at: DateTime<Utc>,
    /// When the guest's most recent viewing SESSION started, or `null` when
    /// they have never opened the link.
    ///
    /// The reception surface (B2) leans on the null: "issued two days ago,
    /// never opened" is a phone call to make, while "opened an hour ago,
    /// still awaiting payment" is a guest who is probably mid-transfer. The
    /// column is written at most once per 30 minutes, so the guest page
    /// polling itself every 5 seconds does not turn this into "just now"
    /// forever — see the migration's column comment.
    pub last_opened_at: Option<DateTime<Utc>>,
    pub slipok_status: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDepositLinksResponse {
    pub links: Vec<DepositLinkSummary>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeDepositLinkResponse {
    pub state: &'static str,
}

// ============================================================================
// Create
// ============================================================================

/// `POST /api/admin/deposit-links`
async fn create_deposit_link(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<CreateDepositLinkRequest>,
) -> AppResult<(StatusCode, Json<DepositLinkCreatedResponse>)> {
    require_admin(&auth_user)?;
    payload.validate()?;

    let admin_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    let guest_name = payload.guest_name.trim().to_string();
    let guest_phone = payload.guest_phone.trim().to_string();
    if guest_name.is_empty() || guest_phone.is_empty() {
        return Err(AppError::Validation(
            "guestName and guestPhone are required".to_string(),
        ));
    }

    validate_stay_dates(payload.check_in, payload.check_out)?;

    let total_price = payload
        .total_price
        .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    if total_price < Decimal::ONE {
        return Err(AppError::Validation(
            "totalPrice must be at least 1".to_string(),
        ));
    }

    let (amount_due_now, is_override) =
        resolve_amount_due_now(total_price, payload.amount_due_now)?;
    let balance_due = total_price - amount_due_now;
    let payment_option = if amount_due_now == total_price {
        "full"
    } else {
        "deposit50"
    };

    let expires_at = resolve_expiry(Utc::now(), payload.check_in, payload.expires_in_hours)?;

    // PromptPay has to be configured for this property BEFORE anything is
    // written: a link whose page cannot show a QR is a booking the guest
    // can never pay, and finding that out at open time is worse than
    // finding it out here.
    //
    // A 400 naming the property, not a 500. `AppError::Configuration`
    // answers "Server configuration error" and throws the property name
    // away, so reception issuing the first link after a misspelt
    // `PROMPTPAY_HF_ID` would see a generic server error, assume the app
    // is down and page someone — when the fix is one environment
    // variable. It is also what the OpenAPI stub for this path documents.
    if state
        .config()
        .promptpay
        .id_for_property(payload.property.as_str())
        .is_none()
    {
        return Err(AppError::Validation(format!(
            "The PromptPay receiving account for {} is not configured, so this link would have no QR. Ask an admin to set it before issuing links.",
            payload.property
        )));
    }

    // The room type is what puts the booking on the existing admin list
    // (it inner-joins `room_types`), so an unknown or retired one is a
    // booking reception would never see again.
    let room_type_exists = sqlx::query_scalar!(
        r#"SELECT id FROM room_types WHERE id = $1 AND is_active"#,
        payload.room_type_id,
    )
    .fetch_optional(state.db())
    .await?
    .is_some();
    if !room_type_exists {
        return Err(AppError::Validation(
            "roomTypeId does not name an active room type".to_string(),
        ));
    }

    let pms_ref = payload
        .pms_ref
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let note = payload
        .note
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let booking_id = Uuid::new_v4();
    let token = generate_token();
    let hash = token_hash(&token);

    // Booking, link and audit row in one transaction: a link with no
    // booking is unreachable, and a booking with no link is money nobody
    // asked for.
    let mut tx = state.db().begin().await?;

    sqlx::query!(
        r#"
        INSERT INTO bookings (
            id, user_id, room_id, room_type_id, check_in_date, check_out_date,
            num_guests, total_price, status, property, guest_name, guest_phone,
            payment_option, amount_due_now, balance_due, hold_expires_at,
            booking_source, pms_ref
        )
        VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'pending', $8, $9, $10,
                $11, $12, $13, $14, $15, $16)
        "#,
        booking_id,
        DEPOSIT_LINK_SYSTEM_USER_ID,
        payload.room_type_id,
        payload.check_in,
        payload.check_out,
        payload.guests,
        total_price,
        payload.property.as_str(),
        guest_name,
        guest_phone,
        payment_option,
        amount_due_now,
        balance_due,
        expires_at,
        BOOKING_SOURCE_DEPOSIT_LINK,
        pms_ref,
    )
    .execute(&mut *tx)
    .await?;

    let link_id = insert_link(&mut tx, booking_id, &hash, admin_id, expires_at, note).await?;

    insert_audit_row(
        &mut *tx,
        booking_id,
        admin_id,
        ACTION_LINK_ISSUED,
        None,
        Some(json!({
            "linkId": link_id,
            "expiresAt": expires_at,
            "amountDueNow": amount_due_now,
            "totalPrice": total_price,
            "depositOverridden": is_override,
            "bookingSource": BOOKING_SOURCE_DEPOSIT_LINK,
        })),
        is_override
            .then(|| format!("Deposit overridden to {amount_due_now} of a {total_price} total")),
    )
    .await?;

    tx.commit().await?;

    // Tell the property's desk a guest is coming. Deliberately after the
    // commit: the booking and its link are durable before anyone is told
    // about them, and `notify` claims its dedup key against a row that
    // exists. Best-effort by contract — infallible, fire-and-forget, and it
    // carries neither the slip image nor the payer's bank details.
    crate::services::booking_notify::notify(
        &state,
        booking_id,
        crate::services::booking_notify::BookingNotifyEvent::BookingCreated,
    )
    .await;

    tracing::info!(
        link_id = %link_id,
        booking_id = %booking_id,
        admin_id = %admin_id,
        property = %payload.property,
        deposit_overridden = is_override,
        "deposit link issued"
    );

    Ok((
        StatusCode::CREATED,
        Json(build_created_response(
            &state,
            link_id,
            booking_id,
            token,
            payload.property,
            total_price,
            amount_due_now,
            expires_at,
        )),
    ))
}

// ============================================================================
// List
// ============================================================================

/// `GET /api/admin/deposit-links`
///
/// `state` is computed in SQL from exactly the rules
/// `deposit_links::derive_state` applies in Rust, because the filter has
/// to run before pagination. The two are pinned together by the
/// integration suite; if you change one, change the other.
async fn list_deposit_links(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<ListDepositLinksQuery>,
) -> AppResult<Json<ListDepositLinksResponse>> {
    require_admin(&auth_user)?;

    let page = query.page.max(1);
    let limit = query.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    // `None` means "every state". The array is passed as one parameter so
    // the query text stays static and the compile-time macro can check it.
    let wanted: Option<Vec<String>> = match query.status.as_deref().map(str::trim) {
        None | Some("") => None,
        Some("open") => Some(vec![
            crate::routes::deposit_links::STATE_AWAITING_PAYMENT.to_string(),
            crate::routes::deposit_links::STATE_CHECKING.to_string(),
        ]),
        Some("paid") => Some(vec![
            crate::routes::deposit_links::STATE_CONFIRMED.to_string()
        ]),
        Some("expired") => Some(vec![crate::routes::deposit_links::STATE_EXPIRED.to_string()]),
        Some("revoked") => Some(vec![crate::routes::deposit_links::STATE_REVOKED.to_string()]),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "Unknown status filter '{}'. Expected open, paid, expired or revoked.",
                other.chars().take(20).collect::<String>()
            )))
        },
    };

    let rows = sqlx::query!(
        r#"
        WITH link_state AS (
            SELECT l.id           AS link_id,
                   l.booking_id   AS booking_id,
                   l.expires_at   AS expires_at,
                   l.issued_at    AS issued_at,
                   l.issued_by    AS issued_by,
                   l.last_opened_at AS last_opened_at,
                   b.property     AS property,
                   b.guest_name   AS guest_name,
                   COALESCE(b.amount_due_now, b.total_price) AS amount_due_now,
                   s.latest_slipok_status AS latest_slipok_status,
                   CASE
                       WHEN l.revoked_at IS NOT NULL THEN 'revoked'
                       WHEN l.expires_at <= NOW() AND NOT s.any_verified THEN 'expired'
                       WHEN b.status = 'confirmed' OR s.any_verified THEN 'confirmed'
                       WHEN s.any_slip THEN 'checking'
                       ELSE 'awaiting_payment'
                   END AS state
            FROM booking_deposit_links l
            JOIN bookings b ON b.id = l.booking_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) > 0 AS any_slip,
                       COALESCE(BOOL_OR(admin_status = 'verified'), FALSE) AS any_verified,
                       (ARRAY_AGG(slipok_status ORDER BY uploaded_at DESC NULLS LAST))[1]
                           AS latest_slipok_status
                FROM booking_slips
                WHERE booking_id = b.id
            ) s ON TRUE
        )
        SELECT ls.link_id        AS "link_id!",
               ls.booking_id     AS "booking_id!",
               ls.property,
               ls.guest_name,
               ls.amount_due_now AS "amount_due_now!",
               ls.state          AS "state!",
               ls.expires_at     AS "expires_at!",
               ls.issued_at      AS "issued_at!",
               ls.last_opened_at,
               ls.latest_slipok_status,
               COALESCE(
                   NULLIF(TRIM(CONCAT(p.first_name, ' ', p.last_name)), ''),
                   u.email,
                   'unknown'
               ) AS "issued_by_name!"
        FROM link_state ls
        JOIN users u ON u.id = ls.issued_by
        LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE $1::text[] IS NULL OR ls.state = ANY($1::text[])
        ORDER BY ls.issued_at DESC
        LIMIT $2 OFFSET $3
        "#,
        wanted.as_deref(),
        limit,
        offset,
    )
    .fetch_all(state.db())
    .await?;

    let total: i64 = sqlx::query_scalar!(
        r#"
        WITH link_state AS (
            SELECT CASE
                       WHEN l.revoked_at IS NOT NULL THEN 'revoked'
                       WHEN l.expires_at <= NOW() AND NOT s.any_verified THEN 'expired'
                       WHEN b.status = 'confirmed' OR s.any_verified THEN 'confirmed'
                       WHEN s.any_slip THEN 'checking'
                       ELSE 'awaiting_payment'
                   END AS state
            FROM booking_deposit_links l
            JOIN bookings b ON b.id = l.booking_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) > 0 AS any_slip,
                       COALESCE(BOOL_OR(admin_status = 'verified'), FALSE) AS any_verified
                FROM booking_slips
                WHERE booking_id = b.id
            ) s ON TRUE
        )
        SELECT COUNT(*) AS "total!"
        FROM link_state ls
        WHERE $1::text[] IS NULL OR ls.state = ANY($1::text[])
        "#,
        wanted.as_deref(),
    )
    .fetch_one(state.db())
    .await?;

    let links = rows
        .into_iter()
        .map(|r| DepositLinkSummary {
            link_id: r.link_id,
            booking_id: r.booking_id,
            property: r.property,
            guest_name: r.guest_name,
            amount_due_now: r.amount_due_now.to_f64().unwrap_or(0.0),
            state: r.state,
            expires_at: r.expires_at,
            issued_by_name: r.issued_by_name,
            issued_at: r.issued_at,
            last_opened_at: r.last_opened_at,
            slipok_status: r.latest_slipok_status,
        })
        .collect();

    Ok(Json(ListDepositLinksResponse { links, total }))
}

// ============================================================================
// Revoke / reissue
// ============================================================================

/// `POST /api/admin/deposit-links/:id/revoke`
///
/// Idempotent: revoking an already-revoked link answers 200 with the same
/// body. Reception pressing the button twice is not an error, and a 409
/// there would send them looking for a problem that does not exist.
async fn revoke_deposit_link(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(link_id): Path<Uuid>,
) -> AppResult<Json<RevokeDepositLinkResponse>> {
    require_admin(&auth_user)?;
    let admin_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;

    let mut tx = state.db().begin().await?;

    let existing = sqlx::query!(
        r#"
        SELECT booking_id AS "booking_id!", revoked_at
        FROM booking_deposit_links
        WHERE id = $1
        FOR UPDATE
        "#,
        link_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Deposit link".to_string()))?;

    if existing.revoked_at.is_none() {
        sqlx::query!(
            r#"UPDATE booking_deposit_links SET revoked_at = NOW() WHERE id = $1"#,
            link_id,
        )
        .execute(&mut *tx)
        .await?;

        insert_audit_row(
            &mut *tx,
            existing.booking_id,
            admin_id,
            ACTION_LINK_REVOKED,
            None,
            Some(json!({ "linkId": link_id })),
            None,
        )
        .await?;
    }

    tx.commit().await?;

    tracing::info!(
        link_id = %link_id,
        booking_id = %existing.booking_id,
        admin_id = %admin_id,
        already_revoked = existing.revoked_at.is_some(),
        "deposit link revoked"
    );

    Ok(Json(RevokeDepositLinkResponse {
        state: crate::routes::deposit_links::STATE_REVOKED,
    }))
}

/// `POST /api/admin/deposit-links/:id/reissue`
///
/// Every live token on the booking dies and a new one is minted against
/// the *same booking*, in one transaction, with the booking row locked so
/// two reissues cannot race. The partial unique index
/// `booking_deposit_links_one_live_uidx` is the backstop: two live tokens
/// for one booking cannot exist even if a future handler forgets the
/// revoke.
///
/// Reissuing the *same link id* twice is therefore idempotent-shaped
/// rather than an error: the second call finds nothing live left to
/// revoke, revokes the link the first call minted, and hands back a third
/// one. Reception double-clicking Reissue gets a link, not a 500.
///
/// The booking's `hold_expires_at` moves with the new link, because that
/// column is what `slipok_check` reads to decide whether a slip is still
/// payable — leaving it on the dead link's expiry would reject the slip
/// the reissue exists to collect.
async fn reissue_deposit_link(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(link_id): Path<Uuid>,
    body: axum::body::Bytes,
) -> AppResult<(StatusCode, Json<DepositLinkCreatedResponse>)> {
    require_admin(&auth_user)?;
    let admin_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;
    let expires_in_hours = ReissueDepositLinkRequest::parse(&body)?.expires_in_hours;

    let mut tx = state.db().begin().await?;

    let old = sqlx::query!(
        r#"
        SELECT l.booking_id      AS "booking_id!",
               l.note,
               b.property,
               b.check_in_date   AS "check_in_date!",
               b.total_price     AS "total_price!",
               b.amount_due_now
        FROM booking_deposit_links l
        JOIN bookings b ON b.id = l.booking_id
        WHERE l.id = $1
        FOR UPDATE OF l
        "#,
        link_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Deposit link".to_string()))?;

    let property: Property = old
        .property
        .as_deref()
        .unwrap_or_default()
        .parse()
        .map_err(|_| {
            AppError::Conflict("This booking has no property and cannot be reissued".to_string())
        })?;

    let expires_at = resolve_expiry(Utc::now(), old.check_in_date, expires_in_hours)?;

    // Lock the booking, not just the named link, so two reissues racing on
    // the same booking serialise here rather than at the unique index.
    sqlx::query_scalar!(
        r#"SELECT id AS "id!" FROM bookings WHERE id = $1 FOR UPDATE"#,
        old.booking_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    // Revoke every LIVE link on this booking, not only the one named in
    // the path. Revoking just that row is a no-op when it is already
    // revoked — which is exactly the state reception is in when they
    // double-click Reissue, retry after a timeout, or press Reissue on a
    // link some earlier reissue already replaced (the desk still has the
    // old link id on screen; nothing tells the UI to forget it). The
    // insert below would then be the second live link on the booking, the
    // partial unique index `booking_deposit_links_one_live_uidx` would
    // reject it, and reception would get a bare 500 out of the one
    // operation whose entire purpose is to recover a lost link.
    sqlx::query!(
        r#"
        UPDATE booking_deposit_links
        SET revoked_at = NOW()
        WHERE booking_id = $1 AND revoked_at IS NULL
        "#,
        old.booking_id,
    )
    .execute(&mut *tx)
    .await?;

    let token = generate_token();
    let hash = token_hash(&token);
    let new_link_id = insert_link(
        &mut tx,
        old.booking_id,
        &hash,
        admin_id,
        expires_at,
        old.note.clone(),
    )
    .await?;

    sqlx::query!(
        r#"UPDATE bookings SET hold_expires_at = $1, updated_at = NOW() WHERE id = $2"#,
        expires_at,
        old.booking_id,
    )
    .execute(&mut *tx)
    .await?;

    insert_audit_row(
        &mut *tx,
        old.booking_id,
        admin_id,
        ACTION_LINK_REISSUED,
        Some(json!({ "linkId": link_id })),
        Some(json!({ "linkId": new_link_id, "expiresAt": expires_at })),
        None,
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        previous_link_id = %link_id,
        link_id = %new_link_id,
        booking_id = %old.booking_id,
        admin_id = %admin_id,
        "deposit link reissued"
    );

    let total_price = old.total_price;
    let amount_due_now = old.amount_due_now.unwrap_or(total_price);

    Ok((
        StatusCode::CREATED,
        Json(build_created_response(
            &state,
            new_link_id,
            old.booking_id,
            token,
            property,
            total_price,
            amount_due_now,
            expires_at,
        )),
    ))
}

// ============================================================================
// Shared helpers
// ============================================================================

async fn insert_link(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    booking_id: Uuid,
    token_hash: &[u8],
    issued_by: Uuid,
    expires_at: DateTime<Utc>,
    note: Option<String>,
) -> AppResult<Uuid> {
    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO booking_deposit_links
            (booking_id, token_hash, issued_by, expires_at, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
        booking_id,
        token_hash,
        issued_by,
        expires_at,
        note,
    )
    .fetch_one(&mut **tx)
    .await?;

    Ok(id)
}

/// 50% of the total, rounded half up to 2 dp, unless reception overrode
/// it. An override outside `[1, total]` is refused: below 1 the PromptPay
/// payload is invalid, and above the total the guest would be asked for
/// money the booking does not owe.
fn resolve_amount_due_now(
    total_price: Decimal,
    override_value: Option<Decimal>,
) -> AppResult<(Decimal, bool)> {
    let half = (total_price / Decimal::TWO)
        .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);

    let Some(requested) = override_value else {
        return Ok((half, false));
    };

    let requested = requested.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    if requested < Decimal::ONE || requested > total_price {
        return Err(AppError::Validation(format!(
            "amountDueNow must be between 1 and the total ({total_price})"
        )));
    }

    Ok((requested, requested != half))
}

fn validate_stay_dates(check_in: NaiveDate, check_out: NaiveDate) -> AppResult<()> {
    if check_out <= check_in {
        return Err(AppError::Validation(
            "checkOut must be after checkIn".to_string(),
        ));
    }
    if check_in < Utc::now().date_naive() {
        return Err(AppError::Validation(
            "checkIn cannot be in the past".to_string(),
        ));
    }
    Ok(())
}

/// When the link dies.
///
/// Three rules, in order: the requested lifetime (default 48h), the 7-day
/// hard cap, and **never later than 12:00 on the check-in date**, local
/// time — a link that can still be paid after the guest was due to arrive
/// is a payment nobody at the desk is expecting.
///
/// If the noon cut-off has already passed (a same-day booking taken in the
/// afternoon), no link can be issued and the caller is told why, rather
/// than being handed a link that is dead on arrival.
fn resolve_expiry(
    now: DateTime<Utc>,
    check_in: NaiveDate,
    requested_hours: Option<i64>,
) -> AppResult<DateTime<Utc>> {
    let hours = requested_hours.unwrap_or(DEFAULT_EXPIRY_HOURS);
    if hours < 1 {
        return Err(AppError::Validation(
            "expiresInHours must be at least 1".to_string(),
        ));
    }
    let hours = hours.min(MAX_EXPIRY_HOURS);

    let offset = chrono::FixedOffset::east_opt(BANGKOK_UTC_OFFSET_SECONDS)
        .expect("UTC+7 is a valid fixed offset");
    let noon_local = check_in
        .and_hms_opt(12, 0, 0)
        .expect("12:00:00 is a valid time");
    let checkin_noon = offset
        .from_local_datetime(&noon_local)
        .single()
        .ok_or_else(|| AppError::Internal("ambiguous check-in noon".to_string()))?
        .with_timezone(&Utc);

    if checkin_noon <= now {
        return Err(AppError::Validation(
            "A deposit link cannot be issued after 12:00 on the check-in date; \
             take the payment at the desk instead"
                .to_string(),
        ));
    }

    Ok((now + Duration::hours(hours)).min(checkin_noon))
}

#[allow(clippy::too_many_arguments)]
fn build_created_response(
    state: &AppState,
    link_id: Uuid,
    booking_id: Uuid,
    token: String,
    property: Property,
    total_price: Decimal,
    amount_due_now: Decimal,
    expires_at: DateTime<Utc>,
) -> DepositLinkCreatedResponse {
    let url = guest_link_url(&state.config().server.frontend_url, &token);
    let line_share_url = line_share_url(property, amount_due_now, total_price, &url);

    DepositLinkCreatedResponse {
        link_id,
        booking_id,
        token,
        url,
        line_share_url,
        total_amount: total_price.to_f64().unwrap_or(0.0),
        amount_due_now: amount_due_now.to_f64().unwrap_or(0.0),
        expires_at,
    }
}

/// `https://loyalty.saichon.com/d#<token>` in production — the SPA's
/// public route with the token in the **fragment**. Built from
/// `FRONTEND_URL` so staging links point at staging.
///
/// The `#` is the whole point and is not a style choice. A fragment is
/// never sent to a server: not to our nginx, not to Cloudflare, not in a
/// `Referer` header. A token in the path instead would be written into the
/// frontend container's access log and Cloudflare's HTTP logs on every
/// single page load, and a bearer capability for a payment that is sitting
/// in two log stores is a payment page anyone with log access can open.
/// `routes::deposit_links` explains the matching header decision on the
/// API side.
fn guest_link_url(frontend_url: &str, token: &str) -> String {
    format!("{}/d#{}", frontend_url.trim_end_matches('/'), token)
}

/// A LINE share intent reception can tap straight from the modal — the
/// *second* action, after copying the plain link.
///
/// Tapping it opens LINE's share sheet with the message pre-composed,
/// which means the link is handed to LINE. See
/// [`DepositLinkCreatedResponse::line_share_url`].
///
/// Thai first, and **no vendor name anywhere** — the guest is told what to
/// pay and where, never who checks it. The strings are the ones in
/// `direct-booking-designs/f-policy-copy-drafts.md` §6, so they go through
/// the same Thai review as the rest of the guest copy.
///
/// The noun branches on whether this is a deposit or the whole price.
/// `create_deposit_link` sets `payment_option = "full"` when reception
/// overrides the amount up to the total, and calling that "มัดจำ" would
/// tell a guest paying in full that they still owe a balance — while the
/// policy copy promises "ส่วนที่เหลือชำระที่แผนกต้อนรับตอนเช็คอิน", a
/// balance that in this case does not exist.
///
/// The property name stays in Latin script: "The Harbour Front Hotel" and
/// "HF Ville" are the brand as the OAs and the signage use it, and
/// inventing a Thai rendering here would be new copy with no source.
fn line_share_url(
    property: Property,
    amount_due_now: Decimal,
    total_price: Decimal,
    url: &str,
) -> String {
    let amount = format_baht(amount_due_now);
    let text = if amount_due_now >= total_price {
        format!(
            "ยืนยันการจองที่ {}\nกรุณาชำระยอดเต็ม {} บาท ที่ลิงก์นี้\n{}",
            property.display_name(),
            amount,
            url
        )
    } else {
        format!(
            "ยืนยันการจองที่ {}\nกรุณาชำระมัดจำ {} บาท ที่ลิงก์นี้\nส่วนที่เหลือชำระที่แผนกต้อนรับตอนเช็คอิน\n{}",
            property.display_name(),
            amount,
            url
        )
    };
    format!("https://line.me/R/share?text={}", percent_encode(&text))
}

/// A baht amount as a person reads it: thousands separated, and no
/// decimal point unless there are satang. "4,500", not "4500"; "4,500.50"
/// when it matters.
fn format_baht(amount: Decimal) -> String {
    let value = amount.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let rendered = if value.fract() == Decimal::ZERO {
        value.normalize().to_string()
    } else {
        format!("{:.2}", value)
    };
    let (integer, fraction) = match rendered.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (rendered.as_str(), None),
    };

    let sign = if integer.starts_with('-') { "-" } else { "" };
    let digits = integer.trim_start_matches('-');

    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }

    match fraction {
        Some(fraction) => format!("{sign}{grouped}.{fraction}"),
        None => format!("{sign}{grouped}"),
    }
}

/// Percent-encode everything outside the RFC 3986 unreserved set.
///
/// Hand-rolled rather than pulling a crate in for one call site: the
/// message is Thai, so almost every byte needs encoding and the "which
/// characters are safe in a query value" question has exactly one right
/// answer here — the unreserved set.
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            },
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

/// Mirrors `routes::admin_bookings::insert_audit_row`. Kept local rather
/// than importing that module's private helper — both files are part of
/// the admin surface and share the audit-row contract by convention, the
/// same choice `services::slip_confirm` made.
async fn insert_audit_row<'c, E>(
    executor: E,
    booking_id: Uuid,
    admin_id: Uuid,
    action: &str,
    before_data: Option<serde_json::Value>,
    after_data: Option<serde_json::Value>,
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

// ============================================================================
// Router
// ============================================================================

/// Merged into `routes::admin`, which supplies `auth_middleware`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/deposit-links", post(create_deposit_link))
        .route("/deposit-links", get(list_deposit_links))
        .route("/deposit-links/:id/revoke", post(revoke_deposit_link))
        .route("/deposit-links/:id/reissue", post(reissue_deposit_link))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn deposit_defaults_to_half_rounded_half_up() {
        assert_eq!(
            resolve_amount_due_now(dec!(3000.00), None).unwrap(),
            (dec!(1500.00), false)
        );
        // 2 dp, half away from zero: 1234.567 / 2 = 617.2835 -> 617.28
        assert_eq!(
            resolve_amount_due_now(dec!(1234.57), None).unwrap().0,
            dec!(617.29)
        );
        // The classic case the owner decision (W4) is about: an odd baht
        // total must not lose a satang.
        assert_eq!(
            resolve_amount_due_now(dec!(101.00), None).unwrap().0,
            dec!(50.50)
        );
    }

    #[test]
    fn an_override_equal_to_the_default_is_not_an_override() {
        let (amount, is_override) =
            resolve_amount_due_now(dec!(3000.00), Some(dec!(1500.00))).unwrap();
        assert_eq!(amount, dec!(1500.00));
        assert!(
            !is_override,
            "typing the default back in is not a decision the audit row needs to record"
        );
    }

    #[test]
    fn an_override_is_flagged_and_bounded() {
        let (amount, is_override) =
            resolve_amount_due_now(dec!(3000.00), Some(dec!(3000.00))).unwrap();
        assert_eq!(amount, dec!(3000.00));
        assert!(is_override, "paying in full is an override of the 50% rule");

        assert!(resolve_amount_due_now(dec!(3000.00), Some(dec!(0.50))).is_err());
        assert!(resolve_amount_due_now(dec!(3000.00), Some(dec!(3000.01))).is_err());
    }

    fn utc(y: i32, m: u32, d: u32, h: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, 0, 0).unwrap()
    }

    #[test]
    fn expiry_defaults_to_48_hours() {
        // Check-in far enough out that the noon cap does not bite.
        let now = utc(2026, 9, 10, 3);
        let expires = resolve_expiry(now, NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(), None)
            .expect("expiry");
        assert_eq!(expires, now + Duration::hours(48));
    }

    #[test]
    fn expiry_is_capped_at_seven_days() {
        let now = utc(2026, 9, 10, 3);
        let expires = resolve_expiry(
            now,
            NaiveDate::from_ymd_opt(2026, 12, 1).unwrap(),
            Some(24 * 30),
        )
        .expect("expiry");
        assert_eq!(expires, now + Duration::hours(MAX_EXPIRY_HOURS));
    }

    #[test]
    fn expiry_never_passes_noon_on_the_check_in_date() {
        // 2026-09-10 03:00 UTC = 10:00 Bangkok. Check-in tomorrow, asking
        // for 48 hours: the noon cut-off on the 11th wins.
        let now = utc(2026, 9, 10, 3);
        let expires = resolve_expiry(now, NaiveDate::from_ymd_opt(2026, 9, 11).unwrap(), Some(48))
            .expect("expiry");
        // 12:00 Bangkok on the 11th is 05:00 UTC on the 11th.
        assert_eq!(expires, utc(2026, 9, 11, 5));
    }

    #[test]
    fn no_link_after_the_noon_cut_off_has_passed() {
        // 2026-09-10 08:00 UTC = 15:00 Bangkok, check-in today: the cap is
        // already behind us, so the link would be dead on arrival.
        let now = utc(2026, 9, 10, 8);
        let err = resolve_expiry(now, NaiveDate::from_ymd_opt(2026, 9, 10).unwrap(), Some(48));
        assert!(matches!(err, Err(AppError::Validation(_))));
    }

    #[test]
    fn expiry_rejects_a_non_positive_lifetime() {
        let now = utc(2026, 9, 10, 3);
        let day = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert!(resolve_expiry(now, day, Some(0)).is_err());
        assert!(resolve_expiry(now, day, Some(-5)).is_err());
    }

    #[test]
    fn guest_link_url_is_the_locked_shape() {
        assert_eq!(
            guest_link_url("https://loyalty.saichon.com", "abc123"),
            "https://loyalty.saichon.com/d#abc123"
        );
        // A trailing slash in FRONTEND_URL must not produce `//d#`.
        assert_eq!(
            guest_link_url("https://loyalty.saichon.com/", "abc123"),
            "https://loyalty.saichon.com/d#abc123"
        );
        // The token must be in the fragment, never in the path: a path is
        // logged by every hop, a fragment is sent to none of them.
        let url = guest_link_url("https://loyalty.saichon.com", "abc123");
        let (before_hash, _) = url.split_once('#').expect("the token is a fragment");
        assert!(
            !before_hash.contains("abc123"),
            "no part of the URL a server sees may carry the token: {url}"
        );
    }

    #[test]
    fn line_share_url_carries_the_link_and_no_vendor_name() {
        let url = line_share_url(
            Property::Hfville,
            dec!(1500.00),
            dec!(3000.00),
            "https://loyalty.saichon.com/d#tok",
        );
        assert!(url.starts_with("https://line.me/R/share?text="));
        // The URL itself has to survive encoding intact.
        assert!(url.contains("https%3A%2F%2Floyalty.saichon.com%2Fd%23tok"));
        // No vendor ever appears in guest-facing copy.
        assert!(!url.to_lowercase().contains("slipok"));
        // A half payment is a มัดจำ, and the balance line goes with it.
        assert!(url.contains(&percent_encode("กรุณาชำระมัดจำ 1,500 บาท")));
        assert!(url.contains(&percent_encode("ส่วนที่เหลือชำระที่แผนกต้อนรับตอนเช็คอิน")));
    }

    /// Reception can override the amount up to the full price, and then
    /// the message must not call it a deposit or promise a balance the
    /// guest does not owe.
    #[test]
    fn line_share_url_calls_a_full_payment_a_full_payment() {
        let url = line_share_url(
            Property::Hf,
            dec!(4500.00),
            dec!(4500.00),
            "https://loyalty.saichon.com/d#tok",
        );
        assert!(url.contains(&percent_encode("กรุณาชำระยอดเต็ม 4,500 บาท")));
        assert!(
            !url.contains(&percent_encode("มัดจำ")),
            "a full payment is never a deposit"
        );
        assert!(
            !url.contains(&percent_encode("ส่วนที่เหลือ")),
            "there is no balance to pay at check-in"
        );
    }

    #[test]
    fn baht_amounts_read_the_way_a_person_reads_them() {
        assert_eq!(format_baht(dec!(4500.00)), "4,500");
        assert_eq!(format_baht(dec!(100)), "100");
        assert_eq!(format_baht(dec!(1234567.00)), "1,234,567");
        assert_eq!(format_baht(dec!(1500.50)), "1,500.50");
        assert_eq!(format_baht(dec!(999)), "999");
        assert_eq!(format_baht(dec!(1000)), "1,000");
    }

    #[test]
    fn percent_encode_leaves_unreserved_characters_alone() {
        assert_eq!(percent_encode("aZ0-_.~"), "aZ0-_.~");
        assert_eq!(percent_encode(" "), "%20");
        assert_eq!(percent_encode("/"), "%2F");
        // Thai is multi-byte UTF-8 and must be encoded byte by byte.
        assert_eq!(percent_encode("ก"), "%E0%B8%81");
    }

    #[test]
    fn stay_dates_must_be_a_real_stay() {
        let today = Utc::now().date_naive();
        assert!(validate_stay_dates(today, today).is_err());
        assert!(validate_stay_dates(today + Duration::days(2), today + Duration::days(1)).is_err());
        assert!(validate_stay_dates(today - Duration::days(1), today + Duration::days(1)).is_err());
        assert!(validate_stay_dates(today, today + Duration::days(1)).is_ok());
    }
}
