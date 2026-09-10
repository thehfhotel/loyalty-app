//! Booking notification email — "a guest is coming", to the property's desk
//!
//! Spec: `hf-tasks/tasks/direct-booking-designs/b0-booking-email-spec.md`.
//!
//! One short message lands in the property's own mailbox when a booking is
//! created, and again when its deposit is verified. Reception reads it and
//! knows to expect someone. **The guest is never a recipient here** — the
//! guest-facing confirmation is a separate task (S4).
//!
//! ## Shape of the thing
//!
//! * [`notify`] is the call site's entry point: infallible, fire-and-forget,
//!   and safe to call from a handler that has already decided its response.
//!   It claims the event, renders the message, then `tokio::spawn`s the send.
//! * [`notify_with_service`] is the same work **awaited**, against a caller
//!   supplied [`EmailService`]. That is the test seam the spec asks for: the
//!   integration tests drive a recording fake through it rather than an SMTP
//!   substitute, because the trait is already the boundary and a fake relay
//!   would test `lettre`, not us.
//!
//! ## What is never in the message
//!
//! The slip image or any link to it, the payer's bank, account number or
//! account name, the guest's LINE user id, the guest's email, any raw
//! response from the verification service — and no vendor name anywhere.
//!
//! The guest's phone number **is** included, in full. The single job of this
//! email is that reception can call the guest back, and a masked phone cannot
//! be dialled. The mailbox belongs to the property, which already holds the
//! same number in the PMS and sees it at check-in. Masking stays the rule for
//! logs and for every address that is not the property's own mailbox: log
//! lines here carry `hash_email` and never the recipient in clear.
//!
//! ## Claim discipline
//!
//! A row in `booking_notify_log` means "the desk has been told about this
//! event". Nothing is claimed until there is a relay to send it through, and a
//! claim whose send never happened is handed back: a wrong row in that table
//! is a guest nobody is ever told about, with no queue and no retry behind it.
//!
//! Each *decision* claims its own key. In shadow mode — the configuration
//! production runs — a good slip passes automatically and an admin confirms it
//! afterwards, and the desk needs both messages, so `deposit_shadow_pass:` and
//! `deposit_verified:` are separate events on the same slip.
//!
//! ## Volume
//!
//! The relay here is the same account that sends password resets and
//! verification codes, and both property mailboxes are ordinary Gmail
//! addresses on a shared daily quota. [`MAX_SENDS_PER_RECIPIENT_PER_HOUR`]
//! bounds what a booking-create loop can spend of it.
//!
//! ## sqlx note
//!
//! Runtime `sqlx::query`/`query_as` rather than the compile-time macros, the
//! same choice (and for the same reason) as `routes::admin_slips::get_slip`
//! and `routes::bookings::record_slipok_result`: `booking_notify_log` is new
//! in migration `20260912000000_booking_notify_log.sql`, and a runtime query
//! needs no `.sqlx/` offline-cache entry and cannot go stale against one.

use std::time::Duration;

use axum_prometheus::metrics::counter;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use sqlx::{FromRow, PgPool};
use tracing::{info, warn};
use uuid::Uuid;

use crate::config::Settings;
use crate::error::AppError;
use crate::services::email::{EmailService, EmailServiceImpl};
use crate::state::AppState;
use crate::utils::hash_email;

/// `booking_notify_sends_total{event,property,outcome}` — beside the existing
/// email counters, so an operator can see at a glance whether the desk is
/// actually being told about arrivals.
///
/// `outcome` is one of `sent`, `failed`, `skipped_no_recipient`,
/// `skipped_unconfigured`, `skipped_duplicate`, `skipped_rate_limited`.
const BOOKING_NOTIFY_SENDS_TOTAL: &str = "booking_notify_sends_total";

/// One line, so every outcome is counted the same way and the label set stays
/// closed (both label values are `&'static str` by construction).
fn count(event: &'static str, property: &'static str, outcome: &'static str) {
    counter!(
        BOOKING_NOTIFY_SENDS_TOTAL,
        "event" => event,
        "property" => property,
        "outcome" => outcome
    )
    .increment(1);
}

/// Ceiling on how many of these messages one mailbox may receive in an hour.
///
/// The relay behind this is the same account that sends password resets and
/// verification codes, and both property mailboxes are ordinary Gmail
/// addresses with a shared daily quota. A client looping `POST /api/bookings`
/// (or retrying without an `Idempotency-Key`, which mints a new booking id and
/// therefore a new dedup key every time) would otherwise be able to spend that
/// quota and take account recovery down with it. Sixty an hour is far above
/// any real day at either desk and far below anything that threatens the
/// relay; hitting it is counted `skipped_rate_limited` and logged at WARN with
/// a greppable marker, because it means reception is missing arrivals.
const MAX_SENDS_PER_RECIPIENT_PER_HOUR: i64 = 60;

/// How long to wait before the single retry. One retry, then give up: there
/// is no queue behind this, and a message reception gets an hour late is not
/// worth a delivery system.
const RETRY_DELAY: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// What happened to the booking. The variant decides the subject line, the
/// status line, and the dedup key.
///
/// This is the B1 hook: a deposit-link booking calls
/// `notify(state, booking_id, BookingNotifyEvent::BookingCreated)` from its
/// create handler, exactly as the two booking handlers here do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookingNotifyEvent {
    /// A booking now exists and the desk should expect the guest. Fired by
    /// every create path — in-app, PMS channel, and (B1) deposit link.
    BookingCreated,
    /// The deposit slip `slip_id` was accepted: an admin pressed Verify, or
    /// the automatic path confirmed it outright. Keyed on the slip rather than
    /// the booking so a second slip against the same booking is still
    /// reported.
    DepositVerified { slip_id: Uuid },
    /// The machine passed slip `slip_id` while shadow mode is on: the money
    /// looks right, but a human still has to confirm it.
    ///
    /// Deliberately a **separate** event from [`Self::DepositVerified`], with
    /// its own dedup key. In shadow mode — which is the configuration
    /// production actually runs, `SLIPOK_AUTO_VERIFY` being unset — both
    /// things happen to the same slip, and the desk needs both messages: "a
    /// deposit landed, we are checking it", and later "it is confirmed". One
    /// shared key would have let the first message swallow the second and the
    /// confirmation would never arrive.
    DepositShadowPass { slip_id: Uuid },
}

