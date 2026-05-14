//! Admin email service routes
//!
//! Backs the **Settings → Email Service** admin page (`EmailServicePage.tsx`).
//! The frontend uses this to surface SMTP/IMAP health and to fire a manual
//! test send when an operator changes credentials.
//!
//! ## Endpoints
//!
//! - `GET  /api/admin/email/status` — current SMTP probe + IMAP configured
//!   state. Returns `EmailStatus`.
//! - `POST /api/admin/email/test` — sends a real test email to the
//!   authenticated admin's own address. Returns `TestResult`.
//!
//! ## What we honestly report vs. what we don't
//!
//! - **SMTP** — a real probe: opens a TCP/TLS connection, completes the
//!   EHLO/STARTTLS/AUTH handshake via `lettre::AsyncSmtpTransport::test_connection`
//!   and tears down. Reflects authentication and TLS state, not just config.
//! - **IMAP** — **only a configured-state check**. There is no IMAP client
//!   wired into this backend yet. The `async-imap` crate is listed in
//!   `Cargo.toml` but never imported; shipping a "probe" would mean
//!   building an `ImapService` trait + impl from scratch (parallel to
//!   `EmailService`), which deserves its own PR. The response field is
//!   reported as `imapConnected: true` if `IMAP_HOST/USER/PASS` are all
//!   set and `false` otherwise. The status object also returns
//!   `imapProbed: false` so the frontend (and an operator reading the
//!   JSON) knows this is a declarative check, not a live probe.
//! - **End-to-end SMTP→IMAP loopback test** — explicitly NOT implemented.
//!   The "test" endpoint sends a real email via SMTP and reports
//!   `smtpSent`/`messageId`. `imapReceived` is reported as `null`. The
//!   frontend already handles missing fields gracefully (renders blank).
//!
//! ## sqlx note
//!
//! No DB writes in these handlers — they call the existing `EmailService`
//! trait. No new compile-time queries; nothing for `regen-sqlx-cache.sh` to
//! cache here.

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{has_role, AuthUser};
use crate::services::email::{EmailService, EmailServiceImpl};
use crate::state::AppState;
use crate::utils::hash_email;

/// Max test-email sends per admin per UTC day.
///
/// The endpoint exists for operators verifying SMTP config; ten attempts
/// per day is enough for a credential rotation + retry cycle while
/// keeping the relay's daily reputation footprint small if a token
/// leaks (HIGH-4 in security-2026-05-13.md). Bucket is keyed by admin
/// UUID + UTC date, so the count resets at 00:00 UTC.
const TEST_EMAIL_DAILY_QUOTA: u32 = 10;

// ============================================================================
// DTOs
// ============================================================================

/// Response for `GET /api/admin/email/status`.
///
/// Field shape matches the `EmailStatus` interface declared inline in
/// `frontend/src/pages/admin/EmailServicePage.tsx`. Fields that the frontend
/// doesn't declare (`smtpError`, `imapProbed`, `checkedAt`) are added
/// non-breakingly via `serde` rename so future frontend revisions can pick
/// them up without a backend change. Missing fields are tolerated.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailStatusResponse {
    /// Whether SMTP **and** IMAP credentials are present in config.
    /// (`SmtpConfig::is_configured() && ImapConfig::is_configured()`)
    pub configured: bool,
    /// `true` if a real SMTP probe succeeded.
    /// `false` if the probe ran but the server rejected it, or SMTP isn't
    /// configured at all.
    pub smtp_connected: bool,
    /// `true` if IMAP credentials are configured.
    /// **NOT** a live probe — see the module docs.
    pub imap_connected: bool,
    /// Always `true` for SMTP — we ran the actual probe.
    pub smtp_probed: bool,
    /// Always `false` — no IMAP probe is wired yet. The frontend can use
    /// this to render a "not probed" indicator instead of a misleading
    /// green check.
    pub imap_probed: bool,
    /// SMTP probe error message, if any. Useful for operators debugging
    /// credentials/TLS without shelling in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smtp_error: Option<String>,
    /// When the status snapshot was taken (server clock, UTC).
    pub checked_at: DateTime<Utc>,
}

