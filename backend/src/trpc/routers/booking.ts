/**
 * tRPC Booking Router
 * Type-safe hotel room booking endpoints
 */

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure, adminProcedure } from '../trpc';
import { bookingService } from '../../services/bookingService';
import { AppError } from '../../middleware/errorHandler';

// ==================== ZOD SCHEMAS ====================

const roomTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  pricePerNight: z.number().positive(),
  maxGuests: z.number().int().positive().default(2),
  bedType: z.enum(['single', 'double', 'twin', 'king']).optional(),
  amenities: z.array(z.string()).default([]),
  images: z.array(z.string().url()).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
});

const roomSchema = z.object({
  roomTypeId: z.string().uuid(),
  roomNumber: z.string().min(1).max(20),
  floor: z.number().int().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

const dateRangeSchema = z.object({
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
}).refine(data => data.checkOut > data.checkIn, {
  message: 'Check-out date must be after check-in date',
});

const bookingFiltersSchema = z.object({
  status: z.enum(['confirmed', 'cancelled', 'completed']).optional(),
  userId: z.string().uuid().optional(),
  roomTypeId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

// ==================== ADMIN SUB-ROUTER ====================

const adminBookingRouter = router({
  // Room Type Management
  createRoomType: adminProcedure
    .input(roomTypeSchema)
    .mutation(async ({ input }) => {
      return await bookingService.createRoomType(input);
    }),

  updateRoomType: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: roomTypeSchema.partial(),
    }))
    .mutation(async ({ input }) => {
      return await bookingService.updateRoomType(input.id, input.data);
    }),

  deleteRoomType: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return await bookingService.deleteRoomType(input.id);
    }),

  getRoomTypes: adminProcedure
    .input(z.object({ includeInactive: z.boolean().default(true) }))
    .query(async ({ input }) => {
      return await bookingService.getRoomTypes(input.includeInactive);
    }),

  getRoomType: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const roomType = await bookingService.getRoomType(input.id);
      if (!roomType) {
        throw new AppError(404, 'Room type not found', { code: 'ROOM_TYPE_NOT_FOUND' });
      }
      return roomType;
    }),

  // Room Management
  createRoom: adminProcedure
    .input(roomSchema)
    .mutation(async ({ input }) => {
      return await bookingService.createRoom(input);
    }),

  updateRoom: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: roomSchema.partial(),
    }))
    .mutation(async ({ input }) => {
      return await bookingService.updateRoom(input.id, input.data);
    }),

  deleteRoom: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return await bookingService.deleteRoom(input.id);
    }),

  getRooms: adminProcedure
    .input(z.object({
      roomTypeId: z.string().uuid().optional(),
      includeInactive: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      return await bookingService.getRooms(input.roomTypeId, input.includeInactive);
    }),

  getRoom: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const room = await bookingService.getRoom(input.id);
      if (!room) {
        throw new AppError(404, 'Room not found', { code: 'ROOM_NOT_FOUND' });
      }
      return room;
    }),

  // Availability Management
  getBlockedDates: adminProcedure
    .input(z.object({
      roomId: z.string().uuid(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return await bookingService.getBlockedDates(input.roomId, input.startDate, input.endDate);
    }),

  getAllBlockedDates: adminProcedure
    .input(z.object({
      roomTypeId: z.string().uuid(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return await bookingService.getAllBlockedDates(input.roomTypeId, input.startDate, input.endDate);
    }),

  blockDates: adminProcedure
    .input(z.object({
      roomId: z.string().uuid(),
      dates: z.array(z.coerce.date()).min(1),
      reason: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      await bookingService.blockDates(input.roomId, input.dates, input.reason, ctx.user.id);
      return { success: true, count: input.dates.length };
    }),

  unblockDates: adminProcedure
    .input(z.object({
      roomId: z.string().uuid(),
      dates: z.array(z.coerce.date()).min(1),
    }))
    .mutation(async ({ input }) => {
      await bookingService.unblockDates(input.roomId, input.dates);
      return { success: true, count: input.dates.length };
    }),

  // Booking Management
  getAllBookings: adminProcedure
    .input(bookingFiltersSchema)
    .query(async ({ input }) => {
      const { page, pageSize, ...filters } = input;
      return await bookingService.getAdminBookings({
        ...filters,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
    }),

  getBooking: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const booking = await bookingService.getBooking(input.id);
      if (!booking) {
        throw new AppError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });
      }
      return booking;
    }),

  getRoomBookings: adminProcedure
    .input(z.object({
      roomTypeId: z.string().uuid(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return await bookingService.getRoomBookings(input.roomTypeId, input.startDate, input.endDate);
    }),
});

// ==================== MAIN BOOKING ROUTER ====================

export const bookingRouter = router({
  // Public: Get active room types
  getRoomTypes: publicProcedure.query(async () => {
    return await bookingService.getRoomTypes(false);
  }),

  // Public: Get room type details
  getRoomType: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const roomType = await bookingService.getRoomType(input.id);
      if (!roomType?.isActive) {
        throw new AppError(404, 'Room type not found', { code: 'ROOM_TYPE_NOT_FOUND' });
      }
      return roomType;
    }),

  // Public: Check availability for date range
  checkAvailability: publicProcedure
    .input(dateRangeSchema)
    .query(async ({ input }) => {
      return await bookingService.getRoomTypesWithAvailability(input.checkIn, input.checkOut);
    }),

  // Protected: Get available rooms for a room type
  getAvailableRooms: protectedProcedure
    .input(z.object({
      roomTypeId: z.string().uuid(),
      checkIn: z.coerce.date(),
      checkOut: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return await bookingService.getAvailableRooms(input.roomTypeId, input.checkIn, input.checkOut);
    }),

  // Protected: Create a booking
  createBooking: protectedProcedure
    .input(z.object({
      roomTypeId: z.string().uuid(),
      checkIn: z.coerce.date(),
      checkOut: z.coerce.date(),
      numGuests: z.number().int().positive(),
      notes: z.string().optional(),
    }).refine(data => data.checkOut > data.checkIn, {
      message: 'Check-out date must be after check-in date',
    }))
    .mutation(async ({ ctx, input }) => {
      return await bookingService.createBooking(ctx.user.id, {
        roomTypeId: input.roomTypeId,
        checkInDate: input.checkIn,
        checkOutDate: input.checkOut,
        numGuests: input.numGuests,
        notes: input.notes,
      });
    }),

  // Protected: Get user's bookings
  getMyBookings: protectedProcedure.query(async ({ ctx }) => {
    return await bookingService.getUserBookings(ctx.user.id);
  }),

  // Protected: Get a specific booking (own only)
  getBooking: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const booking = await bookingService.getBooking(input.id);
      if (!booking) {
        throw new AppError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });
      }
      // Users can only view their own bookings
      if (booking.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new AppError(403, 'Cannot view this booking', { code: 'FORBIDDEN' });
      }
      return booking;
    }),

  // Protected: Cancel a booking
  cancelBooking: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await bookingService.cancelBooking(input.id, ctx.user.id, input.reason);
    }),

  // Admin sub-router
  admin: adminBookingRouter,
});