impl BookingNotifyEvent {
    /// The `booking_notify_log` primary key for this event.
    fn event_key(&self, booking_id: Uuid) -> String {
        match self {
            Self::BookingCreated => format!("booking_created:{}", booking_id),
            Self::DepositVerified { slip_id } => format!("deposit_verified:{}", slip_id),
            Self::DepositShadowPass { slip_id } => format!("deposit_shadow_pass:{}", slip_id),
        }
    }

    /// The slip this event is about, if it is about one.
    fn slip_id(&self) -> Option<Uuid> {
        match self {
            Self::BookingCreated => None,
            Self::DepositVerified { slip_id } | Self::DepositShadowPass { slip_id } => {
                Some(*slip_id)
            },
        }
    }

    /// True for every event that reports money arriving against the booking.
    fn is_deposit(&self) -> bool {
        self.slip_id().is_some()
    }

    /// Metric label / log field.
    fn label(&self) -> &'static str {
        match self {
            Self::BookingCreated => "booking_created",
            Self::DepositVerified { .. } => "deposit_verified",
            Self::DepositShadowPass { .. } => "deposit_shadow_pass",
        }
    }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Tell the property's desk about `event` on `booking_id`. Never fails, never
/// blocks the caller on SMTP.
///
/// Not configured is a normal state, not an error: a property with no mailbox
/// (or a stack with no SMTP at all) logs once at info and returns.
pub async fn notify(state: &AppState, booking_id: Uuid, event: BookingNotifyEvent) {
    let email = EmailServiceImpl::from_smtp_config(
        &state.config().email.smtp,
        &state.config().server.frontend_url,
    );

    // Before anything is claimed. A claim is a promise that the message went
    // out, and a stack with no relay cannot keep it: claiming first would burn
    // the event permanently and leave the booking silent even after SMTP is
    // fixed — which is exactly the shape of the rollout, mailboxes set as
    // repository variables while the relay secrets land separately.
    if !email.is_configured() {
        count(event.label(), property_label(None), "skipped_unconfigured");
        info!(
            booking_id = %booking_id,
            event = event.label(),
            "SMTP not configured; booking notification not sent"
        );
        return;
    }

    let prepared = match prepare(state.db(), state.config(), booking_id, event).await {
        Ok(Some(prepared)) => prepared,
        Ok(None) => return,
        Err(e) => {
            // A booking must never fail because reception could not be told.
            warn!(
                booking_id = %booking_id,
                event = event.label(),
                error = %e,
                "booking notification could not be prepared; nothing was sent"
            );
            return;
        },
    };

    // Fire and forget: the handler's own response is already decided.
    let db = state.db().clone();
    tokio::spawn(async move {
        deliver(&db, &email, &prepared, RETRY_DELAY).await;
    });
}

/// [`notify`], awaited, against a caller-supplied service and retry delay.
///
/// The integration tests use this with a recording fake so a send is
/// observable without an SMTP server and without a 30-second sleep. Callers
/// in `routes/` should use [`notify`].
pub async fn notify_with_service(
    db: &PgPool,
    config: &Settings,
    email: &dyn EmailService,
    booking_id: Uuid,
    event: BookingNotifyEvent,
    retry_delay: Duration,
) {
    if !email.is_configured() {
        count(event.label(), property_label(None), "skipped_unconfigured");
        info!(
            booking_id = %booking_id,
            event = event.label(),
            "SMTP not configured; booking notification not sent"
        );
        return;
    }

    match prepare(db, config, booking_id, event).await {
        Ok(Some(prepared)) => deliver(db, email, &prepared, retry_delay).await,
        Ok(None) => {},
        Err(e) => warn!(
            booking_id = %booking_id,
            event = event.label(),
            error = %e,
            "booking notification could not be prepared; nothing was sent"
        ),
    }
}

// ---------------------------------------------------------------------------
// Prepare: claim the event and render the message
// ---------------------------------------------------------------------------

/// A message that has been claimed in `booking_notify_log` and rendered.
#[derive(Debug, Clone)]
pub struct PreparedNotification {
    booking_id: Uuid,
    /// The row this notification holds in `booking_notify_log`. Kept so a
    /// send that never happened can hand the event back (see [`deliver`]).
    event_key: String,
    event: &'static str,
    property: &'static str,
    recipient: String,
    subject: String,
    html_body: String,
}

impl PreparedNotification {
    /// The rendered HTML. Exposed so a test can assert on what would be sent
    /// without an email service at all.
    pub fn html_body(&self) -> &str {
        &self.html_body
    }

    /// The rendered subject line.
    pub fn subject(&self) -> &str {
        &self.subject
    }
}

