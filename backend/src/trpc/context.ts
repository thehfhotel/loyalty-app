/**
 * tRPC Context
 * Creates context for each tRPC request
 * Includes authenticated user information from Express middleware
 */

import type { inferAsyncReturnType } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { JWTPayload } from '../types/auth';

// Note: Express type augmentation is in ../types/express.d.ts
// It's a global ambient declaration picked up by TypeScript automatically
// Do NOT import .d.ts files directly - they don't exist at runtime

/**
 * Create context from Express request/response
 * This is called for every tRPC request
 */
export const createContext = ({ req, res }: CreateExpressContextOptions) => {
  // Get user from Express auth middleware (if authenticated)
  const user = req.user as JWTPayload | undefined;

  return {
    req,
    res,
    user, // Will be undefined if not authenticated
  };
};

export type Context = inferAsyncReturnType<typeof createContext>;
