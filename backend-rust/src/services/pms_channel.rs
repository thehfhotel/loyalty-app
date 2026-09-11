//! PMS booking-channel client (ADR-0003).
//!
//! The loyalty app holds no room inventory: availability is queried live
//! from the PMS and confirmed bookings are created there. This module is
//! the outbound HTTP client for the PMS channel API; the interface
//! contract is locked in docs/launch-plan.md.

use chrono::{DateTime, NaiveDate, Utc};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config::Settings;
use crate::error::{AppError, AppResult};
use crate::types::Property;

/// Per-request ceiling for every PMS call.
///
/// `reqwest::Client::new()` has no timeout at all, which made a hung PMS
/// hold the caller's request open until the router's own 30s `TimeoutLayer`
/// cut it — turning a request that had already done its work into a 408 for
/// the guest. Anything the PMS cannot answer in this long is an outage, and
/// the caller is better off being told so.
///
/// `routes::bookings` budgets the inline slip check against this constant,
/// so raising it means raising that budget too.
pub const PMS_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Ceiling on *establishing* the connection, inside [`PMS_REQUEST_TIMEOUT`].
///
/// The total timeout alone leaves the worst case — a PMS host that accepts
/// the SYN and then says nothing — costing the full ten seconds before the
/// caller learns the PMS is not there. A bounded connect turns a dead host
/// into a fast, unambiguous failure and leaves the remaining budget for a
/// PMS that is actually answering. B8's checklist item L5 asks for "connect
/// + total"; this is the connect half.
pub const PMS_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// How long the one-in-flight hold guard holds its Redis lock.
///
/// Long enough to outlive the PMS call it wraps ([`PMS_REQUEST_TIMEOUT`])
/// plus the slack a guest needs to give up and tap "book" again: the whole
/// point is that the *retry* of a hung request finds the lock still held.
/// Short enough that a guest who genuinely wants a second, identical hold
/// waits seconds rather than minutes.
pub const HOLD_GUARD_TTL: std::time::Duration = std::time::Duration::from_secs(20);

/// Ceiling on reaching Redis for the hold guard.
///
/// The guard is a safety net, not a dependency: a Redis that does not answer
/// promptly must not add its latency to a booking. See
/// [`PmsChannelClient::acquire_hold_guard`] for what happens when it does
/// not answer at all.
const HOLD_GUARD_REDIS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Longest `pms_booking_id` this client will ever put in a URL.
///
/// **100, because `bookings.pms_booking_id` is `VARCHAR(100)`** (migration
/// `20260710000000_property_line_channel.sql`). A ceiling below the
/// column's is not a stricter safety net, it is a trap: the database would
/// accept a 90-character reference the PMS issued, the row would store it,
/// and then every call about that booking — the payment-verified
/// write-back, the hold-expiry release — would fail validation forever
/// with the booking already in the PMS. The two numbers are one decision;
/// if the column is ever widened, widen this with it.
///
/// It is a ceiling, not a format — the character rule below is what
/// actually decides.
const MAX_PMS_BOOKING_ID_LEN: usize = 100;

/// Characters that survive into the path segment untouched.
///
/// The allow-list in [`validate_pms_booking_id`] has already rejected
/// everything outside `[A-Za-z0-9_-]`, so for an id this client accepts the
/// encoder is a no-op and the request on the wire is byte-for-byte what it
/// was before. It stays because a URL built by `format!` has no encoder of
/// its own, and a second pair of hands on this file should not have to
/// re-derive that the id was checked three functions ago.
const PMS_PATH_SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_');

/// Why a `pms_booking_id` was refused before it could reach a URL.
///
/// A booking id is not ours: it arrives from the PMS, is stored on
/// `bookings.pms_booking_id`, and is read back much later by the
/// hold-expiry sweep and by the slip-verification path — and since the
/// deposit-link work (B1) the row that carries it can be written by more
/// than one flow. A value that is not what we think it is must never be
/// pasted into a URL: `../../`, a `//host` authority, a `?` or `#`, or a
/// newline would each aim the request somewhere the PMS is not.
///
/// This is deliberately its own type rather than an `AppError`: the caller
/// decides what to log and what (if anything) to tell the client, and the
/// rejected value never travels with the error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PmsBookingIdError {
    /// Empty or whitespace-only — there is no booking to address.
    #[error("PMS booking id is empty")]
    Empty,
    /// Longer than [`MAX_PMS_BOOKING_ID_LEN`].
    #[error("PMS booking id is too long")]
    TooLong,
    /// Contains something outside `[A-Za-z0-9_-]`.
    #[error("PMS booking id contains a character outside [A-Za-z0-9_-]")]
    IllegalCharacter,
}

/// Accept a `pms_booking_id` only if it is a short, plain, ASCII token.
///
/// A strict allow-list, not a deny-list: everything is refused unless it is
/// an ASCII letter, digit, `_` or `-`. That rules out every path,
/// authority, query and fragment character in one rule, and leaves nothing
/// to reason about per-character.
pub fn validate_pms_booking_id(id: &str) -> Result<&str, PmsBookingIdError> {
    if id.is_empty() {
        return Err(PmsBookingIdError::Empty);
    }
    if id.len() > MAX_PMS_BOOKING_ID_LEN {
        return Err(PmsBookingIdError::TooLong);
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(PmsBookingIdError::IllegalCharacter);
    }
    Ok(id)
}

/// The per-booking action URL, or the reason the id may not be used in one.
///
/// Split out of [`PmsChannelClient::post_action`] so the validation and the
/// encoding are one testable step: there is no way to reach the `format!`
/// without having gone through `validate_pms_booking_id` first.
fn action_url(
    base_url: &str,
    pms_booking_id: &str,
    action: &str,
) -> Result<String, PmsBookingIdError> {
    let id = validate_pms_booking_id(pms_booking_id)?;
    let segment = utf8_percent_encode(id, PMS_PATH_SEGMENT);
    Ok(format!(
        "{base_url}/api/channel/bookings/{segment}/{action}"
    ))
}

/// One bookable room type as reported by the PMS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PmsRoomType {
    pub room_type_id: String,
    pub name: String,
    pub description: Option<String>,
    pub nightly_price: Decimal,
    pub available_count: i32,
}

/// Availability response from the PMS.
#[derive(Debug, Deserialize)]
pub struct PmsAvailability {
    pub property: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub room_types: Vec<PmsRoomType>,
}

#[derive(Debug, Serialize)]
pub struct PmsGuest {
    pub name: String,
    pub phone: String,
}

