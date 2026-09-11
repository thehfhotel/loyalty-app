//! Integration tests for task F10 — retention for `booking_audit_log` and
//! `slip_access_log`.
//!
//! Both tables were unbounded (`docs/public-launch-readiness.md` HIGH-5;
//! `docs/privacy/2026-09-pdpa-data-map.md` §7, §8 item 11) and
//! `slip_access_log` is the one that grows fast — the admin bookings list
//! writes one row per slip per page load.
//!
//! What is asserted here is the four promises the prune makes:
//!
//! 1. it does **nothing at all** until an operator names a window;
//! 2. past the window rows go, inside it they stay;
//! 3. a booking that is still open keeps its whole trail regardless of age;
//! 4. a window below the PDPA floor is refused at config, so the prune never
//!    sees it.

use uuid::Uuid;

use crate::common::{TestApp, TestUser};

// ============================================================================
// Fixtures
// ============================================================================

/// Get-or-create the room type and mint a **fresh room** for the caller.
///
/// A new room every time on purpose: `bookings_no_overlap` is an `EXCLUDE
/// USING gist` on `(room_id, daterange(check_in, check_out))` for every
/// status except `cancelled`/`no_show`, so two fixtures sharing a room and a
/// date range would collide in the database rather than in the code under
/// test.
async fn seed_room(pool: &sqlx::PgPool) -> (Uuid, Uuid) {
    let room_type_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM room_types WHERE LOWER(name) = LOWER('Audit Retention Test Room')",
    )
    .fetch_optional(pool)
    .await
    .expect("query room_types")
    {
        Some(id) => id,
        None => sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO room_types (id, name, price_per_night, max_guests)
            VALUES ($1, 'Audit Retention Test Room', 1500.00, 2)
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
        VALUES ($1, $2, $3, 4)
        RETURNING id
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(room_type_id)
    .bind(format!("AUD-{}", &Uuid::new_v4().to_string()[..8]))
    .fetch_one(pool)
    .await
    .expect("insert room");

    (room_type_id, room_id)
}

/// A booking in a given state whose stay ended `ended_days_ago` days ago.
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

/// One `booking_audit_log` row, stamped `occurred_days_ago` days in the past.
async fn seed_audit_row(
    pool: &sqlx::PgPool,
    booking_id: Uuid,
    admin_id: Uuid,
    occurred_days_ago: i64,
) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO booking_audit_log
            (id, booking_id, admin_id, action, before_data, after_data, reason, occurred_at)
        VALUES ($1, $2, $3, 'status_change', NULL, NULL, 'fixture', $4)
        "#,
    )
    .bind(id)
    .bind(booking_id)
    .bind(admin_id)
    .bind(chrono::Utc::now() - chrono::Duration::days(occurred_days_ago))
    .execute(pool)
    .await
    .expect("insert booking_audit_log");

    id
}

/// One `booking_slips` row. No file is written — these tests never touch the
/// image, only the access rows that name it.
async fn seed_slip(pool: &sqlx::PgPool, booking_id: Uuid, uploaded_by: Uuid) -> Uuid {
    let slip_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO booking_slips (id, booking_id, slip_url, uploaded_by, admin_status)
        VALUES ($1, $2, $3, $4, 'verified')
        "#,
    )
    .bind(slip_id)
    .bind(booking_id)
    .bind(format!("/storage/slips/{}.png", Uuid::new_v4()))
    .bind(uploaded_by)
    .execute(pool)
    .await
    .expect("insert booking_slips");

    slip_id
}

/// One `slip_access_log` row, stamped `accessed_days_ago` days in the past.
/// `slip_id` is `None` for the orphan case the FK's `ON DELETE SET NULL`
/// produces.
async fn seed_access_row(
    pool: &sqlx::PgPool,
    slip_id: Option<Uuid>,
    admin_id: Uuid,
    accessed_days_ago: i64,
) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO slip_access_log (id, slip_id, admin_id, route, accessed_at, request_id)
        VALUES ($1, $2, $3, 'GET /api/admin/bookings', $4, NULL)
        "#,
    )
    .bind(id)
    .bind(slip_id)
    .bind(admin_id)
    .bind(chrono::Utc::now() - chrono::Duration::days(accessed_days_ago))
    .execute(pool)
    .await
    .expect("insert slip_access_log");

    id
}

