-- Phase 3: Digital Coupon System Database Schema

-- Coupon types enum
CREATE TYPE coupon_type AS ENUM (
    'percentage',    -- Percentage discount (e.g., 10% off)
    'fixed_amount',  -- Fixed amount discount (e.g., $50 off)
    'bogo',         -- Buy one get one free
    'free_upgrade', -- Free room upgrade
    'free_service'  -- Free service (spa, dining, etc.)
);

-- Coupon status enum
CREATE TYPE coupon_status AS ENUM (
    'draft',        -- Created but not active
    'active',       -- Available for use
    'paused',       -- Temporarily disabled
    'expired',      -- Past expiry date
    'exhausted'     -- Usage limit reached
);

-- User coupon status enum
CREATE TYPE user_coupon_status AS ENUM (
    'available',    -- Available for use
    'used',         -- Already redeemed
    'expired',      -- Past expiry date
    'revoked'       -- Admin revoked access
);

-- Coupons master table
CREATE TABLE coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    terms_and_conditions TEXT,
    type coupon_type NOT NULL,
    value DECIMAL(10,2), -- Percentage (0-100) or fixed amount
    currency VARCHAR(3) DEFAULT 'USD', -- For fixed amount coupons
    minimum_spend DECIMAL(10,2), -- Minimum purchase amount
    maximum_discount DECIMAL(10,2), -- Maximum discount for percentage coupons
    
    -- Availability settings
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    usage_limit INTEGER, -- Total usage limit across all users
    usage_limit_per_user INTEGER DEFAULT 1, -- Usage limit per individual user
    used_count INTEGER DEFAULT 0, -- Track total usage
    
    -- Targeting settings
    tier_restrictions JSONB DEFAULT '[]', -- Array of tier names that can use this coupon
    customer_segment JSONB DEFAULT '{}', -- Custom targeting criteria
    
    -- Admin metadata
    status coupon_status DEFAULT 'draft',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User coupons (assignment and tracking)
CREATE TABLE user_coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    
    -- Individual coupon instance data
    status user_coupon_status DEFAULT 'available',
    qr_code TEXT NOT NULL UNIQUE, -- QR code for this specific instance
    
    -- Usage tracking
    used_at TIMESTAMP WITH TIME ZONE,
    used_by_admin UUID REFERENCES users(id) ON DELETE SET NULL, -- Admin who processed redemption
    redemption_location VARCHAR(255), -- Where it was redeemed
    redemption_details JSONB DEFAULT '{}', -- Additional redemption metadata
    
    -- Assignment metadata
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL, -- Admin who assigned
    assigned_reason TEXT, -- Reason for assignment (campaign, loyalty reward, etc.)
    expires_at TIMESTAMP WITH TIME ZONE, -- Individual expiry (can override coupon expiry)
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one active coupon per user per coupon type
    UNIQUE(user_id, coupon_id, status) DEFERRABLE INITIALLY DEFERRED
);

-- Coupon redemption history (audit trail)
CREATE TABLE coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_coupon_id UUID NOT NULL REFERENCES user_coupons(id) ON DELETE CASCADE,
    
    -- Transaction details
    original_amount DECIMAL(10,2),
    discount_amount DECIMAL(10,2),
    final_amount DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Context
    transaction_reference VARCHAR(255), -- Booking ID, receipt number, etc.
    redemption_channel VARCHAR(50) DEFAULT 'mobile_app', -- mobile_app, web, pos, front_desk
    staff_member_id UUID REFERENCES users(id) ON DELETE SET NULL,
    location VARCHAR(255),
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Coupon analytics aggregations
CREATE TABLE coupon_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    
    -- Daily aggregated stats
    analytics_date DATE NOT NULL,
    
    -- Usage metrics
    total_assigned INTEGER DEFAULT 0,
    total_used INTEGER DEFAULT 0,
    total_expired INTEGER DEFAULT 0,
    total_revenue_impact DECIMAL(12,2) DEFAULT 0.00,
    
    -- User engagement
    unique_users_assigned INTEGER DEFAULT 0,
    unique_users_redeemed INTEGER DEFAULT 0,
    average_time_to_redemption INTERVAL,
    
    -- Performance metrics
    conversion_rate DECIMAL(5,2), -- Used / Assigned * 100
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(coupon_id, analytics_date)
);