#[derive(Debug, Serialize)]
pub struct PmsCreateBookingRequest {
    pub property: Property,
    pub room_type_id: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub guests: i32,
    pub guest: PmsGuest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_id: Option<String>,
    /// "deposit50" | "full"
    pub payment: String,
}

/// A held (tentative) booking created in the PMS.
#[derive(Debug, Deserialize)]
pub struct PmsBookingCreated {
    pub pms_booking_id: String,
    pub total: Decimal,
    pub amount_due_now: Decimal,
    pub hold_expires_at: DateTime<Utc>,
}

/// What the PMS said when it would not perform an action.
///
/// Split from "the PMS could not be reached" because the two demand opposite
/// handling and the old single `AppError` could not tell them apart: every
/// non-2xx answer became `ExternalServiceUnavailable`, i.e. "retry me". A
/// **409 on `payment-verified` is not a retryable outage** — it is the PMS
/// saying the hold is gone and no number of retries will bring it back, and
/// the slip behind it has to stop claiming the booking was confirmed.
#[derive(Debug)]
pub enum PmsActionError {
    /// The PMS answered **409 Conflict** about the booking itself.
    /// Definitive: the hold is gone and no retry brings it back.
    ///
    /// Deliberately NOT "any 4xx" — that was this type's first shape and it
    /// was wrong. Most 4xx answers on this path are *our* problem, not the
    /// booking's, and every one of them is fixed by someone and then
    /// retried:
    ///
    /// * **401** — `PMS_CHANNEL_TOKEN` rotated out from under us.
    /// * **403** — `HFVILLE_WRITES_ENABLED=false` refusing an HF Ville
    ///   mutation (`new-hotel/routes/channel.rs::channel_service_for`).
    /// * **404** — the channel router is not mounted, which is what a PMS
    ///   with a dead PG pool looks like from out here.
    /// * **400 / 415 / 422** — body drift between the two repos.
    /// * **A Cloudflare Access HTML challenge**, which arrives as a 302/401
    ///   or a 403 full of markup and is a network-edge problem.
    ///
    /// Treating any of those as definitive would send a slip to the desk as
    /// "this booking is dead" when the truth is "a token expired". They are
    /// all [`Unavailable`](Self::Unavailable).
    Refused {
        /// The HTTP status the PMS answered with (409 for a released hold).
        status: u16,
        /// The response body, truncated — it goes on an audit row a human
        /// reads, not into a log-only sink.
        body: String,
    },
    /// The PMS could not answer: transport failure, timeout, or 5xx. The
    /// action may well succeed on a retry.
    Unavailable(AppError),
}

/// The only status that means "this booking cannot take this action".
///
/// **409, and nothing else.** It is what `new-hotel`'s
/// `ChannelService::confirm_payment` answers for a hold it has already
/// released or cancelled (`service/channel.rs`: `ServiceError::conflict`,
/// mapped by `routes/channel.rs` to `StatusCode::CONFLICT`), and what
/// `docs/loyalty-channel.md:78-86` documents.
///
/// **410 was here and has been removed.** It was speculative — "a PMS that
/// ever starts hard-deleting expired holds would answer Gone" — and the
/// speculation does not hold: `StatusCode::GONE` appears in `new-hotel`
/// only in `routes/hk.rs` and `routes/new_maintenance.rs`, neither of which
/// is reachable from `/api/channel/*`. So a 410 on this path cannot have
/// come from the PMS's own logic; it can only have come from something
/// between us and it — a proxy retiring an endpoint, an edge returning a
/// cached tombstone — which is an outage, not a verdict about the booking.
/// Treating it as definitive would send a slip to reception reading "the
/// room is gone" because a load balancer was reconfigured.
const REFUSAL_STATUSES: [u16; 1] = [409];

/// 4xx statuses that are about *us*, not about what the caller asked for.
///
/// A rotated channel token, a disabled write gate and an unmounted router
/// are all operational faults on our side of the wire. Reporting them to a
/// guest as "PMS rejected your booking" sends them off to change dates that
/// were never the problem.
const NOT_THE_CALLERS_FAULT: [u16; 3] = [401, 403, 404];

/// Longest PMS response body kept on a refusal.
///
/// The body is written verbatim onto a `booking_audit_log` row, so it is
/// bounded here rather than at the reader: a PMS that answers a 4xx with an
/// HTML error page must not put a page of markup in the audit trail.
const MAX_PMS_REFUSAL_BODY: usize = 500;

impl PmsActionError {
    /// True when the PMS answered and refused — the caller must not retry.
    pub fn is_refusal(&self) -> bool {
        matches!(self, Self::Refused { .. })
    }
}

