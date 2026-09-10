//! Common test utilities and fixtures
//!
//! This module provides shared test infrastructure including:
//! - TestApp struct for spinning up the app for testing
//! - Per-test database isolation via CREATE DATABASE TEMPLATE
//! - Test fixtures for users, coupons, and other entities
//! - Helper functions for making authenticated requests
//! - Cleanup utilities

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{HeaderMap, Request},
    Router,
};
use chrono::{Duration, Utc};
use once_cell::sync::Lazy;
use redis::aio::ConnectionManager;
use serde::{de::DeserializeOwned, Serialize};
use sqlx::{postgres::PgPoolOptions, Connection, Executor, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

// ============================================================================
// Test Configuration
// ============================================================================

/// Test database URL - uses a separate test database
pub fn test_database_url() -> String {
    std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://postgres:postgres@localhost:5438/loyalty_test_db".to_string()
    })
}

/// Base database URL (connects to "postgres" DB for admin operations)
fn admin_database_url() -> String {
    let url = test_database_url();
    // Replace the database name with "postgres" for admin operations
    if let Some(pos) = url.rfind('/') {
        format!("{}postgres", &url[..pos + 1])
    } else {
        url
    }
}

/// Test Redis URL
pub fn test_redis_url() -> String {
    std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://localhost:6383".to_string())
}

/// JWT secret for testing
pub const TEST_JWT_SECRET: &str = "test-jwt-secret-key-for-testing-only-minimum-32-chars";

/// Test user password (unhashed)
pub const TEST_USER_PASSWORD: &str = "TestPassword123!";

/// Cached password hash for TEST_USER_PASSWORD (argon2 is CPU-intensive,
/// so we compute once and reuse across all test users)
static CACHED_TEST_PASSWORD_HASH: Lazy<String> =
    Lazy::new(|| hash_test_password(TEST_USER_PASSWORD));

// ============================================================================
// Template Database Infrastructure
// ============================================================================

/// Admin pool connects to "postgres" DB for CREATE/DROP DATABASE operations.
/// Uses std::sync::Mutex (not tokio) to avoid runtime dependency in statics.
static ADMIN_POOL: Lazy<Mutex<Option<PgPool>>> = Lazy::new(|| Mutex::new(None));

/// Whether the template database has been created.
/// Uses std::sync::Mutex to avoid tokio runtime dependency.
static TEMPLATE_READY: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

/// Template database name
const TEMPLATE_DB_NAME: &str = "loyalty_test_template";

/// Marker table stamped into the template database at the end of a
/// successful build, holding a fingerprint of the migrations and seeds it
/// was built from. See `template_db_is_current()`.
const TEMPLATE_FINGERPRINT_TABLE: &str = "_test_template_fingerprint";

/// The compile-time embedded migration set — exactly what `sqlx::migrate!()`
/// applies at backend startup in CI and in production. Runtime discovery is
/// cross-checked against it so "what the tests apply" cannot drift from
/// "what production applies" without a loud failure.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// The migration that performs the legacy -> bilingual tier transform. The
/// legacy tier seed is inserted immediately *before* it, which is the
/// actual semantic requirement (anchoring on whatever happens to precede it
/// breaks silently when a migration is inserted in between).
const LEGACY_TIER_SEED_BEFORE: &str = "20260726000000_tier_benefits_bilingual.sql";

/// The four tiers in the LEGACY flat Thai shape — exactly the state a
/// deployed database was in when `LEGACY_TIER_SEED_BEFORE` first ran, so
/// every suite run exercises the real transform instead of testing against
/// hand-seeded post-migration rows. Content mirrors what seed.rs seeded
/// before the bilingual change.
const LEGACY_TIER_SEED_SQL: &str = r#"
    INSERT INTO tiers (name, min_points, min_nights, benefits, color, sort_order, is_active)
    VALUES
        ('Bronze', 0, 0, '{"description": "ระดับต้อนรับสำหรับสมาชิกใหม่", "perks": ["ราคาพิเศษสำหรับสมาชิก", "บริการแต่งห้องวันเกิด", "ได้รับคะแนนเพิ่ม"]}', '#CD7F32', 1, true),
        ('Silver', 0, 1, '{"description": "สิทธิพิเศษระดับกลางสำหรับสมาชิกที่ใช้บริการ", "perks": ["ส่วนลดเครื่องดื่ม 10%", "ได้รับคะแนนเพิ่ม"]}', '#C0C0C0', 2, true),
        ('Gold', 0, 10, '{"description": "สิทธิพิเศษระดับพรีเมียมสำหรับสมาชิกที่มีค่า", "perks": ["อัพเกรดห้องฟรี", "ได้รับคะแนนเพิ่ม"]}', '#FFD700', 3, true),
        ('Platinum', 0, 20, '{"description": "สิทธิพิเศษสุดพิเศษสำหรับสมาชิกระดับสูงสุด", "perks": ["ส่วนลดพิเศษสำหรับสมาชิกขั้นสูงสุด"]}', '#E5E4E2', 4, true)
    ON CONFLICT (name) DO NOTHING
    "#;

/// Get or create the admin pool (connects to "postgres" database).
///
/// The pool is cached in a static for reuse across tests. However, since each
/// `#[tokio::test]` creates its own single-threaded runtime, a pool created in
/// one test's runtime becomes stale when that test completes. We detect this by
/// running a health check query and recreate the pool if needed.
///
/// Uses std::sync::Mutex (not tokio::sync::Mutex) to avoid depending on the
/// tokio runtime context for lock acquisition, which prevents "Tokio 1.x context
/// being shutdown" errors when tests run in parallel.
async fn get_admin_pool() -> Result<PgPool, sqlx::Error> {
    // Try to get a cached pool (hold std::sync::Mutex only briefly, never across await)
    let cached = {
        let guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    };

    // If we have a cached pool, health-check it outside the lock
    if let Some(pool) = cached {
        match sqlx::query("SELECT 1").execute(&pool).await {
            Ok(_) => return Ok(pool),
            Err(_) => {
                // Pool is stale (its runtime died), discard it
                let mut guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
                *guard = None;
            },
        }
    }

    // Create a fresh pool in the current test's runtime
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(5))
        .max_lifetime(std::time::Duration::from_secs(30))
        .connect(&admin_database_url())
        .await?;

    // Cache it
    {
        let mut guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(pool.clone());
    }
    Ok(pool)
}

/// Create a per-test database using a fresh direct connection.
/// This bypasses the cached admin pool entirely, avoiding tokio runtime
/// lifetime issues. Used as a fallback when pool-based retries fail.
///
/// Handles "already exists" errors gracefully, since the pool-based attempt
/// might have succeeded on the server but returned an error to the client
/// (e.g., when the tokio runtime shut down before receiving the response).
async fn create_db_fresh_connection(
    db_name: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut conn = sqlx::PgConnection::connect(&admin_database_url()).await?;
    match sqlx::query(&format!(
        "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
        db_name, TEMPLATE_DB_NAME
    ))
    .execute(&mut conn)
    .await
    {
        Ok(_) => Ok(()),
        Err(e) => {
            // Ignore "already exists" errors:
            // 42P04 = duplicate_database (CREATE DATABASE standard error)
            // 23505 = unique_violation (race condition on pg_database_datname_index)
            if let sqlx::Error::Database(ref db_err) = e {
                if db_err.code().is_some_and(|c| c == "42P04" || c == "23505") {
                    return Ok(());
                }
            }
            Err(e.into())
        },
    }
}

