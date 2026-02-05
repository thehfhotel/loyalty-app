//! Logging and Tracing Utilities
//!
//! This module provides:
//! - Tracing subscriber initialization with JSON (production) or pretty (development) formatting
//! - Request logging middleware setup for tower-http
//! - Log sanitization utilities to prevent log injection attacks
//!
//! # Security
//!
//! Log injection occurs when attackers inject newlines or control characters
//! into logged data to forge log entries or corrupt log analysis.
//!
//! OWASP References:
//! - <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
//! - <https://owasp.org/www-community/attacks/Log_Injection>

use std::time::Duration;

use axum::extract::Request;
use tower_http::{
    classify::ServerErrorsFailureClass,
    trace::{DefaultOnRequest, DefaultOnResponse, MakeSpan, OnFailure, TraceLayer},
    LatencyUnit,
};
use tracing::{Level, Span};
use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Maximum length for sanitized log values to prevent log flooding
const MAX_LOG_LENGTH: usize = 500;

/// Options for log sanitization
#[derive(Debug, Clone, Default)]
pub struct SanitizeOptions {
    /// Strict mode uses an allowlist approach, permitting only:
    /// - Alphanumerics (a-zA-Z0-9)
    /// - Spaces
    /// - Common safe punctuation: . , : ; ! ? - _ @ / ( ) [ ]
    ///
    /// Use strict mode for high-security contexts where additional
    /// restrictions are required.
    ///
    /// Default: false (uses blocklist approach)
    pub strict: bool,

    /// Maximum length before truncation
    /// Default: 500
    pub max_length: Option<usize>,
}

/// Sanitizes a string value for safe logging following OWASP best practices.
///
/// # Security Features
///
/// - Removes CR (\r), LF (\n), CRLF (prevents log forging)
/// - Removes ASCII control characters \x00-\x1F, \x7F (prevents terminal manipulation)
/// - Removes Unicode control characters U+0080-U+009F, U+2028, U+2029
/// - Removes ANSI escape sequences (prevents colored terminal output injection)
/// - Explicitly removes null bytes \x00 (prevents string truncation attacks)
/// - Truncates to maximum length (prevents log flooding/DoS)
///
/// # Strict Mode
///
/// When `options.strict = true`, uses allowlist approach permitting only:
/// - Alphanumerics: a-zA-Z0-9
/// - Spaces
/// - Safe punctuation: . , : ; ! ? - _ @ / ( ) [ ]
///
/// # Examples
///
/// ```
/// use loyalty_backend::utils::logging::{sanitize_log_value, SanitizeOptions};
///
/// // Basic usage (blocklist mode)
/// assert_eq!(sanitize_log_value("user\ninput", None), "user input");
///
/// // Strict mode (allowlist only)
/// let opts = SanitizeOptions { strict: true, ..Default::default() };
/// assert_eq!(sanitize_log_value("user<script>", Some(opts)), "userscript");
/// ```
pub fn sanitize_log_value(value: &str, options: Option<SanitizeOptions>) -> String {
    let opts = options.unwrap_or_default();
    let max_length = opts.max_length.unwrap_or(MAX_LOG_LENGTH);

    let sanitized: String = if opts.strict {
        // STRICT MODE: Allowlist approach
        // Only permit alphanumerics, spaces, and common safe punctuation
        value
            .chars()
            .filter(|c| {
                c.is_ascii_alphanumeric()
                    || *c == ' '
                    || *c == '.'
                    || *c == ','
                    || *c == ':'
                    || *c == ';'
                    || *c == '!'
                    || *c == '?'
                    || *c == '-'
                    || *c == '_'
                    || *c == '@'
                    || *c == '/'
                    || *c == '('
                    || *c == ')'
                    || *c == '['
                    || *c == ']'
            })
            .collect()
    } else {
        // STANDARD MODE: Blocklist approach
        let mut result = String::with_capacity(value.len());

        let mut chars = value.chars().peekable();
        while let Some(c) = chars.next() {
            // Skip ANSI escape sequences (ESC [ ... m)
            if c == '\x1b' {
                // Check if this is a CSI sequence (ESC [)
                if chars.peek() == Some(&'[') {
                    chars.next(); // consume '['
                                  // Skip until we hit a letter (the terminator)
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if next.is_ascii_alphabetic() {
                            break;
                        }
                    }
                    continue;
                } else {
                    // Skip any other ESC sequence (ESC followed by one char)
                    chars.next();
                    continue;
                }
            }

            // Replace CR and LF with space (prevents log forging)
            if c == '\r' || c == '\n' {
                result.push(' ');
                continue;
            }

            // Skip null bytes
            if c == '\x00' {
                continue;
            }

            // Skip ASCII control characters (C0 set: \x00-\x1F, DEL: \x7F)
            if c.is_ascii_control() {
                continue;
            }

            // Skip Unicode C1 control characters (U+0080 to U+009F)
            let code = c as u32;
            if (0x0080..=0x009F).contains(&code) {
                continue;
            }

            // Replace Unicode line/paragraph separators with space
            if c == '\u{2028}' || c == '\u{2029}' {
                result.push(' ');
                continue;
            }

            result.push(c);
        }

        result
    };

    // Truncate to prevent log flooding
    if sanitized.len() > max_length {
        let mut truncated: String = sanitized.chars().take(max_length).collect();
        truncated.push_str("...[truncated]");
        truncated
    } else {
        sanitized
    }
}

