//! Survey service module
//!
//! Provides survey management functionality including:
//! - Survey CRUD operations
//! - Survey listing with filters
//! - Survey response submission
//! - User survey invitations

use async_trait::async_trait;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::survey::{Survey, SurveyQuestion, SurveyResponse};
use crate::services::AppState;

// ============================================================================
// DTOs (Data Transfer Objects)
// ============================================================================

/// Filters for listing surveys
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SurveyFilters {
    /// Filter by survey status (draft, active, paused, completed, archived)
    pub status: Option<String>,
    /// Filter by access type (public, invite_only)
    pub access_type: Option<String>,
    /// Filter by creator ID
    pub created_by: Option<Uuid>,
    /// Page number (1-indexed)
    pub page: Option<i32>,
    /// Number of items per page
    pub limit: Option<i32>,
}

/// DTO for creating a new survey
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSurveyDto {
    pub title: String,
    pub description: Option<String>,
    pub questions: Vec<SurveyQuestion>,
    pub target_segment: Option<serde_json::Value>,
    pub access_type: Option<String>,
    pub status: Option<String>,
    pub scheduled_start: Option<NaiveDateTime>,
    pub scheduled_end: Option<NaiveDateTime>,
}

/// DTO for submitting a survey response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitResponseDto {
    pub survey_id: Uuid,
    pub user_id: Uuid,
    pub answers: serde_json::Value,
    pub is_completed: Option<bool>,
}

/// Survey with questions parsed from JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyWithQuestions {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub questions: Vec<SurveyQuestion>,
    pub target_segment: Option<serde_json::Value>,
    pub status: Option<String>,
    pub access_type: String,
    pub scheduled_start: Option<NaiveDateTime>,
    pub scheduled_end: Option<NaiveDateTime>,
    pub created_by: Option<Uuid>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

/// Survey invitation with user details
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SurveyInvitationWithUser {
    pub id: Uuid,
    pub survey_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub status: Option<String>,
    pub sent_at: Option<NaiveDateTime>,
    pub viewed_at: Option<NaiveDateTime>,
    pub expires_at: Option<NaiveDateTime>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
    // User details
    pub user_email: Option<String>,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
}

/// Survey response with user details
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SurveyResponseWithUser {
    pub id: Uuid,
    pub survey_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub answers: serde_json::Value,
    pub is_completed: Option<bool>,
    pub progress: Option<i32>,
    pub started_at: Option<NaiveDateTime>,
    pub completed_at: Option<NaiveDateTime>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
    // User details
    pub user_email: Option<String>,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
}

/// Paginated survey list response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyListResponse {
    pub surveys: Vec<Survey>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

/// Paginated survey response list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyResponseListResponse {
    pub responses: Vec<SurveyResponseWithUser>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

// ============================================================================
// Survey Service Trait
// ============================================================================

/// Survey service trait defining survey operations
#[async_trait]
pub trait SurveyService: Send + Sync {
    /// List surveys with optional filters and pagination
    async fn list_surveys(&self, filters: SurveyFilters) -> Result<SurveyListResponse, AppError>;

    /// Get a survey by ID
    async fn get_survey(&self, survey_id: Uuid) -> Result<Option<Survey>, AppError>;

    /// Get a survey with parsed questions
    async fn get_survey_with_questions(
        &self,
        survey_id: Uuid,
    ) -> Result<Option<SurveyWithQuestions>, AppError>;

    /// Create a new survey
    async fn create_survey(
        &self,
        data: CreateSurveyDto,
        created_by: Uuid,
    ) -> Result<Survey, AppError>;

