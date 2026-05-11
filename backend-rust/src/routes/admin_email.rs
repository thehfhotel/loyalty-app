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
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{has_role, AuthUser};
use crate::services::email::{EmailService, EmailServiceImpl};
use crate::state::AppState;

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
/// The frontend currently calls this with no body (`testMutation` in
/// `EmailServicePage.tsx`). We accept an optional recipient override for
/// future use; default behaviour sends to the calling admin's own email
/// (taken from the JWT) so an operator never accidentally spams a customer
/// while testing.
#[derive(Debug, Clone, Deserialize, Validate, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SendTestEmailRequest {
    /// Optional override. If omitted, we send to the authenticated admin's
    /// own email address. Validated as an email so a typo doesn't end up
    /// triggering an SMTP error deep in lettre.
    #[validate(email(message = "Invalid email address"))]
    pub to: Option<String>,
}

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
/// Sends a real test email and reports the SMTP-side outcome. Returns
/// HTTP 202 (Accepted) on success — semantically "we handed it to the
/// relay", because we can't actually verify delivery without an IMAP
/// loopback (see module docs).
///
/// Failure returns HTTP 200 with `success: false` and an error message,
/// rather than a 5xx — the request was processed correctly; only the
/// downstream send failed. The frontend reads the `success` field to
/// decide which banner to render.
async fn send_test_email(
    Extension(user): Extension<AuthUser>,
    State(state): State<AppState>,
    payload: Option<Json<SendTestEmailRequest>>,
) -> AppResult<impl IntoResponse> {
    require_admin(&user)?;

    // Validate body if present. Empty body is fine — the frontend currently
    // sends no body and we default to the admin's own email.
    let req = payload.map(|Json(p)| p).unwrap_or_default();
    req.validate().map_err(AppError::from)?;

    // Resolve recipient: explicit `to` wins; otherwise the JWT's email.
    // JWT is required for admin endpoints, so `user.email` should always
    // be present — but defend against the edge case anyway.
    let recipient = req
        .to
        .clone()
        .or_else(|| user.email.clone())
        .ok_or_else(|| {
            AppError::BadRequest(
            "No recipient available: provide `to` in the request body or ensure the admin token \
             carries an email claim"
                .to_string(),
        )
        })?;

    let test_id = Uuid::new_v4().to_string();
    let started = std::time::Instant::now();

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
            tracing::info!(
                test_id = %test_id,
                recipient = %recipient,
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
            tracing::error!(
                test_id = %test_id,
                recipient = %recipient,
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
    fn send_test_email_request_validates_address() {
        let bad = SendTestEmailRequest {
            to: Some("not-an-email".to_string()),
        };
        assert!(bad.validate().is_err());

        let good = SendTestEmailRequest {
            to: Some("ops@example.com".to_string()),
        };
        assert!(good.validate().is_ok());

        // Empty / default request is valid (handler will fall back to
        // the authenticated admin's own address).
        let empty = SendTestEmailRequest::default();
        assert!(empty.validate().is_ok());
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
