/**
 * Main tRPC App Router
 * Combines all sub-routers into a single type-safe API
 */

import { router } from '../trpc';
import { loyaltyRouter } from './loyalty';
import { userRouter } from './user';
import { couponRouter } from './coupon';
import { surveyRouter } from './survey';
import { notificationRouter } from './notification';
import { adminRouter } from './admin';
import { bookingRouter } from './booking';

/**
 * Main application router
 * All tRPC sub-routers combined into a single type-safe API
 */
export const appRouter = router({
  loyalty: loyaltyRouter,
  user: userRouter,
  coupon: couponRouter,
  survey: surveyRouter,
  notification: notificationRouter,
  admin: adminRouter,
  booking: bookingRouter,
});

// Export type definition for use in frontend
export type AppRouter = typeof appRouter;
