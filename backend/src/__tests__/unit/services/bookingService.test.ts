/**
 * BookingService Unit Tests
 * Tests critical booking business logic including room types, rooms, availability, and bookings
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Create mock loyaltyService instance before any imports
const mockLoyaltyService = {
  awardPoints: jest.fn(),
  deductPoints: jest.fn(),
} as { awardPoints: jest.Mock; deductPoints: jest.Mock };

// Mock dependencies BEFORE importing the service
jest.mock('../../../services/loyaltyService', () => ({
  loyaltyService: mockLoyaltyService,
}));
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

// Import after mocks are set up
import { BookingService } from '../../../services/bookingService';
import { AppError } from '../../../middleware/errorHandler';
import * as database from '../../../config/database';

describe('BookingService', () => {
  let bookingService: BookingService;
  let mockQuery: jest.MockedFunction<typeof database.query>;
  let mockGetClient: jest.MockedFunction<typeof database.getClient>;
  let mockClient: { query: jest.Mock; release: jest.Mock };

  // Mock data
  const mockRoomType = {
    id: 'room-type-1',
    name: 'Deluxe Room',
    description: 'A luxurious deluxe room',
    pricePerNight: 3500,
    maxGuests: 2,
    bedType: 'King',
    amenities: ['WiFi', 'TV', 'Mini Bar'],
    images: ['room1.jpg'],
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRoom = {
    id: 'room-1',
    roomTypeId: 'room-type-1',
    roomNumber: '101',
    floor: 1,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    roomTypeName: 'Deluxe Room',
  };

  // Use future dates for mockBooking so cancellation tests work
  const futureCheckIn = new Date();
  futureCheckIn.setDate(futureCheckIn.getDate() + 30);
  const futureCheckOut = new Date();
  futureCheckOut.setDate(futureCheckOut.getDate() + 32);

  const mockBooking = {
    id: 'booking-1',
    userId: 'user-1',
    roomId: 'room-1',
    roomTypeId: 'room-type-1',
    checkInDate: futureCheckIn,
    checkOutDate: futureCheckOut,
    numGuests: 2,
    totalPrice: 7000,
    pointsEarned: 70000,
    status: 'confirmed' as const,
    cancelledAt: null,
    cancellationReason: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    roomNumber: '101',
    roomTypeName: 'Deluxe Room',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bookingService = new BookingService();

    // Setup mock query
    mockQuery = database.query as jest.MockedFunction<typeof database.query>;
    mockQuery.mockResolvedValue([] as never);

    // Setup mock client for transactions
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] } as never),
      release: jest.fn(),
    };
    mockGetClient = database.getClient as jest.MockedFunction<typeof database.getClient>;
    mockGetClient.mockResolvedValue(mockClient as never);

    // Setup mock loyaltyService default return values
    mockLoyaltyService.awardPoints.mockResolvedValue('txn-1' as never);
    mockLoyaltyService.deductPoints.mockResolvedValue('txn-2' as never);
  });

  // ==================== ROOM TYPES ====================

  describe('Room Types', () => {
    describe('getRoomTypes', () => {
      it('should return only active room types by default', async () => {
        const mockRoomTypes = [mockRoomType];
        mockQuery.mockResolvedValueOnce(mockRoomTypes as never);

        const result = await bookingService.getRoomTypes();

        expect(result).toEqual(mockRoomTypes);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('WHERE is_active = true'),
        );
      });

      it('should return all room types when includeInactive is true', async () => {
        const inactiveRoomType = { ...mockRoomType, id: 'room-type-2', isActive: false };
        mockQuery.mockResolvedValueOnce([mockRoomType, inactiveRoomType] as never);

        const result = await bookingService.getRoomTypes(true);

        expect(result).toHaveLength(2);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.not.stringContaining('WHERE is_active = true'),
        );
      });

      it('should order room types by sort order and name', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);

        await bookingService.getRoomTypes();

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY sort_order ASC, name ASC'),
        );
      });

      it('should throw AppError on database error', async () => {
        mockQuery.mockRejectedValueOnce(new Error('Database error') as never);

        await expect(bookingService.getRoomTypes()).rejects.toMatchObject({
          statusCode: 500,
          message: 'Failed to fetch room types',
        });
      });
    });

    describe('getRoomType', () => {
      it('should return room type by id', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);

        const result = await bookingService.getRoomType('room-type-1');

        expect(result).toEqual(mockRoomType);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('WHERE id = $1'),
          ['room-type-1'],
        );
      });

      it('should return null if room type not found', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await bookingService.getRoomType('non-existent');

        expect(result).toBeNull();
      });

      it('should throw AppError on database error', async () => {
        mockQuery.mockRejectedValueOnce(new Error('Database error') as never);

        await expect(bookingService.getRoomType('room-type-1')).rejects.toThrow(AppError);
      });
    });

    describe('createRoomType', () => {
      it('should create room type with all fields', async () => {
        const input = {
          name: 'Suite',
          description: 'Luxury suite',
          pricePerNight: 5000,
          maxGuests: 4,
          bedType: 'King',
          amenities: ['Jacuzzi', 'View'],
          images: ['suite.jpg'],
          isActive: true,
          sortOrder: 2,
        };
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, ...input }] as never);

        const result = await bookingService.createRoomType(input);

        expect(result.name).toBe('Suite');
        expect(result.pricePerNight).toBe(5000);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO room_types'),
          expect.arrayContaining([
            'Suite',
            'Luxury suite',
            5000,
            4,
            'King',
            JSON.stringify(['Jacuzzi', 'View']),
            JSON.stringify(['suite.jpg']),
            true,
            2,
          ]),
        );
      });

      it('should use default values for optional fields', async () => {
        const input = {
          name: 'Standard Room',
          pricePerNight: 2000,
        };
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, ...input, maxGuests: 2 }] as never);

        await bookingService.createRoomType(input);

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO room_types'),
          expect.arrayContaining([
            'Standard Room',
            null,
            2000,
            2, // default maxGuests
            null, // default bedType
            '[]', // default amenities
            '[]', // default images
            true, // default isActive
            0, // default sortOrder
          ]),
        );
      });

      it('should throw AppError if creation fails', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        await expect(
          bookingService.createRoomType({ name: 'Test', pricePerNight: 1000 }),
        ).rejects.toThrow(AppError);
      });
    });

    describe('updateRoomType', () => {
      it('should update room type fields', async () => {
        const updates = { name: 'Updated Room', pricePerNight: 4000 };
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, ...updates }] as never);

        const result = await bookingService.updateRoomType('room-type-1', updates);

        expect(result.name).toBe('Updated Room');
        expect(result.pricePerNight).toBe(4000);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE room_types SET'),
          expect.arrayContaining(['Updated Room', 4000, 'room-type-1']),
        );
      });

      it('should return existing room type if no updates provided', async () => {
        // First call for getRoomType
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);

        const result = await bookingService.updateRoomType('room-type-1', {});

        expect(result).toEqual(mockRoomType);
      });

      it('should throw AppError if room type not found', async () => {
        mockQuery.mockResolvedValueOnce([] as never); // getRoomType returns nothing

        await expect(
          bookingService.updateRoomType('non-existent', {}),
        ).rejects.toMatchObject({
          statusCode: 404,
          message: 'Room type not found',
        });
      });

      it('should update amenities as JSON', async () => {
        const updates = { amenities: ['Pool', 'Gym', 'Spa'] };
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, ...updates }] as never);

        await bookingService.updateRoomType('room-type-1', updates);

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('amenities ='),
          expect.arrayContaining([JSON.stringify(['Pool', 'Gym', 'Spa'])]),
        );
      });
    });

    describe('deleteRoomType', () => {
      it('should delete room type if no rooms exist', async () => {
        // Check for existing rooms
        mockQuery.mockResolvedValueOnce([{ count: '0' }] as never);
        // Delete room type
        mockQuery.mockResolvedValueOnce([] as never);
        // Check if exists after delete
        mockQuery.mockResolvedValueOnce([{ exists: false }] as never);

        const result = await bookingService.deleteRoomType('room-type-1');

        expect(result).toBe(true);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM room_types'),
          ['room-type-1'],
        );
      });

      it('should throw error if rooms exist for this type', async () => {
        mockQuery.mockResolvedValueOnce([{ count: '5' }] as never);

        await expect(bookingService.deleteRoomType('room-type-1')).rejects.toMatchObject({
          statusCode: 400,
          message: 'Cannot delete room type with existing rooms',
        });
      });
    });
  });

  // ==================== ROOMS ====================

  describe('Rooms', () => {
    describe('getRooms', () => {
      it('should return only active rooms by default', async () => {
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        const result = await bookingService.getRooms();

        expect(result).toEqual([mockRoom]);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('r.is_active = true'),
          [],
        );
      });

      it('should filter by room type id', async () => {
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        await bookingService.getRooms('room-type-1');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('r.room_type_id = $1'),
          ['room-type-1'],
        );
      });

      it('should include inactive rooms when requested', async () => {
        const inactiveRoom = { ...mockRoom, id: 'room-2', isActive: false };
        mockQuery.mockResolvedValueOnce([mockRoom, inactiveRoom] as never);

        const result = await bookingService.getRooms(undefined, true);

        expect(result).toHaveLength(2);
      });

      it('should order rooms by room number', async () => {
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        await bookingService.getRooms();

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY r.room_number ASC'),
          expect.anything(),
        );
      });
    });

    describe('getRoom', () => {
      it('should return room by id with room type name', async () => {
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        const result = await bookingService.getRoom('room-1');

        expect(result).toEqual(mockRoom);
        expect(result?.roomTypeName).toBe('Deluxe Room');
      });

      it('should return null if room not found', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await bookingService.getRoom('non-existent');

        expect(result).toBeNull();
      });
    });

    describe('createRoom', () => {
      it('should create room successfully', async () => {
        // getRoomType
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        // Check for existing room number
        mockQuery.mockResolvedValueOnce([] as never);
        // Create room
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        const result = await bookingService.createRoom({
          roomTypeId: 'room-type-1',
          roomNumber: '101',
          floor: 1,
        });

        expect(result.roomNumber).toBe('101');
        expect(result.roomTypeName).toBe('Deluxe Room');
      });

      it('should throw error if room type not found', async () => {
        mockQuery.mockResolvedValueOnce([] as never); // getRoomType returns nothing

        await expect(
          bookingService.createRoom({
            roomTypeId: 'non-existent',
            roomNumber: '101',
          }),
        ).rejects.toMatchObject({
          statusCode: 404,
          message: 'Room type not found',
        });
      });

      it('should throw error if room number already exists', async () => {
        // getRoomType
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        // Check for existing room number - returns existing
        mockQuery.mockResolvedValueOnce([{ id: 'existing-room' }] as never);

        await expect(
          bookingService.createRoom({
            roomTypeId: 'room-type-1',
            roomNumber: '101',
          }),
        ).rejects.toMatchObject({
          statusCode: 409,
          message: 'Room number already exists',
        });
      });

      it('should use default values for optional fields', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        mockQuery.mockResolvedValueOnce([] as never);
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        await bookingService.createRoom({
          roomTypeId: 'room-type-1',
          roomNumber: '102',
        });

        expect(mockQuery).toHaveBeenLastCalledWith(
          expect.stringContaining('INSERT INTO rooms'),
          expect.arrayContaining([
            'room-type-1',
            '102',
            null, // floor
            null, // notes
            true, // isActive default
          ]),
        );
      });
    });

    describe('updateRoom', () => {
      it('should update room fields', async () => {
        const updates = { roomNumber: '201', floor: 2 };
        // Check for room number conflict
        mockQuery.mockResolvedValueOnce([] as never);
        // Update room
        mockQuery.mockResolvedValueOnce([{ ...mockRoom, ...updates }] as never);

        const result = await bookingService.updateRoom('room-1', updates);

        expect(result.roomNumber).toBe('201');
        expect(result.floor).toBe(2);
      });

      it('should throw error if new room number already exists', async () => {
        // Check for room number conflict - returns existing
        mockQuery.mockResolvedValueOnce([{ id: 'other-room' }] as never);

        await expect(
          bookingService.updateRoom('room-1', { roomNumber: '102' }),
        ).rejects.toMatchObject({
          statusCode: 409,
          message: 'Room number already exists',
        });
      });

      it('should validate new room type exists', async () => {
        // Check for room number conflict
        mockQuery.mockResolvedValueOnce([] as never);
        // getRoomType returns nothing
        mockQuery.mockResolvedValueOnce([] as never);

        await expect(
          bookingService.updateRoom('room-1', { roomTypeId: 'non-existent' }),
        ).rejects.toMatchObject({
          statusCode: 404,
          message: 'Room type not found',
        });
      });

      it('should return existing room if no updates', async () => {
        // getRoom
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        const result = await bookingService.updateRoom('room-1', {});

        expect(result).toEqual(mockRoom);
      });
    });

    describe('deleteRoom', () => {
      it('should delete room if no active bookings', async () => {
        // Check for active bookings
        mockQuery.mockResolvedValueOnce([{ count: '0' }] as never);
        // Delete room
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await bookingService.deleteRoom('room-1');

        expect(result).toBe(true);
      });

      it('should throw error if room has active bookings', async () => {
        mockQuery.mockResolvedValueOnce([{ count: '2' }] as never);

        await expect(bookingService.deleteRoom('room-1')).rejects.toMatchObject({
          statusCode: 400,
          message: 'Cannot delete room with active bookings',
        });
      });
    });
  });

  // ==================== AVAILABILITY ====================

  describe('Availability', () => {
    describe('getBlockedDates', () => {
      it('should return blocked dates for room within date range', async () => {
        const blockedDate = {
          id: 'blocked-1',
          roomId: 'room-1',
          blockedDate: new Date('2025-02-15'),
          reason: 'Maintenance',
          createdBy: 'admin-1',
          createdAt: new Date(),
        };
        mockQuery.mockResolvedValueOnce([blockedDate] as never);

        const result = await bookingService.getBlockedDates(
          'room-1',
          new Date('2025-02-01'),
          new Date('2025-02-28'),
        );

        expect(result).toEqual([blockedDate]);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('WHERE room_id = $1 AND blocked_date >= $2 AND blocked_date <= $3'),
          ['room-1', expect.any(Date), expect.any(Date)],
        );
      });

      it('should return empty array if no blocked dates', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await bookingService.getBlockedDates(
          'room-1',
          new Date('2025-02-01'),
          new Date('2025-02-28'),
        );

        expect(result).toEqual([]);
      });
    });

    describe('blockDates', () => {
      it('should block multiple dates for a room', async () => {
        const dates = [new Date('2025-02-15'), new Date('2025-02-16'), new Date('2025-02-17')];

        mockClient.query.mockResolvedValue({ rows: [] } as never);

        await bookingService.blockDates('room-1', dates, 'Maintenance', 'admin-1');

        expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        expect(mockClient.release).toHaveBeenCalled();
        // Should insert each date
        expect(mockClient.query).toHaveBeenCalledTimes(5); // BEGIN + 3 inserts + COMMIT
      });

      it('should use upsert to handle existing blocked dates', async () => {
        const dates = [new Date('2025-02-15')];
        mockClient.query.mockResolvedValue({ rows: [] } as never);

        await bookingService.blockDates('room-1', dates, 'Updated reason', 'admin-1');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('ON CONFLICT (room_id, blocked_date) DO UPDATE'),
          expect.anything(),
        );
      });

      it('should rollback on error', async () => {
        const dates = [new Date('2025-02-15')];
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockRejectedValueOnce(new Error('Insert failed') as never);

        await expect(
          bookingService.blockDates('room-1', dates, 'Reason', 'admin-1'),
        ).rejects.toThrow(AppError);

        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('unblockDates', () => {
      it('should unblock specified dates', async () => {
        const dates = [new Date('2025-02-15'), new Date('2025-02-16')];
        mockQuery.mockResolvedValueOnce([] as never);

        await bookingService.unblockDates('room-1', dates);

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM room_blocked_dates'),
          ['room-1', dates],
        );
      });

      it('should throw AppError on database error', async () => {
        mockQuery.mockRejectedValueOnce(new Error('Delete failed') as never);

        await expect(
          bookingService.unblockDates('room-1', [new Date()]),
        ).rejects.toThrow(AppError);
      });
    });

    describe('getAvailableRooms', () => {
      it('should return rooms not blocked or booked in date range', async () => {
        const availableRooms = [mockRoom, { ...mockRoom, id: 'room-2', roomNumber: '102' }];
        mockQuery.mockResolvedValueOnce(availableRooms as never);

        const result = await bookingService.getAvailableRooms(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(result).toHaveLength(2);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('r.is_active = true'),
          ['room-type-1', expect.any(Date), expect.any(Date)],
        );
      });

      it('should exclude rooms with blocked dates', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        await bookingService.getAvailableRooms(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('NOT IN'),
          expect.anything(),
        );
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('room_blocked_dates'),
          expect.anything(),
        );
      });

      it('should exclude rooms with existing bookings', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        await bookingService.getAvailableRooms(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining("status = 'confirmed'"),
          expect.anything(),
        );
      });

      it('should only return rooms of specified room type', async () => {
        mockQuery.mockResolvedValueOnce([mockRoom] as never);

        await bookingService.getAvailableRooms(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('r.room_type_id = $1'),
          ['room-type-1', expect.any(Date), expect.any(Date)],
        );
      });
    });

    describe('getRoomTypesWithAvailability', () => {
      it('should return room types with availability counts', async () => {
        const roomTypesWithAvail = [
          {
            ...mockRoomType,
            totalRooms: '5',
            availableRooms: '3',
          },
        ];
        mockQuery.mockResolvedValueOnce(roomTypesWithAvail as never);

        const result = await bookingService.getRoomTypesWithAvailability(
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(result[0]?.totalRooms).toBe(5);
        expect(result[0]?.availableRooms).toBe(3);
      });

      it('should only return active room types', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        await bookingService.getRoomTypesWithAvailability(
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('rt.is_active = true'),
          expect.anything(),
        );
      });

      it('should handle zero counts gracefully', async () => {
        const roomTypesWithZero = [
          {
            ...mockRoomType,
            totalRooms: null,
            availableRooms: null,
          },
        ];
        mockQuery.mockResolvedValueOnce(roomTypesWithZero as never);

        const result = await bookingService.getRoomTypesWithAvailability(
          new Date('2025-02-01'),
          new Date('2025-02-03'),
        );

        expect(result[0]?.totalRooms).toBe(0);
        expect(result[0]?.availableRooms).toBe(0);
      });
    });
  });

  // ==================== BOOKINGS ====================

  describe('Bookings', () => {
    describe('createBooking', () => {
      beforeEach(() => {
        // Setup default successful flow
        // getRoomType
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        // getAvailableRooms
        mockQuery.mockResolvedValueOnce([mockRoom] as never);
      });

      it('should create booking successfully', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockResolvedValueOnce({ rows: [mockBooking] } as never); // INSERT

        const input = {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 2,
        };

        const result = await bookingService.createBooking('user-1', input);

        expect(result.roomTypeName).toBe('Deluxe Room');
        expect(result.status).toBe('confirmed');
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      });

      it('should calculate correct price and points', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockResolvedValueOnce({ rows: [mockBooking] } as never);

        const input = {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'), // 2 nights
          numGuests: 2,
        };

        await bookingService.createBooking('user-1', input);

        // Price: 3500 * 2 nights = 7000
        // Points: 7000 * 10 = 70000
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO bookings'),
          expect.arrayContaining([
            'user-1',
            'room-1',
            'room-type-1',
            expect.any(Date),
            expect.any(Date),
            2,
            7000, // totalPrice
            70000, // pointsEarned
            null,
          ]),
        );
      });

      it('should award loyalty points', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [mockBooking] } as never);

        await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 2,
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'user-1',
          70000,
          expect.stringContaining('Room booking'),
          expect.stringContaining('BOOKING-'),
        );
      });

      it('should throw error if room type not found', async () => {
        // Reset mockQuery to return empty for getRoomType (room type not found)
        mockQuery.mockReset();
        mockQuery.mockResolvedValueOnce([] as never); // getRoomType returns nothing

        await expect(
          bookingService.createBooking('user-1', {
            roomTypeId: 'non-existent',
            checkInDate: new Date('2025-02-01'),
            checkOutDate: new Date('2025-02-03'),
            numGuests: 2,
          }),
        ).rejects.toMatchObject({
          statusCode: 404,
          message: 'Room type not found',
        });
      });

      it('should throw error if guests exceed max allowed', async () => {
        // Reset mockQuery for this test
        mockQuery.mockReset();
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, maxGuests: 2 }] as never);

        await expect(
          bookingService.createBooking('user-1', {
            roomTypeId: 'room-type-1',
            checkInDate: new Date('2025-02-01'),
            checkOutDate: new Date('2025-02-03'),
            numGuests: 5, // exceeds maxGuests
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          message: 'Maximum 2 guests allowed for this room type',
        });
      });

      it('should throw error if no rooms available', async () => {
        // Reset mockQuery for this test
        mockQuery.mockReset();
        mockQuery.mockResolvedValueOnce([mockRoomType] as never); // getRoomType
        mockQuery.mockResolvedValueOnce([] as never); // getAvailableRooms returns empty

        await expect(
          bookingService.createBooking('user-1', {
            roomTypeId: 'room-type-1',
            checkInDate: new Date('2025-02-01'),
            checkOutDate: new Date('2025-02-03'),
            numGuests: 2,
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          message: 'No rooms available for the selected dates',
        });
      });

      it('should rollback transaction on error', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockRejectedValueOnce(new Error('Insert failed') as never);

        await expect(
          bookingService.createBooking('user-1', {
            roomTypeId: 'room-type-1',
            checkInDate: new Date('2025-02-01'),
            checkOutDate: new Date('2025-02-03'),
            numGuests: 2,
          }),
        ).rejects.toThrow();

        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalled();
      });

      it('should not fail booking if loyalty points award fails', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [mockBooking] } as never);

        mockLoyaltyService.awardPoints.mockRejectedValueOnce(
          new Error('Points award failed') as never,
        );

        // Should not throw
        const result = await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 2,
        });

        expect(result).toBeDefined();
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      });

      it('should handle booking notes', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [{ ...mockBooking, notes: 'Special request' }] } as never);

        await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 2,
          notes: 'Special request',
        });

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO bookings'),
          expect.arrayContaining(['Special request']),
        );
      });
    });

    describe('getUserBookings', () => {
      it('should return all bookings for user', async () => {
        const bookings = [mockBooking, { ...mockBooking, id: 'booking-2' }];
        mockQuery.mockResolvedValueOnce(bookings as never);

        const result = await bookingService.getUserBookings('user-1');

        expect(result).toHaveLength(2);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('WHERE b.user_id = $1'),
          ['user-1'],
        );
      });

      it('should order bookings by check-in date descending', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getUserBookings('user-1');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY b.check_in_date DESC'),
          expect.anything(),
        );
      });

      it('should include room and room type names', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        const result = await bookingService.getUserBookings('user-1');

        expect(result[0]?.roomNumber).toBe('101');
        expect(result[0]?.roomTypeName).toBe('Deluxe Room');
      });
    });

    describe('getBooking', () => {
      it('should return booking by id', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        const result = await bookingService.getBooking('booking-1');

        expect(result).toEqual(mockBooking);
      });

      it('should return null if booking not found', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await bookingService.getBooking('non-existent');

        expect(result).toBeNull();
      });
    });

    describe('cancelBooking', () => {
      it('should cancel booking successfully', async () => {
        // getBooking
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockResolvedValueOnce({
            rows: [{ ...mockBooking, status: 'cancelled', cancelledAt: new Date() }],
          } as never);

        const result = await bookingService.cancelBooking('booking-1', 'user-1', 'Changed plans');

        expect(result.status).toBe('cancelled');
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      });

      it('should deduct loyalty points on cancellation', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({
            rows: [{ ...mockBooking, status: 'cancelled' }],
          } as never);

        await bookingService.cancelBooking('booking-1', 'user-1');

        expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
          'user-1',
          70000, // pointsEarned from mockBooking
          expect.stringContaining('Booking cancelled'),
        );
      });

      it('should throw error if booking not found', async () => {
        mockQuery.mockResolvedValueOnce([] as never);

        await expect(
          bookingService.cancelBooking('non-existent', 'user-1'),
        ).rejects.toMatchObject({
          statusCode: 404,
          message: 'Booking not found',
        });
      });

      it('should throw error if user is not the owner', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        await expect(
          bookingService.cancelBooking('booking-1', 'different-user'),
        ).rejects.toMatchObject({
          statusCode: 403,
          message: 'You can only cancel your own bookings',
        });
      });

      it('should throw error if booking is already cancelled', async () => {
        mockQuery.mockResolvedValueOnce([{ ...mockBooking, status: 'cancelled' }] as never);

        await expect(
          bookingService.cancelBooking('booking-1', 'user-1'),
        ).rejects.toMatchObject({
          statusCode: 400,
          message: 'Booking is already cancelled',
        });
      });

      it('should throw error if check-in date has passed', async () => {
        const pastBooking = {
          ...mockBooking,
          checkInDate: new Date('2020-01-01'), // Past date
        };
        mockQuery.mockResolvedValueOnce([pastBooking] as never);

        await expect(
          bookingService.cancelBooking('booking-1', 'user-1'),
        ).rejects.toMatchObject({
          statusCode: 400,
          message: 'Cannot cancel a booking after check-in date',
        });
      });

      it('should not fail cancellation if points deduction fails', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({
            rows: [{ ...mockBooking, status: 'cancelled' }],
          } as never);

        mockLoyaltyService.deductPoints.mockRejectedValueOnce(
          new Error('Deduction failed') as never,
        );

        // Should not throw
        const result = await bookingService.cancelBooking('booking-1', 'user-1');

        expect(result.status).toBe('cancelled');
      });

      it('should not deduct points if booking had zero points', async () => {
        mockQuery.mockResolvedValueOnce([{ ...mockBooking, pointsEarned: 0 }] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({
            rows: [{ ...mockBooking, status: 'cancelled', pointsEarned: 0 }],
          } as never);

        await bookingService.cancelBooking('booking-1', 'user-1');

        expect(mockLoyaltyService.deductPoints).not.toHaveBeenCalled();
      });

      it('should rollback transaction on error', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockRejectedValueOnce(new Error('Update failed') as never);

        await expect(
          bookingService.cancelBooking('booking-1', 'user-1'),
        ).rejects.toThrow();

        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('getAdminBookings', () => {
      it('should return paginated bookings with total count', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '50' }] as never) // count query
          .mockResolvedValueOnce([mockBooking] as never); // bookings query

        const result = await bookingService.getAdminBookings({ limit: 20, offset: 0 });

        expect(result.total).toBe(50);
        expect(result.bookings).toHaveLength(1);
      });

      it('should filter by status', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '10' }] as never)
          .mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getAdminBookings({ status: 'confirmed' });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('b.status = $1'),
          expect.arrayContaining(['confirmed']),
        );
      });

      it('should filter by user id', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '5' }] as never)
          .mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getAdminBookings({ userId: 'user-1' });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('b.user_id'),
          expect.arrayContaining(['user-1']),
        );
      });

      it('should filter by room type id', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '15' }] as never)
          .mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getAdminBookings({ roomTypeId: 'room-type-1' });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('b.room_type_id'),
          expect.arrayContaining(['room-type-1']),
        );
      });

      it('should filter by date range', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '8' }] as never)
          .mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getAdminBookings({
          fromDate: new Date('2025-02-01'),
          toDate: new Date('2025-02-28'),
        });

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('b.check_in_date >='),
          expect.anything(),
        );
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('b.check_out_date <='),
          expect.anything(),
        );
      });

      it('should use default pagination values', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '100' }] as never)
          .mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getAdminBookings();

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT $'),
          expect.arrayContaining([20, 0]), // default limit and offset
        );
      });

      it('should include user email and name', async () => {
        const bookingWithUser = {
          ...mockBooking,
          userEmail: 'user@example.com',
          userName: 'John Doe',
        };
        mockQuery
          .mockResolvedValueOnce([{ count: '1' }] as never)
          .mockResolvedValueOnce([bookingWithUser] as never);

        const result = await bookingService.getAdminBookings();

        expect(result.bookings[0]?.userEmail).toBe('user@example.com');
        expect(result.bookings[0]?.userName).toBe('John Doe');
      });

      it('should order by created date descending', async () => {
        mockQuery
          .mockResolvedValueOnce([{ count: '10' }] as never)
          .mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getAdminBookings();

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY b.created_at DESC'),
          expect.anything(),
        );
      });
    });

    describe('getAllBlockedDates', () => {
      it('should return blocked dates for all rooms of a type', async () => {
        const rooms = [mockRoom, { ...mockRoom, id: 'room-2', roomNumber: '102' }];
        const blockedDates = [
          {
            id: 'blocked-1',
            roomId: 'room-1',
            blockedDate: new Date('2025-02-15'),
            reason: 'Maintenance',
            createdBy: 'admin-1',
            createdAt: new Date(),
          },
        ];

        // getRooms
        mockQuery.mockResolvedValueOnce(rooms as never);
        // getBlockedDates for each room
        mockQuery.mockResolvedValueOnce(blockedDates as never);
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await bookingService.getAllBlockedDates(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-28'),
        );

        expect(result).toHaveLength(2);
        expect(result[0]?.roomId).toBe('room-1');
        expect(result[0]?.dates).toHaveLength(1);
        expect(result[1]?.roomId).toBe('room-2');
        expect(result[1]?.dates).toHaveLength(0);
      });
    });

    describe('getRoomBookings', () => {
      it('should return bookings for rooms of specified type in date range', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        const result = await bookingService.getRoomBookings(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-28'),
        );

        expect(result).toHaveLength(1);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('b.room_type_id = $1'),
          ['room-type-1', expect.any(Date), expect.any(Date)],
        );
      });

      it('should only return confirmed bookings', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getRoomBookings(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-28'),
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining("b.status = 'confirmed'"),
          expect.anything(),
        );
      });

      it('should order by check-in date ascending', async () => {
        mockQuery.mockResolvedValueOnce([mockBooking] as never);

        await bookingService.getRoomBookings(
          'room-type-1',
          new Date('2025-02-01'),
          new Date('2025-02-28'),
        );

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY b.check_in_date ASC'),
          expect.anything(),
        );
      });
    });
  });

  // ==================== EDGE CASES ====================

  describe('Edge Cases', () => {
    describe('Date Calculations', () => {
      it('should calculate nights correctly for single night stay', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        mockQuery.mockResolvedValueOnce([mockRoom] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [{ ...mockBooking, totalPrice: 3500, pointsEarned: 35000 }] } as never);

        await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-02'), // 1 night
          numGuests: 1,
        });

        // 1 night * 3500 = 3500, points = 3500 * 10 = 35000
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO bookings'),
          expect.arrayContaining([3500, 35000]),
        );
      });

      it('should handle long stay booking correctly', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        mockQuery.mockResolvedValueOnce([mockRoom] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [{ ...mockBooking, totalPrice: 35000, pointsEarned: 350000 }] } as never);

        await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-11'), // 10 nights
          numGuests: 2,
        });

        // 10 nights * 3500 = 35000, points = 35000 * 10 = 350000
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO bookings'),
          expect.arrayContaining([35000, 350000]),
        );
      });
    });

    describe('Concurrent Booking Handling', () => {
      it('should pick first available room when multiple exist', async () => {
        const rooms = [
          { ...mockRoom, id: 'room-1', roomNumber: '101' },
          { ...mockRoom, id: 'room-2', roomNumber: '102' },
        ];
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        mockQuery.mockResolvedValueOnce(rooms as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [mockBooking] } as never);

        await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 2,
        });

        // Should pick room-1 (first in list)
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO bookings'),
          expect.arrayContaining(['room-1']),
        );
      });
    });

    describe('Validation Edge Cases', () => {
      it('should allow exactly max guests', async () => {
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, maxGuests: 4 }] as never);
        mockQuery.mockResolvedValueOnce([mockRoom] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [mockBooking] } as never);

        // Should not throw - 4 guests is exactly max
        const result = await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 4,
        });

        expect(result).toBeDefined();
      });

      it('should reject one guest over max', async () => {
        mockQuery.mockResolvedValueOnce([{ ...mockRoomType, maxGuests: 4 }] as never);

        await expect(
          bookingService.createBooking('user-1', {
            roomTypeId: 'room-type-1',
            checkInDate: new Date('2025-02-01'),
            checkOutDate: new Date('2025-02-03'),
            numGuests: 5,
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          message: 'Maximum 4 guests allowed for this room type',
        });
      });
    });

    describe('Error Recovery', () => {
      it('should always release client on success', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        mockQuery.mockResolvedValueOnce([mockRoom] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockResolvedValueOnce({ rows: [mockBooking] } as never);

        await bookingService.createBooking('user-1', {
          roomTypeId: 'room-type-1',
          checkInDate: new Date('2025-02-01'),
          checkOutDate: new Date('2025-02-03'),
          numGuests: 2,
        });

        expect(mockClient.release).toHaveBeenCalled();
      });

      it('should always release client on error', async () => {
        mockQuery.mockResolvedValueOnce([mockRoomType] as never);
        mockQuery.mockResolvedValueOnce([mockRoom] as never);
        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never)
          .mockRejectedValueOnce(new Error('Database error') as never);

        await expect(
          bookingService.createBooking('user-1', {
            roomTypeId: 'room-type-1',
            checkInDate: new Date('2025-02-01'),
            checkOutDate: new Date('2025-02-03'),
            numGuests: 2,
          }),
        ).rejects.toThrow();

        expect(mockClient.release).toHaveBeenCalled();
      });
    });
  });
});