/// URL of the template database (the test URL with the database name
/// swapped for `TEMPLATE_DB_NAME`).
fn template_database_url() -> String {
    let url = test_database_url();
    if let Some(pos) = url.rfind('/') {
        format!("{}{}", &url[..pos + 1], TEMPLATE_DB_NAME)
    } else {
        url
    }
}

/// Probe whether the template database has already been built by another
/// worker **from exactly the migrations that are on disk right now**.
///
/// The marker is the one-row `_test_template_fingerprint` table written as
/// the very last step of a successful build (see `ensure_template_db`),
/// holding a hash of every discovered `(filename, sql)` pair plus the
/// interleaved seeds. Requiring it to match `expected_fingerprint` buys two
/// things the old "does the `users` table exist?" probe could not:
///
/// * A build that died part-way — say migration 9 of 13 failed — never
///   wrote the row, so every sibling nextest worker rebuilds instead of
///   running its tests against a half-migrated template.
/// * A template left over from a previous checkout is rebuilt when a
///   migration is added, renamed or edited. `loyalty_test_template` is
///   never swept by the stale-DB cleanup below (it doesn't match `test_%`),
///   so locally it otherwise survives between runs indefinitely.
///
/// Returns `false` if the template DB doesn't exist, predates the
/// fingerprint table, or was built from different migrations. Caller
/// treats `false` as "rebuild needed".
async fn template_db_is_current(
    admin_pool: &PgPool,
    expected_fingerprint: &str,
) -> Result<bool, sqlx::Error> {
    let exists: bool = sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT FROM pg_database WHERE datname = '{}')",
        TEMPLATE_DB_NAME
    ))
    .fetch_one(admin_pool)
    .await?;
    if !exists {
        return Ok(false);
    }

    // Connect to the template DB directly to read the fingerprint row.
    let template_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&template_database_url())
        .await?;
    // Querying a table that doesn't exist is an *error*, not an empty row:
    // a template predating the fingerprint table lands here and must read
    // as stale, hence `unwrap_or(None)`.
    let stored: Option<String> = sqlx::query_scalar(&format!(
        "SELECT fingerprint FROM {} WHERE id = 1",
        TEMPLATE_FINGERPRINT_TABLE
    ))
    .fetch_optional(&template_pool)
    .await
    .unwrap_or(None);
    template_pool.close().await;
    Ok(stored.as_deref() == Some(expected_fingerprint))
}

/// One migration file discovered on disk.
struct MigrationFile {
    /// Version parsed from the filename prefix, the way sqlx parses it.
    version: i64,
    file_name: String,
    sql: String,
}

/// Parse the version out of a migration filename the way sqlx's own
/// resolver does: the digits before the first `_`, as an `i64`.
///
/// Returns `Err` with a human-readable reason for anything that is not a
/// plain `<version>_<description>.sql` (or `.up.sql`), so a `.down.sql`
/// half of a reversible pair, an editor swap file or an AppleDouble
/// `._foo.sql` sidecar fails the suite loudly instead of being applied as
/// if it were a migration — or silently skipped.
fn parse_migration_version(file_name: &str) -> Result<i64, String> {
    let stem = file_name
        .strip_suffix(".sql")
        .ok_or_else(|| "not a .sql file".to_string())?;
    if let Some(base) = stem.strip_suffix(".down") {
        return Err(format!(
            "this is the down half of a reversible migration (`sqlx migrate add -r`); \
             the test harness applies migrations forward only and must not execute it. \
             Make `{base}` irreversible, or teach discover_migration_files() to skip \
             `.down.sql` explicitly"
        ));
    }
    let stem = stem.strip_suffix(".up").unwrap_or(stem);
    let (version, description) = stem
        .split_once('_')
        .ok_or_else(|| "expected <version>_<description>.sql".to_string())?;
    if version.is_empty() || !version.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("`{version}` is not a numeric version prefix"));
    }
    if description.contains('.') {
        return Err("description contains a `.` — unexpected filename form".to_string());
    }
    version
        .parse::<i64>()
        .map_err(|e| format!("version `{version}` does not fit in an i64: {e}"))
}

/// Discover every migration under `backend-rust/migrations/`, ordered the
/// way `sqlx::migrate!()` orders them: ascending **numeric** version, not
/// lexical filename order (a prefix of a different digit width sorts
/// differently between the two).
///
/// Read at test run time via `CARGO_MANIFEST_DIR`, so a migration file
/// added, renamed or removed on disk is picked up the next time the
/// template database is *built* — and `ensure_template_db()`'s fingerprint
/// probe is what forces that rebuild instead of reusing a warm template.
///
/// The result is cross-checked against `MIGRATOR`, the compile-time
/// embedded set the backend itself applies at startup in CI and
/// production, so a file this function drops (or an extra one it picks up)
/// fails the suite rather than quietly producing a test-only schema.
fn discover_migration_files() -> Vec<MigrationFile> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut files: Vec<MigrationFile> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("failed to read migrations dir {}: {}", dir.display(), e))
        // A `DirEntry` that fails to stat must never be silently dropped:
        // that would build the template from a subset of the migrations.
        .map(|entry| {
            entry.unwrap_or_else(|e| panic!("failed to read an entry in {}: {}", dir.display(), e))
        })
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("sql"))
        })
        .map(|entry| {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let version = parse_migration_version(&file_name).unwrap_or_else(|reason| {
                panic!(
                    "unexpected file `{}` in {}: {}",
                    file_name,
                    dir.display(),
                    reason
                )
            });
            let sql = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("failed to read migration {}: {}", path.display(), e));
            MigrationFile {
                version,
                file_name,
                sql,
            }
        })
        .collect();
    files.sort_by_key(|file| file.version);

    // The real guard: compare against what `sqlx::migrate!()` embedded at
    // compile time. Counting our own loop iterations would be a tautology —
    // a file dropped by discovery shrinks both sides of that comparison
    // identically. The embedded set is an independent witness.
    let embedded: Vec<i64> = MIGRATOR
        .iter()
        .filter(|migration| !migration.migration_type.is_down_migration())
        .map(|migration| migration.version)
        .collect();
    let discovered: Vec<i64> = files.iter().map(|file| file.version).collect();
    assert_eq!(
        discovered,
        embedded,
        "migrations discovered on disk do not match the compile-time \
         sqlx::migrate!() set the backend applies in CI and production.\n\
         on disk:  {:?}\n\
         embedded: {:?}\n\
         (if you just added a migration file, the embedded set may simply be \
         stale — force a rebuild of this test crate and re-run)",
        files
            .iter()
            .map(|file| file.file_name.as_str())
            .collect::<Vec<_>>(),
        embedded,
    );

    files
}

/// SHA-256 over everything that goes into the template database: every
/// discovered migration in apply order, plus the interleaved legacy seed.
/// Any migration added, renamed or edited changes it, which is what makes
/// a warm `loyalty_test_template` self-invalidating instead of silently
/// serving a stale schema.
fn migrations_fingerprint(files: &[MigrationFile]) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(file.file_name.as_bytes());
        hasher.update(b"\0");
        hasher.update(file.sql.as_bytes());
        hasher.update(b"\0");
    }
    hasher.update(LEGACY_TIER_SEED_BEFORE.as_bytes());
    hasher.update(LEGACY_TIER_SEED_SQL.as_bytes());
    hex::encode(hasher.finalize())
}

