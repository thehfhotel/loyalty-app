# SQLx Compile-Time Checked Queries

This directory stores cached query metadata for SQLx's compile-time query verification.

## How it works

When you use SQLx's `query!` or `query_as!` macros, SQLx verifies your SQL queries at compile time against your actual database schema. To enable offline compilation (building without a database connection), SQLx caches the query metadata in this directory.

## Generating query cache

To generate/update the query cache, run:

```bash
# Ensure DATABASE_URL is set
export DATABASE_URL="postgresql://user:password@localhost:5432/loyalty_db"

# Generate the query cache
cargo sqlx prepare
```

This will create `.sqlx/query-*.json` files for each unique query in your codebase.

## CI/CD Usage

In CI environments where a database may not be available:

1. Commit the `.sqlx` directory to version control
2. Set `SQLX_OFFLINE=true` environment variable
3. Build will use cached query metadata instead of connecting to a database

## Important Notes

- Always regenerate the cache after modifying SQL queries
- Always regenerate the cache after database schema changes
- The cache files are JSON and can be committed to git
- Run `cargo sqlx prepare --check` in CI to verify the cache is up-to-date
