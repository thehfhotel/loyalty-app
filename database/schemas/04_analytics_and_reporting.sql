-- Analytics and Reporting Tables

-- Events tracking table
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_name VARCHAR(255) NOT NULL,
    properties JSONB DEFAULT '{}',
    session_id VARCHAR(255),
    user_agent TEXT,
    ip_address INET,
    referrer TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for events
CREATE INDEX idx_events_customer_profile_id ON events(customer_profile_id);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_event_name ON events(event_name);
CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_created_at ON events(created_at);

-- Customer segments table
CREATE TABLE customer_segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    criteria JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for customer_segments
CREATE INDEX idx_customer_segments_name ON customer_segments(name);
CREATE INDEX idx_customer_segments_active ON customer_segments(is_active);
CREATE INDEX idx_customer_segments_created_by ON customer_segments(created_by);

-- Create trigger for updated_at
CREATE TRIGGER update_customer_segments_updated_at
    BEFORE UPDATE ON customer_segments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Customer segment memberships table
CREATE TABLE customer_segment_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    segment_id UUID NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMP,
    UNIQUE(customer_profile_id, segment_id)
);

-- Create indexes for customer_segment_memberships
CREATE INDEX idx_customer_segment_memberships_customer_profile_id ON customer_segment_memberships(customer_profile_id);
CREATE INDEX idx_customer_segment_memberships_segment_id ON customer_segment_memberships(segment_id);
CREATE INDEX idx_customer_segment_memberships_added_at ON customer_segment_memberships(added_at);
CREATE INDEX idx_customer_segment_memberships_removed_at ON customer_segment_memberships(removed_at);

-- Customer activities table (for tracking engagement)
CREATE TABLE customer_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    activity_type VARCHAR(100) NOT NULL,
    activity_name VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}',
    points_earned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for customer_activities
CREATE INDEX idx_customer_activities_customer_profile_id ON customer_activities(customer_profile_id);
CREATE INDEX idx_customer_activities_activity_type ON customer_activities(activity_type);
CREATE INDEX idx_customer_activities_activity_name ON customer_activities(activity_name);
CREATE INDEX idx_customer_activities_created_at ON customer_activities(created_at);

-- Daily metrics aggregation table
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_date DATE NOT NULL,
    metric_type VARCHAR(100) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(15,2) NOT NULL,
    dimensions JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(metric_date, metric_type, metric_name, dimensions)
);

-- Create indexes for daily_metrics
CREATE INDEX idx_daily_metrics_date ON daily_metrics(metric_date);
CREATE INDEX idx_daily_metrics_type ON daily_metrics(metric_type);
CREATE INDEX idx_daily_metrics_name ON daily_metrics(metric_name);
CREATE INDEX idx_daily_metrics_created_at ON daily_metrics(created_at);

-- Revenue tracking table
CREATE TABLE revenue_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_profile_id UUID REFERENCES customer_profiles(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    source VARCHAR(100),
    reference_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for revenue_transactions
CREATE INDEX idx_revenue_transactions_customer_profile_id ON revenue_transactions(customer_profile_id);
CREATE INDEX idx_revenue_transactions_transaction_type ON revenue_transactions(transaction_type);
CREATE INDEX idx_revenue_transactions_amount ON revenue_transactions(amount);
CREATE INDEX idx_revenue_transactions_source ON revenue_transactions(source);
CREATE INDEX idx_revenue_transactions_created_at ON revenue_transactions(created_at);

-- A/B test experiments table
CREATE TABLE ab_experiments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    hypothesis TEXT,
    variants JSONB NOT NULL,
    traffic_allocation JSONB NOT NULL,
    success_metrics JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for ab_experiments
CREATE INDEX idx_ab_experiments_name ON ab_experiments(name);
CREATE INDEX idx_ab_experiments_status ON ab_experiments(status);
CREATE INDEX idx_ab_experiments_start_date ON ab_experiments(start_date);
CREATE INDEX idx_ab_experiments_end_date ON ab_experiments(end_date);
CREATE INDEX idx_ab_experiments_created_by ON ab_experiments(created_by);

-- Create trigger for updated_at
CREATE TRIGGER update_ab_experiments_updated_at
    BEFORE UPDATE ON ab_experiments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- A/B test assignments table
CREATE TABLE ab_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    variant VARCHAR(100) NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(experiment_id, customer_profile_id)
);

