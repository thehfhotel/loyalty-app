//! PDPA data-subject rights requests (F3,
//! `docs/privacy/2026-09-pdpa-data-map.md` §8 gap 7).
//!
//! Four properties the rights path has to hold, each turned into an
//! assertion:
//!
//! 1. A second open request of the same kind is a 409, not a second row.
//!    A member who taps twice must not end up with two erasure requests
//!    and a desk that answers one of them.
//! 2. Every route needs authentication. A rights path that leaks a
//!    member's request history would be a privacy incident created by the
//!    privacy feature.
//! 3. The export is admin-only. A member filing an access request must not
//!    be able to fetch the export themselves — the identity check that
//!    releases it is a human step (`docs/privacy/rights-path.md`).
//! 4. The export carries slip **metadata** and never the slip image.
//!    §1 of the map: the payer on a slip is frequently not the guest, so
//!    the image is third-party banking data an s.30 request does not
//!    cover.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Fixtures
// ============================================================================

fn unique_email(prefix: &str) -> String {
    format!("{prefix}-{}@example.com", Uuid::new_v4())
}

/// A member with a profile, so `membership_id` exists for the admin queue.
async fn create_member(pool: &sqlx::PgPool, prefix: &str) -> TestUser {
    let user = TestUser::new(&unique_email(prefix));
    user.insert_with_profile(pool, "Somchai", "Jaidee")
        .await
        .expect("failed to insert member");
    user
}

async fn create_admin(pool: &sqlx::PgPool, prefix: &str) -> TestUser {
    let admin = TestUser::admin(&unique_email(prefix));
    admin
        .insert_with_profile(pool, "Ad", "Min")
        .await
        .expect("failed to insert admin");
    admin
}

/// A booking with one slip hanging off it, so the export has slip metadata
/// to include and a `slip_url` to leave out.
///
/// `trans_ref` is a parameter rather than a constant because
/// `booking_slips_slipok_trans_ref_uidx` is a **global** unique index — it is
/// the duplicate-slip detection key (F1 §1), so two fixtures in one test
/// cannot share a reference any more than two real guests could.
async fn create_booking_with_slip(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    trans_ref: &str,
) -> (Uuid, Uuid) {
    let room_type_id: Uuid = sqlx::query_scalar(
        "INSERT INTO room_types (id, name, price_per_night, max_guests, is_active) \
         VALUES ($1, $2, 2000.00, 2, true) RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(format!("Deluxe-{}", Uuid::new_v4()))
    .fetch_one(pool)
    .await
    .expect("room type insert failed");

    let room_id: Uuid = sqlx::query_scalar(
        "INSERT INTO rooms (id, room_type_id, room_number, floor, is_active) \
         VALUES ($1, $2, $3, 7, true) RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .bind(Uuid::new_v4().to_string()[..6].to_string())
    .fetch_one(pool)
    .await
    .expect("room insert failed");

    let booking_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bookings (id, user_id, room_id, room_type_id, check_in_date, \
         check_out_date, num_guests, total_price, status, guest_name, guest_phone) \
         VALUES ($1, $2, $3, $4, DATE '2026-10-01', DATE '2026-10-03', 2, 4000.00, \
         'completed', 'Somchai Jaidee', '0812345678')",
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(room_id)
    .bind(room_type_id)
    .execute(pool)
    .await
    .expect("booking insert failed");

    let slip_id = Uuid::new_v4();
    // `uq_booking_slips_slip_url_live` makes the path unique among live
    // rows, so the fixture derives it from the slip id. The
    // `f3-secret-payer-image` marker survives, because that string is what
    // the leak assertions grep the serialised export for.
    let slip_url = format!("/storage/slips/f3-secret-payer-image-{slip_id}.jpg");
    sqlx::query(
        "INSERT INTO booking_slips (id, booking_id, slip_url, uploaded_by, slipok_status, \
         slipok_trans_ref, admin_status, is_primary) \
         VALUES ($1, $2, $3, $4, 'success', $5, 'verified', true)",
    )
    .bind(slip_id)
    .bind(booking_id)
    .bind(&slip_url)
    .bind(user_id)
    .bind(trans_ref)
    .execute(pool)
    .await
    .expect("slip insert failed");

    (booking_id, slip_id)
}

// ============================================================================
// 1. One open request per kind
// ============================================================================

/// The headline rule. The guard is a partial unique index, so this holds
/// even when the second request arrives before the first has been read.
#[tokio::test]
async fn a_second_open_request_of_the_same_kind_is_a_409() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "dup").await;
    let client = app.authenticated_client(&member.id, &member.email);

    let first = client
        .post(
            "/api/privacy/requests",
            &json!({ "kind": "access", "note": "ขอสำเนาข้อมูลของฉัน" }),
        )
        .await;
    first.assert_status(201);

    let second = client
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await;
    second.assert_status(409);

    let rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM privacy_requests WHERE user_id = $1 AND kind = 'access'",
    )
    .bind(member.id)
    .fetch_one(app.db())
    .await
    .expect("count failed");
    assert_eq!(
        rows, 1,
        "the 409 must prevent the row, not just the response"
    );

    app.cleanup().await.ok();
}

