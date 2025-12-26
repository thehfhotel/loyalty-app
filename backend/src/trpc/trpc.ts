/**
 * tRPC Initialization
 * Sets up tRPC with context and creates reusable procedures
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

/**
 * Map HTTP status codes to tRPC error codes
 */
function httpStatusToTRPCCode(statusCode: number): TRPCError['code'] {
  const statusMap: Record<number, TRPCError['code']> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_SUPPORTED',
    408: 'TIMEOUT',
    409: 'CONFLICT',
    412: 'PRECONDITION_FAILED',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'UNPROCESSABLE_CONTENT',
    429: 'TOO_MANY_REQUESTS',
    499: 'CLIENT_CLOSED_REQUEST',
    500: 'INTERNAL_SERVER_ERROR',
  };
  return statusMap[statusCode] ?? 'INTERNAL_SERVER_ERROR';
}

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
 * Error handling middleware - converts AppError to TRPCError with proper status code
 */
const errorHandlingMiddleware = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof AppError) {
      // Convert AppError to TRPCError with proper code
      throw new TRPCError({
        code: httpStatusToTRPCCode(error.statusCode),
        message: error.message,
        cause: error, // Preserve original error for error formatter to extract custom code
      });
    }
    throw error;
  }
});

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
// Apply timing and error handling middleware to all procedures
export const publicProcedure = t.procedure.use(timingMiddleware).use(errorHandlingMiddleware);

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
