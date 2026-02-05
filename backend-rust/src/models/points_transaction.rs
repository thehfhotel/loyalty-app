//! Points Transaction model and related types
//!
//! This module contains the PointsTransaction entity that maps to the
//! `points_transactions` table in the database. It tracks all points
//! movements (earned, redeemed, expired, admin adjustments).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

/// Points transaction type enumeration matching the PostgreSQL enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "points_transaction_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum PointsTransactionType {
    /// Points earned from a hotel stay
    EarnedStay,

    /// Bonus points from promotions
    EarnedBonus,

    /// Points redeemed for rewards
    Redeemed,

    /// Points that have expired
    Expired,

    /// Administrative adjustment (generic)
    AdminAdjustment,

    /// Points awarded by admin
    AdminAward,

    /// Points deducted by admin
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

impl PointsTransactionType {
    /// Check if this transaction type adds points (positive impact)
    pub fn is_credit(&self) -> bool {
        matches!(
            self,
            PointsTransactionType::EarnedStay
                | PointsTransactionType::EarnedBonus
                | PointsTransactionType::AdminAward
        )
    }

    /// Check if this transaction type removes points (negative impact)
    pub fn is_debit(&self) -> bool {
        matches!(
            self,
            PointsTransactionType::Redeemed
                | PointsTransactionType::Expired
                | PointsTransactionType::AdminDeduction
        )
    }

    /// Check if this is an admin-initiated transaction
    pub fn is_admin_action(&self) -> bool {
        matches!(
            self,
            PointsTransactionType::AdminAdjustment
                | PointsTransactionType::AdminAward
                | PointsTransactionType::AdminDeduction
        )
    }
}

/// Points transaction entity representing a record in the `points_transactions` table
///
/// Stores a single points movement event. All points changes should be
/// recorded as transactions to maintain an audit trail.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PointsTransaction {
    /// Unique identifier
    pub id: Uuid,

    /// User ID who owns these points
    pub user_id: Uuid,

    /// Points amount (positive or negative based on type)
    pub points: i32,

    /// Transaction type
    pub r#type: PointsTransactionType,

    /// Human-readable description
    pub description: Option<String>,

    /// External reference (booking ID, order ID, etc.)
    pub reference_id: Option<String>,

    /// Admin user ID (if admin action)
    pub admin_user_id: Option<Uuid>,

    /// Admin's reason for the action
    pub admin_reason: Option<String>,

    /// When these points expire (if applicable)
    pub expires_at: Option<DateTime<Utc>>,

    /// Transaction timestamp
    pub created_at: Option<DateTime<Utc>>,

    /// Nights stayed (for earned_stay transactions)
    pub nights_stayed: Option<i32>,
}

impl PointsTransaction {
    /// Check if this transaction has expired
    pub fn is_expired(&self) -> bool {
        self.expires_at.map(|exp| exp < Utc::now()).unwrap_or(false)
    }

    /// Get the nights stayed, defaulting to 0
    pub fn nights(&self) -> i32 {
        self.nights_stayed.unwrap_or(0)
    }

    /// Check if this is an admin-initiated transaction
    pub fn is_admin_action(&self) -> bool {
        self.admin_user_id.is_some() || self.r#type.is_admin_action()
    }
}

/// Request payload for creating a points transaction (admin)
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct CreatePointsTransactionRequest {
    /// User ID to credit/debit
    pub user_id: Uuid,

    /// Points amount (positive for credit, use appropriate type for debit)
    #[validate(range(min = 1, message = "Points must be at least 1"))]
    pub points: i32,

    /// Transaction type
    pub transaction_type: PointsTransactionType,

    /// Description of the transaction
    #[validate(length(max = 500, message = "Description too long"))]
    pub description: Option<String>,

    /// External reference ID
    pub reference_id: Option<String>,

    /// Reason for admin action
    #[validate(length(max = 500, message = "Reason too long"))]
    pub admin_reason: Option<String>,

    /// Expiration date for these points
    pub expires_at: Option<DateTime<Utc>>,

    /// Nights stayed (for earned_stay)
    pub nights_stayed: Option<i32>,
}

/// Request for awarding points from a stay
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct AwardStayPointsRequest {
    /// User ID to credit
    pub user_id: Uuid,

    /// Points to award
    #[validate(range(min = 1, message = "Points must be at least 1"))]
    pub points: i32,

    /// Number of nights stayed
    #[validate(range(min = 1, message = "Nights must be at least 1"))]
    pub nights_stayed: i32,

    /// Booking reference
    pub booking_reference: String,

    /// Description
    pub description: Option<String>,
}

/// Request for redeeming points
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct RedeemPointsRequest {
    /// Points to redeem
    #[validate(range(min = 1, message = "Points must be at least 1"))]
    pub points: i32,

    /// Redemption reference
    pub reference_id: String,

    /// Description of what was redeemed
    pub description: Option<String>,
}