/// Ensure the template database exists with migrations and seed data.
///
/// Two layers of serialization, because there are two ways concurrent
/// callers can show up:
///
/// 1. **Within a single process** (tokio tasks racing on the first call):
///    `TEMPLATE_READY` (`std::sync::Mutex<bool>`) is the process-local
///    fast-path flag.
/// 2. **Across processes** (nextest spawns each integration test in its
///    own OS process by default — every process starts with
///    `TEMPLATE_READY == false`): we acquire a **Postgres advisory lock**
///    on a dedicated connection. Postgres advisory locks are session-
///    scoped, so dropping the lock connection releases the lock even on
///    panic or early return; and they're visible across processes and
///    machines, which is what we need.
///
/// Without (2), nextest's process model used to race every nextest worker
/// into the same `DROP DATABASE / CREATE DATABASE` sequence and the
/// losers panicked with `duplicate key value violates unique constraint
/// "pg_database_datname_index"`.
async fn ensure_template_db() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Fast path: process-local check.
    {
        let ready = TEMPLATE_READY.lock().unwrap_or_else(|e| e.into_inner());
        if *ready {
            return Ok(());
        }
    }

    // Slow path: take a Postgres advisory lock on a dedicated connection
    // so the rebuild is serialized across every nextest worker process.
    // The key is a hash of the template name so it can't collide with
    // unrelated tooling that might also use advisory locks on the same
    // server.
    let mut lock_conn = sqlx::PgConnection::connect(&admin_database_url()).await?;
    sqlx::query("SELECT pg_advisory_lock(hashtext($1)::bigint)")
        .bind(TEMPLATE_DB_NAME)
        .execute(&mut lock_conn)
        .await?;
    // `lock_conn` stays in scope for the rest of the function; dropping it
    // (normal return or `?`-bail) closes the session and releases the lock.

    // Inside the lock now. Re-check whether some other worker already built
    // the template while we were waiting. Process-local `TEMPLATE_READY`
    // can't see other processes' work, so probe Postgres instead: the
    // template DB has to exist AND carry a fingerprint stamp matching the
    // migrations that are on disk right now. That distinguishes "another
    // worker just finished building it from this checkout" from "fresh
    // service container", from "a build that died half-way", and from
    // "yesterday's template, built before this branch added a migration".
    //
    // The migrations are therefore read off disk *before* the probe: the
    // template is only reusable if it was built from exactly these files.
    let migration_files = discover_migration_files();
    let fingerprint = migrations_fingerprint(&migration_files);
    let admin_pool = get_admin_pool().await?;
    if template_db_is_current(&admin_pool, &fingerprint)
        .await
        .unwrap_or(false)
    {
        // Scope the std::sync::Mutex guard so it doesn't get held across
        // the `.await` below (`clippy::await_holding_lock`).
        {
            let mut ready = TEMPLATE_READY.lock().unwrap_or_else(|e| e.into_inner());
            *ready = true;
        }
        let _ = sqlx::query("SELECT pg_advisory_unlock(hashtext($1)::bigint)")
            .bind(TEMPLATE_DB_NAME)
            .execute(&mut lock_conn)
            .await;
        return Ok(());
    }

    // Terminate any connections to the template database
    let _ = sqlx::query(&format!(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
        TEMPLATE_DB_NAME
    ))
    .execute(&admin_pool)
    .await;

    // Drop and recreate the template database
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", TEMPLATE_DB_NAME))
        .execute(&admin_pool)
        .await;

    sqlx::query(&format!("CREATE DATABASE \"{}\"", TEMPLATE_DB_NAME))
        .execute(&admin_pool)
        .await?;

    // Connect to the template database to run migrations and seeds
    let template_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&template_database_url())
        .await?;

    // Apply every migration in `backend-rust/migrations/`, in the same
    // ascending-version order `sqlx::migrate!()` applies them at runtime and
    // in CI. Discovered at test run time (see `discover_migration_files`) and
    // cross-checked there against the embedded migrator, so the test schema
    // cannot drift from the production one.
    //
    // One legacy seed is interleaved: the tiers in their LEGACY flat Thai
    // shape are inserted immediately before the bilingual transform runs.
    let mut legacy_seed_applied = false;
    for file in &migration_files {
        if file.file_name == LEGACY_TIER_SEED_BEFORE {
            template_pool.execute(LEGACY_TIER_SEED_SQL).await?;
            legacy_seed_applied = true;
        }
        template_pool.execute(file.sql.as_str()).await?;
    }
    // The seed is anchored on a filename. If that migration is renamed,
    // squashed or folded into another file the `if` above simply stops
    // firing, the transform runs against an empty `tiers` table, and the
    // failure surfaces far away in tier_admin_test as "Bronze must be in the
    // public tier list". Fail here instead, where the cause is named.
    assert!(
        legacy_seed_applied,
        "legacy tier seed anchor `{LEGACY_TIER_SEED_BEFORE}` not found in \
         backend-rust/migrations/ — the legacy -> bilingual tier transform is no \
         longer being exercised. Re-anchor LEGACY_TIER_SEED_BEFORE on whichever \
         migration now performs that transform."
    );

    // Seed membership_id_sequence
    template_pool
        .execute(
            r#"
            INSERT INTO membership_id_sequence (id, current_user_count)
            VALUES (1, 0)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .await?;

    // Stamp the template with a fingerprint of exactly what built it, as the
    // LAST step. Written only on success, so a build that bailed part-way
    // (a migration failed to apply, `?` returned) leaves no stamp and the
    // next worker rebuilds instead of running its tests against a
    // half-migrated template. Read back by `template_db_is_current()`.
    template_pool
        .execute(
            format!(
                "CREATE TABLE IF NOT EXISTS {} (id int PRIMARY KEY, fingerprint text NOT NULL)",
                TEMPLATE_FINGERPRINT_TABLE
            )
            .as_str(),
        )
        .await?;
    sqlx::query(&format!(
        "INSERT INTO {} (id, fingerprint) VALUES (1, $1) \
         ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint",
        TEMPLATE_FINGERPRINT_TABLE
    ))
    .bind(&fingerprint)
    .execute(&template_pool)
    .await?;

    // Close the template pool — required before using it as a TEMPLATE
    template_pool.close().await;

    // Clean up orphaned test databases from previous runs.
    //
    // The previous implementation dropped every `test_%` database
    // unconditionally. Under nextest's process model that's actively
    // harmful — sibling worker processes that have already passed
    // `ensure_template_db()` and are running tests against their own
    // `test_<uuid>` database hold no advisory lock here, so the
    // unconditional `pg_terminate_backend` + DROP would yank their
    // databases out from under them mid-test. See
    // `docs/audits/correctness-2026-05-13.md` HIGH #6 for the
    // write-up.
    //
    // Fix: only drop databases that are demonstrably stale — no
    // active backends AND a `pg_database.datacl`-derived age older
    // than 30 minutes. Postgres doesn't expose a creation timestamp,
    // so we proxy "old" via the lack of any connection: a sibling
    // worker that's actually using the DB will have at least one
    // backend, which excludes it from the drop set. Tests that crash
    // and leak DBs will eventually be cleaned up the next time the
    // template is rebuilt, which is the original intent.
    let stale_rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT d.datname
        FROM pg_database d
        WHERE d.datname LIKE 'test_%'
          AND d.datistemplate = false
          AND d.datname <> $1
          AND NOT EXISTS (
              SELECT 1
              FROM pg_stat_activity sa
              WHERE sa.datname = d.datname
                AND sa.pid <> pg_backend_pid()
          )
        "#,
    )
    .bind(TEMPLATE_DB_NAME)
    .fetch_all(&admin_pool)
    .await
    .unwrap_or_default();

    for (db_name,) in stale_rows {
        // We intentionally do NOT call `pg_terminate_backend` here —
        // the SELECT above already filtered to databases with no
        // connections, so DROP DATABASE should succeed without
        // terminating anything. If a sibling races and connects
        // between the SELECT and DROP, the DROP fails harmlessly
        // ("database is being accessed by other users"), which is
        // exactly the right behaviour.
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", db_name))
            .execute(&admin_pool)
            .await;
    }

    {
        let mut ready = TEMPLATE_READY.lock().unwrap_or_else(|e| e.into_inner());
        *ready = true;
    }

    // Explicitly release the advisory lock before dropping the connection.
    // Dropping the connection would release it anyway via session
    // termination, but the explicit call closes the window where another
    // waiting worker would briefly retry-and-back-off before the kernel
    // tears the connection down.
    let _ = sqlx::query("SELECT pg_advisory_unlock(hashtext($1)::bigint)")
        .bind(TEMPLATE_DB_NAME)
        .execute(&mut lock_conn)
        .await;
    Ok(())
}

