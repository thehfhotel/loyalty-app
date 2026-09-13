//! Read-only reporting credential (task D14b).
//!
//! ## Why this exists
//!
//! The weekly measurement pack is assembled by an agent that has no admin
//! account and cannot get one. Until this module existed, the only way it
//! could read production numbers was a superuser `psql` session — which
//! contradicts this repo's own hard rule 5 (`CLAUDE.md`): *never touch the
//! database directly, go through the backend API*. A read that breaks the
//! rule every week is a rule nobody believes, and a superuser session is a
//! far larger grant than the three numbers it was opened for.
//!
//! So: one optional secret, `REPORT_READ_TOKEN`, accepted **only** as
//! `Authorization: Bearer <token>`, on **exactly three GET endpoints**:
//!
//! | Route | What the pack reads |
//! |---|---|
//! | `GET /api/analytics/deposit-funnel` | funnel stages + friction proxies |
//! | `GET /api/admin/stats` | `total_users`, `lineFollowers` |
//! | `GET /api/admin/slips/agreement-report` | SlipOK shadow-window agreement |
//!
//! ## What it is NOT
//!
//! It is not an admin login and it does not mint one. A match inserts a
//! [`ReportPrincipal`] marker into the request extensions and nothing
//! else: no `AuthUser`, no user row, no role string, no JWT. Handlers ask
//! for [`ReportAccess`], which accepts *either* an admin `AuthUser` (the
//! existing path, unchanged) *or* that marker.
//!
//! The marker can only be created by this middleware, and this middleware
//! is mounted with `route_layer` on those three routes alone. Every other
//! admin route is still behind `auth_middleware`, which sees a bearer that
//! is not a JWT and answers 401 — so setting the secret widens nothing.
//! `report_token_is_refused_on_other_admin_routes` in
//! `tests/integration/report_token_test.rs` is the standing proof.
//!
//! ## Blank means off
//!
//! [`crate::config::ReportReadConfig`] reads the variable through
//! `env_present`, so the `${REPORT_READ_TOKEN:-}` every compose file
//! passes on a stack where nobody set the secret arrives as `None`, not as
//! `Some("")`. With `None` this middleware is a pass-through: it does not
//! read the header, does not charge a budget, and does not write a row.
//!
//! ## Order of operations on a request that carries a bearer
//!
//! 1. **Budget first.** The per-IP bucket is charged *before* the
//!    comparison, so guessing the token costs the guesser their budget.
//!    Charging after a successful match would leave the guessing path
//!    unbudgeted, which is the only path worth budgeting.
//! 2. **Constant-time compare** of SHA-256 digests. Digests so the
//!    comparison length cannot depend on the shared prefix, and a
//!    branch-free accumulate so it cannot depend on the first differing
//!    byte either. Same shape as `routes::loyalty::verify_service_token`.
//! 3. **Audit, fail-closed.** A matched request is written to
//!    `user_audit_log` before the handler runs. If that insert fails the
//!    request is refused: "every use is recorded" is the entire argument
//!    for handing a machine a production credential, and an unrecorded
//!    read would quietly falsify it. This is the one place in the codebase
//!    that does NOT treat an audit write as best-effort, on purpose.
//! 4. Insert the marker and continue.
//!
//! A bearer that does not match is passed through **untouched** rather
//! than refused — an admin JWT arrives in exactly the same header, and
//! refusing here would break the admin dashboard.
//!
//! ## Why `user_audit_log` and not `booking_audit_log`
//!
//! `booking_audit_log` is `booking_id UUID NOT NULL` FK `bookings` and
//! `admin_id UUID NOT NULL` FK `users`. A report read is not about one
//! booking and the reader deliberately has no user row, so a row could
//! only be written by inventing both — a migration and a fake user, to
//! record a read. `user_audit_log.user_id` is nullable with no such
//! demand, which is why it is the table that fits and why this change
//! needs no migration.

use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::error::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::rate_limit::{
    peer_ip, resolve_client_ip, RateLimitConfig, RateLimitError, RedisRateLimiter, TrustedProxies,
};
use crate::state::AppState;

/// The actor name written to `user_audit_log.details->>'actor'`.
///
/// Locked: `docs/ops/weekly-pack-access.md` tells the owner to audit the
/// pack's reads with `details->>'actor' = 'report_token'`.
pub const REPORT_TOKEN_ACTOR: &str = "report_token";

