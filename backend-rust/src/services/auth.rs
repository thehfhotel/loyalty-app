//! Authentication service module
//!
//! Provides password hashing, JWT token generation and verification.
//! Uses Argon2 for secure password hashing and HS256 for JWT tokens.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Access token expiration time in minutes
const ACCESS_TOKEN_EXPIRATION_MINUTES: i64 = 15;

/// Refresh token expiration time in days
const REFRESH_TOKEN_EXPIRATION_DAYS: i64 = 7;

/// Claims structure for access tokens
///
/// Contains user identification and token metadata following JWT standards.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject - user ID as a string
    pub sub: String,
    /// User's email address
    pub email: String,
    /// Expiration timestamp (Unix epoch seconds)
    pub exp: i64,
    /// Issued at timestamp (Unix epoch seconds)
    pub iat: i64,
}

/// Claims structure for refresh tokens
///
/// Contains minimal information needed to issue new access tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshClaims {
    /// Subject - user ID as a string
    pub sub: String,
    /// Expiration timestamp (Unix epoch seconds)
    pub exp: i64,
    /// Issued at timestamp (Unix epoch seconds)
    pub iat: i64,
    /// Token type identifier to distinguish from access tokens
    pub token_type: String,
}

/// Authentication service trait
///
/// Defines the contract for authentication operations including
/// password hashing and JWT token management.
#[async_trait]
pub trait AuthService: Send + Sync {
    /// Hash a password using Argon2
    ///
    /// # Arguments
    /// * `password` - The plain text password to hash
    ///
    /// # Returns
    /// * `Ok(String)` - The hashed password string
    /// * `Err(AppError)` - If hashing fails
    fn hash_password(&self, password: &str) -> Result<String, AppError>;

    /// Verify a password against a hash
    ///
    /// # Arguments
    /// * `password` - The plain text password to verify
    /// * `hash` - The stored password hash
    ///
    /// # Returns
    /// * `Ok(true)` - If the password matches
    /// * `Ok(false)` - If the password does not match
    /// * `Err(AppError)` - If verification fails
    fn verify_password(&self, password: &str, hash: &str) -> Result<bool, AppError>;

    /// Generate a new access token for a user
    ///
    /// # Arguments
    /// * `user_id` - The user's ID
    /// * `email` - The user's email address
    ///
    /// # Returns
    /// * `Ok(String)` - The encoded JWT access token
    /// * `Err(AppError)` - If token generation fails
    fn generate_access_token(&self, user_id: i32, email: &str) -> Result<String, AppError>;

    /// Verify and decode an access token
    ///
    /// # Arguments
    /// * `token` - The JWT token string to verify
    ///
    /// # Returns
    /// * `Ok(Claims)` - The decoded token claims
    /// * `Err(AppError)` - If the token is invalid or expired
    fn verify_access_token(&self, token: &str) -> Result<Claims, AppError>;

    /// Generate a new refresh token for a user
    ///
    /// # Arguments
    /// * `user_id` - The user's ID
    ///
    /// # Returns
    /// * `Ok(String)` - The encoded JWT refresh token
    /// * `Err(AppError)` - If token generation fails
    fn generate_refresh_token(&self, user_id: i32) -> Result<String, AppError>;

    /// Verify and decode a refresh token
    ///
    /// # Arguments
    /// * `token` - The JWT token string to verify
    ///
    /// # Returns
    /// * `Ok(RefreshClaims)` - The decoded refresh token claims
    /// * `Err(AppError)` - If the token is invalid or expired
    fn verify_refresh_token(&self, token: &str) -> Result<RefreshClaims, AppError>;
}

/// Authentication service implementation
///
/// Provides concrete implementations for password hashing using Argon2
/// and JWT token management using HS256 algorithm.
#[derive(Clone)]
pub struct AuthServiceImpl {
    /// JWT secret key for signing tokens
    jwt_secret: String,
    /// Access token expiration in seconds (optional override)
    access_token_expiration: Option<i64>,
    /// Refresh token expiration in seconds (optional override)
    refresh_token_expiration: Option<i64>,
}

