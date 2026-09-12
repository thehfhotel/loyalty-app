//! LINE Platform integration for the two property OAs.
//!
//! Covers the three LINE surfaces introduced by the OA integration
//! (docs/launch-plan.md):
//! - LIFF ID-token verification (silent enrollment login)
//! - Messaging API webhook signature verification (follow/unfollow)
//! - Messaging API push with property-affinity routing (ADR-0001/0002)
//!
//! Every push here is metered by `services::push_budget` first: each OA is on
//! the LINE free plan and the month's ~300 messages are a shared, hard cap
//! (C5). A push whose bucket is spent is a logged no-op, never an error the
//! guest can see.

use base64::Engine;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Settings;
use crate::error::{AppError, AppResult};
use crate::services::http::outbound;
use crate::services::push_budget::{
    PushBucket, PushBudget, PushResult, PushTargetHash, ReserveOutcome,
};
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

/// Why a push did or did not reach LINE.
///
/// Every non-delivery here is a normal situation, not an error — but each
/// one is a *different* normal situation, and "the member deleted their
/// account" must be distinguishable from "LINE is misconfigured" in the
/// logs. A bare `false` could not tell them apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushOutcome {
    /// A message was accepted by one OA's Messaging API.
    Delivered,
    /// No row in `push_targets` with a LINE identity for this user id.
    /// Either the account never signed in with LINE, **or it has been
    /// erased (`users.deleted_at`) or deactivated** — the view hides
    /// both, which is what makes an erased member unreachable.
    NoPushTarget,
    /// A LINE identity exists but is not friends with any property OA.
    NoFriendship,
    /// Friended, but no friended OA has a usable channel token, or every
    /// attempt was rejected by LINE.
    NoChannel,
    /// A friended, configured OA was reachable, but its share of the LINE
    /// free plan is spent for the month (C5). Distinct from `NoChannel`
    /// because nothing is wrong with the configuration — the allowance ran
    /// out, and the fix is a budget decision, not a credential.
    BudgetExhausted,
}

impl PushOutcome {
    /// Stable, log-safe reason string. Contains no personal data.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Delivered => "delivered",
            Self::NoPushTarget => "no_push_target",
            Self::NoFriendship => "no_friendship",
            Self::NoChannel => "no_channel",
            Self::BudgetExhausted => "budget_exhausted",
        }
    }

    /// `true` only when LINE accepted the message.
    pub fn delivered(self) -> bool {
        matches!(self, Self::Delivered)
    }
}

/// Property-affinity push routing (docs/launch-plan.md):
/// the event property's OA speaks if the member is its friend; otherwise
/// any other friended OA; otherwise no push. For program-wide events
/// (`event_property = None`) the property of the most recent stay leads.
///
/// Returns the [`PushOutcome`] — `Delivered`, or the reason nothing was
/// sent. An erased or deactivated account resolves to
/// [`PushOutcome::NoPushTarget`] because the `push_targets` view does not
/// contain it (migration `20260914020000`; PDPA data map §6 / §8 gap P1-3).
///
/// ## Budget (C5)
///
/// `bucket` names whose share of the OA's LINE free plan this push spends —
/// [`PushBucket::Ops`] for stay accruals and ops messages,
/// [`PushBucket::Campaign`] for admin broadcasts. The reservation is taken
/// **per candidate OA and only once a usable channel token has been found**,
/// so an unconfigured OA never costs a configured one its quota. An OA whose
/// bucket is spent is skipped like a failed send: the next friended OA gets a
/// turn, and only if every candidate refused on budget does the call answer
/// [`PushOutcome::BudgetExhausted`].
///
/// To spend the reserve bucket, call
/// [`PushBudget::reserve_with_override`][crate::services::push_budget::PushBudget::reserve_with_override]
/// directly; this routing never draws on it.
pub async fn push_to_member(
    db: &PgPool,
    settings: &Settings,
    user_id: Uuid,
    event_property: Option<Property>,
    bucket: PushBucket,
    text: &str,
) -> AppResult<PushOutcome> {
    // Resolve the member's LINE userId (LINE Login / LIFF identity).
    //
    // `push_targets`, never `users`: the view excludes erased accounts
    // (`users.deleted_at`) and deactivated ones by construction, so this
    // query cannot forget the predicate and neither can the next dispatch
    // path somebody adds. Migration 20260914020000; PDPA data map §6.
    let line_user_id: Option<String> = sqlx::query_scalar!(
        r#"SELECT oauth_provider_id FROM push_targets WHERE id = $1 AND oauth_provider = 'line'"#,
        user_id
    )
    .fetch_optional(db)
    .await?
    .flatten();

    let Some(line_user_id) = line_user_id else {
        return Ok(PushOutcome::NoPushTarget);
    };

    // Which OAs is this LINE user currently a friend of?
    let friended: Vec<String> = sqlx::query_scalar!(
        r#"SELECT property FROM line_friendships WHERE line_user_id = $1 AND is_friend"#,
        line_user_id
    )
    .fetch_all(db)
    .await?;

    if friended.is_empty() {
        return Ok(PushOutcome::NoFriendship);
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

    // The only form of the member's LINE identity that reaches the ledger.
    let target = PushTargetHash::of(&line_user_id);
    let budget = PushBudget::from_settings(settings);
    let mut refused_on_budget = false;

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

        // Spend the quota only once there is something to spend it on.
        let reservation = match budget.reserve(db, property, bucket, &target).await {
            Ok(ReserveOutcome::Granted(reservation)) => reservation,
            Ok(ReserveOutcome::Refused(refusal)) => {
                // A refusal is a normal operating state, not a fault: the
                // month's share of a hard external cap is gone. The guest
                // must never see an error for it, so this is a logged no-op.
                tracing::warn!(
                    property = %property,
                    bucket = %bucket,
                    reason = refusal.reason(),
                    "LINE push refused by the budget guard; not sending"
                );
                refused_on_budget = true;
                continue;
            },
            Err(e) => {
                // The guard itself failing must not take the push path down
                // with it, and must not silently hand out free quota either:
                // skip this OA, exactly as an unusable channel would.
                tracing::error!(
                    property = %property,
                    bucket = %bucket,
                    error = %e,
                    "LINE push budget reservation failed; skipping this OA"
                );
                continue;
            },
        };

        match push_text(token, &line_user_id, text).await {
            Ok(()) => {
                if let Err(e) = budget.settle(db, &reservation, PushResult::Delivered).await {
                    tracing::warn!(error = %e, "LINE push ledger settle failed");
                }
                return Ok(PushOutcome::Delivered);
            },
            Err(e) => {
                if let Err(settle_err) = budget.settle(db, &reservation, PushResult::Failed).await {
                    tracing::warn!(error = %settle_err, "LINE push ledger settle failed");
                }
                // Fall through to the next friended OA rather than failing
                // the caller — push is best-effort by design.
                tracing::warn!(property = %property, error = %e, "LINE push failed; trying next OA");
            },
        }
    }

    if refused_on_budget {
        return Ok(PushOutcome::BudgetExhausted);
    }

    Ok(PushOutcome::NoChannel)
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
