//! Storage integration tests
//!
//! Tests for the /api/storage endpoints including:
//! - File upload
//! - Avatar upload
//! - File retrieval
//! - Invalid file type handling
//! - File not found handling

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    Router,
};
use bytes::Bytes;
use serde_json::Value;
use std::sync::Arc;
use tempfile::tempdir;
use tower::ServiceExt;

use loyalty_backend::routes::storage::{routes_with_state, StorageState};
use loyalty_backend::services::storage::{StorageConfig, StorageService};

// ============================================================================
// Test Setup
// ============================================================================

/// Create a test storage router with a temporary directory
fn create_test_storage_router() -> (Router, tempfile::TempDir) {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let config = StorageConfig::new(temp_dir.path());
    let service = StorageService::with_config(config);
    let state = StorageState::new(service);

    let router = Router::new().nest("/api/storage", routes_with_state(state));

    (router, temp_dir)
}

/// Helper struct for test responses
struct TestResponse {
    status: StatusCode,
    body: String,
}

impl TestResponse {
    async fn from_response(response: axum::response::Response) -> Self {
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();

        Self { status, body }
    }

    fn json(&self) -> Result<Value, serde_json::Error> {
        serde_json::from_str(&self.body)
    }

    fn assert_status(&self, expected: StatusCode) {
        assert_eq!(
            self.status, expected,
            "Expected status {:?}, got {:?}. Body: {}",
            expected, self.status, self.body
        );
    }
}

/// Create a multipart form body for file upload
fn create_multipart_body(
    field_name: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> (String, Vec<u8>) {
    let boundary = "----TestBoundary7MA4YWxkTrZu0gW";

    let mut body = Vec::new();

    // Start boundary
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());

    // Content-Disposition header
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
            field_name, filename
        )
        .as_bytes(),
    );

    // Content-Type header
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());

    // File data
    body.extend_from_slice(data);

    // End boundary
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    (boundary.to_string(), body)
}

/// Create a multipart form body with additional text fields
fn create_multipart_body_with_fields(
    file_field_name: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
    text_fields: &[(&str, &str)],
) -> (String, Vec<u8>) {
    let boundary = "----TestBoundary7MA4YWxkTrZu0gW";

    let mut body = Vec::new();

    // Add text fields first
    for (name, value) in text_fields {
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", name).as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    // Start boundary for file
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());

    // Content-Disposition header
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
            file_field_name, filename
        )
        .as_bytes(),
    );

    // Content-Type header
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());

    // File data
    body.extend_from_slice(data);

    // End boundary
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    (boundary.to_string(), body)
}

// ============================================================================
// Test: Upload File
// ============================================================================

/// Test successful file upload
/// POST /api/storage/upload
/// Upload a test file and verify file URL is returned
#[tokio::test]
async fn test_upload_file() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Create a small PNG test image (1x1 pixel transparent PNG)
    let png_data: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    let (boundary, body) = create_multipart_body("file", "test-image.png", "image/png", png_data);

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert
    test_response.assert_status(StatusCode::OK);

    let json: Value = test_response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Upload should be successful"
    );

    let url = json.get("url").and_then(|v| v.as_str());
    assert!(url.is_some(), "Response should contain URL");
    assert!(
        url.unwrap().contains("/storage/files/"),
        "URL should contain the storage path: {}",
        url.unwrap()
    );
    assert!(
        url.unwrap().ends_with(".png"),
        "URL should end with .png extension: {}",
        url.unwrap()
    );

    let message = json.get("message").and_then(|v| v.as_str());
    assert!(message.is_some(), "Response should contain message");
    assert!(
        message.unwrap().to_lowercase().contains("success"),
        "Message should indicate success: {}",
        message.unwrap()
    );
}

// ============================================================================
// Test: Upload Avatar
// ============================================================================