impl AuthServiceImpl {
    /// Create a new AuthServiceImpl with the given JWT secret
    ///
    /// # Arguments
    /// * `jwt_secret` - The secret key for signing JWT tokens
    pub fn new(jwt_secret: String) -> Self {
        Self {
            jwt_secret,
            access_token_expiration: None,
            refresh_token_expiration: None,
        }
    }

    /// Create a new AuthServiceImpl with custom token expiration times
    ///
    /// # Arguments
    /// * `jwt_secret` - The secret key for signing JWT tokens
    /// * `access_token_expiration` - Access token expiration in seconds
    /// * `refresh_token_expiration` - Refresh token expiration in seconds
    pub fn with_expiration(
        jwt_secret: String,
        access_token_expiration: i64,
        refresh_token_expiration: i64,
    ) -> Self {
        Self {
            jwt_secret,
            access_token_expiration: Some(access_token_expiration),
            refresh_token_expiration: Some(refresh_token_expiration),
        }
    }

    /// Get the access token expiration duration
    fn get_access_token_duration(&self) -> Duration {
        match self.access_token_expiration {
            Some(seconds) => Duration::seconds(seconds),
            None => Duration::minutes(ACCESS_TOKEN_EXPIRATION_MINUTES),
        }
    }

    /// Get the refresh token expiration duration
    fn get_refresh_token_duration(&self) -> Duration {
        match self.refresh_token_expiration {
            Some(seconds) => Duration::seconds(seconds),
            None => Duration::days(REFRESH_TOKEN_EXPIRATION_DAYS),
        }
    }

    /// Get the encoding key for JWT operations
    fn encoding_key(&self) -> EncodingKey {
        EncodingKey::from_secret(self.jwt_secret.as_bytes())
    }

    /// Get the decoding key for JWT operations
    fn decoding_key(&self) -> DecodingKey {
        DecodingKey::from_secret(self.jwt_secret.as_bytes())
    }
}

#[async_trait]
impl AuthService for AuthServiceImpl {
    fn hash_password(&self, password: &str) -> Result<String, AppError> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();

