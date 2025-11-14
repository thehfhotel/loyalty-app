#!/bin/sh
# Entrypoint script for loyalty-app backend
# Handles automatic database migrations before starting the application

set -e

echo "🚀 Starting backend initialization..."

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

# Function to run database migrations
run_migrations() {
  echo "🔄 Running database migrations..."

  # Use prisma migrate deploy for production-safe migrations
  # This command:
  # - Applies pending migrations without prompting
  # - Is idempotent (safe to run multiple times)
  # - Does not create new migrations or modify migration files
  if npx prisma migrate deploy; then
    echo "✅ Database migrations completed successfully"
    return 0
  else
    echo "❌ ERROR: Database migration failed"
    exit 1
  fi
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
