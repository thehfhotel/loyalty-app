/**
 * tRPC Context
 * Creates context for each tRPC request
 * Includes authenticated user information from Express middleware
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/express.d.ts" />

import type { inferAsyncReturnType } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { JWTPayload } from '../types/auth';

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
