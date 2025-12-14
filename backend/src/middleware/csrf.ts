/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern for CSRF protection
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Generate a cryptographically secure CSRF token
 */
export const generateCsrfToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Timing-safe string comparison to prevent timing attacks
 */
const timingSafeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  return crypto.timingSafeEqual(bufferA, bufferB);
};

/**
 * CSRF Protection Middleware
 * Uses double-submit cookie pattern:
 * 1. Sets CSRF token in HttpOnly cookie
 * 2. Client reads token from endpoint and includes in X-CSRF-Token header
 * 3. Server verifies header matches cookie
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

  // Skip CSRF validation for safe methods
  if (safeMethods.includes(req.method)) {
    // Always set/refresh CSRF token for safe methods
    const token = generateCsrfToken();
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    return next();
  }

  // For unsafe methods (POST, PUT, DELETE, etc.), verify CSRF token
  const tokenFromHeader = req.get('X-CSRF-Token') ?? req.get('x-csrf-token');
  const tokenFromCookie = req.cookies?.['XSRF-TOKEN'] as string | undefined;

  if (!tokenFromHeader || !tokenFromCookie) {
    logger.warn('CSRF token missing', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      hasHeader: !!tokenFromHeader,
      hasCookie: !!tokenFromCookie,
    });
    res.status(403).json({
      error: 'CSRF token missing',
      message: 'CSRF token is required for this request',
    });
    return;
  }

  // Use timing-safe comparison to prevent timing attacks
  if (!timingSafeCompare(tokenFromHeader, tokenFromCookie)) {
    logger.warn('CSRF token mismatch', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(403).json({
      error: 'CSRF token invalid',
      message: 'CSRF token validation failed',
    });
    return;
  }

  // Token is valid, proceed with request
  next();
};

/**
 * Endpoint handler to get CSRF token
 * Client can call this to retrieve the token for subsequent requests
 */
export const getCsrfToken = (req: Request, res: Response): void => {
  const existingToken = req.cookies?.['XSRF-TOKEN'] as string | undefined;
  const token = existingToken ?? generateCsrfToken();

  // Set cookie if not already set
  if (!existingToken) {
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  res.json({ csrfToken: token });
};