// ============================================================================
// TestApp - Main test application wrapper
// ============================================================================

/// TestApp wraps the application for integration testing.
///
/// Each TestApp instance gets its own isolated database created from a
/// pre-migrated template. This allows tests to run in parallel without
/// data conflicts.
///
/// # Example
///
/// ```ignore
/// let app = TestApp::new().await.expect("Failed to create test app");
/// let response = app.client().get("/api/health").await;
/// response.assert_status(200);
/// app.cleanup().await.ok();
/// ```
pub struct TestApp {
    /// The configured Axum router
    router: Router,
    /// Database connection pool (to the per-test database)
    pool: PgPool,
    /// Redis connection manager
    redis: ConnectionManager,
    /// This app's private rate-limit bucket namespace, so a test can look
    /// its own buckets up in the Redis every test shares.
    rate_limit_namespace: String,
    /// Per-test database name (for cleanup)
    db_name: String,
}

impl TestApp {
    /// Create a new TestApp instance with an isolated per-test database.
    ///
    /// Retries up to 5 times on transient "Tokio runtime shutdown" errors that
    /// can occur when parallel `#[tokio::test]` runtimes race during cleanup.
    pub async fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::new_internal(None, None).await
    }

    /// Like [`TestApp::new`] but lets the test mutate `Settings` before the
    /// router is built (e.g. point `pms.base_url` at a wiremock server or
    /// configure a LINE messaging channel secret).
    pub async fn new_with_config(
        mutate: &(dyn Fn(&mut loyalty_backend::Settings) + Sync),
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::new_internal(Some(mutate), None).await
    }

    /// Like [`TestApp::new_with_config`] but reaches Redis through the
    /// given URL instead of the shared test server.
    ///
    /// Point it at a [`RedisRelay`] to build an app whose Redis can be
    /// taken away mid-test. Everything else — the per-test database, the
    /// bucket namespace — is unchanged.
    #[allow(dead_code)]
    pub async fn new_with_redis_url(
        mutate: &(dyn Fn(&mut loyalty_backend::Settings) + Sync),
        redis_url: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::new_internal(Some(mutate), Some(redis_url)).await
    }

    async fn new_internal(
        mutate: Option<&(dyn Fn(&mut loyalty_backend::Settings) + Sync)>,
        redis_url: Option<&str>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        const MAX_RETRIES: u32 = 5;
        let mut last_error = None;

        for attempt in 0..MAX_RETRIES {
            match Self::try_new(mutate, redis_url).await {
                Ok(app) => return Ok(app),
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("shutdown") && attempt + 1 < MAX_RETRIES {
                        // Invalidate cached admin pool (it may reference a dead runtime)
                        {
                            let mut guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
                            *guard = None;
                        }
                        // Exponential backoff: 100ms, 200ms, 400ms, 800ms
                        tokio::time::sleep(std::time::Duration::from_millis(100 * (1 << attempt)))
                            .await;
                        last_error = Some(e);
                        continue;
                    }
                    return Err(e);
                },
            }
        }
        Err(last_error.unwrap())
    }

    /// Inner implementation of TestApp creation.
    async fn try_new(
        mutate: Option<&(dyn Fn(&mut loyalty_backend::Settings) + Sync)>,
        redis_url: Option<&str>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let _ = dotenvy::dotenv();

        // Ensure template DB is ready
        ensure_template_db().await?;

        // Create a unique per-test database.
        // Try cached pool first, fall back to fresh direct connection.
        let db_name = format!("test_{}", Uuid::new_v4().simple());
        let create_sql = format!(
            "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
            db_name, TEMPLATE_DB_NAME
        );

        let mut created = false;
        if let Ok(admin_pool) = get_admin_pool().await {
            if sqlx::query(&create_sql).execute(&admin_pool).await.is_ok() {
                created = true;
            } else {
                let mut guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
                *guard = None;
            }
        }
        if !created {
            create_db_fresh_connection(&db_name).await?;
        }

        // Connect to the new per-test database
        let test_url = {
            let url = test_database_url();
            if let Some(pos) = url.rfind('/') {
                format!("{}{}", &url[..pos + 1], db_name)
            } else {
                url
            }
        };

        let pool = PgPoolOptions::new()
            .max_connections(3)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .idle_timeout(std::time::Duration::from_secs(5))
            .max_lifetime(std::time::Duration::from_secs(30))
            .connect(&test_url)
            .await?;

        // Initialize test Redis. Built with the production reconnect
        // config, so a test that takes Redis away sees the same bounded
        // behaviour a deployment would.
        let redis = match redis_url {
            Some(url) => {
                ConnectionManager::new_with_config(
                    redis::Client::open(url)?,
                    loyalty_backend::redis::connection_manager_config(),
                )
                .await?
            },
            None => init_test_redis().await?,
        };

        // Create application state and router
        let mut config = create_test_config();
        if let Some(mutate) = mutate {
            mutate(&mut config);
        }
        if let Some(url) = redis_url {
            config.redis.url = url.to_string();
        }
        let rate_limit_namespace = config.security.rate_limit_namespace.clone();
        let state = loyalty_backend::AppState::new(pool.clone(), redis.clone(), config);
        let router = loyalty_backend::routes::create_router(state);

        Ok(Self {
            router,
            pool,
            redis,
            db_name,
            rate_limit_namespace,
        })
    }

    /// Get a reference to the database pool.
    pub fn db(&self) -> &PgPool {
        &self.pool
    }

    /// Get a clone of the Redis connection manager.
    #[allow(dead_code)]
    pub fn redis(&self) -> ConnectionManager {
        self.redis.clone()
    }

    /// The prefix every rate-limit key this app writes carries.
    #[allow(dead_code)]
    pub fn rate_limit_namespace(&self) -> &str {
        &self.rate_limit_namespace
    }

    /// Get a TestClient for making HTTP requests.
    pub fn client(&self) -> TestClient {
        TestClient::new(self.router.clone())
    }

    /// Get an authenticated TestClient with a JWT token.
    pub fn authenticated_client(&self, user_id: &Uuid, email: &str) -> TestClient {
        let token = generate_test_token(user_id, email);
        TestClient::new(self.router.clone()).with_auth(&token)
    }

    /// Get an authenticated TestClient with a specific role.
    pub fn authenticated_client_with_role(
        &self,
        user_id: &Uuid,
        email: &str,
        role: &str,
    ) -> TestClient {
        let token = generate_test_token_with_role(user_id, email, role);
        TestClient::new(self.router.clone()).with_auth(&token)
    }

    /// Create a test user and return an authenticated client.
    #[allow(dead_code)]
    pub async fn create_authenticated_user(
        &self,
        email: &str,
    ) -> Result<(TestUser, TestClient), Box<dyn std::error::Error + Send + Sync>> {
        let user = create_test_user(&self.pool, email).await?;
        let token = get_auth_token(&user.id, &user.email);
        let client = TestClient::new(self.router.clone()).with_auth(&token);
        Ok((user, client))
    }

    /// Clean up: close pool and drop the per-test database.
    pub async fn cleanup(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Close pool first (required before DROP DATABASE)
        self.pool.close().await;

        // Drop the per-test database
        let admin_pool = get_admin_pool().await?;

        // Terminate any remaining connections
        let _ = sqlx::query(&format!(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
            self.db_name
        ))
        .execute(&admin_pool)
        .await;

        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", self.db_name))
            .execute(&admin_pool)
            .await;

        Ok(())
    }

    /// Get the router for direct testing.
    #[allow(dead_code)]
    pub fn router(&self) -> Router {
        self.router.clone()
    }
}