/// Test successful avatar upload
/// POST /api/storage/avatar
/// Upload avatar image and verify avatar URL is returned
#[tokio::test]
async fn test_upload_avatar() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Create a small JPEG test image (minimal valid JPEG)
    let jpeg_data: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
        0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B,
        0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31,
        0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF,
        0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00,
        0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
        0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05,
        0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21,
        0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
        0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A,
        0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
        0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56,
        0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
        0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x92, 0x93,
        0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9,
        0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6,
        0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7,
        0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5,
        0xDB, 0x20, 0xA8, 0xF3, 0xFF, 0xD9,
    ];

    let user_id = "12345";
    let (boundary, body) = create_multipart_body_with_fields(
        "avatar",
        "my-avatar.jpg",
        "image/jpeg",
        jpeg_data,
        &[("user_id", user_id)],
    );

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/avatar")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert
    test_response.assert_status(StatusCode::OK);

    let json: Value = test_response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "Avatar upload should be successful"
    );

    let data = json.get("data").expect("Response should contain data");
    let avatar_url = data.get("avatarUrl").and_then(|v| v.as_str());

    assert!(avatar_url.is_some(), "Response should contain avatarUrl");
    assert!(
        avatar_url.unwrap().contains("avatars/"),
        "Avatar URL should contain avatars path: {}",
        avatar_url.unwrap()
    );
    assert!(
        avatar_url.unwrap().contains(user_id),
        "Avatar URL should contain user ID: {}",
        avatar_url.unwrap()
    );

    let message = json.get("message").and_then(|v| v.as_str());
    assert!(message.is_some(), "Response should contain message");
    assert!(
        message.unwrap().to_lowercase().contains("success"),
        "Message should indicate success: {}",
        message.unwrap()
    );
}

// ============================================================================
// Test: Get File
// ============================================================================

/// Test retrieving an uploaded file
/// GET /api/storage/files/:filename
/// Upload a file first, then retrieve it
#[tokio::test]
async fn test_get_file() {
    // Arrange - Create router
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let config = StorageConfig::new(temp_dir.path());
    let service = StorageService::with_config(config);

    // First, save a file directly using the service
    let test_content = b"Test file content for retrieval";
    let saved_url = service
        .save_file(
            Bytes::from_static(test_content),
            "test-file.png",
            "image/png",
        )
        .await
        .expect("Failed to save test file");

    // Extract filename from URL (e.g., "/storage/files/uuid_test-file.png" -> "uuid_test-file.png")
    let filename = saved_url
        .rsplit('/')
        .next()
        .expect("URL should have filename");

    let state = StorageState {
        storage: Arc::new(service),
    };
    let router = Router::new().nest("/api/storage", routes_with_state(state));

    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/storage/files/{}", filename))
        .body(Body::empty())
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "Should successfully retrieve the uploaded file"
    );

    // Verify content type
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    assert_eq!(
        content_type,
        Some("image/png"),
        "Content-Type should be image/png"
    );

    // Verify content length
    let content_length = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok());
    assert_eq!(
        content_length,
        Some(test_content.len()),
        "Content-Length should match file size"
    );

    // Verify cache control header is present
    let cache_control = response
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|v| v.to_str().ok());
    assert!(
        cache_control.is_some(),
        "Cache-Control header should be present"
    );

    // Verify body content
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        body.as_ref(),
        test_content,
        "Retrieved file content should match uploaded content"
    );
}

// ============================================================================
// Test: Upload Invalid File Type
// ============================================================================

/// Test uploading a non-allowed file type
/// POST /api/storage/upload with invalid content type
/// Should return 400 error (or 415 Unsupported Media Type)
#[tokio::test]
async fn test_upload_invalid_file_type() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Try to upload a text file (not allowed)
    let text_content = b"This is plain text content that should not be allowed";

    let (boundary, body) =
        create_multipart_body("file", "document.txt", "text/plain", text_content);

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert - Should return 400 Bad Request or 415 Unsupported Media Type
    assert!(
        test_response.status == StatusCode::BAD_REQUEST
            || test_response.status == StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "Expected 400 or 415 status for invalid file type, got {:?}. Body: {}",
        test_response.status,
        test_response.body
    );

    // Verify error message indicates the issue
    let json_result = test_response.json();
    if let Ok(json) = json_result {
        let error_message = json
            .get("error")
            .or_else(|| json.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        assert!(
            error_message.to_lowercase().contains("unsupported")
                || error_message.to_lowercase().contains("type")
                || error_message.to_lowercase().contains("allowed"),
            "Error message should indicate unsupported file type: {}",
            error_message
        );
    }
}

