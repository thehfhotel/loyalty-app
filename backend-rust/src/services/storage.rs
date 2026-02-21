//! Storage service module
//!
//! Provides file storage functionality including:
//! - General file upload and retrieval
//! - Avatar upload with processing
//! - File deletion and management
//! - Storage statistics
//!
//! Configuration via environment variables:
//! - UPLOAD_DIR: Base directory for uploads (default: ./uploads)
//! - MAX_FILE_SIZE: Maximum file size in bytes (default: 5MB)

use bytes::Bytes;
use image::ImageReader;
use std::env;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Default upload directory
const DEFAULT_UPLOAD_DIR: &str = "./uploads";

/// Default maximum file size (5MB)
const DEFAULT_MAX_FILE_SIZE: usize = 5 * 1024 * 1024;

/// Storage configuration
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// Base directory for file uploads
    pub upload_dir: PathBuf,
    /// Directory for avatar images
    pub avatars_dir: PathBuf,
    /// Directory for slip uploads
    pub slips_dir: PathBuf,
    /// Backup directory
    pub backup_dir: PathBuf,
    /// Maximum file size in bytes (default: 5MB)
    pub max_file_size: usize,
    /// Maximum avatar file size in bytes (default: 15MB for processing)
    pub max_avatar_size: usize,
    /// Maximum slip file size in bytes (default: 10MB)
    pub max_slip_size: usize,
    /// Maximum total storage size in bytes (default: 10GB)
    pub max_storage_size: u64,
    /// Avatar size in pixels (width and height)
    pub avatar_size: u32,
}

impl Default for StorageConfig {
    fn default() -> Self {
        // Support both UPLOAD_DIR and STORAGE_PATH for backwards compatibility
        let base_dir = env::var("UPLOAD_DIR")
            .or_else(|_| env::var("STORAGE_PATH"))
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_UPLOAD_DIR));

        let backup_dir = env::var("BACKUP_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| base_dir.join("backup"));

        Self {
            upload_dir: base_dir.clone(),
            avatars_dir: base_dir.join("avatars"),
            slips_dir: base_dir.join("slips"),
            backup_dir,
            max_file_size: env::var("MAX_FILE_SIZE")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_MAX_FILE_SIZE),
            max_avatar_size: 15 * 1024 * 1024, // 15MB for avatar processing
            max_slip_size: 10 * 1024 * 1024,   // 10MB for slips
            max_storage_size: 10 * 1024 * 1024 * 1024, // 10GB total
            avatar_size: 400,                  // 400x400 pixels (2x for retina)
        }
    }
}

impl StorageConfig {
    /// Create a new StorageConfig with custom upload directory
    pub fn new(upload_dir: impl Into<PathBuf>) -> Self {
        let base_dir = upload_dir.into();
        Self {
            avatars_dir: base_dir.join("avatars"),
            slips_dir: base_dir.join("slips"),
            backup_dir: base_dir.join("backup"),
            upload_dir: base_dir,
            ..Default::default()
        }
    }

    /// Create a new StorageConfig with custom upload directory and max file size
    pub fn with_max_size(upload_dir: impl Into<PathBuf>, max_file_size: usize) -> Self {
        let mut config = Self::new(upload_dir);
        config.max_file_size = max_file_size;
        config
    }

    /// Create a StorageConfig from environment variables
    pub fn from_env() -> Self {
        Self::default()
    }
}

/// Allowed MIME types for uploads
pub struct AllowedMimeTypes;

