-- Analytics events tracking
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(100),
    event_data JSONB DEFAULT '{}',
    user_properties JSONB DEFAULT '{}',
    platform VARCHAR(20) CHECK (platform IN ('web', 'ios', 'android', 'mobile_web')),
    app_version VARCHAR(20),
    ip_address INET,
    user_agent TEXT,
    referrer TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes for common queries
    INDEX(event_name),
    INDEX(user_id),
    INDEX(session_id),
    INDEX(created_at),
    INDEX(platform)
);

-- User sessions tracking
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    platform VARCHAR(20) CHECK (platform IN ('web', 'ios', 'android', 'mobile_web')),
    app_version VARCHAR(20),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    page_views INTEGER DEFAULT 0,
    events_count INTEGER DEFAULT 0,
    ip_address INET,
    user_agent TEXT,
    is_bounce BOOLEAN DEFAULT FALSE,
    referrer TEXT,
    exit_page TEXT,
    
    -- Indexes
    INDEX(user_id),
    INDEX(started_at),
    INDEX(platform),
    INDEX(duration_seconds)
);

-- Daily aggregated metrics
CREATE TABLE IF NOT EXISTS daily_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,2) NOT NULL DEFAULT 0,
    dimensions JSONB DEFAULT '{}', -- additional dimensions like platform, tier, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint for metric aggregation
    UNIQUE(metric_date, metric_type, metric_name, dimensions)
);

-- KPI dashboard data
CREATE TABLE IF NOT EXISTS kpi_dashboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_name VARCHAR(100) NOT NULL,
    kpi_name VARCHAR(100) NOT NULL,
    kpi_value DECIMAL(15,2) NOT NULL DEFAULT 0,
    previous_value DECIMAL(15,2) DEFAULT 0,
    change_percentage DECIMAL(5,2) DEFAULT 0,
    target_value DECIMAL(15,2),
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes
    INDEX(dashboard_name),
    INDEX(kpi_name),
    INDEX(period_start, period_end),
    
    -- Unique constraint
    UNIQUE(dashboard_name, kpi_name, period_start, period_end)
);

-- User behavior cohorts
CREATE TABLE IF NOT EXISTS user_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_name VARCHAR(100) NOT NULL,
    cohort_type VARCHAR(50) NOT NULL CHECK (cohort_type IN ('registration', 'first_booking', 'tier_upgrade')),
    cohort_period DATE NOT NULL, -- the period when the cohort was created (e.g., 2024-01)
    period_number INTEGER NOT NULL, -- weeks/months since cohort creation
    total_users INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    retention_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
    revenue DECIMAL(10,2) DEFAULT 0,
    bookings INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes
    INDEX(cohort_type),
    INDEX(cohort_period),
    INDEX(period_number),
    
    -- Unique constraint
    UNIQUE(cohort_name, cohort_period, period_number)
);

-- A/B test experiments
CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    hypothesis TEXT,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
    traffic_split JSONB NOT NULL DEFAULT '{}', -- {"control": 50, "variant_a": 50}
    success_metrics JSONB DEFAULT '[]', -- array of metric names to track
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    min_sample_size INTEGER DEFAULT 1000,
    confidence_level DECIMAL(3,2) DEFAULT 0.95,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- A/B test assignments
CREATE TABLE IF NOT EXISTS experiment_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    variant VARCHAR(50) NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate assignments
    UNIQUE(experiment_id, user_id),
    
    -- Indexes
    INDEX(experiment_id),
    INDEX(user_id),
    INDEX(variant)
);

-- A/B test results
CREATE TABLE IF NOT EXISTS experiment_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    variant VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,2) NOT NULL DEFAULT 0,
    sample_size INTEGER NOT NULL DEFAULT 0,
    conversion_rate DECIMAL(5,4), -- for conversion metrics
    confidence_interval JSONB, -- {"lower": 0.1, "upper": 0.3}
    p_value DECIMAL(10,8),
    is_significant BOOLEAN DEFAULT FALSE,
    analysis_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes
    INDEX(experiment_id),
    INDEX(variant),
    INDEX(metric_name),
    INDEX(analysis_date),
    
    -- Unique constraint
    UNIQUE(experiment_id, variant, metric_name, analysis_date)
);

