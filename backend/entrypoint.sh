#!/bin/sh
# Entrypoint script for loyalty-app backend
# Handles automatic database migrations before starting the application

set -e

echo "🚀 Starting backend initialization..."

# =============================================================================
# Production Safety Checks
# Prevents accidental deployment with development configurations
# =============================================================================
validate_production_config() {
  if [ "$NODE_ENV" = "production" ]; then
    echo "🔒 Running production safety checks..."

    COMMAND="$*"
    HAS_ERROR=0

    # Check 1: Reject dev commands in production
    case "$COMMAND" in
      *"npm run dev"*|*"npx tsx"*|*"nodemon"*|*"ts-node"*)
        echo "❌ FATAL: Development command detected in production!"
        echo "   Command: $COMMAND"
        echo "   Production must use: node dist/index.js"
        HAS_ERROR=1
        ;;
    esac

    # Check 2: Verify compiled dist exists for production
    if [ ! -f "dist/index.js" ]; then
      echo "❌ FATAL: Production build not found!"
      echo "   Expected: dist/index.js"
      echo "   The Docker image may have been built with wrong target."
      HAS_ERROR=1
    fi

    # Check 3: Verify we're not running from src/ in production
    if echo "$COMMAND" | grep -q "src/index.ts"; then
      echo "❌ FATAL: Attempting to run TypeScript source in production!"
      echo "   Production must run compiled JavaScript from dist/"
      HAS_ERROR=1
    fi

    # Check 4: Warn if tsx is available (shouldn't be in runner stage)
    if command -v tsx >/dev/null 2>&1 || [ -d "node_modules/tsx" ]; then
      echo "⚠️  WARNING: tsx found in production (dev dependency leak)"
    fi

    if [ $HAS_ERROR -eq 1 ]; then
      echo ""
      echo "🛑 Production deployment aborted due to configuration errors."
      echo "   Please check docker-compose.prod.yml and Dockerfile."
      exit 1
    fi

    echo "✅ Production safety checks passed"
  fi
}

# Function to wait for database to be ready
wait_for_database() {
  echo "⏳ Waiting for PostgreSQL to be ready..."

  # Extract database connection details from DATABASE_URL
  # Format: postgresql://user:pass@host:port/database
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')

  MAX_RETRIES=30
  RETRY_COUNT=0

  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
      echo "✅ PostgreSQL is ready!"
      return 0
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Attempt $RETRY_COUNT/$MAX_RETRIES - PostgreSQL not ready yet, waiting..."
    sleep 2
  done

  echo "❌ ERROR: PostgreSQL failed to become ready after $MAX_RETRIES attempts"
  exit 1
}

