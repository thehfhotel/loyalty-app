//! SlipOK Service Module
//!
//! Handles payment slip verification via the SlipOK API.
//! SlipOK is a Thai payment slip verification service that validates
//! bank transfer slips using OCR and banking APIs.
//!
//! # Configuration
//!
//! The service requires the following environment variables:
//! - `SLIPOK_API_KEY`: API key for authentication
//! - `SLIPOK_BRANCH_ID`: Branch ID for the SlipOK account
//!
//! # API Reference
//!
//! SlipOK API endpoint: `https://api.slipok.com/api/line/apikey/{branchId}`
//!
//! # Example
//!
//! ```rust,ignore
//! use bytes::Bytes;
//! use loyalty_backend::services::slipok::SlipOkService;
//!
//! let service = SlipOkService::new("api_key".to_string(), "branch_id".to_string());
//! let slip_image = Bytes::from_static(b"image data");
//! let result = service.verify_slip(slip_image).await?;
//! ```

use bytes::Bytes;
use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone, Utc};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;

use crate::error::AppError;
use crate::utils::logging::sanitize_log_value;

/// Default SlipOK API base URL
const DEFAULT_SLIPOK_API_URL: &str = "https://api.slipok.com/api/line/apikey";

/// Default request timeout in seconds
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// SlipOK quota exceeded error code
const QUOTA_EXCEEDED_ERROR_CODE: i32 = 1008;

/// Verification status indicating the result of slip verification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    /// Slip was successfully verified
    Verified,
    /// Slip verification failed
    Failed,
    /// SlipOK monthly quota has been exceeded
    QuotaExceeded,
}

/// Result of a slip verification attempt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlipVerificationResult {
    /// Whether the verification was successful
    pub success: bool,
    /// Verification status
    pub status: VerificationStatus,
    /// Transaction amount in Thai Baht (using Decimal for precision)
    pub amount: Option<Decimal>,
    /// Sender's display name or account name
    pub sender_name: Option<String>,
    /// Receiver's display name or account name
    pub receiver_name: Option<String>,
    /// Transaction date and time
    pub transaction_date: Option<DateTime<Utc>>,
    /// Transaction reference ID from the bank
    pub transaction_id: Option<String>,
    /// Sending bank code (3-character code) - alias for backward compatibility
    #[serde(alias = "sending_bank_code")]
    pub bank_code: Option<String>,
    /// Receiving bank code (3-character code)
    pub receiving_bank_code: Option<String>,
    /// Error code if verification failed
    pub error_code: Option<String>,
    /// Human-readable error message
    pub error_message: Option<String>,
    /// Raw response from SlipOK API (for debugging)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response: Option<serde_json::Value>,
}

impl SlipVerificationResult {
    /// Create a successful verification result
    fn success(response: SlipOKResponse) -> Self {
        // Serialize the response first before moving any fields out
        let raw_response = serde_json::to_value(&response).ok();

        let transaction_date = response
            .trans_timestamp
            .as_ref()
            .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .or_else(|| {
                // Try parsing from transDate + transTime (yyyyMMdd + HH:mm:ss)
                parse_thai_datetime(response.trans_date.as_deref(), response.trans_time.as_deref())
            });

        let sender_name = response
            .sender
            .as_ref()
            .and_then(|s| s.display_name.clone().or_else(|| s.name.clone()));

        let receiver_name = response
            .receiver
            .as_ref()
            .and_then(|r| r.display_name.clone().or_else(|| r.name.clone()));

        // Convert f64 amount to Decimal for precision
        let amount = response.amount.and_then(|a| {
            Decimal::try_from(a).ok()
        });

        Self {
            success: true,
            status: VerificationStatus::Verified,
            amount,
            sender_name,
            receiver_name,
            transaction_date,
            transaction_id: response.trans_ref,
            bank_code: response.sending_bank,
            receiving_bank_code: response.receiving_bank,
            error_code: None,
            error_message: None,
            raw_response,
        }
    }

