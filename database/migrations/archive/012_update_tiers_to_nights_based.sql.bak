-- Migration to update loyalty tiers from points-based to nights-based system
-- New tier structure:
-- Tier 1: New Member (0 nights)
-- Tier 2: Silver (1+ nights)  
-- Tier 3: Gold (10+ nights)

-- First, add nights tracking to user_loyalty table
ALTER TABLE user_loyalty ADD COLUMN IF NOT EXISTS total_nights INTEGER DEFAULT 0;

-- Add nights to points_transactions for tracking stays
ALTER TABLE points_transactions ADD COLUMN IF NOT EXISTS nights_stayed INTEGER DEFAULT 0;

-- Update the tiers table structure to use nights instead of points
-- We'll keep min_points column but repurpose it for min_nights
UPDATE tiers SET is_active = false WHERE is_active = true;

-- Insert new night-based tiers
INSERT INTO tiers (name, min_points, color, sort_order, benefits, is_active) VALUES
('New Member', 0, '#808080', 1, '{
    "description": "Welcome to our loyalty program",
    "perks": [
        "Member exclusive rates",
        "Free WiFi",
        "Welcome amenity"
    ]
}', true),
('Silver', 1, '#C0C0C0', 2, '{
    "description": "Thank you for staying with us",
    "perks": [
        "All New Member benefits",
        "Room upgrade (subject to availability)",
        "Late checkout until 2 PM",
        "10% discount on dining",
        "Priority check-in"
    ]
}', true),
('Gold', 10, '#FFD700', 3, '{
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
}', true);

-- Drop the old view
DROP VIEW IF EXISTS user_tier_info;

-- Create new view that uses nights instead of points for tier calculation
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
            ROUND(
                (ul.total_nights - t.min_points)::DECIMAL / 
                (next_tier.min_points - t.min_points) * 100, 
                2
            )
        ELSE 100.0
    END as progress_percentage,
    next_tier.min_points as next_tier_nights,
    next_tier.name as next_tier_name,
    (next_tier.min_points - ul.total_nights) as nights_to_next_tier,
    -- Keep points fields for backward compatibility
    ul.current_points as current_points,
    ul.lifetime_points as lifetime_points,
    0 as next_tier_points,
    0 as points_to_next_tier
FROM user_loyalty ul
LEFT JOIN tiers t ON t.is_active = true 
    AND t.min_points <= ul.total_nights 
    AND NOT EXISTS (
        SELECT 1 FROM tiers t2 
        WHERE t2.is_active = true 
        AND t2.min_points <= ul.total_nights 
        AND t2.min_points > t.min_points
    )
LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true;

-- Update the tier update function to use nights
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
    ORDER BY min_points DESC
    LIMIT 1;
    
    -- Update tier if it has changed
    IF new_tier_id IS DISTINCT FROM NEW.tier_id THEN
        NEW.tier_id := new_tier_id;
        NEW.tier_updated_at := NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic tier updates based on nights
DROP TRIGGER IF EXISTS update_user_tier_on_nights_change ON user_loyalty;
CREATE TRIGGER update_user_tier_on_nights_change
    BEFORE UPDATE OF total_nights ON user_loyalty
    FOR EACH ROW
    EXECUTE FUNCTION update_user_tier_by_nights();

-- Function to add nights and points for a stay
CREATE OR REPLACE FUNCTION add_stay_nights_and_points(
    p_user_id UUID,
    p_nights INTEGER,
    p_amount_spent DECIMAL,
    p_reference_id VARCHAR(100) DEFAULT NULL,
    p_description TEXT DEFAULT NULL
) RETURNS TABLE(
    transaction_id UUID,
    points_earned INTEGER,
    new_total_nights INTEGER,
    new_tier_name VARCHAR(50)
) AS $$
DECLARE
    v_points_earned INTEGER;
    v_transaction_id UUID;
    v_new_total_nights INTEGER;
    v_new_tier_name VARCHAR(50);
BEGIN
    -- Calculate points (10 points per THB as per requirements)
    v_points_earned := FLOOR(p_amount_spent * 10);
    
    -- Insert points transaction with nights
    INSERT INTO points_transactions (
        user_id, 
        points, 
        type, 
        description, 
        reference_id,
        nights_stayed
    ) VALUES (
        p_user_id,
        v_points_earned,
        'earned_stay',
        COALESCE(p_description, 'Points earned from stay'),
        p_reference_id,
        p_nights
    ) RETURNING id INTO v_transaction_id;
    
    -- Update user loyalty with new points and nights
    UPDATE user_loyalty
    SET 
        current_points = current_points + v_points_earned,
        lifetime_points = lifetime_points + v_points_earned,
        total_nights = total_nights + p_nights,
        points_updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING total_nights INTO v_new_total_nights;
    
    -- Get the new tier name
    SELECT t.name INTO v_new_tier_name
    FROM user_loyalty ul
    JOIN tiers t ON ul.tier_id = t.id
    WHERE ul.user_id = p_user_id;
    
    RETURN QUERY SELECT 
        v_transaction_id,
        v_points_earned,
        v_new_total_nights,
        v_new_tier_name;
END;
$$ LANGUAGE plpgsql;

-- Update all existing users to have their tier calculated based on nights
-- For existing users, we'll estimate nights based on their lifetime points
-- Assuming average spend of 1000 THB per night (10,000 points per night)
UPDATE user_loyalty
SET total_nights = GREATEST(0, FLOOR(lifetime_points / 10000));

-- Trigger the tier recalculation for all users
UPDATE user_loyalty
SET tier_id = (
    SELECT id 
    FROM tiers 
    WHERE is_active = true 
    AND min_points <= total_nights
    ORDER BY min_points DESC
    LIMIT 1
);