-- Stream B: Coupons & Surveys System Database Schema
-- This file contains the complete database schema for the coupons and surveys functionality

-- =====================================================
-- COUPONS SYSTEM TABLES
-- =====================================================

-- Coupons table - stores coupon definitions
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed_amount', 'free_item')),
    category VARCHAR(20) NOT NULL CHECK (category IN ('room', 'dining', 'spa', 'experience', 'general')),
    value DECIMAL(10,2) NOT NULL CHECK (value > 0),
    min_spend DECIMAL(10,2) CHECK (min_spend >= 0),
    max_discount DECIMAL(10,2) CHECK (max_discount >= 0),
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    usage_limit INTEGER CHECK (usage_limit > 0),
    usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
    is_active BOOLEAN NOT NULL DEFAULT false,
    terms TEXT,
    image_url VARCHAR(500),
    qr_code TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CHECK (valid_from < valid_until),
    CHECK (usage_count <= COALESCE(usage_limit, usage_count + 1))
);

-- Customer coupons table - tracks coupon ownership and usage
CREATE TABLE IF NOT EXISTS customer_coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id),
    coupon_id UUID NOT NULL REFERENCES coupons(id),
    is_used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMP WITH TIME ZONE,
    redeemed_at TIMESTAMP WITH TIME ZONE,
    redemption_location VARCHAR(255),
    redemption_amount DECIMAL(10,2) CHECK (redemption_amount >= 0),
    discount_amount DECIMAL(10,2) CHECK (discount_amount >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(customer_id, coupon_id),
    CHECK ((is_used = false AND used_at IS NULL) OR (is_used = true AND used_at IS NOT NULL))
);

-- =====================================================
-- SURVEYS SYSTEM TABLES
-- =====================================================

-- Surveys table - stores survey definitions
CREATE TABLE IF NOT EXISTS surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    max_responses INTEGER CHECK (max_responses > 0),
    response_count INTEGER NOT NULL DEFAULT 0 CHECK (response_count >= 0),
    points_reward INTEGER NOT NULL DEFAULT 0 CHECK (points_reward >= 0),
    target_audience TEXT,
    estimated_time INTEGER NOT NULL DEFAULT 5 CHECK (estimated_time > 0), -- in minutes
    qr_code TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CHECK (start_date < end_date),
    CHECK (response_count <= COALESCE(max_responses, response_count + 1))
);

-- Survey questions table - stores individual questions
CREATE TABLE IF NOT EXISTS survey_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('text', 'number', 'single_choice', 'multiple_choice', 'rating', 'boolean')),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    is_required BOOLEAN NOT NULL DEFAULT true,
    order_index INTEGER NOT NULL CHECK (order_index >= 0),
    options JSONB, -- For choice-type questions
    metadata JSONB, -- Additional question configuration
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(survey_id, order_index)
);