    /// Create a failed verification result
    fn failed(error_code: impl Into<String>, error_message: impl Into<String>) -> Self {
        Self {
            success: false,
            status: VerificationStatus::Failed,
            amount: None,
            sender_name: None,
            receiver_name: None,
            transaction_date: None,
            transaction_id: None,
            bank_code: None,
            receiving_bank_code: None,
            error_code: Some(error_code.into()),
            error_message: Some(error_message.into()),
            raw_response: None,
        }
    }

    /// Create a quota exceeded result
    fn quota_exceeded(message: Option<String>) -> Self {
        Self {
            success: false,
            status: VerificationStatus::QuotaExceeded,
            amount: None,
            sender_name: None,
            receiver_name: None,
            transaction_date: None,
            transaction_id: None,
            bank_code: None,
            receiving_bank_code: None,
            error_code: Some("QUOTA_EXCEEDED".to_string()),
            error_message: Some(message.unwrap_or_else(|| "SlipOK monthly quota exceeded".to_string())),
            raw_response: None,
        }
    }

    /// Create a not configured result
    fn not_configured() -> Self {
        Self::failed("NOT_CONFIGURED", "SlipOK API key or branch ID not configured")
    }
}

/// Sender/Receiver account information from SlipOK response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    /// Display name
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    /// Account holder name
    pub name: Option<String>,
    /// Proxy information (PromptPay)
    pub proxy: Option<ProxyInfo>,
    /// Account information
    pub account: Option<AccountDetail>,
}

/// Proxy information (for PromptPay transfers)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyInfo {
    /// Proxy type (e.g., "MOBILE", "NATID")
    #[serde(rename = "type")]
    pub proxy_type: Option<String>,
    /// Proxy value (masked)
    pub value: Option<String>,
}

/// Account detail information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountDetail {
    /// Account type
    #[serde(rename = "type")]
    pub account_type: Option<String>,
    /// Account value (masked)
    pub value: Option<String>,
}

/// Response from SlipOK API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlipOKResponse {
    /// Whether the verification was successful
    pub success: bool,
    /// Message from the API
    pub message: Option<String>,
    /// Transaction reference ID
    #[serde(rename = "transRef")]
    pub trans_ref: Option<String>,
    /// Transaction date in yyyyMMdd format
    #[serde(rename = "transDate")]
    pub trans_date: Option<String>,
    /// Transaction time in HH:mm:ss format
    #[serde(rename = "transTime")]
    pub trans_time: Option<String>,
    /// Transaction timestamp in ISO 8601 format
    #[serde(rename = "transTimestamp")]
    pub trans_timestamp: Option<String>,
    /// Transaction amount
    pub amount: Option<f64>,
    /// Sending bank code (3-character)
    #[serde(rename = "sendingBank")]
    pub sending_bank: Option<String>,
    /// Receiving bank code (3-character)
    #[serde(rename = "receivingBank")]
    pub receiving_bank: Option<String>,
    /// Sender information
    pub sender: Option<AccountInfo>,
    /// Receiver information
    pub receiver: Option<AccountInfo>,
    /// Reference 1
    pub ref1: Option<String>,
    /// Reference 2
    pub ref2: Option<String>,
    /// Reference 3
    pub ref3: Option<String>,
    /// Paid amount in local currency
    #[serde(rename = "paidLocalAmount")]
    pub paid_local_amount: Option<f64>,
    /// Local currency code
    #[serde(rename = "paidLocalCurrency")]
    pub paid_local_currency: Option<String>,
    /// Country code
    #[serde(rename = "countryCode")]
    pub country_code: Option<String>,
    /// Transaction fee amount
    #[serde(rename = "transFeeAmount")]
    pub trans_fee_amount: Option<String>,
    /// Error code (when success=false)
    pub code: Option<i32>,
}

/// Request body for SlipOK API
#[derive(Debug, Serialize)]
struct SlipOKRequest {
    /// URL of the slip image to verify
    url: String,
    /// Enable logging for duplicate detection
    log: bool,
}

