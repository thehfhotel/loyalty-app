import { Request, Response, NextFunction } from 'express';
import { JWTPayload } from '@hotel-loyalty/shared/types/auth';
import { authService } from '../services/authService.js';
import { securityLogger } from '../utils/logger.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Authentication middleware - verifies JWT token
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = authService.extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      securityLogger.warn('Authentication failed: No token provided', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
      });
      
      res.status(401).json({
        success: false,
        message: 'Access token required',
      });
      return;
    }

    const payload = authService.verifyAccessToken(token);
    req.user = payload;
    
    securityLogger.info('Authentication successful', {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      ip: req.ip,
      path: req.path,
    });
    
    next();
  } catch (error) {
    securityLogger.warn('Authentication failed: Invalid token', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
    });
    
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
};

/**
 * Authorization middleware - checks user role
 */
export const authorize = (allowedRoles: Array<'customer' | 'admin'>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      securityLogger.warn('Authorization failed: Insufficient permissions', {
        userId: req.user.userId,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        ip: req.ip,
        path: req.path,
      });
      
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
};

/**
 * Optional authentication middleware - doesn't fail if no token
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = authService.extractTokenFromHeader(req.headers.authorization);
    
    if (token) {
      const payload = authService.verifyAccessToken(token);
      req.user = payload;
    }
    
    next();
  } catch (error) {
    // Don't fail, just proceed without user
    next();
  }
};

/**
 * Admin only middleware
 */
export const adminOnly = authorize(['admin']);

/**
 * Customer only middleware
 */
export const customerOnly = authorize(['customer']);

/**
 * Customer or admin middleware
 */
export const authenticatedUser = authorize(['customer', 'admin']);