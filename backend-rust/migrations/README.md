# SQLx Migrations for Rust Backend

This directory contains database migrations for the Rust backend using SQLx.

## Overview

The Rust backend uses the same PostgreSQL database schema as the Node.js backend. The initial migration (`20240101000000_init.sql`) is copied from the Prisma migration to ensure compatibility.

## Prerequisites

- SQLx CLI installed: `cargo install sqlx-cli --no-default-features --features postgres`
- PostgreSQL database running
- `DATABASE_URL` environment variable set

## Running Migrations

### Apply all pending migrations

```bash
sqlx migrate run
```

### Check migration status

```bash
sqlx migrate info
```

### Revert the last migration

```bash
sqlx migrate revert
```

## Creating New Migrations

### Create a new migration file

```bash
sqlx migrate add <migration_name>
```

This creates a new file in the migrations directory with the format:
`<timestamp>_<migration_name>.sql`

### Migration file naming convention

- Use timestamps in the format `YYYYMMDDHHMMSS`
- Use descriptive names (e.g., `add_user_preferences`, `update_tier_benefits`)
- Example: `20240215143000_add_user_preferences.sql`

## Important Notes

1. **Schema Compatibility**: The initial schema is copied from Prisma migrations to ensure both Node.js and Rust backends work with the same database schema.

2. **Stored Procedures**: The migration includes PostgreSQL stored procedures for:
   - `recalculate_user_tier_by_nights()` - Recalculates user tier based on nights stayed
   - `award_points()` - Awards points to users and updates tier
   - `assign_coupon_to_user()` - Assigns coupons with validation
   - `redeem_coupon()` - Redeems coupons by QR code
   - Various notification and survey-related functions

3. **Compile-time Verification**: SQLx supports compile-time SQL verification. Run `cargo sqlx prepare` to generate query metadata for offline checking.

4. **Environment Variables**: Set `DATABASE_URL` before running migrations:
   ```bash
   export DATABASE_URL="postgresql://user:password@localhost:5432/loyalty_db"
   ```

## Migration History

| Migration | Description |
|-----------|-------------|
| `20240101000000_init.sql` | Initial schema (from Prisma migration) |

## Troubleshooting

### Migration already applied

If you see "migration already applied" errors, the database already has the schema. This is expected when sharing a database with the Node.js backend.

### Type already exists

If you see "type already exists" errors during development, you may need to reset the database or ensure migrations are idempotent.

### Permission denied

Ensure the database user has sufficient privileges to create extensions, tables, and functions.
