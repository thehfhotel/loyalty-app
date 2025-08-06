-- Migration: Extend user profiles for new member coupon feature
-- Description: Add gender, occupation, interests fields and new member coupon system

-- Extend user_profiles table with new fields
ALTER TABLE user_profiles
ADD COLUMN gender VARCHAR(20),
ADD COLUMN occupation VARCHAR(100),
ADD COLUMN interests JSON DEFAULT '[]',
ADD COLUMN profile_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN profile_completed_at TIMESTAMPTZ,
ADD COLUMN new_member_coupon_awarded BOOLEAN DEFAULT FALSE,
ADD COLUMN new_member_coupon_awarded_at TIMESTAMPTZ;

-- Create new_member_coupon_settings table for admin management
CREATE TABLE new_member_coupon_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_enabled BOOLEAN DEFAULT TRUE,
    coupon_code VARCHAR(20) NOT NULL,
    coupon_name VARCHAR(255) NOT NULL,
    coupon_description TEXT,
    coupon_type coupon_type NOT NULL DEFAULT 'percentage',
    coupon_value DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    minimum_spend DECIMAL(10,2),
    maximum_discount DECIMAL(10,2),
    valid_days INTEGER DEFAULT 30, -- Days from profile completion
    terms_and_conditions TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_coupon_value_positive CHECK (coupon_value > 0),
    CONSTRAINT chk_valid_days_positive CHECK (valid_days > 0)
);

-- Create index for efficient lookups
CREATE INDEX idx_user_profiles_profile_completed ON user_profiles(profile_completed);
CREATE INDEX idx_user_profiles_new_member_coupon_awarded ON user_profiles(new_member_coupon_awarded);
CREATE INDEX idx_new_member_coupon_settings_enabled ON new_member_coupon_settings(is_enabled);

-- Insert default new member coupon setting
INSERT INTO new_member_coupon_settings (
    coupon_code,
    coupon_name,
    coupon_description,
    coupon_type,
    coupon_value,
    valid_days,
    terms_and_conditions
) VALUES (
    'NEWMEMBER20',
    'New Member Welcome Coupon',
    'Welcome! Complete your profile to get 20% off your first stay.',
    'percentage',
    20.00,
    30,
    'Valid for 30 days from profile completion. Cannot be combined with other offers. Minimum stay of 1 night required.'
);

-- Add comments for documentation
COMMENT ON COLUMN user_profiles.gender IS 'User gender (male, female, other, prefer_not_to_say)';
COMMENT ON COLUMN user_profiles.occupation IS 'User occupation/profession';
COMMENT ON COLUMN user_profiles.interests IS 'Array of user interests/hobbies';
COMMENT ON COLUMN user_profiles.profile_completed IS 'Flag indicating if basic profile info is complete';
COMMENT ON COLUMN user_profiles.profile_completed_at IS 'Timestamp when profile was first completed';
COMMENT ON COLUMN user_profiles.new_member_coupon_awarded IS 'Flag indicating if new member coupon was awarded';
COMMENT ON COLUMN user_profiles.new_member_coupon_awarded_at IS 'Timestamp when new member coupon was awarded';

COMMENT ON TABLE new_member_coupon_settings IS 'Configuration for new member welcome coupons';