impl AllowedMimeTypes {
    /// General file MIME types allowed for uploads
    /// Includes: image/jpeg, image/png, image/gif, application/pdf
    pub const ALLOWED_TYPES: &'static [&'static str] = &[
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "application/pdf",
    ];

    /// Image MIME types allowed for avatars
    pub const AVATAR_TYPES: &'static [&'static str] = &[
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
    ];

    /// Image MIME types allowed for slips
    pub const SLIP_TYPES: &'static [&'static str] = &["image/jpeg", "image/jpg", "image/png"];

    /// Check if a MIME type is allowed for general file uploads
    pub fn is_valid_type(mime_type: &str) -> bool {
        Self::ALLOWED_TYPES.contains(&mime_type.to_lowercase().as_str())
    }

    /// Check if a MIME type is allowed for avatars
    pub fn is_valid_avatar_type(mime_type: &str) -> bool {
        Self::AVATAR_TYPES.contains(&mime_type.to_lowercase().as_str())
    }

    /// Check if a MIME type is allowed for slips
    pub fn is_valid_slip_type(mime_type: &str) -> bool {
        Self::SLIP_TYPES.contains(&mime_type.to_lowercase().as_str())
    }

    /// Get the file extension for a MIME type
    pub fn get_extension(mime_type: &str) -> Option<&'static str> {
        match mime_type.to_lowercase().as_str() {
            "image/jpeg" | "image/jpg" => Some("jpg"),
            "image/png" => Some("png"),
            "image/gif" => Some("gif"),
            "image/webp" => Some("webp"),
            "application/pdf" => Some("pdf"),
            _ => None,
        }
    }
}

/// Storage statistics
#[derive(Debug, Clone, serde::Serialize)]
pub struct StorageStats {
    /// Total number of files
    pub total_files: u64,
    /// Total size of all files in bytes
    pub total_size: u64,
    /// Average file size in bytes
    pub average_size: u64,
}

/// Storage report including usage information
#[derive(Debug, Clone, serde::Serialize)]
pub struct StorageReport {
    pub storage: StorageReportData,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StorageReportData {
    pub total_files: u64,
    pub total_size: u64,
    pub average_size: u64,
    pub usage_percent: f64,
}

/// Storage service providing file management functionality
#[derive(Clone)]
pub struct StorageService {
    config: StorageConfig,
}

impl StorageService {
    /// Create a new StorageService with default configuration
    pub fn new() -> Self {
        Self {
            config: StorageConfig::default(),
        }
    }

    /// Create a new StorageService with custom configuration
    pub fn with_config(config: StorageConfig) -> Self {
        Self { config }
    }

    /// Initialize storage directories
    pub async fn initialize(&self) -> AppResult<()> {
        let directories = [
            &self.config.upload_dir,
            &self.config.avatars_dir,
            &self.config.slips_dir,
            &self.config.backup_dir,
        ];

        for dir in directories {
            if let Err(e) = fs::create_dir_all(dir).await {
                warn!("Could not create storage directory {:?}: {}", dir, e);
            } else {
                info!("Storage directory exists or created: {:?}", dir);
            }
        }

        // Set permissions on Unix-like systems
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in directories {
                if let Ok(metadata) = fs::metadata(dir).await {
                    let mut perms = metadata.permissions();
                    perms.set_mode(0o755);
                    if let Err(e) = fs::set_permissions(dir, perms).await {
                        warn!("Could not set permissions for {:?}: {}", dir, e);
                    }
                }
            }
        }

        info!("Storage service initialized");
        Ok(())
    }

    /// Get the configuration
    pub fn config(&self) -> &StorageConfig {
        &self.config
    }