/// Request body for `POST /api/admin/email/test`.
///
/// HIGH-4 (security-2026-05-13.md): this used to accept an optional `to`
/// field that defaulted to the admin's own email when absent. Validated
/// only as a well-formed address, it turned the endpoint into a free
/// SMTP relay through the production mail account — a compromised
/// admin token (or a misconfigured frontend) could send arbitrary
/// content to arbitrary addresses, burning sender reputation and the
/// relay's quota.
///
/// The field is now gone. The handler always sends to `user.email`
/// (the authenticated admin's own address from the JWT). The frontend
/// already calls this endpoint with no body, so no client change is
/// needed; any client that still sends a `to` value simply has it
/// ignored by serde (no `deny_unknown_fields`).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SendTestEmailRequest {}

/// Response for `POST /api/admin/email/test`.
///
/// Field shape matches the `TestResult` interface in `EmailServicePage.tsx`,
/// with `imapReceived` always `null` (no IMAP loopback yet — see module docs).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestEmailResponse {
    /// Did the SMTP send succeed (server accepted the message for delivery)?
    /// Not the same as "delivered to inbox" — SMTP can return 250 OK and
    /// the message can still bounce later.
    pub success: bool,
    /// Synthetic identifier so the operator can correlate this attempt
    /// with logs. Returned even on failure.
    pub test_id: String,
    /// SMTP-level result. `true` if the server accepted the message,
    /// `false` if there was an error. Mirrors `success` for now; kept
    /// separate so we don't conflate "overall success" with "SMTP send"
    /// once a real loopback check is added.
    pub smtp_sent: bool,
    /// Reserved for a future SMTP→IMAP loopback check. Always `null` here.
    pub imap_received: Option<bool>,
    /// SMTP send duration in milliseconds. Useful for ops to spot
    /// latency regressions on the relay.
    pub delivery_time_ms: u64,
    /// Error message on failure. Omitted on success.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The address we actually sent to (resolved from request or JWT).
    pub recipient: String,
}

// ============================================================================
// Helpers
// ============================================================================

/// Reject the request unless the caller has the `admin` role (or higher).
///
/// Duplicated locally for the same reason `admin_rooms` does it — keeps this
/// module independent of `admin`'s private helpers.
fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !has_role(user, "admin") {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }
    Ok(())
}

/// Build a fresh `EmailServiceImpl` from current `Settings`.
///
/// We rebuild per-request instead of caching on `AppState` because:
///   1. The settings can change at runtime via `.env` reload (someone fixes
///      SMTP creds without restarting the binary in dev).
///   2. The cost is a single `Arc::new` over a configured transport — the
///      underlying `lettre` connection pool is owned by the transport
///      object, which we *do* keep within a single request.
///   3. This mirrors how `routes/auth.rs` builds it for the password-reset
///      send, so the pattern stays consistent across the codebase.
fn build_email_service(state: &AppState) -> EmailServiceImpl {
    EmailServiceImpl::from_smtp_config(
        &state.config().email.smtp,
        &state.config().server.frontend_url,
    )
}

/// Atomically increment the admin's daily test-email counter in Redis
/// and return the new count.
///
/// Key shape: `email_test_quota:{admin_id}:{YYYY-MM-DD}`. EXPIRE is set
/// only on the first increment (via the Lua script below) so the TTL
/// doesn't keep getting pushed back. Lifespan is ~36h to comfortably
/// outlive the UTC day rollover regardless of clock skew between the
/// backend and the Redis server.
///
/// Fail-open on Redis errors: returning 0 here means the quota check
/// won't reject a legitimate operator request because Redis blipped.
/// The send is still rate-limited by SMTP itself and audit-logged via
/// `tracing::info!`. This mirrors the existing pattern in
/// `middleware::rate_limit::RedisRateLimiter::check`.
async fn increment_test_email_quota(state: &AppState, admin_id: &str) -> u32 {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let key = format!("email_test_quota:{}:{}", admin_id, today);
    let mut conn = state.redis();

    let script = redis::Script::new(
        r#"
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return count
        "#,
    );

    // 36 hours = 129_600 s, covers any reasonable UTC-rollover skew.
    match script
        .key(&key)
        .arg(129_600_i64)
        .invoke_async::<_, i64>(&mut conn)
        .await
    {
        Ok(count) => count.max(0) as u32,
        Err(e) => {
            tracing::warn!(
                admin_id = %admin_id,
                error = %e,
                "Redis quota INCR failed — failing open"
            );
            0
        },
    }
}

