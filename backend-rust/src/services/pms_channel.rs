//! PMS booking-channel client (ADR-0003).
//!
//! The loyalty app holds no room inventory: availability is queried live
//! from the PMS and confirmed bookings are created there. This module is
//! the outbound HTTP client for the PMS channel API; the interface
//! contract is locked in docs/launch-plan.md.

use chrono::{DateTime, NaiveDate, Utc};
use reqwest::Url;
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

/// Ceiling on every Redis call the hold guard makes.
///
/// The guard is a safety net, not a dependency: a Redis that does not answer
/// promptly must not add its latency to a booking. See
/// [`PmsChannelClient::acquire_hold_guard`] for what happens when it does
/// not answer at all.
///
/// It bounds the *command*, because the connection now arrives from the
/// caller as `AppState`'s shared `ConnectionManager`. That manager retries a
/// lost connection behind the scenes and every command issued meanwhile
/// awaits the same reconnect future, so without this ceiling a Redis outage
/// would add the whole reconnect cycle to a guest's booking — the hang #416
/// found in the rate limiter, arriving here by the same route. Same value,
/// and the same reason, as [`crate::middleware::rate_limit::REDIS_CALL_TIMEOUT`].
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

/// Why `PMS_BASE_URL` may not be used to build requests.
///
/// Its own type rather than an `AppError` for the same reason
/// [`PmsBookingIdError`] is: the caller decides what to log, and the
/// rejected value never travels with the error — a misconfigured base URL
/// is the one string in this module most likely to have a credential
/// accidentally pasted into it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PmsBaseUrlError {
    /// Not an absolute URL at all.
    #[error("PMS_BASE_URL is not an absolute URL")]
    Unparseable,
    /// Something other than `http` or `https` — `file:`, `ftp:`, a
    /// `data:` payload. None of them is a PMS.
    #[error("PMS_BASE_URL must use http or https")]
    UnsupportedScheme,
    /// No host to send the request to.
    #[error("PMS_BASE_URL has no host")]
    NoHost,
    /// Plain `http` to a host that is not loopback or container-local, so
    /// the channel token would cross a network in clear text.
    #[error("PMS_BASE_URL may only use plain http for a loopback or container-local host")]
    InsecureScheme,
    /// `https://user:pass@host` — credentials in a URL end up in logs,
    /// and this client authenticates with a bearer token.
    #[error("PMS_BASE_URL must not carry credentials")]
    HasCredentials,
    /// A query string or fragment on a *base* is a sign of a pasted full
    /// URL, and it would be silently dropped by every join below.
    #[error("PMS_BASE_URL must not carry a query string or fragment")]
    HasQueryOrFragment,
}

/// Parse `PMS_BASE_URL` once, or refuse to build a client at all.
///
/// Everything this client sends is `base.join(<fixed path>)` off the value
/// returned here, so this is the **only** place a config string becomes a
/// request target. Nothing downstream concatenates a host with a path, and
/// nothing downstream can be steered by a value that got past this
/// function.
///
/// The rules, and why each one:
///
/// * **`https`, or `http` only for loopback and container-local hosts.**
///   The channel token is a bearer credential; `http://pms.example.com`
///   would put it on the wire in clear text on every availability call. The
///   exceptions are the shapes that never leave a host: `localhost`,
///   `127.0.0.0/8`, `::1`, `host.docker.internal`, and a bare hostname with
///   no dots — a Docker Compose service or container name, which is what
///   the integration suite and a same-network deploy both use, and which
///   cannot be a public name.
/// * **No credentials.** `https://user:pass@host` leaks into every log line
///   that prints a URL, and this client authenticates with a bearer token
///   anyway.
/// * **No query or fragment.** Either one on a base is a pasted full URL,
///   and `Url::join` would drop it silently — the request would go
///   somewhere the operator did not intend and nothing would say so.
///
/// The path is normalised to end in `/` so a base that carries a prefix
/// (`https://pms.example.com/hotel/`) keeps it: `Url::join` replaces the
/// last segment of a path that does not end in a slash, which would
/// quietly drop the prefix.
///
/// **Fails loudly, never falls back.** A base URL that cannot be trusted is
/// not replaced with a default — `Settings::validate` refuses to start the
/// process, and `from_settings` refuses to build a client.
pub fn validate_pms_base_url(raw: &str) -> Result<Url, PmsBaseUrlError> {
    let mut url = Url::parse(raw.trim()).map_err(|_| PmsBaseUrlError::Unparseable)?;

    // Scheme first, host second, so the error names the actual problem: a
    // `file:///etc/passwd` has no host *and* the wrong scheme, and being
    // told "PMS_BASE_URL has no host" about it sends an operator looking
    // for a typo in a value whose whole shape is wrong.
    match url.scheme() {
        "https" => {},
        "http" => {
            let host = url.host_str().ok_or(PmsBaseUrlError::NoHost)?;
            if !host_is_local(host) {
                return Err(PmsBaseUrlError::InsecureScheme);
            }
        },
        _ => return Err(PmsBaseUrlError::UnsupportedScheme),
    }
    if url.host_str().is_none() {
        return Err(PmsBaseUrlError::NoHost);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PmsBaseUrlError::HasCredentials);
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(PmsBaseUrlError::HasQueryOrFragment);
    }

    if !url.path().ends_with('/') {
        let with_slash = format!("{}/", url.path());
        url.set_path(&with_slash);
    }
    Ok(url)
}

/// Is this host one that plain `http` never leaves a machine or a container
/// network to reach?
///
/// Loopback in either family, `localhost` (and the reserved `.localhost`
/// suffix), Docker Desktop's `host.docker.internal`, and any dotless
/// hostname — a Compose service name, a container name, a Kubernetes
/// in-namespace service. A dotless name cannot be a public DNS name, which
/// is what makes the rule safe to state this simply.
fn host_is_local(host: &str) -> bool {
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return ip.is_loopback();
    }
    host == "localhost"
        || host.ends_with(".localhost")
        || host == "host.docker.internal"
        || !host.contains('.')
}

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

