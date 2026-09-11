//! Business logic services module
//!
//! Contains the service logic the route handlers delegate to: email, the
//! property booking notification in `booking_notify`, OAuth,
//! slip verification (the SlipOK client, the pure decision rules in
//! `slip_match`, and the shared confirm path in `slip_confirm`), the slip
//! privacy pair from F2 (`slip_access_log`, `slip_retention`), the audit-log
//! retention prune from F10 (`audit_retention`), the PDPA account erase
//! from F3 (`account_deletion`), storage,
//! SSE, PromptPay, request idempotency, and the shared bounded outbound
//! HTTP client in `http`.
//! Domain CRUD lives directly in the `routes/` handlers via `sqlx` rather
//! than behind a service trait.

pub mod account_deletion;
pub mod audit_retention;
pub mod booking_notify;
pub mod cf_access;
pub mod email;
pub mod http;
pub mod idempotency;
pub mod line;
pub mod oauth;
pub mod pms_channel;
pub mod promptpay;
pub mod slip_access_log;
pub mod slip_confirm;
pub mod slip_match;
pub mod slip_retention;
pub mod slipok;
pub mod sse;
pub mod storage;

// Re-export service traits and implementations
pub use account_deletion::{erase_account, DeletionActor, DeletionOutcome};
pub use booking_notify::BookingNotifyEvent;
pub use email::{EmailConfig, EmailService, EmailServiceImpl, NoOpEmailService};
pub use oauth::{
    GoogleTokens, GoogleUserInfo, LineTokens, LineUserInfo, OAuthAuthResult, OAuthService,
    OAuthServiceImpl, OAuthUser, OAuthUserInfo,
};
pub use slip_confirm::{confirm_slip, ConfirmOutcome};
pub use slip_match::{decide, SlipDecision};
pub use slipok::{
    SlipOKConfig, SlipOKHealthStatus, SlipOKService, SlipOkService, SlipVerificationResult,
    VerificationStatus,
};
pub use sse::{get_sse_service, SseConnectionManager, SseEvent, SseEventType};
pub use storage::{AllowedMimeTypes, StorageConfig, StorageReport, StorageService, StorageStats};
