//! Validation utilities module
//!
//! Contains common validation functions for user input validation.
//! Includes both standalone validation functions and custom validators
//! compatible with the `validator` crate.

use regex_lite::Regex;
use std::sync::OnceLock;

// ============================================================================
// Regex Patterns (compiled once and cached)
// ============================================================================

/// Returns a compiled email regex pattern
fn email_regex() -> &'static Regex {
    static EMAIL_REGEX: OnceLock<Regex> = OnceLock::new();
    EMAIL_REGEX.get_or_init(|| {
        // Stricter email pattern:
        // - Local part cannot start/end with dot
        // - No consecutive dots
        // - Requires at least one dot in domain (TLD)
        Regex::new(
            r"^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-](?:[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]*[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
        ).expect("Invalid email regex pattern")
    })
}

/// Returns a compiled Thai phone number regex pattern
fn thai_phone_regex() -> &'static Regex {
    static THAI_PHONE_REGEX: OnceLock<Regex> = OnceLock::new();
    THAI_PHONE_REGEX.get_or_init(|| {
        // Thai phone number formats:
        // - Mobile: 08x-xxx-xxxx, 09x-xxx-xxxx, 06x-xxx-xxxx
        // - Landline: 02-xxx-xxxx (Bangkok), 0xx-xxx-xxxx (provinces)
        // - With or without dashes/spaces
        // - Optional +66 country code
        Regex::new(r"^(?:\+66|0)(?:(?:2\d{7})|(?:[3-9]\d{7,8})|(?:[689]\d{8}))$")
            .expect("Invalid Thai phone regex pattern")
    })
}

// ============================================================================
// Email Validation
// ============================================================================

/// Validates an email address format.
///
/// # Arguments
///
/// * `email` - The email address to validate
///
/// # Returns
///
/// `true` if the email format is valid, `false` otherwise
///
/// # Example
///
/// ```
/// use loyalty_backend::utils::validation::validate_email;
///
/// assert!(validate_email("user@example.com"));
/// assert!(!validate_email("invalid-email"));
/// ```
pub fn validate_email(email: &str) -> bool {
    if email.is_empty() || email.len() > 254 {
        return false;
    }

    // Check for basic structure before regex
    if !email.contains('@') {
        return false;
    }

    // Validate local part (before @)
    if let Some(at_pos) = email.find('@') {
        let local_part = &email[..at_pos];
        if local_part.is_empty() || local_part.len() > 64 {
            return false;
        }
        // Local part cannot start or end with a dot
        if local_part.starts_with('.') || local_part.ends_with('.') {
            return false;
        }
        // Local part cannot have consecutive dots
        if local_part.contains("..") {
            return false;
        }
    }

    email_regex().is_match(email)
}

// ============================================================================
// Password Validation
// ============================================================================

/// Password validation error messages
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasswordValidationErrors(pub Vec<String>);

impl PasswordValidationErrors {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    pub fn add(&mut self, error: impl Into<String>) {
        self.0.push(error.into());
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn errors(&self) -> &[String] {
        &self.0
    }
}

impl Default for PasswordValidationErrors {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for PasswordValidationErrors {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.join(", "))
    }
}

/// Validates a password against security requirements.
///
/// Requirements:
/// - At least 8 characters
/// - At least one uppercase letter
/// - At least one lowercase letter
/// - At least one number
///
/// # Arguments
///
/// * `password` - The password to validate
///
/// # Returns
///
/// `Ok(())` if the password meets all requirements,
/// `Err(Vec<String>)` with a list of validation errors otherwise
///
/// # Example
///
/// ```
/// use loyalty_backend::utils::validation::validate_password;
///
/// assert!(validate_password("SecurePass123").is_ok());
/// assert!(validate_password("weak").is_err());
/// ```
pub fn validate_password(password: &str) -> Result<(), Vec<String>> {
    let mut errors = PasswordValidationErrors::new();

    // Check minimum length
    if password.len() < 8 {
        errors.add("Password must be at least 8 characters long");
    }

    // Check for uppercase letter
    if !password.chars().any(|c| c.is_uppercase()) {
        errors.add("Password must contain at least one uppercase letter");
    }

    // Check for lowercase letter
    if !password.chars().any(|c| c.is_lowercase()) {
        errors.add("Password must contain at least one lowercase letter");
    }

    // Check for digit
    if !password.chars().any(|c| c.is_ascii_digit()) {
        errors.add("Password must contain at least one number");
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.0)
    }
}

/// Returns the password requirements as a human-readable string.
pub fn password_requirements() -> &'static str {
    "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number"
}

// ============================================================================
// Phone Validation
// ============================================================================

