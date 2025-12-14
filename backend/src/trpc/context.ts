/**
 * tRPC Context
 * Creates context for each tRPC request
 * Includes authenticated user information from Express middleware
 */

import type { inferAsyncReturnType } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { JWTPayload } from '../types/auth';

// Import Express type augmentation (without .d.ts extension)
// TypeScript finds the .d.ts file for type checking but emits no JS
import '../types/express';

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
