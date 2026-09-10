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

/// Longest `pms_booking_id` this client will ever put in a URL.
///
/// The PMS channel API issues short opaque references; 64 is generous for
/// every shape it has ever returned and small enough that nothing
/// interesting fits. It is a ceiling, not a format — the character rule
/// below is what actually decides.
const MAX_PMS_BOOKING_ID_LEN: usize = 64;

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

pub struct PmsChannelClient {
    base_url: String,
    token: String,
    http: reqwest::Client,
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
                .build()
                .map_err(|e| {
                    AppError::Internal(format!("Failed to build the PMS HTTP client: {e}"))
                })?,
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

    pub async fn create_booking(
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

    /// Mark the deposit received. The PMS requires the received amount in
    /// the body — it doesn't persist the guest's payment plan, so it can't
    /// know whether 50% or 100% arrived (PMS contract addendum).
    pub async fn payment_verified(&self, pms_booking_id: &str, amount: Decimal) -> AppResult<()> {
        self.post_action(
            pms_booking_id,
            "payment-verified",
            Some(serde_json::json!({ "amount": amount })),
        )
        .await
    }

    pub async fn release(&self, pms_booking_id: &str) -> AppResult<()> {
        self.post_action(pms_booking_id, "release", None).await
    }

    async fn post_action(
        &self,
        pms_booking_id: &str,
        action: &str,
        body: Option<serde_json::Value>,
    ) -> AppResult<()> {
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
                return Err(AppError::Internal(
                    "PMS booking id failed validation".to_string(),
                ));
            },
        };
        let mut request = self.http.post(&url).bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(pms_unreachable)?;
        if response.status().is_success() {
            return Ok(());
        }
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        Err(AppError::ExternalServiceUnavailable(format!(
            "PMS {action} for booking {pms_booking_id} failed: {status} {detail}"
        )))
    }

    async fn parse_json<T: serde::de::DeserializeOwned>(
        response: reqwest::Response,
        what: &str,
    ) -> AppResult<T> {
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            // 4xx from the PMS (sold out, bad dates) surfaces as a client
            // error; 5xx as service-unavailable.
            return if status.is_client_error() {
                Err(AppError::BadRequest(format!(
                    "PMS rejected {what}: {detail}"
                )))
            } else {
                Err(AppError::ExternalServiceUnavailable(format!(
                    "PMS {what} failed: {status} {detail}"
                )))
            };
        }
        response.json::<T>().await.map_err(|e| {
            AppError::ExternalServiceUnavailable(format!("PMS {what} response malformed: {e}"))
        })
    }
}

/// Sweep channel bookings whose payment window lapsed: release the PMS hold,
/// then cancel the local channel row. Runs periodically from main.rs; the
/// PMS also runs its own expiry sweep, so both sides are belt-and-braces
/// (docs/launch-plan.md). Never panics/errors — failures log and retry on
/// the next sweep. Returns how many holds were released.
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

    let mut released = 0u64;
    for row in expired {
        let Some(pms_booking_id) = row.pms_booking_id else {
            continue;
        };
        // Release the PMS side FIRST; only cancel locally once the PMS
        // acknowledged, so a failed release retries on the next sweep.
        if let Err(e) = client.release(&pms_booking_id).await {
            tracing::warn!(error = %e, pms_booking_id = %pms_booking_id,
                "PMS hold release failed; will retry next sweep");
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
            Ok(_) => released += 1,
            Err(e) => {
                tracing::error!(error = %e, booking_id = %row.id,
                    "failed to cancel expired channel booking locally");
            },
        }
    }
    if released > 0 {
        tracing::info!(released, "released expired channel-booking holds");
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