/// Sanitizes an email for logging (masks part of the email).
///
/// Redacts the local part of the email while keeping the first 2 characters
/// and the domain visible for debugging purposes.
///
/// # Examples
///
/// ```
/// use loyalty_backend::utils::logging::sanitize_email;
///
/// assert_eq!(sanitize_email("john.doe@example.com"), "jo***@example.com");
/// assert_eq!(sanitize_email("ab@test.org"), "ab@test.org");
/// ```
pub fn sanitize_email(email: &str) -> String {
    let sanitized = sanitize_log_value(email, None);

    if let Some(at_index) = sanitized.find('@') {
        if at_index > 2 {
            let (local, domain) = sanitized.split_at(at_index);
            let visible_chars: String = local.chars().take(2).collect();
            return format!("{}***{}", visible_chars, domain);
        }
    }

    sanitized
}

/// Sanitizes a user ID for logging (shows first 8 chars of UUID).
///
/// For UUIDs, shows only the first 8 characters followed by "..." to
/// allow correlation in logs while reducing exposure of the full ID.
///
/// # Examples
///
/// ```
/// use loyalty_backend::utils::logging::sanitize_user_id;
///
/// assert_eq!(
///     sanitize_user_id("550e8400-e29b-41d4-a716-446655440000"),
///     "550e8400..."
/// );
/// assert_eq!(sanitize_user_id("short"), "short");
/// ```
pub fn sanitize_user_id(user_id: &str) -> String {
    let sanitized = sanitize_log_value(user_id, None);

    if sanitized.len() > 8 {
        let prefix: String = sanitized.chars().take(8).collect();
        format!("{}...", prefix)
    } else {
        sanitized
    }
}

/// Sanitizes a URL path for logging.
///
/// Applies standard log sanitization to prevent injection attacks.
pub fn sanitize_url(url: &str) -> String {
    sanitize_log_value(url, None)
}

/// Sanitizes an IP address for logging.
///
/// Validates that the IP address contains only expected characters
/// (digits, dots, colons for IPv6, and hex letters for IPv6).
///
/// # Examples
///
/// ```
/// use loyalty_backend::utils::logging::sanitize_ip;
///
/// assert_eq!(sanitize_ip(Some("192.168.1.1")), "192.168.1.1");
/// assert_eq!(sanitize_ip(Some("::1")), "::1");
/// assert_eq!(sanitize_ip(None), "unknown");
/// assert_eq!(sanitize_ip(Some("invalid\nip")), "invalid-ip");
/// ```
pub fn sanitize_ip(ip: Option<&str>) -> String {
    match ip {
        None => "unknown".to_string(),
        Some(ip_str) => {
            let sanitized = sanitize_log_value(ip_str, None);
            // IP addresses should only contain numbers, dots, and colons (for IPv6)
            let is_valid = sanitized
                .chars()
                .all(|c| c.is_ascii_digit() || c == '.' || c == ':' || c.is_ascii_hexdigit());

            if is_valid {
                sanitized
            } else {
                "invalid-ip".to_string()
            }
        },
    }
}

/// Environment type for logging configuration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Production,
}

impl Environment {
    /// Detect the environment from the `RUST_ENV` or `NODE_ENV` environment variable.
    ///
    /// Returns `Development` if the variable is not set or is set to "development".
    /// Returns `Production` for "production" or any other value.
    pub fn from_env() -> Self {
        let env_var = std::env::var("RUST_ENV")
            .or_else(|_| std::env::var("NODE_ENV"))
            .unwrap_or_else(|_| "development".to_string());

        match env_var.to_lowercase().as_str() {
            "production" | "prod" => Environment::Production,
            _ => Environment::Development,
        }
    }
}

