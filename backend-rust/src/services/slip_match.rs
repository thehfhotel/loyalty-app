//! Slip decision rules
//!
//! One pure function turns a SlipOK answer plus the booking's own facts into
//! a decision. No IO, no clock, no database — everything the rules need is a
//! parameter, so every branch is covered by a table-driven unit test and the
//! caller (`routes::bookings::run_slipok_check`) stays a thin shell around it.
//!
//! The rules run in a fixed order and stop at the first failure:
//!
//! 1. SlipOK refused on quota    → [`SlipDecision::Unavailable`] `quota_exceeded`
//! 2. SlipOK could not read it   → [`SlipDecision::Manual`] `slip_invalid`
//! 3. Amount differs by a satang → [`SlipDecision::Manual`] `amount_mismatch`
//! 4. Receiver is not ours       → [`SlipDecision::Manual`] `receiver_mismatch`
//! 5. `transRef` already stored  → [`SlipDecision::Manual`] `duplicate`
//! 6. otherwise                  → [`SlipDecision::Confirm`]
//!
//! `Manual` and `Unavailable` both leave `admin_status = 'pending'`; they
//! differ only in whether SlipOK gave us an answer to show the admin.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};

use crate::services::slipok::{SlipVerificationResult, VerificationStatus};

/// Reason strings stored in `booking_slips.slipok_reason`. They are machine
/// values, not copy: the admin sidebar maps them to wording.
pub const REASON_QUOTA_EXCEEDED: &str = "quota_exceeded";
pub const REASON_SLIP_INVALID: &str = "slip_invalid";
pub const REASON_AMOUNT_MISMATCH: &str = "amount_mismatch";
pub const REASON_RECEIVER_MISMATCH: &str = "receiver_mismatch";
pub const REASON_DUPLICATE: &str = "duplicate";