    /// Save a file to the upload directory
    ///
    /// # Arguments
    /// * `data` - The file data as bytes
    /// * `filename` - The original filename
    /// * `content_type` - The MIME type of the file
    ///
    /// # Returns
    /// The unique filename assigned to the stored file
    pub async fn save_file(
        &self,
        data: Bytes,
        filename: &str,
        content_type: &str,
    ) -> AppResult<String> {
        // Validate content type
        if !AllowedMimeTypes::is_valid_type(content_type) {
            return Err(AppError::UnsupportedMediaType(format!(
                "Unsupported content type: {}. Allowed types: {}",
                content_type,
                AllowedMimeTypes::ALLOWED_TYPES.join(", ")
            )));
        }

        // Validate file size
        if data.len() > self.config.max_file_size {
            return Err(AppError::PayloadTooLarge);
        }

        // Get file extension
        let extension = AllowedMimeTypes::get_extension(content_type).ok_or_else(|| {
            AppError::UnsupportedMediaType(format!("Unsupported content type: {}", content_type))
        })?;

        // Generate unique filename
        let safe_filename = sanitize_filename(filename);
        let unique_filename = format!("{}_{}.{}", Uuid::new_v4(), safe_filename, extension);

        // Ensure directory exists
        fs::create_dir_all(&self.config.upload_dir)
            .await
            .map_err(|e| {
                error!("Failed to create upload directory: {}", e);
                AppError::Internal(format!("Failed to create upload directory: {}", e))
            })?;

        // Build the file path
        let file_path = self.config.upload_dir.join(&unique_filename);

        // Write file
        let mut file = fs::File::create(&file_path).await.map_err(|e| {
            error!("Failed to create file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to create file: {}", e))
        })?;

