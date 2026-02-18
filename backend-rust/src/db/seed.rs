//! Database seeding module
//!
//! This module provides functions for seeding the database with essential
//! and sample data. Essential data is seeded in all environments, while
//! sample data is only seeded in development.

use anyhow::{Context, Result};
use serde_json::json;
use sqlx::PgPool;
use tracing::{info, warn};
use uuid::Uuid;

/// Tier data for seeding
struct SeedTier {
    name: &'static str,
    min_points: i32,
    min_nights: i32,
    benefits: serde_json::Value,
    color: &'static str,
    sort_order: i32,
    points_multiplier: f64,
}

/// Sample survey data for seeding
struct SeedSurvey {
    id: Uuid,
    title: &'static str,
    description: &'static str,
    questions: serde_json::Value,
    access_type: &'static str,
    status: &'static str,
}

/// Get default tiers for the loyalty program
///
/// Tiers are based on total_nights stayed, NOT points.
/// - Bronze: 0+ nights (new members)
/// - Silver: 1+ nights
/// - Gold: 10+ nights
/// - Platinum: 20+ nights
fn get_sample_tiers() -> Vec<SeedTier> {
    vec![
        SeedTier {
            name: "Bronze",
            min_points: 0,
            min_nights: 0,
            benefits: json!({
                "description": "ระดับต้อนรับสำหรับสมาชิกใหม่",
                "perks": ["ราคาพิเศษสำหรับสมาชิก", "บริการแต่งห้องวันเกิด", "ได้รับคะแนนเพิ่ม"]
            }),
            color: "#CD7F32",
            sort_order: 1,
            points_multiplier: 1.0,
        },
        SeedTier {
            name: "Silver",
            min_points: 0,
            min_nights: 1,
            benefits: json!({
                "description": "สิทธิพิเศษระดับกลางสำหรับสมาชิกที่ใช้บริการ",
                "perks": ["ส่วนลดเครื่องดื่ม 10%", "ได้รับคะแนนเพิ่ม"]
            }),
            color: "#C0C0C0",
            sort_order: 2,
            points_multiplier: 1.25,
        },
        SeedTier {
            name: "Gold",
            min_points: 0,
            min_nights: 10,
            benefits: json!({
                "description": "สิทธิพิเศษระดับพรีเมียมสำหรับสมาชิกที่มีค่า",
                "perks": ["อัพเกรดห้องฟรี", "ได้รับคะแนนเพิ่ม"]
            }),
            color: "#D4AF37",
            sort_order: 3,
            points_multiplier: 1.5,
        },
        SeedTier {
            name: "Platinum",
            min_points: 0,
            min_nights: 20,
            benefits: json!({
                "description": "สิทธิพิเศษสุดพิเศษสำหรับสมาชิกระดับสูงสุด",
                "perks": ["ส่วนลดพิเศษสำหรับสมาชิกขั้นสูงสุด"]
            }),
            color: "#6B7280",
            sort_order: 4,
            points_multiplier: 2.0,
        },
    ]
}

/// Get sample surveys for development seeding
fn get_sample_surveys() -> Vec<SeedSurvey> {
    vec![
        SeedSurvey {
            id: Uuid::parse_str("b5cbde95-7faf-4268-b3e3-7047a1e4e17b").unwrap(),
            title: "Public Test Survey",
            description: "This is a public survey for testing the surveys page",
            access_type: "public",
            status: "active",
            questions: json!([
                {
                    "id": "q_1",
                    "type": "single_choice",
                    "text": "How satisfied are you with our service?",
                    "required": true,
                    "order": 1,
                    "options": [
                        { "id": "opt_1", "text": "Very Satisfied", "value": 5 },
                        { "id": "opt_2", "text": "Satisfied", "value": 4 },
                        { "id": "opt_3", "text": "Neutral", "value": 3 },
                        { "id": "opt_4", "text": "Dissatisfied", "value": 2 },
                        { "id": "opt_5", "text": "Very Dissatisfied", "value": 1 }
                    ]
                },
                {
                    "id": "q_2",
                    "type": "text",
                    "text": "Please provide any additional feedback",
                    "required": false,
                    "order": 2
                }
            ]),
        },
        SeedSurvey {
            id: Uuid::parse_str("5eb4165b-7e38-439c-9936-db47b454a7e5").unwrap(),
            title: "Customer Satisfaction Survey",
            description: "Tell us about your experience with our hotel services",
            access_type: "public",
            status: "active",
            questions: json!([
                {
                    "id": "q_rating",
                    "type": "rating_5",
                    "text": "How would you rate your overall experience?",
                    "required": true,
                    "order": 1
                },
                {
                    "id": "q_recommend",
                    "type": "yes_no",
                    "text": "Would you recommend us to others?",
                    "required": true,
                    "order": 2
                }
            ]),
        },
        SeedSurvey {
            id: Uuid::parse_str("c5824262-bcba-489e-ab48-5c720ff3dbb4").unwrap(),
            title: "Service Quality Assessment",
            description: "Help us improve our service quality",
            access_type: "public",
            status: "active",
            questions: json!([
                {
                    "id": "q_service_rating",
                    "type": "rating_10",
                    "text": "Rate the quality of our customer service (1-10)",
                    "required": true,
                    "order": 1
                }
            ]),
        },
    ]
}

