-- Add points award functionality to new member settings
-- This extends the existing new member system to include points rewards

-- Add columns for points award functionality
ALTER TABLE new_member_coupon_settings 
ADD COLUMN points_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN points_amount INTEGER DEFAULT NULL;

-- Add constraints
ALTER TABLE new_member_coupon_settings 
ADD CONSTRAINT chk_points_amount_positive 
CHECK (points_amount IS NULL OR points_amount > 0);

-- Add comments for new columns
COMMENT ON COLUMN new_member_coupon_settings.points_enabled IS 'Whether to award points to new members who complete their profile';
COMMENT ON COLUMN new_member_coupon_settings.points_amount IS 'Number of points to award to new members (must be positive if points are enabled)';

-- Update table comment to reflect new functionality
COMMENT ON TABLE new_member_coupon_settings IS 'Configuration for new member welcome rewards system (coupons and points)';

-- Add index for performance (though likely not needed for single-row table)
CREATE INDEX IF NOT EXISTS idx_new_member_settings_points_enabled 
ON new_member_coupon_settings(points_enabled) 
WHERE points_enabled = TRUE;