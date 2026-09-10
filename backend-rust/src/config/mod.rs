//! Configuration management module
//!
//! Handles loading and validating application configuration from environment variables.
//! Uses the `config` crate with `dotenvy` for .env file support.

use config::{ConfigError, Environment as ConfigEnvironment, File};
use serde::Deserialize;
use std::env;
use thiserror::Error;

/// Configuration errors
#[derive(Error, Debug)]
pub enum ConfigurationError {
    #[error("Configuration loading error: {0}")]
    LoadError(#[from] ConfigError),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Invalid value for {field}: {message}")]
    InvalidValue { field: String, message: String },
}

/// Environment types
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    #[default]
    Development,
    Staging,
    Production,
}

impl Environment {
    pub fn as_str(&self) -> &'static str {
        match self {
            Environment::Development => "development",
            Environment::Staging => "staging",
            Environment::Production => "production",
        }
    }
}

impl std::fmt::Display for Environment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl From<String> for Environment {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "production" => Environment::Production,
            "staging" => Environment::Staging,
            _ => Environment::Development,
        }
    }
}

/// Database configuration
#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    /// PostgreSQL connection URL
    #[serde(default = "default_database_url")]
    pub url: String,

    /// Maximum number of connections in the pool
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,

    /// Minimum number of connections in the pool
    #[serde(default = "default_min_connections")]
    pub min_connections: u32,

    /// Connection timeout in seconds
    #[serde(default = "default_connection_timeout")]
    pub connection_timeout_secs: u64,
}

fn default_database_url() -> String {
    "postgresql://localhost:5432/loyalty_db".to_string()
}

fn default_max_connections() -> u32 {
    10
}

fn default_min_connections() -> u32 {
    1
}

fn default_connection_timeout() -> u64 {
    30
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: default_database_url(),
            max_connections: default_max_connections(),
            min_connections: default_min_connections(),
            connection_timeout_secs: default_connection_timeout(),
        }
    }
}

/// Redis configuration
#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    /// Redis connection URL
    #[serde(default = "default_redis_url")]
    pub url: String,
}

fn default_redis_url() -> String {
    "redis://localhost:6379".to_string()
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: default_redis_url(),
        }
    }
}

/// Authentication configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    /// JWT secret for signing access tokens
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,

    /// JWT secret for signing refresh tokens
    #[serde(default = "default_jwt_refresh_secret")]
    pub jwt_refresh_secret: String,

    /// Session secret for cookie signing
    #[serde(default = "default_session_secret")]
    pub session_secret: String,

    /// Access token expiration in seconds (default: 15 minutes)
    #[serde(default = "default_access_token_expiry")]
    pub access_token_expiry_secs: u64,

    /// Refresh token expiration in seconds (default: 7 days)
    #[serde(default = "default_refresh_token_expiry")]
    pub refresh_token_expiry_secs: u64,
}

fn default_jwt_secret() -> String {
    "development-jwt-secret-change-in-production".to_string()
}

fn default_jwt_refresh_secret() -> String {
    "development-jwt-refresh-secret-change-in-production".to_string()
}

fn default_session_secret() -> String {
    "development-session-secret-change-in-production".to_string()
}

fn default_access_token_expiry() -> u64 {
    900 // 15 minutes
}

fn default_refresh_token_expiry() -> u64 {
    604800 // 7 days
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            jwt_secret: default_jwt_secret(),
            jwt_refresh_secret: default_jwt_refresh_secret(),
            session_secret: default_session_secret(),
            access_token_expiry_secs: default_access_token_expiry(),
            refresh_token_expiry_secs: default_refresh_token_expiry(),
        }
    }
}

/// Google OAuth configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct GoogleOAuthConfig {
    /// Google OAuth client ID
    pub client_id: Option<String>,

    /// Google OAuth client secret
    pub client_secret: Option<String>,

    /// Google OAuth callback URL
    #[serde(default = "default_google_callback_url")]
    pub callback_url: String,
}

fn default_google_callback_url() -> String {
    "http://localhost:4001/api/oauth/google/callback".to_string()
}

impl GoogleOAuthConfig {
    pub fn is_configured(&self) -> bool {
        self.client_id.is_some() && self.client_secret.is_some()
    }
}

/// LINE OAuth configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LineOAuthConfig {
    /// LINE channel ID
    pub client_id: Option<String>,

    /// LINE channel secret
    pub client_secret: Option<String>,

    /// LINE OAuth callback URL
    #[serde(default = "default_line_callback_url")]
    pub callback_url: String,
}

fn default_line_callback_url() -> String {
    "http://localhost:4001/api/oauth/line/callback".to_string()
}

impl LineOAuthConfig {
    pub fn is_configured(&self) -> bool {
        self.client_id.is_some() && self.client_secret.is_some()
    }
}

/// Combined OAuth configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OAuthConfig {
    pub google: GoogleOAuthConfig,
    pub line: LineOAuthConfig,
}

/// `env::var(name)` with the compose convention applied: every compose file
/// passes optional settings as `VAR: ${VAR:-}`, so an unset value arrives as
/// `Some("")`. For SlipOK and PromptPay a blank must mean "unset", or the
/// backend would report SlipOK configured with no key, or mint a PromptPay
/// QR with an empty receiving id. Blank means absent.
fn env_present(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// `Some(trimmed)` when a value is present and not blank, `None` otherwise.
///
/// Every compose file passes its optional settings as `VAR: ${VAR:-}`, so an
/// **unset** secret does not arrive as `None` — it arrives as `Some("")`. A
/// bare `.is_some()` therefore reports a stack with no SMTP at all as fully
/// configured, which is exactly why `/api/health` claimed `"email":
/// "configured"` everywhere (issue #352). Blank means absent.
fn present(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|trimmed| !trimmed.is_empty())
}

/// SMTP email configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SmtpConfig {
    /// SMTP server host
    pub host: Option<String>,

    /// SMTP server port
    #[serde(default = "default_smtp_port")]
    pub port: u16,

    /// SMTP username
    pub user: Option<String>,

    /// SMTP password
    pub pass: Option<String>,

    /// Sender address for outgoing mail (`SMTP_FROM`).
    ///
    /// Accepts a bare address (`noreply@example.com`) or the display-name
    /// form (`Loyalty App <noreply@example.com>`). Falls back to `SMTP_USER`
    /// when unset or blank — see [`SmtpConfig::from_address`] — so
    /// environments that never set it keep the previous behaviour exactly.
    ///
    /// The address must be one the authenticated mailbox genuinely **owns**:
    /// a relay accepts AUTH and then rejects the message with
    /// `553 5.7.1 ... Sender address rejected` if it is a mere alias.
    pub from: Option<String>,

    /// Use TLS for SMTP connection
    #[serde(default = "default_smtp_tls")]
    pub use_tls: bool,
}