/// Request body for SlipOK API with base64 data
#[derive(Debug, Serialize)]
struct SlipOKBase64Request {
    /// Base64-encoded slip image data
    data: String,
    /// Enable logging for duplicate detection
    log: bool,
}

/// Configuration for the SlipOK service
#[derive(Debug, Clone)]
pub struct SlipOKConfig {
    /// API key for authentication
    pub api_key: String,
    /// Branch ID for the account
    pub branch_id: String,
    /// Base API URL
    pub api_url: String,
    /// Request timeout
    pub timeout: Duration,
}

impl SlipOKConfig {
    /// Create configuration from environment variables
    pub fn from_env() -> Option<Self> {
        let api_key = env::var("SLIPOK_API_KEY").ok()?;
        let branch_id = env::var("SLIPOK_BRANCH_ID").ok()?;

        if api_key.is_empty() || branch_id.is_empty() {
            return None;
        }

        let api_url = env::var("SLIPOK_API_URL").unwrap_or_else(|_| DEFAULT_SLIPOK_API_URL.to_string());
        let timeout_secs: u64 = env::var("SLIPOK_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_TIMEOUT_SECS);

        Some(Self {
            api_key,
            branch_id,
            api_url,
            timeout: Duration::from_secs(timeout_secs),
        })
    }

    /// Get the full API URL with branch ID
    fn get_api_url(&self) -> String {
        format!("{}/{}", self.api_url, self.branch_id)
    }
}

/// SlipOK service for payment slip verification
///
/// This is the main service struct for verifying payment slips via the SlipOK API.
/// It can be instantiated either with explicit credentials or from environment variables.
#[derive(Debug, Clone)]
pub struct SlipOKService {
    /// HTTP client for API requests
    client: Client,
    /// Service configuration (None if not configured)
    config: Option<SlipOKConfig>,
}

/// Simplified SlipOK service alias with direct credential constructor
///
/// This provides the interface requested:
/// - `new(api_key, branch_id)` constructor
/// - `verify_slip(Bytes) -> Result<SlipVerificationResult>`
pub type SlipOkService = SlipOKService;

impl SlipOKService {
    /// Create a new SlipOK service instance from environment variables
    ///
    /// Reads `SLIPOK_API_KEY` and `SLIPOK_BRANCH_ID` from environment.
    pub fn from_env() -> Self {
        let config = SlipOKConfig::from_env();

        let client = Client::builder()
            .timeout(config.as_ref().map(|c| c.timeout).unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECS)))
            .build()
            .expect("Failed to create HTTP client");