        argon2
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))
    }

    fn verify_password(&self, password: &str, hash: &str) -> Result<bool, AppError> {
        let parsed_hash = PasswordHash::new(hash)
            .map_err(|e| AppError::Internal(format!("Failed to parse password hash: {}", e)))?;

        let argon2 = Argon2::default();

        match argon2.verify_password(password.as_bytes(), &parsed_hash) {
            Ok(()) => Ok(true),
            Err(argon2::password_hash::Error::Password) => Ok(false),
            Err(e) => Err(AppError::Internal(format!(
                "Password verification failed: {}",
                e
            ))),
        }
    }

    fn generate_access_token(&self, user_id: i32, email: &str) -> Result<String, AppError> {
        let now = Utc::now();
        let expiration = now + self.get_access_token_duration();

        let claims = Claims {
            sub: user_id.to_string(),
            email: email.to_string(),
            exp: expiration.timestamp(),
            iat: now.timestamp(),
        };

        // Header::default() uses HS256 algorithm
        let header = Header::default();

        encode(&header, &claims, &self.encoding_key())
            .map_err(|e| AppError::Internal(format!("Failed to generate access token: {}", e)))
    }

    fn verify_access_token(&self, token: &str) -> Result<Claims, AppError> {
        // Validation::default() uses HS256 algorithm
        let mut validation = Validation::default();
        validation.validate_exp = true;

        let token_data: TokenData<Claims> =
            decode(token, &self.decoding_key(), &validation).map_err(|e| match e.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                    AppError::Unauthorized("Access token has expired".to_string())
                }
                jsonwebtoken::errors::ErrorKind::InvalidToken => {
                    AppError::Unauthorized("Invalid access token".to_string())
                }
                jsonwebtoken::errors::ErrorKind::InvalidSignature => {
                    AppError::Unauthorized("Invalid token signature".to_string())
                }
                _ => AppError::Unauthorized(format!("Token verification failed: {}", e)),
            })?;

        Ok(token_data.claims)
    }

    fn generate_refresh_token(&self, user_id: i32) -> Result<String, AppError> {
        let now = Utc::now();
        let expiration = now + self.get_refresh_token_duration();

        let claims = RefreshClaims {
            sub: user_id.to_string(),
            exp: expiration.timestamp(),
            iat: now.timestamp(),
            token_type: "refresh".to_string(),
        };

        // Header::default() uses HS256 algorithm
        let header = Header::default();

        encode(&header, &claims, &self.encoding_key())
            .map_err(|e| AppError::Internal(format!("Failed to generate refresh token: {}", e)))
    }

    fn verify_refresh_token(&self, token: &str) -> Result<RefreshClaims, AppError> {
        // Validation::default() uses HS256 algorithm
        let mut validation = Validation::default();
        validation.validate_exp = true;

        let token_data: TokenData<RefreshClaims> =
            decode(token, &self.decoding_key(), &validation).map_err(|e| match e.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                    AppError::Unauthorized("Refresh token has expired".to_string())
                }
                jsonwebtoken::errors::ErrorKind::InvalidToken => {
                    AppError::Unauthorized("Invalid refresh token".to_string())
                }
                jsonwebtoken::errors::ErrorKind::InvalidSignature => {
                    AppError::Unauthorized("Invalid token signature".to_string())
                }
                _ => AppError::Unauthorized(format!("Token verification failed: {}", e)),
            })?;

        // Verify this is actually a refresh token
        if token_data.claims.token_type != "refresh" {
            return Err(AppError::Unauthorized(
                "Invalid token type: expected refresh token".to_string(),
            ));
        }

        Ok(token_data.claims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_service() -> AuthServiceImpl {
        AuthServiceImpl::new("test-secret-key-for-testing-only".to_string())
    }

    #[test]
    fn test_hash_password() {
        let service = create_test_service();
        let password = "secure_password_123";

        let hash = service.hash_password(password).unwrap();

        // Hash should be in Argon2 format
        assert!(hash.starts_with("$argon2"));
        // Hash should be different from the original password
        assert_ne!(hash, password);
    }

    #[test]
    fn test_hash_password_produces_unique_hashes() {
        let service = create_test_service();
        let password = "secure_password_123";

        let hash1 = service.hash_password(password).unwrap();
        let hash2 = service.hash_password(password).unwrap();

        // Same password should produce different hashes (due to random salt)
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_verify_password_correct() {
        let service = create_test_service();
        let password = "secure_password_123";

        let hash = service.hash_password(password).unwrap();
        let result = service.verify_password(password, &hash).unwrap();

        assert!(result);
    }

    #[test]
    fn test_verify_password_incorrect() {
        let service = create_test_service();
        let password = "secure_password_123";
        let wrong_password = "wrong_password";

        let hash = service.hash_password(password).unwrap();
        let result = service.verify_password(wrong_password, &hash).unwrap();

        assert!(!result);
    }

    #[test]
    fn test_verify_password_invalid_hash() {
        let service = create_test_service();
        let result = service.verify_password("password", "invalid_hash");

        assert!(result.is_err());
    }

    #[test]
    fn test_generate_access_token() {
        let service = create_test_service();
        let user_id = 123;
        let email = "test@example.com";

        let token = service.generate_access_token(user_id, email).unwrap();

        // Token should have 3 parts separated by dots (header.payload.signature)
        assert_eq!(token.split('.').count(), 3);
    }

    #[test]
    fn test_verify_access_token() {
        let service = create_test_service();
        let user_id = 123;
        let email = "test@example.com";

        let token = service.generate_access_token(user_id, email).unwrap();
        let claims = service.verify_access_token(&token).unwrap();

        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.email, email);
        assert!(claims.exp > claims.iat);
    }

    #[test]
    fn test_verify_access_token_invalid() {
        let service = create_test_service();

        let result = service.verify_access_token("invalid.token.here");

        assert!(result.is_err());
    }

    #[test]
    fn test_verify_access_token_wrong_secret() {
        let service1 = AuthServiceImpl::new("secret1".to_string());
        let service2 = AuthServiceImpl::new("secret2".to_string());

        let token = service1.generate_access_token(123, "test@example.com").unwrap();
        let result = service2.verify_access_token(&token);

        assert!(result.is_err());
    }

    #[test]
    fn test_generate_refresh_token() {
        let service = create_test_service();
        let user_id = 456;

        let token = service.generate_refresh_token(user_id).unwrap();

        // Token should have 3 parts separated by dots (header.payload.signature)
        assert_eq!(token.split('.').count(), 3);
    }

    #[test]
    fn test_verify_refresh_token() {
        let service = create_test_service();
        let user_id = 456;

        let token = service.generate_refresh_token(user_id).unwrap();
        let claims = service.verify_refresh_token(&token).unwrap();

        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.token_type, "refresh");
        assert!(claims.exp > claims.iat);
    }

    #[test]
    fn test_refresh_token_expiration_longer_than_access() {
        let service = create_test_service();
        let user_id = 789;
        let email = "test@example.com";

        let access_token = service.generate_access_token(user_id, email).unwrap();
        let refresh_token = service.generate_refresh_token(user_id).unwrap();

        let access_claims = service.verify_access_token(&access_token).unwrap();
        let refresh_claims = service.verify_refresh_token(&refresh_token).unwrap();

        // Refresh token should expire later than access token
        assert!(refresh_claims.exp > access_claims.exp);
    }

    #[test]
    fn test_access_token_cannot_be_used_as_refresh() {
        let service = create_test_service();
        let user_id = 123;
        let email = "test@example.com";

        let access_token = service.generate_access_token(user_id, email).unwrap();
        let result = service.verify_refresh_token(&access_token);

        // Should fail because access token doesn't have token_type field
        // or has incorrect type
        assert!(result.is_err());
    }

    #[test]
    fn test_custom_expiration() {
        let service = AuthServiceImpl::with_expiration(
            "test-secret".to_string(),
            3600,  // 1 hour for access
            86400, // 1 day for refresh
        );

        let user_id = 123;
        let email = "test@example.com";

        let access_token = service.generate_access_token(user_id, email).unwrap();
        let refresh_token = service.generate_refresh_token(user_id).unwrap();

        let access_claims = service.verify_access_token(&access_token).unwrap();
        let refresh_claims = service.verify_refresh_token(&refresh_token).unwrap();

        // Verify custom expiration times are applied
        let access_duration = access_claims.exp - access_claims.iat;
        let refresh_duration = refresh_claims.exp - refresh_claims.iat;

        assert_eq!(access_duration, 3600);
        assert_eq!(refresh_duration, 86400);
    }

    #[test]
    fn test_claims_timestamps() {
        let service = create_test_service();
        let now = Utc::now().timestamp();

        let token = service.generate_access_token(1, "test@example.com").unwrap();
        let claims = service.verify_access_token(&token).unwrap();

        // iat should be close to now (within 1 second)
        assert!((claims.iat - now).abs() <= 1);

        // exp should be 15 minutes after iat
        assert_eq!(claims.exp - claims.iat, 15 * 60);
    }

    #[test]
    fn test_default_access_token_expiration_is_15_minutes() {
        let service = create_test_service();

        let token = service.generate_access_token(1, "test@example.com").unwrap();
        let claims = service.verify_access_token(&token).unwrap();

        // Default access token expiration is 15 minutes (900 seconds)
        assert_eq!(claims.exp - claims.iat, 900);
    }

    #[test]
    fn test_default_refresh_token_expiration_is_7_days() {
        let service = create_test_service();

        let token = service.generate_refresh_token(1).unwrap();
        let claims = service.verify_refresh_token(&token).unwrap();

        // Default refresh token expiration is 7 days (604800 seconds)
        assert_eq!(claims.exp - claims.iat, 7 * 24 * 60 * 60);
    }

    #[test]
    fn test_claims_serialization() {
        let claims = Claims {
            sub: "123".to_string(),
            email: "test@example.com".to_string(),
            exp: 1234567890,
            iat: 1234567800,
        };

        let json = serde_json::to_string(&claims).unwrap();
        let deserialized: Claims = serde_json::from_str(&json).unwrap();

        assert_eq!(claims.sub, deserialized.sub);
        assert_eq!(claims.email, deserialized.email);
        assert_eq!(claims.exp, deserialized.exp);
        assert_eq!(claims.iat, deserialized.iat);
    }

    #[test]
    fn test_refresh_claims_serialization() {
        let claims = RefreshClaims {
            sub: "456".to_string(),
            exp: 1234567890,
            iat: 1234567800,
            token_type: "refresh".to_string(),
        };

        let json = serde_json::to_string(&claims).unwrap();
        let deserialized: RefreshClaims = serde_json::from_str(&json).unwrap();

        assert_eq!(claims.sub, deserialized.sub);
        assert_eq!(claims.exp, deserialized.exp);
        assert_eq!(claims.iat, deserialized.iat);
        assert_eq!(claims.token_type, deserialized.token_type);
    }

    // ============================================================
    // Additional tests per user requirements
    // ============================================================

    /// Test that hash_password creates a valid Argon2 hash
    #[test]
    fn test_hash_password_creates_valid_hash() {
        let service = create_test_service();
        let password = "my_secure_password!@#$%";

        let hash = service.hash_password(password).unwrap();

        // Verify the hash is in valid Argon2 format
        assert!(hash.starts_with("$argon2"));
        // The hash should be parseable
        let parsed = PasswordHash::new(&hash);
        assert!(parsed.is_ok());
    }

    /// Test successful password verification
    #[test]
    fn test_verify_password_success() {
        let service = create_test_service();
        let password = "correct_password_123";

        let hash = service.hash_password(password).unwrap();
        let result = service.verify_password(password, &hash);

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    /// Test password verification failure with wrong password
    #[test]
    fn test_verify_password_failure() {
        let service = create_test_service();
        let correct_password = "correct_password";
        let wrong_password = "wrong_password";

        let hash = service.hash_password(correct_password).unwrap();
        let result = service.verify_password(wrong_password, &hash);

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    /// Test access token verification with a valid token
    #[test]
    fn test_verify_access_token_valid() {
        let service = create_test_service();
        let user_id = 42;
        let email = "user@example.com";

        let token = service.generate_access_token(user_id, email).unwrap();
        let result = service.verify_access_token(&token);

        assert!(result.is_ok());
        let claims = result.unwrap();
        assert_eq!(claims.sub, "42");
        assert_eq!(claims.email, email);
    }

    /// Test access token verification fails for expired tokens
    #[test]
    fn test_verify_access_token_expired() {
        // Create a token that's already expired by using negative expiration
        // This avoids timing-dependent tests
        use jsonwebtoken::{encode, EncodingKey, Header};

        let jwt_secret = "test-secret-key";
        let now = chrono::Utc::now();

        // Create claims with expiration in the past
        let claims = Claims {
            sub: "123".to_string(),
            email: "test@example.com".to_string(),
            exp: (now - chrono::Duration::hours(1)).timestamp(), // Expired 1 hour ago
            iat: (now - chrono::Duration::hours(2)).timestamp(),
        };

        let expired_token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(jwt_secret.as_bytes()),
        ).unwrap();

        let service = AuthServiceImpl::new(jwt_secret.to_string());
        let result = service.verify_access_token(&expired_token);

        assert!(result.is_err());
        match result {
            Err(AppError::Unauthorized(msg)) => {
                assert!(msg.contains("expired"), "Expected expiration error, got: {}", msg);
            }
            _ => panic!("Expected Unauthorized error for expired token"),
        }
    }

    /// Test access token verification fails for various malformed tokens
    #[test]
    fn test_verify_access_token_malformed() {
        let service = create_test_service();

        // Completely invalid token
        let result1 = service.verify_access_token("not.a.valid.token");
        assert!(result1.is_err());

        // Empty string
        let result2 = service.verify_access_token("");
        assert!(result2.is_err());

        // Random garbage
        let result3 = service.verify_access_token("garbage");
        assert!(result3.is_err());
    }

    /// Test refresh token verification with a valid token
    #[test]
    fn test_verify_refresh_token_valid() {
        let service = create_test_service();
        let user_id = 99;

        let token = service.generate_refresh_token(user_id).unwrap();
        let result = service.verify_refresh_token(&token);

        assert!(result.is_ok());
        let claims = result.unwrap();
        assert_eq!(claims.sub, "99");
        assert_eq!(claims.token_type, "refresh");
    }
}
