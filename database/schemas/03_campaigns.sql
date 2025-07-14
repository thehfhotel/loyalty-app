-- Marketing campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    campaign_type VARCHAR(50) NOT NULL CHECK (campaign_type IN ('email', 'push', 'in_app', 'sms', 'multi_channel')),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled')),
    content JSONB NOT NULL DEFAULT '{}',
    target_criteria JSONB DEFAULT '{}',
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL, -- admin user id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_campaign_dates CHECK (end_date IS NULL OR end_date > start_date)
);

-- Campaign delivery tracking
CREATE TABLE IF NOT EXISTS campaign_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivery_channel VARCHAR(20) NOT NULL CHECK (delivery_channel IN ('email', 'push', 'sms', 'in_app')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced')),
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate deliveries
    UNIQUE(campaign_id, user_id, delivery_channel)
);

-- Campaign performance metrics
CREATE TABLE IF NOT EXISTS campaign_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    total_targeted INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_converted INTEGER DEFAULT 0,
    total_unsubscribed INTEGER DEFAULT 0,
    revenue_generated DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One record per campaign per date
    UNIQUE(campaign_id, metric_date)
);

-- Customer segments for targeting
CREATE TABLE IF NOT EXISTS customer_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    criteria JSONB NOT NULL,
    is_dynamic BOOLEAN DEFAULT TRUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Segment membership (for static segments)
CREATE TABLE IF NOT EXISTS segment_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id UUID NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate membership
    UNIQUE(segment_id, user_id)
);

-- Coupons and promotions
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount', 'points')),
    discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value > 0),
    min_spend DECIMAL(10,2) DEFAULT 0.00,
    max_discount DECIMAL(10,2), -- for percentage discounts
    usage_limit INTEGER, -- total usage limit
    usage_limit_per_user INTEGER DEFAULT 1,
    min_tier VARCHAR(20) DEFAULT 'bronze' CHECK (min_tier IN ('bronze', 'silver', 'gold', 'platinum')),
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    terms_conditions TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_coupon_dates CHECK (valid_until > valid_from),
    CONSTRAINT valid_usage_limits CHECK (usage_limit IS NULL OR usage_limit > 0),
    CONSTRAINT valid_user_usage_limit CHECK (usage_limit_per_user > 0)
);

-- Coupon usage tracking
CREATE TABLE IF NOT EXISTS coupon_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    discount_amount DECIMAL(10,2) NOT NULL CHECK (discount_amount >= 0),
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Index for performance
    INDEX(coupon_id, user_id)
);

-- Push notification tokens
CREATE TABLE IF NOT EXISTS push_notification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique token per user per platform
    UNIQUE(user_id, token, platform)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_type ON campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_campaign_id ON campaign_deliveries(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_user_id ON campaign_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_status ON campaign_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_channel ON campaign_deliveries(delivery_channel);

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_campaign_id ON campaign_metrics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_date ON campaign_metrics(metric_date);

CREATE INDEX IF NOT EXISTS idx_segment_members_segment_id ON segment_members(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_members_user_id ON segment_members(user_id);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_coupons_dates ON coupons(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_coupons_tier ON coupons(min_tier);

CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon_id ON coupon_usage(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_user_id ON coupon_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_used_at ON coupon_usage(used_at);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_notification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_notification_tokens(is_active) WHERE is_active = TRUE;

-- Update triggers
CREATE TRIGGER update_campaigns_updated_at 
    BEFORE UPDATE ON campaigns 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_metrics_updated_at 
    BEFORE UPDATE ON campaign_metrics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_segments_updated_at 
    BEFORE UPDATE ON customer_segments 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_coupons_updated_at 
    BEFORE UPDATE ON coupons 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_push_tokens_updated_at 
    BEFORE UPDATE ON push_notification_tokens 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default customer segments
INSERT INTO customer_segments (name, description, criteria, created_by) VALUES
('High Value Customers', 'Customers with lifetime spend over $5000', 
 '{"total_spend": {"operator": ">", "value": 5000}}', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com')),
('Frequent Travelers', 'Customers with 10+ stays', 
 '{"total_bookings": {"operator": ">=", "value": 10}}', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com')),
('At Risk Customers', 'Previously active customers who haven\'t stayed recently', 
 '{"days_since_last_stay": {"operator": ">", "value": 180}, "total_stays": {"operator": ">", "value": 3}}', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com')),
('New Members', 'Members who joined in the last 30 days', 
 '{"days_since_registration": {"operator": "<=", "value": 30}}', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com'))
ON CONFLICT (name) DO NOTHING;

-- Insert sample coupons
INSERT INTO coupons (code, name, description, discount_type, discount_value, min_spend, min_tier, valid_from, valid_until, created_by) VALUES
('WELCOME20', 'Welcome Discount', '20% off your first stay', 'percentage', 20.00, 100.00, 'bronze', NOW(), NOW() + INTERVAL '1 year', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com')),
('SUMMER50', 'Summer Special', '$50 off stays over $300', 'fixed_amount', 50.00, 300.00, 'bronze', NOW(), NOW() + INTERVAL '3 months', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com')),
('GOLD25', 'Gold Member Special', '25% off for Gold members', 'percentage', 25.00, 200.00, 'gold', NOW(), NOW() + INTERVAL '6 months', 
 (SELECT id FROM users WHERE email = 'admin@saichon.com'))
ON CONFLICT (code) DO NOTHING;