//! Integration tests for task F2 — slip image retention, deletion and
//! admin-viewer access logging.
//!
//! The two P1 gaps in `docs/privacy/2026-09-pdpa-data-map.md` §8:
//!
//! 1. nothing has ever deleted a slip image, and
//! 2. reading one has never been recorded.
//!
//! What is asserted here is the pair of promises the published notice (F3)
//! will make on the back of this code: **an admin's view of a slip is
//! logged, the guest's own view of their own slip is not**, and **an image
//! past the retention window is actually gone from disk** while the payment
//! record it belonged to survives.

use std::path::PathBuf;

use axum::{
    body::Body,
    http::{header, Request},
};
use serde_json::Value;
use tower::ServiceExt;
use uuid::Uuid;

use crate::common::{generate_test_token_with_role, TestApp, TestUser};

// ============================================================================
// Fixtures
// ============================================================================

/// A one-pixel PNG. Small enough that the magic-byte and size guards on the
/// upload path are irrelevant here — these tests write the file directly,
/// because what is under test is erasing it, not accepting it.
const TINY_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

/// Get-or-create the room type, and mint a **fresh room** for the caller.
///
/// The room is new every time on purpose: `bookings_no_overlap` is an
/// `EXCLUDE USING gist` constraint on `(room_id, daterange(check_in,
/// check_out))` for every status except `cancelled`/`no_show`, so two
/// fixtures sharing a room and a date range would collide in the database
/// rather than in the code under test.
async fn seed_room(pool: &sqlx::PgPool) -> (Uuid, Uuid) {
    let room_type_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM room_types WHERE LOWER(name) = LOWER('Retention Test Room')",
    )
    .fetch_optional(pool)
    .await
    .expect("query room_types")
    {
        Some(id) => id,
        None => sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO room_types (id, name, price_per_night, max_guests)
            VALUES ($1, 'Retention Test Room', 1500.00, 2)
            RETURNING id
            "#,
        )
        .bind(Uuid::new_v4())
        .fetch_one(pool)
        .await
        .expect("insert room_type"),
    };

    let room_id: Uuid = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO rooms (id, room_type_id, room_number, floor)
        VALUES ($1, $2, $3, 3)
        RETURNING id
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .bind(format!("RET-{}", &Uuid::new_v4().to_string()[..8]))
    .fetch_one(pool)
    .await
    .expect("insert room");

    (room_type_id, room_id)
}

/// Seed a booking in a given state, whose stay ended `ended_days_ago` days
/// ago. `updated_at` and `cancelled_at` are written explicitly because the
/// sweep measures the window from the *latest* of them and the stay's end.
async fn seed_booking(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    status: &str,
    ended_days_ago: i64,
) -> Uuid {
    let (room_type_id, room_id) = seed_room(pool).await;
    let booking_id = Uuid::new_v4();
    let check_out = chrono::Utc::now().date_naive() - chrono::Duration::days(ended_days_ago);
    let check_in = check_out - chrono::Duration::days(2);
    let closed_at = chrono::Utc::now() - chrono::Duration::days(ended_days_ago);

    sqlx::query(
        r#"
        INSERT INTO bookings (
            id, user_id, room_id, room_type_id,
            check_in_date, check_out_date, num_guests,
            total_price, status, created_at, updated_at, cancelled_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1, 1500.00, $7, $8, $8,
                CASE WHEN $7 = 'cancelled' THEN $8 ELSE NULL END)
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_id)
    .bind(check_in)
    .bind(check_out)
    .bind(status)
    .bind(closed_at)
    .execute(pool)
    .await
    .expect("insert booking");

    booking_id
}

/// Seed a `booking_slips` row plus the file it points at, inside
/// `slips_dir`. Returns `(slip_id, file_name)`.
async fn seed_slip(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    uploaded_by: Uuid,
    admin_status: &str,
    slips_dir: &std::path::Path,
) -> (Uuid, String) {
    seed_slip_full(
        pool,
        booking_id,
        uploaded_by,
        Some(admin_status),
        None,
        slips_dir,
    )
    .await
}