impl std::fmt::Display for PmsActionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused { status, body } => {
                write!(f, "PMS refused the action: {status} {body}")
            },
            Self::Unavailable(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PmsActionError {}

impl From<PmsActionError> for AppError {
    fn from(e: PmsActionError) -> Self {
        match e {
            // A refusal is the PMS's decision about the booking, not an
            // outage: 409, so nothing upstream schedules a retry.
            PmsActionError::Refused { status, body } => {
                AppError::Conflict(format!("PMS refused the action: {status} {body}"))
            },
            PmsActionError::Unavailable(inner) => inner,
        }
    }
}

pub struct PmsChannelClient {
    base_url: String,
    token: String,
    http: reqwest::Client,
    /// Where the one-in-flight hold guard takes its lock.
    ///
    /// Carried as a URL rather than a live connection because the client is
    /// built per request from `Settings` and `redis::Client::open` does no
    /// I/O — the connection is opened only when a hold is actually being
    /// created, which is a handful of times a day.
    redis_url: String,
}

impl PmsChannelClient {
    /// Build from settings; errors when the PMS channel is not configured
    /// (PMS_BASE_URL / PMS_CHANNEL_TOKEN).
    pub fn from_settings(settings: &Settings) -> AppResult<Self> {
        let base_url =
            settings.pms.base_url.clone().ok_or_else(|| {
                AppError::Configuration("PMS_BASE_URL is not configured".to_string())
            })?;
        let token = settings.pms.channel_token.clone().ok_or_else(|| {
            AppError::Configuration("PMS_CHANNEL_TOKEN is not configured".to_string())
        })?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
            http: reqwest::Client::builder()
                .timeout(PMS_REQUEST_TIMEOUT)
                .connect_timeout(PMS_CONNECT_TIMEOUT)
                .build()
                .map_err(|e| {
                    AppError::Internal(format!("Failed to build the PMS HTTP client: {e}"))
                })?,
            redis_url: settings.redis.url.clone(),
        })
    }

    pub async fn availability(
        &self,
        property: Property,
        check_in: NaiveDate,
        check_out: NaiveDate,
        guests: i32,
    ) -> AppResult<PmsAvailability> {
        let url = format!("{}/api/channel/availability", self.base_url);
        let response = self
            .http
            .get(&url)
            .bearer_auth(&self.token)
            .query(&[
                ("property", property.as_str().to_string()),
                ("check_in", check_in.to_string()),
                ("check_out", check_out.to_string()),
                ("guests", guests.to_string()),
            ])
            .send()
            .await
            .map_err(pms_unreachable)?;
        Self::parse_json(response, "availability").await
    }

    /// Create a tentative hold in the PMS — **at most one in flight** per
    /// guest and stay.
    ///
    /// ## Why the guard exists, and why it is on this side
    ///
    /// A hold create is not idempotent anywhere in the estate. The PMS's
    /// hold-create route
    /// (`new-hotel/hotel-backend/src/routes/channel.rs::create_booking`)
    /// takes `CreateChannelBookingRequest`, which carries **no idempotency
    /// field**, and the handler reads **no `Idempotency-Key` header**; the
    /// only `idempotency` in that repo is `outbox::generate_idempotency_key`,
    /// which dedupes the PMS's own outbound events, not inbound calls. Every
    /// `POST /api/channel/bookings` therefore mints a fresh `book_id` and a
    /// fresh room assignment. So one guest whose request hung — and this
    /// client waits up to [`PMS_REQUEST_TIMEOUT`] before it gives up —
    /// tapping "book" again creates a **second** hold on a second room
    /// (B8 race 2.3), with a second 50% deposit behind it.
    ///
    /// Until the PMS grows a real idempotency key (filed as the follow-up;
    /// it is the only fix that also covers a retry from a *different*
    /// process), the app holds a short Redis lock keyed on the guest and the
    /// stay for the duration of the call.
    ///
    /// ## Fail-open, on purpose
    ///
    /// If Redis cannot be reached the guard steps aside and the booking
    /// proceeds unguarded, loudly. A guard is a narrowing of a rare race; a
    /// Redis outage must not stop the property taking bookings.
    pub async fn create_booking(
        &self,
        request: &PmsCreateBookingRequest,
    ) -> AppResult<PmsBookingCreated> {
        let guard = self.acquire_hold_guard(&hold_guard_key(request)).await?;
        let outcome = self.create_booking_unguarded(request).await;

        // The lock is held for **the ambiguous case only**.
        //
        // * **Success** — release at once. The caller now has a
        //   `pms_booking_id` and writes a local `bookings` row the guest can
        //   see, so a retry is no longer blind; holding the lock past that
        //   only punishes a guest who genuinely wants a second room for the
        //   same nights.
        // * **The PMS answered and refused** (`parse_json` maps a 4xx to
        //   `BadRequest`: sold out, bad dates) — release. Nothing was
        //   created, and the guest may correct their input and retry now.
        // * **Anything else** — a timeout, an unreachable host, a 5xx, a
        //   malformed body — *keep* it to its TTL. This is the only branch
        //   where it is genuinely unknown whether a hold now exists, and it
        //   is precisely B8 race 2.3: the guest gives up on a hung request
        //   and taps "book" again.
        match &outcome {
            Ok(_) | Err(AppError::BadRequest(_)) => guard.release().await,
            _ => guard.keep(),
        }

        outcome
    }

    async fn create_booking_unguarded(
        &self,
        request: &PmsCreateBookingRequest,
    ) -> AppResult<PmsBookingCreated> {
        let url = format!("{}/api/channel/bookings", self.base_url);
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(request)
            .send()
            .await
            .map_err(pms_unreachable)?;
        Self::parse_json(response, "create booking").await
    }

    /// Take the one-in-flight lock for this guest and stay, or refuse.
    ///
    /// `SET key token NX PX` — the whole guard, in one round trip. A lock
    /// that is already held answers [`AppError::Conflict`] (409), which is
    /// the truth: an identical hold is being created right now.
    ///
    /// Redis being unreachable is **not** an error here. The guard logs and
    /// stands down, because refusing bookings for the whole property to
    /// prevent a rare duplicate hold is the worse failure.
    async fn acquire_hold_guard(&self, key: &str) -> AppResult<HoldGuard> {
        let Some(mut conn) = self.hold_guard_connection().await else {
            return Ok(HoldGuard::stood_down());
        };
        let token = uuid::Uuid::new_v4().to_string();

        let acquired: Option<String> = match redis::cmd("SET")
            .arg(key)
            .arg(&token)
            .arg("NX")
            .arg("PX")
            .arg(HOLD_GUARD_TTL.as_millis() as u64)
            .query_async(&mut conn)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e,
                    "PMS hold guard could not take its lock; creating the hold unguarded");
                return Ok(HoldGuard::stood_down());
            },
        };

        if acquired.is_none() {
            tracing::warn!(
                "refusing a duplicate PMS hold: an identical hold for this guest and stay is already being created"
            );
            return Err(AppError::Conflict(
                "A booking for these dates is already being created. Please wait a moment before trying again."
                    .to_string(),
            ));
        }

        Ok(HoldGuard {
            conn: Some(conn),
            key: key.to_string(),
            token,
        })
    }

    /// One short-lived Redis connection for the guard, or `None` if Redis is
    /// not there within [`HOLD_GUARD_REDIS_TIMEOUT`].
    async fn hold_guard_connection(&self) -> Option<redis::aio::MultiplexedConnection> {
        let client = match redis::Client::open(self.redis_url.as_str()) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e,
                    "PMS hold guard has no usable Redis URL; creating the hold unguarded");
                return None;
            },
        };
        match tokio::time::timeout(
            HOLD_GUARD_REDIS_TIMEOUT,
            client.get_multiplexed_async_connection(),
        )
        .await
        {
            Ok(Ok(conn)) => Some(conn),
            Ok(Err(e)) => {
                tracing::warn!(error = %e,
                    "PMS hold guard could not reach Redis; creating the hold unguarded");
                None
            },
            Err(_) => {
                tracing::warn!(
                    timeout_ms = HOLD_GUARD_REDIS_TIMEOUT.as_millis() as u64,
                    "PMS hold guard timed out reaching Redis; creating the hold unguarded"
                );
                None
            },
        }
    }

    /// Mark the deposit received. The PMS requires the received amount in
    /// the body — it doesn't persist the guest's payment plan, so it can't
    /// know whether 50% or 100% arrived (PMS contract addendum).
    /// Returns [`PmsActionError::Refused`] when the PMS answered a 4xx —
    /// for a released or already-cancelled hold that is the documented 409
    /// (`new-hotel/docs/loyalty-channel.md:78-86`), and it is **not**
    /// retryable: the caller must stop claiming the booking was confirmed.
    /// `Unavailable` keeps the old "try again" meaning.
    pub async fn payment_verified(
        &self,
        pms_booking_id: &str,
        amount: Decimal,
    ) -> Result<(), PmsActionError> {
        self.post_action(
            pms_booking_id,
            "payment-verified",
            Some(serde_json::json!({ "amount": amount })),
        )
        .await
    }

    /// Release a hold. Returns [`PmsActionError::Refused`] when the PMS says
    /// the hold is already gone — which is a *success* for a sweep, not
    /// something to retry.
    ///
    /// Callers that only log the failure keep working unchanged:
    /// `PmsActionError` implements `Display`, and `?` still converts it
    /// through `From<PmsActionError> for AppError`.
    pub async fn release(&self, pms_booking_id: &str) -> Result<(), PmsActionError> {
        self.post_action(pms_booking_id, "release", None).await
    }

    async fn post_action(
        &self,
        pms_booking_id: &str,
        action: &str,
        body: Option<serde_json::Value>,
    ) -> Result<(), PmsActionError> {
        // Validate *before* anything is formatted: a booking id that is not a
        // plain token cannot be allowed to steer where this request goes.
        let url = match action_url(&self.base_url, pms_booking_id, action) {
            Ok(url) => url,
            Err(e) => {
                // Logged here and nowhere else. The rejected value is not in
                // the log line (an id that reached this branch is untrusted
                // text, and log lines are read by people and by grep) and
                // not in the error: the caller gets an opaque internal
                // error, so a probe learns nothing from the response.
                tracing::error!(
                    action = %action,
                    reason = %e,
                    id_len = pms_booking_id.len(),
                    "refusing to call the PMS: the booking id is not a valid token"
                );
                return Err(PmsActionError::Unavailable(AppError::Internal(
                    "PMS booking id failed validation".to_string(),
                )));
            },
        };
        let mut request = self.http.post(&url).bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|e| PmsActionError::Unavailable(pms_unreachable(e)))?;
        if response.status().is_success() {
            return Ok(());
        }
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();

        // The split that matters: the PMS answering "no **about this
        // booking**" is a decision, and everything else — including most of
        // the 4xx range — is something a human fixes and then retries. See
        // `PmsActionError::Refused` for why an allow-list of two codes beats
        // `status.is_client_error()`.
        if REFUSAL_STATUSES.contains(&status.as_u16()) {
            return Err(PmsActionError::Refused {
                status: status.as_u16(),
                body: truncate_refusal_body(&detail),
            });
        }
        // Sanitised exactly like the refusal arm: this string is rendered
        // verbatim to the admin (`error.rs`, `ExternalServiceUnavailable`),
        // and since B1 this arm carries the HTML-heavy answers.
        Err(PmsActionError::Unavailable(
            AppError::ExternalServiceUnavailable(format!(
                "PMS {action} for booking {pms_booking_id} failed: {status} {}",
                truncate_refusal_body(&detail)
            )),
        ))
    }

    async fn parse_json<T: serde::de::DeserializeOwned>(
        response: reqwest::Response,
        what: &str,
    ) -> AppResult<T> {
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            // The same split B1 drew one function over. A 4xx that is about
            // the *request* — sold out, bad dates, a room type that no
            // longer exists — is the guest's to fix, so it surfaces as a
            // client error. A 401 (rotated `LOYALTY_CHANNEL_TOKEN`), a 403
            // (`HFVILLE_WRITES_ENABLED` off) or a 404 (channel router not
            // mounted, which is what a PMS with a dead PG pool looks like
            // from out here) is *ours*, and telling the guest "bad request"
            // about our own expired credential is both wrong and unhelpful.
            return if status.is_client_error() && !NOT_THE_CALLERS_FAULT.contains(&status.as_u16())
            {
                Err(AppError::BadRequest(format!(
                    "PMS rejected {what}: {}",
                    truncate_refusal_body(&detail)
                )))
            } else {
                Err(AppError::ExternalServiceUnavailable(format!(
                    "PMS {what} failed: {status} {}",
                    truncate_refusal_body(&detail)
                )))
            };
        }
        response.json::<T>().await.map_err(|e| {
            AppError::ExternalServiceUnavailable(format!("PMS {what} response malformed: {e}"))
        })
    }
}