-- Create indexes for ab_assignments
CREATE INDEX idx_ab_assignments_experiment_id ON ab_assignments(experiment_id);
CREATE INDEX idx_ab_assignments_customer_profile_id ON ab_assignments(customer_profile_id);
CREATE INDEX idx_ab_assignments_variant ON ab_assignments(variant);
CREATE INDEX idx_ab_assignments_assigned_at ON ab_assignments(assigned_at);

-- Views for analytics

-- Customer engagement view
CREATE VIEW customer_engagement AS
SELECT 
    cp.id as customer_profile_id,
    cp.user_id,
    u.email,
    u.first_name,
    u.last_name,
    t.name as tier_name,
    cp.points_balance,
    cp.lifetime_points,
    cp.total_spent,
    cp.stay_count,
    COUNT(DISTINCT ca.id) as total_activities,
    COUNT(DISTINCT CASE WHEN ca.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN ca.id END) as activities_last_30_days,
    COUNT(DISTINCT CASE WHEN ca.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN ca.id END) as activities_last_7_days,
    COUNT(DISTINCT sr.id) as surveys_completed,
    COUNT(DISTINCT cc.id) as coupons_issued,
    COUNT(DISTINCT CASE WHEN cc.used_at IS NOT NULL THEN cc.id END) as coupons_used,
    COUNT(DISTINCT rr.id) as redemptions_requested,
    COUNT(DISTINCT CASE WHEN rr.status = 'approved' THEN rr.id END) as redemptions_approved,
    MAX(ca.created_at) as last_activity_at,
    cp.created_at as member_since
FROM customer_profiles cp
JOIN users u ON cp.user_id = u.id
JOIN tiers t ON cp.tier_id = t.id
LEFT JOIN customer_activities ca ON cp.id = ca.customer_profile_id
LEFT JOIN survey_responses sr ON cp.id = sr.customer_profile_id AND sr.is_complete = TRUE
LEFT JOIN customer_coupons cc ON cp.id = cc.customer_profile_id
LEFT JOIN redemption_requests rr ON cp.id = rr.customer_profile_id
GROUP BY cp.id, cp.user_id, u.email, u.first_name, u.last_name, t.name, cp.points_balance, cp.lifetime_points, cp.total_spent, cp.stay_count, cp.created_at;

-- Campaign performance view
CREATE VIEW campaign_performance AS
SELECT 
    c.id as campaign_id,
    c.name,
    c.type,
    c.status,
    c.created_at,
    c.sent_at,
    COUNT(cr.id) as total_recipients,
    COUNT(CASE WHEN cr.sent_at IS NOT NULL THEN 1 END) as sent_count,
    COUNT(CASE WHEN cr.opened_at IS NOT NULL THEN 1 END) as opened_count,
    COUNT(CASE WHEN cr.clicked_at IS NOT NULL THEN 1 END) as clicked_count,
    COUNT(CASE WHEN cr.converted_at IS NOT NULL THEN 1 END) as converted_count,
    CASE 
        WHEN COUNT(cr.id) = 0 THEN 0
        ELSE ROUND(COUNT(CASE WHEN cr.sent_at IS NOT NULL THEN 1 END) * 100.0 / COUNT(cr.id), 2)
    END as delivery_rate,
    CASE 
        WHEN COUNT(CASE WHEN cr.sent_at IS NOT NULL THEN 1 END) = 0 THEN 0
        ELSE ROUND(COUNT(CASE WHEN cr.opened_at IS NOT NULL THEN 1 END) * 100.0 / COUNT(CASE WHEN cr.sent_at IS NOT NULL THEN 1 END), 2)
    END as open_rate,
    CASE 
        WHEN COUNT(CASE WHEN cr.opened_at IS NOT NULL THEN 1 END) = 0 THEN 0
        ELSE ROUND(COUNT(CASE WHEN cr.clicked_at IS NOT NULL THEN 1 END) * 100.0 / COUNT(CASE WHEN cr.opened_at IS NOT NULL THEN 1 END), 2)
    END as click_rate,
    CASE 
        WHEN COUNT(CASE WHEN cr.clicked_at IS NOT NULL THEN 1 END) = 0 THEN 0
        ELSE ROUND(COUNT(CASE WHEN cr.converted_at IS NOT NULL THEN 1 END) * 100.0 / COUNT(CASE WHEN cr.clicked_at IS NOT NULL THEN 1 END), 2)
    END as conversion_rate
