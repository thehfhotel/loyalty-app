/**
 * tRPC Coupon Router
 * Type-safe coupon system endpoints
 */

import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { couponService } from '../../services/couponService';

export const couponRouter = router({
  /**
   * Get available coupons for user's tier (protected)
   * Returns active coupons that match user's tier restrictions
   */
  getAvailableCoupons: protectedProcedure
    .input(z.object({
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(100).default(20),
      type: z.enum(['percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service']).optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      // For regular users, only show active coupons
      return await couponService.listCoupons(
        input.page,
        input.limit,
        {
          status: 'active',
          type: input.type,
          search: input.search,
        }
      );
    }),

  /**
   * Get user's claimed coupons (protected)
   * Returns user's coupons with optional status filter
   */
  getMyCoupons: protectedProcedure
    .input(z.object({
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(100).default(20),
      status: z.enum(['available', 'used', 'expired', 'revoked']).optional(),
      userId: z.string().optional(), // Optional for admins viewing other users
    }))
    .query(async ({ ctx, input }) => {
      // Determine target user
      const targetUserId = input.userId ?? ctx.user.id;

      // Only admins can view other users' coupons
      if (targetUserId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new Error('Forbidden: Cannot view other user\'s coupons');
      }

      // If status is specified, get coupons by that status
      if (input.status) {
        return await couponService.getUserCouponsByStatus(
          targetUserId,
          input.status,
          input.page,
          input.limit
        );
      }

      // Default: get active coupons only
      return await couponService.getUserActiveCoupons(
        targetUserId,
        input.page,
        input.limit
      );
    }),

  /**
   * Get single coupon details (protected)
   */
  getCouponDetails: protectedProcedure
    .input(z.object({
      couponId: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const coupon = await couponService.getCouponById(input.couponId);

      if (!coupon) {
        throw new Error('Coupon not found');
      }

      // Non-admin users can only see active coupons
      if (ctx.user.role !== 'admin' && coupon.status !== 'active') {
        throw new Error('Coupon not found');
      }

      return coupon;
    }),

  /**
   * Claim a coupon (protected)
   * Note: This is not implemented in the service layer yet
   * For now, coupons are assigned by admins via assignCoupon
   */
  claimCoupon: protectedProcedure
    .input(z.object({
      couponId: z.string().uuid(),
    }))
    .mutation(async () => {
      // This would require a new service method to allow users to claim coupons
      // For now, throw an error indicating this feature is not yet implemented
      throw new Error('Coupon claiming is not yet implemented. Coupons are assigned by administrators.');
    }),

  /**
   * Get user coupon by QR code (protected)
   */
  getUserCouponByQR: protectedProcedure
    .input(z.object({
      qrCode: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const userCoupon = await couponService.getUserCouponByQR(input.qrCode);

      if (!userCoupon) {
        throw new Error('Invalid QR code');
      }

      return userCoupon;
    }),

  /**
   * Redeem a coupon (admin only)
   */
  redeemCoupon: adminProcedure
    .input(z.object({
      qrCode: z.string().min(1),
      originalAmount: z.number().positive(),
      transactionReference: z.string().optional(),
      location: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await couponService.redeemCoupon(
        {
          qrCode: input.qrCode,
          originalAmount: input.originalAmount,
          transactionReference: input.transactionReference,
          location: input.location,
          metadata: input.metadata,
        },
        ctx.user.id // Admin user ID
      );
    }),

  /**
   * Revoke user's coupon (admin only)
   */
  revokeCoupon: adminProcedure
    .input(z.object({
      userCouponId: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const success = await couponService.revokeUserCoupon(
        input.userCouponId,
        ctx.user.id,
        input.reason
      );

      if (!success) {
        throw new Error('User coupon not found or not available for revocation');
      }

      return {
        success: true,
        message: 'User coupon revoked successfully',
      };
    }),
});
