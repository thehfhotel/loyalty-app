// ESLint suppressed for mock dependencies with ES2015+ requirements
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../../middleware/errorHandler';

// Create mock verifyToken function with proper typing
const mockVerifyToken = jest.fn() as jest.MockedFunction<(token: string) => Promise<{ userId: string; email: string; role: string }>>;

// Mock environment configuration to prevent process.exit during tests
jest.mock('../../../config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: 'localhost',
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-that-is-at-least-32-characters',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    LINE_CHANNEL_ID: 'test-line-channel-id',
    LINE_CHANNEL_SECRET: 'test-line-channel-secret',
    LOG_LEVEL: 'error'
  }
}));

// Mock AuthService before importing auth middleware
jest.mock('../../../services/authService', () => {
  return {
    AuthService: jest.fn().mockImplementation(() => {
      return {
        verifyToken: mockVerifyToken
      };
    })
  };
});

// Mock database query function
const mockQuery = jest.fn() as jest.MockedFunction<typeof import('../../../config/database').query>;

jest.mock('../../../config/database', () => ({
  query: mockQuery,
  connectDatabase: jest.fn(),
  getPool: jest.fn(),
}));

// Import auth middleware AFTER mocking AuthService
import { authenticate, authorize, requireRole, requireAdmin } from '../../../middleware/auth';
import { UserRole } from '../../../types/auth';

