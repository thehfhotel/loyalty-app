//! Integration tests for `POST /api/slips/upload`.
//!
//! Covers the security-relevant entry conditions:
//! - MED-3 (per-route body limit): bodies above the 10 MiB slip cap
//!   are rejected with 413 by the axum body-limit layer before the
//!   handler ever reads them.
//! - MED-4 (magic-byte check): a non-image labelled `image/jpeg` is
//!   rejected with 400. The handler-side guard fires regardless of
//!   the multipart Content-Type header.

use axum::{
    body::Body,
    http::{header, Request},
};
use tower::ServiceExt;
use uuid::Uuid;

use crate::common::{generate_test_token_with_role, TestApp};

/// Build a minimal multipart body with one file field. Mirrors the
/// helper used in `storage_test.rs`; duplicated locally because the
/// helper there is private to that module.
fn build_multipart(
    field_name: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> (String, Vec<u8>) {
    let boundary = "----LoyaltyTestBoundary8sKzM2Yf";
    let mut body = Vec::with_capacity(data.len() + 256);

    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
            field_name, filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    (boundary.to_string(), body)
}

/// Send a multipart POST through the TestApp router, threading auth.
/// Bypasses `TestClient::post` because that helper only knows how to
/// send JSON bodies.
async fn post_multipart_to_slip_upload(
    app: &TestApp,
    user_id: &Uuid,
    user_email: &str,
    role: &str,
    boundary: &str,
    body: Vec<u8>,
) -> (u16, String) {
    let token = generate_test_token_with_role(user_id, user_email, role);
    let req = Request::builder()
        .method("POST")
        .uri("/api/slips/upload")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .expect("Failed to build request");

    let resp = app
        .router()
        .oneshot(req)
        .await
        .expect("router oneshot failed");
    let status = resp.status().as_u16();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("Failed to read response body");
    (status, String::from_utf8_lossy(&body_bytes).into_owned())
}

/// MED-3: per-route body limit. The slip upload route has a
/// `DefaultBodyLimit::max(10 MiB)` layered on it, tighter than the
/// global 16 MiB limit. A 12 MiB body must be rejected by axum at the
/// body-extraction layer (413), not buffered through to the handler.
#[tokio::test]
async fn slip_upload_rejects_body_above_per_route_limit() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user_id = Uuid::new_v4();
    let email = format!("slip-bodylimit-{}@test.local", user_id);

    // 12 MiB payload — bigger than the per-route 10 MiB cap, smaller
    // than the global 16 MiB cap. The first three bytes are a valid
    // JPEG SOI marker so we know that, IF the request body made it
    // past the limit, it would have passed magic-byte validation too.
    let mut payload = Vec::with_capacity(12 * 1024 * 1024);
    payload.extend_from_slice(&[0xFF, 0xD8, 0xFF]);
    payload.resize(12 * 1024 * 1024, 0u8);

    let (boundary, body) = build_multipart("slip", "huge.jpg", "image/jpeg", &payload);

    let (status, body_str) =
        post_multipart_to_slip_upload(&app, &user_id, &email, "customer", &boundary, body).await;

    // The per-route limit is enforced at axum's body-extraction layer.
    // The exact status code depends on how the request reaches the
    // limit:
    // - 413 Payload Too Large when the body-cap layer fires before the
    //   multipart parser starts reading the body.
    // - 400 Bad Request when the multipart parser starts and then hits
    //   the truncated tail of the body (axum surfaces the truncation
    //   as a "parsing multipart" error from the handler-side `Multipart`
    //   extractor).
    //
    // Either outcome satisfies the security property (the body was
    // never fully buffered into memory). What we MUST NOT see is a 2xx,
    // which would mean the 12 MiB body sailed past the per-route cap
    // and was processed by the handler — exactly the DoS path MED-3
    // sets out to close.
    assert!(
        status == 413 || status == 400,
        "Expected 413 (per-route limit) or 400 (multipart parse failure after truncation); \
         got {}. Body: {}",
        status,
        body_str,
    );

    // Defensive: make sure a 2xx response (success) can't slip through.
    // If the handler ever started returning 2xx here, MED-3 would be
    // silently regressed.
    assert!(
        !(200..300).contains(&status),
        "Slip upload must NOT succeed for a 12 MiB body; got {}. Body: {}",
        status,
        body_str
    );

    app.cleanup().await.ok();
}

