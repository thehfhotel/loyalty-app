//! Utility functions module
//!
//! Contains helper functions used across the application.

pub mod logging;
pub mod validation;

// Re-export commonly used items for convenience
pub use logging::{
    create_trace_layer, init_tracing, sanitize_email, sanitize_ip, sanitize_log_value,
    sanitize_url, sanitize_user_id, Environment, SanitizeOptions,
};

pub use validation::{
    // Utility functions
    normalize_phone,
    password_requirements,
    validate_alphanumeric_underscore,
    validate_alphanumeric_underscore_custom,
    // Standalone validators
    validate_email,
    // Custom validators for validator crate
    validate_email_custom,
    validate_length_range,
    validate_not_empty,
    validate_optional_email,
    validate_optional_phone,
    validate_password,
    validate_password_custom,
    validate_phone,
    validate_phone_custom,
    // Types
    PasswordValidationErrors,
};

// Future utility modules will be declared here:
// pub mod date;
