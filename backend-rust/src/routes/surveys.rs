//! Survey routes
//!
//! Provides endpoints for survey management including listing surveys,
//! viewing details, submitting responses, and administrative functions.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, has_role, AuthUser};
use crate::models::survey::{
    CreateSurveyRequest, SurveyAnswerDto, SurveyResponseDto, UpdateSurveyRequest,
};
use crate::state::AppState;

/// Pagination query parameters for survey listing
#[derive(Debug, Deserialize)]
pub struct ListSurveysQuery {
    /// Page number (1-indexed)
    pub page: Option<i32>,
    /// Number of items per page
    pub limit: Option<i32>,
    /// Filter by active status (admin can see all if false)
    pub active: Option<bool>,
}

/// Paginated list response
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    pub total_pages: i32,
}

/// Survey invitation response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyInvitationResponse {
    pub id: Uuid,
    pub survey_id: Uuid,
    pub survey_title: String,
    pub status: String,
    pub sent_at: Option<String>,
    pub expires_at: Option<String>,
}

/// List survey invitations response
#[derive(Debug, Serialize)]
pub struct ListInvitationsResponse {
    pub invitations: Vec<SurveyInvitationResponse>,
}

/// Submit response request body
#[derive(Debug, Deserialize)]
pub struct SubmitResponseRequest {
    pub answers: serde_json::Value,
    #[serde(default)]
    pub is_completed: bool,
}

/// Survey response submission result
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResponseResponse {
    pub id: Uuid,
    pub survey_id: Uuid,
    pub is_completed: bool,
    pub message: String,
}

/// Success response for mutations
#[derive(Debug, Serialize)]
pub struct SuccessResponse {
    pub success: bool,
    pub message: String,
}

/// Not implemented response (placeholder)
#[derive(Serialize)]
pub struct NotImplementedResponse {
    pub error: String,
    pub message: String,
}

fn not_implemented_response() -> (StatusCode, Json<NotImplementedResponse>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(NotImplementedResponse {
            error: "not_implemented".to_string(),
            message: "This endpoint is not yet implemented".to_string(),
        }),
    )
}

// ============================================================================
// Database Row Types
// ============================================================================

/// Survey row with invitation info
#[derive(Debug, FromRow)]
#[allow(dead_code)]
struct SurveyRow {
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
}

impl From<SurveyRow> for SurveyResponseDto {
    fn from(row: SurveyRow) -> Self {
        let questions = serde_json::from_value(row.questions.clone()).unwrap_or_default();
        Self {
            id: row.id,
            title: row.title,
            description: row.description,
            questions,
            status: row.status,
            scheduled_start: row.scheduled_start,
            scheduled_end: row.scheduled_end,
            access_type: row.access_type,
            created_at: row.created_at,
        }
    }
}

/// Survey invitation row
#[derive(Debug, FromRow)]
#[allow(dead_code)]
struct SurveyInvitationRow {
    pub id: Uuid,
    pub survey_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub status: Option<String>,
    pub sent_at: Option<NaiveDateTime>,
    pub expires_at: Option<NaiveDateTime>,
    pub survey_title: Option<String>,
}

/// Survey response row
#[derive(Debug, FromRow)]
struct SurveyResponseRow {
    pub id: Uuid,
    pub survey_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub answers: serde_json::Value,
    pub is_completed: Option<bool>,
    pub progress: Option<i32>,
    pub started_at: Option<NaiveDateTime>,
    pub completed_at: Option<NaiveDateTime>,
}

impl From<SurveyResponseRow> for SurveyAnswerDto {
    fn from(row: SurveyResponseRow) -> Self {
        Self {
            id: row.id,
            survey_id: row.survey_id,
            user_id: row.user_id,
            answers: row.answers,
            is_completed: row.is_completed,
            progress: row.progress,
            started_at: row.started_at,
            completed_at: row.completed_at,
        }
    }
}

// ============================================================================
// Database Operations
// ============================================================================