-- Performance monitoring
CREATE TABLE IF NOT EXISTS performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255),
    method VARCHAR(10) CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
    response_time_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes for performance monitoring
    INDEX(service_name),
    INDEX(endpoint),
    INDEX(timestamp),
    INDEX(status_code),
    INDEX(response_time_ms)
);

-- Additional indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time ON analytics_events(event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_time ON analytics_events(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id, created_at) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_started ON user_sessions(user_id, started_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_duration ON user_sessions(duration_seconds) WHERE duration_seconds IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date_type ON daily_metrics(metric_date, metric_type);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_name ON daily_metrics(metric_name);

-- Update trigger for daily_metrics
CREATE TRIGGER update_daily_metrics_updated_at 
    BEFORE UPDATE ON daily_metrics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for kpi_dashboard
CREATE TRIGGER update_kpi_dashboard_last_updated 
    BEFORE UPDATE ON kpi_dashboard 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for user_cohorts
CREATE TRIGGER update_user_cohorts_updated_at 
    BEFORE UPDATE ON user_cohorts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for experiments
CREATE TRIGGER update_experiments_updated_at 
    BEFORE UPDATE ON experiments 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate user session duration
CREATE OR REPLACE FUNCTION update_session_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at))::INTEGER;
        -- Mark as bounce if session duration is less than 30 seconds and only 1 page view
        IF NEW.duration_seconds < 30 AND NEW.page_views <= 1 THEN
            NEW.is_bounce = TRUE;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_session_duration 
    BEFORE UPDATE ON user_sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_session_duration();

-- View for real-time dashboard metrics
CREATE OR REPLACE VIEW real_time_metrics AS
SELECT 
    'today_registrations' as metric_name,
    COUNT(*) as metric_value,
    'count' as metric_type
FROM users 
WHERE DATE(created_at) = CURRENT_DATE AND deleted_at IS NULL

UNION ALL

SELECT 
    'today_bookings' as metric_name,
    COUNT(*) as metric_value,
    'count' as metric_type
FROM bookings 
WHERE DATE(created_at) = CURRENT_DATE

UNION ALL

SELECT 
    'today_revenue' as metric_name,
    COALESCE(SUM(total_amount), 0) as metric_value,
    'currency' as metric_type
FROM bookings 
WHERE DATE(created_at) = CURRENT_DATE AND status = 'completed'

UNION ALL

SELECT 
    'active_users_last_hour' as metric_name,
    COUNT(DISTINCT user_id) as metric_value,
    'count' as metric_type
FROM analytics_events 
WHERE created_at > NOW() - INTERVAL '1 hour' AND user_id IS NOT NULL

UNION ALL

SELECT 
    'avg_session_duration_today' as metric_name,
    COALESCE(AVG(duration_seconds), 0) as metric_value,
    'seconds' as metric_type
FROM user_sessions 
WHERE DATE(started_at) = CURRENT_DATE AND duration_seconds IS NOT NULL;

-- Insert initial dashboard configurations
INSERT INTO kpi_dashboard (dashboard_name, kpi_name, kpi_value, target_value, period_type, period_start, period_end) VALUES
('executive', 'monthly_active_users', 0, 5000, 'monthly', DATE_TRUNC('month', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day'),
('executive', 'app_adoption_rate', 0, 60, 'monthly', DATE_TRUNC('month', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day'),
('executive', 'loyalty_program_roi', 0, 300, 'monthly', DATE_TRUNC('month', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day'),
('marketing', 'campaign_conversion_rate', 0, 15, 'monthly', DATE_TRUNC('month', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day'),
('operational', 'avg_app_load_time', 0, 3, 'daily', CURRENT_DATE, CURRENT_DATE),
('operational', 'error_rate', 0, 1, 'daily', CURRENT_DATE, CURRENT_DATE)
ON CONFLICT (dashboard_name, kpi_name, period_start, period_end) DO NOTHING;