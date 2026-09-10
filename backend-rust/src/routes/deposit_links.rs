//! Public deposit-request-link routes — the guest half of workstream B1
//!
//! Reception issues one link for a booking it already took by phone, LINE
//! or at the desk (`routes::admin_deposit_links`). The guest opens the
//! link, sees the amount and a PromptPay QR with the amount already filled
//! in, uploads the slip, and the slip runs through the same `decide()` and
//! audit path as any other.
//!
//! ## Endpoints
//!
//! - `GET  /api/deposit`      — what the guest page renders
//! - `POST /api/deposit/slip` — the slip upload (multipart, `file`)
//!
//! Both take the link token in the **`X-Deposit-Token` request header**,
//! never in the path or the query string. See "the token is never in a
//! URL" below — that is the single most load-bearing decision in this
//! module and the easiest one to undo by "simplifying" the route back to
//! `/api/deposit/:token`.
//!
//! ## No login, and the reason
//!
//! `routes::bookings::add_booking_slip` requires a session and compares
//! `booking.user_id` against the caller, so an authenticated design needs
//! the guest to hold an account and own the booking. Reception's guests
//! arrive by phone and walk-in, and a login wall is the friction B1 exists
//! to remove. **The token is the capability.**
//!
//! What is reused verbatim is the decision path, not the handler: the
//! upload calls the same storage writer as `POST /api/slips/upload`
//! (`routes::slips::store_slip_upload`, magic-byte checks included), the
//! same `insert_booking_slip_tx` and the same `run_slipok_check`.
//! `slipok_check`, `slip_match::decide`, `record_slipok_result` and
//! `slip_confirm::confirm_slip` are untouched.
//!
//! ## The token is never in a URL
//!
//! A URL path is written down in more places than anyone can revoke: the
//! frontend container's nginx access log, Cloudflare's HTTP logs, a
//! `Referer` header on any outbound link, a browser's history sync, the
//! LINE in-app browser's own telemetry. The token is a bearer capability
//! for a payment, so putting it in a path means every one of those becomes
//! a place a stranger can pick up a live payment page.
//!
//! Two halves keep it out of all of them:
//!
//! - **The guest link is `https://<frontend>/d#<token>`.** A URL fragment
//!   is not sent to the server at all, so it cannot appear in any access
//!   log on the way. The SPA reads `window.location.hash`.
//! - **The API takes `X-Deposit-Token`.** Headers are not part of the
//!   request line, so the default nginx `combined` format never writes
//!   them, and no proxy on the path logs them by default.
//!
//! There is no second, path-shaped form of either. `/d/<token>` does not
//! resolve in the SPA and `/api/deposit/<token>` does not exist: no link
//! has ever been issued in any environment in that shape, so there is
//! nothing to keep working and no reason to carry a route whose whole
//! effect would be to put the token back in a request line.
//!
//! ## Security notes that are easy to undo by accident
//!
//! - The token is 32 CSPRNG bytes, base64url, and only its SHA-256 ever
//!   reaches the database. Lookup is by hash: no timing oracle, and a
//!   database leak yields no live links.
//! - **Never log the token, and never log the header.** Log `link_id` and
//!   `booking_id`. The same goes for rate-limit keys, which is why the
//!   per-token bucket is keyed on the hex of the hash rather than on the
//!   token.
//! - A missing or malformed `X-Deposit-Token` answers **404 with no
//!   detail** — the same response an unknown token gets. A scanner must
//!   not be able to tell "you sent no header" from "that link does not
//!   exist" from "that link was revoked".
//! - The response carries the guest's *given name only*: no phone, no
//!   email, no membership id, no booking UUID.

