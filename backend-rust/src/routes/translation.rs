//! Translation routes
//!
//! Provides endpoints for content translation including surveys and coupons.
//!
//! ## Endpoints
//!
//! - `POST /translate` - Translate arbitrary texts
//! - `POST /survey/:id/translate` - Start survey translation job
//! - `GET /survey/:id/translations` - Get survey translations
//! - `POST /coupon/:id/translate` - Start coupon translation job
//! - `GET /coupon/:id/translations` - Get coupon translations
//! - `GET /job/:id` - Get translation job status
//! - `GET /jobs` - Get all translation jobs for user

use axum::{
    extract::{Extension, Path, Query, State},
    middleware,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, AuthUser};
use crate::state::AppState;

// ============================================================================
// Request Types
// ============================================================================

/// Request to translate texts
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateTextsRequest {
    pub texts: Vec<String>,
    pub source_language: String,
    pub target_languages: Vec<String>,
    #[serde(default = "default_provider")]
    pub provider: String,
}

fn default_provider() -> String {
    "azure".to_string()
}

/// Request to translate survey or coupon
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateEntityRequest {
    pub source_language: String,
    pub target_languages: Vec<String>,
    #[serde(default = "default_provider")]
    pub provider: String,
}

/// Query parameters for translation jobs
#[derive(Debug, Deserialize)]
pub struct TranslationJobsQuery {
    #[serde(default = "default_page")]
    pub page: i32,
    #[serde(default = "default_limit")]
    pub limit: i32,
    pub status: Option<String>,
    pub entity_type: Option<String>,
}

fn default_page() -> i32 {
    1
}

fn default_limit() -> i32 {
    10
}

// ============================================================================
// Response Types
// ============================================================================

/// Response for text translation
#[derive(Debug, Serialize)]
pub struct TranslateTextsResponse {
    pub translations: Vec<TranslationResult>,
    pub provider: String,
    #[serde(rename = "sourceLanguage")]
    pub source_language: String,
}

#[derive(Debug, Serialize)]
pub struct TranslationResult {
    pub text: String,
    pub translations: Vec<LanguageTranslation>,
}

#[derive(Debug, Serialize)]
pub struct LanguageTranslation {
    pub language: String,
    pub text: String,
}

/// Translation job response
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TranslationJob {
    pub id: Uuid,
    pub entity_type: String,
    pub entity_id: Uuid,
    pub source_language: String,
    pub target_languages: JsonValue,
    pub status: String,
    pub provider: Option<String>,
    pub created_by: Option<Uuid>,
    pub created_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
}

/// Paginated translation jobs response
#[derive(Debug, Serialize)]
pub struct PaginatedJobsResponse {
    pub data: Vec<TranslationJob>,
    pub total: i64,
    pub page: i32,
    pub limit: i32,
    #[serde(rename = "totalPages")]
    pub total_pages: i32,
}