        Self { client, config }
    }

    /// Create a new SlipOK service instance with API key and branch ID
    ///
    /// # Arguments
    ///
    /// * `api_key` - SlipOK API key for authentication
    /// * `branch_id` - SlipOK branch ID
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let service = SlipOKService::new("my_api_key".to_string(), "my_branch_id".to_string());
    /// ```
    pub fn new(api_key: String, branch_id: String) -> Self {
        if api_key.is_empty() || branch_id.is_empty() {
            return Self {
                client: Client::builder()
                    .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
                    .build()
                    .expect("Failed to create HTTP client"),
                config: None,
            };
        }

        let config = SlipOKConfig {
            api_key,
            branch_id,
            api_url: DEFAULT_SLIPOK_API_URL.to_string(),
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        };

        let client = Client::builder()
            .timeout(config.timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            config: Some(config),
        }
    }

    /// Create a new SlipOK service instance with custom configuration
    pub fn with_config(config: SlipOKConfig) -> Self {
        let client = Client::builder()
            .timeout(config.timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            config: Some(config),
        }
    }

    /// Check if the service is configured
    pub fn is_configured(&self) -> bool {
        self.config.is_some()
    }

    /// Get the configuration (if available)
    pub fn config(&self) -> Option<&SlipOKConfig> {
        self.config.as_ref()
    }

    /// Verify a payment slip using its image URL
    ///
    /// # Arguments
    ///
    /// * `slip_image_url` - URL of the slip image to verify
    ///
    /// # Returns
    ///
    /// A `Result<SlipVerificationResult, AppError>` indicating whether the slip was verified successfully
    pub async fn verify_slip_url(&self, slip_image_url: &str) -> Result<SlipVerificationResult, AppError> {
        self.verify_slip_url_with_context(slip_image_url, None).await
    }

    /// Verify a payment slip using its image URL with optional booking context
    ///
    /// # Arguments
    ///
    /// * `slip_image_url` - URL of the slip image to verify
    /// * `booking_id` - Optional booking ID for logging purposes
    ///
    /// # Returns
    ///
    /// A `Result<SlipVerificationResult, AppError>` indicating whether the slip was verified successfully
    pub async fn verify_slip_url_with_context(
        &self,
        slip_image_url: &str,
        booking_id: Option<&str>,
    ) -> Result<SlipVerificationResult, AppError> {
        let booking_ref = booking_id
            .map(|id| sanitize_log_value(id, None))
            .unwrap_or_else(|| "unknown".to_string());

        // Check if service is configured
        let config = match &self.config {
            Some(c) => c,
            None => {
                tracing::warn!("SlipOK API key or branch ID not configured, skipping verification");
                return Ok(SlipVerificationResult::not_configured());
            }
        };

        tracing::info!(
            booking_id = %booking_ref,
            "Starting SlipOK verification"
        );

        // Make API request
        let request_body = SlipOKRequest {
            url: slip_image_url.to_string(),
            log: true,
        };

        self.make_api_request(config, &request_body).await
    }

    /// Verify a payment slip using raw image bytes
    ///
    /// This is the primary verification method that accepts raw image bytes.
    ///
    /// # Arguments
    ///
    /// * `slip_image` - Raw bytes of the slip image
    ///
    /// # Returns
    ///
    /// A `Result<SlipVerificationResult, AppError>` indicating whether the slip was verified successfully
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let service = SlipOkService::new("api_key".to_string(), "branch_id".to_string());
    /// let result = service.verify_slip(slip_bytes).await?;
    /// if result.success {
    ///     println!("Amount: {:?}", result.amount);
    /// }
    /// ```
    pub async fn verify_slip(&self, slip_image: Bytes) -> Result<SlipVerificationResult, AppError> {
        self.verify_slip_with_context(slip_image, None).await
    }

    /// Verify a payment slip using raw image bytes with optional booking context
    ///
    /// # Arguments
    ///
    /// * `slip_image` - Raw bytes of the slip image
    /// * `booking_id` - Optional booking ID for logging purposes
    ///
    /// # Returns
    ///
    /// A `Result<SlipVerificationResult, AppError>` indicating whether the slip was verified successfully
    pub async fn verify_slip_with_context(
        &self,
        slip_image: Bytes,
        booking_id: Option<&str>,
    ) -> Result<SlipVerificationResult, AppError> {
        let booking_ref = booking_id
            .map(|id| sanitize_log_value(id, None))
            .unwrap_or_else(|| "unknown".to_string());

        // Check if service is configured
        let config = match &self.config {
            Some(c) => c,
            None => {
                tracing::warn!("SlipOK API key or branch ID not configured, skipping verification");
                return Ok(SlipVerificationResult::not_configured());
            }
        };

        tracing::info!(
            booking_id = %booking_ref,
            image_size = slip_image.len(),
            "Starting SlipOK verification with image bytes"
        );

        // Convert image bytes to base64
        use base64::{engine::general_purpose::STANDARD, Engine};
        let base64_data = STANDARD.encode(&slip_image);

        // Make API request with base64 data
        let request_body = SlipOKBase64Request {
            data: base64_data,
            log: true,
        };

        self.make_api_request(config, &request_body).await
    }

    /// Make the actual API request to SlipOK
    async fn make_api_request<T: Serialize>(
        &self,
        config: &SlipOKConfig,
        body: &T,
    ) -> Result<SlipVerificationResult, AppError> {
        let response = self
            .client
            .post(config.get_api_url())
            .header("Content-Type", "application/json")
            .header("x-authorization", &config.api_key)
            .json(body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AppError::ExternalServiceTimeout("SlipOK".to_string())
                } else if e.is_connect() {
                    AppError::ExternalServiceUnavailable("SlipOK".to_string())
                } else {
                    AppError::SlipOk(format!("Request failed: {}", e))
                }
            })?;

        let status = response.status();

        // Check for HTTP-level errors
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            tracing::error!(
                status = %status,
                error = %error_text,
                "SlipOK API error"
            );

            // Check for quota exceeded (HTTP 429)
            if status.as_u16() == 429 {
                return Ok(SlipVerificationResult::quota_exceeded(None));
            }

            return Ok(SlipVerificationResult::failed(
                format!("HTTP_{}", status.as_u16()),
                error_text,
            ));
        }

        // Parse response
        let data: SlipOKResponse = response.json().await.map_err(|e| {
            AppError::SlipOk(format!("Failed to parse response: {}", e))
        })?;

        // Handle response based on success flag
        if data.success {
            let transaction_id = data.trans_ref.clone().unwrap_or_else(|| "unknown".to_string());
            tracing::info!(
                transaction_id = %transaction_id,
                amount = ?data.amount,
                "SlipOK verification successful"
            );
            Ok(SlipVerificationResult::success(data))
        } else {
            // Check for quota exceeded (error code 1008)
            if data.code == Some(QUOTA_EXCEEDED_ERROR_CODE) {
                return Ok(SlipVerificationResult::quota_exceeded(data.message.clone()));
            }

            // Serialize the response first before moving any fields out
            let raw_response = serde_json::to_value(&data).ok();

            let error_code = data
                .code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "VERIFICATION_FAILED".to_string());
            let error_message = data.message.unwrap_or_else(|| "Slip verification failed".to_string());

            tracing::warn!(
                error_code = %error_code,
                error_message = %error_message,
                "SlipOK verification failed"
            );

            let mut result = SlipVerificationResult::failed(error_code, error_message);
            result.raw_response = raw_response;
            Ok(result)
        }
    }

    /// Get the health status of the SlipOK service
    pub async fn get_health_status(&self) -> SlipOKHealthStatus {
        let configured = self.is_configured();
        let (api_url, branch_id) = self
            .config
            .as_ref()
            .map(|c| (c.get_api_url(), c.branch_id.clone()))
            .unwrap_or_else(|| ("not configured".to_string(), "not configured".to_string()));

        SlipOKHealthStatus {
            configured,
            api_url,
            branch_id,
            can_connect: configured, // We don't have a health endpoint to test
        }
    }
}