use axum::{
    extract::{DefaultBodyLimit, Multipart, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::rate_limit::{
    peer_ip, resolve_client_ip, RateLimitConfig, RateLimitError, RedisRateLimiter, TrustedProxies,
};
use crate::services::promptpay::PromptPayService;
use crate::state::AppState;

// ============================================================================
// The system actor and the token
// ============================================================================

/// The non-loginable user row every deposit-link booking is owned by.
///
/// Seeded by migration `20260912010000_deposit_links.sql` as
/// `deposit-link@system.hf.invalid`. `bookings.user_id` is NOT NULL and a
/// deposit-link guest has no account, so the row has to point somewhere —
/// and pointing it at a real member would hand that member's session a
/// stranger's slip through the storage authorisation path.
///
/// A fixed constant rather than a lookup: it is part of the cross-repo
/// interface for the deposit programme, so it must never be regenerated.
pub const DEPOSIT_LINK_SYSTEM_USER_ID: Uuid =
    Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0051_10b2);

/// `bookings.booking_source` for a booking created from a deposit link.
///
/// `services::slip_confirm` reads this to decide whether a verified slip
/// may flip a non-channel booking to `confirmed`, so the two must agree on
/// the literal.
pub const BOOKING_SOURCE_DEPOSIT_LINK: &str = "deposit_link";

/// Token entropy. 32 bytes from the OS CSPRNG, base64url-encoded without
/// padding, is 43 characters.
const TOKEN_BYTES: usize = 32;

/// Mint a fresh link token. Returns the token — the only time it exists in
/// plaintext anywhere. Show it to the issuing admin once and forget it.
pub(crate) fn generate_token() -> String {
    use rand::RngCore;

    let mut bytes = [0u8; TOKEN_BYTES];
    // `OsRng` rather than a seeded thread RNG: this value is a bearer
    // credential for money, so it comes from the OS CSPRNG directly.
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 of a token, which is all the database ever sees.
pub(crate) fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// The request header the link token travels in.
///
/// Not a path segment and not a query parameter: see the module docs. The
/// name is part of the cross-repo interface — `depositLinkService.ts`
/// sends it — so changing it breaks every live link at once.
pub const DEPOSIT_TOKEN_HEADER: &str = "X-Deposit-Token";

/// Shortest and longest header value that could be a token we minted.
///
/// A real token is exactly [`TOKEN_BYTES`] base64url characters (43). The
/// bounds are a little wider so that a future token length is not an
/// outage, and narrow enough that nothing large gets hashed on the way to
/// a 404.
const TOKEN_MIN_LEN: usize = 16;
const TOKEN_MAX_LEN: usize = 128;

/// The one 404 every failed lookup on this router answers with.
///
/// Missing header, malformed header, unknown token, revoked-and-purged
/// token: all the same response, carrying nothing that separates them. A
/// scanner holding a guessed token learns only that it does not work.
fn not_found() -> AppError {
    AppError::NotFound("Deposit link".to_string())
}

/// Read the link token out of [`DEPOSIT_TOKEN_HEADER`].
///
/// Rejects — as an indistinguishable [`not_found`] — anything that is not
/// plausibly a token we minted: absent, non-ASCII, wrong length, or
/// carrying a character outside the base64url alphabet. The charset check
/// is not decoration: it is what guarantees the value is safe to put in a
/// Redis key and in a `hex::encode` argument without any further
/// escaping, and it keeps a header full of newlines or control characters
/// from ever reaching either.
///
/// The value itself is never logged, never returned in an error, and never
/// used anywhere but [`token_hash`].
fn token_from_headers(headers: &HeaderMap) -> AppResult<String> {
    let value = headers
        .get(DEPOSIT_TOKEN_HEADER)
        .ok_or_else(not_found)?
        .to_str()
        .map_err(|_| not_found())?
        .trim();

    if !(TOKEN_MIN_LEN..=TOKEN_MAX_LEN).contains(&value.len()) {
        return Err(not_found());
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(not_found());
    }

    Ok(value.to_string())
}

// ============================================================================
// The guest state vocabulary
// ============================================================================

/// The link is live and nothing has been uploaded against it.
pub const STATE_AWAITING_PAYMENT: &str = "awaiting_payment";
/// A slip is in, and no decision has been made on it yet.
pub const STATE_CHECKING: &str = "checking";
/// The booking is paid for as far as the guest is concerned.
pub const STATE_CONFIRMED: &str = "confirmed";
/// The link ran out before anything was verified against it.
pub const STATE_EXPIRED: &str = "expired";
/// Reception killed the link (usually because it reissued one).
pub const STATE_REVOKED: &str = "revoked";

/// What a slip contributes to the state of a link.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SlipFacts {
    /// At least one slip has been uploaded against the booking.
    pub any: bool,
    /// At least one of them reads `admin_status = 'verified'`.
    pub any_verified: bool,
}

/// Derive the one vocabulary the guest page branches on.
///
/// Derived, never stored — a stored copy is a second source of truth that
/// drifts the first time a slip is verified from the admin screen instead
/// of through this module.
///
/// The order is the contract (b1-deposit-link-spec.md §2):
///
/// 1. `revoked_at` set → `revoked`.
/// 2. `expires_at` past **with no verified slip** → `expired`. The
///    verified-slip carve-out is what stops a guest who paid on the last
///    afternoon of the link from being told, an hour later, that their
///    confirmed booking expired.
/// 3. booking `confirmed`, or any slip verified → `confirmed`.
/// 4. a slip present and not verified → `checking`. Every non-verified
///    SlipOK status collapses here: a guest is never shown a vendor
///    verdict.
/// 5. otherwise → `awaiting_payment`.
pub(crate) fn derive_state(
    revoked_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
    booking_status: &str,
    slips: SlipFacts,
    now: DateTime<Utc>,
) -> &'static str {
    if revoked_at.is_some() {
        return STATE_REVOKED;
    }
    if expires_at <= now && !slips.any_verified {
        return STATE_EXPIRED;
    }
    if booking_status == "confirmed" || slips.any_verified {
        return STATE_CONFIRMED;
    }
    if slips.any {
        return STATE_CHECKING;
    }
    STATE_AWAITING_PAYMENT
}