/// `Ok(None)` means "nothing to send, and that is fine": no mailbox for this
/// property, or another attempt already claimed this event.
async fn prepare(
    db: &PgPool,
    config: &Settings,
    booking_id: Uuid,
    event: BookingNotifyEvent,
) -> Result<Option<PreparedNotification>, AppError> {
    // Cheapest check first. Both mailboxes are unset until the owner sets the
    // repository variables, and a feature that is entirely off must not cost a
    // two-join read of the booking on the guest's request path.
    if !config.booking_notify.is_configured() {
        count(event.label(), property_label(None), "skipped_unconfigured");
        return Ok(None);
    }

    let facts = match load_booking(db, booking_id).await? {
        Some(facts) => facts,
        None => {
            warn!(
                booking_id = %booking_id,
                event = event.label(),
                "booking notification skipped: booking not found"
            );
            return Ok(None);
        },
    };

    // `create_booking` (in-app) sets no property yet. Rather than invent one,
    // the message goes to HF Ville and says so in the body.
    let property = facts
        .property
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let routed_to = property.unwrap_or(PROPERTY_HFVILLE);

    let Some(recipient) = config.booking_notify.recipient_for(routed_to) else {
        count(
            event.label(),
            property_label(property),
            "skipped_no_recipient",
        );
        info!(
            booking_id = %booking_id,
            event = event.label(),
            property = routed_to,
            "booking notification not configured for this property; nothing sent"
        );
        return Ok(None);
    };
    let recipient = recipient.to_string();

    // The decision the desk needs to read in the status line. Only a deposit
    // event has a slip to describe.
    let slip = match event.slip_id() {
        Some(slip_id) => load_slip(db, slip_id).await?,
        None => None,
    };

    // Volume cap, before the claim: a mailbox that is already being hammered
    // must not have more work queued against a relay it shares with password
    // resets and verification codes.
    if recent_sends(db, &recipient).await? >= MAX_SENDS_PER_RECIPIENT_PER_HOUR {
        count(
            event.label(),
            property_label(property),
            "skipped_rate_limited",
        );
        warn!(
            booking_id = %booking_id,
            event = event.label(),
            recipient_hash = %hash_email(&recipient),
            cap = MAX_SENDS_PER_RECIPIENT_PER_HOUR,
            "BOOKING_NOTIFY_RATE_LIMITED: hourly cap for this mailbox reached; \
             reception was not told about this booking"
        );
        return Ok(None);
    }

    // Claim the event *before* anything is spawned, so a retry, an
    // idempotent replay of the create request, or a second press of Verify
    // finds the row already taken and stays quiet.
    let event_key = event.event_key(booking_id);
    let claimed = claim_event(db, &event_key, booking_id, &recipient).await?;
    if !claimed {
        count(event.label(), property_label(property), "skipped_duplicate");
        info!(
            booking_id = %booking_id,
            event = event.label(),
            "booking notification already sent for this event; skipping"
        );
        return Ok(None);
    }

    let rendered = render(config, booking_id, event, &facts, property, slip.as_ref());

    Ok(Some(PreparedNotification {
        booking_id,
        event_key,
        event: event.label(),
        property: property_label(property),
        recipient,
        subject: rendered.subject,
        html_body: rendered.html_body,
    }))
}

/// `INSERT ... ON CONFLICT DO NOTHING`; `true` when this call won the event.
async fn claim_event(
    db: &PgPool,
    event_key: &str,
    booking_id: Uuid,
    recipient: &str,
) -> Result<bool, AppError> {
    let result = sqlx::query(
        r#"
        INSERT INTO booking_notify_log (event_key, booking_id, recipient)
        VALUES ($1, $2, $3)
        ON CONFLICT (event_key) DO NOTHING
        "#,
    )
    .bind(event_key)
    .bind(booking_id)
    .bind(recipient)
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Hand the event back, so a later trigger (or a hand-run replay) can still
/// reach the desk. Called only when nothing was sent: a claim that outlives a
/// failed send is a permanent lie about a guest who is coming.
async fn release_claim(db: &PgPool, event_key: &str) {
    if let Err(e) = sqlx::query("DELETE FROM booking_notify_log WHERE event_key = $1")
        .bind(event_key)
        .execute(db)
        .await
    {
        warn!(
            event_key = event_key,
            error = %e,
            "booking notification claim could not be released; this event will not be retried"
        );
    }
}

/// How many of these messages this mailbox has been sent in the last hour.
///
/// Counts claims rather than deliveries, which is the conservative direction:
/// a claim exists from the moment we decide to send, and a claim that failed
/// is released, so the number never over-counts a mailbox into silence.
async fn recent_sends(db: &PgPool, recipient: &str) -> Result<i64, AppError> {
    let sent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM booking_notify_log \
         WHERE recipient = $1 AND sent_at > NOW() - INTERVAL '1 hour'",
    )
    .bind(recipient)
    .fetch_one(db)
    .await?;

    Ok(sent)
}

// ---------------------------------------------------------------------------
// Deliver
// ---------------------------------------------------------------------------

