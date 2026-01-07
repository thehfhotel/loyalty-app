-- Payment Integration Fields
-- Migration: 20260107_add_payment_fields

-- Add payment/deposit fields to bookings table
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'deposit',  -- 'deposit' (50%) or 'full'
ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(10,2),                -- Amount to pay (50% or 100%)
ADD COLUMN IF NOT EXISTS slip_image_url TEXT,
ADD COLUMN IF NOT EXISTS slip_uploaded_at TIMESTAMPTZ,

-- SlipOK auto-verification (machine)
ADD COLUMN IF NOT EXISTS slipok_status VARCHAR(20) DEFAULT 'pending', -- pending, verified, failed, quota_exceeded
ADD COLUMN IF NOT EXISTS slipok_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS slipok_response JSONB,                       -- Store full API response

-- Admin verification (human)
ADD COLUMN IF NOT EXISTS admin_status VARCHAR(20) DEFAULT 'pending',  -- pending, verified, needs_action
ADD COLUMN IF NOT EXISTS admin_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admin_verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS admin_notes TEXT,

-- Discount
ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_reason TEXT,
ADD COLUMN IF NOT EXISTS original_total DECIMAL(10,2);

-- Audit trail table for verification history
CREATE TABLE IF NOT EXISTS booking_verification_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,           -- 'slip_uploaded', 'slipok_verified', 'admin_verified', 'slip_replaced', etc.
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for system actions (SlipOK)
  performed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  old_value JSONB,                        -- Previous state
  new_value JSONB,                        -- New state
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bookings_slipok_status ON bookings(slipok_status);
CREATE INDEX IF NOT EXISTS idx_bookings_admin_status ON bookings(admin_status);
CREATE INDEX IF NOT EXISTS idx_booking_audit_booking_id ON booking_verification_audit(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_audit_performed_at ON booking_verification_audit(performed_at);

-- Comments
COMMENT ON COLUMN bookings.payment_type IS 'Payment type: deposit (50%) or full (100%)';
COMMENT ON COLUMN bookings.slipok_status IS 'SlipOK auto-verification status: pending, verified, failed, quota_exceeded';
COMMENT ON COLUMN bookings.admin_status IS 'Admin manual verification status: pending, verified, needs_action';
COMMENT ON TABLE booking_verification_audit IS 'Audit trail for booking payment/verification changes';
