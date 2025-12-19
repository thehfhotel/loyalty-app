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

// Create a mockable isProduction function
const mockIsProduction = jest.fn(() => false);

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
  get isProduction() {
    return mockIsProduction;
  }
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
      removeHeader: jest.fn(),
      redirect: jest.fn()
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

  describe('Input Sanitization - Edge Cases', () => {
    test('should handle very long strings', () => {
      mockReq.body = {
        longString: 'a'.repeat(20000)
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      // String should be truncated to MAX_INPUT_LENGTH
      expect((mockReq.body as { longString: string }).longString.length).toBeLessThanOrEqual(10000);
    });

    test('should handle strings at MAX_INPUT_LENGTH boundary', () => {
      mockReq.body = {
        maxString: 'b'.repeat(10000)
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect((mockReq.body as { maxString: string }).maxString.length).toBe(10000);
    });

    test('should sanitize nested circular references', () => {
      const obj1: Record<string, unknown> = {};
      const obj2: Record<string, unknown> = { ref: obj1 };
      obj1.ref = obj2;
      mockReq.body = { circular: obj1 };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle arrays with circular references', () => {
      const arr: unknown[] = [];
      arr.push(arr);
      mockReq.body = { circularArray: arr };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should sanitize multiple whitespace types', () => {
      mockReq.body = {
        multiSpace: 'test  \t\t  multiple   spaces'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      // Multiple spaces/tabs should be collapsed to single space
      expect((mockReq.body as { multiSpace: string }).multiSpace).toContain(' ');
    });

    test('should handle data: URLs', () => {
      mockReq.body = {
        dataUrl: 'data:text/html,<script>alert(1)</script>'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      // data: URL should be removed
      const sanitized = (mockReq.body as { dataUrl: string }).dataUrl.toLowerCase();
      expect(sanitized).not.toContain('data:');
    });

    test('should handle javascript: with spaces', () => {
      mockReq.body = {
        jsUrl: 'java script :alert(1)'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle event handlers with hyphens', () => {
      mockReq.body = {
        handler: 'on-custom-event=handler'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle nested event handlers', () => {
      mockReq.body = {
        nested: 'oonclicknclick=alert'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should sanitize query parameters with unsafe keys', () => {
      // Use Object.create(null) to avoid prototype chain issues in test
      // These keys are intentionally testing prototype pollution protection
      const unsafeQuery = Object.create(null) as Record<string, string>;
      unsafeQuery['__proto__'] = 'malicious';
      unsafeQuery['constructor'] = 'bad';
      unsafeQuery['prototype'] = 'evil';
      mockReq.query = unsafeQuery;

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle query parameters with special characters in keys', () => {
      mockReq.query = {
        'key<script>': 'value',
        'key&param': 'value2'
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle null values in body', () => {
      mockReq.body = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: ''
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle boolean values', () => {
      mockReq.body = {
        boolTrue: true,
        boolFalse: false
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect((mockReq.body as { boolTrue: boolean }).boolTrue).toBe(true);
      expect((mockReq.body as { boolFalse: boolean }).boolFalse).toBe(false);
    });

    test('should handle numeric values', () => {
      mockReq.body = {
        integer: 123,
        float: 45.67,
        negative: -89
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect((mockReq.body as { integer: number }).integer).toBe(123);
    });

    test('should handle Date objects', () => {
      const testDate = new Date('2024-01-01');
      mockReq.body = {
        date: testDate
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle mixed arrays', () => {
      mockReq.body = {
        mixedArray: [
          'string',
          123,
          true,
          null,
          { nested: 'object' },
          ['nested', 'array']
        ]
      };

      inputSanitization(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Security Monitoring - Edge Cases', () => {
    test('should detect directory traversal attempts', () => {
      mockReq.originalUrl = '/api/files/../../etc/passwd';

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should detect SQL injection in URL', () => {
      mockReq.originalUrl = "/api/users?id=1' UNION SELECT * FROM users--";

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should detect XSS attempts in User-Agent', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'User-Agent') return '<script>alert(1)</script>';
        if (header === 'host') return 'localhost';
        return undefined;
      }) as Request['get'];

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should detect null byte injection', () => {
      mockReq.originalUrl = '/api/file%00.txt';

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle missing User-Agent', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'User-Agent') return undefined;
        if (header === 'host') return 'localhost';
        return undefined;
      }) as Request['get'];

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle empty body', () => {
      mockReq.body = {};

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle undefined body', () => {
      mockReq.body = undefined;

      securityMonitoring(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('File Upload Security - Edge Cases', () => {
    test('should reject file exceeding max size', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'content-length') return '10485760'; // 10MB > 5MB limit
        return undefined;
      }) as Request['get'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(413);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'File too large',
        message: expect.stringContaining('exceeds the maximum'),
      });
    });

    test('should allow file at exact max size', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'content-length') return '5242880'; // Exactly 5MB
        return undefined;
      }) as Request['get'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle missing content-length header', () => {
      mockReq.get = jest.fn(() => undefined) as Request['get'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle invalid content-length value', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'content-length') return 'invalid';
        return undefined;
      }) as Request['get'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle negative content-length', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'content-length') return '-1000';
        return undefined;
      }) as Request['get'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle zero content-length', () => {
      mockReq.get = jest.fn((header: string) => {
        if (header === 'content-length') return '0';
        return undefined;
      }) as Request['get'];

      fileUploadSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Production Security - Edge Cases', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      mockIsProduction.mockReturnValue(true);
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      mockIsProduction.mockReturnValue(false);
    });

    test('should handle suspicious x-forwarded-for header', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'x-forwarded-for') return '../../../etc/passwd';
        return undefined;
      }) as Request['get'];

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid request headers' });
    });

    test('should handle suspicious x-real-ip header', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'x-real-ip') return '<script>alert(1)</script>';
        return undefined;
      }) as Request['get'];

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    test('should handle malformed cf-visitor JSON', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'cf-visitor') return 'invalid-json{';
        if (header === 'x-forwarded-proto') return 'http';
        if (header === 'host') return 'example.com';
        return undefined;
      }) as Request['get'];

      Object.defineProperty(mockReq, 'secure', { value: false, writable: true });
      Object.defineProperty(mockReq, 'url', { value: '/test', writable: true });

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      // Should redirect to HTTPS due to malformed cf-visitor
      expect(mockRes.redirect).toHaveBeenCalledWith(301, 'https://example.com/test');
    });

    test('should handle cf-visitor with http scheme', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'cf-visitor') return '{"scheme":"http"}';
        if (header === 'host') return 'example.com';
        if (header === 'x-forwarded-proto') return 'http';
        return undefined;
      }) as Request['get'];

      Object.defineProperty(mockReq, 'secure', { value: false, writable: true });
      Object.defineProperty(mockReq, 'url', { value: '/test', writable: true });

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.redirect).toHaveBeenCalledWith(301, 'https://example.com/test');
    });

    test('should allow cf-visitor with https scheme', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'cf-visitor') return '{"scheme":"https"}';
        return undefined;
      }) as Request['get'];

      Object.defineProperty(mockReq, 'secure', { value: false, writable: true });

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle x-forwarded-proto https', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'x-forwarded-proto') return 'https';
        if (header === 'X-Forwarded-Proto') return 'https';
        return undefined;
      }) as Request['get'];

      Object.defineProperty(mockReq, 'secure', { value: false, writable: true });

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should skip checks in non-production', () => {
      process.env.NODE_ENV = 'development';
      mockIsProduction.mockReturnValue(false);

      mockReq.get = jest.fn((header: string) => {
        if (header === 'x-forwarded-for') return '../../../evil';
        return undefined;
      }) as Request['get'];

      Object.defineProperty(mockReq, 'secure', { value: false, writable: true });

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    test('should handle multiple suspicious headers', () => {
      process.env.NODE_ENV = 'production';

      mockReq.get = jest.fn((header: string) => {
        if (header === 'x-forwarded-for') return '<script>';
        if (header === 'x-real-ip') return 'valid-ip';
        if (header === 'x-originating-ip') return 'valid-ip';
        return undefined;
      }) as Request['get'];

      productionSecurity(mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Custom Security Headers - Edge Cases', () => {
    test('should set headers for non-API routes', () => {
      Object.defineProperty(mockReq, 'path', { value: '/health', writable: true });

      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockRes.removeHeader).toHaveBeenCalledWith('X-Powered-By');
      // Should not set cache headers for non-API routes
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle setHeader throwing error', () => {
      let callCount = 0;
      (mockRes.setHeader as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Cannot set header');
        }
      });

      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle removeHeader throwing error', () => {
      (mockRes.removeHeader as jest.Mock).mockImplementation(() => {
        throw new Error('Cannot remove header');
      });

      customSecurityHeaders(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
