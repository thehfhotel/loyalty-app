/**
 * Main tRPC App Router
 * Combines all sub-routers into a single type-safe API
 */

import { router } from '../trpc';
import { loyaltyRouter } from './loyalty';

/**
 * Main application router
 * Add new routers here as you create them
 */
export const appRouter = router({
  loyalty: loyaltyRouter,
  // Add more routers here:
  // user: userRouter,
  // coupon: couponRouter,
  // survey: surveyRouter,
});

// Export type definition for use in frontend
export type AppRouter = typeof appRouter;