/// Test uploading an executable file (should be rejected)
#[tokio::test]
async fn test_upload_executable_file_type() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Try to upload an executable (not allowed)
    let exe_content = b"\x4D\x5A\x90\x00"; // PE executable header

    let (boundary, body) = create_multipart_body(
        "file",
        "malware.exe",
        "application/x-executable",
        exe_content,
    );

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert - Should return 400 or 415
    assert!(
        test_response.status == StatusCode::BAD_REQUEST
            || test_response.status == StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "Expected 400 or 415 status for executable file, got {:?}",
        test_response.status
    );
}

// ============================================================================
// Test: File Not Found
// ============================================================================

/// Test retrieving a non-existent file
/// GET /api/storage/files/nonexistent
/// Should return 404
#[tokio::test]
async fn test_file_not_found() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    let request = Request::builder()
        .method("GET")
        .uri("/api/storage/files/nonexistent-file-that-does-not-exist.png")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert
    test_response.assert_status(StatusCode::NOT_FOUND);

    // Verify error response structure
    let json_result = test_response.json();
    if let Ok(json) = json_result {
        let error_message = json
            .get("error")
            .or_else(|| json.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        assert!(
            error_message.to_lowercase().contains("not found")
                || error_message.to_lowercase().contains("file"),
            "Error message should indicate file not found: {}",
            error_message
        );
    }
}

/// Test retrieving a non-existent avatar
#[tokio::test]
async fn test_avatar_not_found() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    let request = Request::builder()
        .method("GET")
        .uri("/api/storage/avatars/nonexistent-avatar.jpg")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert
    test_response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

/// Test uploading a file without the file field
#[tokio::test]
async fn test_upload_missing_file_field() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Create an empty multipart body without a file
    let boundary = "----TestBoundary7MA4YWxkTrZu0gW";
    let body = format!(
        "--{boundary}\r\n\
        Content-Disposition: form-data; name=\"other_field\"\r\n\r\n\
        some value\r\n\
        --{boundary}--\r\n",
        boundary = boundary
    );

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert - Should return 400 Bad Request
    test_response.assert_status(StatusCode::BAD_REQUEST);
}

/// Test uploading avatar without user_id
#[tokio::test]
async fn test_upload_avatar_missing_user_id() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    let jpeg_data: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];

    // Create multipart without user_id field
    let (boundary, body) = create_multipart_body("avatar", "test.jpg", "image/jpeg", jpeg_data);

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/avatar")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert - Should return 400 Bad Request
    test_response.assert_status(StatusCode::BAD_REQUEST);

    // Verify error message indicates missing user_id
    let json_result = test_response.json();
    if let Ok(json) = json_result {
        let error_message = json
            .get("error")
            .or_else(|| json.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        assert!(
            error_message.to_lowercase().contains("user_id")
                || error_message.to_lowercase().contains("missing"),
            "Error message should indicate missing user_id: {}",
            error_message
        );
    }
}

/// Test uploading PDF file (should be allowed for general upload)
#[tokio::test]
async fn test_upload_pdf_file() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Minimal PDF content
    let pdf_data = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF";

    let (boundary, body) =
        create_multipart_body("file", "document.pdf", "application/pdf", pdf_data);

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert
    test_response.assert_status(StatusCode::OK);

    let json: Value = test_response.json().expect("Response should be valid JSON");

    assert_eq!(
        json.get("success").and_then(|v| v.as_bool()),
        Some(true),
        "PDF upload should be successful"
    );

    let url = json.get("url").and_then(|v| v.as_str());
    assert!(
        url.unwrap().ends_with(".pdf"),
        "URL should end with .pdf extension"
    );
}

/// Test uploading avatar with invalid content type (PDF is not allowed for avatars)
#[tokio::test]
async fn test_upload_avatar_invalid_content_type() {
    // Arrange
    let (router, _temp_dir) = create_test_storage_router();

    // Try to upload PDF as avatar (not allowed)
    let pdf_data = b"%PDF-1.4";

    let (boundary, body) = create_multipart_body_with_fields(
        "avatar",
        "fake-avatar.pdf",
        "application/pdf",
        pdf_data,
        &[("user_id", "123")],
    );

    let request = Request::builder()
        .method("POST")
        .uri("/api/storage/avatar")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    // Act
    let response = router.oneshot(request).await.unwrap();
    let test_response = TestResponse::from_response(response).await;

    // Assert - Should return 400 or 415
    assert!(
        test_response.status == StatusCode::BAD_REQUEST
            || test_response.status == StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "Expected 400 or 415 status for non-image avatar, got {:?}",
        test_response.status
    );
}