/// Send, with exactly one retry on failure. Errors are logged, never
/// propagated — by the time this runs the guest already has their response.
async fn deliver(
    db: &PgPool,
    email: &dyn EmailService,
    prepared: &PreparedNotification,
    retry_delay: Duration,
) {
    // Both entry points check this before claiming; this is the belt to that
    // pair of braces. Either way the claim goes back.
    if !email.is_configured() {
        count(prepared.event, prepared.property, "skipped_unconfigured");
        info!(
            booking_id = %prepared.booking_id,
            event = prepared.event,
            "SMTP not configured; booking notification not sent"
        );
        release_claim(db, &prepared.event_key).await;
        return;
    }

    let first = email
        .send_email(&prepared.recipient, &prepared.subject, &prepared.html_body)
        .await;

    let outcome = match first {
        Ok(()) => Ok(()),
        Err(e) => {
            warn!(
                booking_id = %prepared.booking_id,
                event = prepared.event,
                recipient_hash = %hash_email(&prepared.recipient),
                error = %e,
                "booking notification failed; retrying once"
            );
            tokio::time::sleep(retry_delay).await;
            email
                .send_email(&prepared.recipient, &prepared.subject, &prepared.html_body)
                .await
        },
    };

    match outcome {
        Ok(()) => {
            count(prepared.event, prepared.property, "sent");
            info!(
                booking_id = %prepared.booking_id,
                event = prepared.event,
                recipient_hash = %hash_email(&prepared.recipient),
                "booking notification sent"
            );
        },
        Err(e) => {
            count(prepared.event, prepared.property, "failed");
            // ERROR, not WARN: the desk has been told nothing about a guest
            // who is coming, and nothing will retry after this.
            tracing::error!(
                booking_id = %prepared.booking_id,
                event = prepared.event,
                recipient_hash = %hash_email(&prepared.recipient),
                error = %e,
                "BOOKING_NOTIFY_FAILED: reception was not told about this booking"
            );
            // Nothing went out, so nothing is claimed: a later trigger on the
            // same booking (an admin verify after a failed create notice, or a
            // hand-run replay) must still be able to reach the desk.
            release_claim(db, &prepared.event_key).await;
        },
    }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const PROPERTY_HF: &str = "hf";
const PROPERTY_HFVILLE: &str = "hfville";

/// Everything the message names, in one read.
///
/// `guest_name`/`guest_phone` fall back to the member's own profile: a
/// channel booking carries the guest's details on the booking row, but an
/// in-app booking has only the member behind it.
#[derive(Debug, Clone, FromRow)]
struct BookingFacts {
    property: Option<String>,
    guest_name: Option<String>,
    guest_phone: Option<String>,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    num_guests: i32,
    total_price: Decimal,
    amount_due_now: Option<Decimal>,
    balance_due: Option<Decimal>,
    room_type: Option<String>,
    /// `deposit50` | `full` (`routes::bookings` validates the pair). A `full`
    /// booking has already paid everything, and must not be announced to the
    /// desk as a deposit with a zero balance under it.
    payment_option: Option<String>,
}

async fn load_booking(db: &PgPool, booking_id: Uuid) -> Result<Option<BookingFacts>, AppError> {
    let facts = sqlx::query_as::<_, BookingFacts>(
        r#"
        SELECT
            b.property,
            COALESCE(
                NULLIF(TRIM(b.guest_name), ''),
                NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')
            )                                              AS guest_name,
            COALESCE(NULLIF(TRIM(b.guest_phone), ''), NULLIF(TRIM(p.phone), ''))
                                                           AS guest_phone,
            b.check_in_date,
            b.check_out_date,
            b.num_guests,
            b.total_price,
            b.amount_due_now,
            b.balance_due,
            COALESCE(rt.name, b.pms_room_type_id)          AS room_type,
            b.payment_option
        FROM bookings b
        LEFT JOIN user_profiles p ON p.user_id = b.user_id
        LEFT JOIN room_types rt   ON rt.id = b.room_type_id
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(db)
    .await?;

    Ok(facts)
}

/// The machine's decision about one slip, as the status line reports it.
#[derive(Debug, Clone, FromRow)]
struct SlipDecisionRow {
    slipok_status: Option<String>,
    slipok_reason: Option<String>,
}

async fn load_slip(db: &PgPool, slip_id: Uuid) -> Result<Option<SlipDecisionRow>, AppError> {
    let row = sqlx::query_as::<_, SlipDecisionRow>(
        "SELECT slipok_status, slipok_reason FROM booking_slips WHERE id = $1",
    )
    .bind(slip_id)
    .fetch_optional(db)
    .await?;

    Ok(row)
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

struct RenderedMessage {
    subject: String,
    html_body: String,
}

/// Thai month abbreviations, indexed by `month() - 1`.
const THAI_MONTH_ABBR: [&str; 12] = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
];

/// Locked `payment.slipok.status.*` wording (PR #404), Thai then English.
fn status_wording(status: &str) -> (&'static str, &'static str) {
    match status {
        "verified" => ("ยืนยันแล้ว", "Confirmed"),
        "pending" | "shadow_pass" | "manual" | "unavailable" => ("กำลังตรวจสอบ", "Being checked"),
        _ => ("กำลังตรวจสอบ", "Being checked"),
    }
}

/// Locked `payment.slipok.reason.*` wording (PR #404), Thai then English.
fn reason_wording(reason: &str) -> Option<(&'static str, &'static str)> {
    Some(match reason {
        "amount_mismatch" => (
            "ยอดโอนไม่ตรงกับยอดที่ต้องชำระ",
            "Transferred amount does not match the booking",
        ),
        "receiver_mismatch" => (
            "โอนเข้าบัญชีอื่น ไม่ใช่บัญชีของโรงแรม",
            "Transferred to a different account",
        ),
        "duplicate" => ("สลิปนี้ถูกใช้ไปแล้ว", "This slip has already been used"),
        "slip_invalid" => ("อ่านข้อมูลจากสลิปไม่ได้", "The slip could not be read"),
        "booking_not_payable" => (
            "การจองนี้ยังรับชำระเงินไม่ได้ในตอนนี้",
            "This booking cannot take a payment right now",
        ),
        "confirm_failed" => (
            "บันทึกผลการตรวจสอบไม่สำเร็จ",
            "The check result could not be saved",
        ),
        "quota_exceeded" => (
            "โควตาการตรวจสอบอัตโนมัติหมดแล้ว",
            "Automatic checking quota is used up",
        ),
        "api_error" => (
            "ระบบตรวจสอบอัตโนมัติแจ้งข้อผิดพลาด",
            "The checking service returned an error",
        ),
        "not_configured" => (
            "ยังไม่ได้ตั้งค่าการตรวจสอบอัตโนมัติ",
            "Automatic checking is not set up",
        ),
        "timeout" => (
            "ระบบตรวจสอบอัตโนมัติไม่ตอบกลับในเวลาที่กำหนด",
            "The check did not answer in time",
        ),
        _ => return None,
    })
}

/// Display name of a property, for the subject tag and the property line.
///
/// A booking with no property falls back to HF Ville because that is the
/// mailbox it is routed to — the tag has to name the desk actually reading
/// the message. The body line then says the property is not set, so nobody
/// reads the tag as a claim about where the guest is staying.
fn property_name(property: Option<&str>) -> &'static str {
    match property {
        Some(PROPERTY_HF) => "HF",
        _ => "HF Ville",
    }
}

/// Metric label for a property, bounded so the counter's cardinality is.
fn property_label(property: Option<&str>) -> &'static str {
    match property {
        Some(PROPERTY_HF) => PROPERTY_HF,
        Some(PROPERTY_HFVILLE) => PROPERTY_HFVILLE,
        _ => "unset",
    }
}

