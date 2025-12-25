import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';
import { AppError, errorHandler } from '../../../middleware/errorHandler';
import { logger } from '../../../utils/logger';

// Mock logger
jest.mock('../../../utils/logger');

describe('ErrorHandler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let mockLogger: jest.Mocked<typeof logger>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      url: '/test',
      method: 'POST',
      ip: '127.0.0.1',
    };

    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockResponse = {
      status: statusMock as unknown as Response['status'],
      json: jsonMock as unknown as Response['json'],
    };

    mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
    mockLogger = jest.mocked(logger);
  });

  describe('AppError class', () => {
    it('should create AppError with status code and message', () => {
      const error = new AppError(404, 'Resource not found');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Resource not found');
      expect(error.isOperational).toBe(true);
    });

    it('should set isOperational flag', () => {
      const operationalError = new AppError(400, 'Bad request', undefined, true);
      const nonOperationalError = new AppError(500, 'Server error', undefined, false);

      expect(operationalError.isOperational).toBe(true);
      expect(nonOperationalError.isOperational).toBe(false);
    });

    it('should maintain proper prototype chain', () => {
      const error = new AppError(500, 'Test error');

      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should have error message accessible', () => {
      const error = new AppError(403, 'Forbidden');

      expect(error.message).toBe('Forbidden');
      expect(error.toString()).toContain('Forbidden');
    });
  });

  describe('ZodError handling', () => {
    it('should handle ZodError with validation details', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().positive(),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ email: 'invalid', age: -5 });
      } catch (error) {
        if (error instanceof ZodError) {
          zodError = error;
        }
      }

      expect(zodError).toBeDefined();
      if (zodError) {
        errorHandler(
          zodError,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Validation failed',
          details: expect.any(Array),
        });
      }
    });

    it('should format ZodError details correctly', () => {
      const schema = z.object({
        email: z.string().email(),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ email: 'invalid-email' });
      } catch (error) {
        if (error instanceof ZodError) {
          zodError = error;
        }
      }

      expect(zodError).toBeDefined();
      if (zodError) {
        errorHandler(
          zodError,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        const callArgs = jsonMock.mock.calls[0]?.[0] as { details: Array<{ field: string; message: string }> };
        expect(callArgs?.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: expect.any(String),
              message: expect.any(String),
            }),
          ])
        );
      }
    });

    it('should handle multiple validation errors', () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        age: z.number().positive(),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({
          email: 'invalid',
          password: 'short',
          age: -1,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          zodError = error;
        }
      }

      expect(zodError).toBeDefined();
      if (zodError) {
        errorHandler(
          zodError,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        const callArgs = jsonMock.mock.calls[0]?.[0] as { details: unknown[] };
        expect(callArgs?.details?.length).toBeGreaterThan(0);
      }
    });

    it('should handle nested field validation errors', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({
          user: {
            profile: {
              email: 'invalid',
            },
          },
        });
      } catch (error) {
        if (error instanceof ZodError) {
          zodError = error;
        }
      }

      expect(zodError).toBeDefined();
      if (zodError) {
        errorHandler(
          zodError,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        const callArgs = jsonMock.mock.calls[0]?.[0] as { details: Array<{ field: string }> };
        expect(callArgs?.details[0]?.field).toContain('user');
      }
    });
  });

  describe('AppError handling', () => {
    it('should handle 401 Unauthorized error', () => {
      const error = new AppError(401, 'Not authenticated');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Not authenticated',
      });
    });

    it('should handle 403 Forbidden error', () => {
      const error = new AppError(403, 'Insufficient permissions');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Insufficient permissions',
      });
    });

    it('should handle 404 Not Found error', () => {
      const error = new AppError(404, 'Resource not found');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Resource not found',
      });
    });

    it('should handle 409 Conflict error', () => {
      const error = new AppError(409, 'Resource already exists');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Resource already exists',
      });
    });

    it('should handle custom status codes', () => {
      const error = new AppError(418, "I'm a teapot");

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(418);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "I'm a teapot",
      });
    });

    it('should include error code when data is provided', () => {
      const error = new AppError(409, 'Email already registered', { code: 'EMAIL_ALREADY_REGISTERED' });

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email already registered',
        code: 'EMAIL_ALREADY_REGISTERED',
      });
    });

    it('should include multiple data fields when provided', () => {
      const error = new AppError(400, 'Invalid request', { code: 'INVALID_INPUT', field: 'email' });

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid request',
        code: 'INVALID_INPUT',
        field: 'email',
      });
    });
  });

  describe('unexpected error handling', () => {
    it('should log unexpected errors', () => {
      const error = new Error('Unexpected database error');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error:',
        expect.objectContaining({
          error: 'Unexpected database error',
          url: '/test',
          method: 'POST',
          ip: '127.0.0.1',
        })
      );
    });

    it('should include stack trace in logs', () => {
      const error = new Error('Test error');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error:',
        expect.objectContaining({
          stack: expect.any(String),
        })
      );
    });

    it('should return 500 for unexpected errors', () => {
      const error = new Error('Unexpected error');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(500);
    });

    it('should hide error details in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Sensitive internal error');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Internal server error',
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should expose error details in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Detailed development error');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Detailed development error',
      });

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('error type precedence', () => {
    it('should handle ZodError before generic Error', () => {
      const schema = z.object({
        email: z.string().email(),
      });

      let zodError: ZodError | undefined;
      try {
        schema.parse({ email: 'invalid' });
      } catch (error) {
        if (error instanceof ZodError) {
          zodError = error;
        }
      }

      expect(zodError).toBeDefined();
      if (zodError) {
        errorHandler(
          zodError,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Validation failed',
          })
        );
      }
    });

    it('should handle AppError before generic Error', () => {
      const appError = new AppError(404, 'Not found');

      errorHandler(
        appError,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Not found',
      });
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle errors without message', () => {
      const error = new Error();

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(500);
    });

    it('should handle errors without stack trace', () => {
      const error = new Error('Error without stack');
      delete error.stack;

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(500);
    });

    it('should handle null or undefined request properties', () => {
      (mockRequest as Record<string, unknown>).url = undefined;
      (mockRequest as Record<string, unknown>).method = undefined;
      (mockRequest as Record<string, unknown>).ip = undefined;

      const error = new Error('Test error');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockLogger.error).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(500);
    });

    it('should not call next function (terminal middleware)', () => {
      const error = new AppError(400, 'Bad request');

      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('response consistency', () => {
    it('should always return JSON responses', () => {
      const errors = [
        new AppError(404, 'Not found'),
        new Error('Unexpected error'),
      ];

      errors.forEach((error) => {
        jsonMock.mockClear();
        statusMock.mockClear();

        errorHandler(
          error,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock).toHaveBeenCalled();
        expect(jsonMock.mock.calls[0]).toBeDefined();
        if (jsonMock.mock.calls[0]) {
          expect(typeof jsonMock.mock.calls[0][0]).toBe('object');
        }
      });
    });

    it('should include error field in all responses', () => {
      const errors = [
        new AppError(404, 'Not found'),
        new Error('Unexpected error'),
      ];

      errors.forEach((error) => {
        jsonMock.mockClear();
        statusMock.mockClear();

        errorHandler(
          error,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock.mock.calls[0]).toBeDefined();
        if (jsonMock.mock.calls[0]) {
          const response = jsonMock.mock.calls[0][0];
          expect(response).toHaveProperty('error');
        }
      });
    });

    it('should return appropriate HTTP status codes', () => {
      const testCases = [
        { error: new AppError(400, 'Bad request'), expectedStatus: 400 },
        { error: new AppError(401, 'Unauthorized'), expectedStatus: 401 },
        { error: new AppError(403, 'Forbidden'), expectedStatus: 403 },
        { error: new AppError(404, 'Not found'), expectedStatus: 404 },
        { error: new Error('Server error'), expectedStatus: 500 },
      ];

      testCases.forEach(({ error, expectedStatus }) => {
        statusMock.mockClear();
        jsonMock.mockClear();

        errorHandler(
          error,
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(expectedStatus);
      });
    });
  });
});
