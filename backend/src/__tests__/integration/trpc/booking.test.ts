/**
 * tRPC Booking Router Integration Tests
 * Tests all booking procedures with authentication, authorization, and error handling
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Mock objects in tests */

import { TRPCError } from '@trpc/server';
import { mockUsers, createCallerWithUser, createUnauthenticatedCaller } from './helpers';

// Mock data
const mockRoomType = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Deluxe Room',
  description: 'A luxurious deluxe room',
  pricePerNight: 3500,
  maxGuests: 2,
  bedType: 'king',
  amenities: ['wifi', 'minibar', 'tv'],
  images: ['https://example.com/room1.jpg'],
  isActive: true,
  sortOrder: 1,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockInactiveRoomType = {
  ...mockRoomType,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Standard Room',
  isActive: false,
};

const mockRoom = {
  id: '33333333-3333-3333-3333-333333333333',
  roomTypeId: mockRoomType.id,
  roomNumber: '101',
  floor: 1,
  notes: 'Corner room with view',
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  roomTypeName: 'Deluxe Room',
};

const mockBooking = {
  id: '44444444-4444-4444-4444-444444444444',
  userId: 'customer-test-id',
  roomId: mockRoom.id,
  roomTypeId: mockRoomType.id,
  checkInDate: new Date('2025-02-01'),
  checkOutDate: new Date('2025-02-03'),
  numGuests: 2,
  totalPrice: 7000,
  pointsEarned: 70000,
  status: 'confirmed' as const,
  cancelledAt: null,
  cancellationReason: null,
  notes: 'Early check-in requested',
  createdAt: new Date('2025-01-15'),
  updatedAt: new Date('2025-01-15'),
  roomNumber: '101',
  roomTypeName: 'Deluxe Room',
};

const mockBlockedDate = {
  id: '55555555-5555-5555-5555-555555555555',
  roomId: mockRoom.id,
  blockedDate: new Date('2025-03-01'),
  reason: 'Maintenance',
  createdBy: 'admin-test-id',
  createdAt: new Date('2025-01-01'),
};

const mockRoomTypeWithAvailability = {
  ...mockRoomType,
  availableRooms: 3,
  totalRooms: 5,
};

// Create mock bookingService instance
const mockBookingService = {
  getRoomTypes: jest.fn(),
  getRoomType: jest.fn(),
  createRoomType: jest.fn(),
  updateRoomType: jest.fn(),
  deleteRoomType: jest.fn(),
  getRooms: jest.fn(),
  getRoom: jest.fn(),
  createRoom: jest.fn(),
  updateRoom: jest.fn(),
  deleteRoom: jest.fn(),
  getBlockedDates: jest.fn(),
  getAllBlockedDates: jest.fn(),
  blockDates: jest.fn(),
  unblockDates: jest.fn(),
  getAvailableRooms: jest.fn(),
  getRoomTypesWithAvailability: jest.fn(),
  createBooking: jest.fn(),
  getUserBookings: jest.fn(),
  getBooking: jest.fn(),
  cancelBooking: jest.fn(),
  getAdminBookings: jest.fn(),
  getRoomBookings: jest.fn(),
  getAllBookingsForAdmin: jest.fn(),
  getBookingWithAudit: jest.fn(),
  updateBooking: jest.fn(),
  uploadSlip: jest.fn(),
  verifySlip: jest.fn(),
  adminVerifySlip: jest.fn(),
};

