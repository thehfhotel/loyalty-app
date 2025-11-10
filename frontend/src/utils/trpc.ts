/**
 * tRPC Client Configuration
 * Provides end-to-end type-safe API calls from frontend to backend
 */

import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../backend/src/trpc/routers/_app';

/**
 * Create tRPC React hooks
 * These hooks provide type-safe API calls with auto-completion
 */
export const trpc = createTRPCReact<AppRouter>();