/// Survey with translations
#[derive(Debug, Serialize)]
pub struct SurveyWithTranslations {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub translations: Vec<SurveyTranslation>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SurveyTranslation {
    pub id: Uuid,
    pub survey_id: Uuid,
    pub language: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub questions: Option<JsonValue>,
    pub created_at: Option<DateTime<Utc>>,
}

/// Coupon with translations
#[derive(Debug, Serialize)]
pub struct CouponWithTranslations {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub translations: Vec<CouponTranslation>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CouponTranslation {
    pub id: Uuid,
    pub coupon_id: Uuid,
    pub language: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /translation/translate
/// Translate arbitrary texts
async fn translate_texts(
    State(_state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Json(payload): Json<TranslateTextsRequest>,
) -> Result<Json<TranslateTextsResponse>, AppError> {
    // Validate input
    if payload.texts.is_empty() {
        return Err(AppError::BadRequest("Texts array is required".to_string()));
    }

    if payload.source_language.is_empty() {
        return Err(AppError::BadRequest(
            "Source language is required".to_string(),
        ));
    }

    if payload.target_languages.is_empty() {
        return Err(AppError::BadRequest(
            "Target languages are required".to_string(),
        ));
    }

    // In a real implementation, this would call an external translation service
    // For now, we return a placeholder response indicating the feature requires
    // external service configuration
    let translations: Vec<TranslationResult> = payload
        .texts
        .iter()
        .map(|text| TranslationResult {
            text: text.clone(),
            translations: payload
                .target_languages
                .iter()
                .map(|lang| LanguageTranslation {
                    language: lang.clone(),
                    text: format!("[{}] {}", lang, text), // Placeholder
                })
                .collect(),
        })
        .collect();

    Ok(Json(TranslateTextsResponse {
        translations,
        provider: payload.provider,
        source_language: payload.source_language,
    }))
}

/// POST /translation/survey/:id/translate
/// Start a survey translation job
async fn translate_survey(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
    Json(payload): Json<TranslateEntityRequest>,
) -> Result<Json<TranslationJob>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate input
    if payload.source_language.is_empty() {
        return Err(AppError::BadRequest(
            "Source language is required".to_string(),
        ));
    }

    if payload.target_languages.is_empty() {
        return Err(AppError::BadRequest(
            "Target languages are required".to_string(),
        ));
    }

    // Check if survey exists
    let survey_exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM surveys WHERE id = $1")
        .bind(survey_id)
        .fetch_optional(state.db())
        .await?;

    if survey_exists.is_none() {
        return Err(AppError::NotFound("Survey not found".to_string()));
    }

    // Create translation job
    let target_languages_json = serde_json::to_value(&payload.target_languages)?;

    let job: TranslationJob = sqlx::query_as(
        r#"
        INSERT INTO translation_jobs
        (entity_type, entity_id, source_language, target_languages, status, provider, created_by, created_at)
        VALUES ('survey', $1, $2, $3, 'pending', $4, $5, NOW())
        RETURNING id, entity_type, entity_id, source_language, target_languages, status, provider, created_by, created_at, completed_at, error_message
        "#,
    )
    .bind(survey_id)
    .bind(&payload.source_language)
    .bind(&target_languages_json)
    .bind(&payload.provider)
    .bind(user_id)
    .fetch_one(state.db())
    .await?;

    // In production, you would trigger an async job to perform the translation
    tracing::info!(
        "Created translation job {} for survey {}",
        job.id,
        survey_id
    );

    Ok(Json(job))
}

/// GET /translation/survey/:id/translations
/// Get translations for a survey
async fn get_survey_translations(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(survey_id): Path<Uuid>,
) -> Result<Json<SurveyWithTranslations>, AppError> {
    // Get the survey
    let survey: Option<(Uuid, String, Option<String>)> =
        sqlx::query_as("SELECT id, title, description FROM surveys WHERE id = $1")
            .bind(survey_id)
            .fetch_optional(state.db())
            .await?;

    let (id, title, description) =
        survey.ok_or_else(|| AppError::NotFound("Survey not found".to_string()))?;

    // Get translations
    let translations: Vec<SurveyTranslation> = sqlx::query_as(
        r#"
        SELECT id, survey_id, language, title, description, questions, created_at
        FROM survey_translations
        WHERE survey_id = $1
        ORDER BY language
        "#,
    )
    .bind(survey_id)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    Ok(Json(SurveyWithTranslations {
        id,
        title,
        description,
        translations,
    }))
}

/// POST /translation/coupon/:id/translate
/// Start a coupon translation job
async fn translate_coupon(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
    Json(payload): Json<TranslateEntityRequest>,
) -> Result<Json<TranslationJob>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    // Validate input
    if payload.source_language.is_empty() {
        return Err(AppError::BadRequest(
            "Source language is required".to_string(),
        ));
    }

    if payload.target_languages.is_empty() {
        return Err(AppError::BadRequest(
            "Target languages are required".to_string(),
        ));
    }

    // Check if coupon exists
    let coupon_exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM coupons WHERE id = $1")
        .bind(coupon_id)
        .fetch_optional(state.db())
        .await?;

    if coupon_exists.is_none() {
        return Err(AppError::NotFound("Coupon not found".to_string()));
    }

    // Create translation job
    let target_languages_json = serde_json::to_value(&payload.target_languages)?;

    let job: TranslationJob = sqlx::query_as(
        r#"
        INSERT INTO translation_jobs
        (entity_type, entity_id, source_language, target_languages, status, provider, created_by, created_at)
        VALUES ('coupon', $1, $2, $3, 'pending', $4, $5, NOW())
        RETURNING id, entity_type, entity_id, source_language, target_languages, status, provider, created_by, created_at, completed_at, error_message
        "#,
    )
    .bind(coupon_id)
    .bind(&payload.source_language)
    .bind(&target_languages_json)
    .bind(&payload.provider)
    .bind(user_id)
    .fetch_one(state.db())
    .await?;

    tracing::info!(
        "Created translation job {} for coupon {}",
        job.id,
        coupon_id
    );

