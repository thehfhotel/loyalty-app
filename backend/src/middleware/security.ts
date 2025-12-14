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

// API-specific rate limiter with user-aware rate limiting
export const createApiRateLimiter = () => {
  // Safe rate limits for development (still generous for React StrictMode)
  const developmentLimits = {
    windowMs: 1 * 60 * 1000, // 1 minute window in development
    max: 200, // Safe development limit: 200 requests per minute
  };

  const productionLimits = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Safe production limit: 300 requests per 15 minutes
  };

  const limits = isProduction() ? productionLimits : developmentLimits;
  
  return rateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    message: {
      error: 'API rate limit exceeded',
      message: `Too many API requests from this IP, please try again later. ${!isProduction() ? '(Development mode - limits are more lenient)' : ''}`,
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use composite key: IP + User ID (when available) for better rate limiting
    keyGenerator: (req) => {
      const userId = req.user?.id ?? 'anonymous';
      const ip = req.ip ?? 'unknown';
      
      // In production, use user-specific rate limiting when authenticated
      if (isProduction() && req.user?.id) {
        return `user:${userId}:${ip}`;
      }
      
      // Fallback to IP-based rate limiting for anonymous users
      return `ip:${ip}`;
    },
    skip: (req) => {
      // In development, skip rate limiting for localhost and Docker network requests
      if (!isProduction()) {
        const devBypassIPs = [
          '127.0.0.1',           // IPv4 localhost
          '::1',                 // IPv6 localhost  
          '::ffff:127.0.0.1',    // IPv4-mapped IPv6 localhost
          '192.168.65.1',        // Docker Desktop network gateway
          '172.17.0.1',          // Default Docker bridge network gateway
          '172.18.0.1',          // Docker Compose network gateway
          '10.0.0.1'             // Common Docker network gateway
        ];
        if (req.ip && (devBypassIPs.includes(req.ip) || req.ip.startsWith('192.168.') || req.ip.startsWith('172.'))) {
          return true;
        }
      }
      return false;
    },
  });
};

// Per-user rate limiter for authenticated API requests
export const createUserRateLimiter = () => {
  const developmentLimits = {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10000, // 100x increase: 100 -> 10,000 per user per minute
  };
  
  const productionLimits = {
    windowMs: 15 * 60 * 1000, // 15 minutes  
    max: 10000, // 100x increase: 100 -> 10,000 per user per 15 minutes
  };
  
  const limits = isProduction() ? productionLimits : developmentLimits;
  
  return rateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    message: {
      error: 'User rate limit exceeded',
      message: 'Too many requests from your account, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID as key for per-user rate limiting
      return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    },
    skip: (req) => {
      // Skip in development for local testing
      if (!isProduction()) {
        const devBypassIPs = [
          '127.0.0.1', '::1', '::ffff:127.0.0.1',
          '192.168.65.1', '172.17.0.1', '172.18.0.1', '10.0.0.1'
        ];
        if (req.ip && (devBypassIPs.includes(req.ip) || req.ip.startsWith('192.168.') || req.ip.startsWith('172.'))) {
          return true;
        }
      }
      
      // Only apply to authenticated users in production
      return isProduction() && !req.user?.id;
    },
    handler: (req: Request, res: Response) => {
      logger.warn('User rate limit reached', {
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
      });
      res.status(429).json({
        error: 'User rate limit exceeded',
        message: 'Too many requests from your account, please try again later.',
      });
    },
  });
};

