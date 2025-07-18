-- Campaigns and Coupons Tables

-- Campaigns table
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    content JSONB NOT NULL,
    targeting JSONB DEFAULT '{}',
    delivery JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    metrics JSONB DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP
);

-- Create indexes for campaigns
CREATE INDEX idx_campaigns_type ON campaigns(type);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at);
CREATE INDEX idx_campaigns_sent_at ON campaigns(sent_at);

-- Create trigger for updated_at
CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Coupons table
CREATE TABLE coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    value DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    conditions JSONB DEFAULT '{}',
    usage JSONB NOT NULL,
    validity JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for coupons
CREATE INDEX idx_coupons_code ON coupons(code);
CREATE INDEX idx_coupons_type ON coupons(type);
CREATE INDEX idx_coupons_category ON coupons(category);
CREATE INDEX idx_coupons_active ON coupons(is_active);
CREATE INDEX idx_coupons_validity ON coupons((validity->>'valid_from'), (validity->>'valid_to'));

-- Create trigger for updated_at
CREATE TRIGGER update_coupons_updated_at
    BEFORE UPDATE ON coupons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Customer coupons table (issued coupons)
CREATE TABLE customer_coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id),
    code VARCHAR(20) NOT NULL,
    qr_code TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    used_amount DECIMAL(10,2),
    notes TEXT
);

-- Create indexes for customer_coupons
CREATE INDEX idx_customer_coupons_customer_profile_id ON customer_coupons(customer_profile_id);
CREATE INDEX idx_customer_coupons_coupon_id ON customer_coupons(coupon_id);
CREATE INDEX idx_customer_coupons_code ON customer_coupons(code);
CREATE INDEX idx_customer_coupons_status ON customer_coupons(status);
CREATE INDEX idx_customer_coupons_expires_at ON customer_coupons(expires_at);
CREATE INDEX idx_customer_coupons_used_at ON customer_coupons(used_at);

-- Surveys table
CREATE TABLE surveys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    questions JSONB NOT NULL,
    targeting JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    valid_from TIMESTAMP,
    valid_to TIMESTAMP,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for surveys
CREATE INDEX idx_surveys_status ON surveys(status);
CREATE INDEX idx_surveys_created_by ON surveys(created_by);
CREATE INDEX idx_surveys_validity ON surveys(valid_from, valid_to);
CREATE INDEX idx_surveys_created_at ON surveys(created_at);

-- Create trigger for updated_at
CREATE TRIGGER update_surveys_updated_at
    BEFORE UPDATE ON surveys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Survey responses table
CREATE TABLE survey_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE CASCADE,
    answers JSONB NOT NULL,
    is_complete BOOLEAN DEFAULT FALSE,
    time_spent INTEGER,
    submitted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for survey_responses
CREATE INDEX idx_survey_responses_survey_id ON survey_responses(survey_id);
CREATE INDEX idx_survey_responses_customer_profile_id ON survey_responses(customer_profile_id);
CREATE INDEX idx_survey_responses_is_complete ON survey_responses(is_complete);
CREATE INDEX idx_survey_responses_submitted_at ON survey_responses(submitted_at);
CREATE INDEX idx_survey_responses_created_at ON survey_responses(created_at);

-- Create trigger for updated_at
CREATE TRIGGER update_survey_responses_updated_at
    BEFORE UPDATE ON survey_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    channel VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    priority VARCHAR(50) NOT NULL DEFAULT 'normal',
    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,
    opened_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for notifications
CREATE INDEX idx_notifications_customer_profile_id ON notifications(customer_profile_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_channel ON notifications(channel);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_priority ON notifications(priority);
CREATE INDEX idx_notifications_scheduled_at ON notifications(scheduled_at);
CREATE INDEX idx_notifications_sent_at ON notifications(sent_at);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- Create trigger for updated_at
CREATE TRIGGER update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Campaign recipients table (many-to-many)
CREATE TABLE campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP,
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    converted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, customer_profile_id)
);

-- Create indexes for campaign_recipients
CREATE INDEX idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_customer_profile_id ON campaign_recipients(customer_profile_id);
CREATE INDEX idx_campaign_recipients_status ON campaign_recipients(status);
CREATE INDEX idx_campaign_recipients_sent_at ON campaign_recipients(sent_at);
CREATE INDEX idx_campaign_recipients_opened_at ON campaign_recipients(opened_at);

-- Function to automatically expire coupons
CREATE OR REPLACE FUNCTION expire_customer_coupons()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE customer_coupons 
    SET status = 'expired'
    WHERE expires_at < CURRENT_TIMESTAMP 
    AND status = 'active';
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to expire coupons (requires pg_cron extension)
-- SELECT cron.schedule('expire-coupons', '0 0 * * *', 'SELECT expire_customer_coupons();');

-- Function to reward points for survey completion
CREATE OR REPLACE FUNCTION reward_survey_points()
RETURNS TRIGGER AS $$
DECLARE
    survey_settings JSONB;
    points_reward INTEGER;
BEGIN
    -- Only process when survey is being completed
    IF NEW.is_complete = TRUE AND OLD.is_complete = FALSE THEN
        -- Get survey settings
        SELECT settings INTO survey_settings
        FROM surveys
        WHERE id = NEW.survey_id;
        
        -- Extract points reward
        points_reward := COALESCE((survey_settings->>'points_reward')::INTEGER, 0);
        
        -- Award points if configured
        IF points_reward > 0 AND NEW.customer_profile_id IS NOT NULL THEN
            INSERT INTO points_transactions (
                customer_profile_id,
                type,
                amount,
                description,
                reference_id,
                reference_type
            ) VALUES (
                NEW.customer_profile_id,
                'earned',
                points_reward,
                'Survey completion reward',
                NEW.survey_id::TEXT,
                'survey'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for survey points reward
CREATE TRIGGER reward_survey_points_trigger
    AFTER UPDATE ON survey_responses
    FOR EACH ROW
    EXECUTE FUNCTION reward_survey_points();