async fn query_surveys(
    db: &PgPool,
    is_admin: bool,
    status_filter: Option<&str>,
    page: i32,
    limit: i32,
) -> Result<(Vec<SurveyResponseDto>, i64), AppError> {
    let offset = (page - 1) * limit;

    let (surveys, total) = if is_admin {
        // Admin can see all surveys
        if let Some(status) = status_filter {
            let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM surveys WHERE status = $1")
                .bind(status)
                .fetch_one(db)
                .await?;

            let rows: Vec<SurveyRow> = sqlx::query_as(
                r#"
                SELECT id, title, description, questions, target_segment, status,
                       scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type
                FROM surveys
                WHERE status = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
                "#
            )
            .bind(status)
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

            (rows, total.0)
        } else {
            let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM surveys")
                .fetch_one(db)
                .await?;

            let rows: Vec<SurveyRow> = sqlx::query_as(
                r#"
                SELECT id, title, description, questions, target_segment, status,
                       scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type
                FROM surveys
                ORDER BY created_at DESC
                LIMIT $1 OFFSET $2
                "#
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(db)
            .await?;

            (rows, total.0)
        }
    } else {
        // Regular users only see active public surveys
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM surveys WHERE status = 'active' AND access_type = 'public'",
        )
        .fetch_one(db)
        .await?;

        let rows: Vec<SurveyRow> = sqlx::query_as(
            r#"
            SELECT id, title, description, questions, target_segment, status,
                   scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type
            FROM surveys
            WHERE status = 'active' AND access_type = 'public'
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await?;

        (rows, total.0)
    };

    let responses: Vec<SurveyResponseDto> =
        surveys.into_iter().map(SurveyResponseDto::from).collect();
    Ok((responses, total))
}

async fn query_survey_by_id(
    db: &PgPool,
    survey_id: Uuid,
) -> Result<Option<SurveyResponseDto>, AppError> {
    let row: Option<SurveyRow> = sqlx::query_as(
        r#"
        SELECT id, title, description, questions, target_segment, status,
               scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type
        FROM surveys
        WHERE id = $1
        "#,
    )
    .bind(survey_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(SurveyResponseDto::from))
}

async fn can_user_access_survey(
    db: &PgPool,
    user_id: Uuid,
    survey_id: Uuid,
) -> Result<bool, AppError> {
    // Check if survey is public and active
    let survey: Option<SurveyRow> = sqlx::query_as(
        "SELECT id, title, description, questions, target_segment, status, scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type FROM surveys WHERE id = $1"
    )
    .bind(survey_id)
    .fetch_optional(db)
    .await?;

    if let Some(s) = survey {
        if s.access_type == "public" && s.status.as_deref() == Some("active") {
            return Ok(true);
        }

        // Check if user has an invitation
        let invitation: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM survey_invitations WHERE survey_id = $1 AND user_id = $2 AND status = 'pending'"
        )
        .bind(survey_id)
        .bind(user_id)
        .fetch_optional(db)
        .await?;

        return Ok(invitation.is_some());
    }

    Ok(false)
}

