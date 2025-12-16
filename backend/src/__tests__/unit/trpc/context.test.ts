/**
 * tRPC Context Unit Tests
 * Tests context creation from Express request
 */

import { describe, it, expect } from '@jest/globals';
import { createContext, type Context } from '../../../trpc/context';
import type { JWTPayload } from '../../../types/auth';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';

/**
 * Helper to create mock context options for testing
 */
const createMockContextOptions = (user?: JWTPayload): CreateExpressContextOptions => {
  return {
    req: user ? ({ user } as any) : ({} as any),
    res: {} as any,
    info: {
      isBatchCall: false,
      calls: [],
    } as any,
  };
};

describe('tRPC Context', () => {
  describe('createContext', () => {
    describe('Basic functionality', () => {
      it('should return null user when req.user is undefined', () => {
        const options = createMockContextOptions();

        const context = createContext(options);

        expect(context).toEqual({ user: null });
        expect(context.user).toBeNull();
      });

      it('should return user object when req.user is defined', () => {
        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'user@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context).toEqual({ user: mockUser });
        expect(context.user).toEqual(mockUser);
      });

      it('should return correct Context shape', () => {
        const mockUser: JWTPayload = {
          id: 'user-456',
          email: 'test@example.com',
          role: 'admin',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context).toHaveProperty('user');
        expect(Object.keys(context)).toEqual(['user']);
      });
    });

    describe('User property extraction', () => {
      it('should correctly extract user id', () => {
        const mockUser: JWTPayload = {
          id: 'user-789',
          email: 'test@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.id).toBe('user-789');
      });

      it('should correctly extract user email', () => {
        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'john.doe@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.email).toBe('john.doe@example.com');
      });

      it('should correctly extract user role', () => {
        const mockUser: JWTPayload = {
          id: 'admin-123',
          email: 'admin@example.com',
          role: 'admin',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.role).toBe('admin');
      });

      it('should extract all user properties correctly', () => {
        const mockUser: JWTPayload = {
          id: 'user-999',
          email: 'complete@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user).toEqual({
          id: 'user-999',
          email: 'complete@example.com',
          role: 'customer',
        });
      });
    });

    describe('User roles', () => {
      it('should handle customer role', () => {
        const mockUser: JWTPayload = {
          id: 'customer-1',
          email: 'customer@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.role).toBe('customer');
        expect(context.user).toEqual(mockUser);
      });

      it('should handle admin role', () => {
        const mockUser: JWTPayload = {
          id: 'admin-1',
          email: 'admin@example.com',
          role: 'admin',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.role).toBe('admin');
        expect(context.user).toEqual(mockUser);
      });

      it('should handle super_admin role', () => {
        const mockUser: JWTPayload = {
          id: 'super-admin-1',
          email: 'superadmin@example.com',
          role: 'super_admin',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.role).toBe('super_admin');
        expect(context.user).toEqual(mockUser);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty req object', () => {
        const options = createMockContextOptions();

        const context = createContext(options);

        expect(context).toEqual({ user: null });
        expect(context.user).toBeNull();
      });

      it('should handle user with null email', () => {
        const mockUser: JWTPayload = {
          id: 'user-no-email',
          email: null,
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user).toEqual(mockUser);
        expect(context.user?.email).toBeNull();
      });

      it('should handle user with empty string email', () => {
        const mockUser: JWTPayload = {
          id: 'user-empty-email',
          email: '',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user).toEqual(mockUser);
        expect(context.user?.email).toBe('');
      });

      it('should handle user with minimal required fields', () => {
        const mockUser: JWTPayload = {
          id: 'min-user',
          email: 'min@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user).toEqual(mockUser);
        expect(Object.keys(context.user || {})).toEqual(['id', 'email', 'role']);
      });

      it('should handle user with special characters in id', () => {
        const mockUser: JWTPayload = {
          id: 'user-123-abc-xyz',
          email: 'user@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.id).toBe('user-123-abc-xyz');
      });

      it('should handle user with special characters in email', () => {
        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'user+test@example.co.uk',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.email).toBe('user+test@example.co.uk');
      });

      it('should handle UUID format in user id', () => {
        const mockUser: JWTPayload = {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          email: 'uuid@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context = createContext(options);

        expect(context.user?.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      });
    });

    describe('Context type consistency', () => {
      it('should always return an object with user property', () => {
        const options1 = createMockContextOptions();

        const context1 = createContext(options1);
        expect(context1).toHaveProperty('user');

        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'test@example.com',
          role: 'customer',
        };

        const options2 = createMockContextOptions(mockUser);

        const context2 = createContext(options2);
        expect(context2).toHaveProperty('user');
      });

      it('should return Context type compatible object', () => {
        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'test@example.com',
          role: 'customer',
        };

        const options = createMockContextOptions(mockUser);

        const context: Context = createContext(options);

        expect(context.user).toBeDefined();
        if (context.user) {
          expect(context.user.id).toBeDefined();
          expect(context.user.role).toBeDefined();
        }
      });

      it('should return same object structure for authenticated and unauthenticated', () => {
        const unauthContext = createContext(createMockContextOptions());

        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'test@example.com',
          role: 'customer',
        };

        const authContext = createContext(createMockContextOptions(mockUser));

        expect(Object.keys(unauthContext)).toEqual(Object.keys(authContext));
        expect(Object.keys(unauthContext)).toEqual(['user']);
      });
    });

    describe('Multiple user scenarios', () => {
      it('should handle multiple different users correctly', () => {
        const users: JWTPayload[] = [
          { id: 'user-1', email: 'user1@example.com', role: 'customer' },
          { id: 'user-2', email: 'user2@example.com', role: 'admin' },
          { id: 'user-3', email: null, role: 'customer' },
        ];

        users.forEach((user) => {
          const options = createMockContextOptions(user);

          const context = createContext(options);

          expect(context.user).toEqual(user);
        });
      });

      it('should not mutate the original user object', () => {
        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'test@example.com',
          role: 'customer',
        };

        const originalUser = { ...mockUser };

        const options = createMockContextOptions(mockUser);

        createContext(options);

        expect(mockUser).toEqual(originalUser);
      });
    });

    describe('Integration with Express types', () => {
      it('should accept standard Express request object', () => {
        const options = {
          req: {
            headers: {},
            method: 'POST',
            url: '/api/trpc',
          } as any,
          res: {} as any,
          info: {
            isBatchCall: false,
            calls: [],
          } as any,
        };

        const context = createContext(options);

        expect(context).toEqual({ user: null });
      });

      it('should work with req containing other properties', () => {
        const mockUser: JWTPayload = {
          id: 'user-123',
          email: 'test@example.com',
          role: 'customer',
        };

        const options = {
          req: {
            user: mockUser,
            headers: { authorization: 'Bearer token' },
            method: 'POST',
            url: '/api/trpc',
            body: {},
          } as any,
          res: {} as any,
          info: {
            isBatchCall: false,
            calls: [],
          } as any,
        };

        const context = createContext(options);

        expect(context.user).toEqual(mockUser);
      });
    });
  });

  describe('Context type definition', () => {
    it('should allow Context type with null user', () => {
      const context: Context = {
        user: null,
      };

      expect(context.user).toBeNull();
    });

    it('should allow Context type with JWTPayload user', () => {
      const context: Context = {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          role: 'customer',
        },
      };

      expect(context.user).toBeDefined();
      expect(context.user?.id).toBe('user-123');
    });

    it('should enforce Context type structure', () => {
      const validContext: Context = {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          role: 'admin',
        },
      };

      expect(validContext).toHaveProperty('user');
      expect(Object.keys(validContext)).toEqual(['user']);
    });
  });
});
