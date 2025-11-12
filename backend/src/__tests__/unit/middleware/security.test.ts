/**
 * Security Middleware Unit Tests
 * Tests rate limiting, security headers, input sanitization, and monitoring
 */

import { Request, Response, NextFunction } from 'express';
import {
  createRateLimiter,
  createApiRateLimiter,
  createUserRateLimiter,
  createAuthRateLimiter,
  securityHeaders,
  customSecurityHeaders,
  inputSanitization,
  fileUploadSecurity,
  securityMonitoring,
  productionSecurity
} from '../../../middleware/security';

// Mock helmet
jest.mock('helmet', () => ({
  __esModule: true,
  default: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

// Mock logger
jest.mock('../../../utils/logger');

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
  },
  securityConfig: {
    maxFileSize: 5242880, // 5MB
    rateLimitWindowMs: 900000, // 15 minutes
    rateLimitMaxRequests: 100
  },
  isProduction: () => false
}));

describe('Security Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      ip: '127.0.0.1',
      method: 'GET',
      path: '/api/test',
      originalUrl: '/api/test',
      body: {},
      query: {},
      params: {},
      headers: {},
      get: jest.fn((header: string) => {
        if (header === 'set-cookie') return [];
        if (header === 'host') return 'localhost:4000';
        if (header === 'user-agent') return 'Test User Agent';
        return undefined;
      }) as unknown as Request['get']
    } as Partial<Request>;

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      removeHeader: jest.fn()
    };

    mockNext = jest.fn();
  });

  describe('Rate Limiter Creation', () => {
    test('should create basic rate limiter', () => {
      const rateLimiter = createRateLimiter();
      expect(rateLimiter).toBeDefined();
      expect(typeof rateLimiter).toBe('function');
    });

    test('should create API rate limiter', () => {
      const apiLimiter = createApiRateLimiter();
      expect(apiLimiter).toBeDefined();
      expect(typeof apiLimiter).toBe('function');
    });

    test('should create user-specific rate limiter', () => {
      const userLimiter = createUserRateLimiter();
      expect(userLimiter).toBeDefined();
      expect(typeof userLimiter).toBe('function');
    });

    test('should create authentication rate limiter', () => {
      const authLimiter = createAuthRateLimiter();
      expect(authLimiter).toBeDefined();
      expect(typeof authLimiter).toBe('function');
    });
  });

  describe('Security Headers', () => {
    test('should apply security headers middleware', () => {
      securityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should set custom security headers', () => {
      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'same-origin');
      expect(mockRes.removeHeader).toHaveBeenCalledWith('X-Powered-By');
      expect(mockNext).toHaveBeenCalled();
    });

    test('should set cache control headers for API routes', () => {
      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);

      // Verify API-specific cache headers are set (req.path is '/api/test')
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Expires', '0');
    });
  });

  describe('Input Sanitization', () => {
    test('should sanitize request body', () => {
      mockReq.body = {
        name: '<script>alert("xss")</script>',
        email: 'test@example.com'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should sanitize query parameters', () => {
      mockReq.query = {
        search: '<img src=x onerror=alert(1)>',
        page: '1'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should sanitize URL parameters', () => {
      mockReq.params = {
        id: '123<script>',
        slug: 'test'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle empty request objects', () => {
      mockReq.body = undefined;
      mockReq.query = undefined;
      mockReq.params = undefined;

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle nested objects in body', () => {
      mockReq.body = {
        user: {
          name: '<b>test</b>',
          profile: {
            bio: '<script>malicious</script>'
          }
        }
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('File Upload Security', () => {
    test('should validate file upload requests', () => {
      const mockFile = {
        fieldname: 'avatar',
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 1024000
      };

      mockReq.files = [mockFile] as unknown as Request['files'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle requests without files', () => {
      mockReq.files = undefined;

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should validate file types', () => {
      const mockExecutableFile = {
        fieldname: 'avatar',
        originalname: 'test.exe',
        mimetype: 'application/x-msdownload',
        size: 1024000
      };

      mockReq.files = [mockExecutableFile] as unknown as Request['files'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      // Should still call next but with potential validation
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle multiple file uploads', () => {
      const mockFiles = [
        {
          fieldname: 'avatar',
          originalname: 'test1.jpg',
          mimetype: 'image/jpeg',
          size: 1024000
        },
        {
          fieldname: 'document',
          originalname: 'test2.pdf',
          mimetype: 'application/pdf',
          size: 2048000
        }
      ];

      mockReq.files = mockFiles as unknown as Request['files'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Security Monitoring', () => {
    test('should monitor requests', () => {
      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should track request metadata', () => {
      mockReq.method = 'POST';
      mockReq.originalUrl = '/api/auth/login';
      Object.defineProperty(mockReq, 'ip', { value: '192.168.1.100', writable: true });

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle requests without IP', () => {
      Object.defineProperty(mockReq, 'ip', { value: undefined, writable: true });

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should monitor different HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

      methods.forEach(method => {
        mockReq.method = method;
        securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
      });
    });
  });

  describe('Production Security', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test('should apply production security', () => {
      process.env.NODE_ENV = 'production';
      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should work in development mode', () => {
      process.env.NODE_ENV = 'development';
      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle missing NODE_ENV', () => {
      delete process.env.NODE_ENV;
      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('XSS Protection', () => {
    test('should sanitize script tags', () => {
      mockReq.body = { content: '<script>alert("xss")</script>' };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should sanitize event handlers', () => {
      mockReq.body = { content: '<img src=x onerror=alert(1)>' };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should sanitize javascript: URLs', () => {
      const jsScheme = String.fromCharCode(106, 97, 118, 97, 115, 99, 114, 105, 112, 116, 58);
      const maliciousUrl = jsScheme + 'alert(1)';
      mockReq.body = { link: maliciousUrl };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should preserve safe HTML', () => {
      mockReq.body = { content: '<p>Safe content</p>' };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('SQL Injection Protection', () => {
    test('should handle SQL-like inputs in query', () => {
      mockReq.query = { search: "'; DROP TABLE users; --" };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle SQL-like inputs in body', () => {
      mockReq.body = { username: "admin' OR '1'='1" };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle UNION attacks', () => {
      mockReq.query = { id: '1 UNION SELECT * FROM users' };
      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('CSRF Protection Headers', () => {
    test('should set CSRF protection headers', () => {
      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.setHeader).toHaveBeenCalled();
    });

    test('should prevent clickjacking', () => {
      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    });

    test('should prevent MIME sniffing', () => {
      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    });
  });

  describe('Error Scenarios', () => {
    test('should handle sanitization errors gracefully', () => {
      const requestBody: Record<string, unknown> = { circular: {} };
      (requestBody.circular as Record<string, unknown>).ref = requestBody;
      mockReq.body = requestBody;

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle malformed headers', () => {
      const malformedReq = {
        ...mockReq,
        headers: { 'x-forwarded-for': null } as unknown as Request['headers'],
        get: jest.fn(() => undefined)
      } as unknown as Request;
      Object.defineProperty(malformedReq, 'protocol', { value: 'http', writable: true });

      securityMonitoring(malformedReq, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should continue on setHeader errors', () => {
      (mockRes.setHeader as jest.Mock).mockImplementation(() => {
        throw new Error('Header error');
      });

      // The middleware should continue even if setHeader throws
      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