FROM campaigns c
LEFT JOIN campaign_recipients cr ON c.id = cr.campaign_id
GROUP BY c.id, c.name, c.type, c.status, c.created_at, c.sent_at;

-- Loyalty program performance view
CREATE VIEW loyalty_program_performance AS
SELECT 
    t.name as tier_name,
    COUNT(cp.id) as customer_count,
    AVG(cp.points_balance) as avg_points_balance,
    AVG(cp.lifetime_points) as avg_lifetime_points,
    AVG(cp.total_spent) as avg_total_spent,
    AVG(cp.stay_count) as avg_stay_count,
    SUM(cp.points_balance) as total_points_balance,
    SUM(cp.lifetime_points) as total_lifetime_points,
    SUM(cp.total_spent) as total_revenue,
    SUM(cp.stay_count) as total_stays
FROM tiers t
LEFT JOIN customer_profiles cp ON t.id = cp.tier_id
GROUP BY t.id, t.name, t.min_points
ORDER BY t.min_points;

-- Functions for analytics aggregation

-- Function to calculate customer lifetime value
CREATE OR REPLACE FUNCTION calculate_customer_ltv(customer_profile_id UUID)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    ltv DECIMAL(10,2);
BEGIN
    SELECT 
        COALESCE(SUM(amount), 0) 
    INTO ltv
    FROM revenue_transactions 
    WHERE customer_profile_id = customer_profile_id;
    
    RETURN ltv;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate customer engagement score
CREATE OR REPLACE FUNCTION calculate_engagement_score(customer_profile_id UUID)
RETURNS DECIMAL(5,2) AS $$
DECLARE
    score DECIMAL(5,2) := 0;
    activity_count INTEGER;
    survey_count INTEGER;
    coupon_usage_rate DECIMAL(5,2);
    recency_days INTEGER;
BEGIN
    -- Activity score (0-30 points)
    SELECT COUNT(*) INTO activity_count
    FROM customer_activities
    WHERE customer_profile_id = customer_profile_id
    AND created_at >= CURRENT_DATE - INTERVAL '30 days';
    
    score := score + LEAST(activity_count, 30);
    
    -- Survey completion score (0-20 points)
    SELECT COUNT(*) INTO survey_count
    FROM survey_responses
    WHERE customer_profile_id = customer_profile_id
    AND is_complete = TRUE
    AND created_at >= CURRENT_DATE - INTERVAL '90 days';
    
    score := score + LEAST(survey_count * 5, 20);
    
    -- Coupon usage score (0-25 points)
    SELECT 
        CASE 
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2)
        END
    INTO coupon_usage_rate
    FROM customer_coupons
    WHERE customer_profile_id = customer_profile_id
    AND issued_at >= CURRENT_DATE - INTERVAL '90 days';
    
    score := score + (coupon_usage_rate * 0.25);
    
    -- Recency score (0-25 points)
    SELECT 
        EXTRACT(DAYS FROM (CURRENT_DATE - MAX(created_at)::DATE))
    INTO recency_days
    FROM customer_activities
    WHERE customer_profile_id = customer_profile_id;
    
    IF recency_days IS NULL THEN
        score := score + 0;
    ELSIF recency_days <= 7 THEN
        score := score + 25;
    ELSIF recency_days <= 30 THEN
        score := score + 15;
    ELSIF recency_days <= 90 THEN
        score := score + 5;
    END IF;
    
    RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql;