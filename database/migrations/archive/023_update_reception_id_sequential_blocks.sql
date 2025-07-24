-- Update reception_id format to 8-digit IDs: 269 + 5-digit sequential blocks
-- Block system: Users 1-100 get 26900001-26900100, Users 101-200 get 26900101-26900200, etc.

-- Update the column to support 8-digit format
ALTER TABLE user_profiles ALTER COLUMN reception_id TYPE VARCHAR(8);

-- Create a table to track user registration sequence for block-based ID generation
CREATE TABLE IF NOT EXISTS reception_id_sequence (
    id SERIAL PRIMARY KEY,
    current_user_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize the sequence counter if it doesn't exist
INSERT INTO reception_id_sequence (current_user_count) 
SELECT 0 
WHERE NOT EXISTS (SELECT 1 FROM reception_id_sequence);

-- Drop the old function
DROP FUNCTION IF EXISTS generate_reception_id_269();

-- Create new function to generate 8-digit reception IDs with sequential blocks
CREATE OR REPLACE FUNCTION generate_reception_id_sequential()
RETURNS VARCHAR(8) AS $$
DECLARE
    current_count INTEGER;
    new_count INTEGER;
    block_number INTEGER;
    random_within_block INTEGER;
    new_id VARCHAR(8);
    id_exists BOOLEAN;
    attempt_count INTEGER := 0;
    max_attempts INTEGER := 100;
BEGIN
    -- Get and increment the current user count atomically
    UPDATE reception_id_sequence 
    SET current_user_count = current_user_count + 1,
        updated_at = NOW()
    RETURNING current_user_count INTO new_count;
    
    -- Calculate which block (1-100, 101-200, 201-300, etc.) this user belongs to
    block_number := FLOOR((new_count - 1) / 100);
    
    -- Generate random number within the block range
    -- Block 0: 1-100, Block 1: 101-200, Block 2: 201-300, etc.
    LOOP
        random_within_block := (block_number * 100) + FLOOR(RANDOM() * 100) + 1;
        
        -- Format as 8-digit ID: 269 + 5-digit padded number
        new_id := '269' || LPAD(random_within_block::TEXT, 5, '0');
        
        -- Check if this ID already exists
        SELECT EXISTS(SELECT 1 FROM user_profiles WHERE reception_id = new_id) INTO id_exists;
        
        -- If ID doesn't exist, return it
        IF NOT id_exists THEN
            RETURN new_id;
        END IF;
        
        -- Increment attempt counter to prevent infinite loops
        attempt_count := attempt_count + 1;
        
        -- If we've tried too many times within this block, raise an exception
        IF attempt_count >= max_attempts THEN
            RAISE EXCEPTION 'Unable to generate unique reception ID in block % after % attempts. Block may be full.', block_number, max_attempts;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_reception_sequence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reception_id_sequence_updated_at
    BEFORE UPDATE ON reception_id_sequence
    FOR EACH ROW
    EXECUTE FUNCTION update_reception_sequence_updated_at();

-- Update existing reception IDs to new 8-digit format
-- Set the current count based on existing users
UPDATE reception_id_sequence 
SET current_user_count = (SELECT COUNT(*) FROM user_profiles WHERE reception_id IS NOT NULL);

-- Generate new 8-digit IDs for existing users
DO $$
DECLARE
    user_record RECORD;
    new_id VARCHAR(8);
BEGIN
    FOR user_record IN SELECT user_id FROM user_profiles WHERE reception_id IS NOT NULL ORDER BY created_at
    LOOP
        new_id := generate_reception_id_sequential();
        UPDATE user_profiles SET reception_id = new_id WHERE user_id = user_record.user_id;
    END LOOP;
END $$;

-- Add comment to document the new format
COMMENT ON COLUMN user_profiles.reception_id IS 'Unique 8-digit numeric ID in format 269XXXXX with sequential block-based generation for reception communication';
COMMENT ON TABLE reception_id_sequence IS 'Tracks user registration sequence for block-based reception ID generation';
COMMENT ON COLUMN reception_id_sequence.current_user_count IS 'Current count of users with reception IDs, used for block calculation';