fn thai_date(date: NaiveDate) -> String {
    format!(
        "{} {}",
        date.day(),
        THAI_MONTH_ABBR[(date.month() - 1) as usize]
    )
}

/// `12-14 ต.ค.` within one month, `28 ก.ย.-2 ต.ค.` across two.
fn thai_date_range(check_in: NaiveDate, check_out: NaiveDate) -> String {
    if check_in.year() == check_out.year() && check_in.month() == check_out.month() {
        format!(
            "{}-{} {}",
            check_in.day(),
            check_out.day(),
            THAI_MONTH_ABBR[(check_in.month() - 1) as usize]
        )
    } else {
        format!("{}-{}", thai_date(check_in), thai_date(check_out))
    }
}

/// `฿4,400` — grouped, and without a `.00` nobody needs to read.
fn format_baht(amount: Decimal) -> String {
    let rounded = amount.round_dp(2);
    let negative = rounded < Decimal::ZERO;
    let magnitude = if negative { -rounded } else { rounded };

    let text = if magnitude.fract() == Decimal::ZERO {
        format!("{:.0}", magnitude)
    } else {
        format!("{:.2}", magnitude)
    };

    let (integer, fraction) = match text.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (text.as_str(), None),
    };

    let mut grouped = String::new();
    for (index, ch) in integer.chars().enumerate() {
        if index > 0 && (integer.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }

    match (negative, fraction) {
        (false, None) => format!("฿{}", grouped),
        (false, Some(f)) => format!("฿{}.{}", grouped, f),
        (true, None) => format!("-฿{}", grouped),
        (true, Some(f)) => format!("-฿{}.{}", grouped, f),
    }
}

/// The deposit the guest owes now: what they were actually asked for when the
/// booking recorded it (a `full` booking is the whole price), otherwise half
/// the total — the owner's 50% rule — at the same two decimal places every
/// money column in this schema carries.
fn deposit_due(facts: &BookingFacts) -> Decimal {
    facts
        .amount_due_now
        .unwrap_or_else(|| (facts.total_price / Decimal::from(2)).round_dp(2))
}

/// True when the guest has been asked for the whole price rather than a
/// deposit — `payment_option = 'full'`, or a booking that leaves nothing to
/// collect at the desk. The headline and the amount row both change: reception
/// reading "Deposit received" above a ฿0 balance either asks a fully-paid
/// guest for money at check-in or has to open the admin link to find out.
fn is_paid_in_full(facts: &BookingFacts, balance: Decimal) -> bool {
    let option_is_full = facts
        .payment_option
        .as_deref()
        .map(str::trim)
        .is_some_and(|option| option.eq_ignore_ascii_case("full"));

    option_is_full || (facts.total_price > Decimal::ZERO && balance <= Decimal::ZERO)
}

/// Escape the four characters that could otherwise break out of the HTML
/// part. Guest name, phone and room type are user-controlled text.
fn escape_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn render(
    config: &Settings,
    booking_id: Uuid,
    event: BookingNotifyEvent,
    facts: &BookingFacts,
    property: Option<&str>,
    slip: Option<&SlipDecisionRow>,
) -> RenderedMessage {
    let name = property_name(property);
    let dates = thai_date_range(facts.check_in_date, facts.check_out_date);
    let guest = facts
        .guest_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("ไม่ระบุชื่อ / no name");
    let phone = facts
        .guest_phone
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .unwrap_or("ไม่ระบุเบอร์ / no phone");
    let nights = (facts.check_out_date - facts.check_in_date)
        .num_days()
        .max(0);
    let deposit = deposit_due(facts);
    let balance = facts
        .balance_due
        .unwrap_or_else(|| facts.total_price - deposit);

    let paid_in_full = is_paid_in_full(facts, balance);

    let (headline_th, headline_en, headline_amount) = if event.is_deposit() {
        if paid_in_full {
            ("ชำระเต็มจำนวนแล้ว", "Paid in full", deposit)
        } else {
            ("มัดจำเข้าแล้ว", "Deposit received", deposit)
        }
    } else {
        ("จองใหม่", "New booking", facts.total_price)
    };

    // The same distinction on the amount row: a `full` booking never had a
    // deposit, so nothing may be labelled one.
    let amount_label = if paid_in_full {
        "ยอดชำระเต็มจำนวน / Paid in full"
    } else {
        "มัดจำ / Deposit due"
    };

    let subject = format!(
        "[{}] {} / {} — {} — {} — {}",
        name,
        headline_th,
        headline_en,
        dates,
        guest,
        format_baht(headline_amount)
    );

    let property_line = match property {
        Some(_) => name.to_string(),
        None => format!("{} (ยังไม่ระบุสาขา / property not set)", name),
    };

    let room_type = facts
        .room_type
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .unwrap_or("ไม่ระบุ / not set");

    let admin_link = format!(
        "{}/admin/booking-management?booking={}",
        config.server.frontend_url.trim_end_matches('/'),
        booking_id
    );

    let rows: Vec<(String, String)> = vec![
        ("โรงแรม / Property".to_string(), property_line),
        ("ชื่อผู้เข้าพัก / Guest".to_string(), guest.to_string()),
        ("เบอร์โทร / Phone".to_string(), phone.to_string()),
        (
            "เช็คอิน / Check-in".to_string(),
            format!(
                "{} ({})",
                thai_date(facts.check_in_date),
                facts.check_in_date
            ),
        ),
        (
            "เช็คเอาต์ / Check-out".to_string(),
            format!(
                "{} ({})",
                thai_date(facts.check_out_date),
                facts.check_out_date
            ),
        ),
        ("จำนวนคืน / Nights".to_string(), nights.to_string()),
        ("ประเภทห้อง / Room type".to_string(), room_type.to_string()),
        (
            "จำนวนผู้เข้าพัก / Guests".to_string(),
            facts.num_guests.to_string(),
        ),
        ("ยอดรวม / Total".to_string(), format_baht(facts.total_price)),
        (amount_label.to_string(), format_baht(deposit)),
        (
            "ยอดคงเหลือรับที่เช็คอิน / Balance at check-in".to_string(),
            format_baht(balance),
        ),
        (
            "สถานะการชำระเงิน / Payment status".to_string(),
            payment_status_line(event, slip),
        ),
        ("รหัสการจอง / Booking id".to_string(), booking_id.to_string()),
    ];

    let text_rows = rows
        .iter()
        .map(|(label, value)| format!("<p>{}: {}</p>", escape_html(label), escape_html(value)))
        .collect::<Vec<_>>()
        .join("\n        ");

    // Kept deliberately plain — the same shape as the other templates in
    // `services/email.rs`, and `send_email` derives the text/plain part from
    // it, so both alternatives stay in step.
    let html_body = format!(
        r#"<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <title>{subject}</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #ffffff; padding: 24px; border-radius: 8px;">
        <h2 style="margin: 0 0 16px;">{headline_th} / {headline_en}</h2>
        {text_rows}
        <p><a href="{admin_link}">เปิดในระบบหลังบ้าน / Open in admin</a></p>
    </div>
</body>
</html>"#,
        subject = escape_html(&subject),
        headline_th = headline_th,
        headline_en = headline_en,
        text_rows = text_rows,
        admin_link = escape_html(&admin_link),
    );

    RenderedMessage { subject, html_body }
}