/// Public re-export of the test config builder so tests outside this
/// module can construct an isolated `AppState` for narrow-scoped routers
/// (e.g., the rate-limit regression test in `auth_test.rs`). Mirrors
/// what `TestApp` uses internally.
pub fn test_app_state_config() -> loyalty_backend::Settings {
    create_test_config()
}

/// Create test configuration settings
fn create_test_config() -> loyalty_backend::Settings {
    use loyalty_backend::config::*;

    Settings {
        environment: Environment::Development,
        server: ServerConfig {
            port: 4202,
            host: "127.0.0.1".to_string(),
            frontend_url: "http://localhost:3201".to_string(),
            log_level: "debug".to_string(),
        },
        database: DatabaseConfig {
            url: test_database_url(),
            max_connections: 3,
            min_connections: 0,
            connection_timeout_secs: 10,
        },
        redis: RedisConfig {
            url: test_redis_url(),
        },
        auth: AuthConfig {
            jwt_secret: TEST_JWT_SECRET.to_string(),
            jwt_refresh_secret: "test-refresh-secret-key-for-testing-only-minimum-32-chars"
                .to_string(),
            session_secret: "test-session-secret-key-for-testing-only-minimum-32-chars".to_string(),
            access_token_expiry_secs: 3600,
            refresh_token_expiry_secs: 86400,
        },
        oauth: OAuthConfig::default(),
        email: EmailConfig::default(),
        slipok: SlipokConfig::default(),
        promptpay: PromptPayConfig::default(),
        // Redis is shared by the whole suite (one server, no per-test
        // database), so a limiter that runs in tests would otherwise carry
        // its buckets from one test into the next. A fresh namespace per
        // app gives the limiters the isolation the database already has;
        // it is empty in every real deployment, where replicas must share
        // buckets. See `SecurityConfig::rate_limit_namespace`.
        security: SecurityConfig {
            rate_limit_namespace: format!("test-{}", Uuid::new_v4().simple()),
            ..SecurityConfig::default()
        },
        cf_access: CfAccessConfig::default(),
        line_messaging: LineMessagingConfig::default(),
        pms: PmsConfig::default(),
        loyalty_service: LoyaltyServiceConfig {
            token: Some(TEST_LOYALTY_SERVICE_TOKEN.to_string()),
        },
        // Feature off by default; tests opt in via TestApp::new_with_config.
        admin_bootstrap: AdminBootstrapConfig::default(),
        // No property mailbox: the booking notification is off unless a test
        // sets one through `TestApp::new_with_config`.
        booking_notify: BookingNotifyConfig::default(),
    }
}

/// Service token used by machine-to-machine tests (PMS stay accrual).
pub const TEST_LOYALTY_SERVICE_TOKEN: &str = "test-loyalty-service-token";

// ============================================================================
// Legacy Setup Functions (backward-compatible, now with per-test DB isolation)
// ============================================================================

