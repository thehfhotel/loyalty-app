-- Phase 2: Loyalty Points & Tier System Database Schema

-- Loyalty tiers table
CREATE TABLE tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    min_points INTEGER NOT NULL,
    benefits JSONB DEFAULT '{}',
    color VARCHAR(7) NOT NULL, -- Hex color code
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Points transaction types enum
CREATE TYPE points_transaction_type AS ENUM (
    'earned_stay', 
    'earned_bonus', 
    'redeemed', 
    'expired', 
    'admin_adjustment',
    'admin_award',
    'admin_deduction'
);

-- Points transactions table
CREATE TABLE points_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL, -- Can be negative for deductions
    type points_transaction_type NOT NULL,
    description TEXT,
    reference_id VARCHAR(100), -- External reference (e.g., booking ID)
    admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Who made admin changes
    admin_reason TEXT, -- Reason for admin adjustments
    expires_at TIMESTAMP WITH TIME ZONE, -- For earned points expiration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User loyalty status table
CREATE TABLE user_loyalty (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_points INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    tier_id UUID REFERENCES tiers(id) ON DELETE SET NULL,
    tier_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    points_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Points earning rules configuration
CREATE TABLE points_earning_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    points_per_unit DECIMAL(10,2) NOT NULL, -- Points earned per unit (e.g., per dollar spent)
    unit_type VARCHAR(50) DEFAULT 'currency', -- currency, nights, etc.
    multiplier_by_tier JSONB DEFAULT '{}', -- Tier-specific multipliers
    is_active BOOLEAN DEFAULT true,
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_tiers_sort_order ON tiers(sort_order);
CREATE INDEX idx_tiers_min_points ON tiers(min_points);
CREATE INDEX idx_points_transactions_user_id ON points_transactions(user_id);
CREATE INDEX idx_points_transactions_type ON points_transactions(type);
CREATE INDEX idx_points_transactions_created_at ON points_transactions(created_at);
CREATE INDEX idx_points_transactions_expires_at ON points_transactions(expires_at);
CREATE INDEX idx_user_loyalty_tier_id ON user_loyalty(tier_id);
CREATE INDEX idx_user_loyalty_current_points ON user_loyalty(current_points);
CREATE INDEX idx_points_earning_rules_active ON points_earning_rules(is_active);

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_tiers_updated_at BEFORE UPDATE ON tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_loyalty_updated_at BEFORE UPDATE ON user_loyalty
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_points_earning_rules_updated_at BEFORE UPDATE ON points_earning_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically update tier based on points
CREATE OR REPLACE FUNCTION update_user_tier()
RETURNS TRIGGER AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    -- Find the appropriate tier based on current points
    SELECT id INTO new_tier_id
    FROM tiers 
    WHERE is_active = true 
    AND min_points <= NEW.current_points
    ORDER BY min_points DESC
    LIMIT 1;
    
    -- Update tier if it changed
    IF new_tier_id IS DISTINCT FROM NEW.tier_id THEN
        NEW.tier_id = new_tier_id;
        NEW.tier_updated_at = NOW();
    END IF;
    
    NEW.points_updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply tier update trigger
CREATE TRIGGER update_user_tier_on_points_change 
    BEFORE UPDATE OF current_points ON user_loyalty
    FOR EACH ROW EXECUTE FUNCTION update_user_tier();

-- Function to calculate points balance including expiration
CREATE OR REPLACE FUNCTION calculate_user_points(p_user_id UUID)
RETURNS TABLE(
    current_points INTEGER,
    expiring_points INTEGER,
    next_expiry_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    WITH valid_points AS (
        SELECT 
            pt.points,
            pt.expires_at
        FROM points_transactions pt
        WHERE pt.user_id = p_user_id
        AND pt.points > 0
        AND (pt.expires_at IS NULL OR pt.expires_at > NOW())
    ),
    expiring_soon AS (
        SELECT 
            SUM(vp.points) as points,
            MIN(vp.expires_at) as next_expiry
        FROM valid_points vp
        WHERE vp.expires_at IS NOT NULL 
        AND vp.expires_at <= NOW() + INTERVAL '30 days'
    )
    SELECT 
        COALESCE((
            SELECT SUM(pt.points) 
            FROM points_transactions pt 
            WHERE pt.user_id = p_user_id
        ), 0)::INTEGER as current_points,
        COALESCE(es.points, 0)::INTEGER as expiring_points,
        es.next_expiry as next_expiry_date
    FROM expiring_soon es;
END;
$$ language 'plpgsql';

-- Insert default tier data
INSERT INTO tiers (name, min_points, color, sort_order, benefits) VALUES
('Bronze', 0, '#CD7F32', 1, '{
    "description": "Welcome to our loyalty program",
    "perks": [
        "Free WiFi",
        "Welcome drink",
        "Priority check-in"
    ]
}'),
('Silver', 5000, '#C0C0C0', 2, '{
    "description": "Enjoy enhanced benefits",
    "perks": [
        "All Bronze benefits",
        "Room upgrade (subject to availability)",
        "Late checkout until 2 PM",
        "10% discount on dining"
    ]
}'),
('Gold', 15000, '#FFD700', 3, '{
    "description": "Premium experiences await",
    "perks": [
        "All Silver benefits",
        "Guaranteed room upgrade",
        "Late checkout until 4 PM",
        "15% discount on dining",
        "Access to executive lounge"
    ]
}'),
('Platinum', 35000, '#E5E4E2', 4, '{
    "description": "Ultimate luxury and exclusivity",
    "perks": [
        "All Gold benefits",
        "Suite upgrade (subject to availability)",
        "24-hour late checkout",
        "20% discount on dining",
        "Priority restaurant reservations",
        "Complimentary breakfast",
        "Personal concierge service"
    ]
}');

-- Insert default points earning rule
INSERT INTO points_earning_rules (name, description, points_per_unit, unit_type, multiplier_by_tier) VALUES
('Standard Earning', 'Standard points earning rate for hotel stays', 10.00, 'currency', '{
    "Bronze": 1.0,
    "Silver": 1.25,
    "Gold": 1.5,
    "Platinum": 2.0
}');

-- Create function to award points with automatic tier update
CREATE OR REPLACE FUNCTION award_points(
    p_user_id UUID,
    p_points INTEGER,
    p_type points_transaction_type,
    p_description TEXT DEFAULT NULL,
    p_reference_id VARCHAR(100) DEFAULT NULL,
    p_admin_user_id UUID DEFAULT NULL,
    p_admin_reason TEXT DEFAULT NULL,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    transaction_id UUID;
    current_total INTEGER;
    lifetime_total INTEGER;
BEGIN
    -- Insert the points transaction
    INSERT INTO points_transactions (
        user_id, points, type, description, reference_id, 
        admin_user_id, admin_reason, expires_at
    )
    VALUES (
        p_user_id, p_points, p_type, p_description, p_reference_id,
        p_admin_user_id, p_admin_reason, p_expires_at
    )
    RETURNING id INTO transaction_id;
    
    -- Calculate new totals
    SELECT 
        COALESCE(SUM(points), 0),
        COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0)
    INTO current_total, lifetime_total
    FROM points_transactions 
    WHERE user_id = p_user_id;
    
    -- Update or insert user loyalty record
    INSERT INTO user_loyalty (user_id, current_points, lifetime_points)
    VALUES (p_user_id, current_total, lifetime_total)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        current_points = EXCLUDED.current_points,
        lifetime_points = EXCLUDED.lifetime_points;
    
    RETURN transaction_id;
END;
$$ language 'plpgsql';

-- Create view for user tier information
CREATE VIEW user_tier_info AS
SELECT 
    ul.user_id,
    ul.current_points,
    ul.lifetime_points,
    t.name as tier_name,
    t.color as tier_color,
    t.benefits as tier_benefits,
    t.sort_order as tier_level,
    -- Calculate progress to next tier
    CASE 
        WHEN next_tier.min_points IS NOT NULL THEN
            ROUND(
                (ul.current_points - t.min_points)::DECIMAL / 
                (next_tier.min_points - t.min_points) * 100, 
                2
            )
        ELSE 100.0
    END as progress_percentage,
    next_tier.min_points as next_tier_points,
    next_tier.name as next_tier_name,
    (next_tier.min_points - ul.current_points) as points_to_next_tier
FROM user_loyalty ul
LEFT JOIN tiers t ON ul.tier_id = t.id
LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
WHERE t.is_active = true OR t.is_active IS NULL;