/// [`seed_slip`] with the two decision columns the sweep filters on spelled
/// out, so a test can build the "undecided" shapes that must survive.
async fn seed_slip_full(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    uploaded_by: Uuid,
    admin_status: Option<&str>,
    slipok_status: Option<&str>,
    slips_dir: &std::path::Path,
) -> (Uuid, String) {
    let slip_id = Uuid::new_v4();
    let file_name = format!("{}.png", Uuid::new_v4());
    let slip_url = format!("/storage/slips/{}", file_name);

    std::fs::create_dir_all(slips_dir).expect("create slips dir");
    std::fs::write(slips_dir.join(&file_name), TINY_PNG).expect("write slip fixture");

    sqlx::query(
        r#"
        INSERT INTO booking_slips
            (id, booking_id, slip_url, uploaded_by, admin_status, slipok_status)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(slip_id)
    .bind(booking_id)
    .bind(&slip_url)
    .bind(uploaded_by)
    .bind(admin_status)
    .bind(slipok_status)
    .execute(pool)
    .await
    .expect("insert booking_slips");

    (slip_id, file_name)
}

/// Attach a **second** live `booking_slips` row to a file some other row
/// already points at.
///
/// Two live rows on one `slip_url` cannot be created any more: `POST
/// /api/bookings/:id/slips` answers 409, and
/// `uq_booking_slips_slip_url_live` makes the database refuse the insert
/// outright. Both of those are the point of F2b — and both are exactly why
/// the sweep's shared-file rules still need testing, because rows written
/// before either guard existed are the ones those rules exist for.
///
/// So the fixture manufactures the legacy shape the only way it can: it drops
/// the unique index in **this test's own database** (`TestApp` builds one per
/// test from a template, so nothing else sees it) and then writes the row
/// directly. `attaching_an_already_attached_slip_url_is_refused` covers the
/// live rule on an untouched database.
async fn seed_sharing_row(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    uploaded_by: Uuid,
    admin_status: &str,
    file_name: &str,
) -> Uuid {
    sqlx::query("DROP INDEX IF EXISTS \"public\".\"uq_booking_slips_slip_url_live\"")
        .execute(pool)
        .await
        .expect("drop the unique index to manufacture a pre-F2b duplicate");

    let slip_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO booking_slips (id, booking_id, slip_url, uploaded_by, admin_status)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(slip_id)
    .bind(booking_id)
    .bind(format!("/storage/slips/{}", file_name))
    .bind(uploaded_by)
    .bind(admin_status)
    .execute(pool)
    .await
    .expect("seed a second live row sharing one file");

    slip_id
}

/// Move a booking into a closed state without disturbing the window: the
/// stay's end and `updated_at` both stay where the fixture put them.
async fn close_booking(pool: &sqlx::PgPool, booking_id: Uuid, status: &str, ended_days_ago: i64) {
    let closed_at = chrono::Utc::now() - chrono::Duration::days(ended_days_ago);

    sqlx::query("UPDATE bookings SET status = $2, updated_at = $3 WHERE id = $1")
        .bind(booking_id)
        .bind(status)
        .bind(closed_at)
        .execute(pool)
        .await
        .expect("close the booking");
}

/// Stamp `updated_at` to now, leaving the stay's dates alone — the shape the
/// `GREATEST(...)` window exists to catch.
async fn touch_booking(pool: &sqlx::PgPool, booking_id: Uuid) {
    sqlx::query("UPDATE bookings SET updated_at = NOW() WHERE id = $1")
        .bind(booking_id)
        .execute(pool)
        .await
        .expect("touch the booking");
}

/// The tombstone triple: `(slip_url, deleted_at, deletion_reason)`.
async fn slip_tombstone(
    pool: &sqlx::PgPool,
    slip_id: Uuid,
) -> (
    Option<String>,
    Option<chrono::DateTime<chrono::Utc>>,
    Option<String>,
) {
    sqlx::query_as("SELECT slip_url, deleted_at, deletion_reason FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .fetch_one(pool)
        .await
        .expect("the metadata row outlives the image")
}

/// Assert a slip carries a retention tombstone: no path, a stamp, our reason.
/// Returns the `deleted_at`, so a caller can compare two rows' stamps.
async fn assert_tombstoned(
    pool: &sqlx::PgPool,
    slip_id: Uuid,
    why: &str,
) -> chrono::DateTime<chrono::Utc> {
    let (slip_url, deleted_at, reason) = slip_tombstone(pool, slip_id).await;
    assert_eq!(slip_url, None, "{}: the stored path is nulled", why);
    assert_eq!(reason.as_deref(), Some("retention_sweep"), "{}", why);
    deleted_at.unwrap_or_else(|| panic!("{}: deleted_at is stamped", why))
}

/// Is this slip still un-erased — file on disk and no tombstone?
async fn slip_is_intact(pool: &sqlx::PgPool, slip_id: Uuid, path: &std::path::Path) -> bool {
    let row: (Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT slip_url, deleted_at FROM booking_slips WHERE id = $1")
            .bind(slip_id)
            .fetch_one(pool)
            .await
            .expect("slip row still present");

    path.exists() && row.0.is_some() && row.1.is_none()
}

/// Where `GET /api/storage/slips/:filename` reads from.
///
/// Resolved through the same `StorageService` the route uses rather than
/// guessed, because it derives its base from `UPLOAD_DIR`/`STORAGE_PATH` and
/// this suite must not depend on which of them happens to be set.
fn served_slips_dir() -> PathBuf {
    let probe = loyalty_backend::services::storage::StorageService::new().get_slip_path("probe");
    probe
        .parent()
        .map(PathBuf::from)
        .expect("slip path has a parent directory")
}

/// Fetch a slip image and hand back the **raw** bytes.
///
/// Deliberately not `TestClient`: that helper decodes every body as UTF-8,
/// and a PNG is not UTF-8. Same shape as `slips_test`'s raw-request helper.
async fn get_slip_image(
    app: &TestApp,
    user_id: &Uuid,
    email: &str,
    role: &str,
    file_name: &str,
) -> (u16, Vec<u8>) {
    get_slip_image_with_request_id(app, user_id, email, role, file_name, None).await
}

/// [`get_slip_image`] with an explicit `x-request-id`.
///
/// The header is what ties an access-log row back to the request's tracing
/// span, and in production `SetRequestIdLayer` puts a UUID on any request
/// that arrives without one. The test router has no such layer, so whatever
/// is passed here is exactly what the handler sees.
async fn get_slip_image_with_request_id(
    app: &TestApp,
    user_id: &Uuid,
    email: &str,
    role: &str,
    file_name: &str,
    request_id: Option<&str>,
) -> (u16, Vec<u8>) {
    let token = generate_test_token_with_role(user_id, email, role);
    let mut builder = Request::builder()
        .method("GET")
        .uri(format!("/api/storage/slips/{}", file_name))
        .header(header::AUTHORIZATION, format!("Bearer {}", token));

    if let Some(request_id) = request_id {
        builder = builder.header("x-request-id", request_id);
    }

    let request = builder.body(Body::empty()).expect("build request");

    let response = app
        .router()
        .oneshot(request)
        .await
        .expect("router oneshot failed");
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");

    (status, bytes.to_vec())
}

async fn count_access_rows(pool: &sqlx::PgPool, slip_id: Uuid) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM slip_access_log WHERE slip_id = $1")
        .bind(slip_id)
        .fetch_one(pool)
        .await
        .expect("count slip_access_log")
}

// ============================================================================
// Access logging
// ============================================================================

/// The headline promise: an **admin** fetching the image bytes is recorded,
/// naming the admin, the slip and the route. Before F2 this read left no
/// trace at all (`data-map` §7, "Viewing a slip is not recorded anywhere").
#[tokio::test]
async fn an_admin_view_of_a_slip_image_is_logged() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("retention-guest-image@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin = TestUser::admin("retention-admin-image@test.com");
    admin.insert(app.db()).await.expect("insert admin");

    let dir = served_slips_dir();
    let booking_id = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let (slip_id, file_name) = seed_slip(app.db(), booking_id, guest.id, "pending", &dir).await;

    let (status, bytes) = get_slip_image(&app, &admin.id, &admin.email, "admin", &file_name).await;
    assert_eq!(status, 200);
    assert_eq!(
        bytes, TINY_PNG,
        "the admin really did receive the image, not an error page"
    );

    let row = sqlx::query_as::<_, (Uuid, String, Option<String>)>(
        "SELECT admin_id, route, request_id FROM slip_access_log WHERE slip_id = $1",
    )
    .bind(slip_id)
    .fetch_one(app.db())
    .await
    .expect("one access row for the admin's view");

    assert_eq!(row.0, admin.id, "the row names the admin who looked");
    assert_eq!(
        row.1, "GET /api/storage/slips/:filename",
        "the route is the stable machine key, never the literal request line"
    );
    assert!(
        !row.1.contains(&file_name),
        "the route key must not repeat the slip's file name"
    );

    let _ = std::fs::remove_file(dir.join(&file_name));
    app.cleanup().await.ok();
}

/// The other half of the promise, and the one that is easy to get wrong:
/// the guest reading **their own** slip is not surveilled. The table exists
/// for staff accountability, not to follow the data subject around.
#[tokio::test]
async fn a_guest_viewing_their_own_slip_is_not_logged() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("retention-guest-own@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let dir = served_slips_dir();
    let booking_id = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let (slip_id, file_name) = seed_slip(app.db(), booking_id, guest.id, "pending", &dir).await;

    let (status, bytes) =
        get_slip_image(&app, &guest.id, &guest.email, "customer", &file_name).await;
    assert_eq!(status, 200, "the guest can still read their own slip");
    assert_eq!(bytes, TINY_PNG);

    assert_eq!(
        count_access_rows(app.db(), slip_id).await,
        0,
        "a guest reading their own payment slip is not an access-log event"
    );

    let _ = std::fs::remove_file(dir.join(&file_name));
    app.cleanup().await.ok();
}

/// The Slip Viewer Sidebar reads the slip through this route, so it has to
/// be logged too — and the log has to be readable back through an API,
/// because `CLAUDE.md` hard rule 5 forbids answering the question with psql.
#[tokio::test]
async fn the_admin_slip_detail_is_logged_and_the_log_reads_back() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("retention-guest-detail@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin = TestUser::admin("retention-admin-detail@test.com");
    admin.insert(app.db()).await.expect("insert admin");

    let dir = served_slips_dir();
    let booking_id = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let (slip_id, file_name) = seed_slip(app.db(), booking_id, guest.id, "pending", &dir).await;

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    client
        .get(&format!("/api/admin/bookings/slips/{}", slip_id))
        .await
        .assert_status(200);

    let response = client
        .get(&format!("/api/admin/bookings/slips/{}/access-log", slip_id))
        .await;
    response.assert_status(200);
    let body: Value = response.json().expect("access-log response");

    assert_eq!(body["total"].as_i64(), Some(1));
    assert_eq!(body["page"].as_i64(), Some(1));
    let entries = body["entries"].as_array().expect("entries array");
    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0]["adminId"].as_str(),
        Some(admin.id.to_string()).as_deref()
    );
    assert_eq!(
        entries[0]["route"].as_str(),
        Some("GET /api/admin/bookings/slips/:slip_id")
    );
    assert_eq!(
        entries[0]["adminName"].as_str(),
        Some(admin.email.as_str()),
        "an admin with no profile row falls back to their email"
    );
    assert!(
        entries[0].get("accessedAt").is_some(),
        "accessedAt is part of the contract"
    );
    assert!(
        entries[0].get("requestId").is_some(),
        "requestId is part of the contract even when it is null"
    );

    // Reading the log is not itself a read of the slip — otherwise the
    // surface would grow a row every time somebody audited it.
    assert_eq!(count_access_rows(app.db(), slip_id).await, 1);

    let _ = std::fs::remove_file(dir.join(&file_name));
    app.cleanup().await.ok();
}