async fn audit_row_exists(pool: &sqlx::PgPool, id: Uuid) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM booking_audit_log WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("count booking_audit_log")
        == 1
}

async fn access_row_exists(pool: &sqlx::PgPool, id: Uuid) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM slip_access_log WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("count slip_access_log")
        == 1
}

/// An admin to attribute audit and access rows to. `admin_id` is `NOT NULL`
/// with an FK to `users` on both tables, so every fixture needs one.
async fn seed_admin(pool: &sqlx::PgPool, email: &str) -> Uuid {
    let admin = TestUser::admin(email);
    admin.insert(pool).await.expect("insert admin");
    admin.id
}

// ============================================================================
// Off unless configured
// ============================================================================

/// The headline safety property: with no window set, the prune must not
/// delete a single row — however old it is.
///
/// The positive control at the end is what stops this being vacuous: the same
/// rows, the same call, the only change being that the windows are now set.
#[tokio::test]
async fn the_prune_is_a_no_op_while_the_windows_are_unset() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("audit-retention-unset-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin_id = seed_admin(app.db(), "audit-retention-unset-admin@test.com").await;

    // As eligible as rows can get: a booking closed years ago, and an audit
    // trail and access history older than any window anyone would set.
    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 3000).await;
    let slip_id = seed_slip(app.db(), booking_id, guest.id).await;
    let audit_id = seed_audit_row(app.db(), booking_id, admin_id, 3000).await;
    let access_id = seed_access_row(app.db(), Some(slip_id), admin_id, 3000).await;

    let mut config = crate::common::test_app_state_config();
    assert!(
        config.retention.audit_log_retention_days().is_none(),
        "the test config must mirror production's unset audit window"
    );
    assert!(
        config.retention.slip_access_log_retention_days().is_none(),
        "the test config must mirror production's unset access-log window"
    );

    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;

    assert_eq!(summary.total(), 0, "no window, no deletion");
    assert!(!summary.failed, "a no-op is not a failure");
    assert!(
        audit_row_exists(app.db(), audit_id).await,
        "an unconfigured window must not delete an audit row"
    );
    assert!(
        access_row_exists(app.db(), access_id).await,
        "an unconfigured window must not delete an access row"
    );

    // Positive control.
    config.retention.audit_log_days = Some("365".to_string());
    config.retention.slip_access_log_days = Some("90".to_string());
    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;

    assert_eq!(
        summary.audit_rows, 1,
        "with a window set, the audit row goes"
    );
    assert_eq!(
        summary.access_rows, 1,
        "with a window set, the access row goes"
    );
    assert!(!audit_row_exists(app.db(), audit_id).await);
    assert!(!access_row_exists(app.db(), access_id).await);

    app.cleanup().await.ok();
}

// ============================================================================
// The window itself
// ============================================================================

/// Past the window the row goes; inside it — including one day short of it —
/// the row stays. The boundary fixtures are the point: without them a prune
/// that ignored the date entirely would still pass.
#[tokio::test]
async fn old_rows_are_pruned_and_young_rows_are_kept() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("audit-retention-window-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin_id = seed_admin(app.db(), "audit-retention-window-admin@test.com").await;

    // One closed booking carries every fixture, so nothing here can pass by
    // accident of a booking-state difference.
    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 900).await;
    let slip_id = seed_slip(app.db(), booking_id, guest.id).await;

    // booking_audit_log, window 365.
    let ancient_audit = seed_audit_row(app.db(), booking_id, admin_id, 900).await;
    let just_over_audit = seed_audit_row(app.db(), booking_id, admin_id, 366).await;
    let boundary_audit = seed_audit_row(app.db(), booking_id, admin_id, 364).await;
    let young_audit = seed_audit_row(app.db(), booking_id, admin_id, 5).await;

    // slip_access_log, window 90.
    let ancient_access = seed_access_row(app.db(), Some(slip_id), admin_id, 900).await;
    let just_over_access = seed_access_row(app.db(), Some(slip_id), admin_id, 91).await;
    let boundary_access = seed_access_row(app.db(), Some(slip_id), admin_id, 89).await;
    let young_access = seed_access_row(app.db(), Some(slip_id), admin_id, 2).await;

    let mut config = crate::common::test_app_state_config();
    config.retention.audit_log_days = Some("365".to_string());
    config.retention.slip_access_log_days = Some("90".to_string());

    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;

    assert!(!summary.failed, "the prune reported a failure");
    assert_eq!(summary.audit_rows, 2, "two audit rows were past 365 days");
    assert_eq!(summary.access_rows, 2, "two access rows were past 90 days");

    assert!(!audit_row_exists(app.db(), ancient_audit).await);
    assert!(!audit_row_exists(app.db(), just_over_audit).await);
    assert!(
        audit_row_exists(app.db(), boundary_audit).await,
        "364 days is inside a 365-day window and must survive"
    );
    assert!(audit_row_exists(app.db(), young_audit).await);

    assert!(!access_row_exists(app.db(), ancient_access).await);
    assert!(!access_row_exists(app.db(), just_over_access).await);
    assert!(
        access_row_exists(app.db(), boundary_access).await,
        "89 days is inside a 90-day window and must survive"
    );
    assert!(access_row_exists(app.db(), young_access).await);

    // Running again changes nothing: the prune is idempotent, and a second
    // pass over a drained table must not report phantom work.
    let again =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;
    assert_eq!(again.total(), 0, "a second pass has nothing left to do");

    app.cleanup().await.ok();
}