// ============================================================================
// Rate limits
// ============================================================================
//
// Three layers on every public request. They are **charged narrowest
// first**, and that order is the design, not an accident of how the code
// reads:
//
// 1. **Per link**, keyed on the hex SHA-256 of the token (never the
//    token: the key reaches Redis and the error log on a Redis failure).
//    This is the layer that speaks about a guest, and it is what survives
//    a phone changing IP between attempts.
// 2. **Per client IP**, resolved through the trusted-proxy rule
//    (`middleware::rate_limit::resolve_client_ip`), never the raw TCP
//    peer. Behind cloudflared the peer is the tunnel for every guest on
//    earth, so a peer-keyed budget is one bucket that three people paying
//    at once would exhaust between them — a 429 in the middle of a
//    payment.
// 3. **One global bucket per route.** Keyed on the route and nothing else,
//    so it is the same bucket for everyone. It is the only layer a caller
//    cannot escape: a token holder who rotates tokens mints a fresh
//    per-token bucket every time and a botnet mints a fresh per-IP bucket
//    every time, and the global bucket counts both anyway. Sized so that
//    it is the *last* thing a legitimate load meets, never the first.
//
// ## Why narrowest first
//
// Every layer both *checks* and *charges*: a check is an INCR. So a
// request refused by a narrow bucket must not have already spent a slot
// of a wider one, or the attacker the narrow bucket just stopped goes on
// draining the budget that protects everybody else. Charge the global
// bucket first and one hammering token holder — already refused by their
// own per-link budget — still burns 600 global slots a minute, and a
// guest who has done nothing wrong meets a 429 because of them. Charging
// per-link first means the refusal costs the attacker their own bucket
// and nobody else's.
//
// The trade is that a request refused at layer 1 is invisible to layers 2
// and 3, so the wider counters undercount an already-refused caller. That
// is the right way round: the wider buckets exist to bound callers the
// narrow ones cannot see (rotated tokens, a botnet), and those are
// precisely the requests that reach them.
//
// All three run in every environment. The public deposit endpoints have no
// authentication at all, so their budgets are a property of the capability
// rather than a production-only convenience; the test harness keeps its
// buckets apart with `security.rate_limit_namespace` instead of by turning
// the limiters off.

/// The guest page polls the read endpoint every 5 seconds for two minutes
/// after an upload (12/min), so 30/min per **link** is a little over
/// double what a well-behaved page asks for.
const READ_PER_TOKEN: (u32, u64) = (30, 60);

/// 120/min per client address.
///
/// Deliberately four times the per-link budget, because an address is a
/// much worse proxy for "a guest" than a link is: hotel WiFi puts every
/// person in the building behind one address, and Thai mobile carriers put
/// tens of thousands behind one CGNAT address. A family of four in the
/// lobby, each polling their own link at 12/min, is 48/min from a single
/// address and has done nothing wrong. The per-link budget above is what
/// actually shapes a single guest; this one is a ceiling on an address
/// that has clearly stopped being one guest.
const READ_PER_IP: (u32, u64) = (120, 60);

/// The global read budget. Deliberately far above any real day: reception
/// issues a handful of links a day and each one polls at 12/min while a
/// guest is paying, so 600/min is roughly fifty guests paying at the same
/// second. It exists to bound a scanner, not to shape traffic.
const READ_GLOBAL: (u32, u64) = (600, 60);

/// 5 **stored** slips per hour per link.
///
/// Charged after the file has validated and **before** it is written, so a
/// guest who has already transferred the money and then picks the wrong
/// file five times — a WebP screenshot from an Android gallery, a PDF out
/// of a bank app, a HEIC iOS did not transcode, a truncated upload on a
/// flaky mobile connection — is not locked out for an hour from the only
/// page that lets them show proof of payment, and a caller over the budget
/// leaves nothing on disk.
const UPLOAD_PER_TOKEN: (u32, u64) = (5, 3600);

/// 30 upload *attempts* per hour per link, charged before the body is
/// read. Loose enough that a guest fumbling with their gallery never meets
/// it, tight enough that a token holder cannot make us parse 10 MB bodies
/// all day.
const UPLOAD_ATTEMPTS_PER_TOKEN: (u32, u64) = (30, 3600);

/// 40 upload attempts per hour per client address.
///
/// Same reasoning as [`READ_PER_IP`]: hotel WiFi and carrier NAT share one
/// address between many guests, so this budget has to hold several people
/// uploading at once. The per-link budgets above are the ones that bound
/// any single guest.
const SLIP_PER_IP: (u32, u64) = (40, 3600);

/// The global upload budget — see [`READ_GLOBAL`] for the reasoning.
const UPLOAD_GLOBAL: (u32, u64) = (300, 3600);

/// Which public route a limiter layer guards.
///
/// The variant is the global bucket's whole key, which is the point: it
/// contains no token and no address, so nothing a caller controls can mint
/// a second one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicDepositRoute {
    /// `GET /api/deposit`
    Read,
    /// `POST /api/deposit/slip`
    Slip,
}

