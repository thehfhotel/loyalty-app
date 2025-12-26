/**
 * Admin tRPC Router
 * Handles administrative operations (admin and super_admin only)
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { emailService } from '../../services/emailService';

/**
 * Admin or Super Admin procedure - requires admin or super_admin role
 * Throws FORBIDDEN error if user is not admin or super_admin
 */
const adminOrSuperAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'admin' && ctx.user.role !== 'super_admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

/**
 * Admin router with email management endpoints
 */
export const adminRouter = router({
  email: router({
    /**
     * Get email service health status
     * Returns configuration status and connection health for SMTP/IMAP
     */
    getStatus: adminOrSuperAdminProcedure.query(async () => {
      const status = await emailService.getHealthStatus();
      return status;
    }),

    /**
     * Run email delivery test
     * Sends a test email and verifies it's received via IMAP
     */
    runTest: adminOrSuperAdminProcedure
      .input(
        z.object({
          timeout: z.number().min(5000).max(60000).optional(),
        }).optional()
      )
      .mutation(async ({ input }) => {
        const timeoutMs = input?.timeout ?? 30000;
        const result = await emailService.testEmailDelivery(timeoutMs);
        return result;
      }),
  }),
});