fn default_smtp_port() -> u16 {
    587
}

fn default_smtp_tls() -> bool {
    true
}

impl SmtpConfig {
    /// SMTP host, or `None` when unset/blank.
    pub fn host(&self) -> Option<&str> {
        present(&self.host)
    }

    /// SMTP username, or `None` when unset/blank.
    pub fn user(&self) -> Option<&str> {
        present(&self.user)
    }

    /// SMTP password, or `None` when unset/blank.
    ///
    /// Returned **untrimmed**: a password may legitimately begin or end with
    /// whitespace, so trimming could silently break authentication. Only the
    /// blank/non-blank decision uses the trimmed form.
    pub fn pass(&self) -> Option<&str> {
        self.pass.as_deref().filter(|pass| !pass.trim().is_empty())
    }

    /// Address that outgoing mail is sent **From**.
    ///
    /// `SMTP_FROM` when set, otherwise `SMTP_USER`. This is the single reader
    /// of the setting — the From header is built from it in
    /// `services::email`.
    pub fn from_address(&self) -> Option<&str> {
        present(&self.from).or_else(|| self.user())
    }

    pub fn is_configured(&self) -> bool {
        self.host().is_some() && self.user().is_some() && self.pass().is_some()
    }
}

/// IMAP email configuration (for receiving emails)
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ImapConfig {
    /// IMAP server host
    pub host: Option<String>,

    /// IMAP server port
    #[serde(default = "default_imap_port")]
    pub port: u16,

    /// IMAP username
    pub user: Option<String>,

    /// IMAP password
    pub pass: Option<String>,

    /// Use TLS for IMAP connection
    #[serde(default = "default_imap_tls")]
    pub use_tls: bool,
}

fn default_imap_port() -> u16 {
    993
}

fn default_imap_tls() -> bool {
    true
}

impl ImapConfig {
    /// Same blank-is-absent rule as [`SmtpConfig::is_configured`]: compose
    /// passes `IMAP_HOST: ${IMAP_HOST:-}`, so an unset secret arrives as an
    /// empty string rather than as nothing at all.
    pub fn is_configured(&self) -> bool {
        present(&self.host).is_some()
            && present(&self.user).is_some()
            && self
                .pass
                .as_deref()
                .is_some_and(|pass| !pass.trim().is_empty())
    }
}

/// Combined email configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct EmailConfig {
    pub smtp: SmtpConfig,
    pub imap: ImapConfig,
}

/// SlipOK payment integration configuration
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SlipokConfig {
    /// SlipOK branch ID
    pub branch_id: Option<String>,

    /// SlipOK API key
    pub api_key: Option<String>,

    /// Base API URL, without the branch id (`SLIPOK_API_URL`). Defaults to
    /// the vendor endpoint inside `services::slipok`; overridable so
    /// integration tests can point at a local mock server.
    #[serde(default)]
    pub api_url: Option<String>,

    /// Kill switch for automatic slip verification (`SLIPOK_AUTO_VERIFY`).
    ///
    /// Defaults to **false** = shadow mode: SlipOK is still called and the
    /// decision is still stored on the slip (`slipok_status='shadow_pass'`
    /// when every check passed), but nothing is confirmed without an admin.
    /// Only `true` lets a machine verify a slip. Flipping it is a restart,
    /// not a deploy.
    #[serde(default)]
    pub auto_verify: bool,
}

impl SlipokConfig {
    pub fn is_configured(&self) -> bool {
        self.branch_id.is_some() && self.api_key.is_some()
    }
}

/// PromptPay QR code configuration
///
/// Holds the merchant Tax ID (or registered phone number) used to generate
/// EMVCo-compliant PromptPay QR codes. Optional so non-Thailand deployments
/// can omit it without failing validation; the QR endpoint will return a
/// configuration error if it is missing when invoked.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct PromptPayConfig {
    /// 13-digit Tax ID (or 10-digit phone number) for PromptPay payments.
    /// Sourced from the `PROMPTPAY_TAX_ID` environment variable.
    /// Legacy single-account fallback when per-property IDs are unset.
    pub tax_id: Option<String>,

    /// Receiving PromptPay ID for HF (`PROMPTPAY_HF_ID`).
    pub hf_id: Option<String>,

    /// Receiving PromptPay ID for HF Ville (`PROMPTPAY_HFVILLE_ID`).
    pub hfville_id: Option<String>,
}

impl PromptPayConfig {
    pub fn is_configured(&self) -> bool {
        self.tax_id.is_some()
    }

    /// Receiving PromptPay ID for a property ("hf" | "hfville"), falling
    /// back to the legacy single `tax_id` when no per-property ID is set.
    /// Each property has its own receiving account (docs/launch-plan.md).
    pub fn id_for_property(&self, property: &str) -> Option<&String> {
        let per_property = match property {
            "hf" => self.hf_id.as_ref(),
            "hfville" => self.hfville_id.as_ref(),
            _ => None,
        };
        per_property.or(self.tax_id.as_ref())
    }
}

/// Property mailboxes that receive the short "a guest is coming" email
/// (B0 spec: `hf-tasks/tasks/direct-booking-designs/b0-booking-email-spec.md`).
///
/// Both are optional and **blank means off**: every compose file passes them
/// as `VAR: ${VAR:-}`, so an unset variable arrives as `Some("")` — the #352
/// bug. Reads go through [`present`], never through a bare `.is_some()`.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct BookingNotifyConfig {
    /// Mailbox for The Harbour Front Hotel bookings (`BOOKING_NOTIFY_EMAIL_HF`).
    pub hf: Option<String>,

    /// Mailbox for HF Ville bookings (`BOOKING_NOTIFY_EMAIL_HFVILLE`).
    pub hfville: Option<String>,
}

impl BookingNotifyConfig {
    /// The mailbox for a property ("hf" | "hfville"), or `None` when that
    /// property has no mailbox set.
    ///
    /// Deliberately **without** the legacy single-account fallback
    /// [`PromptPayConfig::id_for_property`] has: an unknown or blank property
    /// string must not send one property's arrivals to the other's desk.
    pub fn recipient_for(&self, property: &str) -> Option<&str> {
        match property.trim() {
            "hf" => present(&self.hf),
            "hfville" => present(&self.hfville),
            _ => None,
        }
    }