/// The `user_audit_log.action` every report-token read is filed under.
pub const REPORT_TOKEN_ACTION: &str = "report_token_read";

/// Requests per minute per client address, charged on any request that
/// reaches one of the three routes carrying a bearer while the feature is
/// configured.
///
/// Generous on purpose: the weekly pack makes three calls, and the same
/// bucket is shared with admins reading `/api/admin/stats` from the
/// dashboard. It exists to bound *guessing*, not to ration reporting. The
/// global production limiter (100/min) still sits above it.
const REPORT_READ_BUDGET_PER_MINUTE: u32 = 60;

/// Window for [`REPORT_READ_BUDGET_PER_MINUTE`], in seconds.
const REPORT_READ_BUDGET_WINDOW_SECS: u64 = 60;

/// The three routes the report token can open, as a closed set.
///
/// A closed set rather than `request.uri().path()`: this value is written
/// into the audit row and into a log line, and a route string taken off
/// the request is a caller-influenced value in both places. Nothing
/// user-controlled reaches either.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportRoute {
    /// `GET /api/analytics/deposit-funnel`
    DepositFunnel,
    /// `GET /api/admin/stats`
    AdminStats,
    /// `GET /api/admin/slips/agreement-report`
    SlipAgreementReport,
}

impl ReportRoute {
    /// The mounted path, exactly as the owner recipe curls it.
    pub fn as_str(self) -> &'static str {
        match self {
            ReportRoute::DepositFunnel => "/api/analytics/deposit-funnel",
            ReportRoute::AdminStats => "/api/admin/stats",
            ReportRoute::SlipAgreementReport => "/api/admin/slips/agreement-report",
        }
    }
}

/// The synthetic read-only principal a matching `REPORT_READ_TOKEN` mints.
///
/// Carries no identity: there is no user id, no email and no role,
/// because there is no user. It is a capability marker, and the route it
/// names is the route it was minted on — it cannot be replayed onto
/// another one, because each mount builds its own [`ReportReadGuard`].
#[derive(Debug, Clone, Copy)]
pub struct ReportPrincipal {
    /// Which of the three routes minted this principal.
    pub route: ReportRoute,
}

/// Per-mount state for [`report_read_middleware`].
///
/// Built once at router-construction time, one per protected route.
#[derive(Clone)]
pub struct ReportReadGuard {
    /// Expected token. `None` = feature off; the middleware is inert.
    expected: Option<Arc<str>>,
    /// Which route this mount protects.
    route: ReportRoute,
    /// Per-IP guessing budget.
    limiter: RedisRateLimiter,
    /// Proxy hops whose `X-Forwarded-For` may be believed.
    trusted: Arc<TrustedProxies>,
    /// Audit sink.
    db: sqlx::PgPool,
}

impl ReportReadGuard {
    /// Build the guard for one route from application state.
    pub fn new(state: &AppState, route: ReportRoute) -> Self {
        let config = state.config();

        // `security.rate_limit_namespace` is empty in every real
        // deployment (so replicas share one bucket, which is the only way
        // a budget means what it says) and unique per `TestApp`, so the
        // suite's buckets cannot leak from one test into the next.
        let namespace = &config.security.rate_limit_namespace;
        let prefix = if namespace.is_empty() {
            "report_read".to_string()
        } else {
            format!("{namespace}:report_read")
        };

        Self {
            expected: config.report_read.token.as_deref().map(Arc::from),
            route,
            // Fail-OPEN (the default): a Redis blip must not take the
            // weekly pack or the admin dashboard down. The credential,
            // not the budget, is what keeps this path closed.
            limiter: RedisRateLimiter::new(
                state.redis(),
                RateLimitConfig::new(
                    REPORT_READ_BUDGET_PER_MINUTE,
                    REPORT_READ_BUDGET_WINDOW_SECS,
                ),
                prefix,
            ),
            trusted: Arc::new(TrustedProxies::parse(&config.security.trusted_proxies)),
            db: state.db().clone(),
        }
    }
}

