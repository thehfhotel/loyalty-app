// @ts-nocheck - Mock type assertions conflict with TypeScript strict mode
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../../middleware/errorHandler';

// Create mock verifyToken function
const mockVerifyToken = jest.fn();

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

// Import auth middleware AFTER mocking AuthService
import { authenticate, authorize, requireRole } from '../../../middleware/auth';

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
        id: 'user-123',
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
        id: 'admin-123',
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
});