    /// True when at least one property has a mailbox — i.e. the feature is on
    /// somewhere. Used only for the startup log line.
    pub fn is_configured(&self) -> bool {
        present(&self.hf).is_some() || present(&self.hfville).is_some()
    }

    /// Every configured mailbox, as (env var name, address) pairs, so startup
    /// can validate them without knowing the field names.
    pub fn configured_mailboxes(&self) -> Vec<(&'static str, &str)> {
        let mut out = Vec::new();
        if let Some(address) = present(&self.hf) {
            out.push(("BOOKING_NOTIFY_EMAIL_HF", address));
        }
        if let Some(address) = present(&self.hfville) {
            out.push(("BOOKING_NOTIFY_EMAIL_HFVILLE", address));
        }
        out
    }
}

/// One LINE Messaging API channel (a property's OA).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LineMessagingChannelConfig {
    /// Long-lived channel access token for push messages.
    pub access_token: Option<String>,
    /// Channel secret for webhook signature verification.
    pub channel_secret: Option<String>,
}

impl LineMessagingChannelConfig {
    pub fn is_configured(&self) -> bool {
        self.access_token.is_some() && self.channel_secret.is_some()
    }
}

/// LINE Messaging API configuration — one channel per property OA
/// (ADR-0002: all channels live under the same LINE provider, so userIds
/// are shared with the LINE Login channel).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LineMessagingConfig {
    #[serde(default)]
    pub hf: LineMessagingChannelConfig,
    #[serde(default)]
    pub hfville: LineMessagingChannelConfig,
}

impl LineMessagingConfig {
    /// Channel credentials for a property ("hf" | "hfville").
    pub fn channel(&self, property: &str) -> Option<&LineMessagingChannelConfig> {
        match property {
            "hf" => Some(&self.hf),
            "hfville" => Some(&self.hfville),
            _ => None,
        }
    }
}

/// PMS booking-channel client configuration (ADR-0003: the loyalty app is
/// a booking channel into the PMS; availability and booking creation live
/// there).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct PmsConfig {
    /// Base URL of the PMS channel API (e.g. https://pms.internal).
    pub base_url: Option<String>,
    /// Bearer token for outbound calls to the PMS channel API.
    pub channel_token: Option<String>,
}

impl PmsConfig {
    pub fn is_configured(&self) -> bool {
        self.base_url.is_some() && self.channel_token.is_some()
    }
}

/// Inbound service-token configuration for machine-to-machine callers
/// (the PMS checkout hook posting to /api/loyalty/stays).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LoyaltyServiceConfig {
    pub token: Option<String>,
}

/// Admin bootstrap allowlist (issue #348).
///
/// `ADMIN_BOOTSTRAP_EMAILS` is a comma-separated, case-insensitive list of
/// email addresses whose accounts are promoted to the `admin` role
/// automatically: in-transaction during `/api/auth/register` (so the very
/// first JWT already carries `role=admin`) and via a startup sweep that
/// covers pre-existing rows (including OAuth-created accounts).
///
/// Promotion is ONE-SHOT and UNAMBIGUOUS. Because `users.email`
/// uniqueness is byte-exact while this allowlist matches
/// case-insensitively, several distinct rows can match one entry; a
/// promotion happens only when (a) exactly one user row matches the
/// entry case-insensitively, (b) no matching row already holds
/// admin/super_admin, and (c) no prior promotion for the entry is
/// recorded in `user_audit_log` (action `admin_bootstrap_promotion`, the
/// one-shot marker). Only `customer` rows are ever touched, nothing is
/// ever demoted, and a deliberate demotion through the admin API is
/// never undone by a later restart.
///
/// Intended for E2E stacks and one-time first-admin bootstrap. Remove the
/// variable once the first admin exists: registration does not verify
/// email ownership, so the FIRST registration of a listed address still
/// becomes admin. Empty/unset disables the feature entirely.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct AdminBootstrapConfig {
    /// Comma-separated allowlist; `None` or blank = feature off.
    #[serde(default)]
    pub emails: Option<String>,
}

impl AdminBootstrapConfig {
    /// Parsed allowlist: split on `,`, trimmed, lowercased, empties dropped.
    pub fn email_list(&self) -> Vec<String> {
        self.emails
            .as_deref()
            .unwrap_or("")
            .split(',')
            .map(|e| e.trim().to_lowercase())
            .filter(|e| !e.is_empty())
            .collect()
    }

    /// Case-insensitive membership test. Always `false` when the list is
    /// empty/unset (feature off).
    pub fn contains(&self, email: &str) -> bool {
        let needle = email.trim().to_lowercase();
        !needle.is_empty() && self.email_list().iter().any(|e| e == &needle)
    }
}

/// Server configuration
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    /// Server port
    #[serde(default = "default_port")]
    pub port: u16,

    /// Server host
    #[serde(default = "default_host")]
    pub host: String,

    /// Frontend URL for CORS
    #[serde(default = "default_frontend_url")]
    pub frontend_url: String,

    /// Log level
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_port() -> u16 {
    4001
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_frontend_url() -> String {
    "http://localhost:4001".to_string()
}

fn default_log_level() -> String {
    "info".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            host: default_host(),
            frontend_url: default_frontend_url(),
            log_level: default_log_level(),
        }
    }
}

/// Security configuration
#[derive(Debug, Clone, Deserialize)]
pub struct SecurityConfig {
    /// Maximum file upload size in bytes
    #[serde(default = "default_max_file_size")]
    pub max_file_size: usize,

    /// Rate limit window in milliseconds
    #[serde(default = "default_rate_limit_window")]
    pub rate_limit_window_ms: u64,

    /// Maximum requests per rate limit window
    #[serde(default = "default_rate_limit_max")]
    pub rate_limit_max_requests: u32,

