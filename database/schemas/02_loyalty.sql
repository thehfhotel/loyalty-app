-- Loyalty tiers configuration
CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_name VARCHAR(20) UNIQUE NOT NULL CHECK (tier_name IN ('bronze', 'silver', 'gold', 'platinum')),
    min_points INTEGER NOT NULL DEFAULT 0,
    min_nights INTEGER NOT NULL DEFAULT 0,
    min_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    benefits JSONB DEFAULT '{}',
    point_multiplier DECIMAL(3,2) DEFAULT 1.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Point transactions table
CREATE TABLE IF NOT EXISTS point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points_amount INTEGER NOT NULL,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earned', 'redeemed', 'expired', 'adjusted')),
    description TEXT NOT NULL,
    reference_id UUID, -- booking_id, campaign_id, etc.
    reference_type VARCHAR(50), -- 'booking', 'campaign', 'survey', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT valid_points_amount CHECK (
        (transaction_type = 'earned' AND points_amount > 0) OR
        (transaction_type IN ('redeemed', 'expired') AND points_amount < 0) OR
        (transaction_type = 'adjusted')
    )
);

-- Rewards catalog
CREATE TABLE IF NOT EXISTS rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    points_cost INTEGER NOT NULL CHECK (points_cost > 0),
    category VARCHAR(50) NOT NULL,
    min_tier VARCHAR(20) DEFAULT 'bronze' CHECK (min_tier IN ('bronze', 'silver', 'gold', 'platinum')),
    is_active BOOLEAN DEFAULT TRUE,
    terms_conditions TEXT,
    image_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reward redemptions
CREATE TABLE IF NOT EXISTS reward_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
    points_used INTEGER NOT NULL CHECK (points_used > 0),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'used', 'expired', 'cancelled')),
    redemption_code VARCHAR(50) UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bookings table (for points calculation)
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    booking_reference VARCHAR(50) UNIQUE NOT NULL,
    room_type VARCHAR(100),
    checkin_date DATE NOT NULL,
    checkout_date DATE NOT NULL,
    nights_count INTEGER GENERATED ALWAYS AS (checkout_date - checkin_date) STORED,
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
    points_earned INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_dates CHECK (checkout_date > checkin_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_point_transactions_user_id ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_created_at ON point_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_point_transactions_type ON point_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_point_transactions_expires_at ON point_transactions(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rewards_category ON rewards(category);
CREATE INDEX IF NOT EXISTS idx_rewards_active ON rewards(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_rewards_tier ON rewards(min_tier);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user_id ON reward_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code ON reward_redemptions(redemption_code) WHERE redemption_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX IF NOT EXISTS idx_bookings_checkin_date ON bookings(checkin_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Update triggers
CREATE TRIGGER update_loyalty_tiers_updated_at 
    BEFORE UPDATE ON loyalty_tiers 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rewards_updated_at 
    BEFORE UPDATE ON rewards 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reward_redemptions_updated_at 
    BEFORE UPDATE ON reward_redemptions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at 
    BEFORE UPDATE ON bookings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default loyalty tiers
INSERT INTO loyalty_tiers (tier_name, min_points, min_nights, min_spend, benefits, point_multiplier) VALUES
('bronze', 0, 0, 0.00, 
 '{"description": "Welcome tier", "benefits": ["mobile_checkin", "wifi"]}', 1.00),
('silver', 1000, 5, 1000.00, 
 '{"description": "Silver member benefits", "benefits": ["mobile_checkin", "wifi", "late_checkout", "room_upgrade_subject_to_availability"]}', 1.25),
('gold', 5000, 15, 5000.00, 
 '{"description": "Gold member benefits", "benefits": ["mobile_checkin", "wifi", "late_checkout", "room_upgrade", "welcome_amenity", "priority_support"]}', 1.50),
('platinum', 15000, 30, 15000.00, 
 '{"description": "Platinum member benefits", "benefits": ["mobile_checkin", "wifi", "late_checkout", "room_upgrade", "welcome_amenity", "priority_support", "executive_lounge", "complimentary_breakfast"]}', 2.00)
ON CONFLICT (tier_name) DO UPDATE SET
    min_points = EXCLUDED.min_points,
    min_nights = EXCLUDED.min_nights,
    min_spend = EXCLUDED.min_spend,
    benefits = EXCLUDED.benefits,
    point_multiplier = EXCLUDED.point_multiplier,
    updated_at = NOW();

-- Insert sample rewards
INSERT INTO rewards (name, description, points_cost, category, min_tier, terms_conditions) VALUES
('Free Night Stay', 'One free night at any participating hotel', 10000, 'accommodation', 'bronze', 'Subject to availability. Blackout dates may apply.'),
('Room Upgrade', 'Complimentary room upgrade to next category', 2500, 'accommodation', 'bronze', 'Subject to availability at check-in.'),
('Late Checkout', 'Late checkout until 4 PM', 500, 'service', 'bronze', 'Must be requested at least 24 hours in advance.'),
('Spa Credit - $50', '$50 credit towards spa services', 2000, 'spa', 'silver', 'Valid for 6 months from redemption date.'),
('Dining Credit - $100', '$100 credit towards restaurant and room service', 3500, 'dining', 'silver', 'Valid for 6 months from redemption date.'),
('Executive Lounge Access', '3-day executive lounge access', 1500, 'service', 'gold', 'Includes breakfast, evening cocktails, and business center access.'),
('Airport Transfer', 'Complimentary airport transfer', 1000, 'transportation', 'gold', 'Must be booked 24 hours in advance. One way only.')
ON CONFLICT (name) DO NOTHING;