    /// Get survey invitations for a user
    async fn get_user_survey_invitations(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<SurveyInvitationWithUser>, AppError>;

    /// Submit a survey response
    async fn submit_survey_response(
        &self,
        data: SubmitResponseDto,
    ) -> Result<SurveyResponse, AppError>;

    /// Get all responses for a survey
    async fn get_survey_responses(
        &self,
        survey_id: Uuid,
        page: Option<i32>,
        limit: Option<i32>,
    ) -> Result<SurveyResponseListResponse, AppError>;
}

// ============================================================================
// Survey Service Implementation
// ============================================================================

/// Implementation of the SurveyService trait
pub struct SurveyServiceImpl {
    state: AppState,
}

impl SurveyServiceImpl {
    /// Create a new SurveyServiceImpl instance
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    /// Normalize question options to ensure consistent sequential values
    fn normalize_question_options(&self, questions: Vec<SurveyQuestion>) -> Vec<SurveyQuestion> {
        questions
            .into_iter()
            .map(|mut question| {
                if let Some(options) = &mut question.options {
                    *options = options
                        .iter()
                        .enumerate()
                        .map(|(index, option)| {
                            let mut opt = option.clone();
                            opt.value = Some((index + 1).to_string());
                            opt
                        })
                        .collect();
                }
                question
            })
            .collect()
    }
}

#[async_trait]
impl SurveyService for SurveyServiceImpl {
    async fn list_surveys(&self, filters: SurveyFilters) -> Result<SurveyListResponse, AppError> {
        let page = filters.page.unwrap_or(1).max(1);
        let limit = filters.limit.unwrap_or(10).clamp(1, 100);
        let offset = (page - 1) * limit;

        // Build dynamic query based on filters
        let mut conditions: Vec<String> = Vec::new();
        let mut param_count = 0;

        if filters.status.is_some() {
            param_count += 1;
            conditions.push(format!("status = ${}", param_count));
        }
        if filters.access_type.is_some() {
            param_count += 1;
            conditions.push(format!("access_type = ${}", param_count));
        }
        if filters.created_by.is_some() {
            param_count += 1;
            conditions.push(format!("created_by = ${}", param_count));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        // Get total count
        let count_query = format!("SELECT COUNT(*) as count FROM surveys {}", where_clause);

        let total: i64 = match (&filters.status, &filters.access_type, &filters.created_by) {
            (None, None, None) => {
                sqlx::query_scalar(&count_query)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (Some(status), None, None) => {
                sqlx::query_scalar(&count_query)
                    .bind(status)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (None, Some(access_type), None) => {
                sqlx::query_scalar(&count_query)
                    .bind(access_type)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (None, None, Some(created_by)) => {
                sqlx::query_scalar(&count_query)
                    .bind(created_by)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (Some(status), Some(access_type), None) => {
                sqlx::query_scalar(&count_query)
                    .bind(status)
                    .bind(access_type)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (Some(status), None, Some(created_by)) => {
                sqlx::query_scalar(&count_query)
                    .bind(status)
                    .bind(created_by)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (None, Some(access_type), Some(created_by)) => {
                sqlx::query_scalar(&count_query)
                    .bind(access_type)
                    .bind(created_by)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
            (Some(status), Some(access_type), Some(created_by)) => {
                sqlx::query_scalar(&count_query)
                    .bind(status)
                    .bind(access_type)
                    .bind(created_by)
                    .fetch_one(self.state.db.pool())
                    .await?
            }
        };

        // Get surveys with pagination
        let surveys_query = format!(
            r#"
            SELECT id, title, description, questions, target_segment, status,
                   scheduled_start, scheduled_end, created_by, created_at, updated_at,
                   access_type, original_language, available_languages, last_translated, translation_status
            FROM surveys
            {}
            ORDER BY created_at DESC
            LIMIT ${} OFFSET ${}
            "#,
            where_clause,
            param_count + 1,
            param_count + 2
        );

        let surveys: Vec<Survey> =
            match (&filters.status, &filters.access_type, &filters.created_by) {
                (None, None, None) => {
                    sqlx::query_as(&surveys_query)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (Some(status), None, None) => {
                    sqlx::query_as(&surveys_query)
                        .bind(status)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (None, Some(access_type), None) => {
                    sqlx::query_as(&surveys_query)
                        .bind(access_type)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (None, None, Some(created_by)) => {
                    sqlx::query_as(&surveys_query)
                        .bind(created_by)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (Some(status), Some(access_type), None) => {
                    sqlx::query_as(&surveys_query)
                        .bind(status)
                        .bind(access_type)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (Some(status), None, Some(created_by)) => {
                    sqlx::query_as(&surveys_query)
                        .bind(status)
                        .bind(created_by)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (None, Some(access_type), Some(created_by)) => {
                    sqlx::query_as(&surveys_query)
                        .bind(access_type)
                        .bind(created_by)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
                (Some(status), Some(access_type), Some(created_by)) => {
                    sqlx::query_as(&surveys_query)
                        .bind(status)
                        .bind(access_type)
                        .bind(created_by)
                        .bind(limit)
                        .bind(offset)
                        .fetch_all(self.state.db.pool())
                        .await?
                }
            };

        let total_pages = ((total as f64) / (limit as f64)).ceil() as i32;

        Ok(SurveyListResponse {
            surveys,
            total,
            page,
            limit,
            total_pages,
        })
    }

    async fn get_survey(&self, survey_id: Uuid) -> Result<Option<Survey>, AppError> {
        let survey = sqlx::query_as::<_, Survey>(
            r#"
            SELECT id, title, description, questions, target_segment, status,
                   scheduled_start, scheduled_end, created_by, created_at, updated_at,
                   access_type, original_language, available_languages, last_translated, translation_status
            FROM surveys
            WHERE id = $1
            "#,
        )
        .bind(survey_id)
        .fetch_optional(self.state.db.pool())
        .await?;

        Ok(survey)
    }

    async fn get_survey_with_questions(
        &self,
        survey_id: Uuid,
    ) -> Result<Option<SurveyWithQuestions>, AppError> {
        let survey = self.get_survey(survey_id).await?;

        match survey {
            Some(s) => {
                let questions: Vec<SurveyQuestion> =
                    serde_json::from_value(s.questions.clone()).unwrap_or_default();

                Ok(Some(SurveyWithQuestions {
                    id: s.id,
                    title: s.title,
                    description: s.description,
                    questions,
                    target_segment: s.target_segment,
                    status: s.status,
                    access_type: s.access_type,
                    scheduled_start: s.scheduled_start,
                    scheduled_end: s.scheduled_end,
                    created_by: s.created_by,
                    created_at: s.created_at,
                    updated_at: s.updated_at,
                }))
            }
            None => Ok(None),
        }
    }

    async fn create_survey(
        &self,
        data: CreateSurveyDto,
        created_by: Uuid,
    ) -> Result<Survey, AppError> {
        // Normalize question options before saving
        let normalized_questions = self.normalize_question_options(data.questions);

        let questions_json = serde_json::to_value(&normalized_questions)
            .map_err(|e| AppError::Serialization(e.to_string()))?;

        let target_segment_json = data.target_segment.unwrap_or(serde_json::json!({}));
        let access_type = data.access_type.unwrap_or_else(|| "public".to_string());
        let status = data.status.unwrap_or_else(|| "draft".to_string());

        let survey = sqlx::query_as::<_, Survey>(
            r#"
            INSERT INTO surveys (title, description, questions, target_segment, access_type, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, title, description, questions, target_segment, status,
                      scheduled_start, scheduled_end, created_by, created_at, updated_at,
                      access_type, original_language, available_languages, last_translated, translation_status
            "#,
        )
        .bind(&data.title)
        .bind(&data.description)
        .bind(&questions_json)
        .bind(&target_segment_json)
        .bind(&access_type)
        .bind(&status)
        .bind(created_by)
        .fetch_one(self.state.db.pool())
        .await?;

        Ok(survey)
    }

    async fn get_user_survey_invitations(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<SurveyInvitationWithUser>, AppError> {
        let invitations = sqlx::query_as::<_, SurveyInvitationWithUser>(
            r#"
            SELECT
                si.id, si.survey_id, si.user_id, si.status, si.sent_at,
                si.viewed_at, si.expires_at, si.created_at, si.updated_at,
                u.email as user_email,
                up.first_name as user_first_name,
                up.last_name as user_last_name
            FROM survey_invitations si
            JOIN users u ON si.user_id = u.id
            LEFT JOIN user_profiles up ON si.user_id = up.user_id
            WHERE si.user_id = $1
            ORDER BY si.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.state.db.pool())
        .await?;

        Ok(invitations)
    }

    async fn submit_survey_response(
        &self,
        data: SubmitResponseDto,
    ) -> Result<SurveyResponse, AppError> {
        // Get the survey to calculate progress
        let survey = self
            .get_survey_with_questions(data.survey_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Survey".to_string()))?;

        let total_questions = survey.questions.len();

        // Count answered questions from the answers JSON
        let answered_questions = match data.answers.as_object() {
            Some(obj) => obj.len(),
            None => 0,
        };

        let progress = if total_questions > 0 {
            ((answered_questions as f64 / total_questions as f64) * 100.0).round() as i32
        } else {
            0
        };

        let is_completed = data.is_completed.unwrap_or(false);
        let completed_at: Option<NaiveDateTime> = if is_completed {
            Some(chrono::Utc::now().naive_utc())
        } else {
            None
        };

        // Use upsert to handle both insert and update cases
        let response = sqlx::query_as::<_, SurveyResponse>(
            r#"
            INSERT INTO survey_responses (survey_id, user_id, answers, is_completed, progress, completed_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (survey_id, user_id)
            DO UPDATE SET
                answers = EXCLUDED.answers,
                is_completed = EXCLUDED.is_completed,
                progress = EXCLUDED.progress,
                completed_at = CASE
                    WHEN EXCLUDED.is_completed AND NOT survey_responses.is_completed
                    THEN EXCLUDED.completed_at
                    ELSE survey_responses.completed_at
                END,
                updated_at = NOW()
            RETURNING id, survey_id, user_id, answers, is_completed, progress,
                      started_at, completed_at, created_at, updated_at
            "#,
        )
        .bind(data.survey_id)
        .bind(data.user_id)
        .bind(&data.answers)
        .bind(is_completed)
        .bind(progress)
        .bind(completed_at)
        .fetch_one(self.state.db.pool())
        .await?;

        // Award survey completion coupons if newly completed
        if is_completed {
            // Call the stored procedure to award coupons
            let _ = sqlx::query_scalar::<_, i32>(
                "SELECT award_survey_completion_coupons($1)",
            )
            .bind(response.id)
            .fetch_optional(self.state.db.pool())
            .await;
            // Ignore coupon errors - don't fail the survey submission
        }

        Ok(response)
    }

    async fn get_survey_responses(
        &self,
        survey_id: Uuid,
        page: Option<i32>,
        limit: Option<i32>,
    ) -> Result<SurveyResponseListResponse, AppError> {
        let page = page.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(10).clamp(1, 100);
        let offset = (page - 1) * limit;

        // Get total count
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM survey_responses WHERE survey_id = $1",
        )
        .bind(survey_id)
        .fetch_one(self.state.db.pool())
        .await?;

        // Get responses with user details
        let responses = sqlx::query_as::<_, SurveyResponseWithUser>(
            r#"
            SELECT
                sr.id, sr.survey_id, sr.user_id, sr.answers, sr.is_completed,
                sr.progress, sr.started_at, sr.completed_at, sr.created_at, sr.updated_at,
                u.email as user_email,
                up.first_name as user_first_name,
                up.last_name as user_last_name
            FROM survey_responses sr
            JOIN users u ON sr.user_id = u.id
            LEFT JOIN user_profiles up ON sr.user_id = up.user_id
            WHERE sr.survey_id = $1
            ORDER BY sr.created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(survey_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(self.state.db.pool())
        .await?;

        let total_pages = ((total as f64) / (limit as f64)).ceil() as i32;

        Ok(SurveyResponseListResponse {
            responses,
            total,
            page,
            limit,
            total_pages,
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_survey_filters_default() {
        let filters = SurveyFilters::default();
        assert!(filters.status.is_none());
        assert!(filters.access_type.is_none());
        assert!(filters.created_by.is_none());
        assert!(filters.page.is_none());
        assert!(filters.limit.is_none());
    }

    #[test]
    fn test_create_survey_dto() {
        let dto = CreateSurveyDto {
            title: "Test Survey".to_string(),
            description: Some("A test survey".to_string()),
            questions: vec![],
            target_segment: None,
            access_type: Some("public".to_string()),
            status: Some("draft".to_string()),
            scheduled_start: None,
            scheduled_end: None,
        };

        assert_eq!(dto.title, "Test Survey");
        assert_eq!(dto.access_type, Some("public".to_string()));
    }

    #[test]
    fn test_submit_response_dto() {
        let dto = SubmitResponseDto {
            survey_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            answers: serde_json::json!({"q1": "answer1", "q2": 5}),
            is_completed: Some(true),
        };

        assert!(dto.is_completed.unwrap());
        assert!(dto.answers.as_object().is_some());
    }

    #[test]
    fn test_survey_list_response() {
        let response = SurveyListResponse {
            surveys: vec![],
            total: 0,
            page: 1,
            limit: 10,
            total_pages: 0,
        };

        assert_eq!(response.page, 1);
        assert_eq!(response.limit, 10);
        assert_eq!(response.total_pages, 0);
    }
}
