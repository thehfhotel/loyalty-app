//! Database migration handling module
//!
//! This module provides functionality for running embedded database migrations
//! using sqlx's built-in migration support.

use anyhow::{Context, Result};
use sqlx::PgPool;
use tracing::info;

/// Embedded migrations from the migrations directory
///
/// This macro embeds all SQL migrations from the `migrations` directory
/// at compile time, making them available without needing the files at runtime.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Run all pending database migrations
///
/// This function runs all pending migrations that haven't been applied yet.
/// Migrations are run in order based on their version (filename prefix).
///
/// # Arguments
/// * `pool` - A reference to the PostgreSQL connection pool
///
/// # Returns
/// * `Result<()>` - Success or an error if migrations fail
///
/// # Errors
/// * Returns an error if any migration fails to apply
/// * Returns an error if the migration table cannot be created
///
/// # Example
/// ```rust,no_run
/// use loyalty_backend::db::{init_pool, migrations::run_migrations};
///
/// #[tokio::main]
/// async fn main() {
///     let db = init_pool(None).await.expect("Failed to connect");
///     run_migrations(db.pool()).await.expect("Failed to run migrations");
/// }
/// ```
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations...");

    // Bridge: detect databases previously managed by Prisma and mark
    // the init migration as already applied so sqlx skips it.
    bridge_prisma_migration(pool).await?;

    // Get information about pending migrations before running
    let applied = get_applied_migrations(pool).await?;
    let total_migrations = MIGRATOR.migrations.len();
    let pending = total_migrations - applied.len();

    if pending == 0 {
        info!("No pending migrations to apply");
        return Ok(());
    }

    info!(
        total = total_migrations,
        applied = applied.len(),
        pending = pending,
        "Found pending migrations"
    );

    // Run the migrations
    MIGRATOR
        .run(pool)
        .await
        .context("Failed to run database migrations")?;

    info!("Database migrations completed successfully");

    Ok(())
}

/// Bridge for Prisma-to-sqlx migration.
///
/// Detects databases whose tables were created by the legacy Prisma backend
/// (before the Rust migration). Since Prisma doesn't use `_sqlx_migrations`,
/// sqlx would try to re-run the init migration and fail on existing tables.
/// This function marks the init migration as already applied.
async fn bridge_prisma_migration(pool: &PgPool) -> Result<()> {
    // Check if a core table exists (proof the schema was already created by Prisma)
    let tables_exist: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'users'
        )"#,
    )
    .fetch_one(pool)
    .await
    .context("Failed to check for existing tables")?;

    if !tables_exist {
        return Ok(()); // Fresh database — no bridge needed
    }

    // Check if sqlx already tracks the init migration
    let sqlx_table_exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = '_sqlx_migrations'
        )"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if sqlx_table_exists {
        let init_tracked: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT FROM _sqlx_migrations WHERE version = 20240101000000)",
        )
        .fetch_one(pool)
        .await
        .unwrap_or(false);

        if init_tracked {
            return Ok(()); // Already tracked — nothing to do
        }
    }

    info!("Detected pre-existing database (Prisma). Marking init migration as applied.");

    // Create _sqlx_migrations table with the schema sqlx expects
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
            success BOOLEAN NOT NULL,
            checksum BYTEA NOT NULL,
            execution_time BIGINT NOT NULL DEFAULT 0
        )"#,
    )
    .execute(pool)
    .await
    .context("Failed to create _sqlx_migrations table")?;

    // Get the init migration's metadata from the embedded migrator
    let init_migration = MIGRATOR
        .migrations
        .iter()
        .find(|m| m.version == 20240101000000)
        .context("Init migration (20240101000000) not found in embedded migrations")?;

    // Mark as applied with the correct checksum
    sqlx::query(
        r#"INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
           VALUES ($1, $2, now(), true, $3, 0)
           ON CONFLICT (version) DO NOTHING"#,
    )
    .bind(init_migration.version)
    .bind(init_migration.description.as_ref())
    .bind(&init_migration.checksum as &[u8])
    .execute(pool)
    .await
    .context("Failed to mark init migration as applied")?;

    info!("Init migration marked as applied (Prisma bridge)");
    Ok(())
}