/// Validates a Thai phone number format.
///
/// Accepts formats:
/// - Mobile: 08x, 09x, 06x followed by 7 digits
/// - Landline: 02 followed by 7 digits (Bangkok)
/// - Provincial: 0xx followed by 7-8 digits
/// - With +66 country code (replaces leading 0)
///
/// Note: Dashes and spaces should be stripped before validation.
///
/// # Arguments
///
/// * `phone` - The phone number to validate (digits only, with optional +66)
///
/// # Returns
///
/// `true` if the phone format is valid for Thailand, `false` otherwise
///
/// # Example
///
/// ```
/// use loyalty_backend::utils::validation::validate_phone;
///
/// assert!(validate_phone("0812345678"));
/// assert!(validate_phone("+66812345678"));
/// assert!(!validate_phone("123"));
/// ```
pub fn validate_phone(phone: &str) -> bool {
    if phone.is_empty() {
        return false;
    }

    // Remove common separators for validation
    let cleaned: String = phone
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();

    if cleaned.is_empty() {
        return false;
    }

    thai_phone_regex().is_match(&cleaned)
}

/// Normalizes a Thai phone number to a standard format.
///
/// Removes all non-digit characters except leading +.
/// Converts +66 to 0 prefix.
///
/// # Arguments
///
/// * `phone` - The phone number to normalize
///
/// # Returns
///
/// The normalized phone number or None if invalid
pub fn normalize_phone(phone: &str) -> Option<String> {
    let cleaned: String = phone
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();

    if cleaned.is_empty() {
        return None;
    }

    // Convert +66 to 0
    let normalized = if cleaned.starts_with("+66") {
        format!("0{}", &cleaned[3..])
    } else {
        cleaned
    };

    if validate_phone(&normalized) {
        Some(normalized)
    } else {
        None
    }
}

// ============================================================================
// Custom Validators for validator crate
// ============================================================================

/// Custom validator for email addresses.
///
/// Use with `#[validate(custom(function = "validate_email_custom"))]`
pub fn validate_email_custom(email: &str) -> Result<(), validator::ValidationError> {
    if validate_email(email) {
        Ok(())
    } else {
        let mut error = validator::ValidationError::new("invalid_email");
        error.message = Some("Invalid email address format".into());
        Err(error)
    }
}

/// Custom validator for Thai phone numbers.
///
/// Use with `#[validate(custom(function = "validate_phone_custom"))]`
pub fn validate_phone_custom(phone: &str) -> Result<(), validator::ValidationError> {
    if validate_phone(phone) {
        Ok(())
    } else {
        let mut error = validator::ValidationError::new("invalid_phone");
        error.message = Some("Invalid Thai phone number format".into());
        Err(error)
    }
}

/// Custom validator for passwords.
///
/// Use with `#[validate(custom(function = "validate_password_custom"))]`
pub fn validate_password_custom(password: &str) -> Result<(), validator::ValidationError> {
    match validate_password(password) {
        Ok(()) => Ok(()),
        Err(errors) => {
            let mut error = validator::ValidationError::new("invalid_password");
            error.message = Some(errors.join("; ").into());
            Err(error)
        },
    }
}

/// Custom validator for non-empty strings (after trimming).
///
/// Use with `#[validate(custom(function = "validate_not_empty"))]`
pub fn validate_not_empty(value: &str) -> Result<(), validator::ValidationError> {
    if value.trim().is_empty() {
        let mut error = validator::ValidationError::new("empty_value");
        error.message = Some("Value cannot be empty or whitespace only".into());
        Err(error)
    } else {
        Ok(())
    }
}

/// Custom validator for optional email addresses.
///
/// Use with `#[validate(custom(function = "validate_optional_email"))]`
pub fn validate_optional_email(email: &Option<String>) -> Result<(), validator::ValidationError> {
    match email {
        Some(e) if !e.is_empty() => validate_email_custom(e),
        _ => Ok(()),
    }
}

/// Custom validator for optional phone numbers.
///
/// Use with `#[validate(custom(function = "validate_optional_phone"))]`
pub fn validate_optional_phone(phone: &Option<String>) -> Result<(), validator::ValidationError> {
    match phone {
        Some(p) if !p.is_empty() => validate_phone_custom(p),
        _ => Ok(()),
    }
}

// ============================================================================
// Additional Utility Validators
// ============================================================================

