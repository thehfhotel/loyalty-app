//! Stable, non-reversible email identifiers for log correlation.
//!
//! LOW-4 (security-2026-05-13.md): admin and OAuth handlers used to log
//! raw email addresses via `email = %email`. Emails are PII under PDPA
//! and don't need to be retained in plaintext logs — what we actually
//! want is a stable token that lets support correlate "the request I
//! made at 12:03 PM" with the corresponding log line, without storing
//! the address itself. A 12-hex-char (48-bit) SHA-256 truncation
//! satisfies that requirement: the input space (email addresses) is
//! large enough that the hash is non-reversible in practice, and 48
//! bits is far more entropy than support correlation needs.
//!
//! The hash is also case- and whitespace-normalised so a user who
//! logs in with `Foo@Example.com` and another who logs in with
//! `foo@example.com` produce the same hash — which is the behaviour
//! we want for correlation.

use sha2::{Digest, Sha256};

/// Compute a 12-hex-character (48-bit) prefix of `SHA-256(email)` after
/// trimming whitespace and lowercasing.
///
/// Used in place of raw email values in log fields:
///
/// ```ignore
/// tracing::info!(email_hash = %hash_email(&email), "OAuth login");
/// ```
///
/// # Properties
///
/// - **Stable**: the same input always produces the same output, so a
///   support engineer can correlate log lines that touch the same user.
/// - **Non-reversible in practice**: 48-bit prefix of SHA-256 over a
///   sparse input space (email addresses, not arbitrary bytes), no
///   secret involved — collision-resistant enough for log correlation,
///   pre-image-resistant for a single-target attack.
/// - **Case- and whitespace-normalised**: `Foo@Example.com`,
///   `foo@example.com`, and `  foo@example.com  ` produce the same
///   hash. Email addresses are case-insensitive on the local part by
///   convention (RFC 5321 §2.4 leaves it implementation-defined; every
///   mainstream provider normalises) and on the domain part by spec.
pub fn hash_email(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let mut out = String::with_capacity(12);
    for byte in digest.iter().take(6) {
        use std::fmt::Write as _;
        // `write!` to a `String` is infallible; the result is ignored
        // intentionally.
        let _ = write!(&mut out, "{:02x}", byte);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_email_is_stable() {
        assert_eq!(hash_email("ops@example.com"), hash_email("ops@example.com"));
    }

    #[test]
    fn hash_email_normalises_case_and_whitespace() {
        // Case and surrounding whitespace must not change the hash so
        // a user who registers as `Foo@example.com` and signs in as
        // `foo@example.com` correlates to the same log entries.
        let a = hash_email("foo@example.com");
        let b = hash_email("FOO@example.com");
        let c = hash_email("  foo@Example.COM  ");
        assert_eq!(a, b);
        assert_eq!(a, c);
    }

    #[test]
    fn hash_email_distinguishes_different_inputs() {
        // Different inputs must produce different hashes (within the
        // probability bound of a 48-bit prefix — overwhelming for a
        // two-sample comparison).
        let a = hash_email("alice@example.com");
        let b = hash_email("bob@example.com");
        assert_ne!(a, b);
    }

    #[test]
    fn hash_email_is_twelve_hex_chars() {
        // The truncation length is part of the contract: log
        // aggregators and humans both rely on the column being a
        // consistent width.
        let h = hash_email("anyone@example.com");
        assert_eq!(h.len(), 12);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hash_email_handles_empty_string() {
        // We never want a panic from a missing-email fallback path
        // (e.g. an OAuth provider that doesn't return an email).
        let h = hash_email("");
        assert_eq!(h.len(), 12);
    }
}
