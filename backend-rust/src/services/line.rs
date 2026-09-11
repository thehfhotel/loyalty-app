//! LINE Platform integration for the two property OAs.
//!
//! Covers the three LINE surfaces introduced by the OA integration
//! (docs/launch-plan.md):
//! - LIFF ID-token verification (silent enrollment login)
//! - Messaging API webhook signature verification (follow/unfollow)
//! - Messaging API push with property-affinity routing (ADR-0001/0002)

use base64::Engine;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Settings;
use crate::error::{AppError, AppResult};
use crate::services::http::outbound;
use crate::types::Property;

const LINE_VERIFY_URL: &str = "https://api.line.me/oauth2/v2.1/verify";
const LINE_PUSH_URL: &str = "https://api.line.me/v2/bot/message/push";

/// Claims returned by LINE's ID-token verify endpoint.
#[derive(Debug, Deserialize)]
pub struct LineIdTokenClaims {
    /// LINE userId — shared across all channels under our provider
    /// (ADR-0002), so it matches `users.oauth_provider_id` for members
    /// who signed in with LINE Login.
    pub sub: String,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub email: Option<String>,
}

/// Verify a LIFF ID token with LINE. `client_id` is the LINE Login channel
/// ID (the LIFF app is attached to that channel).
pub async fn verify_liff_id_token(id_token: &str, client_id: &str) -> AppResult<LineIdTokenClaims> {
    // Bounded and shared: an unbounded client here parks a silent-enrollment
    // login until the router's own timeout fires. See `services::http`.
    let response = outbound()
        .post(LINE_VERIFY_URL)
        .form(&[("id_token", id_token), ("client_id", client_id)])
        .send()
        .await
        .map_err(|e| AppError::OAuth(format!("LINE ID-token verify request failed: {e}")))?;

    if !response.status().is_success() {
        // Never log the token itself; the status is enough for diagnosis.
        tracing::warn!(status = %response.status(), "LIFF ID-token rejected by LINE");
        return Err(AppError::Unauthorized("Invalid LIFF ID token".to_string()));
    }

    response
        .json::<LineIdTokenClaims>()
        .await
        .map_err(|e| AppError::OAuth(format!("LINE ID-token verify response malformed: {e}")))
}

/// Verify an `X-Line-Signature` header against the raw request body.
/// The signature is base64(HMAC-SHA256(channel_secret, body)).
pub fn verify_line_signature(channel_secret: &str, body: &[u8], signature_b64: &str) -> bool {
    let Ok(given) = base64::engine::general_purpose::STANDARD.decode(signature_b64) else {
        return false;
    };
    let mut mac = Hmac::<Sha256>::new_from_slice(channel_secret.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(body);
    // verify_slice is constant-time.
    mac.verify_slice(&given).is_ok()
}

/// Push a plain-text message to one LINE user via one OA's channel token.
pub async fn push_text(access_token: &str, to: &str, text: &str) -> AppResult<()> {
    let body = serde_json::json!({
        "to": to,
        "messages": [{ "type": "text", "text": text }],
    });
    let response = outbound()
        .post(LINE_PUSH_URL)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::OAuth(format!("LINE push request failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!(
            "LINE push rejected: {status} {detail}"
        )));
    }
    Ok(())
}

/// Property-affinity push routing (docs/launch-plan.md):
/// the event property's OA speaks if the member is its friend; otherwise
/// any other friended OA; otherwise no push. For program-wide events
/// (`event_property = None`) the property of the most recent stay leads.
///
/// Returns `Ok(true)` if a message was delivered to LINE, `Ok(false)` if the
/// member has no LINE identity / no friendship / no configured channel —
/// those are normal situations, not errors.
pub async fn push_to_member(
    db: &PgPool,
    settings: &Settings,
    user_id: Uuid,
    event_property: Option<Property>,
    text: &str,
) -> AppResult<bool> {
    // Resolve the member's LINE userId (LINE Login / LIFF identity).
    let line_user_id: Option<String> = sqlx::query_scalar!(
        r#"SELECT oauth_provider_id FROM users WHERE id = $1 AND oauth_provider = 'line'"#,
        user_id
    )
    .fetch_optional(db)
    .await?
    .flatten();

    let Some(line_user_id) = line_user_id else {
        return Ok(false);
    };

    // Which OAs is this LINE user currently a friend of?
    let friended: Vec<String> = sqlx::query_scalar!(
        r#"SELECT property FROM line_friendships WHERE line_user_id = $1 AND is_friend"#,
        line_user_id
    )
    .fetch_all(db)
    .await?;

    if friended.is_empty() {
        return Ok(false);
    }

    // Lead OA: the event's property, or for program-wide events the
    // property of the most recent stay.
    let lead = match event_property {
        Some(p) => Some(p),
        None => sqlx::query_scalar!(
            r#"SELECT property FROM stays WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1"#,
            user_id
        )
        .fetch_optional(db)
        .await?
        .and_then(|p| p.parse::<Property>().ok()),
    };

    // Ordered candidates: lead first, then the rest.
    let mut candidates: Vec<Property> = Vec::with_capacity(Property::ALL.len());
    if let Some(lead) = lead {
        candidates.push(lead);
    }
    for p in Property::ALL {
        if !candidates.contains(&p) {
            candidates.push(p);
        }
    }

    for property in candidates {
        if !friended.iter().any(|f| f == property.as_str()) {
            continue;
        }
        let Some(channel) = settings.line_messaging.channel(property.as_str()) else {
            continue;
        };
        let Some(token) = channel.access_token.as_ref() else {
            tracing::warn!(property = %property, "LINE channel not configured; skipping push");
            continue;
        };
        match push_text(token, &line_user_id, text).await {
            Ok(()) => return Ok(true),
            Err(e) => {
                // Fall through to the next friended OA rather than failing
                // the caller — push is best-effort by design.
                tracing::warn!(property = %property, error = %e, "LINE push failed; trying next OA");
            },
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_verification_accepts_valid_hmac() {
        let secret = "test-channel-secret";
        let body = br#"{"events":[]}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        assert!(verify_line_signature(secret, body, &sig));
    }

    #[test]
    fn signature_verification_rejects_wrong_secret_and_garbage() {
        let body = br#"{"events":[]}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret-a").unwrap();
        mac.update(body);
        let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        assert!(!verify_line_signature("secret-b", body, &sig));
        assert!(!verify_line_signature("secret-a", body, "not-base64!!"));
        assert!(!verify_line_signature("secret-a", b"tampered", &sig));
    }
}
