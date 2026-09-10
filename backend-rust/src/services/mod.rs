//! Business logic services module
//!
//! Contains the service logic the route handlers delegate to: email, the
//! property booking notification in `booking_notify`, OAuth,
//! slip verification (the SlipOK client, the pure decision rules in
//! `slip_match`, and the shared confirm path in `slip_confirm`), storage,
//! SSE, PromptPay, and request idempotency.
//! Domain CRUD lives directly in the `routes/` handlers via `sqlx` rather
//! than behind a service trait.

pub mod booking_notify;
pub mod cf_access;
pub mod email;
pub mod idempotency;
pub mod line;
pub mod oauth;
pub mod pms_channel;
pub mod promptpay;
pub mod slip_confirm;
pub mod slip_match;
pub mod slipok;
pub mod sse;
pub mod storage;

// Re-export service traits and implementations
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