/// Constant-time byte comparison.
///
/// Only ever fed two SHA-256 digests, so the length check is a formality
/// and never leaks anything about the secret; the accumulate is
/// branch-free so the timing cannot depend on the first differing byte.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// The bearer token on a request, if it carries one.
fn bearer(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

/// Record one report-token read. Returns `Err` if the row was not written.
///
/// Fail-closed by design — see the module docs. `user_id` is NULL: there
/// is no user, and inventing one to satisfy a column would be the same
/// fiction this whole design exists to avoid.
async fn record_use(
    db: &sqlx::PgPool,
    route: ReportRoute,
    client_ip: std::net::IpAddr,
    user_agent: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO user_audit_log (user_id, action, details, ip_address, user_agent)
        VALUES (NULL, $1, $2, $3::text::inet, $4)
        "#,
    )
    .bind(REPORT_TOKEN_ACTION)
    .bind(json!({
        "actor": REPORT_TOKEN_ACTOR,
        "route": route.as_str(),
    }))
    .bind(client_ip.to_string())
    // Bound, never formatted into the statement or the log line: it is a
    // caller-supplied string and this is the log-injection boundary.
    .bind(user_agent)
    .execute(db)
    .await
    .map(|_| ())
}

/// Accept `REPORT_READ_TOKEN` on this route and nowhere else.
///
/// Mounted with `route_layer` **outside** the route's auth layer, so it
/// runs first and a matched request never has to satisfy the JWT path.
/// Everything it does and the order it does it in are in the module docs.
pub async fn report_read_middleware(
    State(guard): State<ReportReadGuard>,
    mut request: Request,
    next: Next,
) -> Response {
    // Feature off. Not "off for this request" — off: no header read, no
    // Redis round trip, no audit row.
    let Some(expected) = guard.expected.clone() else {
        return next.run(request).await;
    };

    // No bearer at all: a cookie-authenticated admin, or an anonymous
    // caller the layers below will refuse. Nothing to do.
    let Some(presented) = bearer(request.headers()) else {
        return next.run(request).await;
    };

    let client_ip = resolve_client_ip(peer_ip(&request), request.headers(), &guard.trusted);

    // Budget BEFORE the comparison: the guessing path is the one that
    // needs bounding. Fail-open, so a Redis outage does not close the
    // pack's only sanctioned route.
    if let Err(err) = guard.limiter.check_subject(&client_ip.to_string()).await {
        return match err {
            RateLimitError::TooManyRequests { .. } => {
                tracing::warn!(
                    route = guard.route.as_str(),
                    client_ip = %client_ip,
                    "Report-read budget exceeded"
                );
                err.into_response()
            },
            // Only a fail-closed limiter produces this, and this one is
            // not. Kept exhaustive so a future `fail_closed()` here is a
            // deliberate edit rather than a silent behaviour change.
            RateLimitError::Unavailable => err.into_response(),
        };
    }

    if !constant_time_eq(
        &Sha256::digest(presented.as_bytes())[..],
        &Sha256::digest(expected.as_bytes())[..],
    ) {
        // Very probably an admin JWT — same header, different credential.
        // Pass it down untouched and let `optional_auth_middleware` and
        // `ReportAccess` decide. Nothing is logged: a mismatch here is the
        // normal case for every admin request.
        return next.run(request).await;
    }

    let user_agent = request
        .headers()
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(256).collect::<String>());

    if let Err(err) = record_use(&guard.db, guard.route, client_ip, user_agent.as_deref()).await {
        tracing::error!(
            route = guard.route.as_str(),
            error = %err,
            "Refusing a report-token read: its audit row could not be written"
        );
        return AppError::ServiceUnavailable(
            "Report access is temporarily unavailable.".to_string(),
        )
        .into_response();
    }

    tracing::info!(
        route = guard.route.as_str(),
        client_ip = %client_ip,
        "Report-token read"
    );

    request
        .extensions_mut()
        .insert(ReportPrincipal { route: guard.route });

    next.run(request).await
}