/// Make a PMS response body safe to put in front of a person, and bound it.
///
/// The body is whatever the PMS — or something in front of it — chose to
/// send. A Cloudflare Access challenge answers a multi-kilobyte HTML page, an
/// nginx error page answers markup, a panicking service answers a stack
/// trace, and any of them may carry newlines that shred a log line or an
/// audit row, or angle brackets a future renderer trusts.
///
/// So: collapse every run of whitespace to one space, drop the characters
/// that could open a tag or a quote, then cut to `max_chars` **characters** —
/// the body may well be Thai, and counting bytes would split a codepoint.
/// A cut body says so, so a reader never mistakes it for the whole answer.
///
/// Used by **both** arms of [`PmsChannelClient::post_action`]. The refusal
/// arm always sanitised; the `Unavailable` arm did not, and narrowing
/// [`REFUSAL_STATUSES`] to `[409]` moved 401/403/404/410/415/422 and every
/// 5xx into it — i.e. precisely the Cloudflare and error-page bodies this
/// exists for. `AppError::ExternalServiceUnavailable` renders verbatim into
/// the admin's browser, so an unsanitised arm there is the same bug with a
/// bigger audience.
pub fn sanitize_pms_body(body: &str, max_chars: usize) -> String {
    let mut collapsed = String::with_capacity(body.len().min(max_chars * 4));
    let mut last_was_space = true;
    for c in body.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                collapsed.push(' ');
            }
            last_was_space = true;
            continue;
        }
        if matches!(c, '<' | '>' | '"' | '\'' | '`' | '\\') {
            continue;
        }
        collapsed.push(c);
        last_was_space = false;
    }
    let collapsed = collapsed.trim_end();

    if collapsed.chars().count() <= max_chars {
        return collapsed.to_string();
    }
    let kept: String = collapsed.chars().take(max_chars).collect();
    format!("{kept}… (truncated)")
}

/// [`sanitize_pms_body`] at the size a `booking_audit_log` row will hold.
fn truncate_refusal_body(body: &str) -> String {
    sanitize_pms_body(body, MAX_PMS_REFUSAL_BODY)
}

/// Normalise a phone number so two spellings of one number are one key.
///
/// Digits only, then the last 9 — which is a Thai subscriber number without
/// the trunk `0` or the `+66` country code, so `081-234-5678`,
/// `0812345678` and `+66812345678` all collapse to the same thing. Without
/// this the guard is defeated by the guest's keyboard: a retry typed with a
/// dash would hash differently and sail straight past the lock.
fn normalise_phone(phone: &str) -> String {
    let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    let keep = digits.len().saturating_sub(9);
    digits[keep..].to_string()
}