-- Create indexes for performance
CREATE INDEX idx_coupons_code ON coupons(code);
CREATE INDEX idx_coupons_status ON coupons(status);
CREATE INDEX idx_coupons_type ON coupons(type);
CREATE INDEX idx_coupons_valid_dates ON coupons(valid_from, valid_until);
CREATE INDEX idx_coupons_created_by ON coupons(created_by);

CREATE INDEX idx_user_coupons_user_id ON user_coupons(user_id);
CREATE INDEX idx_user_coupons_coupon_id ON user_coupons(coupon_id);
CREATE INDEX idx_user_coupons_status ON user_coupons(status);
CREATE INDEX idx_user_coupons_qr_code ON user_coupons(qr_code);
CREATE INDEX idx_user_coupons_expires_at ON user_coupons(expires_at);

CREATE INDEX idx_coupon_redemptions_user_coupon_id ON coupon_redemptions(user_coupon_id);
CREATE INDEX idx_coupon_redemptions_created_at ON coupon_redemptions(created_at);
CREATE INDEX idx_coupon_redemptions_transaction_ref ON coupon_redemptions(transaction_reference);

CREATE INDEX idx_coupon_analytics_coupon_id ON coupon_analytics(coupon_id);
CREATE INDEX idx_coupon_analytics_date ON coupon_analytics(analytics_date);

-- Apply updated_at triggers
CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON coupons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_coupons_updated_at BEFORE UPDATE ON user_coupons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate unique QR code
CREATE OR REPLACE FUNCTION generate_qr_code()
RETURNS TEXT AS $$
DECLARE
    qr_code TEXT;
    exists_check INTEGER;
BEGIN
    LOOP
        -- Generate 16-character alphanumeric code
        qr_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16));
        
        -- Check if it already exists
        SELECT COUNT(*) INTO exists_check FROM user_coupons WHERE qr_code = qr_code;
        
        -- Exit loop if unique
        EXIT WHEN exists_check = 0;
    END LOOP;
    
    RETURN qr_code;
END;
$$ language 'plpgsql';

-- Trigger to automatically generate QR code for new user coupons
CREATE OR REPLACE FUNCTION set_qr_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.qr_code IS NULL OR NEW.qr_code = '' THEN
        NEW.qr_code := generate_qr_code();
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER generate_qr_code_trigger BEFORE INSERT ON user_coupons
    FOR EACH ROW EXECUTE FUNCTION set_qr_code();

