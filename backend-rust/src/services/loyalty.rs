//! Loyalty service module
//!
//! Provides loyalty program functionality including:
//! - User loyalty status management
//! - Points transactions and awarding
//! - Tier management and recalculation
//! - Transaction history

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{FromRow, PgPool};
use tracing::info;
use uuid::Uuid;

use crate::error::AppError;

/// User loyalty status entity from the database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserLoyalty {
    /// User ID (foreign key to users table)
    pub user_id: Uuid,
    /// Current redeemable points balance
    pub current_points: Option<i32>,
    /// Total nights stayed (determines tier membership)
    pub total_nights: Option<i32>,
    /// Current tier ID
    pub tier_id: Option<Uuid>,
    /// When the tier was last updated
    pub tier_updated_at: Option<DateTime<Utc>>,
    /// When points were last updated
    pub points_updated_at: Option<DateTime<Utc>>,
    /// When the record was created
    pub created_at: Option<DateTime<Utc>>,
    /// When the record was last updated
    pub updated_at: Option<DateTime<Utc>>,
}

/// User loyalty status with tier information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLoyaltyWithTier {
    pub user_id: Uuid,
    pub current_points: i32,
    pub total_nights: i32,
    pub tier_name: String,
    pub tier_color: String,
    pub tier_benefits: JsonValue,
    pub tier_level: i32,
    pub progress_percentage: i64,
    pub next_tier_nights: Option<i32>,
    pub next_tier_name: Option<String>,
    pub nights_to_next_tier: Option<i32>,
}

/// Tier entity from the database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tier {
    /// Unique tier ID
    pub id: Uuid,
    /// Tier name (e.g., "Bronze", "Silver", "Gold", "Platinum")
    pub name: String,
    /// Minimum points required (legacy, not used for tier calculation)
    pub min_points: i32,
    /// Minimum nights required for this tier
    pub min_nights: i32,
    /// Tier benefits as JSON
    pub benefits: Option<JsonValue>,
    /// Tier display color (hex code)
    pub color: String,
    /// Sort order for tier ranking
    pub sort_order: i32,
    /// Whether the tier is active
    pub is_active: Option<bool>,
    /// When the tier was created
    pub created_at: Option<DateTime<Utc>>,
    /// When the tier was last updated
    pub updated_at: Option<DateTime<Utc>>,
}

/// Points transaction type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "points_transaction_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum PointsTransactionType {
    EarnedStay,
    EarnedBonus,
    Redeemed,
    Expired,
    AdminAdjustment,
    AdminAward,
    AdminDeduction,
}

impl std::fmt::Display for PointsTransactionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PointsTransactionType::EarnedStay => write!(f, "earned_stay"),
            PointsTransactionType::EarnedBonus => write!(f, "earned_bonus"),
            PointsTransactionType::Redeemed => write!(f, "redeemed"),
            PointsTransactionType::Expired => write!(f, "expired"),
            PointsTransactionType::AdminAdjustment => write!(f, "admin_adjustment"),
            PointsTransactionType::AdminAward => write!(f, "admin_award"),
            PointsTransactionType::AdminDeduction => write!(f, "admin_deduction"),
        }
    }
}

/// Points transaction entity from the database
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PointsTransaction {
    /// Unique transaction ID
    pub id: Uuid,
    /// User ID
    pub user_id: Uuid,
    /// Points amount (positive for earned, negative for deductions)
    pub points: i32,
    /// Transaction type
    #[sqlx(rename = "type")]
    pub transaction_type: PointsTransactionType,
    /// Transaction description
    pub description: Option<String>,
    /// Reference ID for external systems
    pub reference_id: Option<String>,
    /// Admin user ID if this was an admin action
    pub admin_user_id: Option<Uuid>,
    /// Admin reason for the action
    pub admin_reason: Option<String>,
    /// When the points expire
    pub expires_at: Option<DateTime<Utc>>,
    /// When the transaction was created
    pub created_at: Option<DateTime<Utc>>,
    /// Number of nights stayed (for stay transactions)
    pub nights_stayed: Option<i32>,
}

