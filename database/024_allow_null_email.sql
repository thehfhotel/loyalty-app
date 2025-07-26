-- Migration: Allow NULL email for OAuth users
-- When OAuth providers don't provide email, we should leave it NULL instead of generating placeholders

-- Allow email to be NULL in users table
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Update existing placeholder emails to NULL
UPDATE users 
SET email = NULL 
WHERE email LIKE '%@%.oauth' 
  AND oauth_provider IS NOT NULL;

-- Add a constraint to ensure either email exists or it's an OAuth user
ALTER TABLE users 
ADD CONSTRAINT check_email_or_oauth 
CHECK (
  (email IS NOT NULL AND email != '') 
  OR 
  (email IS NULL AND oauth_provider IS NOT NULL)
);

-- Update the unique constraint to handle NULL emails properly
-- Drop the existing unique constraint
ALTER TABLE users DROP CONSTRAINT users_email_key;

-- Create a new partial unique index that only applies to non-NULL emails
CREATE UNIQUE INDEX idx_users_email_unique ON users(email) WHERE email IS NOT NULL;