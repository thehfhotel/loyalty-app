-- Add OAuth provider columns to users table for social login support
ALTER TABLE users 
ADD COLUMN oauth_provider VARCHAR(50),
ADD COLUMN oauth_provider_id VARCHAR(255);

-- Create index for OAuth provider lookups
CREATE INDEX idx_users_oauth_provider_id ON users(oauth_provider, oauth_provider_id);

-- Allow empty password for OAuth users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;