/// `x-request-id` is the thread from an access-log row back to the request's
/// log lines, and `slip_access_log.request_id` is the only column that
/// carries it. Unit-tested header parsing proves the *reader* works; this
/// proves the value actually survives the route, the recorder and the insert.
#[tokio::test]
async fn the_requests_x_request_id_lands_on_the_access_log_row() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("retention-guest-reqid@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin = TestUser::admin("retention-admin-reqid@test.com");
    admin.insert(app.db()).await.expect("insert admin");

    let dir = served_slips_dir();
    let booking_id = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let (slip_id, file_name) = seed_slip(app.db(), booking_id, guest.id, "pending", &dir).await;

    // Unique per run, so the assertion cannot pass on somebody else's row.
    let request_id = format!("req-{}", Uuid::new_v4());

    let (status, _) = get_slip_image_with_request_id(
        &app,
        &admin.id,
        &admin.email,
        "admin",
        &file_name,
        Some(&request_id),
    )
    .await;
    assert_eq!(status, 200);

    let stored: Option<String> =
        sqlx::query_scalar("SELECT request_id FROM slip_access_log WHERE slip_id = $1")
            .bind(slip_id)
            .fetch_one(app.db())
            .await
            .expect("one access row for the admin's view");

    assert_eq!(
        stored.as_deref(),
        Some(request_id.as_str()),
        "the access-log row carries the request's x-request-id verbatim"
    );

    let _ = std::fs::remove_file(dir.join(&file_name));
    app.cleanup().await.ok();
}

