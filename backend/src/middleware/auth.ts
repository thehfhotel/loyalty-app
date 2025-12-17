import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { AppError } from './errorHandler';
import { UserRole } from '../types/auth';
import { query } from '../config/database';

const authService = new AuthService();

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'No token provided');
    }

    const token = authHeader.substring(7);
    const payload = await authService.verifyToken(token);

    req.user = payload;
    next();
  } catch (error) {
    next(error);
  }
}

export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Not authenticated'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, 'Insufficient permissions'));
    }

    next();
  };
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Not authenticated'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, 'Insufficient permissions'));
    }

    next();
  };
}

/**
 * Middleware to require admin role with database verification.
 * This checks the CURRENT role in the database, not just the JWT payload.
 * Use this for sensitive admin operations where role changes should take effect immediately.
 */
/**
 * Optional authentication middleware.
 * Parses JWT if present but doesn't require it.
 * Use this for routes that should work for both authenticated and unauthenticated users.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = await authService.verifyToken(token);
        req.user = payload;
      } catch {
        // Token invalid or expired - just continue without auth
        // This is intentional - the route can decide whether auth is required
      }
    }
    next();
  } catch {
    // Don't fail on auth errors - just continue without auth
    next();
  }
}

export function requireAdmin() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new AppError(401, 'Not authenticated'));
      }

      // Fetch current role from database (not just JWT payload)
      const [user] = await query<{ role: UserRole }>(
        'SELECT role FROM users WHERE id = $1 AND is_active = true',
        [req.user.id]
      );

      if (!user) {
        return next(new AppError(401, 'User not found or inactive'));
      }

      // Update req.user with current role from database
      req.user.role = user.role;

      if (!['admin', 'super_admin'].includes(user.role)) {
        return next(new AppError(403, 'Admin access required'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}