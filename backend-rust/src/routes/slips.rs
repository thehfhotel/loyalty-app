//! Slips routes
//!
//! Provides endpoints for payment slip image upload.
//!
//! ## Endpoints
//!
//! - `POST /upload` - Upload a payment slip image (authenticated)

use axum::{
    extract::{Extension, Multipart, State},
    middleware,
    routing::post,
    Json, Router,
};
use bytes::Bytes;
use serde::Serialize;
use std::path::PathBuf;
use tokio::fs;
use tracing::{error, info};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::{auth_middleware, AuthUser};
use crate::state::AppState;

// ============================================================================
// Configuration
// ============================================================================

/// Storage configuration for slips
struct SlipStorageConfig {
    base_dir: PathBuf,
    slips_dir: String,
    max_slip_file_size: usize,
}

impl Default for SlipStorageConfig {
    fn default() -> Self {
        let base_dir = std::env::var("STORAGE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("storage")
            });

        Self {
            base_dir,
            slips_dir: "slips".to_string(),
            max_slip_file_size: 10 * 1024 * 1024, // 10MB
        }
    }
}

impl SlipStorageConfig {
    fn get_slips_path(&self) -> PathBuf {
        self.base_dir.join(&self.slips_dir)
    }
}

// ============================================================================
// Response Types
// ============================================================================

/// Response for successful slip upload
#[derive(Debug, Serialize)]
pub struct SlipUploadResponse {
    pub url: String,
}

/// Response for upload errors
#[derive(Debug, Serialize)]
pub struct UploadErrorResponse {
    pub error: String,
}

// ============================================================================
// Allowed MIME Types
// ============================================================================

/// Check if the MIME type is allowed for slip uploads
fn is_allowed_mime_type(mime_type: &str) -> bool {
    matches!(
        mime_type.to_lowercase().as_str(),
        "image/jpeg" | "image/jpg" | "image/png"
    )
}

/// Get file extension from MIME type
fn get_extension_from_mime(mime_type: &str) -> &'static str {
    match mime_type.to_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => ".jpg",
        "image/png" => ".png",
        _ => ".bin",
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /slips/upload
/// Upload a payment slip image
///
/// Requires authentication via JWT.
/// Accepts multipart form data with a 'slip' field containing the image file.
/// Returns the URL where the uploaded slip can be accessed.
async fn upload_slip(
    State(_state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Result<Json<SlipUploadResponse>, AppError> {
    let config = SlipStorageConfig::default();

    let mut file_data: Option<Bytes> = None;
    let mut content_type: Option<String> = None;

    // Extract file from multipart form
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

    // Validate file was uploaded
    let data = file_data.ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;

    // Validate content type
    let mime_type =
        content_type.ok_or_else(|| AppError::BadRequest("Content type is required".to_string()))?;

    if !is_allowed_mime_type(&mime_type) {
        return Err(AppError::BadRequest(
            "Invalid file type. Only JPEG and PNG images are allowed.".to_string(),
        ));
    }

    // Validate file size
    if data.len() > config.max_slip_file_size {
        return Err(AppError::PayloadTooLarge);
    }

    info!(
        "Processing slip upload: {} bytes, {}",
        data.len(),
        mime_type
    );

    // Ensure slips directory exists
    let slips_path = config.get_slips_path();
    fs::create_dir_all(&slips_path).await.map_err(|e| {
        error!("Failed to create slips directory: {}", e);
        AppError::Internal("Failed to create storage directory".to_string())
    })?;

    // Generate unique filename
    let extension = get_extension_from_mime(&mime_type);
    let filename = format!("{}{}", Uuid::new_v4(), extension);
    let file_path = slips_path.join(&filename);

    // Save file to disk
    fs::write(&file_path, &data).await.map_err(|e| {
        error!("Failed to write slip file: {}", e);
        AppError::Internal("Failed to save file".to_string())
    })?;

    info!("Slip upload completed: {}", filename);

    // Return URL path (relative to storage)
    let url = format!("/storage/slips/{}", filename);

    Ok(Json(SlipUploadResponse { url }))
}

// ============================================================================
// Router
// ============================================================================

/// Create slips routes
///
/// These routes are intended to be nested under /api/slips via the main router.
/// All routes require authentication.
///
/// ## Endpoints
///
/// - `POST /upload` - Upload a payment slip image (authenticated)
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/upload", post(upload_slip))
        .layer(middleware::from_fn(auth_middleware))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_allowed_mime_type() {
        assert!(is_allowed_mime_type("image/jpeg"));
        assert!(is_allowed_mime_type("image/jpg"));
        assert!(is_allowed_mime_type("image/png"));
        assert!(is_allowed_mime_type("IMAGE/JPEG")); // Case insensitive
        assert!(!is_allowed_mime_type("image/gif"));
        assert!(!is_allowed_mime_type("image/webp"));
        assert!(!is_allowed_mime_type("application/pdf"));
        assert!(!is_allowed_mime_type("text/plain"));
    }

    #[test]
    fn test_get_extension_from_mime() {
        assert_eq!(get_extension_from_mime("image/jpeg"), ".jpg");
        assert_eq!(get_extension_from_mime("image/jpg"), ".jpg");
        assert_eq!(get_extension_from_mime("image/png"), ".png");
        assert_eq!(get_extension_from_mime("unknown/type"), ".bin");
    }

    #[test]
    fn test_slip_storage_config_default() {
        let config = SlipStorageConfig::default();
        assert_eq!(config.slips_dir, "slips");
        assert_eq!(config.max_slip_file_size, 10 * 1024 * 1024);
    }
}
