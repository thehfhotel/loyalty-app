-- Add admin cancellation fields to hotel_bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by_admin BOOLEAN DEFAULT FALSE;