/// Setup function to run before each test.
/// Now creates an isolated per-test database.
pub async fn setup_test() -> (PgPool, TestDatabase) {
    let _ = dotenvy::dotenv();

    // Ensure template is ready
    ensure_template_db()
        .await
        .expect("Failed to ensure template database");

    // Create a unique per-test database.
    // First try the cached admin pool for speed, then fall back to a fresh
    // direct connection (bypasses tokio runtime lifetime issues entirely).
    let db_name = format!("test_{}", Uuid::new_v4().simple());
    let mut created = false;

    // Attempt 1: use cached admin pool (fast path)
    if let Ok(admin_pool) = get_admin_pool().await {
        if sqlx::query(&format!(
            "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
            db_name, TEMPLATE_DB_NAME
        ))
        .execute(&admin_pool)
        .await
        .is_ok()
        {
            created = true;
        } else {
            // Invalidate stale pool
            let mut guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
            *guard = None;
        }
    }

    // Attempt 2: fresh direct connection (immune to tokio runtime issues)
    if !created {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        create_db_fresh_connection(&db_name)
            .await
            .expect("Failed to create per-test database (fresh connection)");
    }

    // Connect to the new per-test database
    let test_url = {
        let url = test_database_url();
        if let Some(pos) = url.rfind('/') {
            format!("{}{}", &url[..pos + 1], db_name)
        } else {
            url
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(5))
        .max_lifetime(std::time::Duration::from_secs(30))
        .connect(&test_url)
        .await
        .expect("Failed to connect to per-test database");

    let test_db = TestDatabase {
        pool: pool.clone(),
        db_name,
    };

    (pool, test_db)
}

/// Teardown function to run after each test.
/// Drops the per-test database.
pub async fn teardown_test(test_db: &TestDatabase) {
    let _ = test_db.drop_database().await;
}

/// Initialize the test database pool (legacy compatibility).
/// Now creates a per-test database.
pub async fn init_test_db() -> Result<PgPool, sqlx::Error> {
    let _ = dotenvy::dotenv();

    ensure_template_db()
        .await
        .map_err(|e| sqlx::Error::Configuration(e.to_string().into()))?;

    let db_name = format!("test_{}", Uuid::new_v4().simple());

    // Try cached pool first, fall back to fresh direct connection
    let mut created = false;
    if let Ok(admin_pool) = get_admin_pool().await {
        let create_sql = format!(
            "CREATE DATABASE \"{}\" TEMPLATE \"{}\"",
            db_name, TEMPLATE_DB_NAME
        );
        if sqlx::query(&create_sql).execute(&admin_pool).await.is_ok() {
            created = true;
        } else {
            let mut guard = ADMIN_POOL.lock().unwrap_or_else(|e| e.into_inner());
            *guard = None;
        }
    }
    if !created {
        create_db_fresh_connection(&db_name)
            .await
            .map_err(|e| sqlx::Error::Configuration(e.to_string().into()))?;
    }

    let test_url = {
        let url = test_database_url();
        if let Some(pos) = url.rfind('/') {
            format!("{}{}", &url[..pos + 1], db_name)
        } else {
            url
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(5))
        .max_lifetime(std::time::Duration::from_secs(30))
        .connect(&test_url)
        .await?;

    // Store the db_name so it can be cleaned up
    // We leak it via a global registry for legacy callers
    register_test_db(db_name);

    Ok(pool)
}

/// Set up the test database (legacy alias).
pub async fn setup_test_db() -> Result<PgPool, sqlx::Error> {
    init_test_db().await
}

/// Registry for test databases created via init_test_db() so they get cleaned up
static TEST_DB_REGISTRY: Lazy<Arc<Mutex<Vec<String>>>> =
    Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

fn register_test_db(name: String) {
    // Use try_lock to avoid blocking; it's okay if we miss one
    if let Ok(mut registry) = TEST_DB_REGISTRY.try_lock() {
        registry.push(name);
    }
}

// ============================================================================
// Test Database Wrapper
// ============================================================================

/// Test database wrapper with per-test isolation
pub struct TestDatabase {
    pub pool: PgPool,
    /// Per-test database name for cleanup
    pub db_name: String,
}

impl TestDatabase {
    /// Get a reference to the pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Clean up: close pool and drop the per-test database
    pub async fn cleanup(&self) -> Result<(), sqlx::Error> {
        self.drop_database().await
    }

    /// Drop the per-test database
    pub async fn drop_database(&self) -> Result<(), sqlx::Error> {
        self.pool.close().await;

        if let Ok(admin_pool) = get_admin_pool().await {
            let _ = sqlx::query(&format!(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}' AND pid <> pg_backend_pid()",
                self.db_name
            ))
            .execute(&admin_pool)
            .await;

            let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", self.db_name))
                .execute(&admin_pool)
                .await;
        }
        Ok(())
    }
}

// ============================================================================
// Test User Management
// ============================================================================

/// Test user fixture data
#[derive(Debug, Clone)]
pub struct TestUser {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub role: String,
    pub is_active: bool,
    pub email_verified: bool,
}

impl TestUser {
    /// Create a new test user fixture
    pub fn new(email: &str) -> Self {
        Self {
            id: Uuid::new_v4(),
            email: email.to_string(),
            password_hash: CACHED_TEST_PASSWORD_HASH.clone(),
            role: "customer".to_string(),
            is_active: true,
            email_verified: true,
        }
    }

    /// Create an admin test user
    pub fn admin(email: &str) -> Self {
        let mut user = Self::new(email);
        user.role = "admin".to_string();
        user
    }

    /// Create an unverified test user
    #[allow(dead_code)]
    pub fn unverified(email: &str) -> Self {
        let mut user = Self::new(email);
        user.email_verified = false;
        user
    }

    /// Create an inactive test user
    #[allow(dead_code)]
    pub fn inactive(email: &str) -> Self {
        let mut user = Self::new(email);
        user.is_active = false;
        user
    }

    /// Insert this user into the database
    pub async fn insert(&self, pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, role, is_active, email_verified)
            VALUES ($1, $2, $3, $4::user_role, $5, $6)
            "#,
        )
        .bind(self.id)
        .bind(&self.email)
        .bind(&self.password_hash)
        .bind(&self.role)
        .bind(self.is_active)
        .bind(self.email_verified)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Insert user with profile
    pub async fn insert_with_profile(
        &self,
        pool: &PgPool,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), sqlx::Error> {
        self.insert(pool).await?;

        // Generate a unique membership_id (8-char uppercase hex from UUID)
        let membership_id = self.id.to_string()[..8].to_uppercase();

        sqlx::query(
            r#"
            INSERT INTO user_profiles (user_id, first_name, last_name, membership_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO NOTHING
            "#,
        )
        .bind(self.id)
        .bind(first_name)
        .bind(last_name)
        .bind(membership_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}

/// Create a test user in the database.
pub async fn create_test_user(
    pool: &PgPool,
    email: &str,
) -> Result<TestUser, Box<dyn std::error::Error + Send + Sync>> {
    let user = TestUser::new(email);
    user.insert(pool).await?;
    Ok(user)
}

/// Get a JWT auth token for a test user.
pub fn get_auth_token(user_id: &Uuid, email: &str) -> String {
    generate_test_token(user_id, email)
}

// ============================================================================
// Test Coupon Fixtures
// ============================================================================

/// Test coupon fixture data
#[derive(Debug, Clone)]
pub struct TestCoupon {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub coupon_type: String,
    pub value: Option<f64>,
    pub status: String,
    pub valid_from: Option<chrono::DateTime<chrono::Utc>>,
    pub valid_until: Option<chrono::DateTime<chrono::Utc>>,
}

impl TestCoupon {
    /// Create a new percentage discount coupon
    pub fn percentage(code: &str, value: f64) -> Self {
        Self {
            id: Uuid::new_v4(),
            code: code.to_string(),
            name: format!("{}% Off", value),
            coupon_type: "percentage".to_string(),
            value: Some(value),
            status: "active".to_string(),
            valid_from: Some(Utc::now() - Duration::days(1)),
            valid_until: Some(Utc::now() + Duration::days(30)),
        }
    }

    /// Create a fixed amount coupon
    pub fn fixed_amount(code: &str, value: f64) -> Self {
        Self {
            id: Uuid::new_v4(),
            code: code.to_string(),
            name: format!("{} THB Off", value),
            coupon_type: "fixed_amount".to_string(),
            value: Some(value),
            status: "active".to_string(),
            valid_from: Some(Utc::now() - Duration::days(1)),
            valid_until: Some(Utc::now() + Duration::days(30)),
        }
    }

    /// Create an expired coupon
    pub fn expired(code: &str) -> Self {
        let mut coupon = Self::percentage(code, 10.0);
        coupon.status = "expired".to_string();
        coupon.valid_until = Some(Utc::now() - Duration::days(1));
        coupon
    }

    /// Insert this coupon into the database
    pub async fn insert(&self, pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO coupons (id, code, name, type, value, status, valid_from, valid_until)
            VALUES ($1, $2, $3, $4::coupon_type, $5, $6::coupon_status, $7, $8)
            "#,
        )
        .bind(self.id)
        .bind(&self.code)
        .bind(&self.name)
        .bind(&self.coupon_type)
        .bind(self.value)
        .bind(&self.status)
        .bind(self.valid_from)
        .bind(self.valid_until)
        .execute(pool)
        .await?;

        Ok(())
    }
}

// ============================================================================
// TestClient - HTTP Client for Testing
// ============================================================================

/// HTTP client wrapper for making test requests.
#[derive(Clone)]
pub struct TestClient {
    router: Router,
    auth_token: Option<String>,
    /// Optional `Cookie` request header value (e.g. `"refresh_token=abc"`).
    /// Used by tests that need to exercise cookie-based auth flows.
    cookie_header: Option<String>,
    /// Extra request headers applied to every request this client makes.
    ///
    /// Needed by anything whose credential is not a bearer token: the
    /// public deposit-link routes take their capability in
    /// `X-Deposit-Token`, and the per-IP limiters read the forwarding
    /// headers.
    extra_headers: Vec<(String, String)>,
    /// The TCP peer this client pretends to be, as axum's `ConnectInfo`.
    ///
    /// `oneshot` inserts none, and code that reads the peer then falls
    /// back to loopback. Anything that decides whether to *believe* a
    /// forwarding header needs to present an untrusted peer as well as a
    /// trusted one, which is what this is for.
    peer: Option<SocketAddr>,
}

impl TestClient {
    /// Create a new test client with a router
    pub fn new(router: Router) -> Self {
        Self {
            router,
            auth_token: None,
            cookie_header: None,
            extra_headers: Vec::new(),
            peer: None,
        }
    }

    /// Present a particular TCP peer to the router, the way a real
    /// connection would. See the `peer` field.
    #[allow(dead_code)]
    pub fn with_peer(mut self, addr: &str) -> Self {
        self.peer = Some(
            format!("{addr}:54321")
                .parse()
                .expect("test peer address literal"),
        );
        self
    }

    /// Attach an arbitrary request header to every subsequent request.
    #[allow(dead_code)]
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.extra_headers
            .push((name.to_string(), value.to_string()));
        self
    }

    /// Set the authentication token
    pub fn with_auth(mut self, token: &str) -> Self {
        self.auth_token = Some(token.to_string());
        self
    }

    /// Attach a raw `Cookie` request header to all subsequent requests.
    ///
    /// `value` should be the full header value without the field name, e.g.
    /// `"refresh_token=abc; other=xyz"`. Pass a single cookie pair when
    /// testing cookie-based auth: `with_cookie("refresh_token=abc")`.
    #[allow(dead_code)]
    pub fn with_cookie(mut self, value: &str) -> Self {
        self.cookie_header = Some(value.to_string());
        self
    }

    /// Apply the auth/cookie headers configured on this client to a builder.
    fn apply_common_headers(
        &self,
        mut builder: axum::http::request::Builder,
    ) -> axum::http::request::Builder {
        if let Some(token) = &self.auth_token {
            builder = builder.header("Authorization", format!("Bearer {}", token));
        }
        if let Some(cookie) = &self.cookie_header {
            builder = builder.header("Cookie", cookie);
        }
        for (name, value) in &self.extra_headers {
            builder = builder.header(name, value);
        }
        if let Some(peer) = self.peer {
            builder = builder.extension(axum::extract::ConnectInfo(peer));
        }
        builder
    }

    /// Make a GET request
    pub async fn get(&self, uri: &str) -> TestResponse {
        let builder = Request::builder()
            .method("GET")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a POST request with JSON body
    pub async fn post<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a POST request with JSON body and additional headers (e.g.
    /// `Idempotency-Key`). Each header is appended on top of the
    /// `Content-Type` + auth headers already applied by
    /// `apply_common_headers`.
    #[allow(dead_code)]
    pub async fn post_with_headers<T: Serialize>(
        &self,
        uri: &str,
        body: &T,
        extra_headers: &[(&str, &str)],
    ) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let mut builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", "application/json");
        builder = self.apply_common_headers(builder);
        for (name, value) in extra_headers {
            builder = builder.header(*name, *value);
        }

        let request = builder.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a POST request with empty body
    #[allow(dead_code)]
    pub async fn post_empty(&self, uri: &str) -> TestResponse {
        let builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a PUT request with JSON body
    pub async fn put<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let builder = Request::builder()
            .method("PUT")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a PATCH request with JSON body
    #[allow(dead_code)]
    pub async fn patch<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let builder = Request::builder()
            .method("PATCH")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a DELETE request
    pub async fn delete(&self, uri: &str) -> TestResponse {
        let builder = Request::builder()
            .method("DELETE")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }

    /// Make a DELETE request with a JSON body.
    ///
    /// Most DELETEs are body-less, but a few admin endpoints
    /// (e.g. unblock-dates) accept a JSON payload describing what to remove.
    /// HTTP allows DELETE with a body; axum extracts the body via `Json<…>`
    /// the same way it does for POST/PUT.
    pub async fn delete_with_body<T: Serialize>(&self, uri: &str, body: &T) -> TestResponse {
        let body_json = serde_json::to_string(body).unwrap();

        let builder = Request::builder()
            .method("DELETE")
            .uri(uri)
            .header("Content-Type", "application/json");
        let builder = self.apply_common_headers(builder);

        let request = builder.body(Body::from(body_json)).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();

        TestResponse::from_response(response).await
    }
}

/// Test response wrapper with helper methods
#[derive(Debug)]
pub struct TestResponse {
    pub status: u16,
    pub body: String,
    /// All response headers, captured so tests can assert on `Set-Cookie`
    /// and other response metadata.
    pub headers: HeaderMap,
}

impl TestResponse {
    /// Create from an axum response
    async fn from_response(response: axum::response::Response) -> Self {
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();

        Self {
            status,
            body,
            headers,
        }
    }

    /// Return all `Set-Cookie` header values as owned strings.
    ///
    /// A handler may emit multiple `Set-Cookie` headers (e.g. one per cookie),
    /// so this returns a `Vec` rather than a single value.
    #[allow(dead_code)]
    pub fn set_cookie_values(&self) -> Vec<String> {
        self.headers
            .get_all(axum::http::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok().map(str::to_string))
            .collect()
    }

    /// Find the first `Set-Cookie` header whose name matches `cookie_name`,
    /// returning the entire header value (with attributes).
    #[allow(dead_code)]
    pub fn set_cookie_for(&self, cookie_name: &str) -> Option<String> {
        let prefix = format!("{}=", cookie_name);
        self.set_cookie_values()
            .into_iter()
            .find(|v| v.starts_with(&prefix))
    }

    /// Parse the body as JSON
    pub fn json<T: DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_str(&self.body)
    }

    /// Check if the response is successful (2xx)
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Assert the status code
    pub fn assert_status(&self, expected: u16) {
        assert_eq!(
            self.status, expected,
            "Expected status {}, got {}. Body: {}",
            expected, self.status, self.body
        );
    }

    /// Assert the response is successful (2xx)
    #[allow(dead_code)]
    pub fn assert_success(&self) {
        assert!(
            self.is_success(),
            "Expected success status, got {}. Body: {}",
            self.status,
            self.body
        );
    }

    /// Get a JSON field value as string
    #[allow(dead_code)]
    pub fn json_field(&self, field: &str) -> Option<String> {
        let json: serde_json::Value = self.json().ok()?;
        json.get(field)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
}

// ============================================================================
// Authentication Helpers
// ============================================================================

/// Generate a test JWT token for a user
pub fn generate_test_token(user_id: &Uuid, email: &str) -> String {
    generate_test_token_with_role(user_id, email, "customer")
}

/// Generate a test JWT token for a user with a specific role
pub fn generate_test_token_with_role(user_id: &Uuid, email: &str, role: &str) -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    struct Claims {
        id: String,
        email: Option<String>,
        role: String,
        exp: i64,
        iat: Option<i64>,
    }

    let now = Utc::now();
    let claims = Claims {
        id: user_id.to_string(),
        email: Some(email.to_string()),
        role: role.to_string(),
        exp: (now + Duration::hours(1)).timestamp(),
        iat: Some(now.timestamp()),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .unwrap()
}

/// Generate an expired test token
pub fn generate_expired_token(user_id: &Uuid, email: &str) -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    struct Claims {
        id: String,
        email: Option<String>,
        role: String,
        exp: i64,
        iat: Option<i64>,
    }

    let now = Utc::now();
    let claims = Claims {
        id: user_id.to_string(),
        email: Some(email.to_string()),
        role: "customer".to_string(),
        exp: (now - Duration::hours(1)).timestamp(), // Expired 1 hour ago
        iat: Some((now - Duration::hours(2)).timestamp()),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .unwrap()
}

/// Hash a password for testing (using argon2)
pub fn hash_test_password(password: &str) -> String {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .unwrap()
        .to_string()
}

// ============================================================================
// Redis Test Helpers
// ============================================================================

/// What the relay is currently doing to the traffic it carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RelayMode {
    /// Bytes flow both ways: a healthy Redis.
    Pass,
    /// Sockets stay open and carry nothing. This is the failure a
    /// connection-refused test cannot reach — the server is *there*, the
    /// TCP handshake succeeds, the command is accepted, and no answer
    /// ever comes. Nothing in the client stack times this out by itself.
    BlackHole,
    /// Every socket is dropped and the port stops accepting: reconnects
    /// are refused.
    Cut,
}

/// A TCP relay in front of the shared test Redis, so a test can take
/// Redis away in the middle of a run.
///
/// There is no other way to model it: `ConnectionManager::new` connects
/// eagerly, so an app pointed straight at a dead port cannot be built at
/// all — which is not the failure worth testing. What production actually
/// does is lose a Redis that was working, so that is what this reproduces.
/// Build the app against [`RedisRelay::url`], then pick the failure:
///
/// - [`RedisRelay::cut`] — open connections are dropped and the port stops
///   accepting, so every later command fails and every reconnect is
///   refused. The *fast* failure.
/// - [`RedisRelay::black_hole`] — connections stay open and carry nothing,
///   so a command is accepted and never answered. The *slow* failure, and
///   the one only a client-side deadline can end.
pub struct RedisRelay {
    url: String,
    mode: tokio::sync::watch::Sender<RelayMode>,
    accept: tokio::task::JoinHandle<()>,
}

impl RedisRelay {
    /// Start relaying to the shared test Redis on a fresh loopback port.
    pub async fn start() -> Result<Self, std::io::Error> {
        let upstream = redis_host_port();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let (mode, mode_rx) = tokio::sync::watch::channel(RelayMode::Pass);

        let accept = tokio::spawn(async move {
            loop {
                let accepted = {
                    let mut rx = mode_rx.clone();
                    tokio::select! {
                        _ = rx.wait_for(|mode| *mode == RelayMode::Cut) => break,
                        accepted = listener.accept() => accepted,
                    }
                };
                let Ok((mut inbound, _)) = accepted else {
                    break;
                };
                let upstream = upstream.clone();
                let mut rx = mode_rx.clone();
                tokio::spawn(async move {
                    if *rx.borrow_and_update() == RelayMode::Pass {
                        let Ok(mut outbound) = tokio::net::TcpStream::connect(&upstream).await
                        else {
                            return;
                        };
                        tokio::select! {
                            _ = rx.wait_for(|mode| *mode != RelayMode::Pass) => {},
                            _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound) => return,
                        }
                        if *rx.borrow_and_update() == RelayMode::Cut {
                            // Dropping both sockets here is the cut: the
                            // client's connection dies at once.
                            return;
                        }
                        // Black-holing: hold both ends open and move no
                        // bytes, so whatever the client writes is accepted
                        // by the kernel and answered by nobody.
                        let _ = rx.wait_for(|mode| *mode == RelayMode::Cut).await;
                        return;
                    }
                    // Accepted while black-holing: never reach upstream,
                    // never answer, keep the socket open.
                    let _ = rx.wait_for(|mode| *mode == RelayMode::Cut).await;
                    drop(inbound);
                });
            }
        });

        Ok(Self {
            url: relay_url(addr),
            mode,
            accept,
        })
    }

    /// The URL an app should be built against.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Take Redis away: cut every relayed connection and stop listening,
    /// so reconnects are refused too.
    pub fn cut(&self) {
        let _ = self.mode.send(RelayMode::Cut);
        self.accept.abort();
    }

    /// Turn Redis into a black hole: connections stay up, commands are
    /// accepted, nothing is ever answered — and new connections are
    /// accepted and black-holed too, so a reconnect does not escape it.
    pub fn black_hole(&self) {
        let _ = self.mode.send(RelayMode::BlackHole);
    }
}

impl Drop for RedisRelay {
    fn drop(&mut self) {
        self.cut();
    }
}

/// Split `TEST_REDIS_URL` into (everything before the host, host:port,
/// everything after) so [`RedisRelay`] can reach the real server and hand
/// out a URL that differs from it *only* in host and port — any
/// credentials or database number in the configured URL survive.
fn redis_url_parts() -> (String, String, String) {
    let url = test_redis_url();
    let (scheme, rest) = match url.split_once("://") {
        Some((scheme, rest)) => (format!("{scheme}://"), rest.to_string()),
        None => (String::new(), url.clone()),
    };
    let (authority, tail) = match rest.find('/') {
        Some(at) => (rest[..at].to_string(), rest[at..].to_string()),
        None => (rest.clone(), String::new()),
    };
    let (userinfo, host_port) = match authority.rsplit_once('@') {
        Some((userinfo, host_port)) => (format!("{userinfo}@"), host_port.to_string()),
        None => (String::new(), authority),
    };
    let host_port = if host_port.contains(':') {
        host_port
    } else {
        format!("{host_port}:6379")
    };
    (format!("{scheme}{userinfo}"), host_port, tail)
}

/// Where the real test Redis lives, for [`RedisRelay`]'s upstream.
fn redis_host_port() -> String {
    redis_url_parts().1
}

/// `TEST_REDIS_URL` with the relay's address in place of the real one.
fn relay_url(addr: SocketAddr) -> String {
    let (head, _, tail) = redis_url_parts();
    format!("{head}{addr}{tail}")
}

/// Initialize test Redis connection
pub async fn init_test_redis() -> Result<ConnectionManager, redis::RedisError> {
    let client = redis::Client::open(test_redis_url())?;
    ConnectionManager::new_with_config(client, loyalty_backend::redis::connection_manager_config())
        .await
}

/// Clean up Redis test data
#[allow(dead_code)]
pub async fn cleanup_redis(
    conn: &mut ConnectionManager,
    pattern: &str,
) -> Result<(), redis::RedisError> {
    use redis::AsyncCommands;

    let keys: Vec<String> = redis::cmd("KEYS").arg(pattern).query_async(conn).await?;

    if !keys.is_empty() {
        let _: () = conn.del(keys).await?;
    }

    Ok(())
}

// ============================================================================
// Legacy cleanup (no longer needed with per-test DB isolation, but kept for compat)
// ============================================================================

/// Clean up the test database (legacy - no-op with per-test isolation).
#[allow(dead_code)]
pub async fn cleanup_test_db(_pool: &PgPool) -> Result<(), sqlx::Error> {
    // No-op: each test has its own database that gets dropped on cleanup
    Ok(())
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/// Assert that a JSON response contains expected fields
#[macro_export]
macro_rules! assert_json_contains {
    ($response:expr, $($key:expr => $value:expr),+ $(,)?) => {{
        let json: serde_json::Value = $response.json().expect("Response should be valid JSON");
        $(
            assert_eq!(
                json.get($key),
                Some(&serde_json::json!($value)),
                "Expected {} to be {:?}, got {:?}",
                $key,
                $value,
                json.get($key)
            );
        )+
    }};
}

/// Assert that a JSON response has a specific error code
#[macro_export]
macro_rules! assert_error_code {
    ($response:expr, $code:expr) => {{
        let json: serde_json::Value = $response.json().expect("Response should be valid JSON");
        assert_eq!(
            json.get("error").and_then(|v| v.as_str()),
            Some($code),
            "Expected error code '{}', got {:?}",
            $code,
            json.get("error")
        );
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_test_user_creation() {
        let user = TestUser::new("test@example.com");
        assert_eq!(user.email, "test@example.com");
        assert_eq!(user.role, "customer");
        assert!(user.is_active);
        assert!(user.email_verified);
    }

    #[test]
    fn test_test_user_admin() {
        let user = TestUser::admin("admin@example.com");
        assert_eq!(user.role, "admin");
    }

    #[test]
    fn test_test_coupon_creation() {
        let coupon = TestCoupon::percentage("SAVE10", 10.0);
        assert_eq!(coupon.code, "SAVE10");
        assert_eq!(coupon.coupon_type, "percentage");
        assert_eq!(coupon.value, Some(10.0));
        assert_eq!(coupon.status, "active");
    }

    #[test]
    fn test_hash_test_password() {
        let hash = hash_test_password("testpassword");
        assert!(hash.starts_with("$argon2"));
    }

    #[test]
    fn test_generate_test_token() {
        let user_id = Uuid::new_v4();
        let token = generate_test_token(&user_id, "test@example.com");
        // Token should have 3 parts (header.payload.signature)
        assert_eq!(token.split('.').count(), 3);
    }

    #[test]
    fn test_get_auth_token() {
        let user_id = Uuid::new_v4();
        let token = get_auth_token(&user_id, "test@example.com");
        assert_eq!(token.split('.').count(), 3);
    }
}
