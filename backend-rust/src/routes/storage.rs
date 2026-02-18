//! Storage routes
//!
//! Provides endpoints for file upload, avatar management, and file serving.
//!
//! Routes (all nested under /api/storage):
//! - POST /api/storage/upload - General file upload
//! - POST /api/storage/avatar - Avatar upload (requires authentication)
//! - POST /api/storage/slip - Slip upload (requires authentication)
//! - GET /api/storage/files/:filename - Serve uploaded files
//! - GET /api/storage/avatars/:filename - Serve avatar images
//! - GET /api/storage/slips/:filename - Serve slip images
//! - GET /api/storage/stats - Get storage statistics (admin only)
//! - POST /api/storage/backup - Trigger manual backup (admin only)
//! - DELETE /api/storage/files/:filename - Delete a file

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    middleware,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tracing::{debug, error, info};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, require_role};
use crate::services::storage::{StorageReport, StorageService};

/// State for storage routes
#[derive(Clone)]
pub struct StorageState {
    pub storage: Arc<StorageService>,
}

impl StorageState {
    pub fn new(storage: StorageService) -> Self {
        Self {
            storage: Arc::new(storage),
        }
    }
}

/// Response for successful file upload
#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub success: bool,
    pub url: String,
    pub message: String,
}

/// Response for avatar upload
#[derive(Debug, Serialize)]
pub struct AvatarUploadResponse {
    pub success: bool,
    pub message: String,
    pub data: AvatarData,
}

#[derive(Debug, Serialize)]
pub struct AvatarData {
    #[serde(rename = "avatarUrl")]
    pub avatar_url: String,
}

/// Response for slip upload
#[derive(Debug, Serialize)]
pub struct SlipUploadResponse {
    pub url: String,
}

/// Response for backup trigger
#[derive(Debug, Serialize)]
pub struct BackupResponse {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_backed_up: Option<u64>,
}

/// Request body for avatar upload with user context
#[derive(Debug, Deserialize)]
pub struct AvatarUploadRequest {
    pub user_id: String,
}

/// General file upload handler
///
/// POST /storage/upload
/// Content-Type: multipart/form-data
///
/// Form fields:
/// - file: The file to upload
async fn upload_file(
    State(state): State<StorageState>,
    mut multipart: Multipart,
) -> AppResult<Json<UploadResponse>> {
    let mut file_data: Option<Bytes> = None;
    let mut filename: Option<String> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        AppError::BadRequest(format!("Failed to read multipart data: {}", e))
    })? {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "file" {
            filename = field.file_name().map(|s| s.to_string());
            content_type = field.content_type().map(|s| s.to_string());

            let data = field.bytes().await.map_err(|e| {
                error!("Failed to read file data: {}", e);
                AppError::BadRequest(format!("Failed to read file data: {}", e))
            })?;

            file_data = Some(data);
        }
    }

    let data = file_data.ok_or_else(|| AppError::MissingField("file".to_string()))?;
    let name = filename.unwrap_or_else(|| "unknown".to_string());
    let mime_type = content_type.unwrap_or_else(|| "application/octet-stream".to_string());

    info!(
        "Uploading file: {} ({}, {} bytes)",
        name,
        mime_type,
        data.len()
    );

    let url = state.storage.save_file(data, &name, &mime_type).await?;

    Ok(Json(UploadResponse {
        success: true,
        url,
        message: "File uploaded successfully".to_string(),
    }))
}

/// Avatar upload handler
///
/// POST /storage/avatar
/// Content-Type: multipart/form-data
///
/// Form fields:
/// - avatar: The avatar image file
/// - user_id: The user's ID (should come from auth middleware in production)
async fn upload_avatar(
    State(state): State<StorageState>,
    mut multipart: Multipart,
) -> AppResult<Json<AvatarUploadResponse>> {
    let mut file_data: Option<Bytes> = None;
    let mut content_type: Option<String> = None;
    let mut user_id: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        AppError::BadRequest(format!("Failed to read multipart data: {}", e))
    })? {
        let field_name = field.name().unwrap_or("").to_string();

        match field_name.as_str() {
            "avatar" | "file" => {
                content_type = field.content_type().map(|s| s.to_string());

                let data = field.bytes().await.map_err(|e| {
                    error!("Failed to read avatar data: {}", e);
                    AppError::BadRequest(format!("Failed to read avatar data: {}", e))
                })?;

                file_data = Some(data);
            },
            "user_id" => {
                let value = field.text().await.map_err(|e| {
                    error!("Failed to read user_id: {}", e);
                    AppError::BadRequest(format!("Failed to read user_id: {}", e))
                })?;
                user_id = Some(value);
            },
            _ => {
                debug!("Ignoring unknown field: {}", field_name);
            },
        }
    }

    let data = file_data.ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;

    let uid = user_id.ok_or_else(|| AppError::MissingField("user_id".to_string()))?;

    let mime_type =
        content_type.ok_or_else(|| AppError::BadRequest("Content type is required".to_string()))?;

    info!(
        "Processing avatar upload for user {}: {} bytes, {}",
        uid,
        data.len(),
        mime_type
    );

    let avatar_url = state.storage.save_avatar(&uid, data, &mime_type).await?;

    info!("Avatar upload completed for user {}: {}", uid, avatar_url);

    Ok(Json(AvatarUploadResponse {
        success: true,
        message: "Avatar uploaded successfully".to_string(),
        data: AvatarData { avatar_url },
    }))
}

