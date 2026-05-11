#!/usr/bin/env bash
# =============================================================================
# regen-sqlx-cache.sh — Regenerate the .sqlx/ offline query cache
# =============================================================================
#
# sqlx's compile-time query macros (`sqlx::query!`, `sqlx::query_as!`) validate
# every query against a live database at build time, then cache the type
# information under `.sqlx/`. CI (`cargo sqlx prepare --check`) and the
# Distroless image build (offline mode) rely on this cache. Whenever you add
# or modify a compile-time query, the cache must be regenerated and committed.
#
# This script:
#   1. Boots a throwaway Postgres 15 container on port 5439.
#   2. Applies every migration under `backend-rust/migrations/` in order
#      (`cargo sqlx migrate run`).
#   3. Runs `cargo sqlx prepare --workspace -- --tests` against it so the
#      cache covers both library and test queries.
#   4. Tears the container down on exit (even on failure).
#
# Usage:
#   cd backend-rust
#   ./scripts/regen-sqlx-cache.sh
#
# After it completes, review and `git add backend-rust/.sqlx/`. Then run
# `cargo sqlx prepare --check` to confirm the cache is in sync.
#
# Requirements: docker, cargo, sqlx-cli >= 0.8 (`cargo install sqlx-cli
# --no-default-features --features rustls,postgres`).
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Config — keep port high enough to avoid collisions with the dev/test stack
# (5432=local, 5434=prod, 5435=staging, 5436=e2e, 5437=integration, 5438=unit).
# -----------------------------------------------------------------------------
CONTAINER_NAME="${CONTAINER_NAME:-sqlx-prepare-pg}"
PORT="${PORT:-5439}"
DB_NAME="${DB_NAME:-loyalty_prepare}"
DB_USER="${DB_USER:-loyalty}"
DB_PASS="${DB_PASS:-loyalty_pass}"
PG_IMAGE="${PG_IMAGE:-postgres:15-alpine}"
READY_TIMEOUT_SEC="${READY_TIMEOUT_SEC:-30}"

# Resolve the backend-rust directory regardless of caller's CWD so the script
# can be invoked from anywhere in the repo.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# -----------------------------------------------------------------------------
# Pre-flight: required tools must be present. Fail loudly with a clear hint
# rather than producing cryptic errors deeper in the script.
# -----------------------------------------------------------------------------
require() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "error: '$1' is required but not on PATH." >&2
        echo "       $2" >&2
        exit 1
    fi
}

require docker  "Install Docker Desktop / OrbStack / Colima and start the daemon."
require cargo   "Install Rust via rustup: https://rustup.rs/"

if ! cargo sqlx --version >/dev/null 2>&1; then
    echo "error: sqlx-cli is not installed." >&2
    echo "       cargo install sqlx-cli --no-default-features --features rustls,postgres" >&2
    exit 1
fi

cd "$BACKEND_DIR"

# -----------------------------------------------------------------------------
# Cleanup on exit. Always remove the container so a previous run's leftovers
# don't block the next one and so we don't leak resources. `|| true` because
# the container may not exist yet if pre-flight failed.
# -----------------------------------------------------------------------------
cleanup() {
    echo "==> Cleaning up container $CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Remove any stale container before starting fresh — makes the script
# idempotent if a previous run was interrupted.
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# -----------------------------------------------------------------------------
# Boot Postgres
# -----------------------------------------------------------------------------
echo "==> Starting $PG_IMAGE as $CONTAINER_NAME on port $PORT"
docker run -d --rm \
    --name "$CONTAINER_NAME" \
    -p "$PORT":5432 \
    -e "POSTGRES_DB=$DB_NAME" \
    -e "POSTGRES_USER=$DB_USER" \
    -e "POSTGRES_PASSWORD=$DB_PASS" \
    "$PG_IMAGE" >/dev/null

echo "==> Waiting for Postgres to accept connections (timeout ${READY_TIMEOUT_SEC}s)"
deadline=$(( $(date +%s) + READY_TIMEOUT_SEC ))
until docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "error: Postgres did not become ready within ${READY_TIMEOUT_SEC}s" >&2
        docker logs "$CONTAINER_NAME" >&2 || true
        exit 1
    fi
    sleep 1
done

export DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:$PORT/$DB_NAME"
echo "==> DATABASE_URL=$DATABASE_URL"

# -----------------------------------------------------------------------------
# Apply migrations. We use sqlx's migrator (not raw psql) so that the same
# code path that runs in production is exercised here — catches issues like
# missing semicolons or out-of-order migrations.
# -----------------------------------------------------------------------------
echo "==> Applying migrations"
cargo sqlx migrate run

# -----------------------------------------------------------------------------
# Regenerate the cache. `--workspace` covers every crate (just the one today,
# but future-proof); `-- --tests` ensures test-only queries are cached too,
# matching what CI's `cargo sqlx prepare --check` will validate.
# -----------------------------------------------------------------------------
echo "==> Regenerating .sqlx/ offline cache"
cargo sqlx prepare --workspace -- --tests

echo ""
echo "==> Done. Review changes with: git status backend-rust/.sqlx/"
echo "==> Then verify with:          cargo sqlx prepare --check"
