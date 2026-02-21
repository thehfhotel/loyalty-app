//! Survey models
//!
//! Contains structs for surveys, survey questions, and survey responses.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Survey database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Survey {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub questions: serde_json::Value,
    pub target_segment: Option<serde_json::Value>,
    pub status: Option<String>,
    pub scheduled_start: Option<NaiveDateTime>,
    pub scheduled_end: Option<NaiveDateTime>,
    pub created_by: Option<Uuid>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
    pub access_type: String,
    pub original_language: Option<String>,
    pub available_languages: Option<serde_json::Value>,
    pub last_translated: Option<DateTime<Utc>>,
    pub translation_status: Option<String>,
}

/// Survey question structure (stored as JSON in database)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyQuestion {
    pub id: String,
    pub question_type: SurveyQuestionType,
    pub text: String,
    pub description: Option<String>,
    pub required: bool,
    pub options: Option<Vec<SurveyQuestionOption>>,
    pub validation: Option<SurveyQuestionValidation>,
    pub order: i32,
}

/// Survey question type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SurveyQuestionType {
    SingleChoice,
    MultipleChoice,
    Text,
    TextArea,
    Rating,
    Scale,
    Date,
    Number,
    Email,
    Phone,
}

/// Survey question option (for choice-based questions)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyQuestionOption {
    pub id: String,
    pub text: String,
    pub value: Option<String>,
    pub order: Option<i32>,
}

/// Survey question validation rules
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveyQuestionValidation {
    pub min_length: Option<i32>,
    pub max_length: Option<i32>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub pattern: Option<String>,
    pub custom_error: Option<String>,
}

/// Survey response database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SurveyResponse {
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
}

/// Survey invitation database entity
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SurveyInvitation {
    pub id: Uuid,
    pub survey_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub status: Option<String>,
    pub sent_at: Option<NaiveDateTime>,
    pub viewed_at: Option<NaiveDateTime>,
    pub expires_at: Option<NaiveDateTime>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

/// Create survey request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSurveyRequest {
    pub title: String,
    pub description: Option<String>,
    pub questions: Vec<SurveyQuestion>,
    pub target_segment: Option<serde_json::Value>,
    pub status: Option<String>,
    pub scheduled_start: Option<NaiveDateTime>,
    pub scheduled_end: Option<NaiveDateTime>,
    pub access_type: Option<String>,
}

/// Update survey request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSurveyRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub questions: Option<Vec<SurveyQuestion>>,
    pub target_segment: Option<serde_json::Value>,
    pub status: Option<String>,
    pub scheduled_start: Option<NaiveDateTime>,
    pub scheduled_end: Option<NaiveDateTime>,
    pub access_type: Option<String>,
}

/// Survey response DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyResponseDto {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub questions: Vec<SurveyQuestion>,
    pub status: Option<String>,
    pub scheduled_start: Option<NaiveDateTime>,
    pub scheduled_end: Option<NaiveDateTime>,
    pub access_type: String,
    pub created_at: Option<NaiveDateTime>,
}

/// Submit survey response request DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitSurveyResponseRequest {
    pub survey_id: Uuid,
    pub answers: serde_json::Value,
    pub is_completed: bool,
}

/// Survey response answer DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyAnswerDto {
    pub id: Uuid,
    pub survey_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub answers: serde_json::Value,
    pub is_completed: Option<bool>,
    pub progress: Option<i32>,
    pub started_at: Option<NaiveDateTime>,
    pub completed_at: Option<NaiveDateTime>,
}

impl From<Survey> for SurveyResponseDto {
    fn from(survey: Survey) -> Self {
        let questions: Vec<SurveyQuestion> =
            serde_json::from_value(survey.questions.clone()).unwrap_or_default();

        Self {
            id: survey.id,
            title: survey.title,
            description: survey.description,
            questions,
            status: survey.status,
            scheduled_start: survey.scheduled_start,
            scheduled_end: survey.scheduled_end,
            access_type: survey.access_type,
            created_at: survey.created_at,
        }
    }
}

impl From<SurveyResponse> for SurveyAnswerDto {
    fn from(response: SurveyResponse) -> Self {
        Self {
            id: response.id,
            survey_id: response.survey_id,
            user_id: response.user_id,
            answers: response.answers,
            is_completed: response.is_completed,
            progress: response.progress,
            started_at: response.started_at,
            completed_at: response.completed_at,
        }
    }
}
