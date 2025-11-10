/**
 * tRPC Loyalty Router
 * Type-safe loyalty system endpoints
 */

import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { loyaltyService } from '../../services/loyaltyService';

export const loyaltyRouter = router({
  /**
   * Get user's loyalty status (points, tier, etc.)
   */
  getStatus: protectedProcedure
    .input(z.object({
      userId: z.string().optional() // Optional for admins viewing other users
    }))
    .query(async ({ ctx, input }) => {
      // If userId not provided, use authenticated user's ID
      const targetUserId = input.userId ?? ctx.user.id;

      // Only admins can view other users' status
      if (targetUserId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new Error('Forbidden: Cannot view other user\'s loyalty status');
      }

      return await loyaltyService.getUserLoyaltyStatus(targetUserId);
    }),

  /**
   * Get user's transaction history
   */
  getTransactions: protectedProcedure
    .input(z.object({
      userId: z.string().optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const targetUserId = input.userId ?? ctx.user.id;

      // Only admins can view other users' transactions
      if (targetUserId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new Error('Forbidden: Cannot view other user\'s transactions');
      }

      return await loyaltyService.getTransactionHistory(
        targetUserId,
        input.page,
        input.pageSize
      );
    }),

  /**
   * Award points to user (admin only)
   */
  awardPoints: adminProcedure
    .input(z.object({
      userId: z.string(),
      points: z.number().int().positive(),
      reason: z.string(),
      referenceType: z.enum(['booking', 'purchase', 'referral', 'bonus', 'admin_adjustment']).optional(),
      referenceId: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await loyaltyService.awardPoints(
        input.userId,
        input.points,
        input.reason,
        input.referenceType,
        input.referenceId,
        ctx.user.id, // Admin user ID
        input.notes
      );
    }),

  /**
   * Deduct points from user (admin only)
   */
  deductPoints: adminProcedure
    .input(z.object({
      userId: z.string(),
      points: z.number().int().positive(),
      reason: z.string(),
      referenceType: z.enum(['redemption', 'correction', 'admin_adjustment']).optional(),
      referenceId: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await loyaltyService.deductPoints(
        input.userId,
        input.points,
        input.reason,
        input.referenceType,
        input.referenceId,
        ctx.user.id, // Admin user ID
        input.notes
      );
    }),

  /**
   * Get tier configuration
   */
  getTierConfig: protectedProcedure.query(async () => {
    return await loyaltyService.getTierConfiguration();
  }),

  /**
   * Update tier configuration (admin only)
   */
  updateTierConfig: adminProcedure
    .input(z.object({
      tierId: z.string().uuid(),
      name: z.string().optional(),
      required_points: z.number().int().nonnegative().optional(),
      benefits: z.array(z.string()).optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { tierId, ...config } = input;
      return await loyaltyService.updateTierConfiguration(tierId, config);
    }),
});
