-- Remove Points Expiration System
-- Make all points never expire by updating existing functions and data

-- 1. Update existing points to never expire
UPDATE points_transactions 
SET expires_at = NULL 
WHERE expires_at IS NOT NULL;

-- 2. Update the add_stay_nights_and_points function to not set expiration
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
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Calculate points earned (10 points per THB)
    v_points_earned := FLOOR(p_amount_spent * 10);
    
    -- Insert points transaction with NO expiration (expires_at = NULL)
    INSERT INTO points_transactions (
        id, user_id, points, type, description, reference_id, 
        nights_stayed, expires_at, created_at
    ) VALUES (
        v_transaction_id, p_user_id, v_points_earned, 'earned_stay', 
        COALESCE(p_description, 'Hotel stay with nights'), p_reference_id,
        p_nights, NULL, NOW()
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

-- 3. Update the award_points function to not set expiration
CREATE OR REPLACE FUNCTION award_points(
    p_user_id UUID,
    p_points INTEGER,
    p_type points_transaction_type,
    p_description TEXT DEFAULT NULL,
    p_admin_user_id UUID DEFAULT NULL,
    p_admin_reason TEXT DEFAULT NULL,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE(
    transaction_id UUID,
    new_current_points INTEGER,
    new_lifetime_points INTEGER
) AS $$
DECLARE
    v_transaction_id UUID;
    v_current_points INTEGER;
    v_lifetime_points INTEGER;
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Insert transaction with NO expiration (ignore p_expires_at parameter)
    INSERT INTO points_transactions (
        id, user_id, points, type, description, 
        admin_user_id, admin_reason, expires_at
    ) VALUES (
        v_transaction_id, p_user_id, p_points, p_type, p_description,
        p_admin_user_id, p_admin_reason, NULL
    );
    
    -- Update user totals
    UPDATE user_loyalty 
    SET 
        current_points = current_points + p_points,
        lifetime_points = CASE 
            WHEN p_points > 0 THEN lifetime_points + p_points 
            ELSE lifetime_points 
        END,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING current_points, lifetime_points 
    INTO v_current_points, v_lifetime_points;
    
    RETURN QUERY SELECT v_transaction_id, v_current_points, v_lifetime_points;
END;
$$ LANGUAGE plpgsql;

-- 4. Update the points calculation view to reflect no expiring points
CREATE OR REPLACE VIEW user_points_calculation AS
SELECT 
    ul.user_id,
    ul.current_points,
    ul.lifetime_points,
    0 as expiring_points, -- Always 0 since points never expire
    NULL::timestamp as next_expiry_date -- Always NULL since points never expire
FROM user_loyalty ul;

-- 5. Update the valid_points view to ignore expiration
CREATE OR REPLACE VIEW valid_points AS
SELECT 
    pt.id,
    pt.user_id,
    pt.points,
    pt.type,
    pt.description,
    pt.reference_id,
    pt.nights_stayed,
    pt.admin_user_id,
    pt.admin_reason,
    pt.expires_at, -- Keep the column for reference but it will always be NULL
    pt.created_at
FROM points_transactions pt
WHERE pt.points != 0; -- No expiration check since points never expire

-- Migration completed: Remove points expiration system - all points are now permanent