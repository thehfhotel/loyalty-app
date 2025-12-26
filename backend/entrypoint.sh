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

# Function to run database migrations with retry logic
run_migrations() {
  echo "🔄 Running database migrations..."

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

# Function to verify Prisma client is generated
verify_prisma_client() {
  echo "🔍 Verifying Prisma client..."

  if [ -d "src/generated/prisma" ]; then
    echo "✅ Prisma client verified at src/generated/prisma"
    return 0
  else
    echo "⚠️  Prisma client not found, generating..."
    if npm run db:generate; then
      echo "✅ Prisma client generated successfully"
      return 0
    else
      echo "❌ ERROR: Prisma client generation failed"
      exit 1
    fi
  fi
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
