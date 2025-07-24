-- Fix Transaction Type Enum Issue
-- The add_stay_nights_and_points function uses 'stay_earning' but enum has 'earned_stay'

-- Update the add_stay_nights_and_points function to use correct enum value
CREATE OR REPLACE FUNCTION add_stay_nights_and_points(
    p_user_id UUID,
    p_nights INTEGER,
    p_amount_spent DECIMAL,
    p_reference_id TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS TABLE(
    transaction_id UUID,
    points_earned INTEGER,
    new_total_nights INTEGER,
    new_tier_name TEXT
) AS $$
DECLARE
    v_transaction_id UUID;
    v_points_earned INTEGER;
    v_new_total_nights INTEGER;
    v_new_tier_name TEXT;
    v_expires_at TIMESTAMP;
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Calculate points earned (10 points per THB)
    v_points_earned := FLOOR(p_amount_spent * 10);
    
    -- Set expiration to 2 years from now
    v_expires_at := NOW() + INTERVAL '2 years';
    
    -- Insert points transaction with correct enum value
    INSERT INTO points_transactions (
        id, user_id, points, type, description, reference_id, 
        nights_stayed, expires_at, created_at
    ) VALUES (
        v_transaction_id, p_user_id, v_points_earned, 'earned_stay', 
        COALESCE(p_description, 'Hotel stay with nights'), p_reference_id,
        p_nights, v_expires_at, NOW()
    );
    
    -- Update user loyalty totals
    UPDATE user_loyalty 
    SET 
        current_points = current_points + v_points_earned,
        lifetime_points = lifetime_points + v_points_earned,
        total_nights = total_nights + p_nights,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Get updated values
    SELECT 
        ul.total_nights,
        uti.tier_name
    INTO v_new_total_nights, v_new_tier_name
    FROM user_loyalty ul
    LEFT JOIN user_tier_info uti ON uti.user_id = ul.user_id
    WHERE ul.user_id = p_user_id;
    
    -- Return results
    RETURN QUERY SELECT 
        v_transaction_id,
        v_points_earned,
        v_new_total_nights,
        COALESCE(v_new_tier_name, 'New Member');
END;
$$ LANGUAGE plpgsql;