/// Slip upload handler
///
/// POST /storage/slip
/// Content-Type: multipart/form-data
///
/// Form fields:
/// - slip: The slip image file
async fn upload_slip(
    State(state): State<StorageState>,
    mut multipart: Multipart,
) -> AppResult<Json<SlipUploadResponse>> {
    let mut file_data: Option<Bytes> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        AppError::BadRequest(format!("Failed to read multipart data: {}", e))
    })? {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "slip" || field_name == "file" {
            content_type = field.content_type().map(|s| s.to_string());

            let data = field.bytes().await.map_err(|e| {
                error!("Failed to read slip data: {}", e);
                AppError::BadRequest(format!("Failed to read slip data: {}", e))
            })?;

            file_data = Some(data);
        }
    }

    let data = file_data.ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;

    let mime_type =
        content_type.ok_or_else(|| AppError::BadRequest("Content type is required".to_string()))?;

    info!(
        "Processing slip upload: {} bytes, {}",
        data.len(),
        mime_type
    );

    let url = state.storage.save_slip(data, &mime_type).await?;

    info!("Slip upload completed: {}", url);

    Ok(Json(SlipUploadResponse { url }))
}

/// Serve uploaded files
///
/// GET /storage/files/:filename
async fn serve_file(
    State(state): State<StorageState>,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    serve_static_file(&state.storage.get_file_path(&filename), &filename).await
}

/// Serve avatar images
///
/// GET /storage/avatars/:filename
async fn serve_avatar(
    State(state): State<StorageState>,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    serve_static_file(&state.storage.get_avatar_path(&filename), &filename).await
}

/// Serve slip images
///
/// GET /storage/slips/:filename
async fn serve_slip(
    State(state): State<StorageState>,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    serve_static_file(&state.storage.get_slip_path(&filename), &filename).await
}

/// Helper function to serve static files
async fn serve_static_file(path: &std::path::Path, filename: &str) -> Result<Response, AppError> {
    // Check if file exists
    let file = File::open(path)
        .await
        .map_err(|_| AppError::NotFound(format!("File not found: {}", filename)))?;

    // Get file metadata for content-length
    let metadata = file.metadata().await.map_err(|e| {
        error!("Failed to get file metadata: {}", e);
        AppError::Internal("Failed to read file metadata".to_string())
    })?;

    // Determine content type from extension
    let content_type = get_content_type(filename);

    // Create a stream from the file
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    // Build response
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(header::CACHE_CONTROL, "public, max-age=31536000") // Cache for 1 year
        .body(body)
        .map_err(|e| {
            error!("Failed to build response: {}", e);
            AppError::Internal("Failed to build response".to_string())
        })?;

    Ok(response)
}

/// Get content type based on file extension
fn get_content_type(filename: &str) -> &'static str {
    let extension = filename.rsplit('.').next().unwrap_or("").to_lowercase();

    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "txt" => "text/plain",
        "html" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        _ => "application/octet-stream",
    }
}

/// Get storage statistics (admin only)
///
/// GET /storage/stats
async fn get_storage_stats(State(state): State<StorageState>) -> AppResult<Json<StorageReport>> {
    let report = state.storage.get_storage_report().await?;
    Ok(Json(report))
}

/// Trigger manual backup (admin only)
///
/// POST /storage/backup
async fn trigger_backup(State(state): State<StorageState>) -> AppResult<Json<BackupResponse>> {
    info!("Manual backup triggered");

    // Clone the storage service for the background task
    let storage = state.storage.clone();

    // Spawn backup in background
    tokio::spawn(async move {
        match storage.backup_avatars().await {
            Ok(count) => {
                info!("Backup completed: {} files backed up", count);
            },
            Err(e) => {
                error!("Backup failed: {}", e);
            },
        }
    });

    Ok(Json(BackupResponse {
        message: "Backup started successfully".to_string(),
        files_backed_up: None,
    }))
}

/// Delete a file
///
/// DELETE /storage/files/:filename
async fn delete_file(
    State(state): State<StorageState>,
    Path(filename): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    state.storage.delete_file(&filename).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "File deleted successfully"
    })))
}

/// Create storage routes
///
/// These routes are nested under /api/storage in the main router
pub fn routes() -> Router<StorageState> {
    // Public routes - file serving and uploads
    let public_routes = Router::new()
        .route("/upload", post(upload_file))
        .route("/avatar", post(upload_avatar))
        .route("/slip", post(upload_slip))
        .route("/files/:filename", get(serve_file))
        .route("/avatars/:filename", get(serve_avatar))
        .route("/slips/:filename", get(serve_slip));

    // Admin routes - require authentication + admin role
    let admin_routes = Router::new()
        .route("/stats", get(get_storage_stats))
        .route("/backup", post(trigger_backup))
        .route("/files/:filename", axum::routing::delete(delete_file))
        .layer(middleware::from_fn(|req, next| {
            require_role(req, next, "admin")
        }))
        .layer(middleware::from_fn(auth_middleware));

    public_routes.merge(admin_routes)
}

/// Create storage routes with state
pub fn routes_with_state(state: StorageState) -> Router {
    routes().with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_content_type() {
        assert_eq!(get_content_type("image.jpg"), "image/jpeg");
        assert_eq!(get_content_type("image.jpeg"), "image/jpeg");
        assert_eq!(get_content_type("image.png"), "image/png");
        assert_eq!(get_content_type("image.gif"), "image/gif");
        assert_eq!(get_content_type("image.webp"), "image/webp");
        assert_eq!(get_content_type("document.pdf"), "application/pdf");
        assert_eq!(get_content_type("data.json"), "application/json");
        assert_eq!(get_content_type("unknown.xyz"), "application/octet-stream");
    }

    #[test]
    fn test_storage_state_new() {
        let service = StorageService::new();
        let state = StorageState::new(service);
        assert!(Arc::strong_count(&state.storage) == 1);
    }
}