/// Parameters for awarding points
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwardPointsParams {
    /// User ID to award points to
    pub user_id: i32,
    /// Number of points to award
    pub points: i32,
    /// Number of nights to add (optional)
    pub nights: Option<i32>,
    /// Source of the points (e.g., "admin_award", "earned_stay")
    pub source: String,
    /// Description of the award
    pub description: String,
}

/// Parameters for awarding points (UUID version for internal use)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwardPointsParamsUuid {
    /// User ID to award points to
    pub user_id: Uuid,
    /// Number of points to award
    pub points: i32,
    /// Number of nights to add (optional)
    pub nights: Option<i32>,
    /// Source of the points (e.g., "admin_award", "earned_stay")
    pub source: String,
    /// Description of the award
    pub description: String,
    /// Reference ID for external systems
    pub reference_id: Option<String>,
    /// Admin user ID if this was an admin action
    pub admin_user_id: Option<Uuid>,
    /// Admin reason for the action
    pub admin_reason: Option<String>,
}

/// Pagination parameters for transaction queries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionPagination {
    /// Number of items per page
    pub limit: i32,
    /// Number of items to skip
    pub offset: i32,
}

impl Default for TransactionPagination {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
        }
    }
}

/// Result from tier recalculation stored procedure
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TierRecalculationResult {
    pub new_tier_id: Option<Uuid>,
    pub new_tier_name: Option<String>,
    pub tier_changed: Option<bool>,
}

/// Result from award_points stored procedure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwardPointsResult {
    pub transaction_id: Uuid,
    pub new_points_balance: i32,
    pub nights_added: i32,
}

/// Loyalty service trait defining loyalty operations
#[async_trait]
pub trait LoyaltyService: Send + Sync {
    /// Get a user's loyalty status with tier information
    async fn get_user_loyalty(&self, user_id: Uuid) -> Result<UserLoyaltyWithTier, AppError>;

    /// Award points to a user using the database stored procedure
    async fn award_points(&self, params: AwardPointsParamsUuid) -> Result<PointsTransaction, AppError>;

    /// Get a user's transaction history with pagination
    async fn get_transactions(
        &self,
        user_id: Uuid,
        pagination: TransactionPagination,
    ) -> Result<Vec<PointsTransaction>, AppError>;

    /// Get a user's current tier
    async fn get_tier(&self, user_id: Uuid) -> Result<Tier, AppError>;

    /// Recalculate a user's tier based on their total nights
    async fn recalculate_tier(&self, user_id: Uuid) -> Result<Tier, AppError>;

    /// Get all available tiers
    async fn get_all_tiers(&self) -> Result<Vec<Tier>, AppError>;

    /// Initialize loyalty status for a new user
    async fn initialize_user_loyalty(&self, user_id: Uuid) -> Result<UserLoyalty, AppError>;
}

/// Implementation of the LoyaltyService trait
pub struct LoyaltyServiceImpl {
    db: PgPool,
}

impl LoyaltyServiceImpl {
    /// Create a new LoyaltyServiceImpl instance
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

#[async_trait]
impl LoyaltyService for LoyaltyServiceImpl {
    async fn get_user_loyalty(&self, user_id: Uuid) -> Result<UserLoyaltyWithTier, AppError> {
        // First try to get the existing loyalty status with tier info
        let result = sqlx::query_as::<_, UserLoyaltyWithTierRow>(
            r#"
            SELECT
                ul.user_id,
                COALESCE(ul.current_points, 0) as current_points,
                COALESCE(ul.total_nights, 0) as total_nights,
                t.name as tier_name,
                t.color as tier_color,
                COALESCE(t.benefits, '{}') as tier_benefits,
                t.sort_order as tier_level,
                CASE
                    WHEN next_tier.min_nights IS NOT NULL AND next_tier.min_nights > 0
                    THEN LEAST(ROUND((ul.total_nights::numeric / next_tier.min_nights) * 100), 100)
                    ELSE 100
                END as progress_percentage,
                next_tier.min_nights as next_tier_nights,
                next_tier.name as next_tier_name,
                CASE
                    WHEN next_tier.min_nights IS NOT NULL
                    THEN GREATEST(next_tier.min_nights - COALESCE(ul.total_nights, 0), 0)
                    ELSE NULL
                END as nights_to_next_tier
            FROM user_loyalty ul
            JOIN tiers t ON ul.tier_id = t.id
            LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
            WHERE ul.user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.db)
        .await?;

        match result {
            Some(row) => Ok(row.into()),
            None => {
                // Initialize user loyalty if not exists
                self.initialize_user_loyalty(user_id).await?;

                // Retry fetching the loyalty status
                let row = sqlx::query_as::<_, UserLoyaltyWithTierRow>(
                    r#"
                    SELECT
                        ul.user_id,
                        COALESCE(ul.current_points, 0) as current_points,
                        COALESCE(ul.total_nights, 0) as total_nights,
                        t.name as tier_name,
                        t.color as tier_color,
                        COALESCE(t.benefits, '{}') as tier_benefits,
                        t.sort_order as tier_level,
                        CASE
                            WHEN next_tier.min_nights IS NOT NULL AND next_tier.min_nights > 0
                            THEN LEAST(ROUND((ul.total_nights::numeric / next_tier.min_nights) * 100), 100)
                            ELSE 100
                        END as progress_percentage,
                        next_tier.min_nights as next_tier_nights,
                        next_tier.name as next_tier_name,
                        CASE
                            WHEN next_tier.min_nights IS NOT NULL
                            THEN GREATEST(next_tier.min_nights - COALESCE(ul.total_nights, 0), 0)
                            ELSE NULL
                        END as nights_to_next_tier
                    FROM user_loyalty ul
                    JOIN tiers t ON ul.tier_id = t.id
                    LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
                    WHERE ul.user_id = $1
                    "#,
                )
                .bind(user_id)
                .fetch_one(&self.db)
                .await?;

                Ok(row.into())
            }
        }
    }

