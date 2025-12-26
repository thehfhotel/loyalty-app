/**
 * tRPC Initialization
 * Sets up tRPC with context and creates reusable procedures
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

// Initialize tRPC with context and error formatter
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // Preserve custom error code from AppError
    const cause = error.cause;
    let customCode: string | undefined;

    if (cause instanceof AppError && cause.data?.code) {
      customCode = cause.data.code as string;
    }

    return {
      ...shape,
      data: {
        ...shape.data,
        // Add custom error code to response
        code: customCode,
      },
    };
  },
});

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