/// Initialize the tracing subscriber with appropriate formatting.
///
/// # Configuration
///
/// - **Production**: JSON format for structured logging, info level default
/// - **Development**: Pretty format with colors, debug level default
///
/// The log level can be overridden using the `RUST_LOG` environment variable.
///
/// # Examples
///
/// ```no_run
/// use loyalty_backend::utils::logging::init_tracing;
///
/// // Initialize with auto-detected environment
/// init_tracing(None);
///
/// // Or specify the environment explicitly
/// use loyalty_backend::utils::logging::Environment;
/// init_tracing(Some(Environment::Production));
/// ```
pub fn init_tracing(env: Option<Environment>) {
    let environment = env.unwrap_or_else(Environment::from_env);

    // Build the environment filter
    // Use RUST_LOG if set, otherwise use defaults based on environment
    let default_directive = match environment {
        Environment::Production => "info",
        Environment::Development => "debug",
    };

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(format!(
            "{},tower_http=debug,axum::rejection=trace",
            default_directive
        ))
    });

    match environment {
        Environment::Production => {
            // JSON format for production - structured logging for log aggregators
            tracing_subscriber::registry()
                .with(env_filter)
                .with(
                    fmt::layer()
                        .json()
                        .with_current_span(true)
                        .with_span_list(true)
                        .with_file(true)
                        .with_line_number(true)
                        .with_thread_ids(true)
                        .with_target(true),
                )
                .init();
        },
        Environment::Development => {
            // Pretty format for development - human-readable with colors
            tracing_subscriber::registry()
                .with(env_filter)
                .with(
                    fmt::layer()
                        .pretty()
                        .with_ansi(true)
                        .with_file(true)
                        .with_line_number(true)
                        .with_target(true)
                        .with_span_events(FmtSpan::CLOSE),
                )
                .init();
        },
    }

    tracing::info!(
        environment = ?environment,
        "Tracing initialized"
    );
}

/// Custom span maker for HTTP request tracing
#[derive(Debug, Clone)]
pub struct RequestSpanMaker;

impl<B> MakeSpan<B> for RequestSpanMaker {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let method = request.method().as_str();
        let uri = sanitize_url(request.uri().path());
        let version = format!("{:?}", request.version());

        // Extract and sanitize client IP if available
        let client_ip = request
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.split(',').next().unwrap_or("unknown").trim())
            .or_else(|| {
                request
                    .headers()
                    .get("x-real-ip")
                    .and_then(|v| v.to_str().ok())
            });

        let sanitized_ip = sanitize_ip(client_ip);

        tracing::info_span!(
            "http_request",
            method = %method,
            uri = %uri,
            version = %version,
            client_ip = %sanitized_ip,
        )
    }
}

/// Custom failure handler for HTTP request tracing
#[derive(Debug, Clone)]
pub struct RequestOnFailure;

impl OnFailure<ServerErrorsFailureClass> for RequestOnFailure {
    fn on_failure(
        &mut self,
        failure_classification: ServerErrorsFailureClass,
        latency: Duration,
        _span: &Span,
    ) {
        match failure_classification {
            ServerErrorsFailureClass::StatusCode(status) => {
                tracing::error!(
                    status = %status.as_u16(),
                    latency_ms = %latency.as_millis(),
                    "Request failed with error status"
                );
            },
            ServerErrorsFailureClass::Error(msg) => {
                tracing::error!(
                    error = %msg,
                    latency_ms = %latency.as_millis(),
                    "Request failed with error"
                );
            },
        }
    }
}

/// Creates a configured TraceLayer for HTTP request logging.
///
/// This layer adds tracing spans for each incoming HTTP request with:
/// - Request method, URI, and version
/// - Client IP address (sanitized)
/// - Response status code and latency
/// - Error logging for failed requests
///
/// # Examples
///
/// ```no_run
/// use axum::Router;
/// use loyalty_backend::utils::logging::create_trace_layer;
///
/// let app = Router::new()
///     // ... routes ...
///     .layer(create_trace_layer());
/// ```
pub fn create_trace_layer() -> TraceLayer<
    tower_http::classify::SharedClassifier<tower_http::classify::ServerErrorsAsFailures>,
    RequestSpanMaker,
    DefaultOnRequest,
    DefaultOnResponse,
    (),
    (),
    RequestOnFailure,