/// Seed essential data required for the application to function
///
/// This function seeds:
/// - membership_id_sequence (required for user registration)
/// - tiers (required for loyalty system)
///
/// This should be called on every startup in ALL environments.
pub async fn seed_essential_data(db: &PgPool) -> Result<()> {
    info!("Starting essential data seeding...");

    // Seed membership ID sequence
    seed_membership_sequence(db).await?;

    // Seed tiers
    seed_tiers(db).await?;

    info!("Essential data seeding completed");
    Ok(())
}

/// Seed sample data for development/testing
///
/// This function seeds:
/// - Sample surveys for testing
///
/// This should only be called in development environments.
pub async fn seed_sample_data(db: &PgPool) -> Result<()> {
    info!("Starting sample data seeding (development only)...");

    // Seed sample surveys
    seed_surveys(db).await?;

    info!("Sample data seeding completed");
    Ok(())
}

/// Initialize the membership ID sequence
///
/// The membership_id_sequence table is required for generating unique
/// membership IDs during user registration.
async fn seed_membership_sequence(db: &PgPool) -> Result<()> {
    info!("Checking membership_id_sequence...");

    // Check if the table exists
    let table_exists: (bool,) = sqlx::query_as(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'membership_id_sequence'
        )
        "#,
    )
    .fetch_one(db)
    .await
    .context("Failed to check if membership_id_sequence table exists")?;

    if !table_exists.0 {
        warn!("membership_id_sequence table does not exist, skipping seeding");
        return Ok(());
    }

    // Check if sequence is already initialized
    let existing: Option<i32> =
        sqlx::query_scalar!("SELECT id FROM membership_id_sequence WHERE id = 1")
            .fetch_optional(db)
            .await
            .context("Failed to check existing membership_id_sequence")?;

    if existing.is_some() {
        info!("membership_id_sequence already initialized, skipping");
        return Ok(());
    }

    // Initialize the sequence
    sqlx::query!(
        r#"
        INSERT INTO membership_id_sequence (id, current_user_count)
        VALUES (1, 0)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .execute(db)
    .await
    .context("Failed to initialize membership_id_sequence")?;

    info!("Seeded: membership_id_sequence initialized");
    Ok(())
}

/// Seed default tiers for the loyalty program
///
/// Tiers define membership levels based on total nights stayed.
async fn seed_tiers(db: &PgPool) -> Result<()> {
    info!("Checking tiers...");

    // Check if the tiers table exists
    let table_exists: (bool,) = sqlx::query_as(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'tiers'
        )
        "#,
    )
    .fetch_one(db)
    .await
    .context("Failed to check if tiers table exists")?;

    if !table_exists.0 {
        warn!("tiers table does not exist, skipping seeding");
        return Ok(());
    }

    let tiers = get_sample_tiers();

    for tier in &tiers {
        // Check if tier already exists
        let existing: Option<Uuid> =
            sqlx::query_scalar!("SELECT id FROM tiers WHERE name = $1", tier.name)
                .fetch_optional(db)
                .await
                .context("Failed to check existing tier")?;

        if existing.is_some() {
            info!("Tier {} already exists, skipping", tier.name);
            continue;
        }

        // Insert the tier
        sqlx::query!(
            r#"
            INSERT INTO tiers (name, min_points, min_nights, benefits, color, sort_order, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
            "#,
            tier.name,
            tier.min_points,
            tier.min_nights,
            &tier.benefits,
            tier.color,
            tier.sort_order
        )
        .execute(db)
        .await
        .context(format!("Failed to insert tier {}", tier.name))?;

        info!(
            "Seeded: tier {} ({}+ nights, {}x multiplier)",
            tier.name, tier.min_nights, tier.points_multiplier
        );
    }

    Ok(())
}

