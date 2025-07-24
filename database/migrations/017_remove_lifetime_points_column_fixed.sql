-- Complete Removal of Lifetime Points System
-- Remove lifetime_points column and update all related functions and views

-- 1. Drop existing function that has conflicting return type
DROP FUNCTION IF EXISTS award_points(UUID, INTEGER, points_transaction_type, TEXT, UUID, TEXT, TIMESTAMP WITH TIME ZONE);

-- 2. Drop views that depend on lifetime_points column
DROP VIEW IF EXISTS user_tier_info;
DROP VIEW IF EXISTS user_points_calculation;

-- 3. Update the add_stay_nights_and_points function to remove lifetime_points
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
    
    -- Update user loyalty totals (remove lifetime_points reference)
    UPDATE user_loyalty 
    SET 
        current_points = current_points + v_points_earned,
        total_nights = total_nights + p_nights,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Get updated values from recreated view
    SELECT 
        ul.total_nights,
        COALESCE(t.name, 'New Member') as tier_name
    INTO v_new_total_nights, v_new_tier_name
    FROM user_loyalty ul
    LEFT JOIN tiers t ON ul.total_nights >= t.min_points AND t.is_active = true
    WHERE ul.user_id = p_user_id
    ORDER BY t.sort_order DESC
    LIMIT 1;
    
    -- Return results
    RETURN QUERY SELECT 
        v_transaction_id,
        v_points_earned,
        v_new_total_nights,
        COALESCE(v_new_tier_name, 'New Member');
END;
$$ LANGUAGE plpgsql;

-- 4. Create new award_points function without lifetime_points
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
    new_current_points INTEGER
) AS $$
DECLARE
    v_transaction_id UUID;
    v_current_points INTEGER;
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

-- 5. Drop the lifetime_points column from user_loyalty table
ALTER TABLE user_loyalty DROP COLUMN IF EXISTS lifetime_points;

-- 6. Recreate user_points_calculation view without lifetime_points
CREATE VIEW user_points_calculation AS
SELECT 
    ul.user_id,
    ul.current_points,
    0 as expiring_points, -- Always 0 since points never expire
    NULL::timestamp as next_expiry_date -- Always NULL since points never expire
FROM user_loyalty ul;

-- 7. Recreate user_tier_info view without lifetime_points
CREATE VIEW user_tier_info AS
SELECT 
    ul.user_id,
    ul.current_points,
    ul.total_nights,
    t.id as tier_id,
    t.name as tier_name,
    t.color as tier_color,
    t.benefits as tier_benefits,
    t.sort_order as tier_level,
    -- Progress calculation
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN
            ROUND((ul.total_nights::DECIMAL / next_tier.min_points::DECIMAL) * 100, 2)
        ELSE 100.0
    END as progress_percentage,
    -- Next tier information (based on nights)
    next_tier.min_points as next_tier_nights,
    next_tier.name as next_tier_name,
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN 
            GREATEST(0, next_tier.min_points - ul.total_nights)
        ELSE NULL
    END as nights_to_next_tier,
    -- Legacy points fields (now based on nights for compatibility)
    next_tier.min_points as next_tier_points,
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN 
            GREATEST(0, next_tier.min_points - ul.total_nights)
        ELSE NULL
    END as points_to_next_tier
FROM user_loyalty ul
LEFT JOIN tiers t ON ul.total_nights >= t.min_points AND t.is_active = true
LEFT JOIN tiers next_tier ON next_tier.sort_order = (
    SELECT MIN(t2.sort_order) 
    FROM tiers t2 
    WHERE t2.sort_order > COALESCE(t.sort_order, -1) AND t2.is_active = true
)
WHERE t.id IS NULL OR t.sort_order = (
    SELECT MAX(t3.sort_order)
    FROM tiers t3
    WHERE ul.total_nights >= t3.min_points AND t3.is_active = true
);

-- Migration completed: Complete removal of lifetime points system