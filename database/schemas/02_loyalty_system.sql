-- Loyalty System Tables

-- Loyalty tiers table
CREATE TABLE tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    min_points INTEGER NOT NULL DEFAULT 0,
    max_points INTEGER,
    benefits JSONB DEFAULT '[]',
    color VARCHAR(7) NOT NULL DEFAULT '#000000',
    icon VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for tiers
CREATE INDEX idx_tiers_active ON tiers(is_active);
CREATE INDEX idx_tiers_points_range ON tiers(min_points, max_points);

-- Create trigger for updated_at
CREATE TRIGGER update_tiers_updated_at
    BEFORE UPDATE ON tiers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Customer profiles table
CREATE TABLE customer_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id UUID NOT NULL REFERENCES tiers(id),
    points_balance INTEGER NOT NULL DEFAULT 0,
    lifetime_points INTEGER NOT NULL DEFAULT 0,
    total_spent DECIMAL(10,2) NOT NULL DEFAULT 0,
    stay_count INTEGER NOT NULL DEFAULT 0,
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for customer_profiles
CREATE INDEX idx_customer_profiles_user_id ON customer_profiles(user_id);
CREATE INDEX idx_customer_profiles_tier_id ON customer_profiles(tier_id);
CREATE INDEX idx_customer_profiles_points_balance ON customer_profiles(points_balance);
CREATE INDEX idx_customer_profiles_lifetime_points ON customer_profiles(lifetime_points);
CREATE INDEX idx_customer_profiles_total_spent ON customer_profiles(total_spent);

-- Create trigger for updated_at
CREATE TRIGGER update_customer_profiles_updated_at
    BEFORE UPDATE ON customer_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Points earning rules table
CREATE TABLE points_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    points_per_unit DECIMAL(10,2) NOT NULL DEFAULT 0,
    multiplier DECIMAL(5,2) NOT NULL DEFAULT 1,
    conditions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    valid_from TIMESTAMP,
    valid_to TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for points_rules
CREATE INDEX idx_points_rules_type ON points_rules(type);
CREATE INDEX idx_points_rules_active ON points_rules(is_active);
CREATE INDEX idx_points_rules_validity ON points_rules(valid_from, valid_to);

-- Create trigger for updated_at
CREATE TRIGGER update_points_rules_updated_at
    BEFORE UPDATE ON points_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Points transactions table
CREATE TABLE points_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    reference_id VARCHAR(255),
    reference_type VARCHAR(50),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for points_transactions
CREATE INDEX idx_points_transactions_customer_profile_id ON points_transactions(customer_profile_id);
CREATE INDEX idx_points_transactions_type ON points_transactions(type);
CREATE INDEX idx_points_transactions_reference ON points_transactions(reference_id, reference_type);
CREATE INDEX idx_points_transactions_expires_at ON points_transactions(expires_at);
CREATE INDEX idx_points_transactions_created_at ON points_transactions(created_at);

-- Redemption options table
CREATE TABLE redemption_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    points_cost INTEGER NOT NULL,
    cash_value DECIMAL(10,2) NOT NULL DEFAULT 0,
    availability INTEGER,
    terms TEXT,
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    valid_from TIMESTAMP,
    valid_to TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for redemption_options
CREATE INDEX idx_redemption_options_category ON redemption_options(category);
CREATE INDEX idx_redemption_options_points_cost ON redemption_options(points_cost);
CREATE INDEX idx_redemption_options_active ON redemption_options(is_active);
CREATE INDEX idx_redemption_options_validity ON redemption_options(valid_from, valid_to);

-- Create trigger for updated_at
CREATE TRIGGER update_redemption_options_updated_at
    BEFORE UPDATE ON redemption_options
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Redemption requests table
CREATE TABLE redemption_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    redemption_option_id UUID NOT NULL REFERENCES redemption_options(id),
    points_used INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    notes TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for redemption_requests
CREATE INDEX idx_redemption_requests_customer_profile_id ON redemption_requests(customer_profile_id);
CREATE INDEX idx_redemption_requests_redemption_option_id ON redemption_requests(redemption_option_id);
CREATE INDEX idx_redemption_requests_status ON redemption_requests(status);
CREATE INDEX idx_redemption_requests_approved_by ON redemption_requests(approved_by);
CREATE INDEX idx_redemption_requests_created_at ON redemption_requests(created_at);

-- Create trigger for updated_at
CREATE TRIGGER update_redemption_requests_updated_at
    BEFORE UPDATE ON redemption_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically update customer tier based on points
CREATE OR REPLACE FUNCTION update_customer_tier()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE customer_profiles 
    SET tier_id = (
        SELECT id 
        FROM tiers 
        WHERE NEW.points_balance >= min_points 
        AND (max_points IS NULL OR NEW.points_balance <= max_points)
        AND is_active = TRUE
        ORDER BY min_points DESC 
        LIMIT 1
    )
    WHERE id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic tier updates
CREATE TRIGGER update_customer_tier_trigger
    AFTER UPDATE OF points_balance ON customer_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_tier();

-- Function to update points balance after transaction
CREATE OR REPLACE FUNCTION update_points_balance()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE customer_profiles 
    SET points_balance = points_balance + NEW.amount,
        lifetime_points = CASE 
            WHEN NEW.type = 'earned' THEN lifetime_points + NEW.amount
            ELSE lifetime_points
        END
    WHERE id = NEW.customer_profile_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for points balance updates
CREATE TRIGGER update_points_balance_trigger
    AFTER INSERT ON points_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_points_balance();