/// What to do with a slip after SlipOK has answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlipDecision {
    /// Every check passed. `trans_ref` is the bank reference to store, and
    /// is what makes the *next* upload of the same slip a duplicate.
    Confirm { trans_ref: String },
    /// SlipOK answered but a check failed — a human decides.
    Manual { reason: &'static str },
    /// SlipOK gave no usable answer — a human decides.
    Unavailable { reason: &'static str },
}

/// Decide what to do with a verified slip.
///
/// * `result` — what SlipOK returned.
/// * `expected_satang` — the booking's amount due now, in integer satang.
/// * `receiving_id` — the property's receiving PromptPay ID (13-digit tax
///   id today, possibly a 10-digit phone later).
/// * `already_seen` — whether this `transRef` is already stored against
///   another slip.
pub fn decide(
    result: &SlipVerificationResult,
    expected_satang: i64,
    receiving_id: &str,
    already_seen: bool,
) -> SlipDecision {
    // 1. Quota. Distinct from every other failure because it is not the
    //    slip's fault and it *will* happen — the free plan is metered.
    if result.status == VerificationStatus::QuotaExceeded {
        return SlipDecision::Unavailable {
            reason: REASON_QUOTA_EXCEEDED,
        };
    }

    // 2. SlipOK answered "no". Unreadable image, not a slip, bank refused.
    if result.status != VerificationStatus::Verified || !result.success {
        return SlipDecision::Manual {
            reason: REASON_SLIP_INVALID,
        };
    }

    // 3. Amount, to the satang. No tolerance: a one-satang difference is a
    //    human's problem, not a rounding window we quietly absorb.
    match result.amount.and_then(to_satang) {
        Some(satang) if satang == expected_satang => {},
        _ => {
            return SlipDecision::Manual {
                reason: REASON_AMOUNT_MISMATCH,
            }
        },
    }

    // 4. Receiver. The slip must have paid *us*.
    let received_by = result
        .receiver_proxy_value
        .as_deref()
        .or(result.receiver_account_value.as_deref());
    if !receiver_matches(receiving_id, received_by) {
        return SlipDecision::Manual {
            reason: REASON_RECEIVER_MISMATCH,
        };
    }

    // 5. Duplicate: this bank reference already backs another slip.
    if already_seen {
        return SlipDecision::Manual {
            reason: REASON_DUPLICATE,
        };
    }

    // A verified slip with no reference cannot be stored (the duplicate
    // defence is the unique index on that reference), so it goes to manual
    // rather than confirming something we cannot deduplicate later.
    match result.transaction_id.as_deref().map(str::trim) {
        Some(trans_ref) if !trans_ref.is_empty() => SlipDecision::Confirm {
            trans_ref: trans_ref.to_string(),
        },
        _ => SlipDecision::Manual {
            reason: REASON_SLIP_INVALID,
        },
    }
}

/// Baht `Decimal` → integer satang, rounding to 2 decimal places first.
/// `None` when the value does not fit an `i64` (absurd input).
///
/// Public so the caller scales the booking's expected amount with exactly
/// the same arithmetic the slip's amount goes through.
pub fn to_satang(amount: Decimal) -> Option<i64> {
    // Explicit half-away-from-zero: `Decimal::round` is banker's rounding,
    // which would send an exact half-satang to the nearest *even* value.
    // Money rounds away from zero, and both sides of the comparison have to
    // agree on which way a half goes.
    (amount * Decimal::from(100))
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
}

/// Does the receiver value on the slip identify the property's receiving
/// account?
///
/// SlipOK returns the payee's proxy/account partially masked, e.g.
/// `xxx-xxx-3047`. The rule:
///
/// * strip everything that is neither a digit nor a masking `x`/`X` from
///   the slip value, and everything that is not a digit from ours;
/// * an unmasked value must equal ours digit for digit;
/// * a masked value must be the same length as ours and every *visible*
///   digit must sit at the same position (aligned right, which for equal
///   lengths is the same as aligning left, and is the way banks mask).
///
/// An absent or empty value never matches — we do not confirm money into an
/// account we cannot see.
fn receiver_matches(expected: &str, candidate: Option<&str>) -> bool {
    let expected: Vec<char> = expected.chars().filter(char::is_ascii_digit).collect();
    if expected.is_empty() {
        return false;
    }

    let Some(candidate) = candidate else {
        return false;
    };

    let candidate: Vec<char> = candidate
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, 'x' | 'X'))
        .map(|c| if c == 'X' { 'x' } else { c })
        .collect();
    if candidate.is_empty() {
        return false;
    }

    if candidate.len() != expected.len() {
        return false;
    }

    // Right-aligned comparison; with equal lengths that is index for index.
    candidate
        .iter()
        .rev()
        .zip(expected.iter().rev())
        .all(|(got, want)| *got == 'x' || got == want)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    /// The property's receiving PromptPay ID today: a 13-digit tax id.
    const TAX_ID: &str = "0105556123047";

    fn verified(amount: Decimal, receiver_proxy: Option<&str>) -> SlipVerificationResult {
        SlipVerificationResult {
            success: true,
            status: VerificationStatus::Verified,
            amount: Some(amount),
            sender_name: Some("Guest".to_string()),
            receiver_name: Some("never matched on".to_string()),
            receiver_proxy_value: receiver_proxy.map(str::to_string),
            receiver_account_value: None,
            transaction_date: None,
            transaction_id: Some("REF-0001".to_string()),
            bank_code: Some("004".to_string()),
            receiving_bank_code: Some("004".to_string()),
            error_code: None,
            error_message: None,
            raw_response: None,
        }
    }

    fn failed_result(status: VerificationStatus) -> SlipVerificationResult {
        SlipVerificationResult {
            success: false,
            status,
            amount: None,
            sender_name: None,
            receiver_name: None,
            receiver_proxy_value: None,
            receiver_account_value: None,
            transaction_date: None,
            transaction_id: None,
            bank_code: None,
            receiving_bank_code: None,
            error_code: Some("X".to_string()),
            error_message: Some("x".to_string()),
            raw_response: None,
        }
    }

    #[test]
    fn decide_table() {
        struct Case {
            name: &'static str,
            result: SlipVerificationResult,
            expected_satang: i64,
            receiving_id: &'static str,
            already_seen: bool,
            want: SlipDecision,
        }

        let cases = vec![
            Case {
                name: "exact amount, unmasked receiver, first sighting",
                result: verified(dec!(1500.00), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Confirm {
                    trans_ref: "REF-0001".to_string(),
                },
            },
            Case {
                name: "masked receiver, every visible digit lines up",
                result: verified(dec!(1500.00), Some("xxx-xxx-xxx3047")),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Confirm {
                    trans_ref: "REF-0001".to_string(),
                },
            },
            Case {
                name: "masked receiver, a visible digit differs",
                result: verified(dec!(1500.00), Some("xxx-xxx-xxx3048")),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_RECEIVER_MISMATCH,
                },
            },
            Case {
                name: "masked receiver of the wrong length (10-digit phone mask)",
                result: verified(dec!(1500.00), Some("xxx-xxx-3047")),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_RECEIVER_MISMATCH,
                },
            },
            Case {
                name: "10-digit phone receiving id, masked slip value",
                result: verified(dec!(1500.00), Some("xxx-xxx-3047")),
                expected_satang: 150_000,
                receiving_id: "0812343047",
                already_seen: false,
                want: SlipDecision::Confirm {
                    trans_ref: "REF-0001".to_string(),
                },
            },
            Case {
                name: "unmasked receiver that is not ours",
                result: verified(dec!(1500.00), Some("0105556999999")),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_RECEIVER_MISMATCH,
                },
            },
            Case {
                name: "no receiver value at all",
                result: verified(dec!(1500.00), None),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_RECEIVER_MISMATCH,
                },
            },
            Case {
                name: "one satang under",
                result: verified(dec!(1499.99), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_AMOUNT_MISMATCH,
                },
            },
            Case {
                name: "one satang over",
                result: verified(dec!(1500.01), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_AMOUNT_MISMATCH,
                },
            },
            Case {
                name: "more than two decimals, rounds onto the expected satang",
                result: verified(dec!(1500.004), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Confirm {
                    trans_ref: "REF-0001".to_string(),
                },
            },
            Case {
                name: "more than two decimals, rounds off the expected satang",
                result: verified(dec!(1500.006), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_AMOUNT_MISMATCH,
                },
            },
            Case {
                name: "no amount on the slip",
                result: SlipVerificationResult {
                    amount: None,
                    ..verified(dec!(1500.00), Some(TAX_ID))
                },
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_AMOUNT_MISMATCH,
                },
            },
            Case {
                name: "everything matches but the reference was seen before",
                result: verified(dec!(1500.00), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: true,
                want: SlipDecision::Manual {
                    reason: REASON_DUPLICATE,
                },
            },
            Case {
                name: "verified but with no bank reference to store",
                result: SlipVerificationResult {
                    transaction_id: None,
                    ..verified(dec!(1500.00), Some(TAX_ID))
                },
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_SLIP_INVALID,
                },
            },
            Case {
                name: "SlipOK could not verify the slip",
                result: failed_result(VerificationStatus::Failed),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_SLIP_INVALID,
                },
            },
            Case {
                name: "quota exhausted — not the slip's fault",
                result: failed_result(VerificationStatus::QuotaExceeded),
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: true,
                want: SlipDecision::Unavailable {
                    reason: REASON_QUOTA_EXCEEDED,
                },
            },
            Case {
                name: "status verified but success=false is still a failure",
                result: SlipVerificationResult {
                    success: false,
                    ..verified(dec!(1500.00), Some(TAX_ID))
                },
                expected_satang: 150_000,
                receiving_id: TAX_ID,
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_SLIP_INVALID,
                },
            },
            Case {
                name: "no receiving id configured for the property",
                result: verified(dec!(1500.00), Some(TAX_ID)),
                expected_satang: 150_000,
                receiving_id: "",
                already_seen: false,
                want: SlipDecision::Manual {
                    reason: REASON_RECEIVER_MISMATCH,
                },
            },
        ];

        for case in cases {
            let got = decide(
                &case.result,
                case.expected_satang,
                case.receiving_id,
                case.already_seen,
            );
            assert_eq!(got, case.want, "case: {}", case.name);
        }
    }

    #[test]
    fn quota_is_checked_before_everything_else() {
        // A quota refusal carries no amount and no receiver; it must not
        // fall through to amount_mismatch.
        let result = failed_result(VerificationStatus::QuotaExceeded);
        assert_eq!(
            decide(&result, 1, TAX_ID, false),
            SlipDecision::Unavailable {
                reason: REASON_QUOTA_EXCEEDED
            }
        );
    }

    #[test]
    fn receiver_matcher_handles_case_and_separators() {
        assert!(receiver_matches(TAX_ID, Some("0105556123047")));
        assert!(receiver_matches(TAX_ID, Some("0-1055-56123-047")));
        assert!(receiver_matches(TAX_ID, Some("XXX-XXX-XXX3047")));
        assert!(!receiver_matches(TAX_ID, Some("")));
        assert!(!receiver_matches(TAX_ID, None));
        assert!(!receiver_matches("", Some(TAX_ID)));
    }

    #[test]
    fn fully_masked_value_of_the_right_length_matches() {
        // Documented consequence of the rule: a value with no visible digit
        // matches anything of the same length. Section 7 of the plan calls
        // for shadow mode precisely because we have never seen a real
        // masked value from our own account.
        assert!(receiver_matches(TAX_ID, Some("xxxxxxxxxxxxx")));
    }

    #[test]
    fn satang_conversion_is_exact() {
        assert_eq!(to_satang(dec!(1500.00)), Some(150_000));
        assert_eq!(to_satang(dec!(0.01)), Some(1));
        assert_eq!(to_satang(dec!(1500.005)), Some(150_001));
    }
}
