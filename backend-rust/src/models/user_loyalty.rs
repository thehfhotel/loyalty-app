//! User Loyalty model and related types
//!
//! This module contains the UserLoyalty entity that maps to the `user_loyalty`
//! table in the database. It tracks loyalty program data including points,
//! nights stayed, and tier membership.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// User loyalty entity representing a record in the `user_loyalty` table
///
/// Tracks a user's loyalty program status including current points,
/// total nights stayed, and current tier assignment.
/// Has a one-to-one relationship with the User entity (user_id is PK).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserLoyalty {
    /// Foreign key to users table (also serves as primary key)
    pub user_id: Uuid,

    /// Current available points balance
    pub current_points: Option<i32>,

    /// Total nights stayed (used for tier calculation)
    pub total_nights: Option<i32>,

    /// Current tier ID (foreign key to tiers table)
    pub tier_id: Option<Uuid>,

    /// Timestamp when the tier was last updated
    pub tier_updated_at: Option<DateTime<Utc>>,

    /// Timestamp when points were last updated
    pub points_updated_at: Option<DateTime<Utc>>,

    /// Timestamp when the loyalty record was created
    pub created_at: Option<DateTime<Utc>>,

    /// Timestamp when the loyalty record was last updated
    pub updated_at: Option<DateTime<Utc>>,
}

impl UserLoyalty {
    /// Get the current points, defaulting to 0 if None
    pub fn points(&self) -> i32 {
        self.current_points.unwrap_or(0)
    }

    /// Get the total nights, defaulting to 0 if None
    pub fn nights(&self) -> i32 {
        self.total_nights.unwrap_or(0)
    }

    /// Check if the user has enough points for a redemption
    pub fn has_enough_points(&self, required: i32) -> bool {
        self.points() >= required
    }

    /// Check if the user has a tier assigned
    pub fn has_tier(&self) -> bool {
        self.tier_id.is_some()
    }
}

/// User loyalty response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLoyaltyResponse {
    /// User ID
    pub user_id: Uuid,

    /// Current points balance
    pub current_points: i32,

    /// Total nights stayed
    pub total_nights: i32,

    /// Current tier ID
    pub tier_id: Option<Uuid>,

    /// Tier last updated timestamp
    pub tier_updated_at: Option<DateTime<Utc>>,

    /// Points last updated timestamp
    pub points_updated_at: Option<DateTime<Utc>>,

    /// Record creation timestamp
    pub created_at: DateTime<Utc>,

    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
}

impl From<UserLoyalty> for UserLoyaltyResponse {
    fn from(loyalty: UserLoyalty) -> Self {
        UserLoyaltyResponse {
            user_id: loyalty.user_id,
            current_points: loyalty.current_points.unwrap_or(0),
            total_nights: loyalty.total_nights.unwrap_or(0),
            tier_id: loyalty.tier_id,
            tier_updated_at: loyalty.tier_updated_at,
            points_updated_at: loyalty.points_updated_at,
            created_at: loyalty.created_at.unwrap_or_else(Utc::now),
            updated_at: loyalty.updated_at.unwrap_or_else(Utc::now),
        }
    }
}

/// User loyalty with tier information (for joined queries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLoyaltyWithTier {
    /// User ID
    pub user_id: Uuid,

    /// Current points balance
    pub current_points: i32,

    /// Total nights stayed
    pub total_nights: i32,

    /// Tier information
    pub tier: Option<super::tier::TierResponse>,

    /// Tier last updated timestamp
    pub tier_updated_at: Option<DateTime<Utc>>,

    /// Points last updated timestamp
    pub points_updated_at: Option<DateTime<Utc>>,

    /// Points needed for next tier (if applicable)
    pub points_to_next_tier: Option<i32>,

    /// Nights needed for next tier (if applicable)
    pub nights_to_next_tier: Option<i32>,
}

/// Loyalty summary for dashboard displays
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltySummary {
    /// Current points balance
    pub current_points: i32,

    /// Total nights stayed
    pub total_nights: i32,

    /// Current tier name
    pub tier_name: String,

    /// Current tier color (hex)
    pub tier_color: String,

    /// Progress percentage to next tier (0-100)
    pub progress_to_next_tier: Option<f32>,
}

/// Request to manually adjust loyalty points (admin only)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustPointsRequest {
    /// Amount of points to add (positive) or remove (negative)
    pub points: i32,

    /// Reason for the adjustment
    pub reason: String,
}

/// Request to manually adjust nights (admin only)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustNightsRequest {
    /// Number of nights to add (positive) or remove (negative)
    pub nights: i32,

    /// Reason for the adjustment
    pub reason: String,
}

/// Row type for joined loyalty + tier queries
#[derive(Debug, Clone, FromRow)]
pub struct UserLoyaltyWithTierRow {
    /// User ID
    pub user_id: Uuid,

    /// Current points
    pub current_points: Option<i32>,

    /// Total nights
    pub total_nights: Option<i32>,

    /// Tier ID
    pub tier_id: Option<Uuid>,

    /// Tier updated at
    pub tier_updated_at: Option<DateTime<Utc>>,

    /// Points updated at
    pub points_updated_at: Option<DateTime<Utc>>,

    /// Loyalty created at
    pub created_at: Option<DateTime<Utc>>,

    /// Loyalty updated at
    pub updated_at: Option<DateTime<Utc>>,

    // Tier fields (from join)
    /// Tier name
    pub tier_name: Option<String>,

    /// Tier minimum points
    pub tier_min_points: Option<i32>,

    /// Tier minimum nights
    pub tier_min_nights: Option<i32>,

    /// Tier color
    pub tier_color: Option<String>,

    /// Tier sort order
    pub tier_sort_order: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_points_and_nights_defaults() {
        let loyalty = UserLoyalty {
            user_id: Uuid::new_v4(),
            current_points: None,
            total_nights: None,
            tier_id: None,
            tier_updated_at: None,
            points_updated_at: None,
            created_at: None,
            updated_at: None,
        };

        assert_eq!(loyalty.points(), 0);
        assert_eq!(loyalty.nights(), 0);
    }

    #[test]
    fn test_has_enough_points() {
        let loyalty = UserLoyalty {
            user_id: Uuid::new_v4(),
            current_points: Some(500),
            total_nights: Some(5),
            tier_id: None,
            tier_updated_at: None,
            points_updated_at: None,
            created_at: None,
            updated_at: None,
        };

        assert!(loyalty.has_enough_points(500));
        assert!(loyalty.has_enough_points(250));
        assert!(!loyalty.has_enough_points(501));
    }

    #[test]
    fn test_has_tier() {
        let mut loyalty = UserLoyalty {
            user_id: Uuid::new_v4(),
            current_points: Some(100),
            total_nights: Some(1),
            tier_id: None,
            tier_updated_at: None,
            points_updated_at: None,
            created_at: None,
            updated_at: None,
        };

        assert!(!loyalty.has_tier());

        loyalty.tier_id = Some(Uuid::new_v4());
        assert!(loyalty.has_tier());
    }
}