impl PublicDepositRoute {
    /// The global bucket's subject. Stable across restarts and replicas.
    fn global_subject(self) -> &'static str {
        match self {
            Self::Read => "GET /api/deposit",
            Self::Slip => "POST /api/deposit/slip",
        }
    }

    /// Does an unreachable Redis refuse the request, or let it through?
    ///
    /// **The read fails open.** Its budget exists to bound polling, and a
    /// Redis blip that blanked the guest's payment page — while their
    /// money is already transferred — would be a worse outage than the
    /// unbounded reads it prevents. Reads write nothing.
    ///
    /// **The slip upload fails closed.** It is unauthenticated and it
    /// *writes*: a file on the shared storage volume and a row against a
    /// stranger's booking. With no budget evaluable, "allow" means
    /// "unlimited", and the caller need only keep Redis unhappy to fill
    /// the volume. A guest meets a 503 and the plain retry message, and
    /// nothing is written; their money is not lost, and reception can
    /// still confirm the payment by hand.
    fn fails_closed(self) -> bool {
        match self {
            Self::Read => false,
            Self::Slip => true,
        }
    }

    /// Namespace component so the three routes do not share buckets.
    fn slug(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Slip => "slip",
        }
    }

    fn budgets(self) -> RouteBudgets {
        match self {
            Self::Read => RouteBudgets {
                global: READ_GLOBAL,
                per_ip: READ_PER_IP,
                per_token: READ_PER_TOKEN,
            },
            Self::Slip => RouteBudgets {
                global: UPLOAD_GLOBAL,
                per_ip: SLIP_PER_IP,
                per_token: UPLOAD_ATTEMPTS_PER_TOKEN,
            },
        }
    }
}

struct RouteBudgets {
    global: (u32, u64),
    per_ip: (u32, u64),
    per_token: (u32, u64),
}

/// State for [`deposit_public_rate_limit`]: the app (for Redis and the
/// trusted-proxy list) and which route this layer sits on.
#[derive(Clone)]
pub struct DepositRateLimit {
    state: AppState,
    route: PublicDepositRoute,
    trusted: std::sync::Arc<TrustedProxies>,
}

impl DepositRateLimit {
    pub fn new(state: AppState, route: PublicDepositRoute) -> Self {
        // Parsed once at router build time rather than per request: the
        // list is a handful of CIDRs and never changes at runtime.
        let trusted = std::sync::Arc::new(TrustedProxies::parse(
            &state.config().security.trusted_proxies,
        ));
        Self {
            state,
            route,
            trusted,
        }
    }
}

/// What a caller is told when a budget could not be evaluated at all.
///
/// Thai first, English under it, and no mention of what broke — the
/// caller is a guest on a payment page, not an operator. `AppError`
/// returns the string verbatim as the response `message`.
const BUDGET_UNAVAILABLE_MESSAGE: &str = "ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่ / \
     Temporarily unavailable, please try again in a moment.";

/// Build a limiter whose Redis keys are namespaced for this deployment.
///
/// `security.rate_limit_namespace` is empty everywhere but the test
/// harness, so in production every replica shares one bucket per subject —
/// which is the only way a budget means what it says.
///
/// `fail_closed` decides what an unreachable Redis means for this layer.
/// See [`PublicDepositRoute::fails_closed`].
fn limiter(state: &AppState, key: &str, budget: (u32, u64), fail_closed: bool) -> RedisRateLimiter {
    let namespace = &state.config().security.rate_limit_namespace;
    let prefix = if namespace.is_empty() {
        key.to_string()
    } else {
        format!("{namespace}:{key}")
    };
    let limiter = RedisRateLimiter::new(
        state.redis(),
        RateLimitConfig::new(budget.0, budget.1),
        prefix,
    );
    if fail_closed {
        limiter.fail_closed()
    } else {
        limiter
    }
}

/// Turn a limiter refusal into the right status.
///
/// - Over budget → a 429 that tells the truth about *when* to come back.
///   `check_subject` has already computed the remaining TTL of the window
///   and hands it back on the error. Discarding it and answering with the
///   full window length instead tells a guest who hit the budget at minute
///   59 to wait an hour for a bucket that resets in a minute — and a
///   frontend that honours `Retry-After` will do exactly that.
/// - Budget unevaluable → 503 and the plain retry message. Only a
///   fail-closed layer ever produces this.
fn limiter_refusal(err: RateLimitError) -> AppError {
    match err {
        RateLimitError::TooManyRequests { retry_after } => {
            AppError::TooManyRequests(retry_after as u64)
        },
        RateLimitError::Unavailable => {
            AppError::ServiceUnavailable(BUDGET_UNAVAILABLE_MESSAGE.to_string())
        },
    }
}

