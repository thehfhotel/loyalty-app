-- Simplify new member coupon settings table
-- Remove complex coupon creation fields and replace with simple coupon selection

-- Drop existing constraints and indexes
DROP INDEX IF EXISTS idx_new_member_coupon_settings_enabled;
ALTER TABLE new_member_coupon_settings DROP CONSTRAINT IF EXISTS chk_coupon_value_positive;
ALTER TABLE new_member_coupon_settings DROP CONSTRAINT IF EXISTS chk_valid_days_positive;
ALTER TABLE new_member_coupon_settings DROP CONSTRAINT IF EXISTS new_member_coupon_settings_created_by_fkey;

-- Remove all the complex coupon fields
ALTER TABLE new_member_coupon_settings 
DROP COLUMN IF EXISTS coupon_code,
DROP COLUMN IF EXISTS coupon_name,
DROP COLUMN IF EXISTS coupon_description,
DROP COLUMN IF EXISTS coupon_type,
DROP COLUMN IF EXISTS coupon_value,
DROP COLUMN IF EXISTS currency,
DROP COLUMN IF EXISTS minimum_spend,
DROP COLUMN IF EXISTS maximum_discount,
DROP COLUMN IF EXISTS valid_days,
DROP COLUMN IF EXISTS terms_and_conditions,
DROP COLUMN IF EXISTS created_by;

-- Add the new simple fields
ALTER TABLE new_member_coupon_settings 
ADD COLUMN IF NOT EXISTS selected_coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL;

-- Update is_enabled default to FALSE (was TRUE)
ALTER TABLE new_member_coupon_settings 
ALTER COLUMN is_enabled SET DEFAULT FALSE;

-- Create index for foreign key
CREATE INDEX IF NOT EXISTS idx_new_member_coupon_settings_coupon_id 
ON new_member_coupon_settings(selected_coupon_id);

-- Clear existing data and insert default settings
DELETE FROM new_member_coupon_settings;
INSERT INTO new_member_coupon_settings (is_enabled, selected_coupon_id)
VALUES (FALSE, NULL);

-- Update comments
COMMENT ON TABLE new_member_coupon_settings IS 'Configuration for new member welcome coupon system (simplified)';
COMMENT ON COLUMN new_member_coupon_settings.is_enabled IS 'Whether the new member coupon system is active';
COMMENT ON COLUMN new_member_coupon_settings.selected_coupon_id IS 'The coupon to award to new members who complete their profile';