/// Get list of applied migrations
///
/// # Arguments
/// * `pool` - A reference to the PostgreSQL connection pool
///
/// # Returns
/// * `Result<Vec<MigrationInfo>>` - List of applied migrations or an error
pub async fn get_applied_migrations(pool: &PgPool) -> Result<Vec<MigrationInfo>> {
    // Check if the migrations table exists
    let table_exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = '_sqlx_migrations'
        )
        "#,
    )
    .fetch_one(pool)
    .await
    .context("Failed to check if migrations table exists")?;

    if !table_exists {
        return Ok(Vec::new());
    }

    // Get applied migrations
    let migrations = sqlx::query_as::<_, MigrationRow>(
        r#"
        SELECT version, description, installed_on, checksum
        FROM _sqlx_migrations
        ORDER BY version ASC
        "#,
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch applied migrations")?;

    Ok(migrations
        .into_iter()
        .map(|row| MigrationInfo {
            version: row.version,
            description: row.description,
            installed_on: row.installed_on,
            checksum: hex::encode(&row.checksum),
        })
        .collect())
}

/// Get list of all available migrations (both applied and pending)
///
/// # Returns
/// * `Vec<AvailableMigration>` - List of all embedded migrations
pub fn get_available_migrations() -> Vec<AvailableMigration> {
    MIGRATOR
        .migrations
        .iter()
        .map(|m| AvailableMigration {
            version: m.version,
            description: m.description.to_string(),
            migration_type: match m.migration_type {
                sqlx::migrate::MigrationType::ReversibleUp => "reversible_up".to_string(),
                sqlx::migrate::MigrationType::ReversibleDown => "reversible_down".to_string(),
                sqlx::migrate::MigrationType::Simple => "simple".to_string(),
            },
        })
        .collect()
}

/// Check if there are pending migrations
///
/// # Arguments
/// * `pool` - A reference to the PostgreSQL connection pool
///
/// # Returns
/// * `Result<bool>` - True if there are pending migrations
pub async fn has_pending_migrations(pool: &PgPool) -> Result<bool> {
    let applied = get_applied_migrations(pool).await?;
    let total = MIGRATOR.migrations.len();
    Ok(applied.len() < total)
}

/// Validate that all migrations have correct checksums
///
/// This checks that the embedded migrations match what was applied to the database.
///
/// # Arguments
/// * `pool` - A reference to the PostgreSQL connection pool
///
/// # Returns
/// * `Result<ValidationResult>` - Validation result with any mismatches
pub async fn validate_migrations(pool: &PgPool) -> Result<ValidationResult> {
    let applied = get_applied_migrations(pool).await?;
    let mut mismatches = Vec::new();
    let mut missing = Vec::new();

    for migration in MIGRATOR.migrations.iter() {
        if let Some(applied_migration) = applied.iter().find(|a| a.version == migration.version) {
            let embedded_checksum = hex::encode(&migration.checksum);
            if applied_migration.checksum != embedded_checksum {
                mismatches.push(MigrationMismatch {
                    version: migration.version,
                    description: migration.description.to_string(),
                    expected_checksum: embedded_checksum,
                    actual_checksum: applied_migration.checksum.clone(),
                });
            }
        } else {
            missing.push(migration.version);
        }
    }

    Ok(ValidationResult {
        is_valid: mismatches.is_empty(),
        mismatches,
        pending_versions: missing,
    })
}

/// Information about an applied migration
#[derive(Debug, Clone)]
pub struct MigrationInfo {
    pub version: i64,
    pub description: String,
    pub installed_on: chrono::DateTime<chrono::Utc>,
    pub checksum: String,
}

/// Information about an available migration (embedded in binary)
#[derive(Debug, Clone)]
pub struct AvailableMigration {
    pub version: i64,
    pub description: String,
    pub migration_type: String,
}

/// Result of migration validation
#[derive(Debug)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub mismatches: Vec<MigrationMismatch>,
    pub pending_versions: Vec<i64>,
}

/// Information about a migration checksum mismatch
#[derive(Debug)]
pub struct MigrationMismatch {
    pub version: i64,
    pub description: String,
    pub expected_checksum: String,
    pub actual_checksum: String,
}

/// Internal struct for querying migration rows
#[derive(sqlx::FromRow)]
struct MigrationRow {
    version: i64,
    description: String,
    installed_on: chrono::DateTime<chrono::Utc>,
    checksum: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_available_migrations() {
        // This will work even without a database connection
        // It just reads the embedded migrations
        let migrations = get_available_migrations();
        // Verify we have at least one migration
        assert!(!migrations.is_empty(), "Expected at least one migration");
    }
}
