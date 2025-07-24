-- Update reception_id format to 3-digit IDs starting with 269 (26900-26999)
-- This provides 100 unique IDs for reception communication

-- First, drop the existing function
DROP FUNCTION IF EXISTS generate_reception_id();

-- Update the column to support 3-digit format
ALTER TABLE user_profiles ALTER COLUMN reception_id TYPE VARCHAR(5);

-- Create new function to generate 3-digit reception IDs starting with 269
CREATE OR REPLACE FUNCTION generate_reception_id_269()
RETURNS VARCHAR(5) AS $$
DECLARE
    new_id VARCHAR(5);
    id_exists BOOLEAN;
    attempt_count INTEGER := 0;
    max_attempts INTEGER := 100;
    random_suffix INTEGER;
BEGIN
    LOOP
        -- Generate random 2-digit suffix (00-99) to append to 269
        random_suffix := FLOOR(RANDOM() * 100);
        new_id := '269' || LPAD(random_suffix::TEXT, 2, '0');
        
        -- Check if this ID already exists
        SELECT EXISTS(SELECT 1 FROM user_profiles WHERE reception_id = new_id) INTO id_exists;
        
        -- If ID doesn't exist, return it
        IF NOT id_exists THEN
            RETURN new_id;
        END IF;
        
        -- Increment attempt counter to prevent infinite loops
        attempt_count := attempt_count + 1;
        
        -- If we've tried all 100 possibilities, raise an exception
        IF attempt_count >= max_attempts THEN
            RAISE EXCEPTION 'All reception IDs in range 26900-26999 are exhausted. Maximum capacity reached.';
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Update existing reception IDs to new format (only if needed for existing users)
-- This will assign new 269XX IDs to existing users
UPDATE user_profiles 
SET reception_id = generate_reception_id_269() 
WHERE reception_id IS NOT NULL;

-- Add comment to document the new format
COMMENT ON COLUMN user_profiles.reception_id IS 'Unique 5-character numeric ID in format 269XX (26900-26999) for reception communication';