// ============================================================================
// Retention sweep
// ============================================================================

/// The sweep erases exactly the slips that are past the window AND closed AND
/// decided AND not sharing their file — and nothing else.
///
/// Every "kept" fixture here is a separate reason the sweep must decline, and
/// each is only worth asserting because the eligible fixture in the same test
/// proves the sweep *did* run and *did* erase something.
#[tokio::test]
async fn the_sweep_erases_only_what_every_rule_agrees_on() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-sweep@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    // ---- the one that goes: closed 200 days ago, admin-verified ----------
    let closed = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (old_slip, old_file) = seed_slip(app.db(), closed, guest.id, "verified", &slips_dir).await;

    // ---- inside the window: closed, verified, but only 30 days ago -------
    // Without this the 90-day window is never actually exercised: every other
    // fixture is 200 days old, so a sweep that ignored the date entirely
    // would still pass.
    let recent = seed_booking(app.db(), guest.id, "checked_out", 30).await;
    let (recent_slip, recent_file) =
        seed_slip(app.db(), recent, guest.id, "verified", &slips_dir).await;

    // ---- one day short of the window: the boundary itself ----------------
    let boundary = seed_booking(app.db(), guest.id, "checked_out", 89).await;
    let (boundary_slip, boundary_file) =
        seed_slip(app.db(), boundary, guest.id, "verified", &slips_dir).await;

    // ---- open bookings: the stay is not over -----------------------------
    let checked_in = seed_booking(app.db(), guest.id, "checked_in", 200).await;
    let (checked_in_slip, checked_in_file) =
        seed_slip(app.db(), checked_in, guest.id, "verified", &slips_dir).await;

    let confirmed = seed_booking(app.db(), guest.id, "confirmed", 200).await;
    let (confirmed_slip, confirmed_file) =
        seed_slip(app.db(), confirmed, guest.id, "verified", &slips_dir).await;

    let pending_booking = seed_booking(app.db(), guest.id, "pending", 200).await;
    let (pending_booking_slip, pending_booking_file) =
        seed_slip(app.db(), pending_booking, guest.id, "verified", &slips_dir).await;

    // ---- closed, but the slip is undecided -------------------------------
    let undecided = seed_booking(app.db(), guest.id, "cancelled", 200).await;
    let (pending_slip, pending_file) =
        seed_slip(app.db(), undecided, guest.id, "pending", &slips_dir).await;

    let unset = seed_booking(app.db(), guest.id, "cancelled", 200).await;
    let (null_status_slip, null_status_file) =
        seed_slip_full(app.db(), unset, guest.id, None, None, &slips_dir).await;

    // `needs_action` is a decision to hand the slip BACK, not a decision that
    // the payment is settled — the image is the evidence behind an open
    // dispute, so it must survive.
    let disputed = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (needs_action_slip, needs_action_file) =
        seed_slip(app.db(), disputed, guest.id, "needs_action", &slips_dir).await;

    // A slip the machine routed to a human is undecided by the same logic.
    let manual = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (manual_slip, manual_file) = seed_slip_full(
        app.db(),
        manual,
        guest.id,
        Some("verified"),
        Some("manual"),
        &slips_dir,
    )
    .await;

    // ---- two rows, one file, and B's booking is still open --------------
    // A is eligible; B is not. Erasing for A would destroy the evidence
    // behind a live booking, so the whole group defers.
    let shared_a = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (shared_a_slip, shared_file) =
        seed_slip(app.db(), shared_a, guest.id, "verified", &slips_dir).await;
    let shared_b = seed_booking(app.db(), guest.id, "confirmed", 200).await;
    let shared_b_slip =
        seed_sharing_row(app.db(), shared_b, guest.id, "verified", &shared_file).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 1, "exactly the one eligible slip, and nothing else");

    // The file is genuinely gone from disk, not merely unreferenced.
    assert!(
        !slips_dir.join(&old_file).exists(),
        "the erased slip's file must actually be removed from disk"
    );

    // The row survives with a tombstone: it is payment evidence.
    let row = sqlx::query_as::<
        _,
        (
            Option<String>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<String>,
        ),
    >("SELECT slip_url, deleted_at, deletion_reason FROM booking_slips WHERE id = $1")
    .bind(old_slip)
    .fetch_one(app.db())
    .await
    .expect("the metadata row outlives the image");
    assert_eq!(row.0, None, "the stored path is nulled");
    assert!(row.1.is_some(), "deleted_at is stamped");
    assert_eq!(row.2.as_deref(), Some("retention_sweep"));

    // Everything else is exactly as it was — file on disk, path intact, no
    // tombstone.
    for (slip_id, file, why) in [
        (recent_slip, recent_file, "closed only 30 days ago"),
        (
            boundary_slip,
            boundary_file,
            "closed 89 days ago, one day inside a 90-day window",
        ),
        (checked_in_slip, checked_in_file, "booking still checked in"),
        (confirmed_slip, confirmed_file, "booking still confirmed"),
        (
            pending_booking_slip,
            pending_booking_file,
            "booking still pending",
        ),
        (
            pending_slip,
            pending_file,
            "slip still admin_status pending",
        ),
        (
            null_status_slip,
            null_status_file,
            "slip has no admin_status at all",
        ),
        (
            needs_action_slip,
            needs_action_file,
            "slip is needs_action, an open dispute",
        ),
        (
            manual_slip,
            manual_file,
            "slipok routed the slip to a human",
        ),
        (
            shared_a_slip,
            shared_file.clone(),
            "an *ineligible* live row shares this file",
        ),
    ] {
        assert!(
            slip_is_intact(app.db(), slip_id, &slips_dir.join(&file)).await,
            "must be kept: {}",
            why
        );
    }

    // And the row that shares the file is untouched too, which is the point.
    assert!(
        slip_is_intact(app.db(), shared_b_slip, &slips_dir.join(&shared_file)).await,
        "the other booking's evidence survives"
    );

    // Idempotent: a second pass finds nothing left to do and does not
    // double-count or fail on the file that is already gone.
    let again =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(again, 0, "the sweep is idempotent");

    app.cleanup().await.ok();
}

/// **The F2b fix.** Two closed, eligible bookings whose slip rows share one
/// image: under the first cut of the shared-file guard each saw the other as
/// a live referrer and deferred to it, so the image was never erased — a
/// permanent leak wearing a safety rule's clothes.
///
/// The sweep now decides per *file*: every live row pointing at the image is
/// eligible in this pass, so it unlinks once and tombstones both rows
/// together.
#[tokio::test]
async fn two_eligible_rows_sharing_one_file_are_erased_together() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-shared-both@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let first = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (first_slip, file_name) =
        seed_slip(app.db(), first, guest.id, "verified", &slips_dir).await;

    let second = seed_booking(app.db(), guest.id, "completed", 200).await;
    let second_slip = seed_sharing_row(app.db(), second, guest.id, "verified", &file_name).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;

    // One *image*, not one row: the return value counts files unlinked, and
    // the file backing both rows was unlinked exactly once.
    assert_eq!(
        erased, 1,
        "one image erased, however many rows were evidence for it"
    );
    assert!(
        !slips_dir.join(&file_name).exists(),
        "the shared image must actually leave the volume"
    );

    let first_stamp = assert_tombstoned(app.db(), first_slip, "the first sharer").await;
    let second_stamp = assert_tombstoned(app.db(), second_slip, "the second sharer").await;

    // `NOW()` is the transaction's start time, so identical stamps are proof
    // the two rows were retired by one statement. A row left un-tombstoned
    // beside a deleted file is the state the erase-then-tombstone ordering
    // exists to avoid, and half a group is exactly that state.
    assert_eq!(
        first_stamp, second_stamp,
        "both rows were tombstoned in the same transaction"
    );

    let again =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(again, 0, "nothing left to do on a second pass");

    app.cleanup().await.ok();
}

