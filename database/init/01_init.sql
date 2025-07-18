-- Initialize the loyalty database
-- This script runs when the PostgreSQL container starts

-- Create the main database if it doesn't exist
-- (This is handled by POSTGRES_DB environment variable)

-- Create Kong database for API Gateway
CREATE DATABASE kong;

-- Connect to the loyalty database
\c loyalty_db;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Run schema files in order (files are mounted in docker-entrypoint-initdb.d)
-- The schemas are automatically executed by PostgreSQL in alphabetical order

-- Create a simple health check function
CREATE OR REPLACE FUNCTION health_check()
RETURNS TABLE(
    status TEXT,
    database_name TEXT,
    check_time TIMESTAMP WITH TIME ZONE,
    total_users BIGINT,
    total_bookings BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'healthy'::TEXT,
        current_database()::TEXT,
        NOW(),
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL),
        (SELECT COUNT(*) FROM bookings);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions to loyalty_user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO loyalty_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO loyalty_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO loyalty_user;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO loyalty_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO loyalty_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO loyalty_user;