/// Who is allowed to read a reporting endpoint.
///
/// Replaces the `Extension<AuthUser>` + `require_admin(..)` pair on the
/// three routes the report token can open. An admin JWT behaves exactly as
/// it did before; the report principal is the only thing that is new, and
/// it is only ever present on a route whose mount installed
/// [`report_read_middleware`].
///
/// Deliberately not `Clone`-able into anything a handler could mistake for
/// an identity: the `Admin` arm carries the real [`AuthUser`] for handlers
/// that need it, the `ReportToken` arm carries a route and nothing else.
#[derive(Debug, Clone)]
pub enum ReportAccess {
    /// A logged-in admin or super_admin, exactly as before.
    Admin(AuthUser),
    /// The synthetic read-only principal minted by `REPORT_READ_TOKEN`.
    ReportToken(ReportRoute),
}

impl ReportAccess {
    /// `Some(user)` for a real admin, `None` for the report token.
    ///
    /// A handler that wants to attribute a *write* to its caller must use
    /// this and refuse on `None` — but no handler behind this extractor
    /// writes anything, which is the point.
    pub fn admin(&self) -> Option<&AuthUser> {
        match self {
            ReportAccess::Admin(user) => Some(user),
            ReportAccess::ReportToken(_) => None,
        }
    }
}

#[axum::async_trait]
impl<S> axum::extract::FromRequestParts<S> for ReportAccess
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // The capability marker wins: it can only have been inserted by
        // `report_read_middleware`, which can only be reached on a route
        // that mounted it.
        if let Some(principal) = parts.extensions.get::<ReportPrincipal>() {
            return Ok(ReportAccess::ReportToken(principal.route));
        }

        match parts.extensions.get::<AuthUser>() {
            // `has_role` and not `middleware::admin::is_admin`: these three
            // routes have always gated on the JWT role via `require_admin`,
            // and quietly widening them to the admins.json email list is
            // not this change's business.
            Some(user) if crate::middleware::auth::has_role(user, "admin") => {
                Ok(ReportAccess::Admin(user.clone()))
            },
            Some(_) => Err(AppError::Forbidden("Admin access required".to_string())),
            None => Err(AppError::Unauthorized(
                "Authentication required".to_string(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn constant_time_eq_agrees_with_plain_equality() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn digest_comparison_matches_only_the_same_token() {
        let expected = "s3cret-report-token";
        let digest = |s: &str| Sha256::digest(s.as_bytes()).to_vec();

        assert!(constant_time_eq(
            &digest(expected),
            &digest("s3cret-report-token")
        ));
        // A prefix of the real token must not match — the failure mode a
        // naive `starts_with` or a short-circuiting compare would have.
        assert!(!constant_time_eq(&digest(expected), &digest("s3cret")));
        assert!(!constant_time_eq(&digest(expected), &digest("")));
    }

    #[test]
    fn bearer_reads_only_the_bearer_scheme() {
        let mut headers = HeaderMap::new();
        assert_eq!(bearer(&headers), None);

        headers.insert(AUTHORIZATION, "Bearer abc123".parse().unwrap());
        assert_eq!(bearer(&headers), Some("abc123"));

        // Another scheme is not ours.
        headers.insert(AUTHORIZATION, "Basic abc123".parse().unwrap());
        assert_eq!(bearer(&headers), None);

        // `Bearer ` with nothing after it is not a credential. Belt to
        // `env_present`'s braces: even if a blank expected token ever
        // reached the guard, there is no presented token to match it.
        headers.insert(AUTHORIZATION, "Bearer    ".parse().unwrap());
        assert_eq!(bearer(&headers), None);
    }

    #[test]
    fn route_strings_are_the_mounted_paths() {
        // These literals are what `docs/ops/weekly-pack-access.md` tells
        // the owner to curl and what the audit row records. A typo here
        // makes the audit trail name a route that does not exist.
        assert_eq!(
            ReportRoute::DepositFunnel.as_str(),
            "/api/analytics/deposit-funnel"
        );
        assert_eq!(ReportRoute::AdminStats.as_str(), "/api/admin/stats");
        assert_eq!(
            ReportRoute::SlipAgreementReport.as_str(),
            "/api/admin/slips/agreement-report"
        );
    }

    #[test]
    fn report_access_admin_is_none_for_the_token_principal() {
        let token = ReportAccess::ReportToken(ReportRoute::AdminStats);
        assert!(token.admin().is_none());

        let admin = ReportAccess::Admin(AuthUser {
            id: "user-1".to_string(),
            email: None,
            role: "admin".to_string(),
        });
        assert_eq!(admin.admin().map(|u| u.role.as_str()), Some("admin"));
    }
}
