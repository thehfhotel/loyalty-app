/**
 * tRPC Initialization
 * Sets up tRPC with context and creates reusable procedures
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import { logger } from '../utils/logger';

// Initialize tRPC with context
const t = initTRPC.context<Context>().create();

/**
 * Timing middleware - logs duration of each procedure (only for slow calls)
 */
const timingMiddleware = t.middleware(async ({ path, next }) => {
  const start = performance.now();
  const result = await next();
  const duration = Math.round(performance.now() - start);

  // Only log slow procedures (>100ms)
  if (duration > 100) {
    logger.warn(`[tRPC] Slow procedure: ${path} took ${duration}ms`);
  }

  return result;
});

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
// Apply timing middleware to all procedures
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected procedure - requires authentication
 * Throws UNAUTHORIZED error if user is not logged in
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user?.id) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // Now guaranteed to be defined
    },
  });
});

/**
 * Admin procedure - requires admin role
 * Throws FORBIDDEN error if user is not admin
 */
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }

  return next({ ctx });
});