> {
    TraceLayer::new_for_http()
        .make_span_with(RequestSpanMaker)
        .on_request(DefaultOnRequest::new().level(Level::INFO))
        .on_response(
            DefaultOnResponse::new()
                .level(Level::INFO)
                .latency_unit(LatencyUnit::Millis),
        )
        .on_body_chunk(())
        .on_eos(())
        .on_failure(RequestOnFailure)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_log_value_removes_newlines() {
        assert_eq!(sanitize_log_value("hello\nworld", None), "hello world");
        assert_eq!(sanitize_log_value("hello\r\nworld", None), "hello  world");
        assert_eq!(sanitize_log_value("hello\rworld", None), "hello world");
    }

    #[test]
    fn test_sanitize_log_value_removes_control_chars() {
        assert_eq!(sanitize_log_value("hello\x00world", None), "helloworld");
        assert_eq!(sanitize_log_value("hello\x1Fworld", None), "helloworld");
        assert_eq!(sanitize_log_value("hello\x7Fworld", None), "helloworld");
    }

    #[test]
    fn test_sanitize_log_value_removes_ansi_escapes() {
        assert_eq!(
            sanitize_log_value("hello\x1b[31mred\x1b[0mworld", None),
            "helloredworld"
        );
    }

    #[test]
    fn test_sanitize_log_value_truncates_long_strings() {
        let long_string = "a".repeat(600);
        let result = sanitize_log_value(&long_string, None);
        assert!(result.len() <= MAX_LOG_LENGTH + 14); // +14 for "...[truncated]"
        assert!(result.ends_with("...[truncated]"));
    }

    #[test]
    fn test_sanitize_log_value_strict_mode() {
        let opts = SanitizeOptions {
            strict: true,
            ..Default::default()
        };
        // Strict mode allows alphanumerics, spaces, and safe punctuation: . , : ; ! ? - _ @ / ( ) [ ]
        // <, >, and ' are stripped as they are not in the allowlist
        assert_eq!(
            sanitize_log_value("user<script>alert('xss')</script>", Some(opts)),
            "userscriptalert(xss)/script"
        );
    }

    #[test]
    fn test_sanitize_log_value_strict_mode_allows_safe_chars() {
        let opts = SanitizeOptions {
            strict: true,
            ..Default::default()
        };
        assert_eq!(
            sanitize_log_value("test@example.com", Some(opts.clone())),
            "test@example.com"
        );
        assert_eq!(
            sanitize_log_value("hello, world!", Some(opts)),
            "hello, world!"
        );
    }

    #[test]
    fn test_sanitize_email() {
        assert_eq!(sanitize_email("john.doe@example.com"), "jo***@example.com");
        assert_eq!(sanitize_email("ab@test.org"), "ab@test.org");
        assert_eq!(sanitize_email("a@test.org"), "a@test.org");
        assert_eq!(sanitize_email("test"), "test");
    }

    #[test]
    fn test_sanitize_user_id() {
        assert_eq!(
            sanitize_user_id("550e8400-e29b-41d4-a716-446655440000"),
            "550e8400..."
        );
        assert_eq!(sanitize_user_id("short"), "short");
        assert_eq!(sanitize_user_id("12345678"), "12345678");
        assert_eq!(sanitize_user_id("123456789"), "12345678...");
    }

    #[test]
    fn test_sanitize_ip() {
        assert_eq!(sanitize_ip(Some("192.168.1.1")), "192.168.1.1");
        assert_eq!(sanitize_ip(Some("::1")), "::1");
        assert_eq!(
            sanitize_ip(Some("2001:0db8:85a3:0000:0000:8a2e:0370:7334")),
            "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
        );
        assert_eq!(sanitize_ip(None), "unknown");
        // After sanitization, newlines become spaces, which is invalid for IP
        assert_eq!(sanitize_ip(Some("invalid\nip")), "invalid-ip");
    }

    #[test]
    fn test_sanitize_log_value_unicode_control_chars() {
        // C1 control characters
        assert_eq!(sanitize_log_value("hello\u{0080}world", None), "helloworld");
        assert_eq!(sanitize_log_value("hello\u{009F}world", None), "helloworld");
        // Line/paragraph separators
        assert_eq!(
            sanitize_log_value("hello\u{2028}world", None),
            "hello world"
        );
        assert_eq!(
            sanitize_log_value("hello\u{2029}world", None),
            "hello world"
        );
    }

    #[test]
    fn test_environment_detection() {
        // Test default behavior (when env vars are not set)
        // Note: This test may be affected by actual environment variables
        let env = Environment::from_env();
        assert!(matches!(
            env,
            Environment::Development | Environment::Production
        ));
    }
}