        file.write_all(&data).await.map_err(|e| {
            error!("Failed to write file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to write file: {}", e))
        })?;

        file.flush().await.map_err(|e| {
            error!("Failed to flush file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to flush file: {}", e))
        })?;

        info!("File saved: {}", unique_filename);
        Ok(format!("/storage/files/{}", unique_filename))
    }

    /// Save an avatar image for a user
    ///
    /// Accepts any image format supported by the `image` crate (JPEG, PNG, GIF,
    /// WebP, BMP, TIFF, ICO, etc.). The image is decoded, resized to fit within
    /// the configured avatar_size, and re-encoded as JPEG for consistency.
    ///
    /// # Arguments
    /// * `user_id` - The user's ID (as string)
    /// * `data` - The image data as bytes
    /// * `_content_type` - The MIME type (used for logging only; actual format is detected from bytes)
    ///
    /// # Returns
    /// The relative path to the saved avatar (always .jpg)
    pub async fn save_avatar(
        &self,
        user_id: &str,
        data: Bytes,
        _content_type: &str,
    ) -> AppResult<String> {
        // Validate file size
        if data.len() > self.config.max_avatar_size {
            let max_mb = self.config.max_avatar_size / (1024 * 1024);
            return Err(AppError::BadRequest(format!(
                "File size too large. Maximum size is {}MB",
                max_mb
            )));
        }

        // Process image: decode, resize, convert to JPEG
        let processed = process_avatar_image(&data, self.config.avatar_size)?;

        // Delete old avatar if exists
        self.delete_user_avatar(user_id).await?;

        // Always save as JPEG after processing
        let filename = format!("avatar_{}_{}.jpg", user_id, Uuid::new_v4());

        // Ensure avatars directory exists
        fs::create_dir_all(&self.config.avatars_dir)
            .await
            .map_err(|e| {
                error!("Failed to create avatars directory: {}", e);
                AppError::Internal(format!("Failed to create avatars directory: {}", e))
            })?;

        // Build the file path
        let file_path = self.config.avatars_dir.join(&filename);

        // Write processed file
        let mut file = fs::File::create(&file_path).await.map_err(|e| {
            error!("Failed to create avatar file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to create avatar file: {}", e))
        })?;

        file.write_all(&processed).await.map_err(|e| {
            error!("Failed to write avatar file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to write avatar file: {}", e))
        })?;

        file.flush().await.map_err(|e| {
            error!("Failed to flush avatar file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to flush avatar file: {}", e))
        })?;

        // Return the relative path from upload_dir
        let relative_path = format!("avatars/{}", filename);

        info!(
            "Avatar saved for user {}: {} (original: {} bytes, processed: {} bytes)",
            user_id,
            relative_path,
            data.len(),
            processed.len(),
        );
        Ok(relative_path)
    }

    /// Save a payment slip image
    ///
    /// # Arguments
    /// * `data` - The image data as bytes
    /// * `content_type` - The MIME type of the image
    ///
    /// # Returns
    /// The URL path to the saved slip
    pub async fn save_slip(&self, data: Bytes, content_type: &str) -> AppResult<String> {
        // Validate content type
        if !AllowedMimeTypes::is_valid_slip_type(content_type) {
            return Err(AppError::UnsupportedMediaType(
                "Only jpeg and png files are allowed for slips".to_string(),
            ));
        }

        // Validate file size
        if data.len() > self.config.max_slip_size {
            let max_mb = self.config.max_slip_size / (1024 * 1024);
            return Err(AppError::BadRequest(format!(
                "File size too large. Maximum size is {}MB",
                max_mb
            )));
        }

        // Generate unique filename
        let extension = AllowedMimeTypes::get_extension(content_type).unwrap_or("jpg");
        let filename = format!("{}.{}", Uuid::new_v4(), extension);

        // Ensure slips directory exists
        fs::create_dir_all(&self.config.slips_dir)
            .await
            .map_err(|e| {
                error!("Failed to create slips directory: {}", e);
                AppError::Internal(format!("Failed to create slips directory: {}", e))
            })?;

        // Build the file path
        let file_path = self.config.slips_dir.join(&filename);

        // Write file
        let mut file = fs::File::create(&file_path).await.map_err(|e| {
            error!("Failed to create slip file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to create slip file: {}", e))
        })?;

        file.write_all(&data).await.map_err(|e| {
            error!("Failed to write slip file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to write slip file: {}", e))
        })?;

        file.flush().await.map_err(|e| {
            error!("Failed to flush slip file {:?}: {}", file_path, e);
            AppError::Internal(format!("Failed to flush slip file: {}", e))
        })?;

        info!("Slip saved: {}", filename);
        Ok(format!("/storage/slips/{}", filename))
    }

    /// Get the full file path for a filename in the uploads directory
    pub fn get_file_path(&self, filename: &str) -> PathBuf {
        let safe_filename = sanitize_filename(filename);
        self.config.upload_dir.join(safe_filename)
    }

    /// Get the full file path for an avatar
    pub fn get_avatar_path(&self, filename: &str) -> PathBuf {
        let safe_filename = sanitize_filename(filename);
        self.config.avatars_dir.join(safe_filename)
    }

    /// Get the full file path for a slip
    pub fn get_slip_path(&self, filename: &str) -> PathBuf {
        let safe_filename = sanitize_filename(filename);
        self.config.slips_dir.join(safe_filename)
    }

    /// Check if a file exists in the uploads directory (synchronous)
    ///
    /// # Arguments
    /// * `filename` - Name of the file
    ///
    /// # Returns
    /// true if the file exists, false otherwise
    pub fn file_exists(&self, filename: &str) -> bool {
        let path = self.get_file_path(filename);
        path.exists()
    }

    /// Check if a file exists in the uploads directory (async version)
    pub async fn file_exists_async(&self, filename: &str) -> bool {
        let path = self.get_file_path(filename);
        fs::metadata(&path).await.is_ok()
    }

    /// Check if an avatar file exists
    pub async fn avatar_exists(&self, filename: &str) -> bool {
        let path = self.get_avatar_path(filename);
        fs::metadata(&path).await.is_ok()
    }

    /// Check if a slip file exists
    pub async fn slip_exists(&self, filename: &str) -> bool {
        let path = self.get_slip_path(filename);
        fs::metadata(&path).await.is_ok()
    }

    /// Delete a file from the uploads directory
    pub async fn delete_file(&self, filename: &str) -> AppResult<()> {
        let path = self.get_file_path(filename);

        if fs::metadata(&path).await.is_ok() {
            fs::remove_file(&path).await.map_err(|e| {
                error!("Failed to delete file {:?}: {}", path, e);
                AppError::Internal(format!("Failed to delete file: {}", e))
            })?;
            info!("Deleted file: {}", filename);
        } else {
            debug!("File not found for deletion: {}", filename);
        }

        Ok(())
    }

    /// Delete a user's avatar
    ///
    /// Tries common image extensions to find and delete the avatar
    pub async fn delete_user_avatar(&self, user_id: &str) -> AppResult<()> {
        let safe_user_id = sanitize_filename(user_id);
        let extensions = ["jpg", "jpeg", "png", "gif", "webp"];

        for ext in extensions {
            let filename = format!("{}_avatar.{}", safe_user_id, ext);
            let filepath = self.config.avatars_dir.join(&filename);

            if fs::metadata(&filepath).await.is_ok() {
                if let Err(e) = fs::remove_file(&filepath).await {
                    warn!("Failed to delete avatar {:?}: {}", filepath, e);
                } else {
                    info!("Deleted old avatar for user {}: {}", safe_user_id, filename);
                    break;
                }
            }
        }

        Ok(())
    }

    /// Delete an avatar by its path
    pub async fn delete_avatar(&self, avatar_path: &str) -> AppResult<()> {
        if avatar_path.is_empty() {
            return Ok(());
        }

        // Extract filename from path
        let filename = Path::new(avatar_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(avatar_path);

        let safe_filename = sanitize_filename(filename);
        let filepath = self.config.avatars_dir.join(&safe_filename);

        if fs::metadata(&filepath).await.is_ok() {
            fs::remove_file(&filepath).await.map_err(|e| {
                warn!("Error deleting avatar file {:?}: {}", filepath, e);
                AppError::Internal(format!("Failed to delete avatar: {}", e))
            })?;
            info!("Deleted avatar: {}", safe_filename);
        }

        Ok(())
    }

    /// Get storage statistics for the avatars directory
    pub async fn get_storage_stats(&self) -> AppResult<StorageStats> {
        let mut total_files = 0u64;
        let mut total_size = 0u64;

        match fs::read_dir(&self.config.avatars_dir).await {
            Ok(mut entries) => {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Ok(metadata) = entry.metadata().await {
                        if metadata.is_file() {
                            total_files += 1;
                            total_size += metadata.len();
                        }
                    }
                }
            },
            Err(e) => {
                error!("Error reading storage directory: {}", e);
                return Ok(StorageStats {
                    total_files: 0,
                    total_size: 0,
                    average_size: 0,
                });
            },
        }

        let average_size = if total_files > 0 {
            total_size / total_files
        } else {
            0
        };

        Ok(StorageStats {
            total_files,
            total_size,
            average_size,
        })
    }

    /// Get a full storage report including usage percentage
    pub async fn get_storage_report(&self) -> AppResult<StorageReport> {
        let stats = self.get_storage_stats().await?;

        let usage_percent = (stats.total_size as f64 / self.config.max_storage_size as f64) * 100.0;

        Ok(StorageReport {
            storage: StorageReportData {
                total_files: stats.total_files,
                total_size: stats.total_size,
                average_size: stats.average_size,
                usage_percent,
            },
        })
    }

    /// Perform a backup of all avatars
    pub async fn backup_avatars(&self) -> AppResult<u64> {
        // Create backup directory with timestamp
        let timestamp = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let backup_path = self.config.backup_dir.join(&timestamp);

        fs::create_dir_all(&backup_path).await.map_err(|e| {
            error!("Failed to create backup directory: {}", e);
            AppError::Internal(format!("Failed to create backup directory: {}", e))
        })?;

        let mut copied_count = 0u64;

        match fs::read_dir(&self.config.avatars_dir).await {
            Ok(mut entries) => {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let source_path = entry.path();
                    if let Some(filename) = source_path.file_name() {
                        let dest_path = backup_path.join(filename);

                        match fs::copy(&source_path, &dest_path).await {
                            Ok(_) => copied_count += 1,
                            Err(e) => {
                                warn!("Failed to backup {:?}: {}", source_path, e);
                            },
                        }
                    }
                }
            },
            Err(e) => {
                error!("Failed to read avatars directory for backup: {}", e);
            },
        }

        info!(
            "Backup completed: {} files backed up to {:?}",
            copied_count, backup_path
        );

        // Clean old backups (keep last 7 days)
        self.clean_old_backups().await;

        Ok(copied_count)
    }

    /// Clean backups older than 7 days
    async fn clean_old_backups(&self) {
        let cutoff_date = chrono::Utc::now() - chrono::Duration::days(7);

        match fs::read_dir(&self.config.backup_dir).await {
            Ok(mut entries) => {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Some(name) = entry.file_name().to_str() {
                        // Try to parse directory name as date
                        if let Ok(backup_date) = chrono::NaiveDate::parse_from_str(name, "%Y-%m-%d")
                        {
                            let backup_datetime = backup_date.and_hms_opt(0, 0, 0).map(|dt| {
                                chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
                                    dt,
                                    chrono::Utc,
                                )
                            });

                            if let Some(dt) = backup_datetime {
                                if dt < cutoff_date {
                                    let backup_path = entry.path();
                                    if let Err(e) = fs::remove_dir_all(&backup_path).await {
                                        warn!(
                                            "Failed to delete old backup {:?}: {}",
                                            backup_path, e
                                        );
                                    } else {
                                        info!("Deleted old backup: {}", name);
                                    }
                                }
                            }
                        }
                    }
                }
            },
            Err(e) => {
                warn!("Error cleaning old backups: {}", e);
            },
        }
    }
}