-- Survey responses table - tracks customer survey participation
CREATE TABLE IF NOT EXISTS survey_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id UUID NOT NULL REFERENCES surveys(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    ip_address INET,
    user_agent TEXT,
    points_awarded INTEGER NOT NULL DEFAULT 0 CHECK (points_awarded >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(survey_id, customer_id),
    CHECK ((is_completed = false AND completed_at IS NULL) OR (is_completed = true AND completed_at IS NOT NULL))
);

-- Survey question responses table - stores individual answers
CREATE TABLE IF NOT EXISTS survey_question_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES survey_questions(id),
    answer JSONB NOT NULL, -- Flexible storage for different answer types
    answered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(response_id, question_id)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Coupons indexes
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_category ON coupons(category);
CREATE INDEX IF NOT EXISTS idx_coupons_validity ON coupons(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active);
CREATE INDEX IF NOT EXISTS idx_coupons_created_by ON coupons(created_by);

-- Customer coupons indexes
CREATE INDEX IF NOT EXISTS idx_customer_coupons_customer ON customer_coupons(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_coupons_coupon ON customer_coupons(coupon_id);
CREATE INDEX IF NOT EXISTS idx_customer_coupons_used ON customer_coupons(is_used);
CREATE INDEX IF NOT EXISTS idx_customer_coupons_redeemed_at ON customer_coupons(redeemed_at);

-- Surveys indexes
CREATE INDEX IF NOT EXISTS idx_surveys_code ON surveys(code);
CREATE INDEX IF NOT EXISTS idx_surveys_active ON surveys(is_active);
CREATE INDEX IF NOT EXISTS idx_surveys_dates ON surveys(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_surveys_created_by ON surveys(created_by);

-- Survey questions indexes
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_questions_order ON survey_questions(survey_id, order_index);

-- Survey responses indexes
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_customer ON survey_responses(customer_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_completed ON survey_responses(is_completed);
CREATE INDEX IF NOT EXISTS idx_survey_responses_started_at ON survey_responses(started_at);

-- Survey question responses indexes
CREATE INDEX IF NOT EXISTS idx_survey_question_responses_response ON survey_question_responses(response_id);
CREATE INDEX IF NOT EXISTS idx_survey_question_responses_question ON survey_question_responses(question_id);

-- =====================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================

-- Update coupon usage count when customer_coupons is modified
CREATE OR REPLACE FUNCTION update_coupon_usage_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Increment usage count when coupon is redeemed
        IF NEW.is_used = true THEN
            UPDATE coupons 
            SET usage_count = usage_count + 1,
                updated_at = NOW()
            WHERE id = NEW.coupon_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Handle usage status changes
        IF OLD.is_used = false AND NEW.is_used = true THEN
            -- Coupon was redeemed
            UPDATE coupons 
            SET usage_count = usage_count + 1,
                updated_at = NOW()
            WHERE id = NEW.coupon_id;
        ELSIF OLD.is_used = true AND NEW.is_used = false THEN
            -- Coupon redemption was reverted (unlikely but possible)
            UPDATE coupons 
            SET usage_count = usage_count - 1,
                updated_at = NOW()
            WHERE id = NEW.coupon_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Decrement usage count when redeemed coupon is deleted
        IF OLD.is_used = true THEN
            UPDATE coupons 
            SET usage_count = usage_count - 1,
                updated_at = NOW()
            WHERE id = OLD.coupon_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_coupon_usage_count
    AFTER INSERT OR UPDATE OR DELETE ON customer_coupons
    FOR EACH ROW EXECUTE FUNCTION update_coupon_usage_count();

-- Update survey response count when survey_responses is modified
CREATE OR REPLACE FUNCTION update_survey_response_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE surveys 
        SET response_count = response_count + 1,
            updated_at = NOW()
        WHERE id = NEW.survey_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE surveys 
        SET response_count = response_count - 1,
            updated_at = NOW()
        WHERE id = OLD.survey_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_survey_response_count
    AFTER INSERT OR DELETE ON survey_responses
    FOR EACH ROW EXECUTE FUNCTION update_survey_response_count();

-- Update timestamps automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_coupons_updated_at
    BEFORE UPDATE ON coupons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_surveys_updated_at
    BEFORE UPDATE ON surveys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SAMPLE DATA FOR DEVELOPMENT
-- =====================================================

-- Insert sample coupons (only if running in development)
-- This would typically be handled by a seed script

-- Sample coupon
-- INSERT INTO coupons (
--     code, title, description, type, category, value, min_spend, 
--     valid_from, valid_until, usage_limit, created_by, is_active
-- ) VALUES (
--     'WELCOME20',
--     '20% Off Your First Stay',
--     'Welcome to our hotel! Enjoy 20% off your first room booking.',
--     'percentage',
--     'room',
--     20.00,
--     100.00,
--     NOW(),
--     NOW() + INTERVAL '30 days',
--     100,
--     (SELECT id FROM users WHERE email = 'admin@hotel.com' LIMIT 1),
--     true
-- );

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active coupons view
CREATE OR REPLACE VIEW active_coupons AS
SELECT 
    c.*,
    u.email as created_by_email,
    CASE 
        WHEN c.usage_limit IS NOT NULL THEN 
            ROUND((c.usage_count::DECIMAL / c.usage_limit::DECIMAL) * 100, 2)
        ELSE 0 
    END as utilization_percentage
FROM coupons c
JOIN users u ON c.created_by = u.id
WHERE c.is_active = true 
    AND c.valid_from <= NOW() 
    AND c.valid_until > NOW();

-- Active surveys view
CREATE OR REPLACE VIEW active_surveys AS
SELECT 
    s.*,
    u.email as created_by_email,
    COUNT(sq.id) as question_count,
    CASE 
        WHEN s.max_responses IS NOT NULL THEN 
            ROUND((s.response_count::DECIMAL / s.max_responses::DECIMAL) * 100, 2)
        ELSE 0 
    END as response_rate_percentage
FROM surveys s
JOIN users u ON s.created_by = u.id
LEFT JOIN survey_questions sq ON s.id = sq.survey_id
WHERE s.is_active = true 
    AND s.start_date <= NOW() 
    AND s.end_date > NOW()
GROUP BY s.id, u.email;

-- Customer coupon summary view
CREATE OR REPLACE VIEW customer_coupon_summary AS
SELECT 
    u.id as customer_id,
    u.email,
    COUNT(cc.id) as total_coupons,
    COUNT(CASE WHEN cc.is_used = false THEN 1 END) as available_coupons,
    COUNT(CASE WHEN cc.is_used = true THEN 1 END) as used_coupons,
    COALESCE(SUM(cc.discount_amount), 0) as total_savings
FROM users u
LEFT JOIN customer_coupons cc ON u.id = cc.customer_id
WHERE u.role = 'customer'
GROUP BY u.id, u.email;

-- Survey participation summary view
CREATE OR REPLACE VIEW customer_survey_summary AS
SELECT 
    u.id as customer_id,
    u.email,
    COUNT(sr.id) as total_surveys_started,
    COUNT(CASE WHEN sr.is_completed = true THEN 1 END) as surveys_completed,
    COALESCE(SUM(sr.points_awarded), 0) as total_points_earned
FROM users u
LEFT JOIN survey_responses sr ON u.id = sr.customer_id
WHERE u.role = 'customer'
GROUP BY u.id, u.email;

-- =====================================================
-- PERMISSIONS AND SECURITY
-- =====================================================

-- Grant appropriate permissions (adjust based on your user roles)
-- GRANT SELECT, INSERT, UPDATE ON coupons, customer_coupons, surveys, survey_questions, survey_responses, survey_question_responses TO api_user;
-- GRANT SELECT ON active_coupons, active_surveys, customer_coupon_summary, customer_survey_summary TO api_user;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO api_user;