    /// Peers whose `X-Forwarded-For` may be believed, as a comma-separated
    /// list of bare IPs and CIDR blocks (`TRUSTED_PROXIES`).
    ///
    /// Every limiter that counts per client IP has to answer one question
    /// first: *which* address is the client? Behind nginx the TCP peer is
    /// the nginx container for every request on earth, so a per-IP budget
    /// keyed on the peer is a single global bucket. The forwarding header
    /// is the only thing that carries the real address — and it is
    /// attacker-supplied unless the hop that set it is one we put there.
    ///
    /// So: believe the header only when the peer is on this list. The
    /// default is loopback plus the private ranges a compose network is
    /// built from.
    ///
    /// Loopback is in the default deliberately, and it is not vacuous:
    /// `docker-compose.prod.yml` publishes the backend as
    /// `127.0.0.1:4011:4001`, i.e. on the host's loopback interface and
    /// nowhere else. Nothing off the box can open that socket — a
    /// published loopback port is not reachable from the network — but a
    /// process already on the host can, and it arrives with a peer of
    /// `127.0.0.1`. That connection is trusted here on purpose: the port
    /// exists so operators can curl the API from the box, and anything
    /// running on the box can forge a bucket key by far cheaper means than
    /// this header. Anything genuinely public reaches the backend through
    /// the tunnel and nginx, never through that port.
    ///
    /// A deployment that fronts the backend directly with something that
    /// is *not* a proxy we control must set `TRUSTED_PROXIES=none`, which
    /// trusts no hop and keys every limiter on the TCP peer. A *blank*
    /// value is read as unset (every compose file passes optional settings
    /// as `VAR: ${VAR:-}`), so the literal `none` is the only way to say
    /// "trust nobody".
    #[serde(default = "default_trusted_proxies")]
    pub trusted_proxies: String,

    /// Prefix prepended to every rate-limit bucket key.
    ///
    /// Empty in every real deployment, and deliberately: replicas of the
    /// same service must share one bucket per subject, or the budget is
    /// multiplied by the replica count.
    ///
    /// It exists for the test harness. Redis is *not* isolated per test
    /// the way the database is — one server backs the whole suite — so
    /// two tests that both drive an always-on limiter would otherwise
    /// share its buckets and fail in whichever order they happened to
    /// run. `TestApp` sets a fresh namespace per app, which gives the
    /// limiters the same per-test isolation the database already has.
    #[serde(default)]
    pub rate_limit_namespace: String,
}

fn default_max_file_size() -> usize {
    5_242_880 // 5MB
}

fn default_rate_limit_window() -> u64 {
    900_000 // 15 minutes
}

fn default_rate_limit_max() -> u32 {
    10_000
}

/// Loopback plus the RFC1918 ranges docker compose builds its networks
/// from. See [`SecurityConfig::trusted_proxies`].
fn default_trusted_proxies() -> String {
    "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16".to_string()
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            max_file_size: default_max_file_size(),
            rate_limit_window_ms: default_rate_limit_window(),
            rate_limit_max_requests: default_rate_limit_max(),
            trusted_proxies: default_trusted_proxies(),
            rate_limit_namespace: String::new(),
        }
    }
}

/// Cloudflare Access configuration
///
/// Backs the `/api/auth/cf-exchange` endpoint (silent admin auto-login via
/// Cloudflare Access + Google SSO for `loyalty.saichon.com/admin*`). None of
/// these values are secrets: the AUD tag identifies the Access application
/// (not a credential — Cloudflare's own docs treat it as public), the issuer
/// and JWKS URL are just the team's well-known Cloudflare Access endpoints.
#[derive(Debug, Clone, Deserialize)]
pub struct CfAccessConfig {
    /// Master switch for the exchange endpoint. Defaults to `true`; set
    /// `CF_ACCESS_ENABLED=false` to disable without a code change (e.g. if
    /// the Cloudflare Access application is ever removed or misconfigured).
    #[serde(default = "default_cf_access_enabled")]
    pub enabled: bool,

    /// Expected `aud` claim on the Cloudflare Access JWT — identifies the
    /// `loyalty.saichon.com/admin*` Access application.
    #[serde(default = "default_cf_access_aud")]
    pub aud: String,

    /// Expected `iss` claim — the Cloudflare Access team domain that issues
    /// tokens for this application.
    #[serde(default = "default_cf_access_issuer")]
    pub issuer: String,

    /// JWKS endpoint used to fetch the RS256 verification keys. Overridable
    /// so integration tests can point at a local mock server instead of the
    /// real Cloudflare endpoint.
    #[serde(default = "default_cf_access_jwks_url")]
    pub jwks_url: String,
}

fn default_cf_access_enabled() -> bool {
    true
}

/// AUD tag for the `loyalty.saichon.com/admin*` Cloudflare Access
/// application. Not a secret — see `CfAccessConfig` doc comment.
pub const DEFAULT_CF_ACCESS_AUD: &str =
    "18effa77177458321432ba1b2c59a247903c9f89bb262aa598c3f75529faa6be";

fn default_cf_access_aud() -> String {
    DEFAULT_CF_ACCESS_AUD.to_string()
}

fn default_cf_access_issuer() -> String {
    "https://laikaexpress.cloudflareaccess.com".to_string()
}

fn default_cf_access_jwks_url() -> String {
    "https://laikaexpress.cloudflareaccess.com/cdn-cgi/access/certs".to_string()
}

impl Default for CfAccessConfig {
    fn default() -> Self {
        Self {
            enabled: default_cf_access_enabled(),
            aud: default_cf_access_aud(),
            issuer: default_cf_access_issuer(),
            jwks_url: default_cf_access_jwks_url(),
        }
    }
}

/// Main application settings
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Settings {
    /// Application environment
    #[serde(default)]
    pub environment: Environment,

    /// Server configuration
    #[serde(default)]
    pub server: ServerConfig,

    /// Database configuration
    #[serde(default)]
    pub database: DatabaseConfig,

    /// Redis configuration
    #[serde(default)]
    pub redis: RedisConfig,

    /// Authentication configuration
    #[serde(default)]
    pub auth: AuthConfig,

    /// OAuth providers configuration
    #[serde(default)]
    pub oauth: OAuthConfig,

    /// Email configuration
    #[serde(default)]
    pub email: EmailConfig,

    /// SlipOK payment configuration
    #[serde(default)]
    pub slipok: SlipokConfig,

    /// PromptPay QR code configuration
    #[serde(default)]
    pub promptpay: PromptPayConfig,

    /// Security configuration
    #[serde(default)]
    pub security: SecurityConfig,

    /// Cloudflare Access configuration (admin auto-login exchange)
    #[serde(default)]
    pub cf_access: CfAccessConfig,

    /// LINE Messaging API channels (one per property OA)
    #[serde(default)]
    pub line_messaging: LineMessagingConfig,

    /// PMS booking-channel client (ADR-0003)
    #[serde(default)]
    pub pms: PmsConfig,

    /// Inbound service token (PMS → loyalty accrual calls)
    #[serde(default)]
    pub loyalty_service: LoyaltyServiceConfig,

    /// Admin bootstrap allowlist (`ADMIN_BOOTSTRAP_EMAILS`, issue #348)
    #[serde(default)]
    pub admin_bootstrap: AdminBootstrapConfig,

    /// Property mailboxes for new-booking / deposit-received notifications
    #[serde(default)]
    pub booking_notify: BookingNotifyConfig,
}

