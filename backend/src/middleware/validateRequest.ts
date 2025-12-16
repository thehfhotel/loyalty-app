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
        // Assign parsed result back to req.body to apply transforms
        req.body = options.parse(req.body);
      } else {
        // Validate different parts of the request and apply transforms
        if (options.body) {
          req.body = options.body.parse(req.body);
        }
        if (options.params) {
          req.params = options.params.parse(req.params);
        }
        if (options.query) {
          req.query = options.query.parse(req.query) as typeof req.query;
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