/// The other side of that coin, and the reason the group rule is not simply
/// "erase whatever is old": one sharer whose booking is still open keeps the
/// image, and keeps the *eligible* row's tombstone unwritten too. Its
/// `slip_url` must still resolve, because the file is still there.
#[tokio::test]
async fn one_open_sharer_defers_the_whole_group() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-shared-open@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let closed = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (closed_slip, file_name) =
        seed_slip(app.db(), closed, guest.id, "verified", &slips_dir).await;

    // Still checked in: the stay is not over, so this row is not eligible on
    // any reading, and the image is live evidence for it.
    let open = seed_booking(app.db(), guest.id, "checked_in", 200).await;
    let open_slip = seed_sharing_row(app.db(), open, guest.id, "verified", &file_name).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(
        erased, 0,
        "an open booking's evidence is not collateral for someone else's window"
    );

    for (slip_id, why) in [
        (closed_slip, "the eligible row defers with the group"),
        (open_slip, "the open booking's row is untouched"),
    ] {
        assert!(
            slip_is_intact(app.db(), slip_id, &slips_dir.join(&file_name)).await,
            "must be kept: {}",
            why
        );
    }

    app.cleanup().await.ok();
}

/// Deferral has to be a delay, not a life sentence: once the last sharer
/// closes and ages past the window, the same pair is erased. Without this the
/// group rule would be the old mutual-deferral bug with extra steps.
#[tokio::test]
async fn a_deferred_group_is_erased_once_its_last_sharer_becomes_eligible() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-shared-later@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let closed = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (closed_slip, file_name) =
        seed_slip(app.db(), closed, guest.id, "verified", &slips_dir).await;

    let open = seed_booking(app.db(), guest.id, "confirmed", 200).await;
    let open_slip = seed_sharing_row(app.db(), open, guest.id, "verified", &file_name).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 0, "deferred while one sharer is still open");
    assert!(slips_dir.join(&file_name).exists());

    // The booking finally closes, and closed long enough ago to be past the
    // window itself — the only thing that changes between the two sweeps.
    close_booking(app.db(), open, "checked_out", 200).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 1, "the group is erasable now that every sharer is");
    assert!(
        !slips_dir.join(&file_name).exists(),
        "the deferral was a delay, not a leak"
    );

    assert_tombstoned(app.db(), closed_slip, "the originally eligible row").await;
    assert_tombstoned(app.db(), open_slip, "the late sharer").await;

    app.cleanup().await.ok();
}

/// `GREATEST(check_out_date, cancelled_at, updated_at)` is the window's
/// closing moment, and this is the arm that is easy to leave untested: a stay
/// that ended 200 days ago but whose row was written *today*.
///
/// Something touched that booking recently — a correction, an admin note, a
/// late reconciliation — so its retention clock restarts. The sweep errs
/// towards deleting late rather than early, and a control fixture in the same
/// pass proves the sweep ran at all.
#[tokio::test]
async fn a_recent_updated_at_holds_an_old_stay_inside_the_window() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-touched@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let touched = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (touched_slip, touched_file) =
        seed_slip(app.db(), touched, guest.id, "verified", &slips_dir).await;
    touch_booking(app.db(), touched).await;

    // Identical in every way except that nobody has touched it.
    let control = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (control_slip, control_file) =
        seed_slip(app.db(), control, guest.id, "verified", &slips_dir).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 1, "the control was erased, so the sweep did run");
    assert!(!slips_dir.join(&control_file).exists());
    assert_tombstoned(app.db(), control_slip, "the untouched control").await;

    assert!(
        slip_is_intact(app.db(), touched_slip, &slips_dir.join(&touched_file)).await,
        "a stay that ended 200 days ago but was written today is still inside the window"
    );

    app.cleanup().await.ok();
}

/// `completed` and `no_show` are closed states the module claims to sweep,
/// and until now only `checked_out` and `cancelled` had fixtures. A status
/// list is exactly the kind of thing that loses an entry in a refactor
/// without a test noticing.
#[tokio::test]
async fn completed_and_no_show_bookings_are_swept_too() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-closed-states@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let completed = seed_booking(app.db(), guest.id, "completed", 200).await;
    let (completed_slip, completed_file) =
        seed_slip(app.db(), completed, guest.id, "verified", &slips_dir).await;

    let no_show = seed_booking(app.db(), guest.id, "no_show", 200).await;
    let (no_show_slip, no_show_file) =
        seed_slip(app.db(), no_show, guest.id, "verified", &slips_dir).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 2, "both closed states are swept");

    for (slip_id, file, status) in [
        (completed_slip, completed_file, "completed"),
        (no_show_slip, no_show_file, "no_show"),
    ] {
        assert!(
            !slips_dir.join(&file).exists(),
            "a {} booking's slip image must be erased",
            status
        );
        assert_tombstoned(app.db(), slip_id, status).await;
    }

    app.cleanup().await.ok();
}