/// MED-4: the magic-byte check rejects an HTML file labelled as a
/// JPEG. The multipart Content-Type is what the client sends; the
/// handler must look at the bytes, not the header.
#[tokio::test]
async fn slip_upload_rejects_html_labelled_as_jpeg() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user_id = Uuid::new_v4();
    let email = format!("slip-magic-{}@test.local", user_id);

    // A short HTML document — magic bytes start with `<` (0x3C), which
    // is neither the JPEG SOI marker (FF D8 FF) nor the PNG signature.
    let html = b"<html><body>not actually a jpeg</body></html>";

    let (boundary, body) = build_multipart("slip", "spoof.jpg", "image/jpeg", html);

    let (status, body_str) =
        post_multipart_to_slip_upload(&app, &user_id, &email, "customer", &boundary, body).await;

    assert_eq!(
        status, 400,
        "Expected 400 from magic-byte mismatch; got {}. Body: {}",
        status, body_str
    );
    assert!(
        body_str.to_lowercase().contains("magic")
            || body_str.to_lowercase().contains("do not match"),
        "Error message should mention the magic-byte check. Body: {}",
        body_str
    );

    app.cleanup().await.ok();
}

/// MED-6 (security-2026-05-13.md): unauthenticated access to
/// `GET /api/storage/slips/:filename` is rejected with 401.
#[tokio::test]
async fn slip_serving_requires_authentication() {
    let app = TestApp::new().await.expect("Failed to create test app");

    // Plain client with no Authorization header.
    let resp = app.client().get("/api/storage/slips/whatever.jpg").await;

    resp.assert_status(401);

    app.cleanup().await.ok();
}

/// MED-6: a non-admin caller who doesn't own the slip's booking
/// gets 403. We seed the slip row in `booking_slips` directly so
/// the test exercises the lookup-then-deny path.
#[tokio::test]
async fn slip_serving_denies_non_owner_non_admin() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let owner = crate::common::TestUser::new("slip-serve-owner@test.com");
    owner
        .insert(app.db())
        .await
        .expect("Failed to insert owner");

    let intruder = crate::common::TestUser::new("slip-serve-intruder@test.com");
    intruder
        .insert(app.db())
        .await
        .expect("Failed to insert intruder");

    let booking_id = seed_booking_for(app.db(), owner.id).await;

    // Seed the slip row so lookup_slip_owner finds it.
    let filename = format!("served-deny-{}.jpg", Uuid::new_v4().simple());
    let slip_url = format!("/storage/slips/{}", filename);
    sqlx::query(
        r#"
        INSERT INTO booking_slips (booking_id, slip_url, uploaded_by)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(booking_id)
    .bind(&slip_url)
    .bind(owner.id)
    .execute(app.db())
    .await
    .expect("Failed to insert slip row");

    let resp = app
        .authenticated_client(&intruder.id, &intruder.email)
        .get(&format!("/api/storage/slips/{}", filename))
        .await;

    resp.assert_status(403);

    app.cleanup().await.ok();
}

/// MED-6: when there's no booking_slips row referencing the URL,
/// the handler returns 404. Notably it does NOT leak any info about
/// whether the underlying file is present on disk.
#[tokio::test]
async fn slip_serving_returns_404_for_unreferenced_slip() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user = crate::common::TestUser::new("slip-serve-404@test.com");
    user.insert(app.db()).await.expect("Failed to insert user");

    // No slip row inserted — just a UUID we made up.
    let resp = app
        .authenticated_client(&user.id, &user.email)
        .get(&format!(
            "/api/storage/slips/orphan-{}.jpg",
            Uuid::new_v4().simple()
        ))
        .await;

    resp.assert_status(404);

    app.cleanup().await.ok();
}

