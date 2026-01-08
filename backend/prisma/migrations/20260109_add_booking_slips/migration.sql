-- Create booking_slips table for multiple slip images per booking
CREATE TABLE IF NOT EXISTS booking_slips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  slip_url TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  slipok_status VARCHAR(20) DEFAULT 'pending',
  slipok_verified_at TIMESTAMPTZ,
  slipok_response JSONB,
  admin_status VARCHAR(20) DEFAULT 'pending',
  admin_verified_at TIMESTAMPTZ,
  admin_verified_by UUID REFERENCES users(id),
  admin_notes TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_booking_slips_booking_id ON booking_slips(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_slips_uploaded_by ON booking_slips(uploaded_by);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_slips_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_slips_updated_at ON booking_slips;
CREATE TRIGGER booking_slips_updated_at
  BEFORE UPDATE ON booking_slips
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_slips_updated_at();

-- Migrate existing slip data from bookings table
-- This moves existing slips to the new table while preserving all data
INSERT INTO booking_slips (
  booking_id,
  slip_url,
  uploaded_by,
  uploaded_at,
  slipok_status,
  slipok_verified_at,
  slipok_response,
  admin_status,
  admin_verified_at,
  admin_verified_by,
  admin_notes,
  is_primary
)
SELECT
  id AS booking_id,
  slip_image_url AS slip_url,
  user_id AS uploaded_by,
  COALESCE(slip_uploaded_at, created_at) AS uploaded_at,
  COALESCE(slipok_status, 'pending') AS slipok_status,
  slipok_verified_at,
  slipok_response,
  COALESCE(admin_status, 'pending') AS admin_status,
  admin_verified_at,
  admin_verified_by,
  admin_notes,
  true AS is_primary
FROM bookings
WHERE slip_image_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- Mark old columns as deprecated (keep for backward compatibility during transition)
COMMENT ON COLUMN bookings.slip_image_url IS 'DEPRECATED: Use booking_slips table instead. This column will be removed in a future migration.';
COMMENT ON COLUMN bookings.slip_uploaded_at IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.slipok_status IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.slipok_verified_at IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.slipok_response IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.admin_status IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.admin_verified_at IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.admin_verified_by IS 'DEPRECATED: Use booking_slips table instead.';
COMMENT ON COLUMN bookings.admin_notes IS 'DEPRECATED: Use booking_slips table instead.';