/// The safety property the whole design turns on: with `SLIP_RETENTION_DAYS`
/// unset — which is production today, and stays that way until the owner
/// picks a number — the sweep erases nothing at all.
///
/// The fixture goes in the directory the *configured* sweep actually reads
/// (`slip_retention::configured_slips_dir`, i.e. `STORAGE_PATH/slips`), not a
/// tempdir. In a tempdir "the file survived" would be true no matter what the
/// code did, because the sweep would never have looked there. The positive
/// control at the end is what proves the directory is the right one: switch
/// the window on and the very same file is erased.
#[tokio::test]
async fn the_sweep_is_a_no_op_while_the_window_is_unset() {
    let app = TestApp::new().await.expect("create test app");
    let slips_dir = loyalty_backend::services::slip_retention::configured_slips_dir();

    let guest = TestUser::new("retention-unset@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    // As eligible as a slip can get: closed years ago, admin-verified.
    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 3000).await;
    let (slip_id, file_name) =
        seed_slip(app.db(), booking_id, guest.id, "verified", &slips_dir).await;

    let mut config = crate::common::test_app_state_config();
    assert!(
        config.retention.slip_retention_days().is_none(),
        "the test config must mirror production's unset window"
    );

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips(app.db(), &config).await;

    assert_eq!(erased, 0, "no window, no erasure");
    assert!(
        slips_dir.join(&file_name).exists(),
        "an unconfigured retention window must not delete anything"
    );
    let deleted_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT deleted_at FROM booking_slips WHERE id = $1")
            .bind(slip_id)
            .fetch_one(app.db())
            .await
            .expect("row unchanged");
    assert!(deleted_at.is_none(), "no tombstone either");

    // Positive control. Same slip, same directory, same call — the only
    // change is that the window is now set. If this does not erase, the
    // assertions above were vacuous.
    config.retention.slip_days = Some("90".to_string());
    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips(app.db(), &config).await;
    assert_eq!(erased, 1, "with a window set, the same slip IS erased");
    assert!(
        !slips_dir.join(&file_name).exists(),
        "which proves the unset case was looking at the right directory"
    );

    app.cleanup().await.ok();
}

