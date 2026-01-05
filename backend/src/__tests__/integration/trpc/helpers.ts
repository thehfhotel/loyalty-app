/**
 * tRPC Integration Test Helpers
 * Common utilities for integration testing tRPC routers
 */

import type { Context } from '../../../trpc/context';

/**
 * Mock user objects for different roles
 */
export const mockUsers = {
  customer: {
    id: 'customer-test-id',
    role: 'customer' as const,
    email: 'customer@test.com',
  },
  admin: {
    id: 'admin-test-id',
    role: 'admin' as const,
    email: 'admin@test.com',
  },
  superAdmin: {
    id: 'super-admin-test-id',
    role: 'super_admin' as const,
    email: 'superadmin@test.com',
  },
};

/**
 * Mock user profile data
 */
export const mockProfile = {
  userId: 'customer-test-id',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+1234567890',
  dateOfBirth: new Date('1990-01-01'),
  preferences: { theme: 'dark', newsletter: true },
  avatarUrl: 'https://example.com/avatar.jpg',
  membershipId: 'MEM123456',
  gender: 'male',
  occupation: 'Engineer',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

/**
 * Create a tRPC caller with user context
 * @param router - The tRPC router to create a caller for
 * @param user - The user to add to the context (or null for unauthenticated)
 */
export const createCallerWithUser = <T>(
  router: { createCaller: (ctx: Context) => T },
  user: Context['user']
): T => {
  return router.createCaller({ user });
};

/**
 * Create an authenticated caller for a specific role
 */
export const createAuthenticatedCaller = <T>(
  router: { createCaller: (ctx: Context) => T },
  role: 'customer' | 'admin' | 'superAdmin' = 'customer'
): T => {
  // eslint-disable-next-line security/detect-object-injection -- Safe: role is TypeScript union type constrained to known keys
  return createCallerWithUser(router, mockUsers[role]);
};

/**
 * Create an unauthenticated caller
 */
export const createUnauthenticatedCaller = <T>(
  router: { createCaller: (ctx: Context) => T }
): T => {
  return createCallerWithUser(router, null);
};
