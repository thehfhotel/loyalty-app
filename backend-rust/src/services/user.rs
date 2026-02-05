//! User service module
//!
//! Provides user-related business logic operations including:
//! - User CRUD operations
//! - Profile management
//! - Password updates
//! - User listing and pagination

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;
use validator::Validate;

use crate::error::AppError;
use crate::models::{User, UserProfile, UserProfileResponse, UserResponse, UserRole};

// =============================================================================
// Data Transfer Objects (DTOs)
// =============================================================================

/// DTO for creating a new user
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateUserDto {
    /// User's email address
    #[validate(custom(function = "crate::utils::validation::validate_email_custom"))]
    pub email: String,

    /// Hashed password (already hashed by auth service)
    pub password_hash: String,

    /// User role (defaults to Customer)
    #[serde(default)]
    pub role: Option<UserRole>,

    /// OAuth provider (optional)
    pub oauth_provider: Option<String>,

    /// OAuth provider ID (optional)
    pub oauth_provider_id: Option<String>,
}

/// DTO for updating a user
#[derive(Debug, Clone, Serialize, Deserialize, Validate, Default)]
pub struct UpdateUserDto {
    /// Updated email address
    #[validate(email(message = "Invalid email format"))]
    pub email: Option<String>,

    /// Updated role (admin only)
    pub role: Option<UserRole>,

    /// Updated active status
    pub is_active: Option<bool>,

    /// Updated email verification status
    pub email_verified: Option<bool>,
}

/// DTO for updating user profile
#[derive(Debug, Clone, Serialize, Deserialize, Validate, Default)]
pub struct UpdateProfileDto {
    /// Updated first name
    #[validate(length(min = 1, max = 100, message = "First name must be 1-100 characters"))]
    pub first_name: Option<String>,

    /// Updated last name
    #[validate(length(min = 1, max = 100, message = "Last name must be 1-100 characters"))]
    pub last_name: Option<String>,

    /// Updated phone number
    #[validate(length(max = 20, message = "Phone number too long"))]
    pub phone: Option<String>,

    /// Updated date of birth
    pub date_of_birth: Option<NaiveDate>,

    /// Updated preferences (will be merged with existing)
    pub preferences: Option<JsonValue>,

    /// Updated avatar URL
    #[validate(url(message = "Invalid avatar URL"))]
    pub avatar_url: Option<String>,

    /// Gender (stored in preferences JSON)
    pub gender: Option<String>,

    /// Occupation (stored in preferences JSON)
    pub occupation: Option<String>,
}

/// Pagination parameters
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Pagination {
    /// Page number (1-indexed)
    pub page: Option<i64>,

    /// Number of items per page
    pub limit: Option<i64>,

    /// Search query string
    pub search: Option<String>,
}

impl Pagination {
    /// Get page number with default of 1
    pub fn page(&self) -> i64 {
        self.page.unwrap_or(1).max(1)
    }

    /// Get limit with default of 10, max of 100
    pub fn limit(&self) -> i64 {
        self.limit.unwrap_or(10).clamp(1, 100)
    }

    /// Calculate offset for SQL queries
    pub fn offset(&self) -> i64 {
        (self.page() - 1) * self.limit()
    }
}

/// Paginated result wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    /// List of items
    pub items: Vec<T>,

    /// Total number of items (across all pages)
    pub total: i64,

    /// Current page number
    pub page: i64,

    /// Number of items per page
    pub limit: i64,

    /// Total number of pages
    pub total_pages: i64,
}

impl<T> PaginatedResult<T> {
    /// Create a new paginated result
    pub fn new(items: Vec<T>, total: i64, pagination: &Pagination) -> Self {
        let limit = pagination.limit();
        let page = pagination.page();
        let total_pages = if total == 0 {
            0
        } else {
            (total as f64 / limit as f64).ceil() as i64
        };

        Self {
            items,
            total,
            page,
            limit,
            total_pages,
        }
    }
}

/// User with profile data joined together (raw database row)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserWithProfileRow {
    // User fields
    pub id: Uuid,
    pub email: Option<String>,
    pub role: Option<UserRole>,
    pub is_active: Option<bool>,
    pub email_verified: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub oauth_provider: Option<String>,
    // Profile fields
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub preferences: Option<JsonValue>,
    pub avatar_url: Option<String>,
    pub membership_id: Option<String>,
    pub profile_created_at: Option<DateTime<Utc>>,
    pub profile_updated_at: Option<DateTime<Utc>>,
}

/// Response type for user with profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserWithProfile {
    /// User information
    #[serde(flatten)]
    pub user: UserResponse,

    /// Profile information (if exists)
    pub profile: Option<UserProfileResponse>,
}

impl From<UserWithProfileRow> for UserWithProfile {
    fn from(row: UserWithProfileRow) -> Self {
        let user = UserResponse {
            id: row.id,
            email: row.email.clone(),
            role: row.role.unwrap_or_default(),
            is_active: row.is_active.unwrap_or(true),
            email_verified: row.email_verified.unwrap_or(false),
            oauth_provider: row.oauth_provider,
            created_at: row.created_at.unwrap_or_else(Utc::now),
            updated_at: row.updated_at.unwrap_or_else(Utc::now),
        };

        let profile = row.membership_id.map(|membership_id| {
            // Extract gender and occupation from preferences
            let prefs = row.preferences.clone().unwrap_or(serde_json::json!({}));

            // Build full name
            let full_name = match (&row.first_name, &row.last_name) {
                (Some(first), Some(last)) => Some(format!("{} {}", first, last)),
                (Some(first), None) => Some(first.clone()),
                (None, Some(last)) => Some(last.clone()),
                _ => None,
            };

            UserProfileResponse {
                user_id: row.id,
                first_name: row.first_name,
                last_name: row.last_name,
                full_name,
                phone: row.phone,
                date_of_birth: row.date_of_birth,
                preferences: prefs,
                avatar_url: row.avatar_url,
                membership_id,
                created_at: row.profile_created_at.unwrap_or_else(Utc::now),
                updated_at: row.profile_updated_at.unwrap_or_else(Utc::now),
            }
        });

        UserWithProfile { user, profile }
    }
}

// =============================================================================
// Service Trait
// =============================================================================

/// User service trait defining user management operations
#[async_trait]
pub trait UserService: Send + Sync {
    /// Find a user by their ID
    async fn find_by_id(&self, db: &PgPool, user_id: Uuid) -> Result<Option<User>, AppError>;

    /// Find a user by their email address
    async fn find_by_email(&self, db: &PgPool, email: &str) -> Result<Option<User>, AppError>;

    /// Find a user by their membership ID
    async fn find_by_membership_id(
        &self,
        db: &PgPool,
        membership_id: &str,
    ) -> Result<Option<User>, AppError>;

    /// Create a new user
    async fn create(&self, db: &PgPool, data: CreateUserDto) -> Result<User, AppError>;

    /// Update an existing user
    async fn update(
        &self,
        db: &PgPool,
        user_id: Uuid,
        data: UpdateUserDto,
    ) -> Result<User, AppError>;

    /// Update a user's password
    async fn update_password(
        &self,
        db: &PgPool,
        user_id: Uuid,
        hashed_password: &str,
    ) -> Result<(), AppError>;

    /// Update a user's profile
    async fn update_profile(
        &self,
        db: &PgPool,
        user_id: Uuid,
        data: UpdateProfileDto,
    ) -> Result<UserProfile, AppError>;

    /// Get a user with their profile information
    async fn get_with_profile(
        &self,
        db: &PgPool,
        user_id: Uuid,
    ) -> Result<UserWithProfile, AppError>;

    /// List users with pagination
    async fn list_users(
        &self,
        db: &PgPool,
        pagination: Pagination,
    ) -> Result<PaginatedResult<UserWithProfile>, AppError>;
}

// =============================================================================
// Service Implementation
// =============================================================================

/// Implementation of the UserService trait
pub struct UserServiceImpl;

impl UserServiceImpl {
    /// Create a new UserServiceImpl instance
    pub fn new() -> Self {
        Self
    }
}

impl Default for UserServiceImpl {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl UserService for UserServiceImpl {
    async fn find_by_id(&self, db: &PgPool, user_id: Uuid) -> Result<Option<User>, AppError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT
                id,
                email,
                password_hash,
                role,
                is_active,
                email_verified,
                created_at,
                updated_at,
                oauth_provider,
                oauth_provider_id
            FROM users
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(db)
        .await?;

        Ok(user)
    }

    async fn find_by_email(&self, db: &PgPool, email: &str) -> Result<Option<User>, AppError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT
                id,
                email,
                password_hash,
                role,
                is_active,
                email_verified,
                created_at,
                updated_at,
                oauth_provider,
                oauth_provider_id
            FROM users
            WHERE LOWER(email) = LOWER($1)
            "#,
        )
        .bind(email)
        .fetch_optional(db)
        .await?;

        Ok(user)
    }

    async fn find_by_membership_id(
        &self,
        db: &PgPool,
        membership_id: &str,
    ) -> Result<Option<User>, AppError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT
                u.id,
                u.email,
                u.password_hash,
                u.role,
                u.is_active,
                u.email_verified,
                u.created_at,
                u.updated_at,
                u.oauth_provider,
                u.oauth_provider_id
            FROM users u
            INNER JOIN user_profiles up ON u.id = up.user_id
            WHERE UPPER(up.membership_id) = UPPER($1)
            "#,
        )
        .bind(membership_id)
        .fetch_optional(db)
        .await?;

        Ok(user)
    }

    async fn create(&self, db: &PgPool, data: CreateUserDto) -> Result<User, AppError> {
        // Validate input
        data.validate()
            .map_err(|e| AppError::Validation(e.to_string()))?;

        // Check if email already exists
        if self.find_by_email(db, &data.email).await?.is_some() {
            return Err(AppError::BadRequest(
                "Email address is already registered".to_string(),
            ));
        }

        // Start transaction
        let mut tx = db.begin().await?;

        // Insert user
        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (email, password_hash, role, is_active, email_verified, oauth_provider, oauth_provider_id)
            VALUES ($1, $2, $3, true, false, $4, $5)
            RETURNING
                id,
                email,
                password_hash,
                role,
                is_active,
                email_verified,
                created_at,
                updated_at,
                oauth_provider,
                oauth_provider_id
            "#,
        )
        .bind(&data.email)
        .bind(&data.password_hash)
        .bind(data.role.unwrap_or(UserRole::Customer))
        .bind(&data.oauth_provider)
        .bind(&data.oauth_provider_id)
        .fetch_one(&mut *tx)
        .await?;

        // Generate membership ID using the sequence
        let membership_id: String = sqlx::query_scalar(
            r#"
            SELECT TO_CHAR(nextval('membership_id_sequence'), 'FM00000000')
            "#,
        )
        .fetch_one(&mut *tx)
        .await?;

        // Create user profile with membership ID
        sqlx::query(
            r#"
            INSERT INTO user_profiles (user_id, membership_id)
            VALUES ($1, $2)
            "#,
        )
        .bind(user.id)
        .bind(&membership_id)
        .execute(&mut *tx)
        .await?;

        // Create initial loyalty record
        sqlx::query(
            r#"
            INSERT INTO user_loyalty (user_id, current_points, lifetime_points, total_nights, tier_id)
            SELECT $1, 0, 0, 0, id
            FROM tiers
            WHERE name = 'Bronze'
            "#,
        )
        .bind(user.id)
        .execute(&mut *tx)
        .await?;

        // Commit transaction
        tx.commit().await?;

        Ok(user)
    }

    async fn update(
        &self,
        db: &PgPool,
        user_id: Uuid,
        data: UpdateUserDto,
    ) -> Result<User, AppError> {
        // Validate input
        data.validate()
            .map_err(|e| AppError::Validation(e.to_string()))?;

        // Check if user exists
        let existing_user = self
            .find_by_id(db, user_id)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        // If updating email, check it's not already in use
        if let Some(ref new_email) = data.email {
            if let Some(other_user) = self.find_by_email(db, new_email).await? {
                if other_user.id != user_id {
                    return Err(AppError::BadRequest(
                        "Email address is already in use".to_string(),
                    ));
                }
            }
        }

        // Build dynamic update query
        let email = data
            .email
            .unwrap_or_else(|| existing_user.email.unwrap_or_default());
        let role = data.role.or(existing_user.role);
        let is_active = data.is_active.or(existing_user.is_active);
        let email_verified = data.email_verified.or(existing_user.email_verified);

        let user = sqlx::query_as::<_, User>(
            r#"
            UPDATE users
            SET email = $2, role = $3, is_active = $4, email_verified = $5, updated_at = NOW()
            WHERE id = $1
            RETURNING
                id,
                email,
                password_hash,
                role,
                is_active,
                email_verified,
                created_at,
                updated_at,
                oauth_provider,
                oauth_provider_id
            "#,
        )
        .bind(user_id)
        .bind(email)
        .bind(role)
        .bind(is_active)
        .bind(email_verified)
        .fetch_one(db)
        .await?;

        Ok(user)
    }

    async fn update_password(
        &self,
        db: &PgPool,
        user_id: Uuid,
        hashed_password: &str,
    ) -> Result<(), AppError> {
        let result = sqlx::query(
            r#"
            UPDATE users
            SET password_hash = $2, updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .bind(hashed_password)
        .execute(db)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("User not found".to_string()));
        }

        Ok(())
    }

    async fn update_profile(
        &self,
        db: &PgPool,
        user_id: Uuid,
        data: UpdateProfileDto,
    ) -> Result<UserProfile, AppError> {
        // Validate input
        data.validate()
            .map_err(|e| AppError::Validation(e.to_string()))?;

        // Get current profile to merge preferences
        let current_profile = sqlx::query_as::<_, UserProfile>(
            r#"
            SELECT
                user_id,
                first_name,
                last_name,
                phone,
                date_of_birth,
                preferences,
                avatar_url,
                created_at,
                updated_at,
                membership_id
            FROM user_profiles
            WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Profile not found".to_string()))?;

        // Merge preferences with gender and occupation
        let mut new_preferences = current_profile
            .preferences
            .clone()
            .unwrap_or(serde_json::json!({}));

        if let Some(ref prefs) = data.preferences {
            if let (Some(new_obj), Some(existing_obj)) =
                (prefs.as_object(), new_preferences.as_object_mut())
            {
                for (k, v) in new_obj {
                    existing_obj.insert(k.clone(), v.clone());
                }
            }
        }

        if let Some(ref gender) = data.gender {
            if let Some(obj) = new_preferences.as_object_mut() {
                obj.insert("gender".to_string(), serde_json::json!(gender));
            }
        }

        if let Some(ref occupation) = data.occupation {
            if let Some(obj) = new_preferences.as_object_mut() {
                obj.insert("occupation".to_string(), serde_json::json!(occupation));
            }
        }

        // Build updated values (use new value if provided, otherwise keep existing)
        let first_name = data.first_name.or(current_profile.first_name);
        let last_name = data.last_name.or(current_profile.last_name);
        let phone = data.phone.or(current_profile.phone);
        let date_of_birth = data.date_of_birth.or(current_profile.date_of_birth);
        let avatar_url = data.avatar_url.or(current_profile.avatar_url);

        let profile = sqlx::query_as::<_, UserProfile>(
            r#"
            UPDATE user_profiles
            SET
                first_name = $2,
                last_name = $3,
                phone = $4,
                date_of_birth = $5,
                preferences = $6,
                avatar_url = $7,
                updated_at = NOW()
            WHERE user_id = $1
            RETURNING
                user_id,
                first_name,
                last_name,
                phone,
                date_of_birth,
                preferences,
                avatar_url,
                created_at,
                updated_at,
                membership_id
            "#,
        )
        .bind(user_id)
        .bind(first_name)
        .bind(last_name)
        .bind(phone)
        .bind(date_of_birth)
        .bind(new_preferences)
        .bind(avatar_url)
        .fetch_one(db)
        .await?;

        Ok(profile)
    }

    async fn get_with_profile(
        &self,
        db: &PgPool,
        user_id: Uuid,
    ) -> Result<UserWithProfile, AppError> {
        let row = sqlx::query_as::<_, UserWithProfileRow>(
            r#"
            SELECT
                u.id,
                u.email,
                u.role,
                u.is_active,
                u.email_verified,
                u.created_at,
                u.updated_at,
                u.oauth_provider,
                up.first_name,
                up.last_name,
                up.phone,
                up.date_of_birth,
                up.preferences,
                up.avatar_url,
                up.membership_id,
                up.created_at AS profile_created_at,
                up.updated_at AS profile_updated_at
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        Ok(row.into())
    }

    async fn list_users(
        &self,
        db: &PgPool,
        pagination: Pagination,
    ) -> Result<PaginatedResult<UserWithProfile>, AppError> {
        let limit = pagination.limit();
        let offset = pagination.offset();
        let search_pattern = pagination
            .search
            .as_ref()
            .map(|s| format!("%{}%", s))
            .unwrap_or_default();
        let has_search = pagination.search.is_some()
            && pagination.search.as_ref().map(|s| !s.is_empty()).unwrap_or(false);

        // Get total count
        let total: Option<i64> = if has_search {
            sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM users u
                LEFT JOIN user_profiles up ON u.id = up.user_id
                WHERE u.email ILIKE $1
                   OR up.first_name ILIKE $1
                   OR up.last_name ILIKE $1
                   OR up.membership_id ILIKE $1
                   OR up.phone ILIKE $1
                "#,
            )
            .bind(&search_pattern)
            .fetch_one(db)
            .await?
        } else {
            sqlx::query_scalar("SELECT COUNT(*) FROM users")
                .fetch_one(db)
                .await?
        };

        let total = total.unwrap_or(0);

        // Get paginated results
        let rows: Vec<UserWithProfileRow> = if has_search {
            sqlx::query_as::<_, UserWithProfileRow>(
                r#"
                SELECT
                    u.id,
                    u.email,
                    u.role,
                    u.is_active,
                    u.email_verified,
                    u.created_at,
                    u.updated_at,
                    u.oauth_provider,
                    up.first_name,
                    up.last_name,
                    up.phone,
                    up.date_of_birth,
                    up.preferences,
                    up.avatar_url,
                    up.membership_id,
                    up.created_at AS profile_created_at,
                    up.updated_at AS profile_updated_at
                FROM users u
                LEFT JOIN user_profiles up ON u.id = up.user_id
                WHERE u.email ILIKE $3
                   OR up.first_name ILIKE $3
                   OR up.last_name ILIKE $3
                   OR up.membership_id ILIKE $3
                   OR up.phone ILIKE $3
                ORDER BY u.created_at DESC
                LIMIT $1 OFFSET $2
                "#,
            )
            .bind(limit)
            .bind(offset)
            .bind(&search_pattern)
            .fetch_all(db)
            .await?
        } else {
            sqlx::query_as::<_, UserWithProfileRow>(
                r#"
                SELECT
                    u.id,
                    u.email,
                    u.role,
                    u.is_active,
                    u.email_verified,
                    u.created_at,
                    u.updated_at,
                    u.oauth_provider,
                    up.first_name,
                    up.last_name,
                    up.phone,
                    up.date_of_birth,
                    up.preferences,
                    up.avatar_url,
                    up.membership_id,
                    up.created_at AS profile_created_at,
                    up.updated_at AS profile_updated_at
                FROM users u
                LEFT JOIN user_profiles up ON u.id = up.user_id
                ORDER BY u.created_at DESC
                LIMIT $1 OFFSET $2
                "#,
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?
        };

        let items: Vec<UserWithProfile> = rows.into_iter().map(|row| row.into()).collect();

        Ok(PaginatedResult::new(items, total, &pagination))
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pagination_defaults() {
        let pagination = Pagination::default();
        assert_eq!(pagination.page(), 1);
        assert_eq!(pagination.limit(), 10);
        assert_eq!(pagination.offset(), 0);
    }

    #[test]
    fn test_pagination_custom() {
        let pagination = Pagination {
            page: Some(3),
            limit: Some(25),
            search: None,
        };
        assert_eq!(pagination.page(), 3);
        assert_eq!(pagination.limit(), 25);
        assert_eq!(pagination.offset(), 50);
    }

    #[test]
    fn test_pagination_limits() {
        // Test minimum bounds
        let pagination = Pagination {
            page: Some(-5),
            limit: Some(-10),
            search: None,
        };
        assert_eq!(pagination.page(), 1); // min is 1
        assert_eq!(pagination.limit(), 1); // min is 1

        // Test maximum bounds
        let pagination = Pagination {
            page: Some(1000),
            limit: Some(500),
            search: None,
        };
        assert_eq!(pagination.limit(), 100); // max is 100
    }

    #[test]
    fn test_paginated_result() {
        let items = vec!["a", "b", "c"];
        let pagination = Pagination {
            page: Some(2),
            limit: Some(10),
            search: None,
        };
        let result = PaginatedResult::new(items.clone(), 25, &pagination);

        assert_eq!(result.items, items);
        assert_eq!(result.total, 25);
        assert_eq!(result.page, 2);
        assert_eq!(result.limit, 10);
        assert_eq!(result.total_pages, 3);
    }

    #[test]
    fn test_paginated_result_empty() {
        let items: Vec<String> = vec![];
        let pagination = Pagination::default();
        let result = PaginatedResult::new(items, 0, &pagination);

        assert_eq!(result.total, 0);
        assert_eq!(result.total_pages, 0);
    }

    #[test]
    fn test_create_user_dto_validation() {
        let dto = CreateUserDto {
            email: "invalid-email".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: None,
            oauth_provider_id: None,
        };

        let result = dto.validate();
        assert!(result.is_err());

        let dto = CreateUserDto {
            email: "valid@example.com".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: None,
            oauth_provider_id: None,
        };

        let result = dto.validate();
        assert!(result.is_ok());
    }

    #[test]
    fn test_update_profile_dto_validation() {
        let dto = UpdateProfileDto {
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            phone: Some("1234567890".to_string()),
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            gender: None,
            occupation: None,
        };

        let result = dto.validate();
        assert!(result.is_ok());
    }

    #[test]
    fn test_update_user_dto_default() {
        let dto = UpdateUserDto::default();
        assert!(dto.email.is_none());
        assert!(dto.role.is_none());
        assert!(dto.is_active.is_none());
        assert!(dto.email_verified.is_none());
    }

    #[test]
    fn test_update_profile_dto_default() {
        let dto = UpdateProfileDto::default();
        assert!(dto.first_name.is_none());
        assert!(dto.last_name.is_none());
        assert!(dto.phone.is_none());
        assert!(dto.gender.is_none());
        assert!(dto.occupation.is_none());
    }

    #[test]
    fn test_user_service_impl_default() {
        let service = UserServiceImpl::default();
        // Just verify it creates successfully
        drop(service);
    }

    #[test]
    fn test_user_with_profile_row_conversion() {
        let row = UserWithProfileRow {
            id: Uuid::new_v4(),
            email: Some("test@example.com".to_string()),
            role: Some(UserRole::Customer),
            is_active: Some(true),
            email_verified: Some(true),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
            oauth_provider: None,
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            phone: Some("1234567890".to_string()),
            date_of_birth: None,
            preferences: Some(serde_json::json!({"theme": "dark"})),
            avatar_url: None,
            membership_id: Some("12345678".to_string()),
            profile_created_at: Some(Utc::now()),
            profile_updated_at: Some(Utc::now()),
        };

        let user_with_profile: UserWithProfile = row.into();

        assert!(user_with_profile.profile.is_some());
        let profile = user_with_profile.profile.unwrap();
        assert_eq!(profile.first_name, Some("John".to_string()));
        assert_eq!(profile.last_name, Some("Doe".to_string()));
        assert_eq!(profile.full_name, Some("John Doe".to_string()));
        assert_eq!(profile.membership_id, "12345678".to_string());
    }

    #[test]
    fn test_user_with_profile_row_no_profile() {
        let row = UserWithProfileRow {
            id: Uuid::new_v4(),
            email: Some("test@example.com".to_string()),
            role: Some(UserRole::Customer),
            is_active: Some(true),
            email_verified: Some(false),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
            oauth_provider: None,
            first_name: None,
            last_name: None,
            phone: None,
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            membership_id: None, // No membership ID means no profile
            profile_created_at: None,
            profile_updated_at: None,
        };

        let user_with_profile: UserWithProfile = row.into();

        assert!(user_with_profile.profile.is_none());
        assert_eq!(user_with_profile.user.email, Some("test@example.com".to_string()));
    }

    #[test]
    fn test_full_name_combinations() {
        // First name only
        let row = UserWithProfileRow {
            id: Uuid::new_v4(),
            email: Some("test@example.com".to_string()),
            role: Some(UserRole::Customer),
            is_active: Some(true),
            email_verified: Some(true),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
            oauth_provider: None,
            first_name: Some("John".to_string()),
            last_name: None,
            phone: None,
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            membership_id: Some("12345678".to_string()),
            profile_created_at: Some(Utc::now()),
            profile_updated_at: Some(Utc::now()),
        };

        let user_with_profile: UserWithProfile = row.into();
        let profile = user_with_profile.profile.unwrap();
        assert_eq!(profile.full_name, Some("John".to_string()));

        // Last name only
        let row = UserWithProfileRow {
            id: Uuid::new_v4(),
            email: Some("test@example.com".to_string()),
            role: Some(UserRole::Customer),
            is_active: Some(true),
            email_verified: Some(true),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
            oauth_provider: None,
            first_name: None,
            last_name: Some("Doe".to_string()),
            phone: None,
            date_of_birth: None,
            preferences: None,
            avatar_url: None,
            membership_id: Some("12345678".to_string()),
            profile_created_at: Some(Utc::now()),
            profile_updated_at: Some(Utc::now()),
        };

        let user_with_profile: UserWithProfile = row.into();
        let profile = user_with_profile.profile.unwrap();
        assert_eq!(profile.full_name, Some("Doe".to_string()));
    }

    // =========================================================================
    // Email Format Validation Tests
    // =========================================================================

    #[test]
    fn test_validate_email_format_valid_emails() {
        // Test various valid email formats
        let valid_emails = vec![
            "simple@example.com",
            "very.common@example.com",
            "disposable.style.email.with+symbol@example.com",
            "other.email-with-hyphen@example.com",
            "fully-qualified-domain@example.com",
            "user.name+tag+sorting@example.com",
            "x@example.com",
            "example-indeed@strange-example.com",
            "admin@mailserver1.com",
            "example@s.example",
            "mailhost!username@example.org",
            "user%example.com@example.org",
            "user-@example.org",
        ];

        for email in valid_emails {
            let dto = CreateUserDto {
                email: email.to_string(),
                password_hash: "hashed_password".to_string(),
                role: None,
                oauth_provider: None,
                oauth_provider_id: None,
            };
            let result = dto.validate();
            assert!(
                result.is_ok(),
                "Email '{}' should be valid but validation failed: {:?}",
                email,
                result.err()
            );
        }
    }

    #[test]
    fn test_validate_email_format_invalid_emails() {
        // Test various invalid email formats
        let invalid_emails = vec![
            "",                           // empty
            "plainaddress",               // missing @ and domain
            "@no-local-part.com",         // missing local part
            "missing-domain@",            // missing domain
            "missing-at-sign.com",        // missing @
            "two@@signs.com",             // double @
            ".startswithdot@example.com", // starts with dot
            "endswith.@example.com",      // ends with dot before @
            "contains..double.dots@example.com", // consecutive dots
            "spaces in@local.com",        // spaces not allowed
            "tab\there@example.com",      // tab character
        ];

        for email in invalid_emails {
            let dto = CreateUserDto {
                email: email.to_string(),
                password_hash: "hashed_password".to_string(),
                role: None,
                oauth_provider: None,
                oauth_provider_id: None,
            };
            let result = dto.validate();
            assert!(
                result.is_err(),
                "Email '{}' should be invalid but validation passed",
                email
            );
        }
    }

    #[test]
    fn test_validate_email_format_in_update_dto() {
        // Test email validation in UpdateUserDto
        let valid_dto = UpdateUserDto {
            email: Some("valid@example.com".to_string()),
            role: None,
            is_active: None,
            email_verified: None,
        };
        assert!(valid_dto.validate().is_ok());

        let invalid_dto = UpdateUserDto {
            email: Some("invalid-email".to_string()),
            role: None,
            is_active: None,
            email_verified: None,
        };
        assert!(invalid_dto.validate().is_err());

        // None email should pass validation (optional field)
        let none_email_dto = UpdateUserDto {
            email: None,
            role: Some(UserRole::Admin),
            is_active: Some(true),
            email_verified: Some(true),
        };
        assert!(none_email_dto.validate().is_ok());
    }

    // =========================================================================
    // Password Requirements Tests
    // =========================================================================

    /// Helper function to validate password strength
    /// Returns Ok(()) if password meets requirements, Err with message otherwise
    fn validate_password_strength(password: &str) -> Result<(), String> {
        // Minimum length check
        if password.len() < 8 {
            return Err("Password must be at least 8 characters long".to_string());
        }

        // Maximum length check (prevent DoS with very long passwords)
        if password.len() > 128 {
            return Err("Password must not exceed 128 characters".to_string());
        }

        // Check for at least one uppercase letter
        if !password.chars().any(|c| c.is_uppercase()) {
            return Err("Password must contain at least one uppercase letter".to_string());
        }

        // Check for at least one lowercase letter
        if !password.chars().any(|c| c.is_lowercase()) {
            return Err("Password must contain at least one lowercase letter".to_string());
        }

        // Check for at least one digit
        if !password.chars().any(|c| c.is_ascii_digit()) {
            return Err("Password must contain at least one digit".to_string());
        }

        // Check for at least one special character
        let special_chars = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
        if !password.chars().any(|c| special_chars.contains(c)) {
            return Err("Password must contain at least one special character".to_string());
        }

        Ok(())
    }

    #[test]
    fn test_password_requirements_valid_passwords() {
        let valid_passwords = vec![
            "Password1!",
            "Str0ng@Pass",
            "MyP@ssw0rd",
            "Complex1ty!",
            "S3cur3#Key",
            "Valid_Pass1",
            "Test123!@#",
            "Abcdefg1!",
        ];

        for password in valid_passwords {
            let result = validate_password_strength(password);
            assert!(
                result.is_ok(),
                "Password '{}' should be valid but failed: {:?}",
                password,
                result.err()
            );
        }
    }

    #[test]
    fn test_password_requirements_too_short() {
        let short_passwords = vec!["Ab1!", "Pass1!", "Abc123!"];

        for password in short_passwords {
            let result = validate_password_strength(password);
            assert!(result.is_err());
            assert!(
                result.unwrap_err().contains("at least 8 characters"),
                "Password '{}' should fail for being too short",
                password
            );
        }
    }

    #[test]
    fn test_password_requirements_too_long() {
        // Password with more than 128 characters
        let long_password = "A".repeat(100) + "a1!" + &"B".repeat(30);
        let result = validate_password_strength(&long_password);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not exceed 128 characters"));
    }

    #[test]
    fn test_password_requirements_missing_uppercase() {
        let passwords = vec!["password1!", "no_upper1@", "alllower123!"];

        for password in passwords {
            let result = validate_password_strength(password);
            assert!(result.is_err());
            assert!(
                result.unwrap_err().contains("uppercase"),
                "Password '{}' should fail for missing uppercase",
                password
            );
        }
    }

    #[test]
    fn test_password_requirements_missing_lowercase() {
        let passwords = vec!["PASSWORD1!", "ALLUPPER123@", "NOLOWER1!"];

        for password in passwords {
            let result = validate_password_strength(password);
            assert!(result.is_err());
            assert!(
                result.unwrap_err().contains("lowercase"),
                "Password '{}' should fail for missing lowercase",
                password
            );
        }
    }

    #[test]
    fn test_password_requirements_missing_digit() {
        let passwords = vec!["Password!", "NoDigits@Here", "AllLetters!@"];

        for password in passwords {
            let result = validate_password_strength(password);
            assert!(result.is_err());
            assert!(
                result.unwrap_err().contains("digit"),
                "Password '{}' should fail for missing digit",
                password
            );
        }
    }

    #[test]
    fn test_password_requirements_missing_special_char() {
        let passwords = vec!["Password1", "NoSpecial123", "AlphaNum1c"];

        for password in passwords {
            let result = validate_password_strength(password);
            assert!(result.is_err());
            assert!(
                result.unwrap_err().contains("special character"),
                "Password '{}' should fail for missing special character",
                password
            );
        }
    }

    #[test]
    fn test_password_requirements_edge_cases() {
        // Exactly 8 characters - valid
        assert!(validate_password_strength("Abcde1!@").is_ok());

        // Exactly 128 characters - valid
        let max_length = "A".repeat(62) + "a" + "1" + "!" + &"x".repeat(63);
        assert_eq!(max_length.len(), 128);
        assert!(validate_password_strength(&max_length).is_ok());

        // Unicode characters (should still need ASCII requirements)
        assert!(validate_password_strength("Passwort1!").is_ok());
    }

    // =========================================================================
    // Enhanced CreateUserDto Validation Tests
    // =========================================================================

    #[test]
    fn test_create_user_dto_validation_comprehensive() {
        // Valid DTO with all optional fields
        let dto = CreateUserDto {
            email: "user@example.com".to_string(),
            password_hash: "argon2_hashed_password".to_string(),
            role: Some(UserRole::Customer),
            oauth_provider: Some("google".to_string()),
            oauth_provider_id: Some("google_id_12345".to_string()),
        };
        assert!(dto.validate().is_ok());

        // Valid DTO with minimal fields
        let dto = CreateUserDto {
            email: "minimal@test.org".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: None,
            oauth_provider_id: None,
        };
        assert!(dto.validate().is_ok());

        // Invalid - empty email
        let dto = CreateUserDto {
            email: "".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: None,
            oauth_provider_id: None,
        };
        assert!(dto.validate().is_err());

        // Invalid - whitespace only email
        let dto = CreateUserDto {
            email: "   ".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: None,
            oauth_provider_id: None,
        };
        assert!(dto.validate().is_err());
    }

    #[test]
    fn test_create_user_dto_with_different_roles() {
        let roles = vec![
            UserRole::Customer,
            UserRole::Admin,
            UserRole::SuperAdmin,
        ];

        for role in roles {
            let dto = CreateUserDto {
                email: "user@example.com".to_string(),
                password_hash: "hash".to_string(),
                role: Some(role.clone()),
                oauth_provider: None,
                oauth_provider_id: None,
            };
            assert!(
                dto.validate().is_ok(),
                "DTO with role {:?} should be valid",
                role
            );
        }
    }

    #[test]
    fn test_create_user_dto_oauth_fields() {
        // OAuth provider without ID (unusual but valid for DTO)
        let dto = CreateUserDto {
            email: "oauth@example.com".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: Some("facebook".to_string()),
            oauth_provider_id: None,
        };
        assert!(dto.validate().is_ok());

        // OAuth ID without provider (unusual but valid for DTO)
        let dto = CreateUserDto {
            email: "oauth@example.com".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: None,
            oauth_provider_id: Some("fb_12345".to_string()),
        };
        assert!(dto.validate().is_ok());

        // Both OAuth fields set
        let dto = CreateUserDto {
            email: "oauth@example.com".to_string(),
            password_hash: "hash".to_string(),
            role: None,
            oauth_provider: Some("apple".to_string()),
            oauth_provider_id: Some("apple_sub_12345".to_string()),
        };
        assert!(dto.validate().is_ok());
    }

    #[test]
    fn test_update_profile_dto_validation_comprehensive() {
        // Valid profile with all fields
        let dto = UpdateProfileDto {
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            phone: Some("+1234567890".to_string()),
            date_of_birth: Some(NaiveDate::from_ymd_opt(1990, 1, 15).unwrap()),
            preferences: Some(serde_json::json!({"theme": "dark", "notifications": true})),
            avatar_url: Some("https://example.com/avatar.jpg".to_string()),
            gender: Some("male".to_string()),
            occupation: Some("Engineer".to_string()),
        };
        assert!(dto.validate().is_ok());

        // Empty first name should fail (min length is 1)
        let dto = UpdateProfileDto {
            first_name: Some("".to_string()),
            ..Default::default()
        };
        assert!(dto.validate().is_err());

        // First name too long (over 100 characters)
        let dto = UpdateProfileDto {
            first_name: Some("A".repeat(101)),
            ..Default::default()
        };
        assert!(dto.validate().is_err());

        // Valid boundary - exactly 100 characters
        let dto = UpdateProfileDto {
            first_name: Some("A".repeat(100)),
            ..Default::default()
        };
        assert!(dto.validate().is_ok());

        // Phone number too long (over 20 characters)
        let dto = UpdateProfileDto {
            phone: Some("1".repeat(21)),
            ..Default::default()
        };
        assert!(dto.validate().is_err());

        // Invalid avatar URL
        let dto = UpdateProfileDto {
            avatar_url: Some("not-a-valid-url".to_string()),
            ..Default::default()
        };
        assert!(dto.validate().is_err());

        // Valid avatar URL
        let dto = UpdateProfileDto {
            avatar_url: Some("https://cdn.example.com/images/avatar.png".to_string()),
            ..Default::default()
        };
        assert!(dto.validate().is_ok());
    }
}