/// A window the config layer refuses is a window the sweep must not run on.
///
/// The value here is past `i32::MAX`, which is the one that matters: as a
/// bare `as i32` cast it wraps negative, `make_interval` builds an interval
/// into the future, and "erase slips older than N days" becomes "erase
/// everything closed".
#[tokio::test]
async fn an_out_of_range_window_erases_nothing() {
    let app = TestApp::new().await.expect("create test app");
    let slips_dir = loyalty_backend::services::slip_retention::configured_slips_dir();

    let guest = TestUser::new("retention-overflow@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 3000).await;
    let (slip_id, file_name) =
        seed_slip(app.db(), booking_id, guest.id, "verified", &slips_dir).await;

    let mut config = crate::common::test_app_state_config();
    for absurd in ["0", "3651", "4294967295", "2147483648"] {
        config.retention.slip_days = Some(absurd.to_string());
        assert!(
            config.retention.slip_retention_days().is_none(),
            "{} must not be accepted as a window",
            absurd
        );
        let erased =
            loyalty_backend::services::slip_retention::sweep_expired_slips(app.db(), &config).await;
        assert_eq!(erased, 0, "window {} erased something", absurd);
        assert!(
            slips_dir.join(&file_name).exists(),
            "window {} deleted the file",
            absurd
        );
    }

    let deleted_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT deleted_at FROM booking_slips WHERE id = $1")
            .bind(slip_id)
            .fetch_one(app.db())
            .await
            .expect("row unchanged");
    assert!(deleted_at.is_none());

    let _ = std::fs::remove_file(slips_dir.join(&file_name));
    app.cleanup().await.ok();
}

/// After an erase, the admin surface has to say *"this was deleted, and
/// when"* — not blow up decoding a NULL into a `String`, which is exactly
/// what dropping the column's `NOT NULL` would otherwise have caused.
#[tokio::test]
async fn an_erased_slips_admin_view_reports_the_deletion_instead_of_failing() {
    let app = TestApp::new().await.expect("create test app");
    // The fixture lives in the directory `serve_slip` actually reads, so the
    // 404 at the end is a statement about the erase and not about the test
    // having written the file somewhere the route never looks.
    let slips_dir = served_slips_dir();

    let guest = TestUser::new("retention-gone-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin = TestUser::admin("retention-gone-admin@test.com");
    admin.insert(app.db()).await.expect("insert admin");

    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (slip_id, file_name) =
        seed_slip(app.db(), booking_id, guest.id, "verified", &slips_dir).await;

    // Before: the image really is served from here, so the 404 below is a
    // change of state rather than a file that was never reachable.
    let (status, bytes) = get_slip_image(&app, &admin.id, &admin.email, "admin", &file_name).await;
    assert_eq!(status, 200, "the image is reachable before the sweep runs");
    assert_eq!(bytes, TINY_PNG);

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 1, "the sweep erased the slip under test");
    assert!(
        !slips_dir.join(&file_name).exists(),
        "and the file is gone from the directory the route reads"
    );

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let response = client
        .get(&format!("/api/admin/bookings/slips/{}", slip_id))
        .await;
    response.assert_status(200);
    let body: Value = response.json().expect("slip detail");
    assert!(
        body["slipUrl"].is_null(),
        "an erased slip has no path, and never an empty string that still looks like one"
    );
    assert!(
        body["deletedAt"].as_str().is_some(),
        "the response says when it was erased"
    );
    assert_eq!(body["deletionReason"].as_str(), Some("retention_sweep"));
    assert_eq!(
        body["id"].as_str(),
        Some(slip_id.to_string()).as_deref(),
        "the payment record itself is still there"
    );

    // The booking list carries the same tombstone rather than a broken
    // `imageUrl`, so the console can explain the missing thumbnail.
    let response = client
        .get(&format!("/api/admin/bookings/{}", booking_id))
        .await;
    response.assert_status(200);
    let body: Value = response.json().expect("booking detail");
    // `AdminBookingDetail` flattens the list item, so the slip sits at the
    // top level next to `auditHistory`.
    assert!(body["slip"]["imageUrl"].is_null());
    assert!(body["slip"]["deletedAt"].as_str().is_some());

    // And the image route answers a clean 404 rather than a 500 — the bytes
    // are gone and the URL no longer resolves to anything.
    let (status, _) = get_slip_image(&app, &admin.id, &admin.email, "admin", &file_name).await;
    assert_eq!(status, 404);

    app.cleanup().await.ok();
}

/// The access history has to outlive the slip row. A hard delete of the slip
/// (the guest's `DELETE /api/bookings/slips/:slip_id`, or a booking being
/// removed) must not take the record of who read it — that is the one moment
/// the record matters most.
#[tokio::test]
async fn the_access_log_survives_the_slip_being_deleted() {
    let app = TestApp::new().await.expect("create test app");
    let dir = served_slips_dir();

    let guest = TestUser::new("retention-survive-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin = TestUser::admin("retention-survive-admin@test.com");
    admin.insert(app.db()).await.expect("insert admin");

    let booking_id = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let (slip_id, file_name) = seed_slip(app.db(), booking_id, guest.id, "pending", &dir).await;

    let (status, _) = get_slip_image(&app, &admin.id, &admin.email, "admin", &file_name).await;
    assert_eq!(status, 200);
    assert_eq!(count_access_rows(app.db(), slip_id).await, 1);

    sqlx::query("DELETE FROM booking_slips WHERE id = $1")
        .bind(slip_id)
        .execute(app.db())
        .await
        .expect("hard-delete the slip row");

    let orphans: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM slip_access_log WHERE admin_id = $1 AND slip_id IS NULL",
    )
    .bind(admin.id)
    .fetch_one(app.db())
    .await
    .expect("count orphaned access rows");

    assert_eq!(
        orphans, 1,
        "the read survives as an un-attributed row (ON DELETE SET NULL), not a cascade"
    );

    let _ = std::fs::remove_file(dir.join(&file_name));
    app.cleanup().await.ok();
}

/// One file must not back two live slip rows — that is what makes the
/// retention sweep able to destroy a *different* booking's evidence, and it
/// is also slip reuse as a way to claim a payment somebody else made.
#[tokio::test]
async fn attaching_an_already_attached_slip_url_is_refused() {
    let app = TestApp::new().await.expect("create test app");
    let dir = served_slips_dir();

    let guest = TestUser::new("retention-dupe@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    let first_booking = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let (_, file_name) = seed_slip(app.db(), first_booking, guest.id, "pending", &dir).await;

    let second_booking = seed_booking(app.db(), guest.id, "confirmed", 0).await;
    let client = app.authenticated_client(&guest.id, &guest.email);
    let response = client
        .post(
            &format!("/api/bookings/{}/slips", second_booking),
            &serde_json::json!({ "slipUrl": format!("/storage/slips/{}", file_name) }),
        )
        .await;
    response.assert_status(409);

    let rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM booking_slips WHERE slip_url = $1 AND deleted_at IS NULL",
    )
    .bind(format!("/storage/slips/{}", file_name))
    .fetch_one(app.db())
    .await
    .expect("count rows sharing the file");
    assert_eq!(rows, 1, "the duplicate row was never created");

    let _ = std::fs::remove_file(dir.join(&file_name));
    app.cleanup().await.ok();
}
