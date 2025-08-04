/**
 * Security Middleware Configuration
 * Comprehensive security headers and protection measures
 */

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { securityConfig, isProduction } from '../config/environment';
import { logger } from '../utils/logger';

// Rate limiting configuration
export const createRateLimiter = () => {
  return rateLimit({
    windowMs: securityConfig.rateLimitWindowMs, // 15 minutes
    max: securityConfig.rateLimitMaxRequests, // limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(securityConfig.rateLimitWindowMs / 1000 / 60), // minutes
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/api/health' || req.path === '/health';
    },
    handler: (req: Request, res: Response) => {
      logger.warn('Rate limit reached', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
      });
      res.status(429).json({
        error: 'Too many requests',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(securityConfig.rateLimitWindowMs / 1000 / 60),
      });
    },
  });
};

// API-specific rate limiter (stricter)
export const createApiRateLimiter = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 50 API requests per windowMs
    message: {
      error: 'API rate limit exceeded',
      message: 'Too many API requests from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Authentication rate limiter (very strict)
export const createAuthRateLimiter = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 login attempts per windowMs
    message: {
      error: 'Authentication rate limit exceeded',
      message: 'Too many login attempts from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
    handler: (req: Request, res: Response) => {
      logger.warn('Authentication rate limit reached', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
      });
      res.status(429).json({
        error: 'Authentication rate limit exceeded',
        message: 'Too many login attempts from this IP, please try again later.',
      });
    },
  });
};

// Security headers configuration
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  
  // Referrer Policy
  referrerPolicy: {
    policy: ['same-origin'],
  },
  
  // Cross-Origin Embedder Policy
  crossOriginEmbedderPolicy: false, // Disable if needed for embedding
  
  // Other security headers
  noSniff: true, // X-Content-Type-Options: nosniff
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY
  hidePoweredBy: true, // Remove X-Powered-By header
  ieNoOpen: true, // X-Download-Options: noopen for IE8+
  xssFilter: true, // X-XSS-Protection: 1; mode=block
});

// Custom security headers middleware
export const customSecurityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Add custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Remove potentially sensitive headers
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // Add security headers for API responses
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  
  next();
};

// Input validation middleware to prevent injection attacks
export const inputSanitization = (req: Request, _res: Response, next: NextFunction) => {
  // Basic input sanitization
  const sanitizeValue = (value: any): any => {
    if (typeof value === 'string') {
      // Remove potentially dangerous characters
      return value
        .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags (safer regex)
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers
        .trim();
    }
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    if (value && typeof value === 'object') {
      const sanitized: any = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }
    return value;
  };
  
  // Sanitize request body
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeValue(req.query);
  }
  
  next();
};

// File upload security middleware
export const fileUploadSecurity = (req: Request, res: Response, next: NextFunction) => {
  // Check file size
  const contentLength = parseInt(req.get('content-length') ?? '0', 10);
  if (contentLength > securityConfig.maxFileSize) {
    return res.status(413).json({
      error: 'File too large',
      message: `File size exceeds the maximum allowed size of ${securityConfig.maxFileSize} bytes`,
    });
  }
  
  return next();
};

// Security monitoring middleware
export const securityMonitoring = (req: Request, _res: Response, next: NextFunction) => {
  // Log suspicious requests
  const suspiciousPatterns = [
    /\.\.\//g, // Directory traversal
    /<script/gi, // Script injection
    /union\s+select/gi, // SQL injection
    /javascript:/gi, // XSS attempts
    /%00/g, // Null byte injection
  ];
  
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const userAgent = req.get('User-Agent') ?? '';
  const body = JSON.stringify(req.body ?? {});
  
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(fullUrl) || pattern.test(userAgent) || pattern.test(body)
  );
  
  if (isSuspicious) {
    logger.warn('Suspicious request detected', {
      ip: req.ip,
      method: req.method,
      url: fullUrl,
      userAgent,
      body: req.body,
      headers: req.headers,
    });
  }
  
  next();
};

// Production-specific security middleware
export const productionSecurity = (req: Request, res: Response, next: NextFunction) => {
  if (!isProduction()) {
    return next();
  }
  
  // Additional production security measures
  
  // Block requests with suspicious headers
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'x-originating-ip'];
  for (const header of suspiciousHeaders) {
    const value = req.get(header);
    if (value && (value.includes('..') || value.includes('<') || value.includes('>'))) {
      logger.warn('Suspicious header detected in production', {
        ip: req.ip,
        header,
        value,
      });
      return res.status(400).json({ error: 'Invalid request headers' });
    }
  }
  
  // Require HTTPS in production
  if (!req.secure && req.get('x-forwarded-proto') !== 'https') {
    logger.warn('HTTP request detected in production', {
      ip: req.ip,
      url: req.url,
    });
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  
  next();
};