/// Seed sample surveys for development testing
async fn seed_surveys(db: &PgPool) -> Result<()> {
    info!("Checking surveys...");

    // Check if the surveys table exists
    let table_exists: (bool,) = sqlx::query_as(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'surveys'
        )
        "#,
    )
    .fetch_one(db)
    .await
    .context("Failed to check if surveys table exists")?;

    if !table_exists.0 {
        warn!("surveys table does not exist, skipping seeding");
        return Ok(());
    }

    let surveys = get_sample_surveys();

    for survey in surveys {
        // Check if survey already exists
        let existing: Option<Uuid> =
            sqlx::query_scalar!("SELECT id FROM surveys WHERE id = $1", survey.id)
                .fetch_optional(db)
                .await
                .context("Failed to check existing survey")?;

        if existing.is_some() {
            info!("Survey {} already exists, skipping", survey.id);
            continue;
        }

        // Insert the survey
        sqlx::query!(
            r#"
            INSERT INTO surveys (
                id, title, description, questions, target_segment,
                access_type, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            "#,
            survey.id,
            survey.title,
            survey.description,
            &survey.questions,
            json!({}), // target_segment
            survey.access_type,
            survey.status
        )
        .execute(db)
        .await
        .context(format!("Failed to insert survey {}", survey.id))?;

        info!("Seeded: survey '{}' ({})", survey.title, survey.id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sample_tiers_count() {
        let tiers = get_sample_tiers();
        assert_eq!(tiers.len(), 4);
    }

    #[test]
    fn test_sample_tiers_order() {
        let tiers = get_sample_tiers();
        // Tiers should be in ascending order by min_nights
        let mut prev_nights = -1;
        for tier in &tiers {
            assert!(
                tier.min_nights > prev_nights,
                "Tiers should be in ascending order by min_nights"
            );
            prev_nights = tier.min_nights;
        }
    }

    #[test]
    fn test_sample_tiers_multipliers() {
        let tiers = get_sample_tiers();
        // Bronze should have 1.0x multiplier
        assert_eq!(tiers[0].points_multiplier, 1.0);
        // Silver should have 1.25x multiplier
        assert_eq!(tiers[1].points_multiplier, 1.25);
        // Gold should have 1.5x multiplier
        assert_eq!(tiers[2].points_multiplier, 1.5);
        // Platinum should have 2.0x multiplier
        assert_eq!(tiers[3].points_multiplier, 2.0);
    }

    #[test]
    fn test_tier_names() {
        let tiers = get_sample_tiers();
        assert_eq!(tiers[0].name, "Bronze");
        assert_eq!(tiers[1].name, "Silver");
        assert_eq!(tiers[2].name, "Gold");
        assert_eq!(tiers[3].name, "Platinum");
    }

    #[test]
    fn test_tier_min_nights() {
        let tiers = get_sample_tiers();
        assert_eq!(tiers[0].min_nights, 0);
        assert_eq!(tiers[1].min_nights, 1);
        assert_eq!(tiers[2].min_nights, 10);
        assert_eq!(tiers[3].min_nights, 20);
    }

    #[test]
    fn test_sample_surveys_count() {
        let surveys = get_sample_surveys();
        assert_eq!(surveys.len(), 3);
    }

    #[test]
    fn test_sample_surveys_unique_ids() {
        let surveys = get_sample_surveys();
        let mut ids: Vec<Uuid> = surveys.iter().map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), surveys.len(), "Survey IDs must be unique");
    }
}