/// Why a per-booking action URL could not be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PmsActionUrlError {
    /// The booking id is not a plain token.
    #[error("{0}")]
    BookingId(#[from] PmsBookingIdError),
    /// The client's base URL cannot take path segments. Unreachable for a
    /// base that came through [`validate_pms_base_url`] — http and https
    /// are always hierarchical — and present so a future scheme change
    /// becomes an error rather than a request to the bare base URL.
    #[error("PMS base URL cannot take a path")]
    BaseNotHierarchical,
}

/// The per-booking action URL, or the reason it could not be built.
///
/// Split out of [`PmsChannelClient::post_action`] so validation and URL
/// construction are one testable step, and built with
/// [`Url::path_segments_mut`] rather than `format!`: every segment is
/// percent-encoded by the `url` crate as it is pushed, so a `/` in a
/// segment becomes `%2F` and **cannot** add a path element, and the host,
/// scheme, port and any base path prefix come from the parsed base and are
/// not reachable from the id at all. `validate_pms_booking_id` still runs
/// first — the encoder makes a bad id harmless, the allow-list makes it
/// loud.
fn action_url(base: &Url, pms_booking_id: &str, action: &str) -> Result<Url, PmsActionUrlError> {
    let id = validate_pms_booking_id(pms_booking_id)?;
    let mut url = base.clone();
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|()| PmsActionUrlError::BaseNotHierarchical)?;
        // The base path is normalised to end in `/`, which leaves a
        // trailing empty segment; dropping it is what keeps the result
        // `/api/...` rather than `//api/...`.
        segments
            .pop_if_empty()
            .extend(["api", "channel", "bookings", id, action]);
    }
    Ok(url)
}

/// The header `new-hotel` reads the idempotency key from (its #305).
pub const IDEMPOTENCY_KEY_HEADER: &str = "Idempotency-Key";

/// The header the PMS sets when it answered from its key store instead of
/// creating anything: `Idempotency-Replayed: true`.
pub const IDEMPOTENCY_REPLAYED_HEADER: &str = "Idempotency-Replayed";

/// Longest key the PMS accepts (its contract: 1..255 printable ASCII).
pub const MAX_IDEMPOTENCY_KEY_LEN: usize = 255;

/// Why a caller-supplied idempotency key cannot be used.
///
/// Its own type rather than an `AppError` for the same reason
/// [`PmsBookingIdError`] is: the caller decides what to log, and the
/// rejected value never travels with the error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum IdempotencyKeyError {
    /// Empty or whitespace-only.
    #[error("idempotency key is empty")]
    Empty,
    /// Longer than [`MAX_IDEMPOTENCY_KEY_LEN`].
    #[error("idempotency key is longer than 255 characters")]
    TooLong,
    /// Contains a byte outside printable ASCII (`0x20..=0x7E`).
    #[error("idempotency key contains a character outside printable ASCII")]
    IllegalCharacter,
}

/// A key the PMS will accept: 1..=255 printable-ASCII bytes.
///
/// Constructed, never parsed from thin air — a `PmsChannelClient` takes one
/// of these rather than a `&str` so there is no way to put an unvalidated
/// string in the header. A key that fails the PMS's own rule would come
/// back as a 400 *after* the request had been sent, which on a create means
/// a guest told "booking failed" because a header was malformed.
///
/// ## Why the value is a UUID v4 by default
///
/// The key's only job is to be the same on a retry of one booking attempt
/// and different for every other attempt. A v4 satisfies both with no
/// coordination and no information in it — deliberately *not* a hash of the
/// request, which would collapse a guest's genuine second booking for the
/// same nights into the first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyKey(String);