/// The layered limiter for one public deposit route.
///
/// Runs before the handler and before the multipart body is read, so a
/// flood costs a Redis round trip rather than 10 MB of buffering.
///
/// **Charging order: per link, then per IP, then global** — narrowest
/// first, so a request a narrow bucket refuses never drains a wider one.
/// The reasoning is written out under "Why narrowest first" above; it is
/// the kind of order that looks arbitrary and is not.
///
/// A request with no usable token has no per-link bucket to be charged
/// against, and still pays the per-IP and global budgets: it reached a
/// public endpoint and cost us work, and skipping the charge would make
/// "send a junk header" the cheapest way to probe.
pub async fn deposit_public_rate_limit(
    State(guard): State<DepositRateLimit>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> AppResult<axum::response::Response> {
    let budgets = guard.route.budgets();
    let slug = guard.route.slug();
    let closed = guard.route.fails_closed();

    // 1. Per link — the narrowest thing we know about this caller.
    if let Ok(token) = token_from_headers(request.headers()) {
        limiter(
            &guard.state,
            &format!("deposit_token_{slug}"),
            budgets.per_token,
            closed,
        )
        .check_subject(&hex::encode(token_hash(&token)))
        .await
        .map_err(limiter_refusal)?;
    }

    // 2. Per client address.
    let client_ip = resolve_client_ip(peer_ip(&request), request.headers(), &guard.trusted);
    limiter(
        &guard.state,
        &format!("deposit_ip_{slug}"),
        budgets.per_ip,
        closed,
    )
    .check_subject(&client_ip.to_string())
    .await
    .map_err(limiter_refusal)?;

    // 3. The global bucket, last, so nothing already refused has spent it.
    limiter(&guard.state, "deposit_global", budgets.global, closed)
        .check_subject(guard.route.global_subject())
        .await
        .map_err(limiter_refusal)?;

    Ok(next.run(request).await)
}

/// Charge one **stored** slip against the strict per-link budget.
///
/// Called after the upload has validated and before a byte reaches disk.
/// Fail-closed for the same reason as the rest of the slip route: an
/// unevaluated budget here would let an unauthenticated caller write to
/// the storage volume without limit for as long as Redis is down.
async fn charge_stored_slip_budget(state: &AppState, token_hash_hex: &str) -> AppResult<()> {
    limiter(state, "deposit_upload_token", UPLOAD_PER_TOKEN, true)
        .check_subject(token_hash_hex)
        .await
        .map_err(limiter_refusal)
}

// ============================================================================
// DTOs
// ============================================================================

/// Everything the guest page renders, and nothing else.
///
/// Note what is absent: the guest's phone, the booking UUID, the link id,
/// any membership identifier, and the payer's bank details. The page is
/// reachable by anyone holding the token, so it carries the minimum that
/// lets the right person recognise their own booking.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositLinkPublicResponse {
    pub property: String,
    /// The guest's given name only — "สมชาย", not "สมชาย ใจดี".
    pub guest_given_name: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub nights: i64,
    pub room_type_name: Option<String>,
    pub total_amount: f64,
    pub amount_due_now: f64,
    pub currency: &'static str,
    /// Raw EMVCo PromptPay payload; the page renders the QR client-side.
    ///
    /// `null` once the link can no longer take a payment (`confirmed`,
    /// `expired`, `revoked`) — handing out a payable QR for a dead link is
    /// how a guest pays money nobody is expecting. Also `null` in the
    /// operational corner where the property has no receiving account
    /// configured; the create endpoint refuses to issue a link in that
    /// state, so it can only be reached by removing configuration under a
    /// live link.
    pub promptpay_qr_payload: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub state: &'static str,
    pub slipok_status: Option<String>,
    pub slipok_reason: Option<String>,
}

/// The answer to an upload. `state` is re-derived after the SlipOK check
/// has run, so a slip that auto-verifies comes back as `confirmed` in the
/// same response the upload returns — no refetch, no race with the poll.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositSlipUploadResponse {
    pub slip_id: Uuid,
    pub state: &'static str,
    pub slipok_status: Option<String>,
}

// ============================================================================
// Lookup
// ============================================================================

/// The link joined to its booking. Everything the two handlers need.
struct LinkRow {
    link_id: Uuid,
    booking_id: Uuid,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
    property: Option<String>,
    guest_name: Option<String>,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    total_price: Decimal,
    amount_due_now: Option<Decimal>,
    booking_status: String,
    room_type_name: Option<String>,
}