impl Settings {
    /// Load settings from environment variables and optional config files
    pub fn new() -> Result<Self, ConfigurationError> {
        // Load .env file if present (ignore errors if not found)
        let _ = dotenvy::dotenv();

        // Build configuration
        let settings = config::Config::builder()
            // Start with defaults
            .set_default("environment", "development")?
            .set_default("server.port", 4001)?
            .set_default("server.host", "0.0.0.0")?
            .set_default("server.frontend_url", "http://localhost:4001")?
            .set_default("server.log_level", "info")?
            .set_default("database.url", "postgresql://localhost:5432/loyalty_db")?
            .set_default("database.max_connections", 10)?
            .set_default("database.min_connections", 1)?
            .set_default("database.connection_timeout_secs", 30)?
            .set_default("redis.url", "redis://localhost:6379")?
            .set_default("auth.access_token_expiry_secs", 900)?
            .set_default("auth.refresh_token_expiry_secs", 604800)?
            .set_default("email.smtp.port", 587)?
            .set_default("email.smtp.use_tls", true)?
            .set_default("email.imap.port", 993)?
            .set_default("email.imap.use_tls", true)?
            .set_default("security.max_file_size", 5_242_880)?
            .set_default("security.rate_limit_window_ms", 900_000)?
            .set_default("security.rate_limit_max_requests", 10_000)?
            .set_default("security.trusted_proxies", default_trusted_proxies())?
            .set_default("security.rate_limit_namespace", "")?
            .set_default("slipok.auto_verify", false)?
            .set_default("cf_access.enabled", true)?
            .set_default("cf_access.aud", DEFAULT_CF_ACCESS_AUD)?
            .set_default("cf_access.issuer", default_cf_access_issuer())?
            .set_default("cf_access.jwks_url", default_cf_access_jwks_url())?
            // Load from config file if present
            .add_source(File::with_name("config/default").required(false))
            .add_source(File::with_name("config/local").required(false))
            // Load from environment variables with prefix mapping
            .add_source(
                ConfigEnvironment::default()
                    .separator("__")
                    // Map flat env vars to nested structure
                    .try_parsing(true),
            )
            // Manual overrides from specific environment variables
            .set_override_option(
                "environment",
                env::var("RUST_ENV")
                    .or_else(|_| env::var("NODE_ENV"))
                    .ok(),
            )?
            .set_override_option("server.port", env::var("PORT").ok())?
            .set_override_option("server.frontend_url", env::var("FRONTEND_URL").ok())?
            .set_override_option("server.log_level", env::var("LOG_LEVEL").ok())?
            .set_override_option("database.url", env::var("DATABASE_URL").ok())?
            .set_override_option("redis.url", env::var("REDIS_URL").ok())?
            .set_override_option("auth.jwt_secret", env::var("JWT_SECRET").ok())?
            .set_override_option("auth.jwt_refresh_secret", env::var("JWT_REFRESH_SECRET").ok())?
            .set_override_option("auth.session_secret", env::var("SESSION_SECRET").ok())?
            .set_override_option("oauth.google.client_id", env::var("GOOGLE_CLIENT_ID").ok())?
            .set_override_option(
                "oauth.google.client_secret",
                env::var("GOOGLE_CLIENT_SECRET").ok(),
            )?
            .set_override_option(
                "oauth.google.callback_url",
                env::var("GOOGLE_CALLBACK_URL").ok(),
            )?
            .set_override_option("oauth.line.client_id", env::var("LINE_CLIENT_ID").ok())?
            .set_override_option(
                "oauth.line.client_secret",
                env::var("LINE_CLIENT_SECRET").ok(),
            )?
            .set_override_option(
                "oauth.line.callback_url",
                env::var("LINE_CALLBACK_URL").ok(),
            )?
            .set_override_option("email.smtp.host", env::var("SMTP_HOST").ok())?
            .set_override_option("email.smtp.port", env::var("SMTP_PORT").ok())?
            .set_override_option("email.smtp.user", env::var("SMTP_USER").ok())?
            .set_override_option("email.smtp.pass", env::var("SMTP_PASS").ok())?
            .set_override_option("email.smtp.from", env::var("SMTP_FROM").ok())?
            .set_override_option("email.imap.host", env::var("IMAP_HOST").ok())?
            .set_override_option("email.imap.port", env::var("IMAP_PORT").ok())?
            .set_override_option("email.imap.user", env::var("IMAP_USER").ok())?
            .set_override_option("email.imap.pass", env::var("IMAP_PASS").ok())?
            .set_override_option("slipok.branch_id", env_present("SLIPOK_BRANCH_ID"))?
            .set_override_option("slipok.api_key", env_present("SLIPOK_API_KEY"))?
            .set_override_option("slipok.api_url", env_present("SLIPOK_API_URL"))?
            .set_override_option("slipok.auto_verify", env_present("SLIPOK_AUTO_VERIFY"))?
            // Which hop's `X-Forwarded-For` the per-IP limiters believe.
            // `env_present` so the `${VAR:-}` blank a compose file passes
            // reads as "unset" and keeps the default rather than trusting
            // nobody by accident.
            .set_override_option(
                "security.trusted_proxies",
                env_present("TRUSTED_PROXIES"),
            )?
            .set_override_option("promptpay.tax_id", env_present("PROMPTPAY_TAX_ID"))?
            .set_override_option("promptpay.hf_id", env_present("PROMPTPAY_HF_ID"))?
            .set_override_option(
                "promptpay.hfville_id",
                env_present("PROMPTPAY_HFVILLE_ID"),
            )?
            // Property notification mailboxes (B0). `env_present` so the
            // `${VAR:-}` blank every compose file passes reads as "off"
            // rather than as a recipient the relay would reject.
            .set_override_option(
                "booking_notify.hf",
                env_present("BOOKING_NOTIFY_EMAIL_HF"),
            )?
            .set_override_option(
                "booking_notify.hfville",
                env_present("BOOKING_NOTIFY_EMAIL_HFVILLE"),
            )?
            .set_override_option(
                "line_messaging.hf.access_token",
                env::var("LINE_MESSAGING_HF_ACCESS_TOKEN").ok(),
            )?
            .set_override_option(
                "line_messaging.hf.channel_secret",
                env::var("LINE_MESSAGING_HF_CHANNEL_SECRET").ok(),
            )?
            .set_override_option(
                "line_messaging.hfville.access_token",
                env::var("LINE_MESSAGING_HFVILLE_ACCESS_TOKEN").ok(),
            )?
            .set_override_option(
                "line_messaging.hfville.channel_secret",
                env::var("LINE_MESSAGING_HFVILLE_CHANNEL_SECRET").ok(),
            )?
            .set_override_option("pms.base_url", env::var("PMS_BASE_URL").ok())?
            .set_override_option("pms.channel_token", env::var("PMS_CHANNEL_TOKEN").ok())?
            .set_override_option(
                "loyalty_service.token",
                env::var("LOYALTY_SERVICE_TOKEN").ok(),
            )?
            .set_override_option(
                "admin_bootstrap.emails",
                env::var("ADMIN_BOOTSTRAP_EMAILS").ok(),
            )?
            .set_override_option("security.max_file_size", env::var("MAX_FILE_SIZE").ok())?
            .set_override_option(
                "security.rate_limit_window_ms",
                env::var("RATE_LIMIT_WINDOW_MS").ok(),
            )?
            .set_override_option(
                "security.rate_limit_max_requests",
                env::var("RATE_LIMIT_MAX_REQUESTS").ok(),
            )?
            .set_override_option("cf_access.enabled", env::var("CF_ACCESS_ENABLED").ok())?
            .set_override_option("cf_access.aud", env::var("CF_ACCESS_AUD").ok())?
            .set_override_option("cf_access.issuer", env::var("CF_ACCESS_ISSUER").ok())?
            .set_override_option("cf_access.jwks_url", env::var("CF_ACCESS_JWKS_URL").ok())?
            .build()?;

        let settings: Settings = settings.try_deserialize()?;

        // Validate the settings
        settings.validate()?;

        Ok(settings)
    }

