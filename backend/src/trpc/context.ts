/**
 * tRPC Context
 * Creates context for each tRPC request
 * Only exposes user info - Express internals stay private
 */

import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { JWTPayload } from '../types/auth';

/**
 * Create context from Express request/response
 * This is called for every tRPC request
 *
 * NOTE: We intentionally don't expose req/res in the context type.
 * This keeps Express types out of the tRPC type chain, allowing
 * the frontend to import AppRouter without needing Express types.
 */
export const createContext = ({ req }: CreateExpressContextOptions) => {
  // Get user from Express auth middleware (if authenticated)
  // Cast is safe because our auth middleware sets this
  const user = (req as { user?: JWTPayload }).user ?? null;

  return {
    user, // JWTPayload | null - no Express types exposed
  };
};

export type Context = {
  user: JWTPayload | null;
};