/// Validates that a string contains only alphanumeric characters and underscores.
///
/// Useful for usernames, identifiers, etc.
pub fn validate_alphanumeric_underscore(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// Custom validator for alphanumeric + underscore strings.
///
/// Use with `#[validate(custom(function = "validate_alphanumeric_underscore_custom"))]`
pub fn validate_alphanumeric_underscore_custom(
    value: &str,
) -> Result<(), validator::ValidationError> {
    if validate_alphanumeric_underscore(value) {
        Ok(())
    } else {
        let mut error = validator::ValidationError::new("invalid_format");
        error.message =
            Some("Value must contain only alphanumeric characters and underscores".into());
        Err(error)
    }
}

/// Validates that a string is within a length range.
pub fn validate_length_range(value: &str, min: usize, max: usize) -> bool {
    let len = value.chars().count();
    len >= min && len <= max
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod email_tests {
        use super::*;

        #[test]
        fn test_valid_emails() {
            assert!(validate_email("user@example.com"));
            assert!(validate_email("user.name@example.com"));
            assert!(validate_email("user+tag@example.com"));
            assert!(validate_email("user@subdomain.example.com"));
            assert!(validate_email("user123@example.co.th"));
            assert!(validate_email("a@b.co"));
        }

        #[test]
        fn test_validate_email_valid() {
            assert!(validate_email("user@example.com"));
            assert!(validate_email("test.user@domain.org"));
            assert!(validate_email("user+tag@example.co.th"));
        }

        #[test]
        fn test_validate_email_invalid_no_at() {
            assert!(!validate_email("userexample.com"));
            assert!(!validate_email("invalid"));
            assert!(!validate_email("noatsymbol"));
        }

        #[test]
        fn test_validate_email_invalid_no_domain() {
            assert!(!validate_email("user@"));
            assert!(!validate_email("user@."));
            assert!(!validate_email("user@.com"));
        }

        #[test]
        fn test_validate_email_empty() {
            assert!(!validate_email(""));
        }

        #[test]
        fn test_invalid_emails() {
            assert!(!validate_email(""));
            assert!(!validate_email("invalid"));
            assert!(!validate_email("@example.com"));
            assert!(!validate_email("user@"));
            assert!(!validate_email("user@.com"));
            assert!(!validate_email("user@example"));
            assert!(!validate_email("user name@example.com"));
        }

        #[test]
        fn test_email_length_limits() {
            // Local part too long (> 64 chars)
            let long_local = format!("{}@example.com", "a".repeat(65));
            assert!(!validate_email(&long_local));

            // Total length too long (> 254 chars)
            let long_email = format!("user@{}.com", "a".repeat(250));
            assert!(!validate_email(&long_email));
        }
    }

    mod password_tests {
        use super::*;

        #[test]
        fn test_valid_passwords() {
            assert!(validate_password("SecurePass123").is_ok());
            assert!(validate_password("MyP@ssw0rd").is_ok());
            assert!(validate_password("Abcd1234").is_ok());
            assert!(validate_password("VeryLongPassword123WithMoreChars").is_ok());
        }

        #[test]
        fn test_validate_password_valid() {
            assert!(validate_password("SecurePass123").is_ok());
            assert!(validate_password("MyPassword1").is_ok());
            assert!(validate_password("Test1234").is_ok());
        }

        #[test]
        fn test_validate_password_too_short() {
            let result = validate_password("Short1A");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("at least 8 characters")));
        }

        #[test]
        fn test_validate_password_no_uppercase() {
            let result = validate_password("lowercase123");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("uppercase")));
        }

        #[test]
        fn test_validate_password_no_lowercase() {
            let result = validate_password("UPPERCASE123");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("lowercase")));
        }

        #[test]
        fn test_validate_password_no_number() {
            let result = validate_password("NoNumbersHere");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("number")));
        }

        #[test]
        fn test_password_too_short() {
            let result = validate_password("Short1");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("at least 8 characters")));
        }

        #[test]
        fn test_password_no_uppercase() {
            let result = validate_password("lowercase123");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("uppercase")));
        }

        #[test]
        fn test_password_no_lowercase() {
            let result = validate_password("UPPERCASE123");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("lowercase")));
        }

        #[test]
        fn test_password_no_number() {
            let result = validate_password("NoNumbersHere");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            assert!(errors.iter().any(|e| e.contains("number")));
        }

        #[test]
        fn test_password_multiple_errors() {
            let result = validate_password("abc");
            assert!(result.is_err());
            let errors = result.unwrap_err();
            // Should have errors for: length, uppercase, and number
            assert!(errors.len() >= 3);
        }
    }

    mod phone_tests {
        use super::*;

        #[test]
        fn test_validate_phone_valid() {
            assert!(validate_phone("0812345678"));
            assert!(validate_phone("0912345678"));
            assert!(validate_phone("+66812345678"));
            assert!(validate_phone("021234567")); // Bangkok landline
        }

        #[test]
        fn test_validate_phone_invalid() {
            assert!(!validate_phone(""));
            assert!(!validate_phone("123"));
            assert!(!validate_phone("abcdefghij"));
            assert!(!validate_phone("1234567890")); // Doesn't start with 0 or +66
        }

        #[test]
        fn test_valid_thai_mobiles() {
            assert!(validate_phone("0812345678"));
            assert!(validate_phone("0912345678"));
            assert!(validate_phone("0612345678"));
            assert!(validate_phone("0891234567"));
        }

        #[test]
        fn test_valid_thai_landlines() {
            assert!(validate_phone("021234567")); // Bangkok
            assert!(validate_phone("038123456")); // Provincial
        }

        #[test]
        fn test_valid_with_country_code() {
            assert!(validate_phone("+66812345678"));
            assert!(validate_phone("+66912345678"));
        }

        #[test]
        fn test_invalid_phones() {
            assert!(!validate_phone(""));
            assert!(!validate_phone("123"));
            assert!(!validate_phone("12345678901234567890")); // Too long
            assert!(!validate_phone("abcdefghij")); // Non-numeric
            assert!(!validate_phone("1234567890")); // Doesn't start with 0 or +66
        }

        #[test]
        fn test_phone_with_separators() {
            // After cleaning separators, should be valid
            assert!(validate_phone("081-234-5678"));
            assert!(validate_phone("081 234 5678"));
            assert!(validate_phone("+66-81-234-5678"));
        }

        #[test]
        fn test_normalize_phone() {
            assert_eq!(
                normalize_phone("081-234-5678"),
                Some("0812345678".to_string())
            );
            assert_eq!(
                normalize_phone("+66812345678"),
                Some("0812345678".to_string())
            );
            assert_eq!(normalize_phone("invalid"), None);
            assert_eq!(normalize_phone(""), None);
        }
    }

    mod custom_validator_tests {
        use super::*;

        #[test]
        fn test_custom_email_validator() {
            assert!(validate_email_custom("user@example.com").is_ok());
            assert!(validate_email_custom("invalid").is_err());
        }

        #[test]
        fn test_custom_phone_validator() {
            assert!(validate_phone_custom("0812345678").is_ok());
            assert!(validate_phone_custom("123").is_err());
        }

        #[test]
        fn test_custom_password_validator() {
            assert!(validate_password_custom("SecurePass123").is_ok());
            assert!(validate_password_custom("weak").is_err());
        }

        #[test]
        fn test_validate_not_empty() {
            assert!(validate_not_empty("hello").is_ok());
            assert!(validate_not_empty("  hello  ").is_ok());
            assert!(validate_not_empty("").is_err());
            assert!(validate_not_empty("   ").is_err());
            assert!(validate_not_empty("\t\n").is_err());
        }

        #[test]
        fn test_validate_optional_email() {
            assert!(validate_optional_email(&None).is_ok());
            assert!(validate_optional_email(&Some("".to_string())).is_ok());
            assert!(validate_optional_email(&Some("user@example.com".to_string())).is_ok());
            assert!(validate_optional_email(&Some("invalid".to_string())).is_err());
        }

        #[test]
        fn test_validate_optional_phone() {
            assert!(validate_optional_phone(&None).is_ok());
            assert!(validate_optional_phone(&Some("".to_string())).is_ok());
            assert!(validate_optional_phone(&Some("0812345678".to_string())).is_ok());
            assert!(validate_optional_phone(&Some("invalid".to_string())).is_err());
        }
    }

    mod utility_tests {
        use super::*;

        #[test]
        fn test_alphanumeric_underscore() {
            assert!(validate_alphanumeric_underscore("username"));
            assert!(validate_alphanumeric_underscore("user_name"));
            assert!(validate_alphanumeric_underscore("user123"));
            assert!(validate_alphanumeric_underscore("User_Name_123"));
            assert!(!validate_alphanumeric_underscore(""));
            assert!(!validate_alphanumeric_underscore("user-name"));
            assert!(!validate_alphanumeric_underscore("user name"));
            assert!(!validate_alphanumeric_underscore("user@name"));
        }

        #[test]
        fn test_length_range() {
            assert!(validate_length_range("hello", 1, 10));
            assert!(validate_length_range("hello", 5, 5));
            assert!(!validate_length_range("hello", 6, 10));
            assert!(!validate_length_range("hello", 1, 4));
            assert!(validate_length_range("", 0, 10));
            assert!(!validate_length_range("", 1, 10));
        }

        #[test]
        fn test_password_requirements() {
            let req = password_requirements();
            assert!(req.contains("8 characters"));
            assert!(req.contains("uppercase"));
            assert!(req.contains("lowercase"));
            assert!(req.contains("number"));
        }
    }
}
