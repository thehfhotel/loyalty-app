-- Fix award_points function to match service expectations
-- The service is calling with 8 parameters including expires_at, but our function only expects 6

-- Drop existing function
DROP FUNCTION IF EXISTS award_points(UUID, INTEGER, points_transaction_type, TEXT, UUID, TEXT);

-- Create updated award_points function with expires_at parameter
CREATE OR REPLACE FUNCTION award_points(
    p_user_id UUID,
    p_points INTEGER,
    p_type points_transaction_type,
    p_description TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL,
    p_admin_user_id UUID DEFAULT NULL,
    p_admin_reason TEXT DEFAULT NULL,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE(
    transaction_id UUID,
    new_current_points INTEGER
) AS $$
DECLARE
    v_transaction_id UUID;
    v_current_points INTEGER;
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Insert transaction with NO expiration (ignore p_expires_at parameter since points never expire)
    INSERT INTO points_transactions (
        id, user_id, points, type, description, reference_id,
        admin_user_id, admin_reason, expires_at
    ) VALUES (
        v_transaction_id, p_user_id, p_points, p_type, p_description, p_reference_id,
        p_admin_user_id, p_admin_reason, NULL  -- Always NULL since points never expire
    );
    
    -- Update user totals (only current_points, no lifetime_points)
    UPDATE user_loyalty 
    SET 
        current_points = current_points + p_points,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING current_points 
    INTO v_current_points;
    
    RETURN QUERY SELECT v_transaction_id, v_current_points;
END;
$$ LANGUAGE plpgsql;

-- Migration completed: Fixed award_points function parameter mismatch