impl Default for StorageService {
    fn default() -> Self {
        Self::new()
    }
}

/// Process an avatar image: decode any supported format, resize, and convert to JPEG.
///
/// Supports JPEG, PNG, GIF, WebP, BMP, TIFF, ICO, and other formats supported by
/// the `image` crate. The image is resized to fit within `max_size x max_size` pixels
/// while maintaining aspect ratio, then encoded as JPEG at 90% quality.
fn process_avatar_image(data: &[u8], max_size: u32) -> AppResult<Vec<u8>> {
    // Decode the image (auto-detects format from bytes)
    let img = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| AppError::BadRequest(format!("Cannot read image: {}", e)))?
        .decode()
        .map_err(|e| {
            AppError::BadRequest(format!(
                "Unsupported or corrupted image format: {}. Supported formats: JPEG, PNG, GIF, WebP, BMP, TIFF, ICO",
                e
            ))
        })?;

    // Resize if larger than max_size (maintains aspect ratio)
    let resized = if img.width() > max_size || img.height() > max_size {
        img.thumbnail(max_size, max_size)
    } else {
        img
    };

    // Encode as JPEG with 90% quality
    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
    resized.write_with_encoder(encoder).map_err(|e| {
        error!("Failed to encode avatar as JPEG: {}", e);
        AppError::Internal(format!("Failed to encode image: {}", e))
    })?;

    Ok(buf)
}