/// Points transaction response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointsTransactionResponse {
    /// Transaction ID
    pub id: Uuid,

    /// User ID
    pub user_id: Uuid,

    /// Points amount
    pub points: i32,

    /// Transaction type
    pub transaction_type: PointsTransactionType,

    /// Description
    pub description: Option<String>,

    /// Reference ID
    pub reference_id: Option<String>,

    /// Admin user ID (if applicable)
    pub admin_user_id: Option<Uuid>,

    /// Admin reason (if applicable)
    pub admin_reason: Option<String>,

    /// Expiration date
    pub expires_at: Option<DateTime<Utc>>,

    /// Transaction timestamp
    pub created_at: DateTime<Utc>,

    /// Nights stayed
    pub nights_stayed: i32,

    /// Whether transaction is expired
    pub is_expired: bool,
}

impl From<PointsTransaction> for PointsTransactionResponse {
    fn from(tx: PointsTransaction) -> Self {
        let is_expired = tx.is_expired();
        PointsTransactionResponse {
            id: tx.id,
            user_id: tx.user_id,
            points: tx.points,
            transaction_type: tx.r#type,
            description: tx.description,
            reference_id: tx.reference_id,
            admin_user_id: tx.admin_user_id,
            admin_reason: tx.admin_reason,
            expires_at: tx.expires_at,
            created_at: tx.created_at.unwrap_or_else(Utc::now),
            nights_stayed: tx.nights_stayed.unwrap_or(0),
            is_expired,
        }
    }
}

/// Summary of points transactions for a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointsTransactionSummary {
    /// Total points earned all time
    pub total_earned: i64,

    /// Total points redeemed all time
    pub total_redeemed: i64,

    /// Total points expired all time
    pub total_expired: i64,

    /// Current balance
    pub current_balance: i64,

    /// Transaction count
    pub transaction_count: i64,

    /// Most recent transaction date
    pub last_transaction_at: Option<DateTime<Utc>>,
}

/// Filter options for querying transactions
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TransactionFilter {
    /// Filter by transaction type
    pub transaction_type: Option<PointsTransactionType>,

    /// Filter by date range start
    pub from_date: Option<DateTime<Utc>>,

    /// Filter by date range end
    pub to_date: Option<DateTime<Utc>>,

    /// Include expired transactions
    pub include_expired: Option<bool>,

    /// Page number (1-based)
    pub page: Option<i32>,

    /// Page size
    pub page_size: Option<i32>,
}

/// Paginated transaction list response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedTransactions {
    /// Transaction list
    pub transactions: Vec<PointsTransactionResponse>,

    /// Total count
    pub total: i64,

    /// Current page
    pub page: i32,

    /// Page size
    pub page_size: i32,

    /// Total pages
    pub total_pages: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transaction_type_credit_debit() {
        assert!(PointsTransactionType::EarnedStay.is_credit());
        assert!(PointsTransactionType::EarnedBonus.is_credit());
        assert!(PointsTransactionType::AdminAward.is_credit());

        assert!(PointsTransactionType::Redeemed.is_debit());
        assert!(PointsTransactionType::Expired.is_debit());
        assert!(PointsTransactionType::AdminDeduction.is_debit());

        // AdminAdjustment can be either
        assert!(!PointsTransactionType::AdminAdjustment.is_credit());
        assert!(!PointsTransactionType::AdminAdjustment.is_debit());
    }

    #[test]
    fn test_transaction_type_admin_action() {
        assert!(PointsTransactionType::AdminAward.is_admin_action());
        assert!(PointsTransactionType::AdminDeduction.is_admin_action());
        assert!(PointsTransactionType::AdminAdjustment.is_admin_action());

        assert!(!PointsTransactionType::EarnedStay.is_admin_action());
        assert!(!PointsTransactionType::Redeemed.is_admin_action());
    }

    #[test]
    fn test_transaction_is_expired() {
        let mut tx = PointsTransaction {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            points: 100,
            r#type: PointsTransactionType::EarnedStay,
            description: None,
            reference_id: None,
            admin_user_id: None,
            admin_reason: None,
            expires_at: None,
            created_at: Some(Utc::now()),
            nights_stayed: Some(1),
        };

        assert!(!tx.is_expired()); // No expiration

        tx.expires_at = Some(Utc::now() + chrono::Duration::days(1));
        assert!(!tx.is_expired()); // Future expiration

        tx.expires_at = Some(Utc::now() - chrono::Duration::days(1));
        assert!(tx.is_expired()); // Past expiration
    }

    #[test]
    fn test_transaction_nights_default() {
        let tx = PointsTransaction {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            points: 100,
            r#type: PointsTransactionType::EarnedBonus,
            description: None,
            reference_id: None,
            admin_user_id: None,
            admin_reason: None,
            expires_at: None,
            created_at: None,
            nights_stayed: None,
        };

        assert_eq!(tx.nights(), 0);
    }
}