/// The two windows are independent — configuring one must not prune the
/// other's table.
#[tokio::test]
async fn each_table_obeys_only_its_own_window() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("audit-retention-split-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin_id = seed_admin(app.db(), "audit-retention-split-admin@test.com").await;

    let booking_id = seed_booking(app.db(), guest.id, "completed", 900).await;
    let slip_id = seed_slip(app.db(), booking_id, guest.id).await;
    let audit_id = seed_audit_row(app.db(), booking_id, admin_id, 900).await;
    let access_id = seed_access_row(app.db(), Some(slip_id), admin_id, 900).await;

    let mut config = crate::common::test_app_state_config();
    config.retention.audit_log_days = Some("365".to_string());

    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;

    assert_eq!(summary.audit_rows, 1);
    assert_eq!(
        summary.access_rows, 0,
        "SLIP_ACCESS_LOG_RETENTION_DAYS is unset, so that table is untouched"
    );
    assert!(!audit_row_exists(app.db(), audit_id).await);
    assert!(
        access_row_exists(app.db(), access_id).await,
        "an unconfigured access-log window must survive the audit prune"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// Open bookings
// ============================================================================

/// A booking that is still open keeps its whole trail, however old the rows
/// are. A `pending`, `confirmed` or `checked_in` booking is live business —
/// its audit trail is the record of something still in progress, and no
/// retention clock should be running on it yet.
#[tokio::test]
async fn nothing_belonging_to_an_open_booking_is_ever_pruned() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("audit-retention-open-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin_id = seed_admin(app.db(), "audit-retention-open-admin@test.com").await;

    let mut kept = Vec::new();
    for status in ["pending", "confirmed", "checked_in"] {
        let booking_id = seed_booking(app.db(), guest.id, status, 3000).await;
        let slip_id = seed_slip(app.db(), booking_id, guest.id).await;
        kept.push((
            status,
            seed_audit_row(app.db(), booking_id, admin_id, 3000).await,
            seed_access_row(app.db(), Some(slip_id), admin_id, 3000).await,
        ));
    }

    // The control: an equally ancient trail on a CLOSED booking. Without it,
    // a prune that silently did nothing at all would pass this test.
    let closed = seed_booking(app.db(), guest.id, "checked_out", 3000).await;
    let closed_slip = seed_slip(app.db(), closed, guest.id).await;
    let closed_audit = seed_audit_row(app.db(), closed, admin_id, 3000).await;
    let closed_access = seed_access_row(app.db(), Some(closed_slip), admin_id, 3000).await;

    let mut config = crate::common::test_app_state_config();
    config.retention.audit_log_days = Some("365".to_string());
    config.retention.slip_access_log_days = Some("90".to_string());

    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;

    assert_eq!(
        summary.audit_rows, 1,
        "only the closed booking's audit row was eligible"
    );
    assert_eq!(
        summary.access_rows, 1,
        "only the closed booking's access row was eligible"
    );
    assert!(!audit_row_exists(app.db(), closed_audit).await);
    assert!(!access_row_exists(app.db(), closed_access).await);

    for (status, audit_id, access_id) in kept {
        assert!(
            audit_row_exists(app.db(), audit_id).await,
            "a {} booking's audit row must survive",
            status
        );
        assert!(
            access_row_exists(app.db(), access_id).await,
            "a {} booking's access row must survive",
            status
        );
    }

    app.cleanup().await.ok();
}

/// An access row whose slip was hard-deleted (`slip_id` NULL — the FK is
/// `ON DELETE SET NULL` on purpose, so the record of a read outlives its
/// subject) has no booking to ask about and is pruned on age alone.
///
/// Worth its own test because the natural way to write the query — an INNER
/// join to `booking_slips` — would make exactly these rows immortal.
#[tokio::test]
async fn an_orphaned_access_row_is_pruned_on_age_alone() {
    let app = TestApp::new().await.expect("create test app");

    let admin_id = seed_admin(app.db(), "audit-retention-orphan-admin@test.com").await;

    let old_orphan = seed_access_row(app.db(), None, admin_id, 900).await;
    let young_orphan = seed_access_row(app.db(), None, admin_id, 10).await;

    let mut config = crate::common::test_app_state_config();
    config.retention.slip_access_log_days = Some("90".to_string());

    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;

    assert_eq!(summary.access_rows, 1);
    assert!(!access_row_exists(app.db(), old_orphan).await);
    assert!(
        access_row_exists(app.db(), young_orphan).await,
        "an orphan inside the window is still inside the window"
    );

    app.cleanup().await.ok();
}

// ============================================================================
// The floors
// ============================================================================

/// A window below the PDPA floor is refused at config, so the prune never
/// sees it — and, critically, is **not clamped up to the floor** either.
/// Nothing is deleted and nothing is silently retained on a schedule the
/// operator did not choose.
#[tokio::test]
async fn a_window_below_the_floor_prunes_nothing() {
    let app = TestApp::new().await.expect("create test app");

    let guest = TestUser::new("audit-retention-floor-guest@test.com");
    guest.insert(app.db()).await.expect("insert guest");
    let admin_id = seed_admin(app.db(), "audit-retention-floor-admin@test.com").await;

    let booking_id = seed_booking(app.db(), guest.id, "checked_out", 3000).await;
    let slip_id = seed_slip(app.db(), booking_id, guest.id).await;
    let audit_id = seed_audit_row(app.db(), booking_id, admin_id, 3000).await;
    let access_id = seed_access_row(app.db(), Some(slip_id), admin_id, 3000).await;

    let mut config = crate::common::test_app_state_config();

    // booking_audit_log: anything under a year, plus the out-of-range values
    // the interval guard exists for.
    for below in ["1", "30", "364", "0", "3651", "4294967295"] {
        config.retention.audit_log_days = Some(below.to_string());
        assert!(
            config.retention.audit_log_retention_days().is_none(),
            "{} must not be accepted as an audit window",
            below
        );
        assert_eq!(
            config.retention.audit_log_days_error(),
            Some(below),
            "{} must be reported at startup, not silently ignored",
            below
        );
        let summary =
            loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
                .await;
        assert_eq!(
            summary.total(),
            0,
            "audit window {} deleted something",
            below
        );
    }
    config.retention.audit_log_days = None;

    // slip_access_log: anything under 90 days.
    for below in ["1", "7", "89", "0", "3651"] {
        config.retention.slip_access_log_days = Some(below.to_string());
        assert!(
            config.retention.slip_access_log_retention_days().is_none(),
            "{} must not be accepted as an access-log window",
            below
        );
        assert_eq!(config.retention.slip_access_log_days_error(), Some(below));
        let summary =
            loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
                .await;
        assert_eq!(
            summary.total(),
            0,
            "access-log window {} deleted something",
            below
        );
    }

    assert!(
        audit_row_exists(app.db(), audit_id).await,
        "a refused window must leave the audit trail alone"
    );
    assert!(
        access_row_exists(app.db(), access_id).await,
        "a refused window must leave the access log alone"
    );

    // And the floor value itself IS accepted — otherwise every assertion
    // above would hold for a prune that simply never worked.
    config.retention.audit_log_days = Some("365".to_string());
    config.retention.slip_access_log_days = Some("90".to_string());
    let summary =
        loyalty_backend::services::audit_retention::sweep_expired_audit_logs(app.db(), &config)
            .await;
    assert_eq!(
        summary.audit_rows, 1,
        "365 is the floor and must be accepted"
    );
    assert_eq!(
        summary.access_rows, 1,
        "90 is the floor and must be accepted"
    );

    app.cleanup().await.ok();
}
