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

use serde_json::Value;
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

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
    let slip_id = Uuid::new_v4();
    let file_name = format!("{}.png", Uuid::new_v4());
    let slip_url = format!("/storage/slips/{}", file_name);

    std::fs::create_dir_all(slips_dir).expect("create slips dir");
    std::fs::write(slips_dir.join(&file_name), TINY_PNG).expect("write slip fixture");

    sqlx::query(
        r#"
        INSERT INTO booking_slips (id, booking_id, slip_url, uploaded_by, admin_status)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(slip_id)
    .bind(booking_id)
    .bind(&slip_url)
    .bind(uploaded_by)
    .bind(admin_status)
    .execute(pool)
    .await
    .expect("insert booking_slips");

    (slip_id, file_name)
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

    let client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");
    let response = client
        .get(&format!("/api/storage/slips/{}", file_name))
        .await;
    response.assert_status(200);

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

    let client = app.authenticated_client(&guest.id, &guest.email);
    let response = client
        .get(&format!("/api/storage/slips/{}", file_name))
        .await;
    response.assert_status(200);

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

// ============================================================================
// Retention sweep
// ============================================================================

/// The sweep erases the image of a closed booking past the window, tombstones
/// its row, and leaves an open booking's slip completely alone.
#[tokio::test]
async fn the_sweep_erases_a_closed_bookings_slip_and_spares_an_open_one() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-sweep@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    // Checked out 200 days ago, decided by an admin: eligible.
    let closed = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (old_slip, old_file) = seed_slip(app.db(), closed, guest.id, "verified", &slips_dir).await;

    // Still checked in: the stay is not over, so nothing about it is stale.
    let open = seed_booking(app.db(), guest.id, "checked_in", 200).await;
    let (open_slip, open_file) = seed_slip(app.db(), open, guest.id, "verified", &slips_dir).await;

    // Closed just as long ago, but nobody has decided it yet — the image is
    // still the input to a decision somebody owes.
    let undecided_booking = seed_booking(app.db(), guest.id, "cancelled", 200).await;
    let (undecided_slip, undecided_file) =
        seed_slip(app.db(), undecided_booking, guest.id, "pending", &slips_dir).await;

    let erased =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(erased, 1, "exactly the one eligible slip");

    // The file is genuinely gone from disk, not merely unreferenced.
    assert!(
        !slips_dir.join(&old_file).exists(),
        "the erased slip's file must actually be removed from disk"
    );
    assert!(
        slips_dir.join(&open_file).exists(),
        "open booking untouched"
    );
    assert!(
        slips_dir.join(&undecided_file).exists(),
        "a slip still awaiting a decision is untouched"
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

    for untouched in [open_slip, undecided_slip] {
        let still: (Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
            sqlx::query_as("SELECT slip_url, deleted_at FROM booking_slips WHERE id = $1")
                .bind(untouched)
                .fetch_one(app.db())
                .await
                .expect("row still there");
        assert!(still.0.is_some(), "path kept");
        assert!(still.1.is_none(), "no tombstone");
    }

    // Idempotent: a second pass finds nothing left to do and does not
    // double-count or fail on the file that is already gone.
    let again =
        loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
            .await;
    assert_eq!(again, 0, "the sweep is idempotent");

    app.cleanup().await.ok();
}

/// The safety property the whole design turns on: with `SLIP_RETENTION_DAYS`
/// unset — which is production today, and stays that way until the owner
/// picks a number — the sweep erases nothing at all.
#[tokio::test]
async fn the_sweep_is_a_no_op_while_the_window_is_unset() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-unset@test.com");
    guest.insert(app.db()).await.expect("insert guest");

    // As eligible as a slip can get: closed years ago, admin-decided.
    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 3000).await;
    let (slip_id, file_name) =
        seed_slip(app.db(), booking_id, guest.id, "verified", &slips_dir).await;

    let config = crate::common::test_app_state_config();
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

    app.cleanup().await.ok();
}

/// After an erase, the admin surface has to say *"this was deleted, and
/// when"* — not blow up decoding a NULL into a `String`, which is exactly
/// what dropping the column's `NOT NULL` would otherwise have caused.
#[tokio::test]
async fn an_erased_slips_admin_view_reports_the_deletion_instead_of_failing() {
    let app = TestApp::new().await.expect("create test app");
    let temp = tempfile::tempdir().expect("tempdir");
    let slips_dir = temp.path().join("slips");

    let guest = TestUser::new("retention-gone-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin = TestUser::admin("retention-gone-admin@test.com");
    admin.insert(app.db()).await.expect("insert admin");

    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 200).await;
    let (slip_id, file_name) =
        seed_slip(app.db(), booking_id, guest.id, "verified", &slips_dir).await;

    loyalty_backend::services::slip_retention::sweep_expired_slips_in(app.db(), 90, &slips_dir)
        .await;

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
    let response = client
        .get(&format!("/api/storage/slips/{}", file_name))
        .await;
    response.assert_status(404);

    app.cleanup().await.ok();
}
