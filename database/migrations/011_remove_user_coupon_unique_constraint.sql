-- Migration to remove the unique constraint that prevents multiple coupon instances
-- This allows users to receive multiple instances of the same coupon for multiple redemptions

-- Remove the unique constraint that prevents users from having multiple instances
-- of the same coupon with the same status
ALTER TABLE user_coupons
DROP CONSTRAINT IF EXISTS user_coupons_user_id_coupon_id_status_key;

-- Add a comment to document the change
COMMENT ON TABLE user_coupons IS 'User coupon assignments. Multiple instances of the same coupon are allowed for the same user to enable multiple redemptions of campaigns.';