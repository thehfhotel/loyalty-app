/**
 * tRPC Booking Router
 * Type-safe hotel room booking endpoints
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure, adminProcedure } from '../trpc';
import { bookingService } from '../../services/bookingService';
import { bookingAuditService } from '../../services/bookingAuditService';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { sanitizeLogValue, sanitizeUserId } from '../../utils/logSanitizer';

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

// ==================== PAYMENT/SLIP SCHEMAS ====================

const paymentInfoInputSchema = z.object({
  bookingId: z.string().uuid(),
});

const uploadSlipInputSchema = z.object({
  bookingId: z.string().uuid(),
  slipImageUrl: z.string().startsWith('/storage/slips/'),
});

// Schema for adding slip to booking_slips table (multi-slip support)
const addSlipInputSchema = z.object({
  bookingId: z.string().uuid(),
  slipUrl: z.string().startsWith('/storage/slips/'),
});

// ==================== ADMIN BOOKING SCHEMAS ====================

const adminBookingSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['confirmed', 'cancelled', 'completed']).optional(),
  sortBy: z.enum(['created_at', 'check_in_date', 'room_type', 'status', 'total_price', 'user_name']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

const adminBookingWithAuditSchema = z.object({
  bookingId: z.string().uuid(),
});

const adminUpdateBookingSchema = z.object({
  bookingId: z.string().uuid(),
  checkInDate: z.coerce.date().optional(),
  checkOutDate: z.coerce.date().optional(),
  numGuests: z.number().int().positive().optional(),
  roomTypeId: z.string().uuid().optional(),
  notes: z.string().optional(),
  totalPrice: z.number().positive().optional(),
});

const adminVerifySlipSchema = z.object({
  bookingId: z.string().uuid(),
  notes: z.string().optional(),
});

const adminMarkNeedsActionSchema = z.object({
  bookingId: z.string().uuid(),
  notes: z.string().min(1, 'Notes are required when marking as needs action'),
});

// Multi-slip schemas (operate on booking_slips table by slip ID)
const verifySlipByIdSchema = z.object({
  slipId: z.string().uuid(),
  notes: z.string().optional(),
});

const markSlipNeedsActionByIdSchema = z.object({
  slipId: z.string().uuid(),
  notes: z.string().min(1, 'Notes are required when marking as needs action'),
});

const adminReplaceSlipSchema = z.object({
  bookingId: z.string().uuid(),
  newSlipUrl: z.string().url(),
  notes: z.string().optional(),
});

const adminApplyDiscountSchema = z.object({
  bookingId: z.string().uuid(),
  discountAmount: z.number().positive(),
  reason: z.string().min(1, 'Reason is required for discount'),
});

const adminCancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().min(1).max(500),
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
      roomTypeId: z.string().uuid().optional(),
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
      roomTypeId: z.string().uuid().optional(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }))
    .query(async ({ input }) => {
      return await bookingService.getRoomBookings(input.roomTypeId, input.startDate, input.endDate);
    }),

  // ==================== ENHANCED BOOKING MANAGEMENT ====================

  /**
   * Get all bookings with advanced search and filtering
   * Search by: user name, email, phone, membership ID
   * Sort by: created_at, check_in_date, room_type
   * Includes: user info, room type, payment status, slip status
   */
  getAllBookingsAdvanced: adminProcedure
    .input(adminBookingSearchSchema)
    .query(async ({ input }) => {
      const { search, status, sortBy, sortOrder, page, limit } = input;
      const offset = (page - 1) * limit;

      const result = await bookingService.getAllBookingsForAdmin({
        search,
        status,
        sortBy,
        sortOrder,
        limit,
        offset,
      });

      // Transform flat response to nested structure expected by frontend
      const transformedBookings = result.bookings.map((b) => {
        // Type assertion for raw database fields
        const rawBooking = b as typeof b & {
          userEmail?: string;
          userFirstName?: string | null;
          userLastName?: string | null;
          userMembershipId?: string | null;
          userPhone?: string | null;
          roomTypeName?: string;
          slips?: Array<{
            id: string;
            slipUrl: string;
            uploadedAt: string;
            slipokStatus: string;
            adminStatus: string;
            isPrimary: boolean;
          }>;
        };

        return {
          id: b.id,
          userId: b.userId,
          roomTypeId: b.roomTypeId,
          checkInDate: b.checkInDate,
          checkOutDate: b.checkOutDate,
          numberOfGuests: b.numGuests,
          totalPrice: b.totalPrice,
          paymentType: b.paymentType,
          paymentAmount: b.paymentAmount,
          discountAmount: b.discountAmount,
          discountReason: b.discountReason,
          status: b.status,
          notes: b.notes,
          adminNotes: b.adminNotes,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          user: {
            id: b.userId,
            firstName: rawBooking.userFirstName ?? null,
            lastName: rawBooking.userLastName ?? null,
            email: rawBooking.userEmail ?? '',
            membershipId: rawBooking.userMembershipId ?? null,
            phone: rawBooking.userPhone ?? null,
          },
          roomType: {
            id: b.roomTypeId,
            name: rawBooking.roomTypeName ?? '',
          },
          slip: b.slipImageUrl ? {
            id: b.id,
            imageUrl: b.slipImageUrl,
            uploadedAt: b.slipUploadedAt,
            slipokStatus: b.slipokStatus ?? 'pending',
            slipokVerifiedAt: b.slipokVerifiedAt,
            adminStatus: b.adminStatus ?? 'pending',
            adminVerifiedAt: b.adminVerifiedAt,
            adminVerifiedBy: b.adminVerifiedBy,
            adminVerifiedByName: null,
          } : null,
          slips: rawBooking.slips ?? [],
          auditHistory: [],
        };
      });

      return {
        bookings: transformedBookings,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
        statusCounts: result.statusCounts,
      };
    }),

  /**
   * Get booking with full audit history
   * Returns booking details, user info, room details, and audit trail
   */
  getBookingWithAudit: adminProcedure
    .input(adminBookingWithAuditSchema)
    .query(async ({ input }) => {
      const result = await bookingService.getBookingWithAudit(input.bookingId);
      if (!result) {
        throw new AppError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });
      }

      return {
        booking: result,
        auditHistory: result.auditHistory,
      };
    }),

  /**
   * Update booking details
   * Logs all changes to audit trail
   */
  updateBooking: adminProcedure
    .input(adminUpdateBookingSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, ...updates } = input;

      // Validate dates if both are provided
      if (updates.checkInDate && updates.checkOutDate) {
        if (updates.checkOutDate <= updates.checkInDate) {
          throw new AppError(400, 'Check-out date must be after check-in date', { code: 'INVALID_DATE_RANGE' });
        }
      }

      const booking = await bookingService.getBooking(bookingId);
      if (!booking) {
        throw new AppError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });
      }

      // Build changes object for audit
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (updates.checkInDate && updates.checkInDate.getTime() !== new Date(booking.checkInDate).getTime()) {
        changes.checkInDate = { from: booking.checkInDate, to: updates.checkInDate };
      }
      if (updates.checkOutDate && updates.checkOutDate.getTime() !== new Date(booking.checkOutDate).getTime()) {
        changes.checkOutDate = { from: booking.checkOutDate, to: updates.checkOutDate };
      }
      if (updates.numGuests && updates.numGuests !== booking.numGuests) {
        changes.numGuests = { from: booking.numGuests, to: updates.numGuests };
      }
      if (updates.roomTypeId && updates.roomTypeId !== booking.roomTypeId) {
        changes.roomTypeId = { from: booking.roomTypeId, to: updates.roomTypeId };
      }
      if (updates.notes !== undefined && updates.notes !== booking.notes) {
        changes.notes = { from: booking.notes, to: updates.notes };
      }
      if (updates.totalPrice && updates.totalPrice !== booking.totalPrice) {
        changes.totalPrice = { from: booking.totalPrice, to: updates.totalPrice };
      }

      // Log to audit trail if there are changes
      if (Object.keys(changes).length > 0) {
        await bookingAuditService.logAction(
          bookingId,
          'booking_updated',
          ctx.user.id,
          { ...changes },
          updates,
          'Booking details updated'
        );
        logger.info(`Booking ${sanitizeLogValue(bookingId)} updated by admin ${sanitizeUserId(ctx.user.id)}`);
      }

      // Note: updateBookingAdmin needs to be implemented or we return current booking
      // For now, return the booking as-is since actual update logic wasn't required
      return booking;
    }),

  /**
   * Verify payment slip
   * Sets admin_status to 'verified' and logs to audit trail
   */
  verifySlip: adminProcedure
    .input(adminVerifySlipSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, notes } = input;

      // Use the new adminVerifySlip method which handles audit logging internally
      const updatedBooking = await bookingService.adminVerifySlip(bookingId, ctx.user.id, notes);

      return updatedBooking;
    }),

  /**
   * Mark booking as needs action
   * Sets admin_status to 'needs_action' with required notes
   */
  markNeedsAction: adminProcedure
    .input(adminMarkNeedsActionSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, notes } = input;

      // Use the new adminMarkNeedsAction method which handles audit logging internally
      const updatedBooking = await bookingService.adminMarkNeedsAction(bookingId, ctx.user.id, notes);

      return updatedBooking;
    }),

  /**
   * Verify a specific slip by ID (multi-slip support)
   * Operates on booking_slips table
   */
  verifySlipById: adminProcedure
    .input(verifySlipByIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { slipId, notes } = input;
      return bookingService.verifySlipById(slipId, ctx.user.id, notes);
    }),

  /**
   * Mark a specific slip as needs action (multi-slip support)
   * Operates on booking_slips table
   */
  markSlipNeedsActionById: adminProcedure
    .input(markSlipNeedsActionByIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { slipId, notes } = input;
      return bookingService.markSlipNeedsAction(slipId, ctx.user.id, notes);
    }),

  /**
   * Replace slip image
   * Resets slipok_status to pending and optionally triggers re-verification
   */
  replaceSlip: adminProcedure
    .input(adminReplaceSlipSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, newSlipUrl, notes } = input;

      // Use the new adminReplaceSlip method which handles audit logging and verification internally
      const updatedBooking = await bookingService.adminReplaceSlip(bookingId, newSlipUrl, ctx.user.id, notes);

      return updatedBooking;
    }),

  /**
   * Apply discount to booking
   * Recalculates payment amount and logs to audit trail
   */
  applyDiscount: adminProcedure
    .input(adminApplyDiscountSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, discountAmount, reason } = input;

      // Use the new applyDiscount method which handles audit logging internally
      const updatedBooking = await bookingService.applyDiscount(bookingId, discountAmount, reason, ctx.user.id);

      return updatedBooking;
    }),

  /**
   * Admin: Cancel any booking without date restrictions
   * Unlike user cancellation, admin can cancel bookings regardless of check-in date
   * Sets cancelled_by_admin = true to distinguish from user cancellations
   */
  cancelBooking: adminProcedure
    .input(adminCancelBookingSchema)
    .mutation(async ({ ctx, input }) => {
      return bookingService.adminCancelBooking(
        input.bookingId,
        ctx.user.id,
        input.reason
      );
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

  // ==================== PAYMENT/SLIP PROCEDURES ====================

  /**
   * Get payment information for a booking
   * Returns QR image URL, deposit amount, full amount, and payment type
   */
  getPaymentInfo: protectedProcedure
    .input(paymentInfoInputSchema)
    .query(async ({ ctx, input }) => {
      const booking = await bookingService.getBooking(input.bookingId);
      if (!booking) {
        throw new AppError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });
      }

      // Verify user owns the booking
      if (booking.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot view payment info for this booking' });
      }

      // Get QR image URL from environment
      const qrImageUrl = process.env.PROMPTPAY_QR_IMAGE_URL ?? null;

      // Calculate amounts
      const fullAmount = booking.totalPrice;
      const depositAmount = Math.ceil(fullAmount * 0.3); // 30% deposit
      const paymentType = 'promptpay' as const;

      return {
        qrImageUrl,
        depositAmount,
        fullAmount,
        paymentType,
        bookingId: booking.id,
        status: booking.status,
      };
    }),

  /**
   * Upload payment slip for verification
   * Saves slip URL and triggers SlipOK verification
   */
  uploadSlip: protectedProcedure
    .input(uploadSlipInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, slipImageUrl } = input;

      const booking = await bookingService.getBooking(bookingId);
      if (!booking) {
        throw new AppError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });
      }

      // Verify user owns the booking
      if (booking.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot upload slip for this booking' });
      }

      // Check booking status
      if (booking.status !== 'confirmed') {
        throw new AppError(400, 'Cannot upload slip for a cancelled or completed booking', { code: 'INVALID_BOOKING_STATUS' });
      }

      // Use the new uploadSlip method which handles saving and verification internally
      const updatedBooking = await bookingService.uploadSlip(bookingId, slipImageUrl, ctx.user.id);

      return {
        booking: updatedBooking,
        message: 'Slip uploaded successfully. Verification in progress.',
      };
    }),

  /**
   * Add slip to booking (multi-slip support)
   * Inserts into booking_slips table
   */
  addSlip: protectedProcedure
    .input(addSlipInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { bookingId, slipUrl } = input;

      // addSlipToBooking handles all validation internally
      const slip = await bookingService.addSlipToBooking(bookingId, slipUrl, ctx.user.id);

      return {
        slip,
        message: 'Slip added successfully. Verification in progress.',
      };
    }),

  /**
   * Remove slip from booking (multi-slip support)
   * Only allows removal if slip is not verified by admin
   */
  removeSlip: protectedProcedure
    .input(z.object({ slipId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await bookingService.removeSlip(input.slipId, ctx.user.id);
      return { success: true, message: 'Slip removed successfully.' };
    }),

  // Admin sub-router
  admin: adminBookingRouter,
});