-- Function to assign coupon to user
CREATE OR REPLACE FUNCTION assign_coupon_to_user(
    p_coupon_id UUID,
    p_user_id UUID,
    p_assigned_by UUID DEFAULT NULL,
    p_assigned_reason TEXT DEFAULT NULL,
    p_custom_expiry TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    user_coupon_id UUID;
    coupon_record RECORD;
    current_usage INTEGER;
    user_usage_count INTEGER;
    expiry_date TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get coupon details and validate
    SELECT * INTO coupon_record FROM coupons WHERE id = p_coupon_id AND status = 'active';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon not found or not active';
    END IF;
    
    -- Check if coupon is still valid
    IF coupon_record.valid_until IS NOT NULL AND coupon_record.valid_until < NOW() THEN
        RAISE EXCEPTION 'Coupon has expired';
    END IF;
    
    -- Check total usage limit
    IF coupon_record.usage_limit IS NOT NULL AND coupon_record.used_count >= coupon_record.usage_limit THEN
        RAISE EXCEPTION 'Coupon usage limit exceeded';
    END IF;
    
    -- Check per-user usage limit
    SELECT COUNT(*) INTO user_usage_count 
    FROM user_coupons 
    WHERE coupon_id = p_coupon_id AND user_id = p_user_id AND status != 'revoked';
    
    IF coupon_record.usage_limit_per_user IS NOT NULL AND user_usage_count >= coupon_record.usage_limit_per_user THEN
        RAISE EXCEPTION 'User usage limit exceeded for this coupon';
    END IF;
    
    -- Determine expiry date
    expiry_date := COALESCE(p_custom_expiry, coupon_record.valid_until);
    
    -- Create user coupon
    INSERT INTO user_coupons (
        user_id, 
        coupon_id, 
        assigned_by, 
        assigned_reason, 
        expires_at
    )
    VALUES (
        p_user_id, 
        p_coupon_id, 
        p_assigned_by, 
        p_assigned_reason, 
        expiry_date
    )
    RETURNING id INTO user_coupon_id;
    
    RETURN user_coupon_id;
END;
$$ language 'plpgsql';

-- Function to redeem coupon
CREATE OR REPLACE FUNCTION redeem_coupon(
    p_qr_code TEXT,
    p_original_amount DECIMAL(10,2),
    p_redeemed_by_admin UUID DEFAULT NULL,
    p_transaction_reference VARCHAR(255) DEFAULT NULL,
    p_location VARCHAR(255) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    discount_amount DECIMAL(10,2),
    final_amount DECIMAL(10,2),
    user_coupon_id UUID
) AS $$
DECLARE
    user_coupon_record RECORD;
    coupon_record RECORD;
    calculated_discount DECIMAL(10,2);
    final_amount_calc DECIMAL(10,2);
    redemption_id UUID;
BEGIN
    -- Find user coupon by QR code
    SELECT uc.*, c.*
    INTO user_coupon_record
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.qr_code = p_qr_code;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Invalid QR code', 0.00::DECIMAL(10,2), p_original_amount, NULL::UUID;
        RETURN;
    END IF;
    
    -- Validate coupon status
    IF user_coupon_record.status != 'available' THEN
        RETURN QUERY SELECT false, 'Coupon is not available for use', 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.id;
        RETURN;
    END IF;
    
    -- Check expiry
    IF user_coupon_record.expires_at IS NOT NULL AND user_coupon_record.expires_at < NOW() THEN
        -- Update status to expired
        UPDATE user_coupons SET status = 'expired' WHERE id = user_coupon_record.id;
        RETURN QUERY SELECT false, 'Coupon has expired', 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.id;
        RETURN;
    END IF;
    
    -- Check minimum spend
    IF user_coupon_record.minimum_spend IS NOT NULL AND p_original_amount < user_coupon_record.minimum_spend THEN
        RETURN QUERY SELECT false, format('Minimum spend of %s required', user_coupon_record.minimum_spend), 0.00::DECIMAL(10,2), p_original_amount, user_coupon_record.id;
        RETURN;
    END IF;
    
    -- Calculate discount
    CASE user_coupon_record.type
        WHEN 'percentage' THEN
            calculated_discount := p_original_amount * (user_coupon_record.value / 100);
            -- Apply maximum discount if set
            IF user_coupon_record.maximum_discount IS NOT NULL AND calculated_discount > user_coupon_record.maximum_discount THEN
                calculated_discount := user_coupon_record.maximum_discount;
            END IF;
        WHEN 'fixed_amount' THEN
            calculated_discount := LEAST(user_coupon_record.value, p_original_amount);
        WHEN 'bogo' THEN
            -- For BOGO, assume 50% discount (can be customized)
            calculated_discount := p_original_amount * 0.5;
        ELSE
            -- For other types, treat as percentage with value as discount
            calculated_discount := p_original_amount * (user_coupon_record.value / 100);
    END CASE;
    
    final_amount_calc := GREATEST(0, p_original_amount - calculated_discount);
    
    -- Mark coupon as used
    UPDATE user_coupons 
    SET 
        status = 'used',
        used_at = NOW(),
        used_by_admin = p_redeemed_by_admin,
        redemption_location = p_location
    WHERE id = user_coupon_record.id;
    
    -- Update coupon usage count
    UPDATE coupons 
    SET used_count = used_count + 1 
    WHERE id = user_coupon_record.coupon_id;
    
    -- Record redemption history
    INSERT INTO coupon_redemptions (
        user_coupon_id,
        original_amount,
        discount_amount,
        final_amount,
        currency,
        transaction_reference,
        staff_member_id,
        location,
        metadata
    )
    VALUES (
        user_coupon_record.id,
        p_original_amount,
        calculated_discount,
        final_amount_calc,
        user_coupon_record.currency,
        p_transaction_reference,
        p_redeemed_by_admin,
        p_location,
        p_metadata
    )
    RETURNING id INTO redemption_id;
    
    RETURN QUERY SELECT true, 'Coupon redeemed successfully', calculated_discount, final_amount_calc, user_coupon_record.id;
END;
$$ language 'plpgsql';

-- Function to update daily analytics
CREATE OR REPLACE FUNCTION update_coupon_analytics(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
DECLARE
    processed_count INTEGER := 0;
    coupon_record RECORD;
BEGIN
    FOR coupon_record IN SELECT id FROM coupons LOOP
        INSERT INTO coupon_analytics (
            coupon_id,
            analytics_date,
            total_assigned,
            total_used,
            total_expired,
            unique_users_assigned,
            unique_users_redeemed,
            conversion_rate
        )
        SELECT 
            coupon_record.id,
            p_date,
            COUNT(*) FILTER (WHERE DATE(uc.created_at) <= p_date),
            COUNT(*) FILTER (WHERE uc.status = 'used' AND DATE(uc.used_at) <= p_date),
            COUNT(*) FILTER (WHERE uc.status = 'expired' AND DATE(uc.updated_at) <= p_date),
            COUNT(DISTINCT uc.user_id) FILTER (WHERE DATE(uc.created_at) <= p_date),
            COUNT(DISTINCT uc.user_id) FILTER (WHERE uc.status = 'used' AND DATE(uc.used_at) <= p_date),
            CASE 
                WHEN COUNT(*) FILTER (WHERE DATE(uc.created_at) <= p_date) > 0 THEN
                    ROUND(
                        (COUNT(*) FILTER (WHERE uc.status = 'used' AND DATE(uc.used_at) <= p_date)::DECIMAL / 
                         COUNT(*) FILTER (WHERE DATE(uc.created_at) <= p_date) * 100), 
                        2
                    )
                ELSE 0
            END
        FROM user_coupons uc
        WHERE uc.coupon_id = coupon_record.id
        ON CONFLICT (coupon_id, analytics_date) 
        DO UPDATE SET
            total_assigned = EXCLUDED.total_assigned,
            total_used = EXCLUDED.total_used,
            total_expired = EXCLUDED.total_expired,
            unique_users_assigned = EXCLUDED.unique_users_assigned,
            unique_users_redeemed = EXCLUDED.unique_users_redeemed,
            conversion_rate = EXCLUDED.conversion_rate;
        
        processed_count := processed_count + 1;
    END LOOP;
    
    RETURN processed_count;
END;
$$ language 'plpgsql';

-- Create view for active user coupons with coupon details
CREATE VIEW user_active_coupons AS
SELECT 
    uc.id as user_coupon_id,
    uc.user_id,
    uc.status,
    uc.qr_code,
    uc.expires_at,
    uc.created_at as assigned_at,
    c.id as coupon_id,
    c.code,
    c.name,
    c.description,
    c.terms_and_conditions,
    c.type,
    c.value,
    c.currency,
    c.minimum_spend,
    c.maximum_discount,
    c.valid_until as coupon_expires_at,
    -- Calculate effective expiry (earlier of user_coupon expiry or coupon expiry)
    CASE 
        WHEN uc.expires_at IS NOT NULL AND c.valid_until IS NOT NULL THEN
            LEAST(uc.expires_at, c.valid_until)
        ELSE
            COALESCE(uc.expires_at, c.valid_until)
    END as effective_expiry,
    -- Check if coupon is expiring soon (within 7 days)
    CASE 
        WHEN uc.expires_at IS NOT NULL AND c.valid_until IS NOT NULL THEN
            LEAST(uc.expires_at, c.valid_until) <= NOW() + INTERVAL '7 days'
        ELSE
            COALESCE(uc.expires_at, c.valid_until) <= NOW() + INTERVAL '7 days'
    END as expiring_soon
FROM user_coupons uc
JOIN coupons c ON uc.coupon_id = c.id
WHERE uc.status = 'available' 
    AND c.status = 'active'
    AND (uc.expires_at IS NULL OR uc.expires_at > NOW())
    AND (c.valid_until IS NULL OR c.valid_until > NOW());

-- Insert sample coupon data for testing
INSERT INTO coupons (code, name, description, terms_and_conditions, type, value, currency, minimum_spend, maximum_discount, valid_from, valid_until, usage_limit, usage_limit_per_user, status) VALUES
('WELCOME10', 'Welcome 10% Off', 'Get 10% off your first stay', 'Valid for first-time guests only. Cannot be combined with other offers.', 'percentage', 10.00, 'USD', 100.00, 50.00, NOW(), NOW() + INTERVAL '6 months', 1000, 1, 'active'),
('LOYALTY50', 'Loyalty $50 Off', 'Loyalty members get $50 off', 'Valid for stays of 2 nights or more. Available to Silver tier and above.', 'fixed_amount', 50.00, 'USD', 200.00, NULL, NOW(), NOW() + INTERVAL '3 months', 500, 2, 'active'),
('UPGRADE', 'Free Room Upgrade', 'Complimentary room upgrade', 'Subject to availability. Valid for Gold and Platinum members only.', 'free_upgrade', 0.00, 'USD', NULL, NULL, NOW(), NOW() + INTERVAL '1 year', 100, 1, 'active');