// Mock the bookingService before importing the router
jest.mock('../../../services/bookingService', () => ({
  bookingService: mockBookingService,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import router after mocks are set up
import { bookingRouter } from '../../../trpc/routers/booking';

describe('tRPC Booking Router - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== PUBLIC PROCEDURES ====================

  // ========== getRoomTypes Tests ==========
  describe('getRoomTypes (public)', () => {
    it('should return active room types for unauthenticated users', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypes.mockResolvedValue([mockRoomType]);

      const result = await caller.getRoomTypes();

      expect(mockBookingService.getRoomTypes).toHaveBeenCalledWith(false);
      expect(result).toEqual([mockRoomType]);
    });

    it('should return active room types for authenticated users', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getRoomTypes.mockResolvedValue([mockRoomType]);

      const result = await caller.getRoomTypes();

      expect(mockBookingService.getRoomTypes).toHaveBeenCalledWith(false);
      expect(result).toEqual([mockRoomType]);
    });

    it('should return empty array when no active room types exist', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypes.mockResolvedValue([]);

      const result = await caller.getRoomTypes();

      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypes.mockRejectedValue(new Error('Database error'));

      await expect(caller.getRoomTypes()).rejects.toThrow('Database error');
    });
  });

  // ========== getRoomType Tests ==========
  describe('getRoomType (public)', () => {
    it('should return room type by id for unauthenticated users', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomType.mockResolvedValue(mockRoomType);

      const result = await caller.getRoomType({ id: mockRoomType.id });

      expect(mockBookingService.getRoomType).toHaveBeenCalledWith(mockRoomType.id);
      expect(result).toEqual(mockRoomType);
    });

    it('should throw NOT_FOUND when room type does not exist', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomType.mockResolvedValue(null);

      await expect(
        caller.getRoomType({ id: '99999999-9999-9999-9999-999999999999' })
      ).rejects.toThrow('Room type not found');
    });

    it('should throw NOT_FOUND when room type is inactive', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomType.mockResolvedValue(mockInactiveRoomType);

      await expect(
        caller.getRoomType({ id: mockInactiveRoomType.id })
      ).rejects.toThrow('Room type not found');
    });

    it('should reject invalid UUID', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.getRoomType({ id: 'not-a-uuid' })
      ).rejects.toThrow();
    });
  });

  // ========== checkAvailability Tests ==========
  describe('checkAvailability (public)', () => {
    it('should return room types with availability for valid date range', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypesWithAvailability.mockResolvedValue([mockRoomTypeWithAvailability]);

      const checkIn = new Date('2025-02-01');
      const checkOut = new Date('2025-02-03');

      const result = await caller.checkAvailability({ checkIn, checkOut });

      expect(mockBookingService.getRoomTypesWithAvailability).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date)
      );
      expect(result).toEqual([mockRoomTypeWithAvailability]);
    });

    it('should accept string dates and coerce to Date objects', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypesWithAvailability.mockResolvedValue([mockRoomTypeWithAvailability]);

      const result = await caller.checkAvailability({
        checkIn: '2025-02-01' as any,
        checkOut: '2025-02-03' as any,
      });

      expect(mockBookingService.getRoomTypesWithAvailability).toHaveBeenCalled();
      expect(result).toEqual([mockRoomTypeWithAvailability]);
    });

    it('should reject when check-out is before check-in', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.checkAvailability({
          checkIn: new Date('2025-02-03'),
          checkOut: new Date('2025-02-01'),
        })
      ).rejects.toThrow('Check-out date must be after check-in date');
    });

    it('should reject when check-out equals check-in', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.checkAvailability({
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-01'),
        })
      ).rejects.toThrow('Check-out date must be after check-in date');
    });

    it('should handle service errors', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypesWithAvailability.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.checkAvailability({
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
        })
      ).rejects.toThrow('Database error');
    });
  });

  // ==================== PROTECTED PROCEDURES ====================

  // ========== getAvailableRooms Tests ==========
  describe('getAvailableRooms (protected)', () => {
    it('should return available rooms for authenticated user', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getAvailableRooms.mockResolvedValue([mockRoom]);

      const result = await caller.getAvailableRooms({
        roomTypeId: mockRoomType.id,
        checkIn: new Date('2025-02-01'),
        checkOut: new Date('2025-02-03'),
      });

      expect(mockBookingService.getAvailableRooms).toHaveBeenCalledWith(
        mockRoomType.id,
        expect.any(Date),
        expect.any(Date)
      );
      expect(result).toEqual([mockRoom]);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.getAvailableRooms({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getAvailableRooms({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should return empty array when no rooms available', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getAvailableRooms.mockResolvedValue([]);

      const result = await caller.getAvailableRooms({
        roomTypeId: mockRoomType.id,
        checkIn: new Date('2025-02-01'),
        checkOut: new Date('2025-02-03'),
      });

      expect(result).toEqual([]);
    });

    it('should reject invalid room type UUID', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.getAvailableRooms({
          roomTypeId: 'invalid-uuid',
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
        })
      ).rejects.toThrow();
    });
  });

  // ========== createBooking Tests ==========
  describe('createBooking (protected)', () => {
    it('should create booking for authenticated user', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.createBooking.mockResolvedValue(mockBooking);

      const result = await caller.createBooking({
        roomTypeId: mockRoomType.id,
        checkIn: new Date('2025-02-01'),
        checkOut: new Date('2025-02-03'),
        numGuests: 2,
        notes: 'Early check-in requested',
      });

      expect(mockBookingService.createBooking).toHaveBeenCalledWith(
        'customer-test-id',
        expect.objectContaining({
          roomTypeId: mockRoomType.id,
          numGuests: 2,
          notes: 'Early check-in requested',
        })
      );
      expect(result).toEqual(mockBooking);
    });

    it('should create booking without optional notes', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.createBooking.mockResolvedValue(mockBooking);

      await caller.createBooking({
        roomTypeId: mockRoomType.id,
        checkIn: new Date('2025-02-01'),
        checkOut: new Date('2025-02-03'),
        numGuests: 1,
      });

      expect(mockBookingService.createBooking).toHaveBeenCalledWith(
        'customer-test-id',
        expect.objectContaining({
          roomTypeId: mockRoomType.id,
          numGuests: 1,
        })
      );
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.createBooking({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
          numGuests: 2,
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.createBooking({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
          numGuests: 2,
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should reject when check-out is before check-in', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.createBooking({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-03'),
          checkOut: new Date('2025-02-01'),
          numGuests: 2,
        })
      ).rejects.toThrow('Check-out date must be after check-in date');
    });

    it('should reject invalid numGuests values', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.createBooking({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
          numGuests: 0,
        })
      ).rejects.toThrow();

      await expect(
        caller.createBooking({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
          numGuests: -1,
        })
      ).rejects.toThrow();
    });

    it('should handle service error when no rooms available', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const error = new Error('No rooms available for the selected dates');
      (error as any).statusCode = 400;
      mockBookingService.createBooking.mockRejectedValue(error);

      await expect(
        caller.createBooking({
          roomTypeId: mockRoomType.id,
          checkIn: new Date('2025-02-01'),
          checkOut: new Date('2025-02-03'),
          numGuests: 2,
        })
      ).rejects.toThrow('No rooms available for the selected dates');
    });
  });

  // ========== getMyBookings Tests ==========
  describe('getMyBookings (protected)', () => {
    it('should return user bookings for authenticated user', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getUserBookings.mockResolvedValue([mockBooking]);

      const result = await caller.getMyBookings();

      expect(mockBookingService.getUserBookings).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual([mockBooking]);
    });

    it('should return empty array when user has no bookings', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getUserBookings.mockResolvedValue([]);

      const result = await caller.getMyBookings();

      expect(result).toEqual([]);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(caller.getMyBookings()).rejects.toThrow(TRPCError);
      await expect(caller.getMyBookings()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getUserBookings.mockRejectedValue(new Error('Database error'));

      await expect(caller.getMyBookings()).rejects.toThrow('Database error');
    });
  });

  // ========== getBooking Tests ==========
  describe('getBooking (protected)', () => {
    it('should return booking for owner', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getBooking.mockResolvedValue(mockBooking);

      const result = await caller.getBooking({ id: mockBooking.id });

      expect(mockBookingService.getBooking).toHaveBeenCalledWith(mockBooking.id);
      expect(result).toEqual(mockBooking);
    });

    it('should return booking for admin viewing any booking', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const otherUserBooking = { ...mockBooking, userId: 'other-user-id' };
      mockBookingService.getBooking.mockResolvedValue(otherUserBooking);

      const result = await caller.getBooking({ id: mockBooking.id });

      expect(result).toEqual(otherUserBooking);
    });

    it('should throw NOT_FOUND when booking does not exist', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      mockBookingService.getBooking.mockResolvedValue(null);

      await expect(
        caller.getBooking({ id: '99999999-9999-9999-9999-999999999999' })
      ).rejects.toThrow('Booking not found');
    });

    it('should throw FORBIDDEN when user tries to view another user booking', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const otherUserBooking = { ...mockBooking, userId: 'other-user-id' };
      mockBookingService.getBooking.mockResolvedValue(otherUserBooking);

      await expect(
        caller.getBooking({ id: mockBooking.id })
      ).rejects.toThrow('Cannot view this booking');
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.getBooking({ id: mockBooking.id })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getBooking({ id: mockBooking.id })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should reject invalid UUID', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.getBooking({ id: 'not-a-uuid' })
      ).rejects.toThrow();
    });
  });

  // ========== cancelBooking Tests ==========
  describe('cancelBooking (protected)', () => {
    it('should cancel booking for owner', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const cancelledBooking = { ...mockBooking, status: 'cancelled' as const };
      mockBookingService.cancelBooking.mockResolvedValue(cancelledBooking);

      const result = await caller.cancelBooking({
        id: mockBooking.id,
        reason: 'Change of plans',
      });

      expect(mockBookingService.cancelBooking).toHaveBeenCalledWith(
        mockBooking.id,
        'customer-test-id',
        'Change of plans'
      );
      expect(result.status).toBe('cancelled');
    });

    it('should cancel booking without reason', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const cancelledBooking = { ...mockBooking, status: 'cancelled' as const };
      mockBookingService.cancelBooking.mockResolvedValue(cancelledBooking);

      await caller.cancelBooking({ id: mockBooking.id });

      expect(mockBookingService.cancelBooking).toHaveBeenCalledWith(
        mockBooking.id,
        'customer-test-id',
        undefined
      );
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.cancelBooking({ id: mockBooking.id })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.cancelBooking({ id: mockBooking.id })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service error when booking not found', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const error = new Error('Booking not found');
      (error as any).statusCode = 404;
      mockBookingService.cancelBooking.mockRejectedValue(error);

      await expect(
        caller.cancelBooking({ id: mockBooking.id })
      ).rejects.toThrow('Booking not found');
    });

    it('should handle service error when not owner', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const error = new Error('You can only cancel your own bookings');
      (error as any).statusCode = 403;
      mockBookingService.cancelBooking.mockRejectedValue(error);

      await expect(
        caller.cancelBooking({ id: mockBooking.id })
      ).rejects.toThrow('You can only cancel your own bookings');
    });

    it('should handle service error when already cancelled', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
      const error = new Error('Booking is already cancelled');
      (error as any).statusCode = 400;
      mockBookingService.cancelBooking.mockRejectedValue(error);

      await expect(
        caller.cancelBooking({ id: mockBooking.id })
      ).rejects.toThrow('Booking is already cancelled');
    });
  });

  // ==================== ADMIN PROCEDURES ====================

  // ========== admin.createRoomType Tests ==========
  describe('admin.createRoomType', () => {
    it('should create room type for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.createRoomType.mockResolvedValue(mockRoomType);

      const result = await caller.admin.createRoomType({
        name: 'Deluxe Room',
        pricePerNight: 3500,
        maxGuests: 2,
        bedType: 'king',
        amenities: ['wifi', 'minibar', 'tv'],
        images: ['https://example.com/room1.jpg'],
        isActive: true,
        sortOrder: 1,
      });

      expect(mockBookingService.createRoomType).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Deluxe Room',
        pricePerNight: 3500,
      }));
      expect(result).toEqual(mockRoomType);
    });

    it('should create room type with minimal fields', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.createRoomType.mockResolvedValue(mockRoomType);

      await caller.admin.createRoomType({
        name: 'Basic Room',
        pricePerNight: 1500,
      });

      expect(mockBookingService.createRoomType).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Basic Room',
        pricePerNight: 1500,
      }));
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);

      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to create room type', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should reject empty name', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.createRoomType({
          name: '',
          pricePerNight: 1000,
        })
      ).rejects.toThrow();
    });

    it('should reject negative price', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: -100,
        })
      ).rejects.toThrow();
    });

    it('should reject invalid bed type', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
          bedType: 'invalid' as any,
        })
      ).rejects.toThrow();
    });

    it('should accept valid bed types', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.createRoomType.mockResolvedValue(mockRoomType);

      const validBedTypes = ['single', 'double', 'twin', 'king'] as const;

      for (const bedType of validBedTypes) {
        await caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
          bedType,
        });
      }

      expect(mockBookingService.createRoomType).toHaveBeenCalledTimes(4);
    });
  });

  // ========== admin.updateRoomType Tests ==========
  describe('admin.updateRoomType', () => {
    it('should update room type for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const updatedRoomType = { ...mockRoomType, name: 'Premium Room' };
      mockBookingService.updateRoomType.mockResolvedValue(updatedRoomType);

      const result = await caller.admin.updateRoomType({
        id: mockRoomType.id,
        data: { name: 'Premium Room' },
      });

      expect(mockBookingService.updateRoomType).toHaveBeenCalledWith(
        mockRoomType.id,
        { name: 'Premium Room' }
      );
      expect(result.name).toBe('Premium Room');
    });

    it('should update multiple fields', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.updateRoomType.mockResolvedValue(mockRoomType);

      await caller.admin.updateRoomType({
        id: mockRoomType.id,
        data: {
          name: 'Premium Room',
          pricePerNight: 5000,
          isActive: false,
        },
      });

      expect(mockBookingService.updateRoomType).toHaveBeenCalledWith(
        mockRoomType.id,
        expect.objectContaining({
          name: 'Premium Room',
          pricePerNight: 5000,
          isActive: false,
        })
      );
    });

    it('should throw FORBIDDEN when customer tries to update', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.updateRoomType({
          id: mockRoomType.id,
          data: { name: 'Test' },
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should reject invalid UUID', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.updateRoomType({
          id: 'invalid-uuid',
          data: { name: 'Test' },
        })
      ).rejects.toThrow();
    });
  });

  // ========== admin.deleteRoomType Tests ==========
  describe('admin.deleteRoomType', () => {
    it('should delete room type for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.deleteRoomType.mockResolvedValue(true);

      const result = await caller.admin.deleteRoomType({ id: mockRoomType.id });

      expect(mockBookingService.deleteRoomType).toHaveBeenCalledWith(mockRoomType.id);
      expect(result).toBe(true);
    });

    it('should throw FORBIDDEN when customer tries to delete', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.deleteRoomType({ id: mockRoomType.id })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service error when room type has rooms', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const error = new Error('Cannot delete room type with existing rooms');
      (error as any).statusCode = 400;
      mockBookingService.deleteRoomType.mockRejectedValue(error);

      await expect(
        caller.admin.deleteRoomType({ id: mockRoomType.id })
      ).rejects.toThrow('Cannot delete room type with existing rooms');
    });
  });

  // ========== admin.getRoomTypes Tests ==========
  describe('admin.getRoomTypes', () => {
    it('should return all room types including inactive for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomTypes.mockResolvedValue([mockRoomType, mockInactiveRoomType]);

      const result = await caller.admin.getRoomTypes({ includeInactive: true });

      expect(mockBookingService.getRoomTypes).toHaveBeenCalledWith(true);
      expect(result).toHaveLength(2);
    });

    it('should return only active room types when includeInactive is false', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomTypes.mockResolvedValue([mockRoomType]);

      const result = await caller.admin.getRoomTypes({ includeInactive: false });

      expect(mockBookingService.getRoomTypes).toHaveBeenCalledWith(false);
      expect(result).toHaveLength(1);
    });

    it('should default to includeInactive true', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomTypes.mockResolvedValue([mockRoomType, mockInactiveRoomType]);

      await caller.admin.getRoomTypes({});

      expect(mockBookingService.getRoomTypes).toHaveBeenCalledWith(true);
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getRoomTypes({})
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getRoomType Tests ==========
  describe('admin.getRoomType', () => {
    it('should return room type by id for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomType.mockResolvedValue(mockRoomType);

      const result = await caller.admin.getRoomType({ id: mockRoomType.id });

      expect(mockBookingService.getRoomType).toHaveBeenCalledWith(mockRoomType.id);
      expect(result).toEqual(mockRoomType);
    });

    it('should return inactive room type for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomType.mockResolvedValue(mockInactiveRoomType);

      const result = await caller.admin.getRoomType({ id: mockInactiveRoomType.id });

      expect(result).toEqual(mockInactiveRoomType);
    });

    it('should throw NOT_FOUND when room type does not exist', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomType.mockResolvedValue(null);

      await expect(
        caller.admin.getRoomType({ id: '99999999-9999-9999-9999-999999999999' })
      ).rejects.toThrow('Room type not found');
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getRoomType({ id: mockRoomType.id })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.createRoom Tests ==========
  describe('admin.createRoom', () => {
    it('should create room for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.createRoom.mockResolvedValue(mockRoom);

      const result = await caller.admin.createRoom({
        roomTypeId: mockRoomType.id,
        roomNumber: '101',
        floor: 1,
        notes: 'Corner room with view',
        isActive: true,
      });

      expect(mockBookingService.createRoom).toHaveBeenCalledWith(expect.objectContaining({
        roomTypeId: mockRoomType.id,
        roomNumber: '101',
      }));
      expect(result).toEqual(mockRoom);
    });

    it('should create room with minimal fields', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.createRoom.mockResolvedValue(mockRoom);

      await caller.admin.createRoom({
        roomTypeId: mockRoomType.id,
        roomNumber: '102',
      });

      expect(mockBookingService.createRoom).toHaveBeenCalledWith(expect.objectContaining({
        roomTypeId: mockRoomType.id,
        roomNumber: '102',
      }));
    });

    it('should throw FORBIDDEN when customer tries to create room', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.createRoom({
          roomTypeId: mockRoomType.id,
          roomNumber: '101',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should reject empty room number', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.createRoom({
          roomTypeId: mockRoomType.id,
          roomNumber: '',
        })
      ).rejects.toThrow();
    });

    it('should handle service error when room number exists', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const error = new Error('Room number already exists');
      (error as any).statusCode = 409;
      mockBookingService.createRoom.mockRejectedValue(error);

      await expect(
        caller.admin.createRoom({
          roomTypeId: mockRoomType.id,
          roomNumber: '101',
        })
      ).rejects.toThrow('Room number already exists');
    });
  });

  // ========== admin.updateRoom Tests ==========
  describe('admin.updateRoom', () => {
    it('should update room for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const updatedRoom = { ...mockRoom, floor: 2 };
      mockBookingService.updateRoom.mockResolvedValue(updatedRoom);

      const result = await caller.admin.updateRoom({
        id: mockRoom.id,
        data: { floor: 2 },
      });

      expect(mockBookingService.updateRoom).toHaveBeenCalledWith(
        mockRoom.id,
        { floor: 2 }
      );
      expect(result.floor).toBe(2);
    });

    it('should throw FORBIDDEN when customer tries to update', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.updateRoom({
          id: mockRoom.id,
          data: { floor: 2 },
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.deleteRoom Tests ==========
  describe('admin.deleteRoom', () => {
    it('should delete room for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.deleteRoom.mockResolvedValue(true);

      const result = await caller.admin.deleteRoom({ id: mockRoom.id });

      expect(mockBookingService.deleteRoom).toHaveBeenCalledWith(mockRoom.id);
      expect(result).toBe(true);
    });

    it('should throw FORBIDDEN when customer tries to delete', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.deleteRoom({ id: mockRoom.id })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service error when room has active bookings', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const error = new Error('Cannot delete room with active bookings');
      (error as any).statusCode = 400;
      mockBookingService.deleteRoom.mockRejectedValue(error);

      await expect(
        caller.admin.deleteRoom({ id: mockRoom.id })
      ).rejects.toThrow('Cannot delete room with active bookings');
    });
  });

  // ========== admin.getRooms Tests ==========
  describe('admin.getRooms', () => {
    it('should return all rooms for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRooms.mockResolvedValue([mockRoom]);

      const result = await caller.admin.getRooms({});

      expect(mockBookingService.getRooms).toHaveBeenCalledWith(undefined, true);
      expect(result).toEqual([mockRoom]);
    });

    it('should filter by room type', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRooms.mockResolvedValue([mockRoom]);

      await caller.admin.getRooms({ roomTypeId: mockRoomType.id });

      expect(mockBookingService.getRooms).toHaveBeenCalledWith(mockRoomType.id, true);
    });

    it('should filter by includeInactive', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRooms.mockResolvedValue([mockRoom]);

      await caller.admin.getRooms({ includeInactive: false });

      expect(mockBookingService.getRooms).toHaveBeenCalledWith(undefined, false);
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getRooms({})
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getRoom Tests ==========
  describe('admin.getRoom', () => {
    it('should return room by id for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoom.mockResolvedValue(mockRoom);

      const result = await caller.admin.getRoom({ id: mockRoom.id });

      expect(mockBookingService.getRoom).toHaveBeenCalledWith(mockRoom.id);
      expect(result).toEqual(mockRoom);
    });

    it('should throw NOT_FOUND when room does not exist', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoom.mockResolvedValue(null);

      await expect(
        caller.admin.getRoom({ id: '99999999-9999-9999-9999-999999999999' })
      ).rejects.toThrow('Room not found');
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getRoom({ id: mockRoom.id })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getBlockedDates Tests ==========
  describe('admin.getBlockedDates', () => {
    it('should return blocked dates for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getBlockedDates.mockResolvedValue([mockBlockedDate]);

      const result = await caller.admin.getBlockedDates({
        roomId: mockRoom.id,
        startDate: new Date('2025-03-01'),
        endDate: new Date('2025-03-31'),
      });

      expect(mockBookingService.getBlockedDates).toHaveBeenCalledWith(
        mockRoom.id,
        expect.any(Date),
        expect.any(Date)
      );
      expect(result).toEqual([mockBlockedDate]);
    });

    it('should return empty array when no blocked dates', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getBlockedDates.mockResolvedValue([]);

      const result = await caller.admin.getBlockedDates({
        roomId: mockRoom.id,
        startDate: new Date('2025-03-01'),
        endDate: new Date('2025-03-31'),
      });

      expect(result).toEqual([]);
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getBlockedDates({
          roomId: mockRoom.id,
          startDate: new Date('2025-03-01'),
          endDate: new Date('2025-03-31'),
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getAllBookingsAdvanced Tests ==========
  describe('admin.getAllBookingsAdvanced', () => {
    // Mock raw booking data as returned by the database (flat structure)
    const mockRawBooking = {
      id: '44444444-4444-4444-4444-444444444444',
      userId: 'customer-test-id',
      roomId: mockRoom.id,
      roomTypeId: mockRoomType.id,
      checkInDate: new Date('2025-02-01'),
      checkOutDate: new Date('2025-02-03'),
      numGuests: 2,
      totalPrice: 7000,
      pointsEarned: 70000,
      status: 'confirmed' as const,
      cancelledAt: null,
      cancellationReason: null,
      notes: 'Early check-in requested',
      adminNotes: null,
      createdAt: new Date('2025-01-15'),
      updatedAt: new Date('2025-01-15'),
      paymentType: 'full' as const,
      paymentAmount: 7000,
      discountAmount: null,
      discountReason: null,
      slipImageUrl: 'https://storage.example.com/slips/test-slip.jpg',
      slipUploadedAt: new Date('2025-01-15'),
      slipokStatus: 'verified' as const,
      slipokVerifiedAt: new Date('2025-01-15'),
      adminStatus: 'pending' as const,
      adminVerifiedAt: null,
      adminVerifiedBy: null,
      // Flat user/room fields from database JOIN
      userEmail: 'customer@test.com',
      userFirstName: 'John',
      userLastName: 'Doe',
      userMembershipId: 'MEM-12345',
      userPhone: '0812345678',
      roomTypeName: 'Deluxe Room',
    };

    const mockRawBookingWithoutSlip = {
      ...mockRawBooking,
      id: '55555555-5555-5555-5555-555555555555',
      slipImageUrl: null,
      slipUploadedAt: null,
      slipokStatus: null,
      slipokVerifiedAt: null,
    };

    it('should return bookings with correct nested structure for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [mockRawBooking],
        total: 1,
      });

      const response = await caller.admin.getAllBookingsAdvanced({
        page: 1,
        limit: 10,
      });

      expect(response.bookings).toHaveLength(1);
      const booking = response.bookings[0]!;

      // Verify the response has nested user object
      expect(booking.user).toBeDefined();
      expect(booking.user.firstName).toBe('John');
      expect(booking.user.lastName).toBe('Doe');
      expect(booking.user.email).toBe('customer@test.com');
      expect(booking.user.membershipId).toBe('MEM-12345');
      expect(booking.user.phone).toBe('0812345678');

      // Verify the response has nested roomType object
      expect(booking.roomType).toBeDefined();
      expect(booking.roomType.name).toBe('Deluxe Room');
      expect(booking.roomType.id).toBe(mockRoomType.id);

      // Verify pagination
      expect(response.total).toBe(1);
      expect(response.page).toBe(1);
      expect(response.limit).toBe(10);
      expect(response.totalPages).toBe(1);
    });

    it('should return bookings with nested slip object when slip exists', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [mockRawBooking],
        total: 1,
      });

      const response = await caller.admin.getAllBookingsAdvanced({
        page: 1,
        limit: 10,
      });

      expect(response.bookings).toHaveLength(1);
      const booking = response.bookings[0]!;

      // Verify slip object exists and has correct fields
      expect(booking.slip).toBeDefined();
      expect(booking.slip).not.toBeNull();
      expect(booking.slip!.imageUrl).toBe('https://storage.example.com/slips/test-slip.jpg');
      expect(booking.slip!.slipokStatus).toBe('verified');
      expect(booking.slip!.adminStatus).toBe('pending');
    });

    it('should return null slip when no slip uploaded', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [mockRawBookingWithoutSlip],
        total: 1,
      });

      const response = await caller.admin.getAllBookingsAdvanced({
        page: 1,
        limit: 10,
      });

      expect(response.bookings).toHaveLength(1);
      expect(response.bookings[0]!.slip).toBeNull();
    });

    it('should pass search, sort, and pagination params to service', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [],
        total: 0,
      });

      await caller.admin.getAllBookingsAdvanced({
        search: 'john@test.com',
        sortBy: 'check_in_date',
        sortOrder: 'asc',
        page: 2,
        limit: 5,
      });

      expect(mockBookingService.getAllBookingsForAdmin).toHaveBeenCalledWith({
        search: 'john@test.com',
        sortBy: 'check_in_date',
        sortOrder: 'asc',
        limit: 5,
        offset: 5, // (page 2 - 1) * limit 5
      });
    });

    it('should handle null user fields gracefully', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const bookingWithNullFields = {
        ...mockRawBooking,
        userFirstName: null,
        userLastName: null,
        userMembershipId: null,
        userPhone: null,
      };
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [bookingWithNullFields],
        total: 1,
      });

      const response = await caller.admin.getAllBookingsAdvanced({
        page: 1,
        limit: 10,
      });

      expect(response.bookings).toHaveLength(1);
      const booking = response.bookings[0]!;

      expect(booking.user.firstName).toBeNull();
      expect(booking.user.lastName).toBeNull();
      expect(booking.user.membershipId).toBeNull();
      expect(booking.user.phone).toBeNull();
      // Email should still be present
      expect(booking.user.email).toBe('customer@test.com');
    });

    it('should calculate totalPages correctly', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [mockRawBooking],
        total: 25, // 25 total bookings
      });

      const response = await caller.admin.getAllBookingsAdvanced({
        page: 1,
        limit: 10,
      });

      expect(response.totalPages).toBe(3); // ceil(25/10) = 3
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getAllBookingsAdvanced({
          page: 1,
          limit: 10,
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should allow super_admin access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.superAdmin);
      mockBookingService.getAllBookingsForAdmin.mockResolvedValue({
        bookings: [mockRawBooking],
        total: 1,
      });

      const response = await caller.admin.getAllBookingsAdvanced({
        page: 1,
        limit: 10,
      });

      expect(response.bookings).toHaveLength(1);
      expect(mockBookingService.getAllBookingsForAdmin).toHaveBeenCalled();
    });
  });

  // ========== admin.getAllBlockedDates Tests ==========
  describe('admin.getAllBlockedDates', () => {
    it('should return all blocked dates for room type', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const result = [
        { roomId: mockRoom.id, roomNumber: '101', dates: [mockBlockedDate] },
      ];
      mockBookingService.getAllBlockedDates.mockResolvedValue(result);

      const response = await caller.admin.getAllBlockedDates({
        roomTypeId: mockRoomType.id,
        startDate: new Date('2025-03-01'),
        endDate: new Date('2025-03-31'),
      });

      expect(mockBookingService.getAllBlockedDates).toHaveBeenCalledWith(
        mockRoomType.id,
        expect.any(Date),
        expect.any(Date)
      );
      expect(response).toEqual(result);
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getAllBlockedDates({
          roomTypeId: mockRoomType.id,
          startDate: new Date('2025-03-01'),
          endDate: new Date('2025-03-31'),
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.blockDates Tests ==========
  describe('admin.blockDates', () => {
    it('should block dates for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.blockDates.mockResolvedValue(undefined);

      const dates = [new Date('2025-03-01'), new Date('2025-03-02')];
      const result = await caller.admin.blockDates({
        roomId: mockRoom.id,
        dates,
        reason: 'Maintenance',
      });

      expect(mockBookingService.blockDates).toHaveBeenCalledWith(
        mockRoom.id,
        expect.arrayContaining([expect.any(Date), expect.any(Date)]),
        'Maintenance',
        'admin-test-id'
      );
      expect(result).toEqual({ success: true, count: 2 });
    });

    it('should reject empty dates array', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.blockDates({
          roomId: mockRoom.id,
          dates: [],
          reason: 'Maintenance',
        })
      ).rejects.toThrow();
    });

    it('should reject empty reason', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.blockDates({
          roomId: mockRoom.id,
          dates: [new Date('2025-03-01')],
          reason: '',
        })
      ).rejects.toThrow();
    });

    it('should throw FORBIDDEN when customer tries to block dates', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.blockDates({
          roomId: mockRoom.id,
          dates: [new Date('2025-03-01')],
          reason: 'Maintenance',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.unblockDates Tests ==========
  describe('admin.unblockDates', () => {
    it('should unblock dates for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.unblockDates.mockResolvedValue(undefined);

      const dates = [new Date('2025-03-01'), new Date('2025-03-02')];
      const result = await caller.admin.unblockDates({
        roomId: mockRoom.id,
        dates,
      });

      expect(mockBookingService.unblockDates).toHaveBeenCalledWith(
        mockRoom.id,
        expect.arrayContaining([expect.any(Date), expect.any(Date)])
      );
      expect(result).toEqual({ success: true, count: 2 });
    });

    it('should reject empty dates array', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.unblockDates({
          roomId: mockRoom.id,
          dates: [],
        })
      ).rejects.toThrow();
    });

    it('should throw FORBIDDEN when customer tries to unblock dates', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.unblockDates({
          roomId: mockRoom.id,
          dates: [new Date('2025-03-01')],
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getAllBookings Tests ==========
  describe('admin.getAllBookings', () => {
    it('should return all bookings for admin with default pagination', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [mockBooking],
        total: 1,
      });

      const result = await caller.admin.getAllBookings({});

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
      });
      expect(result.bookings).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by status', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [mockBooking],
        total: 1,
      });

      await caller.admin.getAllBookings({ status: 'confirmed' });

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith(expect.objectContaining({
        status: 'confirmed',
      }));
    });

    it('should filter by userId', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [mockBooking],
        total: 1,
      });

      const userIdFilter = '66666666-6666-6666-6666-666666666666';
      await caller.admin.getAllBookings({ userId: userIdFilter });

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith(expect.objectContaining({
        userId: userIdFilter,
      }));
    });

    it('should filter by roomTypeId', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [mockBooking],
        total: 1,
      });

      await caller.admin.getAllBookings({ roomTypeId: mockRoomType.id });

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith(expect.objectContaining({
        roomTypeId: mockRoomType.id,
      }));
    });

    it('should filter by date range', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [mockBooking],
        total: 1,
      });

      await caller.admin.getAllBookings({
        fromDate: new Date('2025-01-01'),
        toDate: new Date('2025-12-31'),
      });

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith(expect.objectContaining({
        fromDate: expect.any(Date),
        toDate: expect.any(Date),
      }));
    });

    it('should support custom pagination', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [],
        total: 100,
      });

      await caller.admin.getAllBookings({ page: 3, pageSize: 50 });

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith(expect.objectContaining({
        limit: 50,
        offset: 100,
      }));
    });

    it('should enforce maximum pageSize of 100', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [],
        total: 0,
      });

      await caller.admin.getAllBookings({ page: 1, pageSize: 100 });

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledWith(expect.objectContaining({
        limit: 100,
      }));
    });

    it('should reject pageSize greater than 100', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.getAllBookings({ page: 1, pageSize: 101 })
      ).rejects.toThrow();
    });

    it('should reject invalid page numbers', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.getAllBookings({ page: 0 })
      ).rejects.toThrow();

      await expect(
        caller.admin.getAllBookings({ page: -1 })
      ).rejects.toThrow();
    });

    it('should accept valid status values', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getAdminBookings.mockResolvedValue({
        bookings: [],
        total: 0,
      });

      const validStatuses = ['confirmed', 'cancelled', 'completed'] as const;

      for (const status of validStatuses) {
        await caller.admin.getAllBookings({ status });
      }

      expect(mockBookingService.getAdminBookings).toHaveBeenCalledTimes(3);
    });

    it('should reject invalid status values', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.getAllBookings({ status: 'invalid' as any })
      ).rejects.toThrow();
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getAllBookings({})
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getBooking Tests ==========
  describe('admin.getBooking', () => {
    it('should return any booking for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getBooking.mockResolvedValue(mockBooking);

      const result = await caller.admin.getBooking({ id: mockBooking.id });

      expect(mockBookingService.getBooking).toHaveBeenCalledWith(mockBooking.id);
      expect(result).toEqual(mockBooking);
    });

    it('should throw NOT_FOUND when booking does not exist', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getBooking.mockResolvedValue(null);

      await expect(
        caller.admin.getBooking({ id: '99999999-9999-9999-9999-999999999999' })
      ).rejects.toThrow('Booking not found');
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getBooking({ id: mockBooking.id })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== admin.getRoomBookings Tests ==========
  describe('admin.getRoomBookings', () => {
    it('should return room bookings for admin', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomBookings.mockResolvedValue([mockBooking]);

      const result = await caller.admin.getRoomBookings({
        roomTypeId: mockRoomType.id,
        startDate: new Date('2025-02-01'),
        endDate: new Date('2025-02-28'),
      });

      expect(mockBookingService.getRoomBookings).toHaveBeenCalledWith(
        mockRoomType.id,
        expect.any(Date),
        expect.any(Date)
      );
      expect(result).toEqual([mockBooking]);
    });

    it('should return empty array when no bookings in range', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.getRoomBookings.mockResolvedValue([]);

      const result = await caller.admin.getRoomBookings({
        roomTypeId: mockRoomType.id,
        startDate: new Date('2025-12-01'),
        endDate: new Date('2025-12-31'),
      });

      expect(result).toEqual([]);
    });

    it('should throw FORBIDDEN when customer tries to access', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.customer);

      await expect(
        caller.admin.getRoomBookings({
          roomTypeId: mockRoomType.id,
          startDate: new Date('2025-02-01'),
          endDate: new Date('2025-02-28'),
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ==================== VALIDATION AND ERROR TESTS ====================

  describe('Input Validation', () => {
    it('should coerce string dates to Date objects', async () => {
      const caller = createUnauthenticatedCaller(bookingRouter);
      mockBookingService.getRoomTypesWithAvailability.mockResolvedValue([]);

      await caller.checkAvailability({
        checkIn: '2025-06-01' as any,
        checkOut: '2025-06-03' as any,
      });

      expect(mockBookingService.getRoomTypesWithAvailability).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date)
      );
    });

    it('should reject invalid UUID formats', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.getRoomType({ id: 'not-a-uuid' })
      ).rejects.toThrow();

      await expect(
        caller.admin.getRoom({ id: '123' })
      ).rejects.toThrow();

      await expect(
        caller.admin.getBooking({ id: 'abc-def' })
      ).rejects.toThrow();
    });

    it('should reject invalid image URLs in room type creation', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);

      await expect(
        caller.admin.createRoomType({
          name: 'Test Room',
          pricePerNight: 1000,
          images: ['not-a-valid-url'],
        })
      ).rejects.toThrow();
    });

    it('should accept valid image URLs in room type creation', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      mockBookingService.createRoomType.mockResolvedValue(mockRoomType);

      await caller.admin.createRoomType({
        name: 'Test Room',
        pricePerNight: 1000,
        images: ['https://example.com/image.jpg', 'http://example.com/image2.png'],
      });

      expect(mockBookingService.createRoomType).toHaveBeenCalled();
    });

    it('should enforce max length on room type name', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const longName = 'a'.repeat(101);

      await expect(
        caller.admin.createRoomType({
          name: longName,
          pricePerNight: 1000,
        })
      ).rejects.toThrow();
    });

    it('should enforce max length on room number', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const longRoomNumber = 'a'.repeat(21);

      await expect(
        caller.admin.createRoom({
          roomTypeId: mockRoomType.id,
          roomNumber: longRoomNumber,
        })
      ).rejects.toThrow();
    });

    it('should enforce max length on block reason', async () => {
      const caller = createCallerWithUser(bookingRouter, mockUsers.admin);
      const longReason = 'a'.repeat(101);

      await expect(
        caller.admin.blockDates({
          roomId: mockRoom.id,
          dates: [new Date('2025-03-01')],
          reason: longReason,
        })
      ).rejects.toThrow();
    });
  });

  describe('Authorization Matrix', () => {
    const publicEndpoints = [
      { name: 'getRoomTypes', call: (caller: any) => caller.getRoomTypes() },
      { name: 'getRoomType', call: (caller: any) => caller.getRoomType({ id: mockRoomType.id }) },
      { name: 'checkAvailability', call: (caller: any) => caller.checkAvailability({ checkIn: new Date('2025-02-01'), checkOut: new Date('2025-02-03') }) },
    ];

    const protectedEndpoints = [
      { name: 'getAvailableRooms', call: (caller: any) => caller.getAvailableRooms({ roomTypeId: mockRoomType.id, checkIn: new Date('2025-02-01'), checkOut: new Date('2025-02-03') }) },
      { name: 'createBooking', call: (caller: any) => caller.createBooking({ roomTypeId: mockRoomType.id, checkIn: new Date('2025-02-01'), checkOut: new Date('2025-02-03'), numGuests: 2 }) },
      { name: 'getMyBookings', call: (caller: any) => caller.getMyBookings() },
      { name: 'getBooking', call: (caller: any) => caller.getBooking({ id: mockBooking.id }) },
      { name: 'cancelBooking', call: (caller: any) => caller.cancelBooking({ id: mockBooking.id }) },
    ];

    const adminEndpoints = [
      { name: 'admin.createRoomType', call: (caller: any) => caller.admin.createRoomType({ name: 'Test', pricePerNight: 1000 }) },
      { name: 'admin.updateRoomType', call: (caller: any) => caller.admin.updateRoomType({ id: mockRoomType.id, data: { name: 'Test' } }) },
      { name: 'admin.deleteRoomType', call: (caller: any) => caller.admin.deleteRoomType({ id: mockRoomType.id }) },
      { name: 'admin.getRoomTypes', call: (caller: any) => caller.admin.getRoomTypes({}) },
      { name: 'admin.getRoomType', call: (caller: any) => caller.admin.getRoomType({ id: mockRoomType.id }) },
      { name: 'admin.createRoom', call: (caller: any) => caller.admin.createRoom({ roomTypeId: mockRoomType.id, roomNumber: '999' }) },
      { name: 'admin.updateRoom', call: (caller: any) => caller.admin.updateRoom({ id: mockRoom.id, data: { floor: 1 } }) },
      { name: 'admin.deleteRoom', call: (caller: any) => caller.admin.deleteRoom({ id: mockRoom.id }) },
      { name: 'admin.getRooms', call: (caller: any) => caller.admin.getRooms({}) },
      { name: 'admin.getRoom', call: (caller: any) => caller.admin.getRoom({ id: mockRoom.id }) },
      { name: 'admin.getBlockedDates', call: (caller: any) => caller.admin.getBlockedDates({ roomId: mockRoom.id, startDate: new Date('2025-03-01'), endDate: new Date('2025-03-31') }) },
      { name: 'admin.getAllBlockedDates', call: (caller: any) => caller.admin.getAllBlockedDates({ roomTypeId: mockRoomType.id, startDate: new Date('2025-03-01'), endDate: new Date('2025-03-31') }) },
      { name: 'admin.blockDates', call: (caller: any) => caller.admin.blockDates({ roomId: mockRoom.id, dates: [new Date('2025-03-01')], reason: 'Test' }) },
      { name: 'admin.unblockDates', call: (caller: any) => caller.admin.unblockDates({ roomId: mockRoom.id, dates: [new Date('2025-03-01')] }) },
      { name: 'admin.getAllBookings', call: (caller: any) => caller.admin.getAllBookings({}) },
      { name: 'admin.getBooking', call: (caller: any) => caller.admin.getBooking({ id: mockBooking.id }) },
      { name: 'admin.getRoomBookings', call: (caller: any) => caller.admin.getRoomBookings({ roomTypeId: mockRoomType.id, startDate: new Date('2025-02-01'), endDate: new Date('2025-02-28') }) },
    ];

    describe('Public endpoints should be accessible without authentication', () => {
      beforeEach(() => {
        mockBookingService.getRoomTypes.mockResolvedValue([mockRoomType]);
        mockBookingService.getRoomType.mockResolvedValue(mockRoomType);
        mockBookingService.getRoomTypesWithAvailability.mockResolvedValue([mockRoomTypeWithAvailability]);
      });

      publicEndpoints.forEach(({ name, call }) => {
        it(`${name} should be accessible without authentication`, async () => {
          const caller = createUnauthenticatedCaller(bookingRouter);
          await expect(call(caller)).resolves.not.toThrow();
        });
      });
    });

    describe('Protected endpoints should require authentication', () => {
      protectedEndpoints.forEach(({ name, call }) => {
        it(`${name} should throw UNAUTHORIZED without authentication`, async () => {
          const caller = createUnauthenticatedCaller(bookingRouter);
          await expect(call(caller)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        });
      });
    });

    describe('Admin endpoints should require admin role', () => {
      adminEndpoints.forEach(({ name, call }) => {
        it(`${name} should throw UNAUTHORIZED without authentication`, async () => {
          const caller = createUnauthenticatedCaller(bookingRouter);
          await expect(call(caller)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        });

        it(`${name} should throw FORBIDDEN for customer`, async () => {
          const caller = createCallerWithUser(bookingRouter, mockUsers.customer);
          await expect(call(caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        });
      });
    });
  });
});
