#!/bin/bash
set -e

echo "Starting database initialization..."

# Run migrations in correct dependency order
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Core schema and extensions
    \echo 'Running 001_init_schema.sql...'
    \i /docker-entrypoint-initdb.d/001_init_schema.sql

    \echo 'Running 002_add_oauth_columns.sql...'
    \i /docker-entrypoint-initdb.d/002_add_oauth_columns.sql

    \echo 'Running 003_account_linking.sql...'
    \i /docker-entrypoint-initdb.d/003_account_linking.sql

    \echo 'Running 004_feature_toggles.sql...'
    \i /docker-entrypoint-initdb.d/004_feature_toggles.sql

    \echo 'Running 005_loyalty_system.sql...'
    \i /docker-entrypoint-initdb.d/005_loyalty_system.sql

    \echo 'Running 006_coupon_system.sql...'
    \i /docker-entrypoint-initdb.d/006_coupon_system.sql

    \echo 'Running 015_add_reception_id.sql...'
    \i /docker-entrypoint-initdb.d/015_add_reception_id.sql

    \echo 'Running 016_remove_points_expiration.sql...'
    \i /docker-entrypoint-initdb.d/016_remove_points_expiration.sql

    \echo 'Running 017_remove_lifetime_points_column_fixed.sql...'
    \i /docker-entrypoint-initdb.d/017_remove_lifetime_points_column_fixed.sql

    \echo 'Running 018_fix_award_points_function.sql...'
    \i /docker-entrypoint-initdb.d/018_fix_award_points_function.sql

    \echo 'Running 019_create_survey_system.sql...'
    \i /docker-entrypoint-initdb.d/019_create_survey_system.sql

    \echo 'Running 020_survey_coupon_rewards.sql...'
    \i /docker-entrypoint-initdb.d/020_survey_coupon_rewards.sql

    \echo 'Running 021_fix_transaction_type_enum.sql...'
    \i /docker-entrypoint-initdb.d/021_fix_transaction_type_enum.sql

    \echo 'Running 022_update_reception_id_format.sql...'
    \i /docker-entrypoint-initdb.d/022_update_reception_id_format.sql

    \echo 'Running 023_update_reception_id_sequential_blocks.sql...'
    \i /docker-entrypoint-initdb.d/023_update_reception_id_sequential_blocks.sql

    \echo 'Running 024_allow_null_email.sql...'
    \i /docker-entrypoint-initdb.d/024_allow_null_email.sql
EOSQL

echo "Database migrations completed successfully"

# Run seeds if they exist
if [ -f "/docker-entrypoint-initdb.d/../seeds/001_survey_data.sql" ]; then
    echo "Running seed data..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        \echo 'Running 001_survey_data.sql...'
        \i /docker-entrypoint-initdb.d/../seeds/001_survey_data.sql
EOSQL
    echo "Database seeding completed successfully"
else
    echo "No seed data files found, skipping seeding"
fi

echo "Database initialization completed successfully"