/// Seconds remaining until the next UTC-day rollover. Used as the
/// `retry-after` hint when an admin hits the daily quota.
fn seconds_until_next_utc_day() -> u64 {
    let now = Utc::now();
    let tomorrow = (now + chrono::Duration::days(1))
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| naive.and_local_timezone(Utc).single());
    match tomorrow {
        Some(t) => (t - now).num_seconds().max(0) as u64,
        // Theoretically unreachable (date_naive + ms 0 is always valid).
        // Fall through to a safe small retry interval.
        None => 3600,
    }
}

/// Read the current count without incrementing. Used to enforce the
/// quota on a hit at TEST_EMAIL_DAILY_QUOTA + 1 (i.e. after the bump
/// in `increment_test_email_quota`). Kept separate so the handler
/// can also support a "what's my remaining quota?" probe in the
/// future without double-incrementing.
#[allow(dead_code)]
async fn get_test_email_quota(state: &AppState, admin_id: &str) -> u32 {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let key = format!("email_test_quota:{}:{}", admin_id, today);
    let mut conn = state.redis();

    match conn.get::<_, Option<u32>>(&key).await {
        Ok(Some(count)) => count,
        Ok(None) => 0,
        Err(e) => {
            tracing::warn!(
                admin_id = %admin_id,
                error = %e,
                "Redis quota GET failed — assuming 0"
            );
            0
        },
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// `GET /api/admin/email/status`
///
/// Returns a snapshot of the email-service state. Always 200 with a JSON
/// body — even if SMTP is broken, this endpoint succeeds and reports
/// `smtp_connected: false` plus an error string.
async fn get_email_status(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
) -> AppResult<Json<EmailStatusResponse>> {
    require_admin(&user)?;

    let smtp_configured = state.config().email.smtp.is_configured();
    let imap_configured = state.config().email.imap.is_configured();

    // Run the SMTP probe only when configured — otherwise we'd build a
    // pointless transport and call `test_connection` on nothing. Catch
    // errors so an unhealthy SMTP doesn't 500 the status endpoint; that
    // would defeat the entire point of "status".
    let (smtp_connected, smtp_error) = if smtp_configured {
        let svc = build_email_service(&state);
        match svc.verify_connection().await {
            Ok(true) => (true, None),
            Ok(false) => (
                false,
                Some("SMTP server closed the connection before handshake completed".to_string()),
            ),
            Err(e) => (false, Some(e.to_string())),
        }
    } else {
        (false, None)
    };

    Ok(Json(EmailStatusResponse {
        configured: smtp_configured && imap_configured,
        smtp_connected,
        imap_connected: imap_configured,
        smtp_probed: smtp_configured,
        imap_probed: false,
        smtp_error,
        checked_at: Utc::now(),
    }))
}

/// `POST /api/admin/email/test`
///
/// Sends a real test email to the AUTHENTICATED ADMIN's OWN address
/// (taken from the JWT email claim) and reports the SMTP-side outcome.
///
/// Returns HTTP 202 (Accepted) on success — semantically "we handed it
/// to the relay", because we can't actually verify delivery without an
/// IMAP loopback (see module docs).
///
/// Failure returns HTTP 200 with `success: false` and an error message,
/// rather than a 5xx — the request was processed correctly; only the
/// downstream send failed. The frontend reads the `success` field to
/// decide which banner to render.
///
/// HIGH-4 hardening (security-2026-05-13.md):
/// - The recipient is hard-coded to `user.email`. The request body has
///   no field for picking an alternate destination, so a compromised
///   admin token can no longer use this as a free SMTP relay.
/// - Per-admin daily quota in Redis (`TEST_EMAIL_DAILY_QUOTA` sends per
///   UTC day). Exceeding it returns 429.
///
/// LOW-4 hardening (security-2026-05-13.md):
/// - Logs include only a 12-hex-char SHA-256 hash of the recipient
///   (`email_hash`), not the raw address. Support can still correlate
///   "the test send my admin made at 12:03" with a log line via the
///   hash, but the PII email value no longer persists in long-term log
///   retention. Source of truth for the hash is `utils::hash_email`.
async fn send_test_email(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    _payload: Option<Json<SendTestEmailRequest>>,
) -> AppResult<impl IntoResponse> {
    require_admin(&user)?;

    // Recipient is the authenticated admin's own email — never anything
    // a client can override. JWT is required to reach this handler, so
    // `user.email` should always be present; we surface a 400 if it
    // isn't rather than silently dropping the send.
    let recipient = user.email.clone().ok_or_else(|| {
        AppError::BadRequest(
            "Admin token missing email claim; cannot resolve recipient".to_string(),
        )
    })?;

    // Quota check — Redis-backed daily counter, fail-open on Redis errors.
    let count = increment_test_email_quota(&state, &user.id).await;
    if count > TEST_EMAIL_DAILY_QUOTA {
        let recipient_hash = hash_email(&recipient);
        tracing::warn!(
            admin_id = %user.id,
            email_hash = %recipient_hash,
            count = count,
            quota = TEST_EMAIL_DAILY_QUOTA,
            "Admin test email quota exceeded"
        );
        // Retry-after = seconds until the next UTC day rollover. Clamped to a
        // sensible floor (60s) so callers always see a forward-looking value
        // even right before midnight.
        let retry_after = seconds_until_next_utc_day().max(60);
        return Err(AppError::TooManyRequests(retry_after));
    }

    let test_id = Uuid::new_v4().to_string();
    let started = std::time::Instant::now();
    let recipient_hash = hash_email(&recipient);

    let svc = build_email_service(&state);
    if !svc.is_configured() {
        return Ok((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(TestEmailResponse {
                success: false,
                test_id,
                smtp_sent: false,
                imap_received: None,
                delivery_time_ms: started.elapsed().as_millis() as u64,
                error: Some(
                    "SMTP is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS to enable."
                        .to_string(),
                ),
                recipient,
            }),
        )
            .into_response());
    }

    // Construct an unambiguous test email so an operator can find it later
    // in their inbox. Include the test_id so support requests are
    // self-correlating with server logs.
    let subject = format!("Loyalty admin test email [{}]", &test_id);
    let body = format!(
        r#"<p>This is a test email from the loyalty admin panel.</p>
<p>Test ID: <code>{test_id}</code></p>
<p>Sent at: {sent_at}</p>
<p>If you received this, your SMTP relay is working.</p>"#,
        test_id = test_id,
        sent_at = Utc::now().to_rfc3339(),
    );

    match svc.send_email(&recipient, &subject, &body).await {
        Ok(()) => {
            // LOW-4: log only the hash, never the raw email. The
            // response body still echoes `recipient` so the admin UI
            // can render "sent to <your address>", but server logs
            // retain only the correlation token.
            tracing::info!(
                test_id = %test_id,
                admin_id = %user.id,
                email_hash = %recipient_hash,
                quota_count = count,
                "Admin sent test email"
            );
            Ok((
                StatusCode::ACCEPTED,
                Json(TestEmailResponse {
                    success: true,
                    test_id,
                    smtp_sent: true,
                    imap_received: None,
                    delivery_time_ms: started.elapsed().as_millis() as u64,
                    error: None,
                    recipient,
                }),
            )
                .into_response())
        },
        Err(e) => {
            // LOW-4: same as the success path — log only the hash.
            tracing::error!(
                test_id = %test_id,
                admin_id = %user.id,
                email_hash = %recipient_hash,
                error = %e,
                "Admin test email failed"
            );
            // 200 with success=false rather than 5xx — see handler docs.
            Ok((
                StatusCode::OK,
                Json(TestEmailResponse {
                    success: false,
                    test_id,
                    smtp_sent: false,
                    imap_received: None,
                    delivery_time_ms: started.elapsed().as_millis() as u64,
                    error: Some(e.to_string()),
                    recipient,
                }),
            )
                .into_response())
        },
    }
}

// ============================================================================
// Router
// ============================================================================

/// Build the admin email sub-router.
///
/// Intended to be `.merge`d into the parent admin router (defined in
/// `crate::routes::admin`) so the shared `auth_middleware` layer covers
/// these routes too. Mounted at `/api/admin/...` by the top-level router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/email/status", get(get_email_status))
        .route("/email/test", post(send_test_email))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_admin_accepts_admin_role() {
        let admin = AuthUser {
            id: Uuid::new_v4().to_string(),
            email: Some("admin@test".to_string()),
            role: "admin".to_string(),
        };
        assert!(require_admin(&admin).is_ok());
    }

    #[test]
    fn require_admin_rejects_customer_role() {
        let customer = AuthUser {
            id: Uuid::new_v4().to_string(),
            email: Some("user@test".to_string()),
            role: "customer".to_string(),
        };
        assert!(require_admin(&customer).is_err());
    }

    #[test]
    fn send_test_email_request_default_is_empty() {
        // HIGH-4: the `to` field has been removed from the request DTO.
        // Constructing the default request must continue to work because
        // the frontend calls this endpoint with no body.
        let _empty = SendTestEmailRequest::default();
    }

    #[test]
    fn send_test_email_request_ignores_unknown_to_field() {
        // Defensive: a stale client that still includes `"to": "..."` in
        // the body must NOT be able to redirect the test email anywhere.
        // serde's default (`deny_unknown_fields` is OFF) drops the field
        // silently, so deserialisation succeeds and the handler ends up
        // sending to the admin's own address.
        let raw = r#"{"to":"attacker@example.com"}"#;
        let _req: SendTestEmailRequest = serde_json::from_str(raw)
            .expect("legacy clients sending `to` must still deserialise (field is ignored)");
    }

    #[test]
    fn shared_hash_email_helper_is_used_for_recipient_logging() {
        // LOW-4: the local `hash_recipient` was retired in favour of
        // the shared `utils::hash_email` so OAuth and admin paths
        // produce identical hashes for the same email. Keep the
        // historical case/whitespace properties pinned here so a
        // future refactor of `hash_email` can't silently regress them
        // for the admin-email path.
        let a = hash_email("ops@example.com");
        let b = hash_email("OPS@example.com");
        let c = hash_email("  ops@example.com  ");
        let d = hash_email("other@example.com");

        assert_eq!(a.len(), 12, "hash should be 12 hex chars (48 bits)");
        assert_eq!(a, b, "hash must be case-insensitive");
        assert_eq!(a, c, "hash must trim surrounding whitespace");
        assert_ne!(a, d, "different inputs must hash to different values");
    }

    #[test]
    fn seconds_until_next_utc_day_is_positive_and_bounded() {
        let s = seconds_until_next_utc_day();
        assert!(
            s > 0,
            "must always be positive (clock has moved past today)"
        );
        assert!(s <= 24 * 60 * 60, "at most one full day's worth of seconds");
    }

    #[test]
    fn email_status_response_serialises_camel_case() {
        let resp = EmailStatusResponse {
            configured: true,
            smtp_connected: true,
            imap_connected: false,
            smtp_probed: true,
            imap_probed: false,
            smtp_error: None,
            checked_at: Utc::now(),
        };
        let json = serde_json::to_string(&resp).expect("serialise EmailStatusResponse");
        // Field names must match the frontend interface (camelCase).
        assert!(json.contains("\"smtpConnected\":true"));
        assert!(json.contains("\"imapConnected\":false"));
        assert!(json.contains("\"smtpProbed\":true"));
        assert!(json.contains("\"imapProbed\":false"));
        // smtp_error is omitted when None to keep the response compact.
        assert!(!json.contains("smtpError"));
    }
}
