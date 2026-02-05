//! Membership ID service module
//!
//! Provides membership ID generation and validation functionality:
//! - Sequential membership ID generation using database sequence
//! - Membership ID format validation

use sqlx::PgPool;

use crate::error::AppError;

/// Prefix for membership IDs
const MEMBERSHIP_ID_PREFIX: &str = "M";

/// Number of digits for the numeric portion (after prefix)
const MEMBERSHIP_ID_DIGITS: usize = 6;

/// Total length of a valid membership ID (prefix + digits)
const MEMBERSHIP_ID_LENGTH: usize = 7;

/// Generate a new unique membership ID using the database sequence.
///
/// Uses the `membership_id_sequence` database sequence to generate sequential IDs.
/// The ID format is "M" followed by a 6-digit zero-padded number (e.g., "M000001").
///
/// # Arguments
/// * `db` - Reference to the PostgreSQL connection pool
///
/// # Returns
/// * `Result<String, AppError>` - The generated membership ID or an error
///
/// # Errors
/// * Returns `AppError::Database` if the sequence query fails
/// * Returns `AppError::Internal` if the sequence returns an unexpected value
///
/// # Example
/// ```rust,no_run
/// use sqlx::PgPool;
/// use loyalty_backend::services::membership_id::generate_membership_id;
///
/// async fn example(pool: &PgPool) -> Result<String, loyalty_backend::error::AppError> {
///     let membership_id = generate_membership_id(pool).await?;
///     println!("Generated membership ID: {}", membership_id);
///     Ok(membership_id)
/// }
/// ```
pub async fn generate_membership_id(db: &PgPool) -> Result<String, AppError> {
    // Get the next value from the database sequence
    let sequence_value: i64 = sqlx::query_scalar("SELECT nextval('membership_id_sequence')")
        .fetch_one(db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get next membership ID sequence value: {}", e);
            AppError::Database(e)
        })?;

    // Validate the sequence value is positive
    if sequence_value <= 0 {
        return Err(AppError::Internal(format!(
            "Invalid sequence value: {}",
            sequence_value
        )));
    }

    // Format as padded string: "M" + 6 digits (e.g., "M000001")
    let membership_id = format!(
        "{}{:0>width$}",
        MEMBERSHIP_ID_PREFIX,
        sequence_value,
        width = MEMBERSHIP_ID_DIGITS
    );

    tracing::debug!("Generated membership ID: {}", membership_id);

    Ok(membership_id)
}

/// Validate a membership ID format.
///
/// Checks if the provided string matches the expected membership ID format:
/// - Must start with "M"
/// - Must be followed by exactly 6 digits
/// - Total length must be 7 characters
///
/// # Arguments
/// * `id` - The membership ID string to validate
///
/// # Returns
/// * `bool` - `true` if the ID format is valid, `false` otherwise
///
/// # Example
/// ```rust
/// use loyalty_backend::services::membership_id::validate_membership_id;
///
/// assert!(validate_membership_id("M000001"));
/// assert!(validate_membership_id("M123456"));
/// assert!(!validate_membership_id("M1234567")); // Too long
/// assert!(!validate_membership_id("M12345"));  // Too short
/// assert!(!validate_membership_id("X000001")); // Wrong prefix
/// assert!(!validate_membership_id("MABCDEF")); // Non-numeric
/// ```
pub fn validate_membership_id(id: &str) -> bool {
    // Check basic length first (fast path)
    if id.len() != MEMBERSHIP_ID_LENGTH {
        return false;
    }

    // Check prefix
    if !id.starts_with(MEMBERSHIP_ID_PREFIX) {
        return false;
    }

    // Check that remaining characters are all digits
    let numeric_part = &id[MEMBERSHIP_ID_PREFIX.len()..];
    if numeric_part.len() != MEMBERSHIP_ID_DIGITS {
        return false;
    }

    numeric_part.chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_membership_id_valid() {
        assert!(validate_membership_id("M000001"));
        assert!(validate_membership_id("M000000"));
        assert!(validate_membership_id("M123456"));
        assert!(validate_membership_id("M999999"));
    }

    #[test]
    fn test_validate_membership_id_invalid_length() {
        // Too short
        assert!(!validate_membership_id("M00001"));
        assert!(!validate_membership_id("M"));
        assert!(!validate_membership_id(""));

        // Too long
        assert!(!validate_membership_id("M0000001"));
        assert!(!validate_membership_id("M12345678"));
    }

    #[test]
    fn test_validate_membership_id_invalid_prefix() {
        assert!(!validate_membership_id("X000001"));
        assert!(!validate_membership_id("m000001")); // lowercase
        assert!(!validate_membership_id("0000001"));
        assert!(!validate_membership_id("N000001"));
    }

    #[test]
    fn test_validate_membership_id_invalid_characters() {
        assert!(!validate_membership_id("MABCDEF"));
        assert!(!validate_membership_id("M12345A"));
        assert!(!validate_membership_id("M-00001"));
        assert!(!validate_membership_id("M 00001"));
        assert!(!validate_membership_id("M00.001"));
    }

    #[test]
    fn test_membership_id_constants() {
        assert_eq!(MEMBERSHIP_ID_PREFIX, "M");
        assert_eq!(MEMBERSHIP_ID_DIGITS, 6);
        assert_eq!(MEMBERSHIP_ID_LENGTH, 7);
    }
}
