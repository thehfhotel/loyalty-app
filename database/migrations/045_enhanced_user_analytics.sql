-- Enhanced User Analytics Migration
-- Description: Create comprehensive tracking tables for coupon usage and profile changes

-- Coupon usage events table for detailed tracking
CREATE TABLE coupon_usage_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_coupon_id UUID REFERENCES user_coupons(id) ON DELETE SET NULL,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('view', 'assign', 'redeem_attempt', 'redeem_success', 'redeem_fail', 'expire', 'revoke')),
    source VARCHAR(50), -- 'admin_assign', 'profile_completion', 'bulk_assign', etc.
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profile change events table for audit trail
CREATE TABLE profile_change_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field VARCHAR(50) NOT NULL, -- 'firstName', 'dateOfBirth', 'interests', etc.
    old_value JSONB,
    new_value JSONB,
    change_source VARCHAR(20) NOT NULL CHECK (change_source IN ('user', 'admin', 'system')),
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily user analytics aggregation table
CREATE TABLE user_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analytics_date DATE NOT NULL,
    coupons_viewed INTEGER DEFAULT 0,
    coupons_redeemed INTEGER DEFAULT 0,
    profile_changes INTEGER DEFAULT 0,
    session_duration INTEGER, -- in minutes
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, analytics_date)
);

-- Create indexes for optimal query performance
CREATE INDEX idx_coupon_usage_events_user_id ON coupon_usage_events(user_id);
CREATE INDEX idx_coupon_usage_events_coupon_id ON coupon_usage_events(coupon_id);
CREATE INDEX idx_coupon_usage_events_event_type ON coupon_usage_events(event_type);
CREATE INDEX idx_coupon_usage_events_created_at ON coupon_usage_events(created_at);
CREATE INDEX idx_coupon_usage_events_source ON coupon_usage_events(source) WHERE source IS NOT NULL;

CREATE INDEX idx_profile_change_events_user_id ON profile_change_events(user_id);
CREATE INDEX idx_profile_change_events_field ON profile_change_events(field);
CREATE INDEX idx_profile_change_events_change_source ON profile_change_events(change_source);
CREATE INDEX idx_profile_change_events_created_at ON profile_change_events(created_at);

CREATE INDEX idx_user_analytics_user_id ON user_analytics(user_id);
CREATE INDEX idx_user_analytics_analytics_date ON user_analytics(analytics_date);
CREATE INDEX idx_user_analytics_last_activity ON user_analytics(last_activity_at);

-- Add comments for documentation
COMMENT ON TABLE coupon_usage_events IS 'Detailed tracking of all coupon-related user interactions';
COMMENT ON COLUMN coupon_usage_events.event_type IS 'Type of interaction: view, assign, redeem_attempt, redeem_success, redeem_fail, expire, revoke';
COMMENT ON COLUMN coupon_usage_events.source IS 'Source of the event: admin_assign, profile_completion, bulk_assign, etc.';
COMMENT ON COLUMN coupon_usage_events.metadata IS 'Additional context-specific data for the event';

COMMENT ON TABLE profile_change_events IS 'Audit trail for all user profile modifications';
COMMENT ON COLUMN profile_change_events.field IS 'The profile field that was changed';
COMMENT ON COLUMN profile_change_events.old_value IS 'Previous value before the change (JSON encoded)';
COMMENT ON COLUMN profile_change_events.new_value IS 'New value after the change (JSON encoded)';
COMMENT ON COLUMN profile_change_events.change_source IS 'Who initiated the change: user, admin, or system';

COMMENT ON TABLE user_analytics IS 'Daily aggregated user activity metrics';
COMMENT ON COLUMN user_analytics.coupons_viewed IS 'Number of coupon views on this date';
COMMENT ON COLUMN user_analytics.coupons_redeemed IS 'Number of successful coupon redemptions on this date';
COMMENT ON COLUMN user_analytics.profile_changes IS 'Number of profile modifications on this date';

-- Create a function to automatically update daily analytics
CREATE OR REPLACE FUNCTION update_user_daily_analytics(target_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
DECLARE
    records_processed INTEGER := 0;
BEGIN
    INSERT INTO user_analytics (
        user_id, analytics_date, coupons_viewed, coupons_redeemed,
        profile_changes, last_activity_at, created_at
    )
    SELECT 
        u.id,
        target_date,
        COALESCE(coupon_stats.views, 0),
        COALESCE(coupon_stats.redemptions, 0),
        COALESCE(profile_stats.changes, 0),
        GREATEST(
            COALESCE(coupon_stats.last_activity, '1970-01-01'::timestamptz),
            COALESCE(profile_stats.last_activity, '1970-01-01'::timestamptz)
        ),
        NOW()
    FROM users u
    LEFT JOIN (
        SELECT 
            user_id,
            COUNT(*) FILTER (WHERE event_type = 'view') as views,
            COUNT(*) FILTER (WHERE event_type = 'redeem_success') as redemptions,
            MAX(created_at) as last_activity
        FROM coupon_usage_events
        WHERE DATE(created_at) = target_date
        GROUP BY user_id
    ) coupon_stats ON u.id = coupon_stats.user_id
    LEFT JOIN (
        SELECT 
            user_id,
            COUNT(*) as changes,
            MAX(created_at) as last_activity
        FROM profile_change_events
        WHERE DATE(created_at) = target_date
        GROUP BY user_id
    ) profile_stats ON u.id = profile_stats.user_id
    WHERE COALESCE(coupon_stats.views, 0) > 0 
       OR COALESCE(coupon_stats.redemptions, 0) > 0
       OR COALESCE(profile_stats.changes, 0) > 0
    ON CONFLICT (user_id, analytics_date) DO UPDATE SET
        coupons_viewed = EXCLUDED.coupons_viewed,
        coupons_redeemed = EXCLUDED.coupons_redeemed,
        profile_changes = EXCLUDED.profile_changes,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = NOW();

    GET DIAGNOSTICS records_processed = ROW_COUNT;
    RETURN records_processed;
END;
$$ LANGUAGE plpgsql;