    async fn award_points(&self, params: AwardPointsParamsUuid) -> Result<PointsTransaction, AppError> {
        let nights = params.nights.unwrap_or(0);

        // Call the award_points stored procedure
        let result: JsonValue = sqlx::query_scalar(
            r#"
            SELECT award_points($1, $2, $3::varchar, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(params.user_id)
        .bind(params.points)
        .bind(&params.source)
        .bind(&params.description)
        .bind(&params.reference_id)
        .bind(params.admin_user_id)
        .bind(&params.admin_reason)
        .bind(nights)
        .fetch_one(&self.db)
        .await?;

        // Parse the JSON result from the stored procedure
        let transaction_id = result
            .get("transaction_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| AppError::Internal("Failed to parse transaction ID from stored procedure".to_string()))?;

        info!(
            user_id = %params.user_id,
            points = params.points,
            transaction_id = %transaction_id,
            "Awarded points to user"
        );

        // Fetch the created transaction
        let transaction = sqlx::query_as::<_, PointsTransaction>(
            r#"
            SELECT id, user_id, points, type, description, reference_id,
                   admin_user_id, admin_reason, expires_at, created_at, nights_stayed
            FROM points_transactions
            WHERE id = $1
            "#,
        )
        .bind(transaction_id)
        .fetch_one(&self.db)
        .await?;

        Ok(transaction)
    }

    async fn get_transactions(
        &self,
        user_id: Uuid,
        pagination: TransactionPagination,
    ) -> Result<Vec<PointsTransaction>, AppError> {
        let transactions = sqlx::query_as::<_, PointsTransaction>(
            r#"
            SELECT id, user_id, points, type, description, reference_id,
                   admin_user_id, admin_reason, expires_at, created_at, nights_stayed
            FROM points_transactions
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(pagination.limit)
        .bind(pagination.offset)
        .fetch_all(&self.db)
        .await?;

        Ok(transactions)
    }

    async fn get_tier(&self, user_id: Uuid) -> Result<Tier, AppError> {
        let tier = sqlx::query_as::<_, Tier>(
            r#"
            SELECT t.id, t.name, t.min_points, t.min_nights, t.benefits,
                   t.color, t.sort_order, t.is_active, t.created_at, t.updated_at
            FROM tiers t
            JOIN user_loyalty ul ON ul.tier_id = t.id
            WHERE ul.user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.db)
        .await?;

        match tier {
            Some(t) => Ok(t),
            None => {
                // User might not have loyalty status yet, return the default (Bronze) tier
                let default_tier = sqlx::query_as::<_, Tier>(
                    r#"
                    SELECT id, name, min_points, min_nights, benefits,
                           color, sort_order, is_active, created_at, updated_at
                    FROM tiers
                    WHERE is_active = true
                    ORDER BY sort_order ASC
                    LIMIT 1
                    "#,
                )
                .fetch_one(&self.db)
                .await?;

                Ok(default_tier)
            }
        }
    }

    async fn recalculate_tier(&self, user_id: Uuid) -> Result<Tier, AppError> {
        // Call the recalculate_user_tier_by_nights stored procedure
        let result = sqlx::query_as::<_, TierRecalculationResult>(
            r#"
            SELECT * FROM recalculate_user_tier_by_nights($1)
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.db)
        .await?;

        match result {
            Some(recalc_result) => {
                if let Some(tier_id) = recalc_result.new_tier_id {
                    let tier = sqlx::query_as::<_, Tier>(
                        r#"
                        SELECT id, name, min_points, min_nights, benefits,
                               color, sort_order, is_active, created_at, updated_at
                        FROM tiers
                        WHERE id = $1
                        "#,
                    )
                    .bind(tier_id)
                    .fetch_one(&self.db)
                    .await?;

                    if recalc_result.tier_changed.unwrap_or(false) {
                        info!(
                            user_id = %user_id,
                            new_tier = %tier.name,
                            "User tier recalculated and changed"
                        );
                    }

                    Ok(tier)
                } else {
                    Err(AppError::NotFound(format!(
                        "User loyalty record not found for user_id: {}",
                        user_id
                    )))
                }
            }
            None => Err(AppError::NotFound(format!(
                "User loyalty record not found for user_id: {}",
                user_id
            ))),
        }
    }

    async fn get_all_tiers(&self) -> Result<Vec<Tier>, AppError> {
        let tiers = sqlx::query_as::<_, Tier>(
            r#"
            SELECT id, name, min_points, min_nights, benefits,
                   color, sort_order, is_active, created_at, updated_at
            FROM tiers
            WHERE is_active = true
            ORDER BY sort_order ASC
            "#,
        )
        .fetch_all(&self.db)
        .await?;

        Ok(tiers)
    }

    async fn initialize_user_loyalty(&self, user_id: Uuid) -> Result<UserLoyalty, AppError> {
        // Get the Bronze tier (lowest tier)
        let bronze_tier: Uuid = sqlx::query_scalar(
            r#"
            SELECT id FROM tiers
            WHERE is_active = true
            ORDER BY sort_order ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.db)
        .await?
        .ok_or_else(|| AppError::Internal("No active tiers found in the system".to_string()))?;

        // Insert user loyalty record with ON CONFLICT to handle race conditions
        let loyalty = sqlx::query_as::<_, UserLoyalty>(
            r#"
            INSERT INTO user_loyalty (user_id, current_points, total_nights, tier_id)
            VALUES ($1, 0, 0, $2)
            ON CONFLICT (user_id) DO UPDATE
            SET updated_at = NOW()
            RETURNING user_id, current_points, total_nights, tier_id,
                      tier_updated_at, points_updated_at, created_at, updated_at
            "#,
        )
        .bind(user_id)
        .bind(bronze_tier)
        .fetch_one(&self.db)
        .await?;

        info!(
            user_id = %user_id,
            "Initialized loyalty status for user"
        );

        Ok(loyalty)
    }
}

/// Internal row type for user loyalty with tier info query
#[derive(Debug, FromRow)]
struct UserLoyaltyWithTierRow {
    user_id: Uuid,
    current_points: i32,
    total_nights: i32,
    tier_name: String,
    tier_color: String,
    tier_benefits: JsonValue,
    tier_level: i32,
    progress_percentage: i64,
    next_tier_nights: Option<i32>,
    next_tier_name: Option<String>,
    nights_to_next_tier: Option<i32>,
}

impl From<UserLoyaltyWithTierRow> for UserLoyaltyWithTier {
    fn from(row: UserLoyaltyWithTierRow) -> Self {
        UserLoyaltyWithTier {
            user_id: row.user_id,
            current_points: row.current_points,
            total_nights: row.total_nights,
            tier_name: row.tier_name,
            tier_color: row.tier_color,
            tier_benefits: row.tier_benefits,
            tier_level: row.tier_level,
            progress_percentage: row.progress_percentage,
            next_tier_nights: row.next_tier_nights,
            next_tier_name: row.next_tier_name,
            nights_to_next_tier: row.nights_to_next_tier,
        }
    }
}

/// Tier names as constants for tier determination
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TierName {
    Bronze,
    Silver,
    Gold,
    Platinum,
}

impl TierName {
    /// Get the display name for the tier
    pub fn as_str(&self) -> &'static str {
        match self {
            TierName::Bronze => "Bronze",
            TierName::Silver => "Silver",
            TierName::Gold => "Gold",
            TierName::Platinum => "Platinum",
        }
    }
}

/// Calculate the points multiplier based on tier
/// Bronze: 1.0x, Silver: 1.25x, Gold: 1.5x, Platinum: 2.0x
pub fn calculate_points_multiplier(tier: TierName) -> f64 {
    match tier {
        TierName::Bronze => 1.0,
        TierName::Silver => 1.25,
        TierName::Gold => 1.5,
        TierName::Platinum => 2.0,
    }
}

/// Determine the tier based on total nights stayed
/// Bronze: 0+ nights, Silver: 1+ nights, Gold: 10+ nights, Platinum: 20+ nights
pub fn determine_tier_by_nights(total_nights: i32) -> TierName {
    match total_nights {
        n if n >= 20 => TierName::Platinum,
        n if n >= 10 => TierName::Gold,
        n if n >= 1 => TierName::Silver,
        _ => TierName::Bronze,
    }
}

/// Validation error types for AwardPointsParams
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AwardPointsValidationError {
    InvalidPoints(String),
    InvalidNights(String),
    InvalidSource(String),
    InvalidDescription(String),
}

impl AwardPointsParams {
    /// Validate the award points parameters
    /// Returns Ok(()) if valid, Err with validation errors otherwise
    pub fn validate(&self) -> Result<(), Vec<AwardPointsValidationError>> {
        let mut errors = Vec::new();

        // Points validation: must be non-zero
        if self.points == 0 {
            errors.push(AwardPointsValidationError::InvalidPoints(
                "Points cannot be zero".to_string(),
            ));
        }

        // Nights validation: if provided, must be non-negative
        if let Some(nights) = self.nights {
            if nights < 0 {
                errors.push(AwardPointsValidationError::InvalidNights(
                    "Nights cannot be negative".to_string(),
                ));
            }
        }

        // Source validation: must not be empty
        if self.source.trim().is_empty() {
            errors.push(AwardPointsValidationError::InvalidSource(
                "Source cannot be empty".to_string(),
            ));
        }

        // Description validation: must not be empty
        if self.description.trim().is_empty() {
            errors.push(AwardPointsValidationError::InvalidDescription(
                "Description cannot be empty".to_string(),
            ));
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pagination_default() {
        let pagination = TransactionPagination::default();
        assert_eq!(pagination.limit, 50);
        assert_eq!(pagination.offset, 0);
    }

    #[test]
    fn test_award_points_params() {
        let params = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: Some(2),
            source: "admin_award".to_string(),
            description: "Test award".to_string(),
        };

        assert_eq!(params.user_id, 1);
        assert_eq!(params.points, 100);
        assert_eq!(params.nights, Some(2));
    }

    #[test]
    fn test_points_transaction_type_display() {
        assert_eq!(
            PointsTransactionType::EarnedStay.to_string(),
            "earned_stay"
        );
        assert_eq!(
            PointsTransactionType::AdminAward.to_string(),
            "admin_award"
        );
        assert_eq!(
            PointsTransactionType::AdminDeduction.to_string(),
            "admin_deduction"
        );
    }

    #[test]
    fn test_tier_serialization() {
        let tier = Tier {
            id: Uuid::new_v4(),
            name: "Gold".to_string(),
            min_points: 1000,
            min_nights: 10,
            benefits: Some(serde_json::json!({"perks": ["Free breakfast"]})),
            color: "#FFD700".to_string(),
            sort_order: 3,
            is_active: Some(true),
            created_at: None,
            updated_at: None,
        };

        let json = serde_json::to_string(&tier).unwrap();
        assert!(json.contains("Gold"));
        assert!(json.contains("#FFD700"));
    }

    #[test]
    fn test_tier_order() {
        // Tier thresholds as defined in CLAUDE.md
        // Bronze: 0+, Silver: 1+, Gold: 10+, Platinum: 20+ nights
        let bronze_min = 0;
        let silver_min = 1;
        let gold_min = 10;
        let platinum_min = 20;

        assert!(bronze_min < silver_min);
        assert!(silver_min < gold_min);
        assert!(gold_min < platinum_min);
    }

    #[test]
    fn test_calculate_points_multiplier() {
        // Test tier-based points multiplier calculation
        // Bronze members get 1.0x multiplier (base rate)
        assert_eq!(calculate_points_multiplier(TierName::Bronze), 1.0);

        // Silver members get 1.25x multiplier (25% bonus)
        assert_eq!(calculate_points_multiplier(TierName::Silver), 1.25);

        // Gold members get 1.5x multiplier (50% bonus)
        assert_eq!(calculate_points_multiplier(TierName::Gold), 1.5);

        // Platinum members get 2.0x multiplier (100% bonus)
        assert_eq!(calculate_points_multiplier(TierName::Platinum), 2.0);

        // Test that higher tiers always have higher or equal multipliers
        assert!(calculate_points_multiplier(TierName::Silver) > calculate_points_multiplier(TierName::Bronze));
        assert!(calculate_points_multiplier(TierName::Gold) > calculate_points_multiplier(TierName::Silver));
        assert!(calculate_points_multiplier(TierName::Platinum) > calculate_points_multiplier(TierName::Gold));
    }

    #[test]
    fn test_tier_determination() {
        // Test determining tier based on nights
        // As per CLAUDE.md: Bronze: 0+, Silver: 1+, Gold: 10+, Platinum: 20+ nights

        // Bronze tier (0 nights)
        assert_eq!(determine_tier_by_nights(0), TierName::Bronze);
        assert_eq!(determine_tier_by_nights(0).as_str(), "Bronze");

        // Silver tier (1-9 nights)
        assert_eq!(determine_tier_by_nights(1), TierName::Silver);
        assert_eq!(determine_tier_by_nights(5), TierName::Silver);
        assert_eq!(determine_tier_by_nights(9), TierName::Silver);
        assert_eq!(determine_tier_by_nights(1).as_str(), "Silver");

        // Gold tier (10-19 nights)
        assert_eq!(determine_tier_by_nights(10), TierName::Gold);
        assert_eq!(determine_tier_by_nights(15), TierName::Gold);
        assert_eq!(determine_tier_by_nights(19), TierName::Gold);
        assert_eq!(determine_tier_by_nights(10).as_str(), "Gold");

        // Platinum tier (20+ nights)
        assert_eq!(determine_tier_by_nights(20), TierName::Platinum);
        assert_eq!(determine_tier_by_nights(50), TierName::Platinum);
        assert_eq!(determine_tier_by_nights(100), TierName::Platinum);
        assert_eq!(determine_tier_by_nights(20).as_str(), "Platinum");

        // Test boundary conditions precisely
        assert_eq!(determine_tier_by_nights(0), TierName::Bronze);
        assert_eq!(determine_tier_by_nights(1), TierName::Silver);  // Just crossed from Bronze
        assert_eq!(determine_tier_by_nights(9), TierName::Silver);  // Just below Gold
        assert_eq!(determine_tier_by_nights(10), TierName::Gold);   // Just crossed to Gold
        assert_eq!(determine_tier_by_nights(19), TierName::Gold);   // Just below Platinum
        assert_eq!(determine_tier_by_nights(20), TierName::Platinum); // Just crossed to Platinum

        // Test negative nights (edge case - should default to Bronze)
        assert_eq!(determine_tier_by_nights(-1), TierName::Bronze);
        assert_eq!(determine_tier_by_nights(-100), TierName::Bronze);
    }

    #[test]
    fn test_award_points_dto_validation() {
        // Test valid DTO
        let valid_params = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: Some(2),
            source: "earned_stay".to_string(),
            description: "Hotel stay reward".to_string(),
        };
        assert!(valid_params.validate().is_ok());

        // Test valid negative points (for deductions)
        let deduction_params = AwardPointsParams {
            user_id: 1,
            points: -50,
            nights: None,
            source: "admin_deduction".to_string(),
            description: "Points correction".to_string(),
        };
        assert!(deduction_params.validate().is_ok());

        // Test zero points (invalid)
        let zero_points = AwardPointsParams {
            user_id: 1,
            points: 0,
            nights: Some(1),
            source: "admin_award".to_string(),
            description: "Test".to_string(),
        };
        let result = zero_points.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.contains(&AwardPointsValidationError::InvalidPoints(
            "Points cannot be zero".to_string()
        )));

        // Test negative nights (invalid)
        let negative_nights = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: Some(-1),
            source: "admin_award".to_string(),
            description: "Test".to_string(),
        };
        let result = negative_nights.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.contains(&AwardPointsValidationError::InvalidNights(
            "Nights cannot be negative".to_string()
        )));

        // Test empty source (invalid)
        let empty_source = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: None,
            source: "".to_string(),
            description: "Test".to_string(),
        };
        let result = empty_source.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.contains(&AwardPointsValidationError::InvalidSource(
            "Source cannot be empty".to_string()
        )));