/// Sanitize a filename to prevent path traversal attacks
fn sanitize_filename(filename: &str) -> String {
    // Extract just the filename without any path components
    let name = Path::new(filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(filename);

    // Remove any potentially dangerous characters
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("test.jpg"), "test.jpg");
        assert_eq!(sanitize_filename("../../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("test<script>.jpg"), "testscript.jpg");
        assert_eq!(sanitize_filename("my-file_123.png"), "my-file_123.png");
        assert_eq!(sanitize_filename("/absolute/path/file.jpg"), "file.jpg");
    }

    #[test]
    fn test_storage_config_default() {
        let config = StorageConfig::default();
        assert_eq!(config.max_file_size, DEFAULT_MAX_FILE_SIZE);
        assert_eq!(config.avatar_size, 400);
    }

    #[test]
    fn test_storage_config_with_max_size() {
        let config = StorageConfig::with_max_size("/tmp/uploads", 1024);
        assert_eq!(config.upload_dir, PathBuf::from("/tmp/uploads"));
        assert_eq!(config.max_file_size, 1024);
    }

    #[test]
    fn test_allowed_mime_types_general() {
        // General file upload types
        assert!(AllowedMimeTypes::is_valid_type("image/jpeg"));
        assert!(AllowedMimeTypes::is_valid_type("image/png"));
        assert!(AllowedMimeTypes::is_valid_type("image/gif"));
        assert!(AllowedMimeTypes::is_valid_type("application/pdf"));
        assert!(!AllowedMimeTypes::is_valid_type("text/plain"));
        assert!(!AllowedMimeTypes::is_valid_type("application/json"));
    }

    #[test]
    fn test_allowed_mime_types_avatar() {
        assert!(AllowedMimeTypes::is_valid_avatar_type("image/jpeg"));
        assert!(AllowedMimeTypes::is_valid_avatar_type("image/png"));
        assert!(AllowedMimeTypes::is_valid_avatar_type("image/gif"));
        assert!(AllowedMimeTypes::is_valid_avatar_type("image/webp"));
        assert!(!AllowedMimeTypes::is_valid_avatar_type("application/pdf"));
        assert!(!AllowedMimeTypes::is_valid_avatar_type("text/plain"));
    }

    #[test]
    fn test_slip_mime_types() {
        assert!(AllowedMimeTypes::is_valid_slip_type("image/jpeg"));
        assert!(AllowedMimeTypes::is_valid_slip_type("image/png"));
        assert!(!AllowedMimeTypes::is_valid_slip_type("image/gif"));
        assert!(!AllowedMimeTypes::is_valid_slip_type("image/webp"));
    }

    #[test]
    fn test_get_extension() {
        assert_eq!(AllowedMimeTypes::get_extension("image/jpeg"), Some("jpg"));
        assert_eq!(AllowedMimeTypes::get_extension("image/png"), Some("png"));
        assert_eq!(AllowedMimeTypes::get_extension("image/gif"), Some("gif"));
        assert_eq!(AllowedMimeTypes::get_extension("image/webp"), Some("webp"));
        assert_eq!(
            AllowedMimeTypes::get_extension("application/pdf"),
            Some("pdf")
        );
        assert_eq!(AllowedMimeTypes::get_extension("text/plain"), None);
    }

    #[tokio::test]
    async fn test_storage_service_new() {
        let service = StorageService::new();
        assert!(!service.config.upload_dir.as_os_str().is_empty());
    }

    #[test]
    fn test_storage_config_new() {
        let config = StorageConfig::new("/tmp/test-storage");
        assert_eq!(config.upload_dir, PathBuf::from("/tmp/test-storage"));
        assert_eq!(
            config.avatars_dir,
            PathBuf::from("/tmp/test-storage/avatars")
        );
    }

    #[tokio::test]
    async fn test_save_file() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        let data = Bytes::from("test file content");
        let result = service.save_file(data, "test.jpg", "image/jpeg").await;

        assert!(result.is_ok());
        let filename = result.unwrap();
        assert!(filename.contains(".jpg"));
    }

    #[tokio::test]
    async fn test_save_file_pdf() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        let data = Bytes::from("fake pdf content");
        let result = service
            .save_file(data, "document.pdf", "application/pdf")
            .await;

        assert!(result.is_ok());
        let filename = result.unwrap();
        assert!(filename.contains(".pdf"));
    }

    #[tokio::test]
    async fn test_save_file_invalid_content_type() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        let data = Bytes::from("test content");
        let result = service.save_file(data, "test.txt", "text/plain").await;

        assert!(result.is_err());
        if let Err(AppError::UnsupportedMediaType(_)) = result {
            // Expected
        } else {
            panic!("Expected UnsupportedMediaType error");
        }
    }

    #[tokio::test]
    async fn test_save_file_too_large() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::with_max_size(temp_dir.path(), 10); // 10 bytes max
        let service = StorageService::with_config(config);

        let data = Bytes::from("this is definitely more than 10 bytes");
        let result = service.save_file(data, "test.jpg", "image/jpeg").await;

        assert!(result.is_err());
        if let Err(AppError::PayloadTooLarge) = result {
            // Expected
        } else {
            panic!("Expected PayloadTooLarge error");
        }
    }

    #[tokio::test]
    async fn test_save_avatar() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        // Use a valid 1x1 PNG image
        let png_data: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let data = Bytes::from_static(png_data);
        let result = service.save_avatar("123", data, "image/png").await;

        assert!(result.is_ok());
        let filename = result.unwrap();
        assert!(filename.starts_with("avatars/avatar_123_"));
        // Always saved as JPEG after processing
        assert!(filename.ends_with(".jpg"));
    }

    #[tokio::test]
    async fn test_save_avatar_invalid_data() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        // Non-image data should be rejected by the image decoder
        let data = Bytes::from("this is not an image");
        let result = service.save_avatar("123", data, "image/png").await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_save_avatar_bmp_converted_to_jpeg() {
        use image::{ImageBuffer, Rgb};
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        // Create a valid BMP image in memory
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(10, 10, |_, _| Rgb([255u8, 0, 0]));
        let mut bmp_data = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut bmp_data),
            image::ImageFormat::Bmp,
        )
        .unwrap();

        let result = service
            .save_avatar("456", Bytes::from(bmp_data), "image/bmp")
            .await;

        assert!(result.is_ok());
        let filename = result.unwrap();
        // BMP input should be converted to JPEG
        assert!(filename.ends_with(".jpg"));
    }

    #[tokio::test]
    async fn test_delete_file() {
        let temp_dir = tempdir().unwrap();
        let config = StorageConfig::new(temp_dir.path());
        let service = StorageService::with_config(config);

        // First save a file
        let data = Bytes::from("test content");
        let filename = service
            .save_file(data, "test.jpg", "image/jpeg")
            .await
            .unwrap();

        // Extract just the filename from the path
        let just_filename = Path::new(&filename)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap();

        assert!(service.file_exists(just_filename));

        // Then delete it
        let result = service.delete_file(just_filename).await;
        assert!(result.is_ok());
        assert!(!service.file_exists(just_filename));
    }

    #[test]
    fn test_get_file_path() {
        let config = StorageConfig::new("/uploads");
        let service = StorageService::with_config(config);

        let path = service.get_file_path("test.jpg");
        assert_eq!(path, PathBuf::from("/uploads/test.jpg"));
    }

    #[test]
    fn test_process_avatar_image_resize() {
        use image::{ImageBuffer, Rgb};

        // Create a 1000x800 image
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(1000, 800, |_, _| Rgb([0u8, 128, 255]));
        let mut png_data = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut png_data),
            image::ImageFormat::Png,
        )
        .unwrap();

        let result = process_avatar_image(&png_data, 400).unwrap();

        // Verify it's a valid JPEG and was resized
        let decoded = image::load_from_memory(&result).unwrap();
        assert!(decoded.width() <= 400);
        assert!(decoded.height() <= 400);
    }

    #[test]
    fn test_process_avatar_image_small_not_upscaled() {
        use image::{ImageBuffer, Rgb};

        // Create a small 50x50 image - should not be upscaled
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(50, 50, |_, _| Rgb([255u8, 0, 0]));
        let mut png_data = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut png_data),
            image::ImageFormat::Png,
        )
        .unwrap();

        let result = process_avatar_image(&png_data, 400).unwrap();

        let decoded = image::load_from_memory(&result).unwrap();
        assert_eq!(decoded.width(), 50);
        assert_eq!(decoded.height(), 50);
    }

    #[test]
    fn test_process_avatar_image_invalid_data() {
        let result = process_avatar_image(b"not an image", 400);
        assert!(result.is_err());
    }

    #[test]
    fn test_file_exists_sync() {
        let config = StorageConfig::new("/nonexistent");
        let service = StorageService::with_config(config);

        assert!(!service.file_exists("anything.jpg"));
    }
}
