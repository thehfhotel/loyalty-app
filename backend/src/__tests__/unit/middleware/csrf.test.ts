/**
 * CSRF Middleware Unit Tests
 * Tests double-submit cookie pattern, token generation/verification, and secure cookie handling
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { csrfProtection, getCsrfToken, generateCsrfToken } from '../../../middleware/csrf';

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CSRF Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let cookieJar: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    cookieJar = {};

    mockRequest = {
      method: 'GET',
      path: '/api/test',
      cookies: {},
      get: jest.fn((header: string) => {
        if (header === 'X-CSRF-Token' || header === 'x-csrf-token') {
          return undefined;
        }
        return undefined;
      }) as Request['get'],
      ip: '127.0.0.1',
    };

    mockResponse = {
      cookie: jest.fn((name: string, value: unknown, options?: unknown) => {
        cookieJar[name] = { value, options };
        return mockResponse as Response;
      }) as Response['cookie'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
    };

    mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
  });

  describe('generateCsrfToken', () => {
    it('should generate a cryptographically secure token', () => {
      const token = generateCsrfToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
    });

    it('should generate unique tokens on each call', () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });

    it('should generate tokens with only hex characters', () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('csrfProtection - Safe Methods', () => {
    it('should skip CSRF validation for GET requests', () => {
      mockRequest.method = 'GET';

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should skip CSRF validation for HEAD requests', () => {
      mockRequest.method = 'HEAD';

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should skip CSRF validation for OPTIONS requests', () => {
      mockRequest.method = 'OPTIONS';

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should set CSRF token cookie for GET request when not exists', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.cookie).toHaveBeenCalled();
      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect(cookieCall![0]).toBe('XSRF-TOKEN');
      expect(cookieCall![1]).toBeDefined();
      expect(cookieCall![2]).toMatchObject({
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
      });
    });

    it('should not set CSRF token cookie if one already exists', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = { 'XSRF-TOKEN': 'existing-token' };

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should use secure cookies in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.cookie).toHaveBeenCalled();
      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect(cookieCall![2]).toMatchObject({
        secure: true,
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should use insecure cookies in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.cookie).toHaveBeenCalled();
      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect(cookieCall![2]).toMatchObject({
        secure: false,
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should use insecure cookies in test', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.cookie).toHaveBeenCalled();
      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect(cookieCall![2]).toMatchObject({
        secure: false,
      });

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('csrfProtection - Unsafe Methods', () => {
    beforeEach(() => {
      mockRequest.method = 'POST';
    });

    it('should reject POST request without CSRF token', () => {
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'CSRF token missing',
        message: 'CSRF token is required for this request',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject PUT request without CSRF token', () => {
      mockRequest.method = 'PUT';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject DELETE request without CSRF token', () => {
      mockRequest.method = 'DELETE';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject PATCH request without CSRF token', () => {
      mockRequest.method = 'PATCH';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with missing header token', () => {
      mockRequest.cookies = { 'XSRF-TOKEN': 'valid-token' };

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'CSRF token missing',
        message: 'CSRF token is required for this request',
      });
    });

    it('should reject request with missing cookie token', () => {
      mockRequest.cookies = {};
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return 'valid-token';
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'CSRF token missing',
        message: 'CSRF token is required for this request',
      });
    });

    it('should accept request with matching tokens', () => {
      const token = 'a'.repeat(64);
      mockRequest.cookies = { 'XSRF-TOKEN': token };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return token;
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should accept request with lowercase header name', () => {
      const token = 'b'.repeat(64);
      mockRequest.cookies = { 'XSRF-TOKEN': token };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'x-csrf-token') return token;
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject request with mismatched tokens', () => {
      mockRequest.cookies = { 'XSRF-TOKEN': 'token-from-cookie' };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return 'token-from-header';
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'CSRF token invalid',
        message: 'CSRF token validation failed',
      });
    });

    it('should reject tokens with different lengths', () => {
      mockRequest.cookies = { 'XSRF-TOKEN': 'short' };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return 'much-longer-token-value';
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'CSRF token invalid',
        message: 'CSRF token validation failed',
      });
    });

    it('should use timing-safe comparison', () => {
      // Mock crypto.timingSafeEqual to verify it's being used
      const timingSafeEqualSpy = jest.spyOn(crypto, 'timingSafeEqual');

      const token = 'c'.repeat(64);
      mockRequest.cookies = { 'XSRF-TOKEN': token };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return token;
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(timingSafeEqualSpy).toHaveBeenCalled();

      timingSafeEqualSpy.mockRestore();
    });
  });

  describe('getCsrfToken endpoint', () => {
    it('should return existing CSRF token from cookie', () => {
      const existingToken = 'd'.repeat(64);
      mockRequest.cookies = { 'XSRF-TOKEN': existingToken };

      getCsrfToken(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        csrfToken: existingToken,
      });
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });

    it('should generate and set new CSRF token if none exists', () => {
      mockRequest.cookies = {};

      getCsrfToken(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.cookie).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0];

      expect(cookieCall).toBeDefined();
      expect(jsonCall).toBeDefined();
      expect(cookieCall![0]).toBe('XSRF-TOKEN');
      expect(cookieCall![1]).toBeDefined();
      expect(cookieCall![1]).toBe((jsonCall![0] as { csrfToken: string }).csrfToken);
    });

    it('should set secure cookie in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockRequest.cookies = {};

      getCsrfToken(mockRequest as Request, mockResponse as Response);

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect(cookieCall![2]).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should set insecure cookie in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockRequest.cookies = {};

      getCsrfToken(mockRequest as Request, mockResponse as Response);

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect(cookieCall![2]).toMatchObject({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle missing cookies object', () => {
      mockRequest.cookies = undefined;

      getCsrfToken(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.cookie).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });
  });

  describe('Cookie Security Options', () => {
    it('should set httpOnly flag on cookies', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect((cookieCall![2] as { httpOnly: boolean }).httpOnly).toBe(true);
    });

    it('should set sameSite strict on cookies', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect((cookieCall![2] as { sameSite: string }).sameSite).toBe('strict');
    });

    it('should set 24-hour maxAge on cookies', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect((cookieCall![2] as { maxAge: number }).maxAge).toBe(24 * 60 * 60 * 1000);
    });

    it('should default to secure cookies when NODE_ENV is undefined', () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      mockRequest.method = 'GET';
      mockRequest.cookies = {};

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      const cookieCall = (mockResponse.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall).toBeDefined();
      expect((cookieCall![2] as { secure: boolean }).secure).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Edge Cases', () => {
    it('should reject empty string tokens', () => {
      mockRequest.method = 'POST';
      mockRequest.cookies = { 'XSRF-TOKEN': '' };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return '';
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Empty strings are invalid tokens and should be rejected
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'CSRF token missing',
        message: 'CSRF token is required for this request',
      });
    });

    it('should handle null cookies object', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = null as unknown as Request['cookies'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should still call next without error
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle undefined cookies object', () => {
      mockRequest.method = 'GET';
      mockRequest.cookies = undefined;

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle very long tokens', () => {
      const longToken = 'x'.repeat(1000);
      mockRequest.method = 'POST';
      mockRequest.cookies = { 'XSRF-TOKEN': longToken };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return longToken;
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle special characters in tokens', () => {
      const specialToken = 'token-with-special-!@#$%^&*()_+-=[]{}|;:,.<>?';
      mockRequest.method = 'POST';
      mockRequest.cookies = { 'XSRF-TOKEN': specialToken };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return specialToken;
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle unicode characters in tokens', () => {
      const unicodeToken = 'token-with-unicode-🔒🔑';
      mockRequest.method = 'POST';
      mockRequest.cookies = { 'XSRF-TOKEN': unicodeToken };
      mockRequest.get = jest.fn((header: string) => {
        if (header === 'X-CSRF-Token') return unicodeToken;
        return undefined;
      }) as Request['get'];

      csrfProtection(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});