describe('Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      headers: {},
      user: undefined,
    };

    mockResponse = {};

    mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
  });

  describe('authenticate', () => {
    it('should authenticate valid Bearer token', async () => {
      const mockPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'customer' as const,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token-123',
      };

      mockVerifyToken.mockResolvedValue(mockPayload);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockVerifyToken).toHaveBeenCalledWith('valid-token-123');
      expect(mockRequest.user).toEqual(mockPayload);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject request without authorization header', async () => {
      mockRequest.headers = {};

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should reject request with malformed authorization header', async () => {
      mockRequest.headers = {
        authorization: 'InvalidFormat token-123',
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should handle invalid token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid-token',
      };

      const tokenError = new Error('Invalid token');
      mockVerifyToken.mockRejectedValue(tokenError);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(tokenError);
    });

    it('should handle expired token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer expired-token',
      };

      const expiredError = new Error('Token expired');
      mockVerifyToken.mockRejectedValue(expiredError);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expiredError);
    });

    it('should handle token verification service errors', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      const serviceError = new Error('Service unavailable');
      mockVerifyToken.mockRejectedValue(serviceError);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(serviceError);
    });

    it('should trim Bearer prefix correctly', async () => {
      const tokenWithSpaces = '  token-with-spaces  ';
      mockRequest.headers = {
        authorization: `Bearer ${tokenWithSpaces}`,
      };

      mockVerifyToken.mockResolvedValue({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'customer' as const,
      });

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should extract token starting from position 7 (after "Bearer ")
      expect(mockVerifyToken).toHaveBeenCalled();
    });
  });

  describe('authorize', () => {
    it('should allow access for user with correct role', () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      const middleware = authorize('admin', 'super_admin');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should deny access for user with insufficient role', () => {
      mockRequest.user = {
        id: 'customer-123',
        email: 'customer@example.com',
        role: 'customer',
      };

      const middleware = authorize('admin', 'super_admin');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });

    it('should deny access for unauthenticated user', () => {
      mockRequest.user = undefined;

      const middleware = authorize('customer');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authenticated',
        })
      );
    });

    it('should allow super_admin access to admin routes', () => {
      mockRequest.user = {
        id: 'superadmin-123',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      const middleware = authorize('admin', 'super_admin');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle single role authorization', () => {
      mockRequest.user = {
        id: 'customer-123',
        email: 'customer@example.com',
        role: 'customer',
      };

      const middleware = authorize('customer');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle multiple allowed roles', () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      const middleware = authorize('customer', 'admin', 'super_admin');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('requireRole', () => {
    it('should allow access for user with required role', () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      const middleware = requireRole(['admin', 'super_admin']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should deny access for user without required role', () => {
      mockRequest.user = {
        id: 'customer-123',
        email: 'customer@example.com',
        role: 'customer',
      };

      const middleware = requireRole(['admin', 'super_admin']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });

    it('should deny access for unauthenticated user', () => {
      mockRequest.user = undefined;

      const middleware = requireRole(['customer']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authenticated',
        })
      );
    });

    it('should work with single role in array', () => {
      mockRequest.user = {
        id: 'customer-123',
        email: 'customer@example.com',
        role: 'customer',
      };

      const middleware = requireRole(['customer']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle role hierarchy correctly', () => {
      mockRequest.user = {
        id: 'superadmin-123',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      const middleware = requireRole(['admin', 'super_admin']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('middleware integration', () => {
    it('should chain authenticate and authorize correctly', async () => {
      const mockPayload = {
        userId: 'admin-123',
        email: 'admin@example.com',
        role: 'admin' as const,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-admin-token',
      };

      mockVerifyToken.mockResolvedValue(mockPayload);

      // First authenticate
      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockRequest.user).toEqual(mockPayload);
      expect(mockNext).toHaveBeenCalledWith();

      // Then authorize
      mockNext.mockClear();
      const authzMiddleware = authorize('admin');
      authzMiddleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should prevent unauthorized access after failed authentication', async () => {
      mockRequest.headers = {};

      // Authentication fails
      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(mockRequest.user).toBeUndefined();

      // Authorization should fail for missing user
      mockNext.mockClear();
      const authzMiddleware = authorize('admin');
      authzMiddleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
        })
      );
    });
  });

  describe('error handling', () => {
    it('should pass errors to next middleware', async () => {
      mockRequest.headers = {
        authorization: 'Bearer error-token',
      };

      const customError = new AppError(500, 'Custom error');
      mockVerifyToken.mockRejectedValue(customError);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(customError);
    });

    it('should handle undefined user gracefully in authorize', () => {
      mockRequest.user = undefined;

      const middleware = authorize('customer');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    });

    it('should handle undefined user gracefully in requireRole', () => {
      mockRequest.user = undefined;

      const middleware = requireRole(['customer']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe('authenticate - additional edge cases', () => {
    it('should reject empty Bearer token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer ',
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should extract empty string after "Bearer " (position 7)
      expect(mockVerifyToken).toHaveBeenCalledWith('');
    });

    it('should reject authorization header with only spaces', async () => {
      mockRequest.headers = {
        authorization: '       ',
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should reject Basic auth format', async () => {
      mockRequest.headers = {
        authorization: 'Basic dXNlcjpwYXNz',
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should handle case-sensitive Bearer prefix', async () => {
      mockRequest.headers = {
        authorization: 'bearer valid-token',
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should handle BEARER in uppercase', async () => {
      mockRequest.headers = {
        authorization: 'BEARER valid-token',
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should handle token with multiple Bearer prefixes', async () => {
      mockRequest.headers = {
        authorization: 'Bearer Bearer token-123',
      };

      mockVerifyToken.mockResolvedValue({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'customer' as const,
      });

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should extract "Bearer token-123" (everything after first "Bearer ")
      expect(mockVerifyToken).toHaveBeenCalledWith('Bearer token-123');
    });

    it('should handle very long tokens', async () => {
      const longToken = 'a'.repeat(10000);
      mockRequest.headers = {
        authorization: `Bearer ${longToken}`,
      };

      mockVerifyToken.mockResolvedValue({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'customer' as const,
      });

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockVerifyToken).toHaveBeenCalledWith(longToken);
    });

    it('should handle tokens with special characters', async () => {
      const specialToken = 'token.with-special_chars!@#';
      mockRequest.headers = {
        authorization: `Bearer ${specialToken}`,
      };

      mockVerifyToken.mockResolvedValue({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'customer' as const,
      });

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockVerifyToken).toHaveBeenCalledWith(specialToken);
    });

    it('should handle network errors during token verification', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      const networkError = new Error('Network timeout');
      mockVerifyToken.mockRejectedValue(networkError);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(networkError);
    });

    it('should handle JSON parsing errors in token verification', async () => {
      mockRequest.headers = {
        authorization: 'Bearer malformed-jwt',
      };

      const parseError = new SyntaxError('Unexpected token in JSON');
      mockVerifyToken.mockRejectedValue(parseError);

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(parseError);
    });

    it('should handle null authorization header', async () => {
      mockRequest.headers = {
        authorization: null as unknown as string,
      };

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'No token provided',
        })
      );
    });

    it('should handle undefined headers object', async () => {
      mockRequest.headers = undefined as unknown as Request['headers'];

      await authenticate(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass the error to next middleware (TypeError)
      expect(mockNext).toHaveBeenCalledWith(expect.any(TypeError));
    });
  });

  describe('authorize - additional edge cases', () => {
    it('should handle empty roles array', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'customer',
      };

      const middleware = authorize();
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Empty array means no roles are allowed, should deny access
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });

    it('should handle null user object', () => {
      mockRequest.user = null as unknown as Request['user'];

      const middleware = authorize('customer');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authenticated',
        })
      );
    });

    it('should handle user without role property', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
      } as unknown as Request['user'];

      const middleware = authorize('customer');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });

    it('should handle invalid role type', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'invalid_role' as UserRole,
      };

      const middleware = authorize('customer', 'admin');
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });

    it('should be case-sensitive for role matching', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'Admin' as UserRole, // Capitalized
      };

      const middleware = authorize('admin'); // Lowercase
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });
  });

  describe('requireRole - additional edge cases', () => {
    it('should handle empty roles array', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'customer',
      };

      const middleware = requireRole([]);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Insufficient permissions',
        })
      );
    });

    it('should handle null user object', () => {
      mockRequest.user = null as unknown as Request['user'];

      const middleware = requireRole(['customer']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authenticated',
        })
      );
    });

    it('should handle duplicate roles in array', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'customer',
      };

      const middleware = requireRole(['customer', 'customer', 'customer']);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('requireAdmin', () => {
    beforeEach(() => {
      mockQuery.mockClear();
    });

    it('should allow access for admin user', async () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      mockQuery.mockResolvedValue([{ role: 'admin' }]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT role FROM users WHERE id = $1 AND is_active = true',
        ['admin-123']
      );
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should allow access for super_admin user', async () => {
      mockRequest.user = {
        id: 'superadmin-123',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      mockQuery.mockResolvedValue([{ role: 'super_admin' }]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT role FROM users WHERE id = $1 AND is_active = true',
        ['superadmin-123']
      );
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should deny access for customer user', async () => {
      mockRequest.user = {
        id: 'customer-123',
        email: 'customer@example.com',
        role: 'customer',
      };

      mockQuery.mockResolvedValue([{ role: 'customer' }]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Admin access required',
        })
      );
    });

    it('should deny access for unauthenticated user', async () => {
      mockRequest.user = undefined;

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authenticated',
        })
      );
    });

    it('should deny access for inactive user', async () => {
      mockRequest.user = {
        id: 'inactive-admin-123',
        email: 'inactive@example.com',
        role: 'admin',
      };

      mockQuery.mockResolvedValue([]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'User not found or inactive',
        })
      );
    });

    it('should deny access for non-existent user', async () => {
      mockRequest.user = {
        id: 'non-existent-123',
        email: 'nonexistent@example.com',
        role: 'admin',
      };

      mockQuery.mockResolvedValue([]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'User not found or inactive',
        })
      );
    });

    it('should update req.user with current role from database', async () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'customer', // Old role in JWT
      };

      mockQuery.mockResolvedValue([{ role: 'admin' }]); // Updated role in DB

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockRequest.user?.role).toBe('admin');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle database errors', async () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      const dbError = new Error('Database connection failed');
      mockQuery.mockRejectedValue(dbError);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(dbError);
    });

    it('should handle null user object', async () => {
      mockRequest.user = null as unknown as Request['user'];

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authenticated',
        })
      );
    });

    it('should handle database returning multiple rows', async () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      mockQuery.mockResolvedValue([{ role: 'admin' }, { role: 'super_admin' }]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should use first row only
      expect(mockRequest.user?.role).toBe('admin');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should verify role immediately before sensitive operation', async () => {
      // Simulates user being demoted from admin to customer
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'admin', // JWT says admin
      };

      mockQuery.mockResolvedValue([{ role: 'customer' }]); // But DB says customer

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Admin access required',
        })
      );
    });

    it('should handle database timeout', async () => {
      mockRequest.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        role: 'admin',
      };

      const timeoutError = new Error('Query timeout');
      mockQuery.mockRejectedValue(timeoutError);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(timeoutError);
    });

    it('should handle user with invalid role format', async () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'user@example.com',
        role: 'invalid_role' as unknown as UserRole,
      };

      mockQuery.mockResolvedValue([{ role: 'invalid_role' as unknown as UserRole }]);

      const middleware = requireAdmin();
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Admin access required',
        })
      );
    });
  });
});