# Function to verify migration files exist and are readable
# This prevents "Could not find migration file" errors
verify_migration_files() {
  echo "🔍 Verifying migration files..."

  # Check migrations directory exists
  if [ ! -d "prisma/migrations" ]; then
    echo "❌ ERROR: prisma/migrations directory not found"
    ls -la prisma/ 2>/dev/null || echo "prisma/ directory does not exist"
    return 1
  fi

  # Count migration directories (exclude migration_lock.toml)
  MIGRATION_COUNT=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  echo "📁 Found $MIGRATION_COUNT migration directories"

  if [ "$MIGRATION_COUNT" -eq 0 ]; then
    echo "⚠️ No migrations found (fresh database)"
    return 0
  fi

  # Verify each migration has a migration.sql file
  MISSING_FILES=0
  for dir in prisma/migrations/*/; do
    if [ -d "$dir" ]; then
      DIR_NAME=$(basename "$dir")
      # Skip non-migration entries
      if [ "$DIR_NAME" = "migration_lock.toml" ]; then
        continue
      fi

      MIGRATION_FILE="${dir}migration.sql"
      if [ ! -f "$MIGRATION_FILE" ]; then
        echo "❌ Missing: $MIGRATION_FILE"
        MISSING_FILES=$((MISSING_FILES + 1))
      elif [ ! -r "$MIGRATION_FILE" ]; then
        echo "❌ Not readable: $MIGRATION_FILE"
        ls -la "$MIGRATION_FILE" 2>/dev/null || true
        MISSING_FILES=$((MISSING_FILES + 1))
      else
        # Verify file has content
        if [ ! -s "$MIGRATION_FILE" ]; then
          echo "❌ Empty file: $MIGRATION_FILE"
          MISSING_FILES=$((MISSING_FILES + 1))
        fi
      fi
    fi
  done

  if [ "$MISSING_FILES" -gt 0 ]; then
    echo "❌ ERROR: $MISSING_FILES migration files missing, unreadable, or empty"
    echo "📁 Migration directory contents:"
    ls -laR prisma/migrations/ 2>/dev/null || true
    return 1
  fi

  echo "✅ All $MIGRATION_COUNT migration files verified"
  return 0
}

# Function to run database migrations with retry logic
run_migrations() {
  echo "🔄 Running database migrations..."

  # CRITICAL: Verify migration files before attempting migration
  # This prevents "Could not find migration file" errors
  if ! verify_migration_files; then
    echo "❌ Migration file verification failed - aborting migration"
    exit 1
  fi

  # Use prisma migrate deploy for production-safe migrations
  # This command:
  # - Applies pending migrations without prompting
  # - Is idempotent (safe to run multiple times)
  # - Does not create new migrations or modify migration files

  MAX_ATTEMPTS=3
  ATTEMPT=1

  while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo "📦 Migration attempt $ATTEMPT/$MAX_ATTEMPTS..."

    if npx prisma migrate deploy 2>&1; then
      echo "✅ Database migrations completed successfully"

      # Verify migration status
      echo "🔍 Verifying migration status..."
      npx prisma migrate status || true
      return 0
    fi

    echo "⚠️ Migration attempt $ATTEMPT failed"

    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
      echo "⏳ Waiting 3 seconds before retry..."
      sleep 3
    fi

    ATTEMPT=$((ATTEMPT + 1))
  done

  echo "❌ ERROR: All migration attempts failed"
  echo "📋 Final migration status:"
  npx prisma migrate status || true
  exit 1
}

# Function to verify Prisma client is generated and functional
verify_prisma_client() {
  echo "🔍 Verifying Prisma client..."

  NEEDS_GENERATION=0

  # Check if generated client directory exists
  if [ ! -d "src/generated/prisma" ]; then
    echo "⚠️ Prisma client directory not found"
    NEEDS_GENERATION=1
  else
    # Verify client has actual content (not empty directory)
    CLIENT_FILES=$(find src/generated/prisma -type f -name "*.js" 2>/dev/null | wc -l)
    if [ "$CLIENT_FILES" -eq 0 ]; then
      echo "⚠️ Prisma client directory empty (no .js files)"
      NEEDS_GENERATION=1
    else
      echo "✅ Found $CLIENT_FILES Prisma client files"
    fi
  fi

  # Generate if needed
  if [ "$NEEDS_GENERATION" -eq 1 ]; then
    echo "⚠️ Generating Prisma client..."
    if npm run db:generate; then
      echo "✅ Prisma client generated successfully"
    else
      echo "❌ ERROR: Prisma client generation failed"
      exit 1
    fi
  fi

  echo "✅ Prisma client verified at src/generated/prisma"
  return 0
}

# Main initialization sequence
main() {
  echo "=================================================="
  echo "  Loyalty App Backend - Entrypoint"
  echo "  Environment: ${NODE_ENV:-development}"
  echo "=================================================="

  # Step 0: Production safety checks (before anything else)
  validate_production_config "$@"

  # Step 1: Wait for database
  wait_for_database

  # Step 2: Verify Prisma client
  verify_prisma_client

  # Step 3: Run migrations
  run_migrations

  echo "=================================================="
  echo "✅ Initialization complete!"
  echo "🚀 Starting application: $*"
  echo "=================================================="

  # Execute the main application command (passed as arguments)
  exec "$@"
}

# Run main initialization
main "$@"
