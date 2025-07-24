#!/bin/bash
set -e

echo "Starting consolidated database initialization..."

# Run the consolidated schema
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    \echo 'Executing consolidated schema...'
    \i /docker-entrypoint-initdb.d/consolidated_schema.sql
EOSQL

echo "Consolidated schema applied successfully"

# Run seeds if they exist
if [ -f "/docker-entrypoint-initdb.d/../seeds/001_survey_data.sql" ]; then
    echo "Running seed data..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        \echo 'Running survey seed data...'
        \i /docker-entrypoint-initdb.d/../seeds/001_survey_data.sql
EOSQL
    echo "Database seeding completed successfully"
else
    echo "No seed data files found, skipping seeding"
fi

echo "Consolidated database initialization completed successfully"