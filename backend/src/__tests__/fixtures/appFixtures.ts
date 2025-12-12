/**
 * Express App Test Fixtures
 * Provides pre-configured Express apps for route testing
 */

import express, { Express, Request, Response, NextFunction, Router } from 'express';
import { errorHandler } from '../../middleware/errorHandler';

/**
 * Create a test Express app with standard middleware
 */
export const createTestApp = (routes: Router, basePath = '/api'): Express => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(basePath, routes);
  app.use(errorHandler);
  return app;
};

/**
 * Mock authentication middleware for testing
 */
export const createMockAuthMiddleware = (
  role: 'customer' | 'admin' | 'super_admin' = 'customer',
  userId = 'test-user-123'
) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = {
      id: userId,
      email: `${role}@test.com`,
      role,
    };
    next();
  };
};

/**
 * Mock Multer file upload middleware
 */
export const createMockMulterMiddleware = () => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      req.file = {
        buffer: Buffer.from('fake-image-data'),
        originalname: 'test-file.jpg',
        size: 1024,
        mimetype: 'image/jpeg',
      } as Express.Multer.File;
    }
    next();
  };
};

/**
 * Create mock error handler for testing error scenarios
 */
export const createMockErrorHandler = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express error handlers require 4 parameters
  return (error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  };
};
