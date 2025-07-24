#!/bin/bash

# =============================================================================
# DOCKER CONSOLIDATED DATABASE INITIALIZATION SCRIPT
# =============================================================================
# This script runs inside the PostgreSQL Docker container to initialize
# the database using the consolidated schema.
# =============================================================================

set -e

echo "=========================================="
echo "Loyalty App - Consolidated Schema Init"
echo "=========================================="

echo "Database: $POSTGRES_DB"
echo "User: $POSTGRES_USER"

# Apply consolidated schema
echo "[INFO] Applying consolidated schema..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/consolidated_schema.sql

# Check if seed data exists and apply it
if [ -f "/docker-entrypoint-initdb.d/seeds/001_survey_data.sql" ]; then
    echo "[INFO] Loading seed data..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/seeds/001_survey_data.sql
    echo "[SUCCESS] Seed data loaded successfully"
else
    echo "[INFO] No seed data found, skipping"
fi

# Verify initialization
TABLE_COUNT=$(psql -t --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | xargs)

echo "[SUCCESS] Database initialization completed!"
echo "Tables created: $TABLE_COUNT"
echo "Schema: Consolidated (replaces 23 migrations)"
echo "Features: Users, OAuth, Account Linking, Feature Toggles, Loyalty, Coupons, Surveys"
echo "Reception ID: 8-digit sequential block format (269XXXXX)"
echo "Points System: No expiration, no lifetime tracking"
echo "=========================================="