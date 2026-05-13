//! Storage routes
//!
//! Provides endpoints for file upload, avatar management, and file serving.
//!
//! Routes (all nested under /api/storage):
//! - POST /api/storage/upload - General file upload (authenticated)
//! - POST /api/storage/avatar - Avatar upload (authenticated; user derived from JWT)
//! - POST /api/storage/slip - Slip upload (authenticated)
//! - GET /api/storage/files/:filename - Serve uploaded files (public)
//! - GET /api/storage/avatars/:filename - Serve avatar images (public)
//! - GET /api/storage/slips/:filename - Serve slip images (public)
//! - GET /api/storage/stats - Get storage statistics (admin only)
//! - POST /api/storage/backup - Trigger manual backup (admin only)
//! - DELETE /api/storage/files/:filename - Delete a file (admin only)

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    middleware,
    response::Response,
    routing::{get, post},
    Extension, Json, Router,
};
use bytes::Bytes;
use redis::AsyncCommands;
use serde::Serialize;
use std::sync::Arc;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{auth_middleware, has_role, require_role, AuthUser};
use crate::services::storage::{StorageReport, StorageService};
use crate::state::AppState;

/// State for storage routes
///
/// MED-6 (security-2026-05-13.md): `serve_slip` needs to look up the
/// slip → booking → owner to authorize access. `StorageState` now
/// carries an optional `AppState` so the slip-serving handler has
/// access to DB and Redis without forcing other storage handlers
/// (avatars, general files) to take on a new dep. When `app_state` is
/// `None` (legacy test wiring), slip authorization conservatively
/// denies the request.
#[derive(Clone)]
pub struct StorageState {
    pub storage: Arc<StorageService>,
    pub app_state: Option<AppState>,
}

impl StorageState {
    pub fn new(storage: StorageService) -> Self {
        Self {
            storage: Arc::new(storage),
            app_state: None,
        }
    }