    /// Validate the configuration
    fn validate(&self) -> Result<(), ConfigurationError> {
        let mut errors: Vec<String> = Vec::new();

        // In production, enforce strict secret requirements
        if self.environment == Environment::Production {
            // JWT secret must be at least 64 characters
            if self.auth.jwt_secret.len() < 64 {
                errors.push(format!(
                    "JWT_SECRET must be at least 64 characters in production (got {})",
                    self.auth.jwt_secret.len()
                ));
            }

            // JWT refresh secret must be at least 64 characters
            if self.auth.jwt_refresh_secret.len() < 64 {
                errors.push(format!(
                    "JWT_REFRESH_SECRET must be at least 64 characters in production (got {})",
                    self.auth.jwt_refresh_secret.len()
                ));
            }

            // Session secret must be at least 64 characters
            if self.auth.session_secret.len() < 64 {
                errors.push(format!(
                    "SESSION_SECRET must be at least 64 characters in production (got {})",
                    self.auth.session_secret.len()
                ));
            }

            // Check for default/weak secrets
            let weak_secrets = [
                "development-jwt-secret-change-in-production",
                "development-jwt-refresh-secret-change-in-production",
                "development-session-secret-change-in-production",
                "your-secret-key",
                "your-refresh-secret",
                "default-secret",
                "changeme",
                "secret",
                "123456",
            ];

            if weak_secrets.contains(&self.auth.jwt_secret.as_str()) {
                errors.push("JWT_SECRET appears to be a default value".to_string());
            }
            if weak_secrets.contains(&self.auth.jwt_refresh_secret.as_str()) {
                errors.push("JWT_REFRESH_SECRET appears to be a default value".to_string());
            }
            if weak_secrets.contains(&self.auth.session_secret.as_str()) {
                errors.push("SESSION_SECRET appears to be a default value".to_string());
            }

            // Reject placeholder secrets shipped in .env example files. These are
            // long enough to bypass the length check but are publicly known.
            const PLACEHOLDER_PREFIXES: &[&str] = &["EXAMPLE_DO_NOT_USE_", "REPLACE_ME"];
            for prefix in PLACEHOLDER_PREFIXES {
                if self.auth.jwt_secret.starts_with(prefix) {
                    errors.push(format!(
                        "JWT_SECRET starts with placeholder prefix '{}' and must be replaced",
                        prefix
                    ));
                }
                if self.auth.jwt_refresh_secret.starts_with(prefix) {
                    errors.push(format!(
                        "JWT_REFRESH_SECRET starts with placeholder prefix '{}' and must be replaced",
                        prefix
                    ));
                }
                if self.auth.session_secret.starts_with(prefix) {
                    errors.push(format!(
                        "SESSION_SECRET starts with placeholder prefix '{}' and must be replaced",
                        prefix
                    ));
                }
            }

            // Warn about localhost database in production
            if self.database.url.contains("localhost") {
                errors.push("Production environment should not use localhost database".to_string());
            }
        } else {
            // In development/staging, just validate minimum requirements
            if self.auth.jwt_secret.len() < 32 {
                errors.push(format!(
                    "JWT_SECRET must be at least 32 characters (got {})",
                    self.auth.jwt_secret.len()
                ));
            }
            if self.auth.jwt_refresh_secret.len() < 32 {
                errors.push(format!(
                    "JWT_REFRESH_SECRET must be at least 32 characters (got {})",
                    self.auth.jwt_refresh_secret.len()
                ));
            }
        }

        // Validate port range
        if self.server.port == 0 {
            errors.push("Server port cannot be 0".to_string());
        }

        // Validate database URL format
        if !self.database.url.starts_with("postgresql://")
            && !self.database.url.starts_with("postgres://")
        {
            errors.push("DATABASE_URL must be a valid PostgreSQL connection string".to_string());
        }

        // Validate Redis URL format
        if !self.redis.url.starts_with("redis://") && !self.redis.url.starts_with("rediss://") {
            errors.push("REDIS_URL must be a valid Redis connection string".to_string());
        }

        if !errors.is_empty() {
            return Err(ConfigurationError::ValidationError(errors.join("; ")));
        }

        Ok(())
    }