/// The Redis key for "this guest is creating this exact hold right now".
///
/// ## The identity half
///
/// The membership id when the guest has one, their normalised phone
/// otherwise. Both are already on the request, which is what lets the guard
/// sit inside the client with no change at the call site.
///
/// **The phone fallback is the weak half and it is worth being honest about
/// it.** Two different guests who share a phone number — a couple, a family,
/// a company secretary booking for colleagues — hash to the same identity,
/// and if they book the same room type for the same nights at the same
/// moment, the second is refused. Three things bound that:
///
/// * it needs a *simultaneous* pair, because the lock is now released the
///   moment the first hold succeeds (see [`PmsChannelClient::create_booking`]);
/// * the refusal is a 409 saying "wait a moment and try again", not a lost
///   booking;
/// * every member — which is who this channel is for — has a membership id
///   and never reaches the fallback at all.
///
/// The real fix is a key the *caller* mints per attempt (this repo already
/// has `services::idempotency` for exactly that shape) and, better still, a
/// PMS-side idempotency key. Both are filed as follow-ups; wiring either one
/// means editing `routes::bookings`, which is owned elsewhere this round.
///
/// ## The stay half
///
/// Property + room type + both dates. Deliberately **not** `guests` or
/// `payment`: neither changes which room-night is being held, and including
/// them would hand a guest a trivial way around the guard — resubmit the
/// same stay with `payment` flipped from `deposit50` to `full` and take a
/// second room. A guest booking a genuinely *different* room type or
/// different nights already gets a different key and is never held up.
///
/// ## Why it is hashed
///
/// A phone number is personal data and Redis keys turn up in `KEYS`, in slow
/// logs and in metrics. The digest is stable across processes, which is the
/// whole point — the retry that has to be caught usually lands on a
/// different worker.
pub fn hold_guard_key(request: &PmsCreateBookingRequest) -> String {
    let identity = request
        .membership_id
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(|m| format!("member:{m}"))
        .unwrap_or_else(|| format!("phone:{}", normalise_phone(&request.guest.phone)));

    let material = format!(
        "{identity}|{}|{}|{}|{}",
        request.property.as_str(),
        request.room_type_id.trim(),
        request.check_in,
        request.check_out,
    );
    format!(
        "pms:hold:inflight:{}",
        hex::encode(Sha256::digest(material.as_bytes()))
    )
}

/// A held one-in-flight lock, or the absence of one.
///
/// `conn: None` is the stood-down guard: Redis was unreachable, the booking
/// went ahead unguarded, and dropping it must do nothing.
struct HoldGuard {
    conn: Option<redis::aio::MultiplexedConnection>,
    key: String,
    token: String,
}

impl HoldGuard {
    /// The guard that isn't: Redis was not reachable, so nothing was locked
    /// and nothing has to be unlocked.
    fn stood_down() -> Self {
        Self {
            conn: None,
            key: String::new(),
            token: String::new(),
        }
    }

    /// Leave the lock in place until its TTL runs out.
    ///
    /// Used when a hold may exist on the PMS side — a success, or a failure
    /// whose outcome is unknown. This is the branch that actually stops the
    /// duplicate: the guest's retry arrives seconds later and is refused.
    fn keep(self) {}

    /// Give the lock back now, because nothing was created.
    ///
    /// Compare-and-delete in Lua so a guard whose TTL already lapsed cannot
    /// delete the lock a *different* request has since taken.
    async fn release(mut self) {
        let Some(conn) = self.conn.as_mut() else {
            return;
        };
        let script = redis::Script::new(
            "if redis.call('get', KEYS[1]) == ARGV[1] then \
               return redis.call('del', KEYS[1]) else return 0 end",
        );
        if let Err(e) = script
            .key(&self.key)
            .arg(&self.token)
            .invoke_async::<i64>(conn)
            .await
        {
            // Harmless: the lock expires on its own in HOLD_GUARD_TTL. Worth
            // a line, because a guest who corrected their dates now waits.
            tracing::warn!(error = %e, "PMS hold guard could not release its lock early");
        }
    }
}