impl Default for SlipOKService {
    fn default() -> Self {
        Self::from_env()
    }
}

/// Health status of the SlipOK service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlipOKHealthStatus {
    /// Whether the service is configured
    pub configured: bool,
    /// API URL being used
    pub api_url: String,
    /// Branch ID being used
    pub branch_id: String,
    /// Whether the service can connect (best-effort check)
    pub can_connect: bool,
}

/// Parse Thai date/time format from SlipOK response
///
/// # Arguments
///
/// * `date_str` - Date in yyyyMMdd format
/// * `time_str` - Time in HH:mm:ss format
///
/// # Returns
///
/// A `DateTime<Utc>` if parsing was successful
fn parse_thai_datetime(date_str: Option<&str>, time_str: Option<&str>) -> Option<DateTime<Utc>> {
    let date_str = date_str?;
    let time_str = time_str?;

    // Parse yyyyMMdd format
    if date_str.len() != 8 {
        return None;
    }

    let year: i32 = date_str[0..4].parse().ok()?;
    let month: u32 = date_str[4..6].parse().ok()?;
    let day: u32 = date_str[6..8].parse().ok()?;

    let date = NaiveDate::from_ymd_opt(year, month, day)?;

    // Parse HH:mm:ss format
    let time_parts: Vec<&str> = time_str.split(':').collect();
    if time_parts.len() != 3 {
        return None;
    }

    let hour: u32 = time_parts[0].parse().ok()?;
    let minute: u32 = time_parts[1].parse().ok()?;
    let second: u32 = time_parts[2].parse().ok()?;

    let time = NaiveTime::from_hms_opt(hour, minute, second)?;

    // Create datetime in Thailand timezone (UTC+7)
    let naive_datetime = date.and_time(time);

    // Thailand is UTC+7, so we need to convert to UTC
    // Note: For simplicity, we're treating this as UTC. In production,
    // you might want to use chrono-tz for proper timezone handling.
    let bangkok_offset = chrono::FixedOffset::east_opt(7 * 3600)?;
    let datetime_with_tz = bangkok_offset.from_local_datetime(&naive_datetime).single()?;

    Some(datetime_with_tz.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;

    #[test]
    fn test_verification_status_serialization() {
        assert_eq!(
            serde_json::to_string(&VerificationStatus::Verified).unwrap(),
            "\"verified\""
        );
        assert_eq!(
            serde_json::to_string(&VerificationStatus::Failed).unwrap(),
            "\"failed\""
        );
        assert_eq!(
            serde_json::to_string(&VerificationStatus::QuotaExceeded).unwrap(),
            "\"quota_exceeded\""
        );
    }

    #[test]
    fn test_slip_verification_result_success() {
        let response = SlipOKResponse {
            success: true,
            message: None,
            trans_ref: Some("REF123".to_string()),
            trans_date: Some("20240115".to_string()),
            trans_time: Some("14:30:00".to_string()),
            trans_timestamp: None,
            amount: Some(1000.0),
            sending_bank: Some("004".to_string()),
            receiving_bank: Some("002".to_string()),
            sender: Some(AccountInfo {
                display_name: Some("John Doe".to_string()),
                name: None,
                proxy: None,
                account: None,
            }),
            receiver: Some(AccountInfo {
                display_name: Some("Shop Name".to_string()),
                name: None,
                proxy: None,
                account: None,
            }),
            ref1: None,
            ref2: None,
            ref3: None,
            paid_local_amount: None,
            paid_local_currency: None,
            country_code: None,
            trans_fee_amount: None,
            code: None,
        };

        let result = SlipVerificationResult::success(response);

        assert!(result.success);
        assert_eq!(result.status, VerificationStatus::Verified);
        assert_eq!(result.amount, Some(Decimal::from(1000)));
        assert_eq!(result.sender_name, Some("John Doe".to_string()));
        assert_eq!(result.receiver_name, Some("Shop Name".to_string()));
        assert_eq!(result.transaction_id, Some("REF123".to_string()));
        assert_eq!(result.bank_code, Some("004".to_string()));
        assert_eq!(result.receiving_bank_code, Some("002".to_string()));
    }

    #[test]
    fn test_new_with_credentials() {
        let service = SlipOKService::new("test_api_key".to_string(), "test_branch_id".to_string());
        assert!(service.is_configured());

        let config = service.config().unwrap();
        assert_eq!(config.api_key, "test_api_key");
        assert_eq!(config.branch_id, "test_branch_id");
    }

    #[test]
    fn test_new_with_empty_credentials() {
        let service = SlipOKService::new(String::new(), String::new());
        assert!(!service.is_configured());
    }

    #[test]
    fn test_slipok_service_alias() {
        // Verify that SlipOkService is an alias for SlipOKService
        let service: SlipOkService = SlipOKService::new("key".to_string(), "branch".to_string());
        assert!(service.is_configured());
    }

    #[test]
    fn test_slip_verification_result_failed() {
        let result = SlipVerificationResult::failed("TEST_ERROR", "Test error message");

        assert!(!result.success);
        assert_eq!(result.status, VerificationStatus::Failed);
        assert_eq!(result.error_code, Some("TEST_ERROR".to_string()));
        assert_eq!(result.error_message, Some("Test error message".to_string()));
        assert!(result.amount.is_none());
    }

    #[test]
    fn test_slip_verification_result_quota_exceeded() {
        let result = SlipVerificationResult::quota_exceeded(None);

        assert!(!result.success);
        assert_eq!(result.status, VerificationStatus::QuotaExceeded);
        assert_eq!(result.error_code, Some("QUOTA_EXCEEDED".to_string()));
    }

    #[test]
    fn test_parse_thai_datetime() {
        let result = parse_thai_datetime(Some("20240115"), Some("14:30:00"));
        assert!(result.is_some());

        let dt = result.unwrap();
        // The time should be converted from Bangkok time (UTC+7) to UTC
        // 14:30:00 Bangkok = 07:30:00 UTC
        assert_eq!(dt.hour(), 7);
        assert_eq!(dt.minute(), 30);
    }

    #[test]
    fn test_parse_thai_datetime_invalid() {
        assert!(parse_thai_datetime(None, Some("14:30:00")).is_none());
        assert!(parse_thai_datetime(Some("20240115"), None).is_none());
        assert!(parse_thai_datetime(Some("invalid"), Some("14:30:00")).is_none());
        assert!(parse_thai_datetime(Some("20240115"), Some("invalid")).is_none());
    }

    #[test]
    fn test_slipok_config_get_api_url() {
        let config = SlipOKConfig {
            api_key: "test_key".to_string(),
            branch_id: "12345".to_string(),
            api_url: "https://api.slipok.com/api/line/apikey".to_string(),
            timeout: Duration::from_secs(30),
        };

        assert_eq!(
            config.get_api_url(),
            "https://api.slipok.com/api/line/apikey/12345"
        );
    }

    #[test]
    fn test_slipok_service_from_env() {
        // This test uses from_env() which reads from environment
        let service = SlipOKService::from_env();
        // Service may or may not be configured depending on environment
        // Just verify it doesn't panic
        let _ = service.is_configured();
    }

    #[test]
    fn test_slipok_service_default() {
        // Default implementation should use from_env()
        let service = SlipOKService::default();
        // Service may or may not be configured depending on environment
        // Just verify it doesn't panic
        let _ = service.is_configured();
    }

    #[test]
    fn test_slipok_response_deserialization() {
        let json = r#"{
            "success": true,
            "transRef": "REF123",
            "transDate": "20240115",
            "transTime": "14:30:00",
            "amount": 1000.50,
            "sendingBank": "004",
            "receivingBank": "002",
            "sender": {
                "displayName": "John Doe",
                "name": "John D"
            },
            "receiver": {
                "displayName": "Shop",
                "name": "Shop Name"
            }
        }"#;

        let response: SlipOKResponse = serde_json::from_str(json).unwrap();

        assert!(response.success);
        assert_eq!(response.trans_ref, Some("REF123".to_string()));
        assert_eq!(response.amount, Some(1000.50));
        assert!(response.sender.is_some());
        assert_eq!(
            response.sender.as_ref().unwrap().display_name,
            Some("John Doe".to_string())
        );
    }

    #[test]
    fn test_slipok_response_error_deserialization() {
        let json = r#"{
            "success": false,
            "message": "Invalid slip image",
            "code": 1001
        }"#;

        let response: SlipOKResponse = serde_json::from_str(json).unwrap();

        assert!(!response.success);
        assert_eq!(response.message, Some("Invalid slip image".to_string()));
        assert_eq!(response.code, Some(1001));
    }

    #[test]
    fn test_health_status_serialization() {
        let status = SlipOKHealthStatus {
            configured: true,
            api_url: "https://api.slipok.com/api/line/apikey/12345".to_string(),
            branch_id: "12345".to_string(),
            can_connect: true,
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"configured\":true"));
        assert!(json.contains("\"branch_id\":\"12345\""));
    }
}
