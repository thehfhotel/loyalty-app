-- Hotel Room Booking Feature
-- Migration: 20260105_add_hotel_booking

-- Room Types (Deluxe, Suite, Standard, etc.)
CREATE TABLE IF NOT EXISTS room_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_per_night DECIMAL(10,2) NOT NULL,
  max_guests INTEGER NOT NULL DEFAULT 2,
  bed_type VARCHAR(50), -- 'single', 'double', 'twin', 'king'
  amenities JSONB DEFAULT '[]', -- ['wifi', 'tv', 'minibar', 'balcony']
  images JSONB DEFAULT '[]', -- array of image URLs
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Individual Rooms (Room 101, 102, etc.)
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  room_number VARCHAR(20) NOT NULL UNIQUE,
  floor INTEGER,
  notes TEXT, -- internal notes for staff
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Room Availability (blocked dates)
CREATE TABLE IF NOT EXISTS room_blocked_dates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason VARCHAR(100), -- 'maintenance', 'reserved', 'other'
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_id, blocked_date)
);

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  num_guests INTEGER NOT NULL DEFAULT 1,
  total_price DECIMAL(10,2) NOT NULL,
  points_earned INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'confirmed', -- 'confirmed', 'cancelled', 'completed'
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  notes TEXT, -- special requests
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_dates CHECK (check_out_date > check_in_date),
  CONSTRAINT check_guests CHECK (num_guests > 0)
);

-- Indexes for room_types
CREATE INDEX IF NOT EXISTS idx_room_types_is_active ON room_types(is_active);
CREATE INDEX IF NOT EXISTS idx_room_types_sort_order ON room_types(sort_order);

-- Indexes for rooms
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active);

-- Indexes for room_blocked_dates
CREATE INDEX IF NOT EXISTS idx_room_blocked_dates_room ON room_blocked_dates(room_id);
CREATE INDEX IF NOT EXISTS idx_room_blocked_dates_date ON room_blocked_dates(blocked_date);
CREATE INDEX IF NOT EXISTS idx_room_blocked_dates_room_date ON room_blocked_dates(room_id, blocked_date);

-- Indexes for bookings
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room_type ON bookings(room_type_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_user_status ON bookings(user_id, status);

-- Comments
COMMENT ON TABLE room_types IS 'Hotel room type definitions (Deluxe, Suite, Standard, etc.)';
COMMENT ON TABLE rooms IS 'Individual hotel rooms with room numbers';
COMMENT ON TABLE room_blocked_dates IS 'Dates when rooms are blocked/unavailable';
COMMENT ON TABLE bookings IS 'User room bookings';

COMMENT ON COLUMN room_types.amenities IS 'JSON array of amenities like ["wifi", "tv", "minibar", "balcony"]';
COMMENT ON COLUMN room_types.images IS 'JSON array of image URLs';
COMMENT ON COLUMN room_types.bed_type IS 'Type of bed: single, double, twin, king';
COMMENT ON COLUMN bookings.status IS 'Booking status: confirmed, cancelled, completed';
COMMENT ON COLUMN bookings.points_earned IS 'Loyalty points earned from this booking';