    /// Attach an `AppState` so the slip-serving handler can authorize
    /// against the booking ownership table. Used by `create_router`;
    /// optional so tests that only exercise the file-serving paths
    /// can still build a `StorageState` without an attached AppState.
    pub fn with_app_state(mut self, app_state: AppState) -> Self {
        self.app_state = Some(app_state);
        self
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

/// General file upload handler
///
/// POST /storage/upload
/// Content-Type: multipart/form-data
/// Authentication: required (Bearer token)
///
/// Form fields:
/// - file: The file to upload
async fn upload_file(
    State(state): State<StorageState>,
    Extension(auth_user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> AppResult<Json<UploadResponse>> {
    debug!(user_id = %auth_user.id, "upload_file invoked");
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
/// Authentication: required (Bearer token). The avatar is always saved
/// against the authenticated user's ID — clients cannot specify a target
/// user. (Previously the endpoint trusted a `user_id` form field, which
/// allowed unauthenticated overwrite of any user's avatar.)
///
/// Form fields:
/// - avatar (or file): The avatar image file
async fn upload_avatar(
    State(state): State<StorageState>,
    Extension(auth_user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> AppResult<Json<AvatarUploadResponse>> {
    let mut file_data: Option<Bytes> = None;
    let mut content_type: Option<String> = None;

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
            _ => {
                debug!("Ignoring unknown field: {}", field_name);
            },
        }
    }

    let data = file_data.ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;
    let uid = auth_user.id.clone();
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
/// Authentication: required (Bearer token)
///
/// Form fields:
/// - slip (or file): The slip image file
async fn upload_slip(
    State(state): State<StorageState>,
    Extension(auth_user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> AppResult<Json<SlipUploadResponse>> {
    debug!(user_id = %auth_user.id, "upload_slip invoked");
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
///
/// MED-6 (security-2026-05-13.md): slip files contain banking info
/// (account number, name, amount, transaction ID). The URLs were
/// historically public — anyone with the UUID could fetch the slip
/// forever (Cache-Control: public, max-age=31536000). URLs leak via
/// logs, referrer headers, browser history, and screen-shares.
///
/// Now requires authentication via the `auth_middleware` layer and
/// authorizes inside the handler: the caller must be either the
/// booking owner or an admin. Avatars stay public — they're less
/// sensitive and used as profile pictures.
async fn serve_slip(
    State(state): State<StorageState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    // Authorization needs DB lookup — bail if AppState wasn't attached
    // at router-build time. This is a routing/test misconfiguration,
    // not user input, so 500 is the right answer.
    let app_state = state.app_state.as_ref().ok_or_else(|| {
        error!("serve_slip reached without AppState attached — routing bug");
        AppError::Internal("Storage authorization unavailable".to_string())
    })?;

    // Admin bypass — any admin (regular or super) can fetch any slip
    // for moderation, refund / chargeback investigation, etc.
    if has_role(&auth_user, "admin") {
        return serve_static_file(&state.storage.get_slip_path(&filename), &filename).await;
    }

    // Non-admin: the caller must own the booking the slip is attached
    // to. We treat "slip file not referenced by any booking" as 404
    // rather than 403 to avoid leaking which UUIDs exist on disk to
    // callers who shouldn't even know about them. Caching the
    // slip→booking→owner lookup in Redis with a short TTL keeps the
    // hot path fast.
    let caller_id = Uuid::parse_str(&auth_user.id)
        .map_err(|_| AppError::InvalidToken("Invalid user ID in token".to_string()))?;
    let slip_url = format!("/storage/slips/{}", filename);

    let owner_id = lookup_slip_owner(app_state, &slip_url).await?;

    if owner_id != caller_id {
        debug!(
            slip = %filename,
            caller = %caller_id,
            "Slip access denied — caller is not the booking owner"
        );
        return Err(AppError::Forbidden(
            "You do not have permission to view this slip".to_string(),
        ));
    }

    serve_static_file(&state.storage.get_slip_path(&filename), &filename).await
}

/// Resolve a slip URL to the user ID that owns the booking it's
/// attached to.
///
/// Cached in Redis under `slip_owner:{url}` with a 5-minute TTL so the
/// hot path doesn't hit Postgres on every fetch. The mapping is
/// immutable for the life of the slip row (slips don't get reassigned
/// to other bookings), so a short TTL is purely a stampede-protection
/// measure, not a correctness one.
///
/// Returns 404 if the slip URL isn't referenced by any booking_slips
/// row — the file may exist on disk (e.g. orphaned by a failed
/// booking) but the URL→booking→user chain is what authorizes access.
async fn lookup_slip_owner(state: &AppState, slip_url: &str) -> Result<Uuid, AppError> {
    let cache_key = format!("slip_owner:{}", slip_url);
    let mut conn = state.redis();

    // Cache hit fast path. Fail-open on Redis errors — a slow Redis
    // shouldn't prevent legitimate slip access.
    if let Ok(Some(cached)) = conn.get::<_, Option<String>>(&cache_key).await {
        if let Ok(id) = Uuid::parse_str(&cached) {
            return Ok(id);
        }
    }

    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT b.user_id
        FROM booking_slips bs
        JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.slip_url = $1
        LIMIT 1
        "#,
    )
    .bind(slip_url)
    .fetch_optional(state.db())
    .await?;

    let owner_id = row
        .map(|(uid,)| uid)
        .ok_or_else(|| AppError::NotFound(format!("Slip {}", slip_url)))?;

    // Best-effort cache write. SET EX is safe to skip on Redis error.
    let _ = conn
        .set_ex::<_, _, ()>(&cache_key, owner_id.to_string(), 300)
        .await;

    Ok(owner_id)
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
    // Avatars and general files stay public — they're not sensitive
    // (avatars surface as profile pictures, files are app assets) and
    // the UUID-as-secret model is the same model the SPA already
    // relies on.
    let public_get_routes = Router::new()
        .route("/files/:filename", get(serve_file))
        .route("/avatars/:filename", get(serve_avatar));

    // MED-6 (security-2026-05-13.md): slip files contain banking
    // info, so the URL alone is no longer enough — the caller must
    // also be the booking owner OR an admin. The auth_middleware
    // layer rejects unauthenticated requests with 401; the handler
    // does the per-slip authorization (looking up
    // booking_slips → bookings → users).
    let authenticated_slip_get = Router::new()
        .route("/slips/:filename", get(serve_slip))
        .layer(middleware::from_fn(auth_middleware));

    // POST upload routes require authentication. The avatar route always
    // saves to the authenticated user's slot — clients CANNOT specify a
    // target user via the multipart body. Without this gate, any caller
    // could overwrite any user's avatar (or fill the disk).
    let authenticated_upload_routes = Router::new()
        .route("/upload", post(upload_file))
        .route("/avatar", post(upload_avatar))
        .route("/slip", post(upload_slip))
        .layer(middleware::from_fn(auth_middleware));

    // Admin routes - require authentication + admin role
    let admin_routes = Router::new()
        .route("/stats", get(get_storage_stats))
        .route("/backup", post(trigger_backup))
        .route("/files/:filename", axum::routing::delete(delete_file))
        .layer(middleware::from_fn(|req, next| {
            require_role(req, next, "admin")
        }))
        .layer(middleware::from_fn(auth_middleware));

    public_get_routes
        .merge(authenticated_slip_get)
        .merge(authenticated_upload_routes)
        .merge(admin_routes)
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