/// The guard is per kind, not per member: someone asking for both a copy
/// and an erasure is making two different requests with two different
/// clocks.
#[tokio::test]
async fn a_different_kind_is_not_a_duplicate() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "kinds").await;
    let client = app.authenticated_client(&member.id, &member.email);

    for kind in ["access", "erasure", "rectification", "objection"] {
        let response = client
            .post("/api/privacy/requests", &json!({ "kind": kind }))
            .await;
        response.assert_status(201);
    }

    let body: Value = client
        .get("/api/privacy/requests")
        .await
        .json()
        .expect("response should be JSON");
    let requests = body["requests"].as_array().expect("requests array");
    assert_eq!(requests.len(), 4, "all four rights are separately askable");
    assert_eq!(body["responseWindowDays"].as_i64(), Some(30));

    app.cleanup().await.ok();
}

/// A closed request must not block a new one — the index is partial for
/// exactly this reason. A member refused last year can ask again.
#[tokio::test]
async fn a_resolved_request_does_not_block_a_new_one() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "reopen").await;
    let admin = create_admin(app.db(), "reopen-admin").await;
    let member_client = app.authenticated_client(&member.id, &member.email);
    let admin_client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let created: Value = member_client
        .post("/api/privacy/requests", &json!({ "kind": "rectification" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    admin_client
        .patch(
            &format!("/api/admin/privacy/requests/{request_id}"),
            &json!({ "status": "refused", "resolutionNote": "Could not verify identity" }),
        )
        .await
        .assert_status(200);

    member_client
        .post("/api/privacy/requests", &json!({ "kind": "rectification" }))
        .await
        .assert_status(201);

    app.cleanup().await.ok();
}

/// A terminal status without a written reason is refused. PDPA does not
/// recognise an unexplained refusal, and "done" with no note leaves the
/// desk unable to say what was actually done.
#[tokio::test]
async fn closing_a_request_requires_a_resolution_note() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "note").await;
    let admin = create_admin(app.db(), "note-admin").await;
    let member_client = app.authenticated_client(&member.id, &member.email);
    let admin_client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let created: Value = member_client
        .post("/api/privacy/requests", &json!({ "kind": "objection" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    let no_note = admin_client
        .patch(
            &format!("/api/admin/privacy/requests/{request_id}"),
            &json!({ "status": "done" }),
        )
        .await;
    assert_eq!(no_note.status, 400, "body: {}", no_note.body);

    // `in_progress` is not terminal, so it needs no note.
    admin_client
        .patch(
            &format!("/api/admin/privacy/requests/{request_id}"),
            &json!({ "status": "in_progress" }),
        )
        .await
        .assert_status(200);

    app.cleanup().await.ok();
}

// ============================================================================
// 2. Authentication
// ============================================================================

#[tokio::test]
async fn every_privacy_route_requires_authentication() {
    let app = TestApp::new().await.expect("failed to create test app");
    let anonymous = app.client();

    anonymous
        .get("/api/privacy/requests")
        .await
        .assert_status(401);
    anonymous
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .assert_status(401);
    anonymous
        .get(&format!("/api/privacy/requests/{}/export", Uuid::new_v4()))
        .await
        .assert_status(401);
    anonymous
        .get("/api/admin/privacy/requests")
        .await
        .assert_status(401);

    app.cleanup().await.ok();
}

/// The member list is scoped by the JWT, not by a parameter — so there is
/// no id for one member to substitute for another's.
#[tokio::test]
async fn a_member_sees_only_their_own_requests() {
    let app = TestApp::new().await.expect("failed to create test app");
    let alice = create_member(app.db(), "alice").await;
    let bob = create_member(app.db(), "bob").await;

    app.authenticated_client(&alice.id, &alice.email)
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .assert_status(201);

    let body: Value = app
        .authenticated_client(&bob.id, &bob.email)
        .get("/api/privacy/requests")
        .await
        .json()
        .expect("response should be JSON");
    assert_eq!(
        body["requests"].as_array().expect("requests array").len(),
        0,
        "one member's request must never appear in another's list"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 3. The export is admin-only
// ============================================================================

#[tokio::test]
async fn the_export_is_admin_only_on_both_paths() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "export-403").await;
    let member_client = app.authenticated_client(&member.id, &member.email);

    let created: Value = member_client
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    // The member owns the request and still cannot fetch its export: the
    // identity check that releases it is a human step.
    member_client
        .get(&format!("/api/privacy/requests/{request_id}/export"))
        .await
        .assert_status(403);
    member_client
        .get(&format!("/api/admin/privacy/requests/{request_id}/export"))
        .await
        .assert_status(403);

    // And the queue itself.
    member_client
        .get("/api/admin/privacy/requests")
        .await
        .assert_status(403);

    app.cleanup().await.ok();
}

/// An export answers an access request. Asking for one against an erasure
/// request is a mistake worth naming rather than a silent empty document.
#[tokio::test]
async fn an_export_is_refused_for_a_non_access_request() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "export-kind").await;
    let admin = create_admin(app.db(), "export-kind-admin").await;

    let created: Value = app
        .authenticated_client(&member.id, &member.email)
        .post("/api/privacy/requests", &json!({ "kind": "objection" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    let response = app
        .authenticated_client_with_role(&admin.id, &admin.email, "admin")
        .get(&format!("/api/admin/privacy/requests/{request_id}/export"))
        .await;
    assert_eq!(response.status, 400, "body: {}", response.body);

    app.cleanup().await.ok();
}

// ============================================================================
// 4. The export excludes slip images
// ============================================================================

/// The assertion the whole feature turns on. The export must carry the
/// slip's *metadata* — which is the guest's own payment evidence — and
/// must never carry `slip_url` or anything else that points at the image,
/// because the image shows a third party's bank account.
#[tokio::test]
async fn the_access_export_carries_slip_metadata_but_never_the_image() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "export").await;
    let admin = create_admin(app.db(), "export-admin").await;
    let (booking_id, slip_id) =
        create_booking_with_slip(app.db(), member.id, "TRX-F3-EXPORT").await;

    let created: Value = app
        .authenticated_client(&member.id, &member.email)
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    let response = app
        .authenticated_client_with_role(&admin.id, &admin.email, "admin")
        .get(&format!("/api/admin/privacy/requests/{request_id}/export"))
        .await;
    response.assert_status(200);
    let body: Value = response.json().expect("response should be JSON");

    // The metadata is there, keyed to the right booking and slip.
    let slips = body["data"]["paymentSlips"]
        .as_array()
        .expect("paymentSlips array");
    assert_eq!(
        slips.len(),
        1,
        "the member's one slip must be in the export"
    );
    assert_eq!(slips[0]["id"].as_str(), Some(slip_id.to_string().as_str()));
    assert_eq!(
        slips[0]["booking_id"].as_str(),
        Some(booking_id.to_string().as_str())
    );
    assert_eq!(slips[0]["slipok_trans_ref"].as_str(), Some("TRX-F3-EXPORT"));
    assert_eq!(slips[0]["admin_status"].as_str(), Some("verified"));

    // The image is not — not as a column, not as a path, not anywhere in
    // the serialised document. The raw-string search is the assertion that
    // survives a future column being added under a different name.
    assert!(
        slips[0].get("slip_url").is_none(),
        "slip_url must not be a field of an exported slip"
    );
    let raw = serde_json::to_string(&body).expect("serialise");
    assert!(
        !raw.contains("f3-secret-payer-image"),
        "the slip image path leaked into the export: {raw}"
    );
    assert!(
        !raw.contains("/storage/slips/"),
        "no path into the slip store may appear in an export"
    );

    // And the exclusion is stated, not merely performed.
    assert_eq!(body["slipImages"]["included"].as_bool(), Some(false));
    assert!(body["slipImages"]["reason"]
        .as_str()
        .expect("reason")
        .contains("third party"));

    // The rest of the document is present and belongs to this member.
    assert_eq!(
        body["data"]["profile"]["user_id"].as_str(),
        Some(member.id.to_string().as_str())
    );
    assert_eq!(
        body["data"]["bookings"]
            .as_array()
            .expect("bookings array")
            .len(),
        1
    );
    assert!(body["data"]["pointsTransactions"].is_array());
    assert!(body["data"]["coupons"].is_array());
    assert!(body["data"]["surveyResponses"].is_array());

    // Gap 2 of the map, generalised: the bulk read is attributable.
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_audit_log WHERE user_id = $1 AND action = 'privacy_access_export'",
    )
    .bind(member.id)
    .fetch_one(app.db())
    .await
    .expect("count failed");
    assert_eq!(
        audited, 1,
        "an export nobody can attribute is one we should not have produced"
    );

    app.cleanup().await.ok();
}

/// An export must never carry another member's rows. The join is on
/// `bookings.user_id`, and this is the test that keeps it there.
#[tokio::test]
async fn an_export_never_includes_another_members_data() {
    let app = TestApp::new().await.expect("failed to create test app");
    let subject = create_member(app.db(), "subject").await;
    let stranger = create_member(app.db(), "stranger").await;
    let admin = create_admin(app.db(), "leak-admin").await;

    create_booking_with_slip(app.db(), subject.id, "TRX-F3-SUBJECT").await;
    let (stranger_booking, _) =
        create_booking_with_slip(app.db(), stranger.id, "TRX-F3-STRANGER").await;

    let created: Value = app
        .authenticated_client(&subject.id, &subject.email)
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    let body: Value = app
        .authenticated_client_with_role(&admin.id, &admin.email, "admin")
        .get(&format!("/api/admin/privacy/requests/{request_id}/export"))
        .await
        .json()
        .expect("response should be JSON");

    let raw = serde_json::to_string(&body).expect("serialise");
    assert!(
        !raw.contains(&stranger_booking.to_string()),
        "another member's booking appeared in this export"
    );
    assert!(
        !raw.contains(&stranger.email),
        "another member's email appeared in this export"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// 5. Erasure calls the shared path
// ============================================================================

/// Resolving an erasure as `done` must run the real erase — the same
/// `services::account_deletion::erase_account` the member's own
/// `DELETE /api/users/account` runs — and must record it as admin-actored.
/// A rights path that marked an erasure complete without erasing anything
/// would be worse than having no rights path.
#[tokio::test]
async fn resolving_an_erasure_runs_the_shared_account_deletion() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "erase").await;
    let admin = create_admin(app.db(), "erase-admin").await;

    let created: Value = app
        .authenticated_client(&member.id, &member.email)
        .post("/api/privacy/requests", &json!({ "kind": "erasure" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    app.authenticated_client_with_role(&admin.id, &admin.email, "admin")
        .patch(
            &format!("/api/admin/privacy/requests/{request_id}"),
            &json!({ "status": "done", "resolutionNote": "Erased on request; booking records kept per retention" }),
        )
        .await
        .assert_status(200);

    // The identifiers are gone and the tombstone is set.
    let (email, deleted_at): (Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT email, deleted_at FROM users WHERE id = $1")
            .bind(member.id)
            .fetch_one(app.db())
            .await
            .expect("user read failed");
    assert!(email.is_none(), "the erase must null the email");
    assert!(deleted_at.is_some(), "the erase must set the tombstone");

    // And the erasure is attributed to the admin, via the shared service's
    // own audit row rather than a second one written here.
    let actor: String = sqlx::query_scalar("SELECT actor FROM user_deletions WHERE user_id = $1")
        .bind(member.id)
        .fetch_one(app.db())
        .await
        .expect("user_deletions read failed");
    assert_eq!(
        actor, "admin",
        "an admin-run erasure must not be recorded as self-service"
    );

    app.cleanup().await.ok();
}

/// A request that is already closed cannot be closed again: the second
/// admin is working from a stale screen, and silently overwriting the
/// first resolution note would lose the record of what was decided.
#[tokio::test]
async fn a_closed_request_cannot_be_resolved_twice() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "twice").await;
    let admin = create_admin(app.db(), "twice-admin").await;
    let admin_client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    let created: Value = app
        .authenticated_client(&member.id, &member.email)
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .json()
        .expect("response should be JSON");
    let request_id = created["id"].as_str().expect("id").to_string();

    admin_client
        .patch(
            &format!("/api/admin/privacy/requests/{request_id}"),
            &json!({ "status": "done", "resolutionNote": "Export sent by email" }),
        )
        .await
        .assert_status(200);

    admin_client
        .patch(
            &format!("/api/admin/privacy/requests/{request_id}"),
            &json!({ "status": "refused", "resolutionNote": "Changed my mind" }),
        )
        .await
        .assert_status(409);

    app.cleanup().await.ok();
}

// ============================================================================
// 6. The admin queue and its clock
// ============================================================================

/// The desk sees live work by default, with the 30-day deadline computed
/// per row. `overdue` is derived, never stored — a stored flag would need
/// a job to keep it true.
#[tokio::test]
async fn the_admin_queue_shows_live_work_and_the_thirty_day_clock() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "queue").await;
    let admin = create_admin(app.db(), "queue-admin").await;
    let admin_client = app.authenticated_client_with_role(&admin.id, &admin.email, "admin");

    app.authenticated_client(&member.id, &member.email)
        .post("/api/privacy/requests", &json!({ "kind": "access" }))
        .await
        .assert_status(201);

    // Backdate it past the window so `overdue` has something to be true
    // about. The 30 days are the PDPA s.30 default.
    sqlx::query(
        "UPDATE privacy_requests SET requested_at = NOW() - INTERVAL '31 days' WHERE user_id = $1",
    )
    .bind(member.id)
    .execute(app.db())
    .await
    .expect("backdate failed");

    let body: Value = admin_client
        .get("/api/admin/privacy/requests")
        .await
        .json()
        .expect("response should be JSON");

    let requests = body["requests"].as_array().expect("requests array");
    let mine = requests
        .iter()
        .find(|r| r["userId"].as_str() == Some(member.id.to_string().as_str()))
        .expect("the member's request must be in the queue");
    assert_eq!(mine["kind"].as_str(), Some("access"));
    assert_eq!(mine["status"].as_str(), Some("open"));
    assert_eq!(mine["overdue"].as_bool(), Some(true));
    assert!(mine["dueAt"].is_string(), "the deadline must be on the row");
    assert!(
        mine["membershipId"].is_string(),
        "the desk needs a way to identify the member"
    );
    assert!(body["overdueCount"].as_i64().unwrap_or(0) >= 1);

    app.cleanup().await.ok();
}

/// An unknown kind is a 400 at the boundary, decided by serde, not a
/// constraint violation surfacing as a 500 from the database.
#[tokio::test]
async fn an_unknown_kind_is_rejected_before_the_database() {
    let app = TestApp::new().await.expect("failed to create test app");
    let member = create_member(app.db(), "badkind").await;

    let response = app
        .authenticated_client(&member.id, &member.email)
        .post("/api/privacy/requests", &json!({ "kind": "deletion" }))
        .await;
    assert!(
        response.status == 400 || response.status == 422,
        "expected a client error for an unknown kind, got {}: {}",
        response.status,
        response.body
    );

    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM privacy_requests WHERE user_id = $1")
        .bind(member.id)
        .fetch_one(app.db())
        .await
        .expect("count failed");
    assert_eq!(rows, 0);

    app.cleanup().await.ok();
}