async fn query_user_invitations(
    db: &PgPool,
    user_id: Uuid,
) -> Result<Vec<SurveyInvitationResponse>, AppError> {
    let rows: Vec<SurveyInvitationRow> = sqlx::query_as(
        r#"
        SELECT si.id, si.survey_id, si.user_id, si.status, si.sent_at, si.expires_at,
               s.title as survey_title
        FROM survey_invitations si
        LEFT JOIN surveys s ON si.survey_id = s.id
        WHERE si.user_id = $1
          AND si.status = 'pending'
          AND (si.expires_at IS NULL OR si.expires_at > NOW())
        ORDER BY si.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;

    let invitations: Vec<SurveyInvitationResponse> = rows
        .into_iter()
        .map(|row| SurveyInvitationResponse {
            id: row.id,
            survey_id: row.survey_id.unwrap_or(Uuid::nil()),
            survey_title: row.survey_title.unwrap_or_else(|| "Untitled".to_string()),
            status: row.status.unwrap_or_else(|| "pending".to_string()),
            sent_at: row.sent_at.map(|dt| dt.to_string()),
            expires_at: row.expires_at.map(|dt| dt.to_string()),
        })
        .collect();

    Ok(invitations)
}

async fn insert_survey(
    db: &PgPool,
    req: &CreateSurveyRequest,
    created_by: Uuid,
) -> Result<SurveyResponseDto, AppError> {
    let questions_json = serde_json::to_value(&req.questions)?;
    let target_segment = req.target_segment.clone().unwrap_or(serde_json::json!({}));
    let status = req.status.as_deref().unwrap_or("draft");
    let access_type = req.access_type.as_deref().unwrap_or("public");

    let row: SurveyRow = sqlx::query_as(
        r#"
        INSERT INTO surveys (title, description, questions, target_segment, status, scheduled_start, scheduled_end, created_by, access_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, title, description, questions, target_segment, status, scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type
        "#
    )
    .bind(&req.title)
    .bind(&req.description)
    .bind(&questions_json)
    .bind(&target_segment)
    .bind(status)
    .bind(&req.scheduled_start)
    .bind(&req.scheduled_end)
    .bind(created_by)
    .bind(access_type)
    .fetch_one(db)
    .await?;

    Ok(SurveyResponseDto::from(row))
}

async fn update_survey_in_db(
    db: &PgPool,
    survey_id: Uuid,
    req: &UpdateSurveyRequest,
) -> Result<Option<SurveyResponseDto>, AppError> {
    // Check if survey exists
    let existing = query_survey_by_id(db, survey_id).await?;
    if existing.is_none() {
        return Ok(None);
    }

    // Build dynamic update - for simplicity, we'll update all provided fields
    let current = existing.unwrap();

    let title = req.title.as_ref().unwrap_or(&current.title);
    let description = req.description.clone().or(current.description);
    let questions_json = if let Some(ref q) = req.questions {
        serde_json::to_value(q)?
    } else {
        serde_json::to_value(&current.questions)?
    };
    let target_segment = req.target_segment.clone();
    let status = req.status.as_ref().or(current.status.as_ref());
    let scheduled_start = req.scheduled_start.or(current.scheduled_start);
    let scheduled_end = req.scheduled_end.or(current.scheduled_end);
    let access_type = req.access_type.as_ref().unwrap_or(&current.access_type);

    let row: SurveyRow = sqlx::query_as(
        r#"
        UPDATE surveys
        SET title = $2, description = $3, questions = $4, target_segment = COALESCE($5, target_segment),
            status = $6, scheduled_start = $7, scheduled_end = $8, access_type = $9, updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, description, questions, target_segment, status, scheduled_start, scheduled_end, created_by, created_at, updated_at, access_type
        "#
    )
    .bind(survey_id)
    .bind(title)
    .bind(&description)
    .bind(&questions_json)
    .bind(&target_segment)
    .bind(status)
    .bind(scheduled_start)
    .bind(scheduled_end)
    .bind(access_type)
    .fetch_one(db)
    .await?;

    Ok(Some(SurveyResponseDto::from(row)))
}

async fn soft_delete_survey(db: &PgPool, survey_id: Uuid) -> Result<bool, AppError> {
    let result =
        sqlx::query("UPDATE surveys SET status = 'archived', updated_at = NOW() WHERE id = $1")
            .bind(survey_id)
            .execute(db)
            .await?;

    Ok(result.rows_affected() > 0)
}

async fn insert_or_update_response(
    db: &PgPool,
    survey_id: Uuid,
    user_id: Uuid,
    answers: &serde_json::Value,
    is_completed: bool,
) -> Result<SurveyAnswerDto, AppError> {
    // Check if response already exists
    let existing: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM survey_responses WHERE survey_id = $1 AND user_id = $2")
            .bind(survey_id)
            .bind(user_id)
            .fetch_optional(db)
            .await?;

    let row: SurveyResponseRow = if let Some((response_id,)) = existing {
        // Update existing response
        sqlx::query_as(
            r#"
            UPDATE survey_responses
            SET answers = $3, is_completed = $4, progress = CASE WHEN $4 THEN 100 ELSE progress END,
                completed_at = CASE WHEN $4 THEN NOW() ELSE completed_at END, updated_at = NOW()
            WHERE id = $1
            RETURNING id, survey_id, user_id, answers, is_completed, progress, started_at, completed_at
            "#
        )
        .bind(response_id)
        .bind(survey_id)
        .bind(answers)
        .bind(is_completed)
        .fetch_one(db)
        .await?
    } else {
        // Insert new response
        let progress = if is_completed { 100 } else { 0 };
        sqlx::query_as(
            r#"
            INSERT INTO survey_responses (survey_id, user_id, answers, is_completed, progress, started_at, completed_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), CASE WHEN $4 THEN NOW() ELSE NULL END)
            RETURNING id, survey_id, user_id, answers, is_completed, progress, started_at, completed_at
            "#
        )
        .bind(survey_id)
        .bind(user_id)
        .bind(answers)
        .bind(is_completed)
        .bind(progress)
        .fetch_one(db)
        .await?
    };

    // If completed, update invitation status if exists
    if is_completed {
        sqlx::query(
            "UPDATE survey_invitations SET status = 'completed', updated_at = NOW() WHERE survey_id = $1 AND user_id = $2"
        )
        .bind(survey_id)
        .bind(user_id)
        .execute(db)
        .await?;
    }

    Ok(SurveyAnswerDto::from(row))
}

async fn query_survey_responses(
    db: &PgPool,
    survey_id: Uuid,
    page: i32,
    limit: i32,
) -> Result<(Vec<SurveyAnswerDto>, i64), AppError> {
    let offset = (page - 1) * limit;

    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM survey_responses WHERE survey_id = $1")
            .bind(survey_id)
            .fetch_one(db)
            .await?;

    let rows: Vec<SurveyResponseRow> = sqlx::query_as(
        r#"
        SELECT id, survey_id, user_id, answers, is_completed, progress, started_at, completed_at
        FROM survey_responses
        WHERE survey_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(survey_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await?;

    let responses: Vec<SurveyAnswerDto> = rows.into_iter().map(SurveyAnswerDto::from).collect();
    Ok((responses, total.0))
}

// ============================================================================
// Public/User Survey Routes
// ============================================================================

/// List surveys handler
///
/// GET /api/surveys
///
/// Returns a paginated list of surveys. Regular users only see active surveys,
/// while admins can see all surveys including drafts and archived ones.
///
/// Query parameters:
/// - page: Page number (default: 1)
/// - limit: Items per page (default: 10, max: 100)
/// - active: Filter by active status (admin only)
async fn list_surveys(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(params): Query<ListSurveysQuery>,
) -> Result<Json<PaginatedResponse<SurveyResponseDto>>, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let limit = params.limit.unwrap_or(10).clamp(1, 100);
    let is_admin = has_role(&user, "admin");

    // For admin, allow status filter; for users, always filter active
    let status_filter = if is_admin {
        params
            .active
            .map(|active| if active { "active" } else { "draft" })
    } else {
        Some("active")
    };

    let (surveys, total) = query_surveys(state.db(), is_admin, status_filter, page, limit).await?;
    let total_pages = ((total as f64) / (limit as f64)).ceil() as i32;

    Ok(Json(PaginatedResponse {
        data: surveys,
        total,
        page,
        limit,
        total_pages,
    }))
}

/// Get survey by ID handler
///
/// GET /api/surveys/:id
///
/// Returns the full survey details including all questions.
/// Users can only view active surveys; admins can view any survey.
async fn get_survey(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<Json<SurveyResponseDto>, AppError> {
    let is_admin = has_role(&user, "admin");

    let survey = query_survey_by_id(state.db(), survey_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Survey not found".to_string()))?;

    // Non-admin users can only access active public surveys or surveys they're invited to
    if !is_admin {
        let user_id = Uuid::parse_str(&user.id)
            .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

        let has_access = can_user_access_survey(state.db(), user_id, survey_id).await?;
        if !has_access {
            return Err(AppError::Forbidden(
                "Access denied. You do not have permission to access this survey.".to_string(),
            ));
        }
    }

    Ok(Json(survey))
}

/// Get user's survey invitations handler
///
/// GET /api/surveys/invitations
///
/// Returns a list of survey invitations for the authenticated user.
/// Only returns pending and not-expired invitations.
async fn get_user_invitations(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<ListInvitationsResponse>, AppError> {
    let user_id = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let invitations = query_user_invitations(state.db(), user_id).await?;

    Ok(Json(ListInvitationsResponse { invitations }))
}

/// Submit survey response handler
///
/// POST /api/surveys/:id/responses
///
/// Submits a response to a survey. The user must be either invited
/// to the survey or the survey must be public.
///
/// Request body:
/// - answers: JSON object with question_id -> answer mappings
/// - is_completed: Whether this is a final submission (default: true)
async fn submit_response(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
    Json(payload): Json<SubmitResponseRequest>,
) -> Result<(StatusCode, Json<SubmitResponseResponse>), AppError> {
    let user_id = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Verify survey exists and is active
    let survey = query_survey_by_id(state.db(), survey_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Survey not found".to_string()))?;

    if survey.status.as_deref() != Some("active") {
        return Err(AppError::BadRequest("Survey is not active".to_string()));
    }

    // Check user has access
    let has_access = can_user_access_survey(state.db(), user_id, survey_id).await?;
    if !has_access {
        return Err(AppError::Forbidden(
            "Access denied. You do not have permission to respond to this survey.".to_string(),
        ));
    }

    // Submit or update response
    let response = insert_or_update_response(
        state.db(),
        survey_id,
        user_id,
        &payload.answers,
        payload.is_completed,
    )
    .await?;

    let message = if payload.is_completed {
        "Survey response submitted successfully".to_string()
    } else {
        "Survey response saved as draft".to_string()
    };

    Ok((
        StatusCode::OK,
        Json(SubmitResponseResponse {
            id: response.id,
            survey_id,
            is_completed: response.is_completed.unwrap_or(false),
            message,
        }),
    ))
}

// ============================================================================
// Admin Survey Routes
// ============================================================================

/// Create survey handler (admin only)
///
/// POST /api/surveys
///
/// Creates a new survey with the provided questions and settings.
async fn create_survey(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(payload): Json<CreateSurveyRequest>,
) -> Result<(StatusCode, Json<SurveyResponseDto>), AppError> {
    // Check admin permissions
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to create surveys".to_string(),
        ));
    }

    let created_by = Uuid::parse_str(&user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate survey data
    if payload.title.trim().is_empty() {
        return Err(AppError::Validation("Title is required".to_string()));
    }
    if payload.questions.is_empty() {
        return Err(AppError::Validation(
            "At least one question is required".to_string(),
        ));
    }

    let survey = insert_survey(state.db(), &payload, created_by).await?;

    Ok((StatusCode::CREATED, Json(survey)))
}

/// Update survey handler (admin only)
///
/// PUT /api/surveys/:id
///
/// Updates an existing survey. Only admins can update surveys.
/// Cannot update a survey that has responses unless it's still in draft.
async fn update_survey(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
    Json(payload): Json<UpdateSurveyRequest>,
) -> Result<(StatusCode, Json<SurveyResponseDto>), AppError> {
    // Check admin permissions
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to update surveys".to_string(),
        ));
    }

    let survey = update_survey_in_db(state.db(), survey_id, &payload)
        .await?
        .ok_or_else(|| AppError::NotFound("Survey not found".to_string()))?;

    Ok((StatusCode::OK, Json(survey)))
}

/// Get survey responses handler (admin only)
///
/// GET /api/surveys/:id/responses
///
/// Returns all responses for a specific survey.
/// Only admins can view survey responses.
async fn get_survey_responses(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
    Query(params): Query<ListSurveysQuery>,
) -> Result<(StatusCode, Json<PaginatedResponse<SurveyAnswerDto>>), AppError> {
    // Check admin permissions
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to view survey responses".to_string(),
        ));
    }

    // Verify survey exists
    query_survey_by_id(state.db(), survey_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Survey not found".to_string()))?;

    let page = params.page.unwrap_or(1).max(1);
    let limit = params.limit.unwrap_or(10).clamp(1, 100);

    let (responses, total) = query_survey_responses(state.db(), survey_id, page, limit).await?;
    let total_pages = ((total as f64) / (limit as f64)).ceil() as i32;

    Ok((
        StatusCode::OK,
        Json(PaginatedResponse {
            data: responses,
            total,
            page,
            limit,
            total_pages,
        }),
    ))
}