/// Sweep channel bookings whose payment window lapsed: release the PMS hold,
/// then cancel the local channel row. Runs periodically from main.rs; the
/// PMS also runs its own expiry sweep, so both sides are belt-and-braces
/// (docs/launch-plan.md). Never panics/errors — failures log and retry on
/// the next sweep.
///
/// # What the return value counts
///
/// **Holds the PMS released *and* this sweep then cancelled locally** — both
/// halves, every time. It is the number of room-nights this run actually
/// handed back, which is the only number worth putting in a log line the
/// desk might read.
///
/// It deliberately does **not** count the local-only cancellations, because
/// those released nothing at the PMS:
///
/// * a `pms_booking_id` this client can never build a URL with (no call is
///   possible, so the PMS's own sweep is what frees the room);
/// * a guarded cancel that matched no row (something else moved the booking
///   first).
///
/// Those are reported separately as `retired` on the closing log line, so
/// one tally never means two things. An earlier version incremented
/// `released` on one of them and not the other with nothing to explain the
/// difference.
///
/// # Why a 404 does not retire a row
///
/// A 404 from `release` is ambiguous in a way a sweep must not guess at: it
/// is either an id the PMS has never heard of (permanent) or the channel
/// router not being mounted because the PMS's canonical pool is down
/// (transient, and the row is a perfectly good hold). Cancelling on the
/// second reading would throw away live bookings during a PMS outage, which
/// is strictly worse than the re-selection it would save. Such rows do keep
/// coming back every run — logged each time, at WARN — and that is the
/// intended pressure: a stuck row should be visible, not quietly cancelled.
pub async fn release_expired_holds(db: &sqlx::PgPool, settings: &Settings) -> u64 {
    let expired = match sqlx::query!(
        r#"
        SELECT id, pms_booking_id
        FROM bookings
        WHERE status = 'pending'
          AND pms_booking_id IS NOT NULL
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at < NOW()
        LIMIT 50
        "#
    )
    .fetch_all(db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "hold-expiry sweep query failed");
            return 0;
        },
    };

    if expired.is_empty() {
        return 0;
    }

    let client = match PmsChannelClient::from_settings(settings) {
        Ok(c) => c,
        Err(e) => {
            // Channel bookings exist but the PMS client is unconfigured —
            // loud, because holds are now expiring with no way to release.
            tracing::error!(error = %e, count = expired.len(),
                "expired channel holds found but PMS is not configured");
            return 0;
        },
    };

    // Two tallies, two meanings — see the doc comment.
    let mut released = 0u64;
    let mut retired = 0u64;
    for row in expired {
        let Some(pms_booking_id) = row.pms_booking_id else {
            continue;
        };

        // A reference this client will never be able to call with is a
        // dead end, not a transient failure: the sweep re-selects the same
        // row every time it runs and would log the same refusal forever,
        // burying every real failure in the noise. Stop it here — logged
        // once, at ERROR (a booking is stranded and a person has to look),
        // and the row taken out of the sweep's selection by the same
        // cancellation the successful path applies.
        //
        // Cancelling without the PMS acknowledging is safe *only* in this
        // one branch: no call was made, because none could be built. The
        // PMS runs its own expiry sweep over the same holds
        // (docs/launch-plan.md), which is what actually releases this one.
        if let Err(e) = validate_pms_booking_id(&pms_booking_id) {
            // The rejected value is not in the log line: it is untrusted
            // text and log lines are read by people and by grep.
            tracing::error!(
                booking_id = %row.id,
                reason = %e,
                id_len = pms_booking_id.len(),
                "expired hold has an unusable PMS booking id; cancelling locally \
                 and leaving the PMS-side release to the PMS's own sweep"
            );
            match sqlx::query!(
                r#"
                UPDATE bookings
                SET status = 'cancelled', cancelled_at = NOW(),
                    cancellation_reason = 'Payment window expired; PMS reference unusable',
                    updated_at = NOW()
                WHERE id = $1 AND status = 'pending'
                "#,
                row.id
            )
            .execute(db)
            .await
            {
                // Guarded on `status = 'pending'`, so "no error" is not
                // "done": zero rows means something else moved the booking
                // between the select and here, and the sweep must not read
                // that as a cancellation it performed.
                Ok(result) if result.rows_affected() == 0 => tracing::warn!(
                    booking_id = %row.id,
                    "expired hold with an unusable PMS booking id was no longer \
                     pending; nothing cancelled"
                ),
                Ok(_) => retired += 1,
                Err(e) => tracing::error!(error = %e, booking_id = %row.id,
                    "failed to cancel a booking with an unusable PMS booking id"),
            }
            continue;
        }

        // Release the PMS side FIRST; only cancel locally once the PMS
        // acknowledged, so a failed release retries on the next sweep.
        //
        // **A 409 from `release` does not mean "already gone".** This is
        // worth spelling out because an earlier version of this sweep
        // assumed it did and cancelled on it, which would have cancelled
        // guests' paid bookings. Read from `new-hotel`
        // (`hotel-backend/src/service/channel.rs::release`, route
        // `routes/channel.rs`, mapper `ServiceError::Conflict => CONFLICT`):
        //
        // | PMS `book_status` | answer |
        // |---|---|
        // | `cancelled`  | **200** `{"already_released": true}`  — idempotent replay |
        // | `pending`    | **200** `{"already_released": false}` — just released it |
        // | `confirmed` / `checkedin` / … | **409** `"… (payment already verified?); refusing to release"` |
        // | 0 rows matched | **409** `"… changed state during release; retry"` |
        // | unknown id / not a loyalty row | **404** `"loyalty-channel booking … not found"` |
        //
        // So the "already gone" case is a **success** and is handled by the
        // `Ok` path below, which cancels locally exactly as it should. Both
        // 409s mean the opposite of gone:
        //
        // * the first says the hold became a **confirmed, paid booking** —
        //   cancelling it locally would strand a guest who has a room in the
        //   PMS and no booking with us. That is a divergence for a person,
        //   never for a sweep;
        // * the second says *retry* in so many words.
        //
        // Neither is something to cancel on, so a refusal logs loudly and
        // leaves the row alone.
        if let Err(e) = client.release(&pms_booking_id).await {
            if e.is_refusal() {
                tracing::error!(
                    booking_id = %row.id,
                    pms_booking_id = %pms_booking_id,
                    detail = %e,
                    "PMS refused to release this hold — it may already be a \
                     confirmed, paid booking. The local row is left untouched \
                     and needs reconciling by hand; this sweep will not cancel it."
                );
            } else {
                tracing::warn!(error = %e, pms_booking_id = %pms_booking_id,
                    "PMS hold release failed; will retry next sweep");
            }
            continue;
        }
        match sqlx::query!(
            r#"
            UPDATE bookings
            SET status = 'cancelled', cancelled_at = NOW(),
                cancellation_reason = 'Payment window expired', updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            "#,
            row.id
        )
        .execute(db)
        .await
        {
            Ok(result) if result.rows_affected() == 0 => {
                // The PMS released the hold, but the local row was no longer
                // `pending` — an admin cancelled it, or a slip confirmed it
                // in the same breath. Counting it as released would report a
                // cancellation that never happened.
                //
                // WARN, not ERROR: the sweep and the confirm path race by
                // design (both are guarded on `status = 'pending'` so exactly
                // one wins), and the common outcome here is the benign one —
                // an admin cancelled it a moment earlier. The genuinely bad
                // shape, a booking reading `confirmed` against a released
                // hold, is caught by the confirm path's own refusal, which
                // *is* loud. Paging on this one would page on the ordinary
                // race.
                tracing::warn!(
                    booking_id = %row.id,
                    pms_booking_id = %pms_booking_id,
                    "PMS hold released but the local booking was no longer pending; \
                     it was left untouched and needs reconciling by hand"
                );
            },
            Ok(_) => released += 1,
            Err(e) => {
                tracing::error!(error = %e, booking_id = %row.id,
                    "failed to cancel expired channel booking locally");
            },
        }
    }
    if released > 0 || retired > 0 {
        tracing::info!(
            released,
            retired,
            "expired channel-booking holds: released = the PMS let the room go \
             and we cancelled locally; retired = cancelled locally with no PMS \
             release possible"
        );
    }
    released
}