impl IdempotencyKey {
    /// A fresh random key — one booking attempt's worth.
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }

    /// Accept a caller-supplied key, or say why it cannot be used.
    ///
    /// ASCII whitespace is trimmed first: a key arrives in an HTTP header,
    /// where surrounding whitespace is not part of the value, and a client
    /// that sends `" abc "` means `abc`. After the trim the rule is the
    /// PMS's, byte for byte — length in *bytes*, because that is what the
    /// header carries and what the PMS counts.
    pub fn parse(raw: &str) -> Result<Self, IdempotencyKeyError> {
        let trimmed = raw.trim_matches(|c: char| c.is_ascii_whitespace());
        if trimmed.is_empty() {
            return Err(IdempotencyKeyError::Empty);
        }
        if trimmed.len() > MAX_IDEMPOTENCY_KEY_LEN {
            return Err(IdempotencyKeyError::TooLong);
        }
        if !trimmed.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
            return Err(IdempotencyKeyError::IllegalCharacter);
        }
        Ok(Self(trimmed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for IdempotencyKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
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
    /// True when the PMS answered `Idempotency-Replayed: true` — this
    /// request created nothing and the body is the stored answer from an
    /// earlier one carrying the same key.
    ///
    /// **A replay is a success**, and the fields above are the real hold:
    /// that is the entire point of sending a key. It is carried out of the
    /// client anyway because it changes what the *caller* may safely do —
    /// see `routes::bookings::create_channel_booking`, which must not
    /// release a replayed hold when its own insert fails, because the hold
    /// may already belong to a booking row the guest can see.
    ///
    /// `skip` rather than a field name: the PMS puts this in a header, not
    /// in the body, so there is nothing for serde to read and the default
    /// (`false`) is the honest starting value.
    #[serde(skip)]
    pub replayed: bool,
}

/// The machine `reason` the PMS channel API puts on **every** error body.
///
/// Since new-hotel #311 the channel answers a stable token alongside the
/// status, so this client no longer has to infer intent from a number that
/// several unrelated conditions share. The two 409s are the reason this
/// type exists: `sold_out` and `last_room_held_for_desk` are both "409
/// Conflict" and both definitive, but one means *pick other dates* and the
/// other means *phone the desk, the room is there* — advice a guest acts on
/// differently, and which the status alone cannot carry.
///
/// The token is part of the wire contract in both directions: it is parsed
/// here and re-emitted verbatim as the `reason` field of the app's own
/// error body (`ErrorResponse::reason`), so the LIFF flow picks its Thai
/// copy from the same string the PMS chose. Renaming a variant's
/// [`as_str`](Self::as_str) breaks the frontend, not just this module.
///
/// **Unknown reasons are not an error.** `from_body` answers `None` for a
/// token this build has never heard of, and the caller falls back to the
/// status-shaped mapping that predates this type — a PMS that grows a new
/// reason must not turn every booking into a 500 here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PmsReason {
    /// 503 — `LOYALTY_CHANNEL_ENABLED=false`. The channel is *closed*, not
    /// broken: no amount of retrying opens it, and the guest copy has to
    /// say so rather than "temporarily unavailable".
    ChannelDisabled,
    /// 401 — `LOYALTY_CHANNEL_TOKEN` rotated out from under us. Ours to
    /// fix, so the guest is told the system is down, never "rejected".
    Unauthorized,
    /// 409 — no room of this type is free for these dates. Definitive.
    SoldOut,
    /// 409 — rooms remain, but the last `LOYALTY_CHANNEL_LAST_ROOM_FLOOR`
    /// of them are reserved for the desk (new-hotel #311). Definitive, and
    /// the one refusal where the guest can still get the room by phoning.
    /// The body also carries `free_rooms` and `floor`; neither is read here
    /// because neither changes what the guest is told.
    LastRoomHeldForDesk,
    /// 503 + `Retry-After: 1` — the PMS could not take its inventory lock
    /// in time. Transient by construction, and the only reason this client
    /// retries on its own.
    InventoryLockTimeout,
    /// 422 — this `Idempotency-Key` was already used with a *different*
    /// booking. Definitive: the stored request for that key will never
    /// match this one, so the guest must start a new booking.
    IdempotencyKeyMismatch,
}

impl PmsReason {
    /// The wire token, verbatim. This is what the frontend switches on.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ChannelDisabled => "channel_disabled",
            Self::Unauthorized => "unauthorized",
            Self::SoldOut => "sold_out",
            Self::LastRoomHeldForDesk => "last_room_held_for_desk",
            Self::InventoryLockTimeout => "inventory_lock_timeout",
            Self::IdempotencyKeyMismatch => "idempotency_key_mismatch",
        }
    }

    /// Parse one token. Unknown tokens answer `None` — see the type docs.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "channel_disabled" => Some(Self::ChannelDisabled),
            "unauthorized" => Some(Self::Unauthorized),
            "sold_out" => Some(Self::SoldOut),
            "last_room_held_for_desk" => Some(Self::LastRoomHeldForDesk),
            "inventory_lock_timeout" => Some(Self::InventoryLockTimeout),
            "idempotency_key_mismatch" => Some(Self::IdempotencyKeyMismatch),
            _ => None,
        }
    }

    /// Pull `reason` out of a PMS error body.
    ///
    /// Tolerant on purpose: a body that is not JSON, has no `reason`, or
    /// carries a token this build does not know answers `None`. The extra
    /// fields the PMS sends with some reasons (`free_rooms`, `floor`) are
    /// ignored rather than modelled — they do not change what the guest is
    /// told, and modelling them would make an added field a parse failure.
    pub fn from_body(body: &str) -> Option<Self> {
        #[derive(Deserialize)]
        struct ReasonOnly {
            reason: Option<String>,
        }
        serde_json::from_str::<ReasonOnly>(body)
            .ok()?
            .reason
            .as_deref()
            .and_then(Self::parse)
    }

    /// Did the PMS decide about **this booking**, such that no retry — by
    /// this client, by the guest, or by a human — can change the answer?
    ///
    /// This is the same split `PmsActionError` draws between `Refused` and
    /// `Unavailable`, expressed per reason instead of per status: it is
    /// what turns into 409-vs-503 on our own response, and therefore into
    /// "the answer is no" vs "try again" for everything downstream.
    pub const fn is_definitive(self) -> bool {
        match self {
            Self::SoldOut | Self::LastRoomHeldForDesk | Self::IdempotencyKeyMismatch => true,
            // `inventory_lock_timeout` is definitive only *after* this
            // client has spent its one retry; by the time it is mapped it
            // is still an outage, because trying later can still work.
            Self::ChannelDisabled | Self::Unauthorized | Self::InventoryLockTimeout => false,
        }
    }

    /// The sentence a guest is shown when the frontend has no copy of its
    /// own for this reason.
    ///
    /// English, and deliberately so: the LIFF flow renders Thai first from
    /// its own locale files keyed on [`as_str`](Self::as_str), and this is
    /// the fallback for everything else that reads the API — the admin
    /// tools, a curl, a client build older than the reason. It must never
    /// name the PMS, a header or a flag.
    pub const fn guest_message(self) -> &'static str {
        match self {
            Self::ChannelDisabled => {
                "Online booking is closed right now. Please contact the front desk."
            },
            Self::Unauthorized | Self::InventoryLockTimeout => {
                "The booking system is temporarily unavailable. Please try again shortly, or \
                 contact the front desk."
            },
            Self::SoldOut => "This room type is sold out for the dates you chose.",
            Self::LastRoomHeldForDesk => {
                "The last room for these dates is kept for booking with the hotel directly. \
                 Please call the front desk."
            },
            Self::IdempotencyKeyMismatch => IDEMPOTENCY_KEY_REUSED_MESSAGE,
        }
    }

    /// The app error this reason becomes — 409 when definitive, 503 when
    /// not, with the token riding out to the caller as `reason`.
    pub fn into_app_error(self) -> AppError {
        AppError::PmsChannel {
            reason: self.as_str(),
            definitive: self.is_definitive(),
            message: self.guest_message().to_string(),
        }
    }
}

