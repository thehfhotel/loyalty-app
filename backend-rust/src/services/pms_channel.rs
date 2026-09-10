//! PMS booking-channel client (ADR-0003).
//!
//! The loyalty app holds no room inventory: availability is queried live
//! from the PMS and confirmed bookings are created there. This module is
//! the outbound HTTP client for the PMS channel API; the interface
//! contract is locked in docs/launch-plan.md.

use chrono::{DateTime, NaiveDate, Utc};
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
        let url = format!(
            "{}/api/channel/bookings/{}/{}",
            self.base_url, pms_booking_id, action
        );
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