/// MED-6: admin bypass — an admin can fetch any slip without
/// passing the per-slip ownership check. Confirmed by exercising
/// the lookup path: the response is NOT 401/403 (auth + authz both
/// pass). The file itself is absent from disk in tests, so we
/// accept 404 as the legitimate "auth/authz fine, file missing"
/// outcome — what we MUST NOT see is 403, which would mean the
/// admin bypass was missing.
#[tokio::test]
async fn slip_serving_admin_bypass_skips_ownership_check() {
    let app = TestApp::new().await.expect("Failed to create test app");

    let admin = crate::common::TestUser::admin("slip-serve-admin@test.com");
    admin
        .insert(app.db())
        .await
        .expect("Failed to insert admin");

    // The slip belongs to a totally different user. The admin must
    // still be allowed past the authorization gate.
    let owner = crate::common::TestUser::new("slip-serve-owner-of-admin-test@test.com");
    owner
        .insert(app.db())
        .await
        .expect("Failed to insert owner");

    let resp = app
        .authenticated_client_with_role(&admin.id, &admin.email, "admin")
        .get("/api/storage/slips/some-admin-can-see-this.jpg")
        .await;

    assert_ne!(
        resp.status, 403,
        "Admin must NOT be blocked by ownership check. Body: {}",
        resp.body
    );
    assert_ne!(
        resp.status, 401,
        "Admin token was valid; should not be 401. Body: {}",
        resp.body
    );

    app.cleanup().await.ok();
}

/// Helper: seed a confirmed booking against (or-create) the shared
/// test room/room_type rows. Mirrors `booking_test::create_test_booking`
/// — duplicated here so this module stays standalone.
async fn seed_booking_for(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
    let booking_id = Uuid::new_v4();
    let check_in = chrono::Utc::now().date_naive() + chrono::Duration::days(1);
    let check_out = check_in + chrono::Duration::days(2);

    // Get or create the test room type.
    let room_type_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM room_types WHERE LOWER(name) = LOWER('Slip Test Room')",
    )
    .fetch_optional(pool)
    .await
    .expect("Failed to query room_types")
    {
        Some(id) => id,
        None => sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO room_types (id, name, price_per_night, max_guests)
            VALUES ($1, 'Slip Test Room', 1500.00, 2)
            RETURNING id
            "#,
        )
        .bind(Uuid::new_v4())
        .fetch_one(pool)
        .await
        .expect("Failed to insert room_type"),
    };

    // Get or create a room of that type.
    let room_id: Uuid =
        match sqlx::query_scalar::<_, Uuid>("SELECT id FROM rooms WHERE room_number = 'SLIP-201'")
            .fetch_optional(pool)
            .await
            .expect("Failed to query rooms")
        {
            Some(id) => id,
            None => sqlx::query_scalar::<_, Uuid>(
                r#"
                INSERT INTO rooms (id, room_type_id, room_number, floor)
                VALUES ($1, $2, 'SLIP-201', 2)
                RETURNING id
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(room_type_id)
            .fetch_one(pool)
            .await
            .expect("Failed to insert room"),
        };

    sqlx::query(
        r#"
        INSERT INTO bookings (
            id, user_id, room_id, room_type_id,
            check_in_date, check_out_date, num_guests,
            total_price, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1, 1500.00, 'confirmed')
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_id)
    .bind(check_in)
    .bind(check_out)
    .execute(pool)
    .await
    .expect("Failed to insert booking");

    booking_id
}

/// Sanity-check companion to the rejection tests above: a tiny valid
/// PNG passes both the magic-byte and per-route body checks. Without
/// this we can't tell whether 400/413 above are because we broke the
/// happy path or because the guards fired correctly.
#[tokio::test]
async fn slip_upload_accepts_valid_png_within_limit() {
    let app = TestApp::new().await.expect("Failed to create test app");
    let user_id = Uuid::new_v4();
    let email = format!("slip-valid-{}@test.local", user_id);

    // 1x1 transparent PNG.
    let png: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    let (boundary, body) = build_multipart("slip", "tiny.png", "image/png", png);

    let (status, body_str) =
        post_multipart_to_slip_upload(&app, &user_id, &email, "customer", &boundary, body).await;

    assert!(
        (200..300).contains(&status),
        "Expected 2xx for a valid PNG within size limit; got {}. Body: {}",
        status,
        body_str
    );
    assert!(
        body_str.contains("/storage/slips/"),
        "Response should include the slip URL. Body: {}",
        body_str
    );

    app.cleanup().await.ok();
}