// Authentication rate limiter (strict for production, lenient for development)
export const createAuthRateLimiter = () => {
  const developmentLimits = {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 auth attempts per minute in development (React StrictMode friendly)
  };

  const productionLimits = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 auth attempts per 15 minutes in production
  };

  const limits = isProduction() ? productionLimits : developmentLimits;

  return rateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    message: {
      error: 'Authentication rate limit exceeded',
      message: `Too many login attempts from this IP, please try again later. ${!isProduction() ? '(Development mode - limits are more lenient)' : ''}`,
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
    skip: (req) => {
      // In development, skip rate limiting for localhost and Docker network requests
      if (!isProduction()) {
        const devBypassIPs = [
          '127.0.0.1',           // IPv4 localhost
          '::1',                 // IPv6 localhost
          '::ffff:127.0.0.1',    // IPv4-mapped IPv6 localhost
          '192.168.65.1',        // Docker Desktop network gateway
          '172.17.0.1',          // Default Docker bridge network gateway
          '172.18.0.1',          // Docker Compose network gateway
          '10.0.0.1'             // Common Docker network gateway
        ];
        if (req.ip && (devBypassIPs.includes(req.ip) || req.ip.startsWith('192.168.') || req.ip.startsWith('172.'))) {
          return true;
        }
      }
      return false;
    },
    handler: (req: Request, res: Response) => {
      logger.warn('Authentication rate limit reached', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
      });
      res.status(429).json({
        error: 'Authentication rate limit exceeded',
        message: `Too many login attempts from this IP, please try again later. ${!isProduction() ? '(Development mode)' : ''}`,
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
  try {
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
  } catch (error) {
    // Log error but continue - security headers are non-critical for request processing
    logger.warn('Failed to set security headers', { error });
  }

  next();
};

// Input validation middleware to prevent injection attacks
export const inputSanitization = (req: Request, _res: Response, next: NextFunction) => {
  // Track visited objects to detect circular references
  const visited = new WeakSet<object>();

  // Maximum input length to prevent DoS attacks (per CodeQL recommendation)
  const MAX_INPUT_LENGTH = 10000;

  // Basic input sanitization with circular reference detection
  const sanitizeValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let sanitized = value;

      // Limit input length to prevent ReDoS attacks (CodeQL recommendation)
      if (sanitized.length > MAX_INPUT_LENGTH) {
        sanitized = sanitized.substring(0, MAX_INPUT_LENGTH);
      }

      // Normalize whitespace first - collapse multiple spaces/tabs to single space
      // This eliminates the need for \s* patterns which can cause ReDoS
      sanitized = sanitized.replace(/[ \t]+/g, ' ');

      // HTML encode angle brackets FIRST to prevent tag injection
      // This is safer than regex-based tag removal which can be bypassed
      sanitized = sanitized.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Remove dangerous URL schemes (case-insensitive)
      // After whitespace normalization, only need to handle single space variant
      // Use replaceAll for complete removal without ReDoS-vulnerable loops
      const dangerousSchemes = ['javascript:', 'javascript :', 'vbscript:', 'vbscript :', 'data:', 'data :'];
      for (const scheme of dangerousSchemes) {
        // Case-insensitive replacement using split/join (safe, no regex)
        const lowerSanitized = sanitized.toLowerCase();
        let index = lowerSanitized.indexOf(scheme);
        while (index !== -1) {
          sanitized = sanitized.substring(0, index) + sanitized.substring(index + scheme.length);
          const newLower = sanitized.toLowerCase();
          index = newLower.indexOf(scheme);
        }
      }

      // Remove event handlers (on* attributes)
      // Pattern: word boundary + "on" + alphanumeric/dash + optional space + "="
      // After whitespace normalization, space is at most one character
      // Use a simple, non-backtracking approach
      const eventHandlerPattern = /\bon[a-z][a-z0-9-]* ?=/gi;
      let previousLength = -1;
      // Loop until stable (handles nested patterns like "oonclick=nclick=")
      while (sanitized.length !== previousLength) {
        previousLength = sanitized.length;
        sanitized = sanitized.replace(eventHandlerPattern, '');
      }

      return sanitized.trim();
    }
    if (Array.isArray(value)) {
      // Check for circular reference in arrays
      if (visited.has(value)) {
        return '[Circular Reference]';
      }
      visited.add(value);
      return value.map(sanitizeValue);
    }
    if (value && typeof value === 'object' && value !== null) {
      // Check for circular reference in objects
      if (visited.has(value)) {
        return '[Circular Reference]';
      }
      visited.add(value);

      const sanitized: Record<string, unknown> = {};
      // Use known safe method for object iteration to avoid injection
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, val] of entries) {
        // Validate key is safe before using as property accessor
        if (typeof key === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
          // eslint-disable-next-line security/detect-object-injection -- Safe: key validated with regex
          sanitized[key] = sanitizeValue(val);
        }
      }
      return sanitized;
    }
    return value;
  };
  
  // Sanitize request body
  if (req.body) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.body = sanitizeValue(req.body) as any;
  }
  
  // Sanitize query parameters (in-place to work with Express 5's read-only req.query)
  if (req.query && typeof req.query === 'object') {
    // Use Object.entries to iterate safely without index-based access
    for (const [key, value] of Object.entries(req.query)) {
      const sanitized = sanitizeValue(value);
      // Mutate in place since req.query is read-only in Express 5
      Object.defineProperty(req.query, key, {
        value: sanitized,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
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
  
  // Require HTTPS in production - Cloudflare tunnel compatible
  const forwardedProto = req.get('x-forwarded-proto') ?? req.get('X-Forwarded-Proto');
  const cfVisitor = req.get('cf-visitor');
  
  // Check Cloudflare's cf-visitor header first (most reliable for Cloudflare Tunnel)
  let isCloudflareHttps = false;
  if (cfVisitor) {
    try {
      const visitor = JSON.parse(cfVisitor);
      isCloudflareHttps = visitor.scheme === 'https';
    } catch (error) {
      logger.warn('Failed to parse cf-visitor header', { 
        cfVisitor, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
  
  const isHttps = req.secure || forwardedProto === 'https' || isCloudflareHttps;
  
  // Enhanced logging for debugging Cloudflare tunnel
  logger.info('Production security check', {
    ip: req.ip,
    url: req.url,
    method: req.method,
    secure: req.secure,
    forwardedProto,
    cfVisitor,
    isCloudflareHttps,
    isHttps,
    host: req.get('host'),
    userAgent: req.get('user-agent')
  });
  
  if (!isHttps) {
    logger.warn('HTTP request detected in production - redirecting to HTTPS', {
      ip: req.ip,
      url: req.url,
      secure: req.secure,
      forwardedProto,
      isCloudflareHttps
    });
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  
  next();
};