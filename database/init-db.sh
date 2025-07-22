#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Run migrations
    \i /docker-entrypoint-initdb.d/001_init_schema.sql
    \i /docker-entrypoint-initdb.d/002_add_oauth_columns.sql
    \i /docker-entrypoint-initdb.d/003_account_linking.sql
    \i /docker-entrypoint-initdb.d/004_feature_toggles.sql
    \i /docker-entrypoint-initdb.d/005_loyalty_system.sql
    \i /docker-entrypoint-initdb.d/006_coupon_system.sql
    \i /docker-entrypoint-initdb.d/010_add_survey_access_type.sql
    \i /docker-entrypoint-initdb.d/011_remove_user_coupon_unique_constraint.sql
    \i /docker-entrypoint-initdb.d/012_create_survey_system.sql
EOSQL

echo "Database migrations completed"

# Run seeds if they exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Run seed data
    \i /docker-entrypoint-initdb.d/../seeds/001_survey_data.sql
EOSQL

echo "Database seeding completed"