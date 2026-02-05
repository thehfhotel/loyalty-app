//! Tier model and related types
//!
//! This module contains the Tier entity that maps to the `tiers` table
//! in the database. Tiers define loyalty program levels based on
//! nights stayed (NOT points).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// Tier entity representing a record in the `tiers` table
///
/// Defines a loyalty program tier with minimum requirements and benefits.
/// Tiers are determined by total_nights stayed, NOT by current_points.
///
/// Default tiers:
/// - Bronze: 0+ nights (min_points: 0, min_nights: 0)
/// - Silver: 1+ nights (min_points: 0, min_nights: 1)
/// - Gold: 10+ nights (min_points: 0, min_nights: 10)
/// - Platinum: 20+ nights (min_points: 0, min_nights: 20)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tier {
    /// Unique identifier
    pub id: Uuid,

    /// Tier name (unique, e.g., "Bronze", "Silver", "Gold", "Platinum")
    pub name: String,

    /// Minimum points required (legacy, not used for tier calculation)
    pub min_points: i32,

    /// Minimum nights required to achieve this tier
    pub min_nights: i32,

    /// JSON object containing tier benefits
    /// Example: { "discount": 10, "free_breakfast": true, "late_checkout": true }
    pub benefits: Option<JsonValue>,

    /// Hex color code for UI display (e.g., "#CD7F32" for Bronze)
    pub color: String,

    /// Sort order for display (lower = higher priority)
    pub sort_order: i32,

    /// Whether this tier is active
    pub is_active: Option<bool>,

    /// Timestamp when the tier was created
    pub created_at: Option<DateTime<Utc>>,

    /// Timestamp when the tier was last updated
    pub updated_at: Option<DateTime<Utc>>,
}

impl Tier {
    /// Check if this tier is active
    pub fn is_active(&self) -> bool {
        self.is_active.unwrap_or(true)
    }

    /// Get the benefits as a JSON object, defaulting to empty
    pub fn benefits_json(&self) -> JsonValue {
        self.benefits.clone().unwrap_or(serde_json::json!({}))
    }

    /// Check if a user qualifies for this tier based on nights stayed
    pub fn qualifies(&self, nights: i32) -> bool {
        nights >= self.min_nights
    }
}

/// Tier response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierResponse {
    /// Unique identifier
    pub id: Uuid,

    /// Tier name
    pub name: String,

    /// Minimum points required (legacy)
    pub min_points: i32,

    /// Minimum nights required
    pub min_nights: i32,

    /// Tier benefits
    pub benefits: JsonValue,

    /// Display color (hex)
    pub color: String,

    /// Sort order
    pub sort_order: i32,

    /// Whether tier is active
    pub is_active: bool,
}

impl From<Tier> for TierResponse {
    fn from(tier: Tier) -> Self {
        TierResponse {
            id: tier.id,
            name: tier.name,
            min_points: tier.min_points,
            min_nights: tier.min_nights,
            benefits: tier.benefits.unwrap_or(serde_json::json!({})),
            color: tier.color,
            sort_order: tier.sort_order,
            is_active: tier.is_active.unwrap_or(true),
        }
    }
}

/// Request payload for creating a new tier
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreateTierRequest {
    /// Tier name (must be unique)
    #[validate(length(min = 1, max = 50, message = "Name must be 1-50 characters"))]
    pub name: String,

    /// Minimum points (legacy, default 0)
    pub min_points: Option<i32>,

    /// Minimum nights required
    #[validate(range(min = 0, message = "Minimum nights cannot be negative"))]
    pub min_nights: i32,

    /// Tier benefits as JSON
    pub benefits: Option<JsonValue>,

    /// Display color (hex format)
    #[validate(length(equal = 7, message = "Color must be 7 characters (e.g., #FFFFFF)"))]
    pub color: String,

    /// Sort order for display
    pub sort_order: i32,

    /// Whether tier is active (default true)
    pub is_active: Option<bool>,
}

/// Request payload for updating an existing tier
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct UpdateTierRequest {
    /// Updated tier name
    #[validate(length(min = 1, max = 50, message = "Name must be 1-50 characters"))]
    pub name: Option<String>,

    /// Updated minimum points
    pub min_points: Option<i32>,

    /// Updated minimum nights
    #[validate(range(min = 0, message = "Minimum nights cannot be negative"))]
    pub min_nights: Option<i32>,

    /// Updated benefits
    pub benefits: Option<JsonValue>,

    /// Updated color
    #[validate(length(equal = 7, message = "Color must be 7 characters (e.g., #FFFFFF)"))]
    pub color: Option<String>,

    /// Updated sort order
    pub sort_order: Option<i32>,

    /// Updated active status
    pub is_active: Option<bool>,
}

/// Summary of tier for quick reference
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TierSummary {
    /// Tier ID
    pub id: Uuid,

    /// Tier name
    pub name: String,

    /// Display color
    pub color: String,

    /// Sort order
    pub sort_order: i32,
}

/// Tier with user counts (for admin dashboard)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierWithStats {
    /// Tier information
    #[serde(flatten)]
    pub tier: TierResponse,

    /// Number of users in this tier
    pub user_count: i64,

    /// Percentage of total users
    pub percentage: f32,
}

/// All tiers with progression info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierProgression {
    /// All available tiers in order
    pub tiers: Vec<TierResponse>,

    /// User's current tier index (0-based)
    pub current_tier_index: usize,

    /// User's progress to next tier (0.0 - 1.0)
    pub progress_to_next: Option<f32>,

    /// Nights needed for next tier
    pub nights_to_next: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_tier() -> Tier {
        Tier {
            id: Uuid::new_v4(),
            name: "Gold".to_string(),
            min_points: 0,
            min_nights: 10,
            benefits: Some(serde_json::json!({"discount": 15})),
            color: "#FFD700".to_string(),
            sort_order: 2,
            is_active: Some(true),
            created_at: Some(Utc::now()),
            updated_at: Some(Utc::now()),
        }
    }

    #[test]
    fn test_tier_qualifies() {
        let tier = create_test_tier();

        assert!(!tier.qualifies(5));
        assert!(tier.qualifies(10));
        assert!(tier.qualifies(15));
    }

    #[test]
    fn test_tier_is_active_default() {
        let mut tier = create_test_tier();

        assert!(tier.is_active());

        tier.is_active = None;
        assert!(tier.is_active()); // Should default to true

        tier.is_active = Some(false);
        assert!(!tier.is_active());
    }

    #[test]
    fn test_benefits_json_default() {
        let mut tier = create_test_tier();

        assert!(tier.benefits_json().is_object());

        tier.benefits = None;
        assert_eq!(tier.benefits_json(), serde_json::json!({}));
    }

    #[test]
    fn test_tier_response_conversion() {
        let tier = create_test_tier();
        let response: TierResponse = tier.into();

        assert_eq!(response.name, "Gold");
        assert_eq!(response.min_nights, 10);
        assert!(response.is_active);
    }
}