fn pms_unreachable(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::ExternalServiceTimeout(format!("PMS channel API timed out: {e}"))
    } else {
        AppError::ExternalServiceUnavailable(format!("PMS channel API unreachable: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "https://pms.example.com";

    /// Every shape the PMS has been seen to issue, plus the boundary.
    #[test]
    fn accepts_a_plain_booking_token() {
        for id in [
            "ABC123",
            "hf-2026-000417",
            "booking_00042",
            "a",
            "0",
            "-",
            "_",
            &"A".repeat(MAX_PMS_BOOKING_ID_LEN),
        ] {
            assert_eq!(
                validate_pms_booking_id(id),
                Ok(id),
                "{id} is a plain token and must be accepted"
            );
        }
    }

    /// The allow-list, stated as the things it keeps out. Each of these
    /// would aim the request somewhere the PMS is not, or split it in two.
    #[test]
    fn rejects_anything_that_could_steer_the_request() {
        for (id, expected) in [
            ("", PmsBookingIdError::Empty),
            ("   ", PmsBookingIdError::IllegalCharacter),
            ("../../admin/keys", PmsBookingIdError::IllegalCharacter),
            ("..%2F..%2Fadmin", PmsBookingIdError::IllegalCharacter),
            ("/etc/passwd", PmsBookingIdError::IllegalCharacter),
            ("evil.example.com", PmsBookingIdError::IllegalCharacter),
            ("//evil.example.com", PmsBookingIdError::IllegalCharacter),
            (
                "https://evil.example.com/x",
                PmsBookingIdError::IllegalCharacter,
            ),
            ("abc?x=1", PmsBookingIdError::IllegalCharacter),
            ("abc#frag", PmsBookingIdError::IllegalCharacter),
            ("abc@evil.example.com", PmsBookingIdError::IllegalCharacter),
            ("abc:8080", PmsBookingIdError::IllegalCharacter),
            ("abc def", PmsBookingIdError::IllegalCharacter),
            ("abc\nGET /x", PmsBookingIdError::IllegalCharacter),
            ("abc\r\nHost: evil", PmsBookingIdError::IllegalCharacter),
            ("abc\u{0}", PmsBookingIdError::IllegalCharacter),
            ("จอง123", PmsBookingIdError::IllegalCharacter),
            (
                "\u{ff21}\u{ff22}\u{ff23}", // full-width ABC
                PmsBookingIdError::IllegalCharacter,
            ),
            (
                &"A".repeat(MAX_PMS_BOOKING_ID_LEN + 1),
                PmsBookingIdError::TooLong,
            ),
        ] {
            assert_eq!(
                validate_pms_booking_id(id),
                Err(expected),
                "{id:?} must be refused"
            );
        }
    }

    /// The ceiling is the column's width, and the two must stay equal.
    ///
    /// `bookings.pms_booking_id` is `VARCHAR(100)`. A shorter ceiling here
    /// would let the database store a reference this client then refuses
    /// to call with — the booking would sit in the PMS with no way to
    /// release it or mark it paid.
    #[test]
    fn the_length_ceiling_is_the_column_width() {
        assert_eq!(
            MAX_PMS_BOOKING_ID_LEN, 100,
            "must equal VARCHAR(100) on bookings.pms_booking_id"
        );
        assert!(validate_pms_booking_id(&"A".repeat(100)).is_ok());
        assert_eq!(
            validate_pms_booking_id(&"A".repeat(101)),
            Err(PmsBookingIdError::TooLong)
        );
    }

    /// The whole point of the type: a rejected id never reaches a URL.
    #[test]
    fn a_rejected_id_produces_no_url() {
        assert_eq!(
            action_url(BASE, "../../admin/keys", "release"),
            Err(PmsBookingIdError::IllegalCharacter)
        );
        assert_eq!(
            action_url(BASE, "//evil.example.com", "payment-verified"),
            Err(PmsBookingIdError::IllegalCharacter)
        );
        assert_eq!(
            action_url(BASE, "", "release"),
            Err(PmsBookingIdError::Empty)
        );
    }

    fn hold_request(phone: &str, membership: Option<&str>) -> PmsCreateBookingRequest {
        PmsCreateBookingRequest {
            property: crate::types::Property::Hf,
            room_type_id: "3".to_string(),
            check_in: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            check_out: NaiveDate::from_ymd_opt(2026, 10, 3).unwrap(),
            guests: 2,
            guest: PmsGuest {
                name: "Guest".to_string(),
                phone: phone.to_string(),
            },
            membership_id: membership.map(str::to_string),
            payment: "deposit50".to_string(),
        }
    }

    /// The same request always locks the same key — a retry that lands on a
    /// different worker has to collide with the first attempt, which is the
    /// entire point of taking the lock in Redis rather than in memory.
    #[test]
    fn the_same_hold_request_always_takes_the_same_lock() {
        let a = hold_guard_key(&hold_request("0812345678", None));
        let b = hold_guard_key(&hold_request("0812345678", None));
        assert_eq!(a, b);
        assert!(a.starts_with("pms:hold:inflight:"));
    }

    /// A phone number is personal data and Redis keys are not a private
    /// place: they show up in `KEYS`, in slow logs and in metrics.
    #[test]
    fn the_lock_never_spells_out_who_the_guest_is() {
        let key = hold_guard_key(&hold_request("0812345678", Some("HF-000123")));
        assert!(!key.contains("0812345678"), "{key}");
        assert!(!key.contains("HF-000123"), "{key}");
    }

    /// Every field that makes it a *different* booking has to change the
    /// key, or one guest's second, legitimate hold is refused.
    #[test]
    fn anything_that_makes_it_a_different_booking_changes_the_lock() {
        let base = hold_guard_key(&hold_request("0812345678", None));

        let other_guest = hold_guard_key(&hold_request("0899999999", None));
        assert_ne!(base, other_guest, "a different guest is a different lock");

        let mut other_property = hold_request("0812345678", None);
        other_property.property = crate::types::Property::Hfville;
        assert_ne!(base, hold_guard_key(&other_property));

        let mut other_type = hold_request("0812345678", None);
        other_type.room_type_id = "4".to_string();
        assert_ne!(base, hold_guard_key(&other_type));

        let mut other_dates = hold_request("0812345678", None);
        other_dates.check_in = NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
        assert_ne!(base, hold_guard_key(&other_dates));

        let mut other_checkout = hold_request("0812345678", None);
        other_checkout.check_out = NaiveDate::from_ymd_opt(2026, 10, 4).unwrap();
        assert_ne!(base, hold_guard_key(&other_checkout));
    }

    /// The membership id is the loyalty identity, so it wins over the phone
    /// when the guest has one: the same member booking from two devices with
    /// two differently-typed phone numbers is still one guest.
    #[test]
    fn the_membership_id_identifies_the_guest_when_there_is_one() {
        let with_member_a = hold_guard_key(&hold_request("0812345678", Some("HF-000123")));
        let with_member_b = hold_guard_key(&hold_request("0899999999", Some("HF-000123")));
        assert_eq!(
            with_member_a, with_member_b,
            "one member is one guest, whichever phone they typed"
        );

        let blank_member = hold_guard_key(&hold_request("0812345678", Some("   ")));
        let no_member = hold_guard_key(&hold_request("0812345678", None));
        assert_eq!(
            blank_member, no_member,
            "a blank membership id is no membership id, not a third identity"
        );
        assert_ne!(with_member_a, no_member);
    }

    /// The guard is defeated by the guest's keyboard if a retry typed with
    /// dashes, spaces or a country code hashes differently from the first
    /// attempt.
    #[test]
    fn one_phone_number_is_one_identity_however_it_was_typed() {
        let canonical = hold_guard_key(&hold_request("0812345678", None));
        for spelling in [
            "081-234-5678",
            "081 234 5678",
            "+66812345678",
            "+66 81 234 5678",
            "(081) 234-5678",
            "66812345678",
        ] {
            assert_eq!(
                hold_guard_key(&hold_request(spelling, None)),
                canonical,
                "{spelling} is the same number as 0812345678"
            );
        }

        assert_ne!(
            canonical,
            hold_guard_key(&hold_request("0899999999", None)),
            "a genuinely different number is still a different identity"
        );
    }

    /// `guests` and `payment` are deliberately out of the key: neither
    /// changes which room-night is being held, and including them would let
    /// a guest walk round the guard by flipping deposit50 to full.
    #[test]
    fn the_lock_ignores_what_does_not_change_the_room_night() {
        let base = hold_request("0812345678", None);
        let mut more_guests = hold_request("0812345678", None);
        more_guests.guests = base.guests + 1;
        let mut paid_in_full = hold_request("0812345678", None);
        paid_in_full.payment = "full".to_string();

        assert_eq!(hold_guard_key(&base), hold_guard_key(&more_guests));
        assert_eq!(hold_guard_key(&base), hold_guard_key(&paid_in_full));
    }

    /// B1 — the allow-list, stated as the answers it must NOT treat as
    /// definitive. Each of these is somebody's config or deploy problem,
    /// fixed and then retried; calling any of them a dead booking sends a
    /// slip to reception with the wrong story.
    #[test]
    fn only_a_conflict_is_a_refusal() {
        assert_eq!(REFUSAL_STATUSES, [409]);
        // 410 is in this list on purpose: `new-hotel` never emits Gone from
        // `/api/channel/*`, so one can only have come from an intermediary.
        for retryable in [400u16, 401, 403, 404, 410, 415, 422, 429, 500, 502, 503] {
            assert!(
                !REFUSAL_STATUSES.contains(&retryable),
                "{retryable} is retryable, not a refusal"
            );
        }
    }

    /// N10/N11 — the sanitiser both arms now share, on the body that
    /// motivated it: a Cloudflare Access challenge. Markup must not reach an
    /// audit row or the admin's browser, and newlines must not shred a log
    /// line into fragments.
    #[test]
    fn an_html_challenge_page_comes_out_as_one_safe_line() {
        let challenge = "<!DOCTYPE html>\n<html>\n  <head><title>Just a moment…</title></head>\n\
                         <body onload=\"go()\">\n    Checking your browser\n  </body>\n</html>";
        let safe = sanitize_pms_body(challenge, 500);

        for banned in ['<', '>', '"', '\'', '`', '\\'] {
            assert!(!safe.contains(banned), "{banned:?} survived: {safe}");
        }
        assert!(!safe.contains('\n'), "newlines must be collapsed: {safe}");
        assert!(!safe.contains("  "), "runs of space must collapse: {safe}");
        assert!(
            safe.contains("Checking your browser"),
            "the words a human needs must survive: {safe}"
        );
    }

    /// Thai bodies are real (the PMS speaks Thai to its own users), so the
    /// cut counts characters, and it says that it cut.
    #[test]
    fn a_long_body_is_cut_on_a_character_boundary_and_says_so() {
        let long = "ก".repeat(600);
        let safe = sanitize_pms_body(&long, 200);
        assert!(safe.ends_with("… (truncated)"), "{safe}");
        assert_eq!(safe.chars().count(), 200 + "… (truncated)".chars().count());

        // Short bodies come back whole, trimmed, unmarked.
        assert_eq!(sanitize_pms_body("  hold released  ", 200), "hold released");
    }

    /// The refusal body lands on an audit row a person reads. A PMS that
    /// answers a 4xx with an HTML error page must not put a page of markup
    /// in the audit trail — and a cut body has to say it was cut.
    #[test]
    fn a_refusal_body_is_bounded_and_says_when_it_was_cut() {
        assert_eq!(truncate_refusal_body("  hold released  "), "hold released");

        let long = "ก".repeat(MAX_PMS_REFUSAL_BODY + 50);
        let cut = truncate_refusal_body(&long);
        assert!(cut.ends_with("… (truncated)"), "{cut}");
        assert_eq!(
            cut.chars().count(),
            MAX_PMS_REFUSAL_BODY + "… (truncated)".chars().count(),
            "truncation counts characters, not bytes — the body may be Thai"
        );
    }

    /// The split this PR exists for: the PMS answering "no" is a decision
    /// about the booking (409), the PMS not answering is an outage (503).
    /// Collapsing them is what made a released hold look retryable.
    #[test]
    fn a_refusal_is_a_conflict_and_an_outage_is_not() {
        let refused: AppError = PmsActionError::Refused {
            status: 409,
            body: "hold already released".to_string(),
        }
        .into();
        assert!(matches!(refused, AppError::Conflict(_)), "{refused:?}");
        assert!(refused.to_string().contains("409"));

        let down: AppError = PmsActionError::Unavailable(AppError::ExternalServiceUnavailable(
            "PMS down".to_string(),
        ))
        .into();
        assert!(
            matches!(down, AppError::ExternalServiceUnavailable(_)),
            "an outage keeps its old meaning so the caller still retries: {down:?}"
        );
    }

    /// Both halves of the bound B8 asked for (checklist L5).
    #[test]
    fn every_pms_call_is_bounded_at_both_ends() {
        assert!(
            PMS_CONNECT_TIMEOUT < PMS_REQUEST_TIMEOUT,
            "connect is inside total"
        );
        assert!(
            HOLD_GUARD_TTL > PMS_REQUEST_TIMEOUT,
            "the guard has to outlive the call it wraps, or the retry it \
             exists to catch arrives after the lock is gone"
        );
    }

    /// Behaviour for a valid id is byte-for-byte what it was before the
    /// allow-list existed — the encoder touches nothing the allow-list
    /// admits.
    #[test]
    fn a_valid_id_builds_exactly_the_url_it_always_did() {
        assert_eq!(
            action_url(BASE, "hf-2026-000417", "payment-verified").unwrap(),
            "https://pms.example.com/api/channel/bookings/hf-2026-000417/payment-verified"
        );
        assert_eq!(
            action_url(BASE, "booking_00042", "release").unwrap(),
            "https://pms.example.com/api/channel/bookings/booking_00042/release"
        );
    }
}