/// Delete survey handler (admin only)
///
/// DELETE /api/surveys/:id
///
/// Soft-deletes a survey by setting its status to 'archived'.
async fn delete_survey(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<(StatusCode, Json<SuccessResponse>), AppError> {
    // Check admin permissions
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to delete surveys".to_string(),
        ));
    }

    let deleted = soft_delete_survey(state.db(), survey_id).await?;

    if !deleted {
        return Err(AppError::NotFound("Survey not found".to_string()));
    }

    Ok((
        StatusCode::OK,
        Json(SuccessResponse {
            success: true,
            message: "Survey deleted successfully".to_string(),
        }),
    ))
}

// ============================================================================
// Additional Routes (Extended API)
// ============================================================================

/// Get available surveys for user
///
/// GET /api/surveys/available/user
///
/// Returns surveys available to the current user (both public and invited).
async fn get_available_surveys(
    Extension(user): Extension<AuthUser>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    let _user_id = user.id;
    not_implemented_response()
}

/// Get public surveys
///
/// GET /api/surveys/public/user
///
/// Returns all public (non-invite-only) active surveys.
async fn get_public_surveys(
    Extension(_user): Extension<AuthUser>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

/// Get invited surveys for user
///
/// GET /api/surveys/invited/user
///
/// Returns surveys the user has been specifically invited to.
async fn get_invited_surveys(
    Extension(user): Extension<AuthUser>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    let _user_id = user.id;
    not_implemented_response()
}

/// Get user's response for a survey
///
/// GET /api/surveys/responses/:surveyId/user
///
/// Returns the current user's response for a specific survey if exists.
async fn get_user_response(
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    let _user_id = user.id;
    let _survey_id = survey_id;
    not_implemented_response()
}

/// Get survey analytics (admin only)
///
/// GET /api/surveys/:surveyId/analytics
///
/// Returns analytics data for a survey including response rates,
/// answer distributions, etc.
async fn get_survey_analytics(
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<(StatusCode, Json<NotImplementedResponse>), AppError> {
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to view analytics".to_string(),
        ));
    }
    let _survey_id = survey_id;
    Ok(not_implemented_response())
}