    /// Check if running in production
    pub fn is_production(&self) -> bool {
        self.environment == Environment::Production
    }

    /// Check if running in development
    pub fn is_development(&self) -> bool {
        self.environment == Environment::Development
    }

    /// Check if running in staging
    pub fn is_staging(&self) -> bool {
        self.environment == Environment::Staging
    }

    /// Get allowed CORS origins based on environment
    pub fn cors_origins(&self) -> Vec<String> {
        let mut origins = vec![self.server.frontend_url.clone()];

        // In development, also allow localhost variants
        if self.is_development() {
            origins.push("http://localhost:3000".to_string());
            origins.push("http://localhost:3001".to_string());
            origins.push("http://localhost:4001".to_string());
            origins.push("http://127.0.0.1:3000".to_string());
            origins.push("http://127.0.0.1:4001".to_string());
        }

        origins
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compose passes optional settings as `VAR: ${VAR:-}`, so an unset
    /// SlipOK key or PromptPay id arrives as an empty string. A blank must
    /// read as absent (issue class of #352), never as a configured value.
    #[test]
    fn env_present_treats_blank_as_unset() {
        let name = "LOYALTY_TEST_ENV_PRESENT_PROBE";
        env::set_var(name, "");
        assert_eq!(env_present(name), None);
        env::set_var(name, "   ");
        assert_eq!(env_present(name), None);
        env::set_var(name, " 0845557000341 ");
        assert_eq!(env_present(name), Some("0845557000341".to_string()));
        env::remove_var(name);
        assert_eq!(env_present(name), None);
    }

    /// `SLIPOK_AUTO_VERIFY` arrives from the environment as a *string*
    /// override on a `bool` field. If the config layer refused to coerce it,
    /// setting the variable would fail `Settings::new()` at boot — i.e. the
    /// kill switch would take the service down instead of turning the
    /// feature on. This pins the coercion (and the false default).
    #[test]
    fn slipok_auto_verify_parses_from_a_string_override() {
        fn load(value: Option<&str>) -> SlipokConfig {
            let mut builder = ::config::Config::builder()
                .set_default("slipok.auto_verify", false)
                .expect("default");
            builder = builder
                .set_override_option("slipok.auto_verify", value.map(str::to_string))
                .expect("override");
            builder
                .build()
                .expect("build config")
                .get::<SlipokConfig>("slipok")
                .expect("deserialise slipok config")
        }

        assert!(!load(None).auto_verify, "unset must default to off");
        assert!(load(Some("true")).auto_verify);
        assert!(!load(Some("false")).auto_verify);
    }

    #[test]
    fn test_admin_bootstrap_email_list_parsing() {
        // Unset = off
        let cfg = AdminBootstrapConfig::default();
        assert!(cfg.email_list().is_empty());
        assert!(!cfg.contains("anyone@example.com"));

        // Blank / separators-only = off
        let cfg = AdminBootstrapConfig {
            emails: Some("  , ,".to_string()),
        };
        assert!(cfg.email_list().is_empty());
        assert!(!cfg.contains("anyone@example.com"));

        // Comma-separated, trimmed, lowercased, case-insensitive matching
        let cfg = AdminBootstrapConfig {
            emails: Some(" Admin@Example.COM , e2e-admin@test.local ".to_string()),
        };
        assert_eq!(
            cfg.email_list(),
            vec!["admin@example.com", "e2e-admin@test.local"]
        );
        assert!(cfg.contains("admin@example.com"));
        assert!(cfg.contains("ADMIN@example.com"));
        assert!(cfg.contains("e2e-admin@test.local"));
        assert!(!cfg.contains("other@example.com"));
        assert!(!cfg.contains(""));
    }

    #[test]
    fn test_environment_from_string() {
        assert_eq!(
            Environment::from("production".to_string()),
            Environment::Production
        );
        assert_eq!(
            Environment::from("staging".to_string()),
            Environment::Staging
        );
        assert_eq!(
            Environment::from("development".to_string()),
            Environment::Development
        );
        assert_eq!(
            Environment::from("unknown".to_string()),
            Environment::Development
        );
    }

    #[test]
    fn test_environment_display() {
        assert_eq!(Environment::Production.to_string(), "production");
        assert_eq!(Environment::Staging.to_string(), "staging");
        assert_eq!(Environment::Development.to_string(), "development");
    }

    #[test]
    fn test_default_settings() {
        let settings = Settings::default();
        assert_eq!(settings.environment, Environment::Development);
        assert_eq!(settings.server.port, 4001);
        assert_eq!(settings.database.max_connections, 10);
    }

    #[test]
    fn test_google_oauth_configured() {
        let mut config = GoogleOAuthConfig::default();
        assert!(!config.is_configured());

        config.client_id = Some("test-id".to_string());
        assert!(!config.is_configured());

        config.client_secret = Some("test-secret".to_string());
        assert!(config.is_configured());
    }

    #[test]
    fn test_line_oauth_configured() {
        let mut config = LineOAuthConfig::default();
        assert!(!config.is_configured());

        config.client_id = Some("test-id".to_string());
        config.client_secret = Some("test-secret".to_string());
        assert!(config.is_configured());
    }

    #[test]
    fn test_smtp_configured() {
        let mut config = SmtpConfig::default();
        assert!(!config.is_configured());

        config.host = Some("smtp.example.com".to_string());
        config.user = Some("user".to_string());
        config.pass = Some("pass".to_string());
        assert!(config.is_configured());
    }

    /// Issue #352 — every compose file passes `SMTP_HOST: ${SMTP_HOST:-}`, so
    /// a stack with no SMTP secrets at all hands the backend `Some("")`, not
    /// `None`. Reporting that as configured is what made `/api/health` lie.
    #[test]
    fn smtp_is_not_configured_when_values_are_empty_strings() {
        let config = SmtpConfig {
            host: Some(String::new()),
            user: Some(String::new()),
            pass: Some(String::new()),
            ..SmtpConfig::default()
        };
        assert!(!config.is_configured());

        let whitespace = SmtpConfig {
            host: Some("   ".to_string()),
            user: Some("\t\n".to_string()),
            pass: Some("  ".to_string()),
            ..SmtpConfig::default()
        };
        assert!(!whitespace.is_configured());
    }

    /// A partially-empty triple is still not configured — a host with blank
    /// credentials cannot authenticate.
    #[test]
    fn smtp_is_not_configured_when_only_some_values_are_empty() {
        let config = SmtpConfig {
            host: Some("smtp.example.com".to_string()),
            user: Some("user@example.com".to_string()),
            pass: Some(String::new()),
            ..SmtpConfig::default()
        };
        assert!(!config.is_configured());
    }

    #[test]
    fn imap_is_not_configured_when_values_are_empty_strings() {
        let config = ImapConfig {
            host: Some(String::new()),
            user: Some(String::new()),
            pass: Some(String::new()),
            ..ImapConfig::default()
        };
        assert!(!config.is_configured());
    }

    /// A password may legitimately carry leading/trailing whitespace, so the
    /// accessor must not trim the value it hands to the SMTP client — only
    /// the blank/non-blank decision uses the trimmed form.
    #[test]
    fn smtp_pass_is_returned_untrimmed() {
        let config = SmtpConfig {
            pass: Some(" hunter2 ".to_string()),
            ..SmtpConfig::default()
        };
        assert_eq!(config.pass(), Some(" hunter2 "));
    }

    // ------------------------------------------------------------------
    // SMTP_FROM precedence (issue #352)
    // ------------------------------------------------------------------

    #[test]
    fn from_address_prefers_smtp_from_over_smtp_user() {
        let config = SmtpConfig {
            user: Some("mailbox@example.com".to_string()),
            from: Some("Loyalty App <mailbox@example.com>".to_string()),
            ..SmtpConfig::default()
        };
        assert_eq!(
            config.from_address(),
            Some("Loyalty App <mailbox@example.com>")
        );
    }

    #[test]
    fn from_address_falls_back_to_user_when_from_is_unset() {
        let config = SmtpConfig {
            user: Some("mailbox@example.com".to_string()),
            from: None,
            ..SmtpConfig::default()
        };
        assert_eq!(config.from_address(), Some("mailbox@example.com"));
    }

    /// The important fallback: an unset `SMTP_FROM` secret reaches the
    /// container as an empty string, and must behave identically to unset so
    /// nothing changes for stacks that never configure it.
    #[test]
    fn from_address_falls_back_to_user_when_from_is_blank() {
        let config = SmtpConfig {
            user: Some("mailbox@example.com".to_string()),
            from: Some("   ".to_string()),
            ..SmtpConfig::default()
        };
        assert_eq!(config.from_address(), Some("mailbox@example.com"));
    }

    #[test]
    fn from_address_is_trimmed() {
        let config = SmtpConfig {
            user: Some("mailbox@example.com".to_string()),
            from: Some("  noreply@example.com\n".to_string()),
            ..SmtpConfig::default()
        };
        assert_eq!(config.from_address(), Some("noreply@example.com"));
    }

    #[test]
    fn from_address_is_none_when_neither_is_set() {
        assert_eq!(SmtpConfig::default().from_address(), None);
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn test_cors_origins_development() {
        let mut settings = Settings::default();
        settings.environment = Environment::Development;
        settings.server.frontend_url = "http://localhost:3000".to_string();

        let origins = settings.cors_origins();
        assert!(origins.contains(&"http://localhost:3000".to_string()));
        assert!(origins.contains(&"http://localhost:4001".to_string()));
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn test_cors_origins_production() {
        let mut settings = Settings::default();
        settings.environment = Environment::Production;
        settings.server.frontend_url = "https://app.example.com".to_string();

        let origins = settings.cors_origins();
        assert_eq!(origins.len(), 1);
        assert!(origins.contains(&"https://app.example.com".to_string()));
    }

    /// Build a production Settings instance preloaded with strong, non-placeholder
    /// secrets so individual tests can mutate just one secret to assert validation.
    #[allow(clippy::field_reassign_with_default)]
    fn production_settings_with_strong_secrets() -> Settings {
        // 64+ char secrets that pass length validation and aren't on the weak list.
        let strong = "a".repeat(70);
        let mut settings = Settings::default();
        settings.environment = Environment::Production;
        settings.auth.jwt_secret = strong.clone();
        settings.auth.jwt_refresh_secret = strong.clone();
        settings.auth.session_secret = strong;
        settings.database.url = "postgresql://user:pass@db.internal:5432/loyalty".to_string();
        settings.redis.url = "redis://redis.internal:6379".to_string();
        settings.server.port = 4001;
        settings
    }

    #[test]
    fn test_validate_rejects_example_do_not_use_jwt_secret() {
        let mut settings = production_settings_with_strong_secrets();
        // Long enough to pass the length check but a publicly known placeholder.
        settings.auth.jwt_secret = format!("EXAMPLE_DO_NOT_USE_{}", "x".repeat(80));

        let err = settings
            .validate()
            .expect_err("placeholder JWT_SECRET must be rejected in production");
        let message = err.to_string();
        assert!(
            message.contains("JWT_SECRET") && message.contains("EXAMPLE_DO_NOT_USE_"),
            "expected error to mention JWT_SECRET and the placeholder prefix, got: {message}",
        );
    }

    #[test]
    fn test_validate_rejects_replace_me_refresh_secret() {
        let mut settings = production_settings_with_strong_secrets();
        settings.auth.jwt_refresh_secret = format!("REPLACE_ME_{}", "y".repeat(80));

        let err = settings
            .validate()
            .expect_err("placeholder JWT_REFRESH_SECRET must be rejected in production");
        let message = err.to_string();
        assert!(
            message.contains("JWT_REFRESH_SECRET") && message.contains("REPLACE_ME"),
            "expected error to mention JWT_REFRESH_SECRET and the placeholder prefix, got: {message}",
        );
    }

    #[test]
    fn test_validate_rejects_example_do_not_use_session_secret() {
        let mut settings = production_settings_with_strong_secrets();
        settings.auth.session_secret = format!("EXAMPLE_DO_NOT_USE_{}", "z".repeat(80));

        let err = settings
            .validate()
            .expect_err("placeholder SESSION_SECRET must be rejected in production");
        let message = err.to_string();
        assert!(
            message.contains("SESSION_SECRET") && message.contains("EXAMPLE_DO_NOT_USE_"),
            "expected error to mention SESSION_SECRET and the placeholder prefix, got: {message}",
        );
    }

    #[test]
    fn test_validate_accepts_strong_non_placeholder_secrets_in_production() {
        let settings = production_settings_with_strong_secrets();
        settings
            .validate()
            .expect("strong, non-placeholder production secrets should pass validation");
    }
}