        // Test whitespace-only source (invalid)
        let whitespace_source = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: None,
            source: "   ".to_string(),
            description: "Test".to_string(),
        };
        let result = whitespace_source.validate();
        assert!(result.is_err());

        // Test empty description (invalid)
        let empty_description = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: None,
            source: "admin_award".to_string(),
            description: "".to_string(),
        };
        let result = empty_description.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.contains(&AwardPointsValidationError::InvalidDescription(
            "Description cannot be empty".to_string()
        )));

        // Test multiple validation errors at once
        let multiple_errors = AwardPointsParams {
            user_id: 1,
            points: 0,
            nights: Some(-5),
            source: "".to_string(),
            description: "".to_string(),
        };
        let result = multiple_errors.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert_eq!(errors.len(), 4); // All four validations should fail

        // Test None nights is valid
        let no_nights = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: None,
            source: "admin_award".to_string(),
            description: "Bonus points".to_string(),
        };
        assert!(no_nights.validate().is_ok());

        // Test zero nights is valid (not staying but earning points)
        let zero_nights = AwardPointsParams {
            user_id: 1,
            points: 100,
            nights: Some(0),
            source: "earned_bonus".to_string(),
            description: "Promotional bonus".to_string(),
        };
        assert!(zero_nights.validate().is_ok());
    }
}