/// How long to wait before this client's one retry of an
/// `inventory_lock_timeout`.
///
/// The PMS sends `Retry-After: 1`. The header is honoured rather than
/// assumed, but bounded: this retry happens *inside* a guest's request,
/// while the hold guard's lock is held, so a PMS that answered
/// `Retry-After: 600` must not park the request until the router's own
/// timeout kills it. Anything absent, unparseable, or out of range becomes
/// [`INVENTORY_LOCK_RETRY_DEFAULT`].
const INVENTORY_LOCK_RETRY_MAX: std::time::Duration = std::time::Duration::from_secs(5);

/// Fallback delay when `Retry-After` is missing or unusable.
const INVENTORY_LOCK_RETRY_DEFAULT: std::time::Duration = std::time::Duration::from_secs(1);

/// Read `Retry-After` as a bounded delay. Seconds only: the HTTP-date form
/// is legal but the PMS does not send it, and a date this client failed to
/// parse is better served by the default than by a guess.
pub fn retry_after_delay(headers: &reqwest::header::HeaderMap) -> std::time::Duration {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(std::time::Duration::from_secs)
        .filter(|d| *d <= INVENTORY_LOCK_RETRY_MAX)
        .unwrap_or(INVENTORY_LOCK_RETRY_DEFAULT)
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
    /// The parsed, validated `PMS_BASE_URL`.
    ///
    /// A `Url`, not a `String`, on purpose: it is the only thing in this
    /// client that decides where a request goes, it was checked once by
    /// [`validate_pms_base_url`], and every endpoint below is a
    /// `base.join(<fixed path>)` off it. There is no string concatenation
    /// of a config value with a path anywhere in this module, so nothing a
    /// caller supplies can move a request to another host.
    base: Url,
    token: String,
    http: reqwest::Client,
    /// Whether [`create_booking`](PmsChannelClient::create_booking) takes
    /// the one-in-flight Redis lock (`PMS_HOLD_GUARD`, default on). See
    /// [`crate::config::PmsConfig::hold_guard`] for why it is a flag.
    hold_guard: bool,
}

impl PmsChannelClient {
    /// Build from settings; errors when the PMS channel is not configured
    /// (PMS_BASE_URL / PMS_CHANNEL_TOKEN).
    pub fn from_settings(settings: &Settings) -> AppResult<Self> {
        let base_url =
            settings.pms.base_url.as_deref().ok_or_else(|| {
                AppError::Configuration("PMS_BASE_URL is not configured".to_string())
            })?;
        // Parsed and checked **here, once**, rather than formatted into a
        // string at each call site. `Settings::validate` runs the same
        // check at startup so a bad value never reaches a guest's booking;
        // this is the second gate, for a client built from settings that
        // did not come through that path (the tests build several).
        //
        // The rejected value is not in the error: it is the one config
        // string most likely to have a credential pasted into it, and this
        // message reaches an admin's browser through
        // `AppError::Configuration`.
        let base = validate_pms_base_url(base_url).map_err(|e| {
            tracing::error!(reason = %e, "PMS_BASE_URL is not usable; refusing to build a PMS client");
            AppError::Configuration(format!("PMS_BASE_URL is not usable: {e}"))
        })?;
        let token = settings.pms.channel_token.clone().ok_or_else(|| {
            AppError::Configuration("PMS_CHANNEL_TOKEN is not configured".to_string())
        })?;
        Ok(Self {
            base,
            token,
            hold_guard: settings.pms.hold_guard,
            http: reqwest::Client::builder()
                .timeout(PMS_REQUEST_TIMEOUT)
                .connect_timeout(PMS_CONNECT_TIMEOUT)
                .build()
                .map_err(|e| {
                    AppError::Internal(format!("Failed to build the PMS HTTP client: {e}"))
                })?,
        })
    }

    /// A fixed channel endpoint, joined onto the validated base.
    ///
    /// `path` is always a literal in this module — there is no caller-
    /// supplied component — and the base was parsed by
    /// [`validate_pms_base_url`], so the only way this fails is a
    /// programming error in one of those literals, which is why it is an
    /// `Internal` error rather than anything a guest could provoke.
    fn endpoint(&self, path: &'static str) -> AppResult<Url> {
        self.base.join(path).map_err(|e| {
            AppError::Internal(format!("PMS endpoint {path} is not a valid path: {e}"))
        })
    }

