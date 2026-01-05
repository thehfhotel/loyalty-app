import { query, getClient } from '../config/database';
import { logger } from '../utils/logger';
import { sanitizeLogValue, sanitizeUserId } from '../utils/logSanitizer';
import { AppError } from '../middleware/errorHandler';
import { loyaltyService } from './loyaltyService';

// Types
export interface RoomType {
  id: string;
  name: string;
  description: string | null;
  pricePerNight: number;
  maxGuests: number;
  bedType: string | null;
  amenities: string[];
  images: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Room {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  floor: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Joined fields
  roomTypeName?: string;
}

export interface BlockedDate {
  id: string;
  roomId: string;
  blockedDate: Date;
  reason: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface Booking {
  id: string;
  userId: string;
  roomId: string;
  roomTypeId: string;
  checkInDate: Date;
  checkOutDate: Date;
  numGuests: number;
  totalPrice: number;
  pointsEarned: number;
  status: 'confirmed' | 'cancelled' | 'completed';
  cancelledAt: Date | null;
  cancellationReason: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined fields
  roomNumber?: string;
  roomTypeName?: string;
  userEmail?: string;
  userName?: string;
}

export interface CreateRoomTypeInput {
  name: string;
  description?: string;
  pricePerNight: number;
  maxGuests?: number;
  bedType?: string;
  amenities?: string[];
  images?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateRoomTypeInput {
  name?: string;
  description?: string;
  pricePerNight?: number;
  maxGuests?: number;
  bedType?: string;
  amenities?: string[];
  images?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateRoomInput {
  roomTypeId: string;
  roomNumber: string;
  floor?: number;
  notes?: string;
  isActive?: boolean;
}

export interface UpdateRoomInput {
  roomTypeId?: string;
  roomNumber?: string;
  floor?: number;
  notes?: string;
  isActive?: boolean;
}

export interface CreateBookingInput {
  roomTypeId: string;
  checkInDate: Date;
  checkOutDate: Date;
  numGuests: number;
  notes?: string;
}

export interface BookingFilters {
  status?: string;
  userId?: string;
  roomTypeId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface RoomTypeWithAvailability extends RoomType {
  availableRooms: number;
  totalRooms: number;
}

export class BookingService {
  // ==================== ROOM TYPES ====================

  async getRoomTypes(includeInactive = false): Promise<RoomType[]> {
    try {
      const whereClause = includeInactive ? '' : 'WHERE is_active = true';
      const result = await query<RoomType>(
        `SELECT
          id, name, description,
          price_per_night as "pricePerNight",
          max_guests as "maxGuests",
          bed_type as "bedType",
          amenities, images,
          is_active as "isActive",
          sort_order as "sortOrder",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM room_types
        ${whereClause}
        ORDER BY sort_order ASC, name ASC`
      );
      return result;
    } catch (error) {
      logger.error('Error fetching room types:', error);
      throw new AppError(500, 'Failed to fetch room types');
    }
  }

  async getRoomType(id: string): Promise<RoomType | null> {
    try {
      const [roomType] = await query<RoomType>(
        `SELECT
          id, name, description,
          price_per_night as "pricePerNight",
          max_guests as "maxGuests",
          bed_type as "bedType",
          amenities, images,
          is_active as "isActive",
          sort_order as "sortOrder",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM room_types
        WHERE id = $1`,
        [id]
      );
      return roomType ?? null;
    } catch (error) {
      logger.error('Error fetching room type:', error);
      throw new AppError(500, 'Failed to fetch room type');
    }
  }

  async createRoomType(data: CreateRoomTypeInput): Promise<RoomType> {
    try {
      const [roomType] = await query<RoomType>(
        `INSERT INTO room_types (
          name, description, price_per_night, max_guests, bed_type,
          amenities, images, is_active, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          id, name, description,
          price_per_night as "pricePerNight",
          max_guests as "maxGuests",
          bed_type as "bedType",
          amenities, images,
          is_active as "isActive",
          sort_order as "sortOrder",
          created_at as "createdAt",
          updated_at as "updatedAt"`,
        [
          data.name,
          data.description ?? null,
          data.pricePerNight,
          data.maxGuests ?? 2,
          data.bedType ?? null,
          JSON.stringify(data.amenities ?? []),
          JSON.stringify(data.images ?? []),
          data.isActive ?? true,
          data.sortOrder ?? 0
        ]
      );

      if (!roomType) {
        throw new AppError(500, 'Failed to create room type');
      }

      logger.info(`Room type created: ${sanitizeLogValue(roomType.name)}`);
      return roomType;
    } catch (error) {
      logger.error('Error creating room type:', error);
      throw error;
    }
  }

  async updateRoomType(id: string, data: UpdateRoomTypeInput): Promise<RoomType> {
    try {
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(data.description);
      }
      if (data.pricePerNight !== undefined) {
        updates.push(`price_per_night = $${paramIndex++}`);
        values.push(data.pricePerNight);
      }
      if (data.maxGuests !== undefined) {
        updates.push(`max_guests = $${paramIndex++}`);
        values.push(data.maxGuests);
      }
      if (data.bedType !== undefined) {
        updates.push(`bed_type = $${paramIndex++}`);
        values.push(data.bedType);
      }
      if (data.amenities !== undefined) {
        updates.push(`amenities = $${paramIndex++}`);
        values.push(JSON.stringify(data.amenities));
      }
      if (data.images !== undefined) {
        updates.push(`images = $${paramIndex++}`);
        values.push(JSON.stringify(data.images));
      }
      if (data.isActive !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(data.isActive);
      }
      if (data.sortOrder !== undefined) {
        updates.push(`sort_order = $${paramIndex++}`);
        values.push(data.sortOrder);
      }

      if (updates.length === 0) {
        const existing = await this.getRoomType(id);
        if (!existing) {
          throw new AppError(404, 'Room type not found');
        }
        return existing;
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const [roomType] = await query<RoomType>(
        `UPDATE room_types SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING
          id, name, description,
          price_per_night as "pricePerNight",
          max_guests as "maxGuests",
          bed_type as "bedType",
          amenities, images,
          is_active as "isActive",
          sort_order as "sortOrder",
          created_at as "createdAt",
          updated_at as "updatedAt"`,
        values
      );

      if (!roomType) {
        throw new AppError(404, 'Room type not found');
      }

      logger.info(`Room type updated: ${sanitizeLogValue(roomType.name)}`);
      return roomType;
    } catch (error) {
      logger.error('Error updating room type:', error);
      throw error;
    }
  }

  async deleteRoomType(id: string): Promise<boolean> {
    try {
      // Check if there are rooms using this type
      const [roomCount] = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM rooms WHERE room_type_id = $1',
        [id]
      );

      if (roomCount && parseInt(roomCount.count) > 0) {
        throw new AppError(400, 'Cannot delete room type with existing rooms');
      }

      const result = await query(
        'DELETE FROM room_types WHERE id = $1',
        [id]
      );

      // Check if any row was affected - result is an array from query
      if (!result || result.length === 0) {
        // For DELETE, we need to check rowCount differently
        const checkResult = await query<{ exists: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM room_types WHERE id = $1) as exists',
          [id]
        );
        if (!checkResult[0]?.exists) {
          logger.info(`Room type deleted: ${sanitizeLogValue(id)}`);
          return true;
        }
      }

      logger.info(`Room type deleted: ${sanitizeLogValue(id)}`);
      return true;
    } catch (error) {
      logger.error('Error deleting room type:', error);
      throw error;
    }
  }

  // ==================== ROOMS ====================

  async getRooms(roomTypeId?: string, includeInactive = false): Promise<Room[]> {
    try {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (roomTypeId) {
        conditions.push(`r.room_type_id = $${paramIndex++}`);
        values.push(roomTypeId);
      }
      if (!includeInactive) {
        conditions.push('r.is_active = true');
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await query<Room>(
        `SELECT
          r.id, r.room_type_id as "roomTypeId", r.room_number as "roomNumber",
          r.floor, r.notes, r.is_active as "isActive",
          r.created_at as "createdAt", r.updated_at as "updatedAt",
          rt.name as "roomTypeName"
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        ${whereClause}
        ORDER BY r.room_number ASC`,
        values
      );
      return result;
    } catch (error) {
      logger.error('Error fetching rooms:', error);
      throw new AppError(500, 'Failed to fetch rooms');
    }
  }

  async getRoom(id: string): Promise<Room | null> {
    try {
      const [room] = await query<Room>(
        `SELECT
          r.id, r.room_type_id as "roomTypeId", r.room_number as "roomNumber",
          r.floor, r.notes, r.is_active as "isActive",
          r.created_at as "createdAt", r.updated_at as "updatedAt",
          rt.name as "roomTypeName"
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1`,
        [id]
      );
      return room ?? null;
    } catch (error) {
      logger.error('Error fetching room:', error);
      throw new AppError(500, 'Failed to fetch room');
    }
  }

  async createRoom(data: CreateRoomInput): Promise<Room> {
    try {
      // Check if room type exists
      const roomType = await this.getRoomType(data.roomTypeId);
      if (!roomType) {
        throw new AppError(404, 'Room type not found');
      }

      // Check if room number already exists
      const [existing] = await query<{ id: string }>(
        'SELECT id FROM rooms WHERE room_number = $1',
        [data.roomNumber]
      );
      if (existing) {
        throw new AppError(409, 'Room number already exists');
      }

      const [room] = await query<Room>(
        `INSERT INTO rooms (room_type_id, room_number, floor, notes, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id, room_type_id as "roomTypeId", room_number as "roomNumber",
          floor, notes, is_active as "isActive",
          created_at as "createdAt", updated_at as "updatedAt"`,
        [
          data.roomTypeId,
          data.roomNumber,
          data.floor ?? null,
          data.notes ?? null,
          data.isActive ?? true
        ]
      );

      if (!room) {
        throw new AppError(500, 'Failed to create room');
      }

      logger.info(`Room created: ${sanitizeLogValue(room.roomNumber)}`);
      return { ...room, roomTypeName: roomType.name };
    } catch (error) {
      logger.error('Error creating room:', error);
      throw error;
    }
  }

  async updateRoom(id: string, data: UpdateRoomInput): Promise<Room> {
    try {
      // Check if new room number already exists (if changing)
      if (data.roomNumber) {
        const [existing] = await query<{ id: string }>(
          'SELECT id FROM rooms WHERE room_number = $1 AND id != $2',
          [data.roomNumber, id]
        );
        if (existing) {
          throw new AppError(409, 'Room number already exists');
        }
      }

      // Check if room type exists (if changing)
      if (data.roomTypeId) {
        const roomType = await this.getRoomType(data.roomTypeId);
        if (!roomType) {
          throw new AppError(404, 'Room type not found');
        }
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (data.roomTypeId !== undefined) {
        updates.push(`room_type_id = $${paramIndex++}`);
        values.push(data.roomTypeId);
      }
      if (data.roomNumber !== undefined) {
        updates.push(`room_number = $${paramIndex++}`);
        values.push(data.roomNumber);
      }
      if (data.floor !== undefined) {
        updates.push(`floor = $${paramIndex++}`);
        values.push(data.floor);
      }
      if (data.notes !== undefined) {
        updates.push(`notes = $${paramIndex++}`);
        values.push(data.notes);
      }
      if (data.isActive !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(data.isActive);
      }

      if (updates.length === 0) {
        const existing = await this.getRoom(id);
        if (!existing) {
          throw new AppError(404, 'Room not found');
        }
        return existing;
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const [room] = await query<Room>(
        `UPDATE rooms SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING
          id, room_type_id as "roomTypeId", room_number as "roomNumber",
          floor, notes, is_active as "isActive",
          created_at as "createdAt", updated_at as "updatedAt"`,
        values
      );

      if (!room) {
        throw new AppError(404, 'Room not found');
      }

      logger.info(`Room updated: ${sanitizeLogValue(room.roomNumber)}`);
      return room;
    } catch (error) {
      logger.error('Error updating room:', error);
      throw error;
    }
  }

  async deleteRoom(id: string): Promise<boolean> {
    try {
      // Check if there are bookings for this room
      const [bookingCount] = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM bookings
        WHERE room_id = $1 AND status = 'confirmed' AND check_out_date >= CURRENT_DATE`,
        [id]
      );

      if (bookingCount && parseInt(bookingCount.count) > 0) {
        throw new AppError(400, 'Cannot delete room with active bookings');
      }

      await query('DELETE FROM rooms WHERE id = $1', [id]);
      logger.info(`Room deleted: ${sanitizeLogValue(id)}`);
      return true;
    } catch (error) {
      logger.error('Error deleting room:', error);
      throw error;
    }
  }

  // ==================== AVAILABILITY ====================

  async getBlockedDates(roomId: string, startDate: Date, endDate: Date): Promise<BlockedDate[]> {
    try {
      const result = await query<BlockedDate>(
        `SELECT
          id, room_id as "roomId", blocked_date as "blockedDate",
          reason, created_by as "createdBy", created_at as "createdAt"
        FROM room_blocked_dates
        WHERE room_id = $1 AND blocked_date >= $2 AND blocked_date <= $3
        ORDER BY blocked_date ASC`,
        [roomId, startDate, endDate]
      );
      return result;
    } catch (error) {
      logger.error('Error fetching blocked dates:', error);
      throw new AppError(500, 'Failed to fetch blocked dates');
    }
  }

  async blockDates(roomId: string, dates: Date[], reason: string, adminId: string): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      for (const date of dates) {
        await client.query(
          `INSERT INTO room_blocked_dates (room_id, blocked_date, reason, created_by)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (room_id, blocked_date) DO UPDATE SET reason = $3`,
          [roomId, date, reason, adminId]
        );
      }

      await client.query('COMMIT');
      logger.info(`Blocked ${dates.length} dates for room ${sanitizeLogValue(roomId)} by ${sanitizeUserId(adminId)}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error blocking dates:', error);
      throw new AppError(500, 'Failed to block dates');
    } finally {
      client.release();
    }
  }

  async unblockDates(roomId: string, dates: Date[]): Promise<void> {
    try {
      await query(
        `DELETE FROM room_blocked_dates
        WHERE room_id = $1 AND blocked_date = ANY($2::date[])`,
        [roomId, dates]
      );
      logger.info(`Unblocked ${dates.length} dates for room ${sanitizeLogValue(roomId)}`);
    } catch (error) {
      logger.error('Error unblocking dates:', error);
      throw new AppError(500, 'Failed to unblock dates');
    }
  }

  async getAvailableRooms(roomTypeId: string, checkIn: Date, checkOut: Date): Promise<Room[]> {
    try {
      // Get all active rooms of this type that are not blocked or booked for the date range
      const result = await query<Room>(
        `SELECT
          r.id, r.room_type_id as "roomTypeId", r.room_number as "roomNumber",
          r.floor, r.notes, r.is_active as "isActive",
          r.created_at as "createdAt", r.updated_at as "updatedAt",
          rt.name as "roomTypeName"
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.room_type_id = $1
          AND r.is_active = true
          AND rt.is_active = true
          AND r.id NOT IN (
            -- Exclude rooms with blocked dates in the range
            SELECT DISTINCT room_id FROM room_blocked_dates
            WHERE blocked_date >= $2 AND blocked_date < $3
          )
          AND r.id NOT IN (
            -- Exclude rooms with existing bookings in the range
            SELECT DISTINCT room_id FROM bookings
            WHERE status = 'confirmed'
              AND check_in_date < $3
              AND check_out_date > $2
          )
        ORDER BY r.room_number ASC`,
        [roomTypeId, checkIn, checkOut]
      );
      return result;
    } catch (error) {
      logger.error('Error fetching available rooms:', error);
      throw new AppError(500, 'Failed to fetch available rooms');
    }
  }

  async getRoomTypesWithAvailability(checkIn: Date, checkOut: Date): Promise<RoomTypeWithAvailability[]> {
    try {
      const result = await query<RoomTypeWithAvailability>(
        `SELECT
          rt.id, rt.name, rt.description,
          rt.price_per_night as "pricePerNight",
          rt.max_guests as "maxGuests",
          rt.bed_type as "bedType",
          rt.amenities, rt.images,
          rt.is_active as "isActive",
          rt.sort_order as "sortOrder",
          rt.created_at as "createdAt",
          rt.updated_at as "updatedAt",
          COUNT(r.id) FILTER (WHERE r.is_active = true) as "totalRooms",
          COUNT(r.id) FILTER (
            WHERE r.is_active = true
              AND r.id NOT IN (
                SELECT DISTINCT room_id FROM room_blocked_dates
                WHERE blocked_date >= $1 AND blocked_date < $2
              )
              AND r.id NOT IN (
                SELECT DISTINCT room_id FROM bookings
                WHERE status = 'confirmed'
                  AND check_in_date < $2
                  AND check_out_date > $1
              )
          ) as "availableRooms"
        FROM room_types rt
        LEFT JOIN rooms r ON rt.id = r.room_type_id
        WHERE rt.is_active = true
        GROUP BY rt.id
        ORDER BY rt.sort_order ASC, rt.name ASC`,
        [checkIn, checkOut]
      );

      return result.map(r => ({
        ...r,
        totalRooms: parseInt(String(r.totalRooms)) || 0,
        availableRooms: parseInt(String(r.availableRooms)) || 0
      }));
    } catch (error) {
      logger.error('Error fetching room types with availability:', error);
      throw new AppError(500, 'Failed to fetch room types');
    }
  }

  // ==================== BOOKINGS ====================

  async createBooking(userId: string, data: CreateBookingInput): Promise<Booking> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Get room type
      const roomType = await this.getRoomType(data.roomTypeId);
      if (!roomType) {
        throw new AppError(404, 'Room type not found');
      }

      // Check max guests
      if (data.numGuests > roomType.maxGuests) {
        throw new AppError(400, `Maximum ${roomType.maxGuests} guests allowed for this room type`);
      }

      // Get available rooms
      const availableRooms = await this.getAvailableRooms(data.roomTypeId, data.checkInDate, data.checkOutDate);
      if (availableRooms.length === 0) {
        throw new AppError(400, 'No rooms available for the selected dates');
      }

      // Pick the first available room (safe - we checked length > 0 above)
      const room = availableRooms[0]!;

      // Calculate price and points
      const nights = Math.ceil((data.checkOutDate.getTime() - data.checkInDate.getTime()) / (1000 * 60 * 60 * 24));
      const totalPrice = nights * roomType.pricePerNight;
      const pointsEarned = Math.floor(totalPrice * 10); // Same as spending: 10 points per THB

      // Create booking
      const [booking] = await client.query<Booking>(
        `INSERT INTO bookings (
          user_id, room_id, room_type_id, check_in_date, check_out_date,
          num_guests, total_price, points_earned, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          id, user_id as "userId", room_id as "roomId", room_type_id as "roomTypeId",
          check_in_date as "checkInDate", check_out_date as "checkOutDate",
          num_guests as "numGuests", total_price as "totalPrice",
          points_earned as "pointsEarned", status,
          cancelled_at as "cancelledAt", cancellation_reason as "cancellationReason",
          notes, created_at as "createdAt", updated_at as "updatedAt"`,
        [
          userId,
          room.id,
          data.roomTypeId,
          data.checkInDate,
          data.checkOutDate,
          data.numGuests,
          totalPrice,
          pointsEarned,
          data.notes ?? null
        ]
      ).then(res => res.rows);

      if (!booking) {
        throw new AppError(500, 'Failed to create booking');
      }

      // Award loyalty points
      try {
        await loyaltyService.awardPoints(
          userId,
          pointsEarned,
          `Room booking: ${roomType.name} (${nights} nights)`,
          `BOOKING-${booking.id}`
        );
      } catch (error) {
        logger.error('Failed to award points for booking:', error);
        // Don't fail the booking if points fail
      }

      await client.query('COMMIT');

      logger.info(`Booking created: ${sanitizeLogValue(booking.id)} by user ${sanitizeUserId(userId)}`);
      return {
        ...booking,
        roomNumber: room.roomNumber,
        roomTypeName: roomType.name
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating booking:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserBookings(userId: string): Promise<Booking[]> {
    try {
      const result = await query<Booking>(
        `SELECT
          b.id, b.user_id as "userId", b.room_id as "roomId", b.room_type_id as "roomTypeId",
          b.check_in_date as "checkInDate", b.check_out_date as "checkOutDate",
          b.num_guests as "numGuests", b.total_price as "totalPrice",
          b.points_earned as "pointsEarned", b.status,
          b.cancelled_at as "cancelledAt", b.cancellation_reason as "cancellationReason",
          b.notes, b.created_at as "createdAt", b.updated_at as "updatedAt",
          r.room_number as "roomNumber",
          rt.name as "roomTypeName"
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON b.room_type_id = rt.id
        WHERE b.user_id = $1
        ORDER BY b.check_in_date DESC`,
        [userId]
      );
      return result;
    } catch (error) {
      logger.error('Error fetching user bookings:', error);
      throw new AppError(500, 'Failed to fetch bookings');
    }
  }

  async getBooking(id: string): Promise<Booking | null> {
    try {
      const [booking] = await query<Booking>(
        `SELECT
          b.id, b.user_id as "userId", b.room_id as "roomId", b.room_type_id as "roomTypeId",
          b.check_in_date as "checkInDate", b.check_out_date as "checkOutDate",
          b.num_guests as "numGuests", b.total_price as "totalPrice",
          b.points_earned as "pointsEarned", b.status,
          b.cancelled_at as "cancelledAt", b.cancellation_reason as "cancellationReason",
          b.notes, b.created_at as "createdAt", b.updated_at as "updatedAt",
          r.room_number as "roomNumber",
          rt.name as "roomTypeName"
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON b.room_type_id = rt.id
        WHERE b.id = $1`,
        [id]
      );
      return booking ?? null;
    } catch (error) {
      logger.error('Error fetching booking:', error);
      throw new AppError(500, 'Failed to fetch booking');
    }
  }

  async cancelBooking(bookingId: string, userId: string, reason?: string): Promise<Booking> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Get booking
      const booking = await this.getBooking(bookingId);
      if (!booking) {
        throw new AppError(404, 'Booking not found');
      }

      // Check ownership
      if (booking.userId !== userId) {
        throw new AppError(403, 'You can only cancel your own bookings');
      }

      // Check if already cancelled
      if (booking.status === 'cancelled') {
        throw new AppError(400, 'Booking is already cancelled');
      }

      // Check if check-in date has passed
      if (new Date(booking.checkInDate) <= new Date()) {
        throw new AppError(400, 'Cannot cancel a booking after check-in date');
      }

      // Update booking status
      const [updated] = await client.query<Booking>(
        `UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = CURRENT_TIMESTAMP,
            cancellation_reason = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING
          id, user_id as "userId", room_id as "roomId", room_type_id as "roomTypeId",
          check_in_date as "checkInDate", check_out_date as "checkOutDate",
          num_guests as "numGuests", total_price as "totalPrice",
          points_earned as "pointsEarned", status,
          cancelled_at as "cancelledAt", cancellation_reason as "cancellationReason",
          notes, created_at as "createdAt", updated_at as "updatedAt"`,
        [bookingId, reason ?? null]
      ).then(res => res.rows);

      if (!updated) {
        throw new AppError(500, 'Failed to cancel booking');
      }

      // Deduct loyalty points
      if (booking.pointsEarned > 0) {
        try {
          await loyaltyService.deductPoints(
            userId,
            booking.pointsEarned,
            `Booking cancelled: ${booking.roomTypeName}`
          );
        } catch (error) {
          logger.error('Failed to deduct points for cancelled booking:', error);
          // Don't fail the cancellation if points deduction fails
        }
      }

      await client.query('COMMIT');

      logger.info(`Booking cancelled: ${sanitizeLogValue(bookingId)} by user ${sanitizeUserId(userId)}`);
      return {
        ...updated,
        roomNumber: booking.roomNumber,
        roomTypeName: booking.roomTypeName
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error cancelling booking:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAdminBookings(filters?: BookingFilters): Promise<{ bookings: Booking[]; total: number }> {
    try {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (filters?.status) {
        conditions.push(`b.status = $${paramIndex++}`);
        values.push(filters.status);
      }
      if (filters?.userId) {
        conditions.push(`b.user_id = $${paramIndex++}`);
        values.push(filters.userId);
      }
      if (filters?.roomTypeId) {
        conditions.push(`b.room_type_id = $${paramIndex++}`);
        values.push(filters.roomTypeId);
      }
      if (filters?.fromDate) {
        conditions.push(`b.check_in_date >= $${paramIndex++}`);
        values.push(filters.fromDate);
      }
      if (filters?.toDate) {
        conditions.push(`b.check_out_date <= $${paramIndex++}`);
        values.push(filters.toDate);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const [countResult] = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM bookings b ${whereClause}`,
        values
      );

      // Get bookings
      const limit = filters?.limit ?? 20;
      const offset = filters?.offset ?? 0;
      values.push(limit, offset);

      const result = await query<Booking>(
        `SELECT
          b.id, b.user_id as "userId", b.room_id as "roomId", b.room_type_id as "roomTypeId",
          b.check_in_date as "checkInDate", b.check_out_date as "checkOutDate",
          b.num_guests as "numGuests", b.total_price as "totalPrice",
          b.points_earned as "pointsEarned", b.status,
          b.cancelled_at as "cancelledAt", b.cancellation_reason as "cancellationReason",
          b.notes, b.created_at as "createdAt", b.updated_at as "updatedAt",
          r.room_number as "roomNumber",
          rt.name as "roomTypeName",
          u.email as "userEmail",
          CONCAT(up.first_name, ' ', up.last_name) as "userName"
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON b.room_type_id = rt.id
        JOIN users u ON b.user_id = u.id
        LEFT JOIN user_profiles up ON b.user_id = up.user_id
        ${whereClause}
        ORDER BY b.created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        values
      );

      return {
        bookings: result,
        total: parseInt(countResult?.count ?? '0')
      };
    } catch (error) {
      logger.error('Error fetching admin bookings:', error);
      throw new AppError(500, 'Failed to fetch bookings');
    }
  }

  // Get all blocked dates for multiple rooms (for calendar view)
  async getAllBlockedDates(roomTypeId: string, startDate: Date, endDate: Date): Promise<{ roomId: string; roomNumber: string; dates: BlockedDate[] }[]> {
    try {
      const rooms = await this.getRooms(roomTypeId);
      const result = await Promise.all(
        rooms.map(async (room) => {
          const dates = await this.getBlockedDates(room.id, startDate, endDate);
          return {
            roomId: room.id,
            roomNumber: room.roomNumber,
            dates
          };
        })
      );
      return result;
    } catch (error) {
      logger.error('Error fetching all blocked dates:', error);
      throw new AppError(500, 'Failed to fetch blocked dates');
    }
  }

  // Get all bookings for rooms (for calendar view)
  async getRoomBookings(roomTypeId: string, startDate: Date, endDate: Date): Promise<Booking[]> {
    try {
      const result = await query<Booking>(
        `SELECT
          b.id, b.user_id as "userId", b.room_id as "roomId", b.room_type_id as "roomTypeId",
          b.check_in_date as "checkInDate", b.check_out_date as "checkOutDate",
          b.num_guests as "numGuests", b.total_price as "totalPrice",
          b.points_earned as "pointsEarned", b.status,
          b.cancelled_at as "cancelledAt", b.cancellation_reason as "cancellationReason",
          b.notes, b.created_at as "createdAt", b.updated_at as "updatedAt",
          r.room_number as "roomNumber",
          rt.name as "roomTypeName"
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON b.room_type_id = rt.id
        WHERE b.room_type_id = $1
          AND b.status = 'confirmed'
          AND b.check_in_date < $3
          AND b.check_out_date > $2
        ORDER BY b.check_in_date ASC`,
        [roomTypeId, startDate, endDate]
      );
      return result;
    } catch (error) {
      logger.error('Error fetching room bookings:', error);
      throw new AppError(500, 'Failed to fetch bookings');
    }
  }
}

export const bookingService = new BookingService();
