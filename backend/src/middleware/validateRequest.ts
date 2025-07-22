import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger';

export function validateRequest(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error('Validation Error Details:', {
          url: req.url,
          method: req.method,
          errors: error.errors,
          requestBody: req.body
        });
      }
      next(error);
    }
  };
}