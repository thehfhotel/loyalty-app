-- Fixed Tier System Reset Migration
-- This migration corrects the issues from the previous migration

-- Step 1: Ensure points_transactions has nights_stayed column
ALTER TABLE points_transactions ADD COLUMN IF NOT EXISTS nights_stayed INTEGER DEFAULT 0;

-- Step 2: Disable all existing tiers
UPDATE tiers SET is_active = false WHERE is_active = true;

-- Step 3: Delete all existing tier data to start fresh
DELETE FROM tiers WHERE is_active = false;

-- Step 4: Insert correct night-based tiers with proper values
INSERT INTO tiers (id, name, min_points, color, sort_order, benefits, is_active, created_at, updated_at) VALUES
(
    gen_random_uuid(),
    'New Member', 
    0, 
    '#808080', 
    1, 
    '{
        "description": "Welcome to our loyalty program",
        "perks": [
            "Member exclusive rates",
            "Free WiFi",
            "Welcome amenity"
        ]
    }', 
    true,
    NOW(),
    NOW()
),
(
    gen_random_uuid(),
    'Silver', 
    1, 
    '#C0C0C0', 
    2, 
    '{
        "description": "Thank you for staying with us",
        "perks": [
            "All New Member benefits",
            "Room upgrade (subject to availability)",
            "Late checkout until 2 PM",
            "10% discount on dining",
            "Priority check-in"
        ]
    }', 
    true,
    NOW(),
    NOW()
),
(
    gen_random_uuid(),
    'Gold', 
    10, 
    '#FFD700', 
    3, 
    '{
        "description": "Our valued frequent guest",
        "perks": [
            "All Silver benefits",
            "Guaranteed room upgrade",
            "Late checkout until 4 PM",
            "20% discount on dining",
            "Complimentary breakfast",
            "Executive lounge access",
            "Free laundry service (3 pieces per stay)"
        ]
    }', 
    true,
    NOW(),
    NOW()
);

-- Step 5: Ensure user_loyalty table has total_nights column
ALTER TABLE user_loyalty ADD COLUMN IF NOT EXISTS total_nights INTEGER DEFAULT 0;

-- Step 6: Reset all user total_nights to 0 initially
UPDATE user_loyalty SET total_nights = 0;

-- Step 7: Recalculate total_nights from points_transactions where nights_stayed exists
UPDATE user_loyalty 
SET total_nights = COALESCE((
    SELECT SUM(COALESCE(nights_stayed, 0)) 
    FROM points_transactions 
    WHERE user_id = user_loyalty.user_id 
    AND COALESCE(nights_stayed, 0) > 0
), 0);

-- Step 8: Drop and recreate the user_tier_info view with correct logic
DROP VIEW IF EXISTS user_tier_info;

CREATE VIEW user_tier_info AS
SELECT 
    ul.user_id,
    ul.current_points,
    ul.lifetime_points,
    ul.total_nights,
    t.name as tier_name,
    t.color as tier_color,
    t.benefits as tier_benefits,
    t.sort_order as tier_level,
    
    -- Calculate progress to next tier based on nights
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN
            CASE 
                WHEN (next_tier.min_points - t.min_points) = 0 THEN 100.0
                ELSE ROUND(
                    GREATEST(0, LEAST(100, 
                        (ul.total_nights - t.min_points)::DECIMAL / 
                        (next_tier.min_points - t.min_points) * 100
                    )), 2
                )
            END
        ELSE 100.0
    END as progress_percentage,
    
    -- Next tier information (using min_points for nights)
    next_tier.min_points as next_tier_nights,
    next_tier.name as next_tier_name,
    
    -- Calculate nights to next tier
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN
            GREATEST(0, next_tier.min_points - ul.total_nights)
        ELSE NULL
    END as nights_to_next_tier,
    
    -- Backward compatibility fields for points (set to NULL since we use nights)
    NULL::INTEGER as next_tier_points,
    NULL::INTEGER as points_to_next_tier

FROM user_loyalty ul
LEFT JOIN tiers t ON (
    t.is_active = true 
    AND t.min_points <= ul.total_nights 
    AND t.sort_order = (
        SELECT MAX(t2.sort_order) 
        FROM tiers t2 
        WHERE t2.is_active = true 
        AND t2.min_points <= ul.total_nights
    )
)
LEFT JOIN tiers next_tier ON (
    next_tier.is_active = true 
    AND next_tier.sort_order = t.sort_order + 1
);

-- Step 9: Update tier assignment function
CREATE OR REPLACE FUNCTION update_user_tier_by_nights()
RETURNS TRIGGER AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    -- Find the appropriate tier based on total nights
    SELECT id INTO new_tier_id
    FROM tiers 
    WHERE is_active = true 
    AND min_points <= NEW.total_nights
    ORDER BY min_points DESC, sort_order DESC
    LIMIT 1;
    
    -- Update the user's tier if found
    IF new_tier_id IS NOT NULL THEN
        NEW.tier_id := new_tier_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 10: Ensure trigger exists
DROP TRIGGER IF EXISTS update_tier_on_nights_change ON user_loyalty;
CREATE TRIGGER update_tier_on_nights_change
    BEFORE UPDATE OF total_nights ON user_loyalty
    FOR EACH ROW
    EXECUTE FUNCTION update_user_tier_by_nights();

-- Step 11: Recalculate all user tiers based on current nights
UPDATE user_loyalty 
SET total_nights = total_nights; -- This triggers the tier update

-- Step 12: Update existing function for adding nights and points together
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
    
    -- Insert points transaction
    INSERT INTO points_transactions (
        id, user_id, points, type, description, reference_id, 
        nights_stayed, expires_at, created_at
    ) VALUES (
        v_transaction_id, p_user_id, v_points_earned, 'stay_earning', 
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

-- Step 13: Verify the fix by checking tier counts
DO $$
DECLARE
    tier_count INTEGER;
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO tier_count FROM tiers WHERE is_active = true;
    SELECT COUNT(*) INTO user_count FROM user_tier_info;
    RAISE NOTICE 'Tier system reset completed. Active tiers: %, Users with tier info: %', tier_count, user_count;
END $$;