    pub async fn availability(
        &self,
        property: Property,
        check_in: NaiveDate,
        check_out: NaiveDate,
        guests: i32,
    ) -> AppResult<PmsAvailability> {
        let url = self.endpoint("api/channel/availability")?;
        let response = self
            .http
            .get(url)
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
    ///
    /// ## Why the connection is a parameter
    ///
    /// `redis` is the application's own `ConnectionManager` — `state.redis()`
    /// — rather than a connection this client opens for itself. One shared,
    /// pooled, automatically-reconnecting manager with the bounded reconnect
    /// config from #416 is what the rest of the app already talks to Redis
    /// through, and the guard has no business opening a second one per
    /// booking. It is an argument and not a field because the client is
    /// built per request from `Settings`, and a required argument is what
    /// stops a future caller quietly creating holds with no guard at all.
    pub async fn create_booking(
        &self,
        request: &PmsCreateBookingRequest,
        redis: redis::aio::ConnectionManager,
        idempotency_key: &IdempotencyKey,
    ) -> AppResult<PmsBookingCreated> {
        // `PMS_HOLD_GUARD=false` retires the lock, not the key: the header
        // below is sent either way, so the PMS's own per-key store is what
        // a retry collapses onto. `stood_down` is the same no-op guard a
        // Redis outage produces, so there is exactly one unguarded path to
        // reason about rather than two.
        let guard = if self.hold_guard {
            self.acquire_hold_guard(&hold_guard_key(request), redis)
                .await?
        } else {
            tracing::debug!("PMS_HOLD_GUARD is off; relying on the PMS idempotency key alone");
            HoldGuard::stood_down()
        };
        let outcome = self
            .create_booking_unguarded(request, idempotency_key)
            .await;

        // The lock is held for **the ambiguous case only**.
        //
        // * **Success** — release at once. The caller now has a
        //   `pms_booking_id` and writes a local `bookings` row the guest can
        //   see, so a retry is no longer blind; holding the lock past that
        //   only punishes a guest who genuinely wants a second room for the
        //   same nights.
        // * **The PMS answered and refused** — release. Nothing was
        //   created, and the guest may correct their input and retry now.
        //   Two shapes of that: a `reason` the PMS named
        //   ([`AppError::PmsChannel`], A19 — sold out, the desk floor, a
        //   closed channel, an exhausted lock retry), and the pre-A19
        //   `BadRequest` for a 4xx it did not name. Both mean the PMS spoke
        //   and made nothing, so holding the lock past them would answer a
        //   sold-out guest "a booking for these dates is already being
        //   created" for the next twenty seconds.
        // * **Anything else** — a timeout, an unreachable host, an unnamed
        //   5xx, a malformed body — *keep* it to its TTL. This is the only
        //   branch where it is genuinely unknown whether a hold now exists,
        //   and it is precisely B8 race 2.3: the guest gives up on a hung
        //   request and taps "book" again.
        match &outcome {
            Ok(_) | Err(AppError::BadRequest(_)) | Err(AppError::PmsChannel { .. }) => {
                guard.release().await
            },
            _ => guard.keep(),
        }

        outcome
    }

    /// The create call itself: key on the way out, replay flag on the way
    /// back, and the one status that is about the key rather than the stay.
    async fn create_booking_unguarded(
        &self,
        request: &PmsCreateBookingRequest,
        idempotency_key: &IdempotencyKey,
    ) -> AppResult<PmsBookingCreated> {
        let url = self.endpoint("api/channel/bookings")?;
        // `inventory_lock_timeout` is the one reason this client retries by
        // itself, and it retries **exactly once**. The PMS could not take
        // its per-room-night lock in the time it allows itself (new-hotel
        // #311) and says so with `Retry-After: 1`; the contended window is
        // one other booking's write, so one wait is either enough or the
        // lock is not the problem. A loop here would sit inside a guest's
        // request holding the hold guard's lock, which is the shape of an
        // outage, not a fix for one.
        let mut retried_lock_timeout = false;
        let (response, replayed) = loop {
            let response = self
                .http
                .post(url.clone())
                .bearer_auth(&self.token)
                .header(IDEMPOTENCY_KEY_HEADER, idempotency_key.as_str())
                .json(request)
                .send()
                .await
                .map_err(pms_unreachable)?;

            // Read before the body is consumed either way.
            let replayed = replay_header_says_yes(response.headers());
            let status = response.status();
            if status.is_success() {
                break (response, replayed);
            }

            // The reason is in the *body*, so reading it consumes the
            // response — which is why the non-2xx path is handled here in
            // full rather than handed to `parse_json`.
            let retry_after = retry_after_delay(response.headers());
            let detail = response.text().await.unwrap_or_default();
            let reason = PmsReason::from_body(&detail).or_else(|| {
                // A PMS build older than new-hotel #311 sends no reason,
                // and 422 on this path can only ever have been the key
                // (new-hotel #305). Keeping the status fallback means a
                // half-deployed estate still tells the guest the useful
                // thing instead of the PMS's raw body.
                (status == reqwest::StatusCode::UNPROCESSABLE_ENTITY)
                    .then_some(PmsReason::IdempotencyKeyMismatch)
            });

            if reason == Some(PmsReason::InventoryLockTimeout) && !retried_lock_timeout {
                retried_lock_timeout = true;
                tracing::warn!(
                    idempotency_key = %idempotency_key,
                    retry_after_ms = retry_after.as_millis() as u64,
                    "PMS could not take its inventory lock; retrying the hold create once"
                );
                tokio::time::sleep(retry_after).await;
                continue;
            }

            if reason == Some(PmsReason::IdempotencyKeyMismatch) {
                tracing::error!(
                    idempotency_key = %idempotency_key,
                    detail = %truncate_refusal_body(&detail),
                    "PMS refused the create: this idempotency key was already used with a \
                     different booking. Something re-used a key across two different stays."
                );
            }

            return Err(match reason {
                Some(reason) => {
                    tracing::warn!(
                        pms_status = status.as_u16(),
                        reason = reason.as_str(),
                        definitive = reason.is_definitive(),
                        retried_lock_timeout,
                        "PMS refused the hold create"
                    );
                    reason.into_app_error()
                },
                // No reason on the body: the pre-A19 status-shaped mapping,
                // unchanged.
                None => map_status_error(status, &detail, "create booking"),
            });
        };

        let mut created: PmsBookingCreated = Self::parse_json(response, "create booking").await?;
        created.replayed = replayed;
        if replayed {
            // Not a warning: this is the feature working. It is logged
            // because it is also the fingerprint of a guest who retried,
            // and the rate of it is how we will know the keyed path is
            // carrying its weight before `PMS_HOLD_GUARD` is turned off.
            tracing::info!(
                idempotency_key = %idempotency_key,
                pms_booking_id = %created.pms_booking_id,
                "PMS replayed an existing hold for this idempotency key; no second hold was created"
            );
        }
        Ok(created)
    }

    /// Take the one-in-flight lock for this guest and stay, or refuse.
    ///
    /// `SET key token NX PX` — the whole guard, in one round trip. A lock
    /// that is already held answers [`AppError::Conflict`] (409), which is
    /// the truth: an identical hold is being created right now.
    ///
    /// Redis being unreachable is **not** an error here. The guard logs and
    /// stands down, because refusing bookings for the whole property to
    /// prevent a rare duplicate hold is the worse failure. That includes
    /// Redis being *slow*: the call is bounded by
    /// [`HOLD_GUARD_REDIS_TIMEOUT`], and a lock that takes longer than that
    /// to take is abandoned rather than charged to the guest's booking.
    async fn acquire_hold_guard(
        &self,
        key: &str,
        mut conn: redis::aio::ConnectionManager,
    ) -> AppResult<HoldGuard> {
        let token = uuid::Uuid::new_v4().to_string();

        let attempt = tokio::time::timeout(
            HOLD_GUARD_REDIS_TIMEOUT,
            redis::cmd("SET")
                .arg(key)
                .arg(&token)
                .arg("NX")
                .arg("PX")
                .arg(HOLD_GUARD_TTL.as_millis() as u64)
                .query_async(&mut conn),
        )
        .await;

        let acquired: Option<String> = match attempt {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                tracing::warn!(error = %e,
                    "PMS hold guard could not take its lock; creating the hold unguarded");
                return Ok(HoldGuard::stood_down());
            },
            Err(_) => {
                tracing::warn!(
                    timeout_ms = HOLD_GUARD_REDIS_TIMEOUT.as_millis() as u64,
                    "PMS hold guard timed out taking its lock; creating the hold unguarded"
                );
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
        let url = match action_url(&self.base, pms_booking_id, action) {
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
        let mut request = self.http.post(url).bearer_auth(&self.token);
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
            // A19: the PMS's own `reason` wins when it sent one. It is
            // strictly better information than the status — `sold_out` and
            // `last_room_held_for_desk` are the same 409 — and it is what
            // the guest's copy is keyed on. Availability goes through here
            // too, so a closed channel says "closed" on the first screen of
            // the flow rather than only on the create.
            if let Some(reason) = PmsReason::from_body(&detail) {
                tracing::warn!(
                    pms_status = status.as_u16(),
                    reason = reason.as_str(),
                    what = %what,
                    "PMS refused with a machine reason"
                );
                return Err(reason.into_app_error());
            }
            return Err(map_status_error(status, &detail, what));
        }
        response.json::<T>().await.map_err(|e| {
            AppError::ExternalServiceUnavailable(format!("PMS {what} response malformed: {e}"))
        })
    }
}

/// The pre-A19 mapping: infer intent from the status alone.
///
/// Still the fallback for a PMS that sent no `reason` — an older build, a
/// Cloudflare Access challenge, an nginx error page, anything between us
/// and the channel that answered instead of it.
///
/// The split B1 drew: a 4xx that is about the *request* — bad dates, a room
/// type that no longer exists — is the guest's to fix, so it surfaces as a
/// client error. A 401 (rotated `LOYALTY_CHANNEL_TOKEN`), a 403
/// (`HFVILLE_WRITES_ENABLED` off) or a 404 (channel router not mounted,
/// which is what a PMS with a dead PG pool looks like from out here) is
/// *ours*, and telling the guest "bad request" about our own expired
/// credential is both wrong and unhelpful.
fn map_status_error(status: reqwest::StatusCode, detail: &str, what: &str) -> AppError {
    if status.is_client_error() && !NOT_THE_CALLERS_FAULT.contains(&status.as_u16()) {
        AppError::BadRequest(format!(
            "PMS rejected {what}: {}",
            truncate_refusal_body(detail)
        ))
    } else {
        AppError::ExternalServiceUnavailable(format!(
            "PMS {what} failed: {status} {}",
            truncate_refusal_body(detail)
        ))
    }
}

/// What a guest is told when the PMS refuses a create with 422.
///
/// Guest-facing verbatim: `AppError::Conflict` renders its message straight
/// through (`error.rs::safe_message`). It has to say the one useful thing —
/// *do not retry this, start again* — without mentioning keys, headers or
/// the PMS, none of which mean anything to the person reading it.
pub const IDEMPOTENCY_KEY_REUSED_MESSAGE: &str =
    "This booking request has already been sent with different details. \
     Please start a new booking rather than trying this one again.";

/// Did the PMS answer from its idempotency store?
///
/// Deliberately tolerant about the *value* and strict about nothing else:
/// the contract says `true`, and a header that is absent, unparseable, or
/// says anything else is read as "not a replay". Getting this wrong in the
/// permissive direction would mark a genuinely new hold as a replay, which
/// is what stops the caller releasing it on a later failure — so the
/// default has to be `false`.
fn replay_header_says_yes(headers: &reqwest::header::HeaderMap) -> bool {
    headers
        .get(IDEMPOTENCY_REPLAYED_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
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
/// `conn: None` is the stood-down guard: Redis did not answer in time (or at
/// all), the booking went ahead unguarded, and dropping it must do nothing.
struct HoldGuard {
    conn: Option<redis::aio::ConnectionManager>,
    key: String,
    token: String,
}

impl HoldGuard {
    /// The guard that isn't: Redis did not answer, so nothing was locked and
    /// nothing has to be unlocked.
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
        // Bounded like the acquire: this runs *after* the PMS has answered,
        // on the guest's own request, so a Redis that has gone away must not
        // add its reconnect cycle to a booking that already succeeded.
        match tokio::time::timeout(
            HOLD_GUARD_REDIS_TIMEOUT,
            script
                .key(&self.key)
                .arg(&self.token)
                .invoke_async::<i64>(conn),
        )
        .await
        {
            Ok(Ok(_)) => {},
            // Harmless: the lock expires on its own in HOLD_GUARD_TTL. Worth
            // a line, because a guest who corrected their dates now waits.
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "PMS hold guard could not release its lock early");
            },
            Err(_) => {
                tracing::warn!(
                    timeout_ms = HOLD_GUARD_REDIS_TIMEOUT.as_millis() as u64,
                    "PMS hold guard timed out releasing its lock early"
                );
            },
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

    /// The base every URL test builds from, parsed the way production
    /// parses it.
    fn base() -> Url {
        validate_pms_base_url(BASE).expect("the prod shape is accepted")
    }

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
        let base = base();
        assert_eq!(
            action_url(&base, "../../admin/keys", "release"),
            Err(PmsBookingIdError::IllegalCharacter.into())
        );
        assert_eq!(
            action_url(&base, "//evil.example.com", "payment-verified"),
            Err(PmsBookingIdError::IllegalCharacter.into())
        );
        assert_eq!(
            action_url(&base, "", "release"),
            Err(PmsBookingIdError::Empty.into())
        );
    }

    // ========================================================================
    // The base URL is parsed once, and is the only thing that picks a host
    // ========================================================================

    /// The shapes production and the test suite actually use.
    ///
    /// The dotless-host case is not a curiosity: it is a Docker Compose
    /// service name, which is how this app reaches the PMS on a shared
    /// network, and it is why plain `http` has an exception at all.
    #[test]
    fn the_validator_accepts_every_shape_we_deploy() {
        for raw in [
            "https://pms.example.com",
            "https://pms.example.com/",
            "https://pms.example.com:8443",
            "https://pms.example.com/hotel",
            "http://localhost:3000",
            "http://127.0.0.1:8080",
            "http://[::1]:8080",
            "http://host.docker.internal:3000",
            "http://new-hotel-backend:8080",
        ] {
            assert!(
                validate_pms_base_url(raw).is_ok(),
                "{raw} is a base we deploy and must be accepted"
            );
        }
    }

    /// Plain http to anything routable would put the channel bearer token
    /// on the wire in clear text on every availability call.
    #[test]
    fn the_validator_rejects_plain_http_to_a_public_host() {
        for raw in [
            "http://pms.example.com",
            "http://pms.example.com:8080/hotel",
            "http://203.0.113.10:8080",
            "http://192.168.1.10",
        ] {
            assert_eq!(
                validate_pms_base_url(raw),
                Err(PmsBaseUrlError::InsecureScheme),
                "{raw} must be refused"
            );
        }
    }

    /// Everything else the value must not be.
    #[test]
    fn the_validator_rejects_a_base_that_is_not_a_plain_endpoint() {
        for (raw, expected) in [
            // Credentials in a URL end up in every log line that prints it.
            (
                "https://user:pass@pms.example.com",
                PmsBaseUrlError::HasCredentials,
            ),
            (
                "https://user@pms.example.com",
                PmsBaseUrlError::HasCredentials,
            ),
            // A query or fragment on a *base* is a pasted full URL, and
            // `Url::join` would drop it without a word.
            (
                "https://pms.example.com/?token=abc",
                PmsBaseUrlError::HasQueryOrFragment,
            ),
            (
                "https://pms.example.com/#frag",
                PmsBaseUrlError::HasQueryOrFragment,
            ),
            // Not a PMS. The scheme is checked before the host so the
            // message names the real problem: `file:///etc/passwd` has no
            // host *either*, and "PMS_BASE_URL has no host" would send an
            // operator hunting for a typo in a value whose whole shape is
            // wrong.
            ("file:///etc/passwd", PmsBaseUrlError::UnsupportedScheme),
            ("ftp://pms.example.com", PmsBaseUrlError::UnsupportedScheme),
            ("data:text/plain,hello", PmsBaseUrlError::UnsupportedScheme),
            // Right scheme, nothing to send to.
            ("https://", PmsBaseUrlError::Unparseable),
            // Not a URL at all — the shape of an unset variable that
            // someone filled in with a hostname.
            ("pms.example.com", PmsBaseUrlError::Unparseable),
            ("", PmsBaseUrlError::Unparseable),
            ("   ", PmsBaseUrlError::Unparseable),
        ] {
            assert_eq!(
                validate_pms_base_url(raw),
                Err(expected),
                "{raw:?} must be refused"
            );
        }
    }

    /// A base that carries a path prefix keeps it.
    ///
    /// `Url::join` replaces the last segment of a path that does not end in
    /// a slash, so without the normalisation in the validator
    /// `https://pms.example.com/hotel` + `api/channel/availability` would
    /// resolve to `/api/channel/availability` and quietly drop the prefix —
    /// a 404 at deploy time, from a value that looked right.
    #[test]
    fn a_base_path_prefix_survives_the_join() {
        let base = validate_pms_base_url("https://pms.example.com/hotel").unwrap();
        assert_eq!(base.as_str(), "https://pms.example.com/hotel/");
        assert_eq!(
            base.join("api/channel/availability").unwrap().as_str(),
            "https://pms.example.com/hotel/api/channel/availability"
        );
        assert_eq!(
            action_url(&base, "HF-42", "release").unwrap().as_str(),
            "https://pms.example.com/hotel/api/channel/bookings/HF-42/release"
        );
    }

    /// The ordinary case, spelled out: the host, scheme and port come from
    /// the base and the id is one segment.
    #[test]
    fn an_accepted_id_lands_on_the_pms_as_one_path_segment() {
        let base = base();
        assert_eq!(
            action_url(&base, "hf-2026-000417", "payment-verified")
                .unwrap()
                .as_str(),
            "https://pms.example.com/api/channel/bookings/hf-2026-000417/payment-verified"
        );
        assert_eq!(
            base.join("api/channel/bookings").unwrap().as_str(),
            "https://pms.example.com/api/channel/bookings"
        );
    }

    /// Belt and braces on the encoder: even if the allow-list were ever
    /// loosened, a segment cannot grow into a path, an authority or a
    /// query, because `path_segments_mut` percent-encodes what it is given.
    ///
    /// Asserted against the *encoder* rather than through `action_url`,
    /// which refuses all of these before they get there — the point is that
    /// the second line of defence is real and not just a comment.
    #[test]
    fn a_pushed_segment_can_never_add_a_path_element() {
        for hostile in [
            "../../admin/keys",
            "//evil.example.com",
            "x?token=1",
            "x#frag",
            "x/y",
        ] {
            let mut url = base();
            url.path_segments_mut()
                .unwrap()
                .pop_if_empty()
                .extend(["api", "channel", "bookings", hostile, "release"]);
            assert_eq!(
                url.host_str(),
                Some("pms.example.com"),
                "{hostile:?} must not move the request to another host"
            );
            assert!(
                url.path().starts_with("/api/channel/bookings/"),
                "{hostile:?} must stay inside the bookings path: {url}"
            );
            assert!(
                url.path().ends_with("/release"),
                "{hostile:?} must not swallow the action: {url}"
            );
            assert!(
                url.query().is_none() && url.fragment().is_none(),
                "{hostile:?} must not open a query or fragment: {url}"
            );
        }
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

    // ------------------------------------------------------------------
    // Idempotency keys (A16)
    // ------------------------------------------------------------------

    /// A minted key is one the PMS will take: the validator and the minter
    /// must not be able to disagree.
    #[test]
    fn a_minted_key_satisfies_the_rule_the_pms_enforces() {
        for _ in 0..64 {
            let key = IdempotencyKey::new_v4();
            IdempotencyKey::parse(key.as_str())
                .expect("a key we mint must be a key we would accept");
        }
        assert_ne!(
            IdempotencyKey::new_v4(),
            IdempotencyKey::new_v4(),
            "two attempts must not share a key, or a guest's second, genuine \
             booking would collapse into their first"
        );
    }

    /// The PMS's rule, at both ends: 1..=255 bytes of printable ASCII.
    #[test]
    fn the_key_rule_is_the_pms_rule() {
        assert_eq!(
            IdempotencyKey::parse("").unwrap_err(),
            IdempotencyKeyError::Empty
        );
        assert_eq!(
            IdempotencyKey::parse("   ").unwrap_err(),
            IdempotencyKeyError::Empty,
            "whitespace is trimmed first, so a blank header is empty"
        );
        assert_eq!(
            IdempotencyKey::parse("k")
                .expect("one byte is enough")
                .as_str(),
            "k"
        );

        let longest = "k".repeat(MAX_IDEMPOTENCY_KEY_LEN);
        assert_eq!(
            IdempotencyKey::parse(&longest)
                .expect("255 is inside the rule")
                .as_str(),
            longest
        );
        assert_eq!(
            IdempotencyKey::parse(&"k".repeat(MAX_IDEMPOTENCY_KEY_LEN + 1)).unwrap_err(),
            IdempotencyKeyError::TooLong
        );
    }

    /// Anything that is not printable ASCII is refused — and the two cases
    /// that matter most are a header separator and a non-ASCII character,
    /// because either would be rejected by the PMS *after* the request went
    /// out, i.e. as a failed booking.
    #[test]
    fn a_key_that_is_not_printable_ascii_never_leaves_the_process() {
        for bad in ["key\nwith-newline", "key\rwith-cr", "กุญแจ", "key\u{0}nul"] {
            assert_eq!(
                IdempotencyKey::parse(bad).unwrap_err(),
                IdempotencyKeyError::IllegalCharacter,
                "{bad:?} must be refused here, not by the PMS"
            );
        }
    }

    /// Surrounding whitespace is not part of a header value, so it is not
    /// part of the key — a client sending `" abc "` and one sending `"abc"`
    /// must land on the same stored request.
    #[test]
    fn a_key_is_trimmed_the_way_a_header_value_is() {
        assert_eq!(
            IdempotencyKey::parse("  abc-123  ")
                .expect("trims")
                .as_str(),
            "abc-123"
        );
    }

    /// The replay header is read strictly, and everything that is not
    /// `true` means "this is a fresh hold".
    ///
    /// The permissive direction is the dangerous one: a fresh hold wrongly
    /// marked as replayed is one the route will refuse to release when its
    /// own insert fails, leaving a room held for nobody.
    #[test]
    fn only_a_true_replay_header_counts_as_a_replay() {
        fn headers(value: Option<&str>) -> reqwest::header::HeaderMap {
            let mut map = reqwest::header::HeaderMap::new();
            if let Some(value) = value {
                map.insert(
                    reqwest::header::HeaderName::from_static("idempotency-replayed"),
                    reqwest::header::HeaderValue::from_str(value).expect("header value"),
                );
            }
            map
        }

        assert!(replay_header_says_yes(&headers(Some("true"))));
        assert!(
            replay_header_says_yes(&headers(Some("True"))),
            "HTTP header values are not case-normalised, so neither is this read"
        );
        assert!(replay_header_says_yes(&headers(Some(" true "))));

        assert!(!replay_header_says_yes(&headers(None)));
        assert!(!replay_header_says_yes(&headers(Some("false"))));
        assert!(!replay_header_says_yes(&headers(Some(""))));
        assert!(!replay_header_says_yes(&headers(Some("1"))));
    }

    /// Behaviour for a valid id is byte-for-byte what it was before the
    /// allow-list and the parsed base existed — the encoder touches
    /// nothing the allow-list admits, and the join reproduces the string
    /// the old `format!` produced.
    #[test]
    fn a_valid_id_builds_exactly_the_url_it_always_did() {
        let base = base();
        assert_eq!(
            action_url(&base, "hf-2026-000417", "payment-verified")
                .unwrap()
                .as_str(),
            "https://pms.example.com/api/channel/bookings/hf-2026-000417/payment-verified"
        );
        assert_eq!(
            action_url(&base, "booking_00042", "release")
                .unwrap()
                .as_str(),
            "https://pms.example.com/api/channel/bookings/booking_00042/release"
        );
    }
}
