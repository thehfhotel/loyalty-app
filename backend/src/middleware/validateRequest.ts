import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger';

type ValidationOptions = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export function validateRequest(options: ZodSchema | ValidationOptions) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      // If it's a single schema, assume it's for body validation (backward compatibility)
      if ('parse' in options) {
        options.parse(req.body);
      } else {
        // Validate different parts of the request
        if (options.body) {
          options.body.parse(req.body);
        }
        if (options.params) {
          options.params.parse(req.params);
        }
        if (options.query) {
          options.query.parse(req.query);
        }
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error('Validation Error Details:', {
          url: req.url,
          method: req.method,
          errors: error.errors,
          requestBody: req.body,
          requestParams: req.params,
          requestQuery: req.query
        });
      }
      next(error);
    }
  };
}