/// Find a link by the hash of its token.
///
/// An unknown token is a plain 404 carrying no detail — the *same* 404 a
/// missing or malformed header gets ([`not_found`]): the response must not
/// tell a scanner whether a token was well-formed, recently revoked or
/// never existed.
async fn find_link_by_token(db: &sqlx::PgPool, token: &str) -> AppResult<LinkRow> {
    let hash = token_hash(token);

    let row = sqlx::query!(
        r#"
        SELECT l.id                AS "link_id!",
               l.booking_id        AS "booking_id!",
               l.expires_at        AS "expires_at!",
               l.revoked_at,
               b.property,
               b.guest_name,
               b.check_in_date     AS "check_in_date!",
               b.check_out_date    AS "check_out_date!",
               b.total_price       AS "total_price!",
               b.amount_due_now,
               b.status            AS "booking_status!",
               rt.name             AS "room_type_name?"
        FROM booking_deposit_links l
        JOIN bookings b   ON b.id = l.booking_id
        LEFT JOIN room_types rt ON rt.id = b.room_type_id
        WHERE l.token_hash = $1
        "#,
        &hash,
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(not_found)?;

    Ok(LinkRow {
        link_id: row.link_id,
        booking_id: row.booking_id,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        property: row.property,
        guest_name: row.guest_name,
        check_in_date: row.check_in_date,
        check_out_date: row.check_out_date,
        total_price: row.total_price,
        amount_due_now: row.amount_due_now,
        booking_status: row.booking_status,
        room_type_name: row.room_type_name,
    })
}

/// The slips already attached to a booking, newest first.
///
/// Read as rows rather than aggregated in SQL because two different
/// questions are asked of them — "has any slip been verified" (state) and
/// "what does the newest one say" (the badge) — and a booking under a
/// deposit link carries a handful of slips at most.
async fn read_slip_facts(
    db: &sqlx::PgPool,
    booking_id: Uuid,
) -> AppResult<(SlipFacts, Option<String>, Option<String>)> {
    let rows = sqlx::query!(
        r#"
        SELECT admin_status, slipok_status, slipok_reason
        FROM booking_slips
        WHERE booking_id = $1
        ORDER BY uploaded_at DESC NULLS LAST, id DESC
        "#,
        booking_id,
    )
    .fetch_all(db)
    .await?;

    let facts = SlipFacts {
        any: !rows.is_empty(),
        any_verified: rows
            .iter()
            .any(|r| r.admin_status.as_deref() == Some("verified")),
    };
    let latest_status = rows.first().and_then(|r| r.slipok_status.clone());
    let latest_reason = rows.first().and_then(|r| r.slipok_reason.clone());

    Ok((facts, latest_status, latest_reason))
}

// ============================================================================
// Handlers
// ============================================================================

/// `GET /api/deposit`, token in `X-Deposit-Token`.
///
/// 200 for every *known* token, including an expired or revoked one: the
/// guest holding a dead link needs to be told to call the desk, and a 404
/// there would look like a broken page. 404 only when no link matches —
/// or when the header is absent or malformed, which is deliberately the
/// same answer.
async fn get_deposit_link(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<DepositLinkPublicResponse>> {
    let token = token_from_headers(&headers)?;
    let link = find_link_by_token(state.db(), &token).await?;
    let (slips, slipok_status, slipok_reason) =
        read_slip_facts(state.db(), link.booking_id).await?;

    let derived = derive_state(
        link.revoked_at,
        link.expires_at,
        &link.booking_status,
        slips,
        Utc::now(),
    );

    let amount_due_now = link.amount_due_now.unwrap_or(link.total_price);

    // Only mint a QR while the link can still take a payment.
    let promptpay_qr_payload = if matches!(derived, STATE_AWAITING_PAYMENT | STATE_CHECKING) {
        build_promptpay_payload(&state, link.property.as_deref(), amount_due_now)
    } else {
        None
    };

    // Opens are counted for the A9 shadow-window report and so reception
    // can tell "the guest never opened it" from "the guest opened it and
    // did nothing".
    //
    // A *session*, not a request. This page polls itself every 5 seconds
    // for two minutes after an upload and every 30 seconds after that, so
    // counting requests would score one guest who opened the link once and
    // paid at around thirty, and a page left open in a LINE in-app browser
    // tab at two a minute forever — a number that answers neither question
    // above. The 30-minute gate also means the one endpoint on this
    // service with no authentication at all stops writing to the database
    // on every read.
    //
    // Best-effort either way: a failed counter must never cost the guest
    // their page.
    if let Err(e) = sqlx::query!(
        r#"
        UPDATE booking_deposit_links
        SET open_count      = open_count + 1,
            first_opened_at = COALESCE(first_opened_at, NOW()),
            last_opened_at  = NOW()
        WHERE id = $1
          AND (last_opened_at IS NULL OR last_opened_at < NOW() - INTERVAL '30 minutes')
        "#,
        link.link_id,
    )
    .execute(state.db())
    .await
    {
        tracing::warn!(
            link_id = %link.link_id,
            error = %e,
            "failed to record a deposit-link open"
        );
    }

    Ok(Json(DepositLinkPublicResponse {
        property: link.property.clone().unwrap_or_default(),
        guest_given_name: given_name(link.guest_name.as_deref()),
        check_in: link.check_in_date,
        check_out: link.check_out_date,
        nights: (link.check_out_date - link.check_in_date).num_days(),
        room_type_name: link.room_type_name,
        total_amount: link.total_price.to_f64().unwrap_or(0.0),
        amount_due_now: amount_due_now.to_f64().unwrap_or(0.0),
        currency: "THB",
        promptpay_qr_payload,
        expires_at: link.expires_at,
        state: derived,
        slipok_status,
        slipok_reason,
    }))
}

/// `POST /api/deposit/slip`, token in `X-Deposit-Token`.
///
/// Multipart, field `file` (or `slip`), JPEG or PNG, 10 MB.
///
/// An **expired** link still accepts an upload. The guest transferred the
/// money; refusing the image would leave them with a payment and nowhere
/// to show it. The slip lands in the manual queue on its own, because
/// `slipok_check` already refuses to auto-confirm a booking whose
/// `hold_expires_at` has passed (`booking_not_payable`) — the same branch
/// the PMS channel uses.
///
/// A **revoked** link does not: revocation is reception saying "not this
/// link", and the reissued one is where the slip belongs.
async fn upload_deposit_slip(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<DepositSlipUploadResponse>)> {
    let token = token_from_headers(&headers)?;
    let link = find_link_by_token(state.db(), &token).await?;
    let token_hash_hex = hex::encode(token_hash(&token));

    // Revocation first, and before any budget: reception saying "not this
    // link" is a 409 the guest can do nothing about, and it must not cost
    // them one of the five slips they are allowed to show.
    if link.revoked_at.is_some() {
        return Err(AppError::Conflict(
            "This payment link is no longer active".to_string(),
        ));
    }

    // The global, per-IP and per-link *attempt* budgets were charged by
    // `deposit_public_rate_limit` before the body was read, so a flood
    // costs a Redis round trip rather than 10 MB of buffering.

    // Read and validate through the same code `POST /api/slips/upload`
    // uses: same 10 MB cap, same JPEG/PNG magic-byte check. Everything it
    // rejects — wrong format, oversize, truncated body — is rejected
    // before the strict budget below is touched, so a guest who picks the
    // wrong file out of their gallery is not charged for it.
    let slip = crate::routes::slips::read_slip_upload(multipart).await?;

    // Budget, then storage — never the other way round. Storage is a
    // shared disk with a retention job over it and this endpoint has no
    // authentication, so a caller over the budget must leave nothing
    // behind. Writing first and counting second would let a token holder
    // fill the volume five slips at a time and get a 429 for their
    // trouble.
    charge_stored_slip_budget(&state, &token_hash_hex).await?;

    // Same target as the authenticated path (`STORAGE_PATH/slips/<uuid>`),
    // so F2's retention and access logging cover this with no special
    // case.
    let slip_bytes = slip.len();
    let slip_url = crate::routes::slips::write_slip_to_storage(&slip).await?;

    let mut tx = state.db().begin().await?;
    let slip = crate::routes::bookings::insert_booking_slip_tx(
        &mut tx,
        link.booking_id,
        &slip_url,
        DEPOSIT_LINK_SYSTEM_USER_ID,
    )
    .await?;
    tx.commit().await?;

    tracing::info!(
        link_id = %link.link_id,
        booking_id = %link.booking_id,
        slip_id = %slip.id,
        bytes = slip_bytes,
        "deposit-link slip uploaded"
    );

    // Identical to the authenticated path: run the check inline under one
    // explicit budget so the decision is already stored when this response
    // returns, and swallow a blown budget into a WARN — the slip is then
    // exactly where it was before this feature existed, in the admin queue.
    let budget = crate::routes::bookings::slipok_check_budget(&state);
    let notify_event = match tokio::time::timeout(
        budget,
        crate::routes::bookings::run_slipok_check(&state, slip.id, link.booking_id, &slip_url),
    )
    .await
    {
        Ok(event) => event,
        Err(_) => {
            tracing::warn!(
                slip_id = %slip.id,
                booking_id = %link.booking_id,
                budget_secs = budget.as_secs(),
                "SlipOK check exceeded its latency budget; slip left for manual verification"
            );
            None
        },
    };

    // Outside the budget, for the reason the authenticated path spells out:
    // `notify` claims the event before it spawns the send, so a deadline
    // landing between the claim and the spawn would leave a claimed event
    // nobody ever sends. Out here it races nothing.
    if let Some(event) = notify_event {
        crate::services::booking_notify::notify(&state, link.booking_id, event).await;
    }

    // Re-read: the check above may have verified the slip and flipped the
    // booking, and the guest should see that in this response rather than
    // on the next poll.
    let booking_status: String =
        sqlx::query_scalar!("SELECT status FROM bookings WHERE id = $1", link.booking_id)
            .fetch_one(state.db())
            .await?;
    let (slips, slipok_status, _) = read_slip_facts(state.db(), link.booking_id).await?;

    let derived = derive_state(
        link.revoked_at,
        link.expires_at,
        &booking_status,
        slips,
        Utc::now(),
    );

    Ok((
        StatusCode::CREATED,
        Json(DepositSlipUploadResponse {
            slip_id: slip.id,
            state: derived,
            slipok_status,
        }),
    ))
}

// ============================================================================
// Helpers
// ============================================================================

/// The PromptPay payload for a property, built the way
/// `create_channel_booking` builds it.
///
/// Deliberately **not** `GET /api/payments/promptpay-qr`: that endpoint
/// builds the QR from the group-wide `PROMPTPAY_TAX_ID`, while the matcher
/// compares the payee against `id_for_property(property)`. A QR from the
/// wrong account means every slip comes back `receiver_mismatch`.
pub(crate) fn build_promptpay_payload(
    state: &AppState,
    property: Option<&str>,
    amount: Decimal,
) -> Option<String> {
    let receiving_id = property
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .and_then(|p| state.config().promptpay.id_for_property(p))
        .cloned()?;

    let amount = amount.to_f64()?;

    match PromptPayService::new(receiving_id).and_then(|s| s.generate_payload(amount)) {
        Ok(payload) => Some(payload),
        Err(e) => {
            tracing::warn!(
                property = property.unwrap_or("unknown"),
                error = %e,
                "could not build a PromptPay payload for a deposit link"
            );
            None
        },
    }
}

/// First whitespace-separated token of the stored guest name.
///
/// Reception types a full name; the page shows only enough for the right
/// person to recognise their own booking. Anyone who opens the link
/// already holds the token, but a link forwarded into a group chat should
/// not publish a full name to it.
fn given_name(guest_name: Option<&str>) -> String {
    guest_name
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string()
}

// ============================================================================
// Router
// ============================================================================

/// Public deposit-link routes, mounted at `/api/deposit` with **no auth
/// middleware** — that is the whole design (see the module docs).
///
/// Neither route has a path parameter, and neither ever had one: the
/// token travels in `X-Deposit-Token`, so `/api/deposit` and
/// `/api/deposit/slip` are the complete URLs and there is nothing in them
/// worth logging or leaking. Adding a `/:token` variant "for convenience"
/// would undo the module's central decision.
///
/// The limiter is layered per route (rather than once over the sub-router)
/// because the read and the upload have different budgets and different
/// global buckets. `from_fn_with_state` here takes [`DepositRateLimit`],
/// not `AppState`, so the trusted-proxy list is parsed once at build time.
pub fn routes(state: AppState) -> Router<AppState> {
    // One sub-router per route so each gets its own budgets, merged at the
    // end. `route_layer` rather than `layer`: the limiter runs only for a
    // request that actually matched one of these two routes, so a 404 on
    // `/api/deposit/anything-else` costs no Redis round trip.
    let read = Router::new().route("/", get(get_deposit_link)).route_layer(
        axum::middleware::from_fn_with_state(
            DepositRateLimit::new(state.clone(), PublicDepositRoute::Read),
            deposit_public_rate_limit,
        ),
    );

    let slip = Router::new()
        .route(
            "/slip",
            post(upload_deposit_slip)
                // Same per-route body cap as `POST /api/slips/upload`, for
                // the same reason: reject oversize bodies at the
                // body-extraction layer rather than buffering them first.
                .layer(DefaultBodyLimit::max(
                    crate::routes::slips::SLIP_UPLOAD_BODY_LIMIT_BYTES,
                )),
        )
        .route_layer(axum::middleware::from_fn_with_state(
            DepositRateLimit::new(state, PublicDepositRoute::Slip),
            deposit_public_rate_limit,
        ));

    read.merge(slip)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(mins: i64) -> DateTime<Utc> {
        Utc::now() + chrono::Duration::minutes(mins)
    }

    #[test]
    fn deposit_link_system_user_id_is_the_locked_value() {
        // The migration seeds this literal and the cross-repo interface
        // names it. A typo here would break the FK on `bookings.user_id`
        // for every link issued.
        assert_eq!(
            DEPOSIT_LINK_SYSTEM_USER_ID.hyphenated().to_string(),
            "00000000-0000-4000-8000-0000005110b2"
        );
    }

    #[test]
    fn token_is_43_url_safe_characters_and_never_repeats() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 43, "32 bytes base64url without padding");
        assert_ne!(a, b);
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "token must be URL-safe with no padding: {a}"
        );
    }

    #[test]
    fn token_hash_is_sha256_and_stable() {
        let token = "not-a-real-token";
        assert_eq!(token_hash(token).len(), 32);
        assert_eq!(token_hash(token), token_hash(token));
        assert_ne!(token_hash(token), token_hash("not-a-real-token2"));
    }

    #[test]
    fn revoked_wins_over_everything() {
        assert_eq!(
            derive_state(
                Some(ts(-10)),
                ts(60),
                "pending",
                SlipFacts::default(),
                Utc::now()
            ),
            STATE_REVOKED
        );
    }

    #[test]
    fn expiry_defers_to_a_verified_slip() {
        let past = ts(-60);
        // Expired with nothing verified: expired.
        assert_eq!(
            derive_state(None, past, "pending", SlipFacts::default(), Utc::now()),
            STATE_EXPIRED
        );
        // Expired but the guest already paid and it verified: confirmed.
        assert_eq!(
            derive_state(
                None,
                past,
                "pending",
                SlipFacts {
                    any: true,
                    any_verified: true
                },
                Utc::now()
            ),
            STATE_CONFIRMED
        );
    }

    #[test]
    fn a_slip_that_has_not_verified_reads_as_checking() {
        assert_eq!(
            derive_state(
                None,
                ts(60),
                "pending",
                SlipFacts {
                    any: true,
                    any_verified: false
                },
                Utc::now()
            ),
            STATE_CHECKING,
            "every non-verified status collapses onto `checking` — a guest \
             never sees a vendor verdict"
        );
    }

    #[test]
    fn a_confirmed_booking_reads_confirmed_even_with_no_slip_row() {
        // The admin can confirm a booking from the desk without the slip
        // ever landing here.
        assert_eq!(
            derive_state(None, ts(60), "confirmed", SlipFacts::default(), Utc::now()),
            STATE_CONFIRMED
        );
    }

    #[test]
    fn a_live_untouched_link_awaits_payment() {
        assert_eq!(
            derive_state(None, ts(60), "pending", SlipFacts::default(), Utc::now()),
            STATE_AWAITING_PAYMENT
        );
    }

    #[test]
    fn given_name_takes_the_first_token_only() {
        assert_eq!(given_name(Some("สมชาย ใจดี")), "สมชาย");
        assert_eq!(given_name(Some("  Somchai  Jaidee ")), "Somchai");
        assert_eq!(given_name(Some("Somchai")), "Somchai");
        assert_eq!(given_name(None), "");
        assert_eq!(given_name(Some("   ")), "");
    }
}
