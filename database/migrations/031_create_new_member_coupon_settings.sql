-- Create new member coupon settings table
-- This table manages the configuration for new member welcome coupons

CREATE TABLE IF NOT EXISTS new_member_coupon_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    selected_coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for foreign key
CREATE INDEX IF NOT EXISTS idx_new_member_coupon_settings_coupon_id 
ON new_member_coupon_settings(selected_coupon_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_new_member_coupon_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_new_member_coupon_settings_updated_at
    BEFORE UPDATE ON new_member_coupon_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_new_member_coupon_settings_updated_at();

-- Insert default settings row (only one row should exist)
INSERT INTO new_member_coupon_settings (is_enabled, selected_coupon_id)
VALUES (FALSE, NULL)
ON CONFLICT DO NOTHING;

-- Add comment
COMMENT ON TABLE new_member_coupon_settings IS 'Configuration for new member welcome coupon system';
COMMENT ON COLUMN new_member_coupon_settings.is_enabled IS 'Whether the new member coupon system is active';
COMMENT ON COLUMN new_member_coupon_settings.selected_coupon_id IS 'The coupon to award to new members who complete their profile';