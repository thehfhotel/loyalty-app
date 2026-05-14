//! Slips routes
//!
//! Provides endpoints for payment slip image upload.
//!
//! ## Endpoints
//!
//! - `POST /upload` - Upload a payment slip image (authenticated)

use axum::{
    extract::{DefaultBodyLimit, Extension, Multipart, State},
    middleware,
    routing::post,
    Json, Router,
};
use bytes::{Bytes, BytesMut};
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

/// MED-4 (security-2026-05-13.md): verify the file's first bytes match
/// the declared MIME type.
///
/// The multipart `content_type` header is set by the client and can lie.
/// Without this check, an HTML file labelled `image/jpeg` would land at
/// `/storage/slips/<uuid>.jpg` and be served back with
/// `Content-Type: image/jpeg`. Direct XSS is blocked today by
/// `X-Content-Type-Options: nosniff`, but the polyglot remains an
/// HTML-smuggling / phishing primitive against anyone who downloads the
/// file. Cheaper to reject the upload outright than rely on a single
/// browser header forever.
///
/// We hand-check the two image magic-byte sequences we accept; pulling
/// in the `infer` crate would be a larger surface for a two-signature
/// problem.
fn matches_image_magic_bytes(declared_mime: &str, data: &[u8]) -> bool {
    match declared_mime.to_lowercase().as_str() {
        // JPEG: starts with FF D8 FF
        "image/jpeg" | "image/jpg" => data.starts_with(&[0xFF, 0xD8, 0xFF]),
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        "image/png" => data.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        _ => false,
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
    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        AppError::BadRequest(format!("Failed to read multipart data: {}", e))
    })? {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "slip" || field_name == "file" {
            content_type = field.content_type().map(|s| s.to_string());

            // MED-3 (security-2026-05-13.md): stream the multipart field
            // chunk-by-chunk so we can bail as soon as cumulative bytes
            // exceed `max_slip_file_size`. The prior implementation
            // called `field.bytes().await`, which buffers the entire
            // field into RAM *before* any size check fires — letting an
            // attacker pin 10–16 MiB per concurrent upload before the
            // handler-local guard runs. Combined with the per-route
            // `DefaultBodyLimit` layer below, this gives belt-and-braces:
            // axum rejects oversize requests at the body-extraction
            // layer (HTTP 413 before the handler runs), and this loop
            // bails even if a future refactor removes the layer.
            let mut accumulated = BytesMut::new();
            loop {
                match field.chunk().await {
                    Ok(Some(chunk)) => {
                        if accumulated.len().saturating_add(chunk.len()) > config.max_slip_file_size
                        {
                            return Err(AppError::PayloadTooLarge);
                        }
                        accumulated.extend_from_slice(&chunk);
                    },
                    Ok(None) => break,
                    Err(e) => {
                        error!("Failed to read slip chunk: {}", e);
                        return Err(AppError::BadRequest(format!(
                            "Failed to read slip data: {}",
                            e
                        )));
                    },
                }
            }

            file_data = Some(accumulated.freeze());
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

    // MED-4: magic-byte sanity check. The multipart Content-Type header
    // is client-controlled — without this, an HTML file labelled as a
    // JPEG would be stored and served back as an image. Reject anything
    // whose first bytes don't match the declared MIME.
    if !matches_image_magic_bytes(&mime_type, &data) {
        return Err(AppError::BadRequest(
            "File contents do not match the declared image type (JPEG/PNG magic bytes missing)"
                .to_string(),
        ));
    }

    // Validate file size. The streaming loop above already bails as
    // soon as cumulative bytes exceed `max_slip_file_size`, and the
    // per-route body limit rejects oversize requests at the axum
    // body-extraction layer — this final check is a belt-and-braces
    // safeguard in case the streaming loop is ever refactored away.
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

/// Per-route body size cap for slip uploads.
///
/// MED-3 (security-2026-05-13.md): without this, the global
/// `DefaultBodyLimit::max(16 MiB)` in `main.rs` would let an attacker
/// pin 16 MiB per concurrent upload before the handler-local 10 MiB
/// check fires inside `upload_slip`. Applying a per-route limit makes
/// axum reject the request at the body-extraction layer (HTTP 413
/// before `field.bytes().await` ever buffers a full multipart field).
///
/// Kept in sync with `SlipStorageConfig::max_slip_file_size` so the
/// handler-side check stays as a belt-and-braces safeguard.
const SLIP_UPLOAD_BODY_LIMIT_BYTES: usize = 10 * 1024 * 1024;

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
        // Per-route body cap. Layered before the auth middleware so we
        // reject oversize bodies cheaply, without spending any work on
        // JWT validation for requests that wouldn't be accepted anyway.
        .layer(DefaultBodyLimit::max(SLIP_UPLOAD_BODY_LIMIT_BYTES))
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

    // ------------------------------------------------------------------
    // MED-4 magic-byte check regression guards.
    // ------------------------------------------------------------------

    #[test]
    fn matches_jpeg_magic_bytes_accepts_real_jpeg() {
        // Minimum bytes of a real JPEG SOI marker + first segment header.
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        assert!(matches_image_magic_bytes("image/jpeg", &jpeg));
        assert!(matches_image_magic_bytes("image/jpg", &jpeg));
        assert!(matches_image_magic_bytes("IMAGE/JPEG", &jpeg));
    }

    #[test]
    fn matches_png_magic_bytes_accepts_real_png() {
        // Standard PNG signature.
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
        assert!(matches_image_magic_bytes("image/png", &png));
    }

    #[test]
    fn matches_image_magic_bytes_rejects_html_labelled_as_jpeg() {
        // The smuggled-HTML case the audit calls out: a `<html>` doc
        // labelled `image/jpeg`. Magic bytes start with `<` (0x3C), not
        // 0xFF 0xD8 0xFF, so the check must reject it.
        let html = b"<html><body>polyglot</body></html>";
        assert!(!matches_image_magic_bytes("image/jpeg", html));
        assert!(!matches_image_magic_bytes("image/png", html));
    }

    #[test]
    fn matches_image_magic_bytes_rejects_truncated_inputs() {
        // Two bytes is not enough for a JPEG SOI marker (needs three);
        // it must NOT be accepted just because the first two match.
        let half = [0xFF, 0xD8];
        assert!(!matches_image_magic_bytes("image/jpeg", &half));

        // Empty.
        assert!(!matches_image_magic_bytes("image/png", &[]));
    }

    #[test]
    fn matches_image_magic_bytes_rejects_unknown_declared_mime() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        // Even with valid PNG bytes, if the declared MIME isn't an
        // accepted one we don't validate it — the upstream MIME
        // allowlist check will reject the upload first.
        assert!(!matches_image_magic_bytes("image/gif", &png));
        assert!(!matches_image_magic_bytes("application/pdf", &png));
    }
}
