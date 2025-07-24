-- Add reception_id column to user_profiles table
-- This 8-digit numeric ID will be used for reception communication

ALTER TABLE user_profiles
ADD COLUMN reception_id VARCHAR(8);

-- Create unique index for reception_id
CREATE UNIQUE INDEX idx_user_profiles_reception_id ON user_profiles(reception_id);

-- Create a function to generate unique 8-digit reception IDs
CREATE OR REPLACE FUNCTION generate_reception_id()
RETURNS VARCHAR(8) AS $$
DECLARE
    new_id VARCHAR(8);
    id_exists BOOLEAN;
    attempt_count INTEGER := 0;
    max_attempts INTEGER := 100;
BEGIN
    LOOP
        -- Generate random 8-digit number (10000000 to 99999999)
        new_id := LPAD((FLOOR(RANDOM() * 90000000) + 10000000)::TEXT, 8, '0');
        
        -- Check if this ID already exists
        SELECT EXISTS(SELECT 1 FROM user_profiles WHERE reception_id = new_id) INTO id_exists;
        
        -- If ID doesn't exist, return it
        IF NOT id_exists THEN
            RETURN new_id;
        END IF;
        
        -- Increment attempt counter to prevent infinite loops
        attempt_count := attempt_count + 1;
        
        -- If we've tried too many times, raise an exception
        IF attempt_count >= max_attempts THEN
            RAISE EXCEPTION 'Unable to generate unique reception ID after % attempts', max_attempts;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Generate reception IDs for existing users who don't have one
UPDATE user_profiles 
SET reception_id = generate_reception_id() 
WHERE reception_id IS NULL;

-- Make reception_id NOT NULL after populating existing records
ALTER TABLE user_profiles ALTER COLUMN reception_id SET NOT NULL;

-- Add comment to document the purpose
COMMENT ON COLUMN user_profiles.reception_id IS 'Unique 8-digit numeric ID for reception communication';