    Ok(Json(job))
}

/// GET /translation/coupon/:id/translations
/// Get translations for a coupon
async fn get_coupon_translations(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(coupon_id): Path<Uuid>,
    Query(params): Query<CouponTranslationsQuery>,
) -> Result<Json<CouponWithTranslations>, AppError> {
    // Get the coupon
    let coupon: Option<(Uuid, String, Option<String>)> =
        sqlx::query_as("SELECT id, title, description FROM coupons WHERE id = $1")
            .bind(coupon_id)
            .fetch_optional(state.db())
            .await?;

    let (id, title, description) =
        coupon.ok_or_else(|| AppError::NotFound("Coupon not found".to_string()))?;

    // Get translations (optionally filtered by language)
    let translations: Vec<CouponTranslation> = if let Some(ref lang) = params.language {
        sqlx::query_as(
            r#"
            SELECT id, coupon_id, language, title, description, terms_and_conditions, created_at
            FROM coupon_translations
            WHERE coupon_id = $1 AND language = $2
            ORDER BY language
            "#,
        )
        .bind(coupon_id)
        .bind(lang)
        .fetch_all(state.db())
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as(
            r#"
            SELECT id, coupon_id, language, title, description, terms_and_conditions, created_at
            FROM coupon_translations
            WHERE coupon_id = $1
            ORDER BY language
            "#,
        )
        .bind(coupon_id)
        .fetch_all(state.db())
        .await
        .unwrap_or_default()
    };

    Ok(Json(CouponWithTranslations {
        id,
        title,
        description,
        translations,
    }))
}

/// Query params for coupon translations
#[derive(Debug, Deserialize)]
pub struct CouponTranslationsQuery {
    pub language: Option<String>,
}

/// GET /translation/job/:id
/// Get translation job status
async fn get_translation_job(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<TranslationJob>, AppError> {
    let job: Option<TranslationJob> = sqlx::query_as(
        r#"
        SELECT id, entity_type, entity_id, source_language, target_languages, status, provider, created_by, created_at, completed_at, error_message
        FROM translation_jobs
        WHERE id = $1
        "#,
    )
    .bind(job_id)
    .fetch_optional(state.db())
    .await?;

    job.ok_or_else(|| AppError::NotFound("Translation job not found".to_string()))
        .map(Json)
}

/// GET /translation/jobs
/// Get all translation jobs for the current user
async fn get_translation_jobs(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<TranslationJobsQuery>,
) -> Result<Json<PaginatedJobsResponse>, AppError> {
    let user_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))?;

    let page = params.page.max(1);
    let limit = params.limit.clamp(1, 100);
    let offset = (page - 1) * limit;

    // Build dynamic query based on filters
    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM translation_jobs
        WHERE created_by = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR entity_type = $3)
        "#,
    )
    .bind(user_id)
    .bind(&params.status)
    .bind(&params.entity_type)
    .fetch_one(state.db())
    .await
    .unwrap_or((0,));

    let jobs: Vec<TranslationJob> = sqlx::query_as(
        r#"
        SELECT id, entity_type, entity_id, source_language, target_languages, status, provider, created_by, created_at, completed_at, error_message
        FROM translation_jobs
        WHERE created_by = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR entity_type = $3)
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        "#,
    )
    .bind(user_id)
    .bind(&params.status)
    .bind(&params.entity_type)
    .bind(limit)
    .bind(offset)
    .fetch_all(state.db())
    .await
    .unwrap_or_default();

    let total_pages = ((total.0 as f64) / (limit as f64)).ceil() as i32;

    Ok(Json(PaginatedJobsResponse {
        data: jobs,
        total: total.0,
        page,
        limit,
        total_pages,
    }))
}

// ============================================================================
// Router
// ============================================================================

/// Create translation routes
///
/// These routes are intended to be nested under /api/translation via the main router.
/// All routes require authentication.
///
/// ## Endpoints
///
/// - `POST /translate` - Translate arbitrary texts
/// - `POST /survey/:id/translate` - Start survey translation job
/// - `GET /survey/:id/translations` - Get survey translations
/// - `POST /coupon/:id/translate` - Start coupon translation job
/// - `GET /coupon/:id/translations` - Get coupon translations
/// - `GET /job/:id` - Get translation job status
/// - `GET /jobs` - Get all translation jobs for user
pub fn routes() -> Router<AppState> {
    Router::new()
        // Basic translation
        .route("/translate", post(translate_texts))
        // Survey translation
        .route("/survey/:id/translate", post(translate_survey))
        .route("/survey/:id/translations", get(get_survey_translations))
        // Coupon translation
        .route("/coupon/:id/translate", post(translate_coupon))
        .route("/coupon/:id/translations", get(get_coupon_translations))
        // Job management
        .route("/job/:id", get(get_translation_job))
        .route("/jobs", get(get_translation_jobs))
        .layer(middleware::from_fn(auth_middleware))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_provider() {
        assert_eq!(default_provider(), "azure");
    }

    #[test]
    fn test_default_page() {
        assert_eq!(default_page(), 1);
    }

    #[test]
    fn test_default_limit() {
        assert_eq!(default_limit(), 10);
    }

    #[test]
    fn test_translate_texts_request_deserialization() {
        let json = r#"{
            "texts": ["Hello", "World"],
            "sourceLanguage": "en",
            "targetLanguages": ["th", "ja"]
        }"#;

        let request: TranslateTextsRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.texts.len(), 2);
        assert_eq!(request.source_language, "en");
        assert_eq!(request.target_languages.len(), 2);
        assert_eq!(request.provider, "azure"); // Default value
    }

    #[test]
    fn test_translate_entity_request_deserialization() {
        let json = r#"{
            "sourceLanguage": "en",
            "targetLanguages": ["th", "ja", "zh"],
            "provider": "google"
        }"#;

        let request: TranslateEntityRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.source_language, "en");
        assert_eq!(request.target_languages.len(), 3);
        assert_eq!(request.provider, "google");
    }

    #[test]
    fn test_translation_jobs_query_defaults() {
        let query = TranslationJobsQuery {
            page: default_page(),
            limit: default_limit(),
            status: None,
            entity_type: None,
        };

        assert_eq!(query.page, 1);
        assert_eq!(query.limit, 10);
        assert!(query.status.is_none());
        assert!(query.entity_type.is_none());
    }
}