/// The status line, in the locked guest-facing vocabulary plus what the desk
/// needs on top of it.
///
/// The **event** decides the wording, not `slipok_status`. An admin's Verify
/// writes `admin_status` and leaves `slipok_status` exactly as the machine
/// left it (`services/slip_confirm.rs`), so a deposit confirmed by hand still
/// reads `shadow_pass` or `manual` on the row — reading the column here would
/// tell the desk a confirmed deposit is still being checked.
///
/// `shadow_pass` is the interesting one: the machine agreed, but during the
/// shadow window a human still has to look, and the guest-facing wording
/// ("กำลังตรวจสอบ") is the only thing the locked vocabulary says. That line
/// therefore carries the locked wording *and* says plainly that the desk must
/// still confirm. No vendor name appears in any branch.
fn payment_status_line(event: BookingNotifyEvent, slip: Option<&SlipDecisionRow>) -> String {
    let slipok_status = slip.and_then(|s| s.slipok_status.as_deref());

    let mut line = match event {
        BookingNotifyEvent::BookingCreated => "ยังไม่ได้รับสลิป / No slip yet".to_string(),
        BookingNotifyEvent::DepositVerified { .. } => {
            // Confirmed either way; the parenthesis says by whom.
            let (th, en) = status_wording("verified");
            if slipok_status == Some("verified") {
                format!("{} / {} (ตรวจสอบอัตโนมัติ / checked automatically)", th, en)
            } else {
                format!("{} / {} (เจ้าหน้าที่ยืนยันแล้ว / confirmed by staff)", th, en)
            }
        },
        BookingNotifyEvent::DepositShadowPass { .. } => {
            let (th, en) = status_wording(slipok_status.unwrap_or("shadow_pass"));
            format!(
                "{} / {} (ระบบตรวจผ่านแล้ว แต่เจ้าหน้าที่ต้องตรวจซ้ำ / \
                 passed the automatic check, staff must still confirm)",
                th, en
            )
        },
    };

    if let Some((reason_th, reason_en)) = slip
        .and_then(|s| s.slipok_reason.as_deref())
        .and_then(reason_wording)
    {
        line.push_str(&format!(" — {} / {}", reason_th, reason_en));
    }

    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::BookingNotifyConfig;
    use rust_decimal_macros::dec;

    fn config_with(hf: Option<&str>, hfville: Option<&str>) -> BookingNotifyConfig {
        BookingNotifyConfig {
            hf: hf.map(str::to_string),
            hfville: hfville.map(str::to_string),
        }
    }

    fn settings() -> Settings {
        Settings {
            server: crate::config::ServerConfig {
                frontend_url: "https://loyalty.saichon.com".to_string(),
                ..Default::default()
            },
            booking_notify: config_with(Some("hf@example.com"), Some("hfville@example.com")),
            ..Default::default()
        }
    }

    fn facts() -> BookingFacts {
        BookingFacts {
            property: Some("hfville".to_string()),
            guest_name: Some("คุณสมชาย".to_string()),
            guest_phone: Some("0812345678".to_string()),
            check_in_date: NaiveDate::from_ymd_opt(2026, 10, 12).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            num_guests: 2,
            total_price: dec!(4400.00),
            amount_due_now: None,
            balance_due: None,
            room_type: Some("Deluxe".to_string()),
            payment_option: Some("deposit50".to_string()),
        }
    }

    // -- recipient selection -------------------------------------------------

    #[test]
    fn recipient_selection_picks_the_property_mailbox() {
        let config = config_with(Some("hf@example.com"), Some("ville@example.com"));
        assert_eq!(config.recipient_for("hf"), Some("hf@example.com"));
        assert_eq!(config.recipient_for("hfville"), Some("ville@example.com"));
    }

    #[test]
    fn recipient_selection_treats_blank_and_whitespace_as_off() {
        // `VAR: ${VAR:-}` in every compose file: unset arrives as Some("").
        let blank = config_with(Some(""), Some("   "));
        assert_eq!(blank.recipient_for("hf"), None);
        assert_eq!(blank.recipient_for("hfville"), None);
        assert!(!blank.is_configured());

        let unset = config_with(None, None);
        assert_eq!(unset.recipient_for("hf"), None);
        assert_eq!(unset.recipient_for("hfville"), None);
    }

    #[test]
    fn recipient_selection_refuses_an_unknown_property() {
        let config = config_with(Some("hf@example.com"), Some("ville@example.com"));
        assert_eq!(config.recipient_for(""), None);
        assert_eq!(config.recipient_for("hfvilla"), None);
        assert_eq!(config.recipient_for("HF"), None);
    }

    // -- event keys ----------------------------------------------------------

    #[test]
    fn event_keys_match_the_spec() {
        let booking = Uuid::nil();
        let slip = Uuid::from_u128(1);
        assert_eq!(
            BookingNotifyEvent::BookingCreated.event_key(booking),
            format!("booking_created:{}", booking)
        );
        assert_eq!(
            BookingNotifyEvent::DepositVerified { slip_id: slip }.event_key(booking),
            format!("deposit_verified:{}", slip)
        );
        // Distinct from the verify key: in shadow mode both events happen to
        // the same slip and the desk must get both messages.
        assert_eq!(
            BookingNotifyEvent::DepositShadowPass { slip_id: slip }.event_key(booking),
            format!("deposit_shadow_pass:{}", slip)
        );
        assert_ne!(
            BookingNotifyEvent::DepositShadowPass { slip_id: slip }.event_key(booking),
            BookingNotifyEvent::DepositVerified { slip_id: slip }.event_key(booking)
        );
    }

    // -- rendering -----------------------------------------------------------

    #[test]
    fn booking_created_subject_is_thai_first() {
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::BookingCreated,
            &facts(),
            Some("hfville"),
            None,
        );
        assert_eq!(
            rendered.subject,
            "[HF Ville] จองใหม่ / New booking — 12-14 ต.ค. — คุณสมชาย — ฿4,400"
        );
        assert!(rendered.html_body.contains("ยังไม่ได้รับสลิป / No slip yet"));
        assert!(rendered.html_body.contains("0812345678"));
    }

    #[test]
    fn deposit_verified_subject_carries_the_deposit_not_the_total() {
        let slip = SlipDecisionRow {
            slipok_status: Some("verified".to_string()),
            slipok_reason: None,
        };
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            &facts(),
            Some("hfville"),
            Some(&slip),
        );
        assert_eq!(
            rendered.subject,
            "[HF Ville] มัดจำเข้าแล้ว / Deposit received — 12-14 ต.ค. — คุณสมชาย — ฿2,200"
        );
        assert!(rendered.html_body.contains("ยืนยันแล้ว / Confirmed"));
    }

    #[test]
    fn a_booking_with_no_property_says_so_and_routes_to_hf_ville() {
        let mut facts = facts();
        facts.property = None;
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::BookingCreated,
            &facts,
            None,
            None,
        );
        assert!(rendered
            .html_body
            .contains("HF Ville (ยังไม่ระบุสาขา / property not set)"));
        // The mailbox a property-less booking is routed to.
        assert_eq!(
            settings().booking_notify.recipient_for(PROPERTY_HFVILLE),
            Some("hfville@example.com")
        );
    }

    #[test]
    fn shadow_pass_tells_the_desk_a_human_must_still_look() {
        let slip = SlipDecisionRow {
            slipok_status: Some("shadow_pass".to_string()),
            slipok_reason: None,
        };
        let line = payment_status_line(
            BookingNotifyEvent::DepositShadowPass {
                slip_id: Uuid::nil(),
            },
            Some(&slip),
        );
        assert!(line.contains("กำลังตรวจสอบ / Being checked"));
        assert!(line.contains("เจ้าหน้าที่ต้องตรวจซ้ำ"));
    }

    /// An admin's Verify leaves `slipok_status` alone, so the confirmation
    /// email must not read its wording off that column.
    #[test]
    fn an_admin_verify_of_a_shadow_passed_slip_says_confirmed() {
        let slip = SlipDecisionRow {
            slipok_status: Some("shadow_pass".to_string()),
            slipok_reason: None,
        };
        let line = payment_status_line(
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            Some(&slip),
        );
        assert!(line.contains("ยืนยันแล้ว / Confirmed"));
        assert!(line.contains("เจ้าหน้าที่ยืนยันแล้ว"));
        assert!(!line.contains("ต้องตรวจซ้ำ"));
    }

    #[test]
    fn a_failed_check_renders_the_locked_reason_wording() {
        let slip = SlipDecisionRow {
            slipok_status: Some("manual".to_string()),
            slipok_reason: Some("amount_mismatch".to_string()),
        };
        let line = payment_status_line(
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            Some(&slip),
        );
        assert!(line.contains("ยอดโอนไม่ตรงกับยอดที่ต้องชำระ"));
        assert!(line.contains("Transferred amount does not match the booking"));
    }

    /// No vendor name reaches any surface, guest or staff.
    #[test]
    fn no_vendor_name_appears_anywhere() {
        let slip = SlipDecisionRow {
            slipok_status: Some("shadow_pass".to_string()),
            slipok_reason: Some("receiver_mismatch".to_string()),
        };
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            &facts(),
            Some("hfville"),
            Some(&slip),
        );
        let lowered = format!("{} {}", rendered.subject, rendered.html_body).to_lowercase();
        assert!(!lowered.contains("slipok"));
    }

    /// The body must never carry the slip image, the payer's bank, or an
    /// account number.
    ///
    /// Rendered with a *populated* decision row, so the assertions run against
    /// the data the notifier actually holds about a slip rather than against a
    /// call that was handed nothing. `booking_notify_test.rs` does the other
    /// half — the same rule against a real `booking_slips` row, including its
    /// `slip_url` and bank reference, through `prepare`.
    #[test]
    fn the_body_carries_no_slip_image_and_no_payer_bank_details() {
        // A booking id with letters in every group: the digit-run assertion
        // below would otherwise trip over the twelve zeroes in the nil UUID.
        let booking_id = Uuid::parse_str("3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f6a7").unwrap();
        let slip = SlipDecisionRow {
            slipok_status: Some("verified".to_string()),
            slipok_reason: None,
        };
        let rendered = render(
            &settings(),
            booking_id,
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            &facts(),
            Some("hfville"),
            Some(&slip),
        );
        let body = rendered.html_body.to_lowercase();
        assert!(!body.contains("slip_url"));
        assert!(!body.contains("/storage/slips"));
        assert!(!body.contains("<img"));
        assert!(!body.contains("bank"));
        assert!(!body.contains("ธนาคาร"));
        assert!(!body.contains("เลขบัญชี"));
        assert!(!body.contains("account"));

        // Nothing account-number shaped (a run of 9+ digits). The guest's
        // phone is 10 digits and deliberately present, so it is excluded
        // before the check rather than exempted from it.
        let without_phone = body.replace("0812345678", "");
        let digits_run = without_phone
            .split(|c: char| !c.is_ascii_digit())
            .map(str::len)
            .max()
            .unwrap_or(0);
        assert!(
            digits_run < 9,
            "body contains an account-number-shaped digit run"
        );
    }

    /// A `full` booking is not a deposit: reception must not read "Deposit
    /// received" over a ฿0 balance.
    #[test]
    fn a_pay_in_full_booking_is_not_announced_as_a_deposit() {
        let mut facts = facts();
        facts.payment_option = Some("full".to_string());
        facts.amount_due_now = Some(dec!(4400.00));
        facts.balance_due = Some(dec!(0.00));

        let slip = SlipDecisionRow {
            slipok_status: Some("verified".to_string()),
            slipok_reason: None,
        };
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            &facts,
            Some("hfville"),
            Some(&slip),
        );

        assert_eq!(
            rendered.subject,
            "[HF Ville] ชำระเต็มจำนวนแล้ว / Paid in full — 12-14 ต.ค. — คุณสมชาย — ฿4,400"
        );
        assert!(rendered
            .html_body
            .contains("ยอดชำระเต็มจำนวน / Paid in full"));
        assert!(
            !rendered.html_body.contains("มัดจำ / Deposit due"),
            "nothing on a fully paid booking may be labelled a deposit"
        );
    }

    /// The deposit shape keeps the deposit wording.
    #[test]
    fn a_deposit_booking_keeps_the_deposit_wording() {
        let mut facts = facts();
        facts.balance_due = Some(dec!(2200.00));
        let slip = SlipDecisionRow {
            slipok_status: Some("verified".to_string()),
            slipok_reason: None,
        };
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::DepositVerified {
                slip_id: Uuid::nil(),
            },
            &facts,
            Some("hfville"),
            Some(&slip),
        );
        assert!(rendered.subject.contains("มัดจำเข้าแล้ว / Deposit received"));
        assert!(rendered.html_body.contains("มัดจำ / Deposit due"));
    }

    // -- money and dates -----------------------------------------------------

    #[test]
    fn deposit_is_half_the_total_when_the_booking_recorded_no_amount() {
        let mut facts = facts();
        facts.total_price = dec!(4405.00);
        facts.amount_due_now = None;
        assert_eq!(deposit_due(&facts), dec!(2202.50));
    }

    #[test]
    fn deposit_uses_what_the_guest_was_actually_asked_for() {
        let mut facts = facts();
        facts.amount_due_now = Some(dec!(4400.00));
        assert_eq!(deposit_due(&facts), dec!(4400.00));
    }

    #[test]
    fn baht_is_grouped_and_drops_an_empty_fraction() {
        assert_eq!(format_baht(dec!(4400.00)), "฿4,400");
        assert_eq!(format_baht(dec!(2202.50)), "฿2,202.50");
        assert_eq!(format_baht(dec!(0)), "฿0");
        assert_eq!(format_baht(dec!(1234567)), "฿1,234,567");
    }

    #[test]
    fn a_stay_across_two_months_names_both() {
        let range = thai_date_range(
            NaiveDate::from_ymd_opt(2026, 9, 28).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 2).unwrap(),
        );
        assert_eq!(range, "28 ก.ย.-2 ต.ค.");
    }

    #[test]
    fn html_special_characters_in_a_guest_name_are_escaped() {
        let mut facts = facts();
        facts.guest_name = Some("<script>alert(1)</script>".to_string());
        let rendered = render(
            &settings(),
            Uuid::nil(),
            BookingNotifyEvent::BookingCreated,
            &facts,
            Some("hfville"),
            None,
        );
        assert!(!rendered.html_body.contains("<script>"));
        assert!(rendered.html_body.contains("&lt;script&gt;"));
    }
}
