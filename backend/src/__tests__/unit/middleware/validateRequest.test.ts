import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { validateRequest } from '../../../middleware/validateRequest';
import { logger } from '../../../utils/logger';

// Mock logger
jest.mock('../../../utils/logger');

describe('validateRequest Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let mockLogger: jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      body: {},
      params: {},
      query: {},
      url: '/test',
      method: 'POST',
    };

    mockResponse = {};
    mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
    mockLogger = jest.mocked(logger);
  });

  describe('single schema validation (backward compatibility)', () => {
    it('should validate valid request body', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
      });

      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject invalid email format', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
      });

      mockRequest.body = {
        email: 'invalid-email',
        password: 'password123',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should reject password too short', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
      });

      mockRequest.body = {
        email: 'test@example.com',
        password: 'short',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should reject missing required fields', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
      });

      mockRequest.body = {
        email: 'test@example.com',
        // Missing password
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should allow optional fields', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        firstName: z.string().optional(),
      });

      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
        // firstName is optional
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('multi-part validation (body, params, query)', () => {
    it('should validate request body', () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      mockRequest.body = {
        name: 'John Doe',
        email: 'john@example.com',
      };

      const middleware = validateRequest({ body: bodySchema });
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate request params', () => {
      const paramsSchema = z.object({
        userId: z.string().uuid(),
      });

      mockRequest.params = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const middleware = validateRequest({ params: paramsSchema });
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate request query', () => {
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/),
        limit: z.string().regex(/^\d+$/),
      });

      mockRequest.query = {
        page: '1',
        limit: '10',
      };

      const middleware = validateRequest({ query: querySchema });
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate all parts simultaneously', () => {
      const bodySchema = z.object({
        name: z.string(),
      });

      const paramsSchema = z.object({
        userId: z.string().uuid(),
      });

      const querySchema = z.object({
        include: z.string().optional(),
      });

      mockRequest.body = { name: 'John Doe' };
      mockRequest.params = { userId: '550e8400-e29b-41d4-a716-446655440000' };
      mockRequest.query = { include: 'profile' };

      const middleware = validateRequest({
        body: bodySchema,
        params: paramsSchema,
        query: querySchema,
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject invalid params', () => {
      const paramsSchema = z.object({
        userId: z.string().uuid(),
      });

      mockRequest.params = {
        userId: 'not-a-uuid',
      };

      const middleware = validateRequest({ params: paramsSchema });
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should reject invalid query parameters', () => {
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/),
      });

      mockRequest.query = {
        page: 'invalid',
      };

      const middleware = validateRequest({ query: querySchema });
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });
  });

  describe('complex validation scenarios', () => {
    it('should validate nested objects', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            firstName: z.string(),
            lastName: z.string(),
          }),
        }),
      });

      mockRequest.body = {
        user: {
          profile: {
            firstName: 'John',
            lastName: 'Doe',
          },
        },
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate arrays', () => {
      const schema = z.object({
        items: z.array(z.object({
          id: z.string(),
          quantity: z.number().positive(),
        })),
      });

      mockRequest.body = {
        items: [
          { id: 'item-1', quantity: 2 },
          { id: 'item-2', quantity: 5 },
        ],
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject arrays with invalid items', () => {
      const schema = z.object({
        items: z.array(z.object({
          id: z.string(),
          quantity: z.number().positive(),
        })),
      });

      mockRequest.body = {
        items: [
          { id: 'item-1', quantity: 2 },
          { id: 'item-2', quantity: -5 }, // Invalid negative quantity
        ],
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should validate enums', () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
      });

      mockRequest.body = {
        status: 'active',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject invalid enum values', () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
      });

      mockRequest.body = {
        status: 'unknown',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should validate dates', () => {
      const schema = z.object({
        startDate: z.string().datetime(),
      });

      mockRequest.body = {
        startDate: '2024-01-01T00:00:00Z',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate numbers with constraints', () => {
      const schema = z.object({
        age: z.number().min(0).max(150),
        score: z.number().positive(),
      });

      mockRequest.body = {
        age: 25,
        score: 85.5,
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('error logging', () => {
    it('should log validation errors with request details', () => {
      const schema = z.object({
        email: z.string().email(),
      });

      mockRequest.body = { email: 'invalid' };
      mockRequest.url = '/api/users';
      mockRequest.method = 'POST';

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Validation Error Details:',
        expect.objectContaining({
          url: '/api/users',
          method: 'POST',
          requestBody: { email: 'invalid' },
        })
      );
    });

    it('should include error details in log', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
      });

      mockRequest.body = {
        email: 'invalid',
        password: 'short',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Validation Error Details:',
        expect.objectContaining({
          errors: expect.any(Array),
        })
      );
    });

    it('should log params and query in validation errors', () => {
      const paramsSchema = z.object({
        userId: z.string().uuid(),
      });

      mockRequest.params = { userId: 'invalid' };
      mockRequest.url = '/api/users/invalid';
      mockRequest.method = 'GET';

      const middleware = validateRequest({ params: paramsSchema });
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Validation Error Details:',
        expect.objectContaining({
          url: '/api/users/invalid',
          method: 'GET',
          requestParams: { userId: 'invalid' },
        })
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty body validation', () => {
      const schema = z.object({}).strict();

      mockRequest.body = {};

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject extra fields in strict mode', () => {
      const schema = z.object({
        name: z.string(),
      }).strict();

      mockRequest.body = {
        name: 'John',
        extraField: 'should not be here',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should allow extra fields in non-strict mode', () => {
      const schema = z.object({
        name: z.string(),
      });

      mockRequest.body = {
        name: 'John',
        extraField: 'allowed',
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle undefined body gracefully', () => {
      const schema = z.object({
        name: z.string(),
      });

      mockRequest.body = undefined;

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle null values', () => {
      const schema = z.object({
        optionalField: z.string().nullable(),
      });

      mockRequest.body = {
        optionalField: null,
      };

      const middleware = validateRequest(schema);
      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});