/// Export survey responses (admin only)
///
/// GET /api/surveys/:surveyId/export
///
/// Exports survey responses in CSV or JSON format.
async fn export_survey_responses(
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<(StatusCode, Json<NotImplementedResponse>), AppError> {
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to export responses".to_string(),
        ));
    }
    let _survey_id = survey_id;
    Ok(not_implemented_response())
}

/// Get survey invitations for a survey (admin only)
///
/// GET /api/surveys/:surveyId/invitations
///
/// Returns all invitations sent for a specific survey.
async fn get_survey_invitations(
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<(StatusCode, Json<NotImplementedResponse>), AppError> {
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to view invitations".to_string(),
        ));
    }
    let _survey_id = survey_id;
    Ok(not_implemented_response())
}

/// Send survey invitations (admin only)
///
/// POST /api/surveys/:surveyId/invitations/send
///
/// Sends invitations to users based on target segment criteria.
async fn send_survey_invitations(
    Extension(user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<(StatusCode, Json<NotImplementedResponse>), AppError> {
    if !has_role(&user, "admin") {
        return Err(AppError::Forbidden(
            "Admin access required to send invitations".to_string(),
        ));
    }
    let _survey_id = survey_id;
    Ok(not_implemented_response())
}

// ============================================================================
// Coupon Assignment Stubs (Not Yet Implemented)
// ============================================================================

async fn create_coupon_assignment_stub(
    Extension(_user): Extension<AuthUser>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn get_coupon_assignments_stub(
    Extension(_user): Extension<AuthUser>,
    Path(_id): Path<Uuid>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn update_coupon_assignment_stub(
    Extension(_user): Extension<AuthUser>,
    Path((_id, _coupon_id)): Path<(Uuid, Uuid)>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn delete_coupon_assignment_stub(
    Extension(_user): Extension<AuthUser>,
    Path((_id, _coupon_id)): Path<(Uuid, Uuid)>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn get_reward_history_stub(
    Extension(_user): Extension<AuthUser>,
    Path(_id): Path<Uuid>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn get_all_coupon_assignments_stub(
    Extension(_user): Extension<AuthUser>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn send_invitations_to_users_stub(
    Extension(_user): Extension<AuthUser>,
    Path(_id): Path<Uuid>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

async fn resend_invitation_stub(
    Extension(_user): Extension<AuthUser>,
    Path(_id): Path<Uuid>,
) -> (StatusCode, Json<NotImplementedResponse>) {
    not_implemented_response()
}

// ============================================================================
// Router Configuration
// ============================================================================

/// Create survey routes with authentication middleware
///
/// All survey routes require authentication. Admin-specific routes
/// perform additional role checks in the handlers.
///
/// Returns a Router that expects AppState to be provided via `.with_state()`
/// when merged into the main router.
pub fn routes() -> Router<AppState> {
    // Routes that require authentication
    Router::new()
        // Core survey routes
        .route("/", get(list_surveys))
        .route("/", post(create_survey))
        .route("/invitations", get(get_user_invitations))
        .route("/available/user", get(get_available_surveys))
        .route("/public/user", get(get_public_surveys))
        .route("/invited/user", get(get_invited_surveys))
        .route("/responses/:surveyId/user", get(get_user_response))
        .route("/:id", get(get_survey))
        .route("/:id", put(update_survey))
        .route("/:id", delete(delete_survey))
        // Survey response routes (use :id consistently)
        .route("/:id/responses", post(submit_response))
        .route("/:id/responses", get(get_survey_responses))
        // Admin analytics and export routes
        .route("/:id/analytics", get(get_survey_analytics))
        .route("/:id/export", get(export_survey_responses))
        // Invitation management routes
        .route("/:id/invitations", get(get_survey_invitations))
        .route("/:id/invitations/send", post(send_survey_invitations))
        // Coupon assignment routes
        .route("/coupon-assignments", post(create_coupon_assignment_stub))
        .route("/:id/coupon-assignments", get(get_coupon_assignments_stub))
        .route(
            "/:id/coupon-assignments/:couponId",
            put(update_coupon_assignment_stub),
        )
        .route(
            "/:id/coupon-assignments/:couponId",
            delete(delete_coupon_assignment_stub),
        )
        .route("/:id/reward-history", get(get_reward_history_stub))
        .route(
            "/admin/coupon-assignments",
            get(get_all_coupon_assignments_stub),
        )
        .route(
            "/:id/invitations/send-to-users",
            post(send_invitations_to_users_stub),
        )
        .route("/invitations/:id/resend", post(resend_invitation_stub))
        .layer(middleware::from_fn(auth_middleware))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_surveys_query_defaults() {
        let query = ListSurveysQuery {
            page: None,
            limit: None,
            active: None,
        };

        assert_eq!(query.page.unwrap_or(1), 1);
        assert_eq!(query.limit.unwrap_or(10).min(100), 10);
    }

    #[test]
    fn test_list_surveys_query_limit_max() {
        let query = ListSurveysQuery {
            page: Some(1),
            limit: Some(500), // Over max
            active: None,
        };

        // Limit should be capped at 100
        assert_eq!(query.limit.unwrap_or(10).min(100), 100);
    }

    #[test]
    fn test_submit_response_request_default() {
        let json = r#"{"answers": {"q1": "a1"}}"#;
        let request: SubmitResponseRequest = serde_json::from_str(json).unwrap();

        assert!(!request.is_completed); // Default is false
        assert!(request.answers.is_object());
    }

    #[test]
    fn test_submit_response_request_with_completed() {
        let json = r#"{"answers": {"q1": "a1"}, "is_completed": true}"#;
        let request: SubmitResponseRequest = serde_json::from_str(json).unwrap();

        assert!(request.is_completed);
    }
}
