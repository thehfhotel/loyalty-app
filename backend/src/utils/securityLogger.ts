/**
 * Security Logger
 * Specialized logger for security events providing audit trail for:
 * - Authentication events (login, logout, failures)
 * - Authorization events (access granted/denied)
 * - Security incidents (suspicious activity, blocked requests)
 * - Admin actions (user management, configuration changes)
 */

import { logger } from './logger';
import { sanitizeUserId, sanitizeEmail, sanitizeLogValue } from './logSanitizer';

// Security event categories
export type SecurityEventCategory = 'AUTH' | 'ACCESS' | 'SUSPICIOUS' | 'ADMIN';

// Auth event types
export type AuthEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'TOKEN_REFRESH'
  | 'TOKEN_INVALID'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_COMPLETE'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'
  | 'REGISTRATION'
  | 'EMAIL_VERIFICATION';

// Access event types
export type AccessEventType =
  | 'ACCESS_GRANTED'
  | 'ACCESS_DENIED'
  | 'PERMISSION_CHECK'
  | 'ROLE_ESCALATION'
  | 'RESOURCE_ACCESS';

// Suspicious activity types
export type SuspiciousEventType =
  | 'BRUTE_FORCE_ATTEMPT'
  | 'INVALID_TOKEN'
  | 'SUSPICIOUS_HEADER'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SQL_INJECTION_ATTEMPT'
  | 'XSS_ATTEMPT'
  | 'PATH_TRAVERSAL'
  | 'SUSPICIOUS_USER_AGENT';

// Admin action types
export type AdminEventType =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'ROLE_CHANGED'
  | 'CONFIG_CHANGED'
  | 'SECURITY_SETTING_CHANGED';

// Base security event interface
interface BaseSecurityEvent {
  timestamp: string;
  category: SecurityEventCategory;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

// Auth event data
interface AuthEventData extends BaseSecurityEvent {
  category: 'AUTH';
  eventType: AuthEventType;
  userId?: string;
  email?: string;
  success: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Access event data
interface AccessEventData extends BaseSecurityEvent {
  category: 'ACCESS';
  eventType: AccessEventType;
  userId?: string;
  resource?: string;
  action?: string;
  allowed: boolean;
  reason?: string;
}

// Suspicious event data
interface SuspiciousEventData extends BaseSecurityEvent {
  category: 'SUSPICIOUS';
  eventType: SuspiciousEventType;
  userId?: string;
  details: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  blocked: boolean;
}

// Admin event data
interface AdminEventData extends BaseSecurityEvent {
  category: 'ADMIN';
  eventType: AdminEventType;
  adminUserId: string;
  targetUserId?: string;
  changes?: Record<string, unknown>;
  reason?: string;
}

/**
 * Format a security event for logging
 */
function formatSecurityEvent(
  event: AuthEventData | AccessEventData | SuspiciousEventData | AdminEventData
): Record<string, unknown> {
  return {
    ...event,
    // Ensure timestamp is present
    timestamp: event.timestamp ?? new Date().toISOString(),
    // Add security log marker for easy filtering
    _security: true,
  };
}

/**
 * Log an authentication event
 */
export function logAuthEvent(
  eventType: AuthEventType,
  data: {
    userId?: string;
    email?: string;
    success: boolean;
    reason?: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  const event: AuthEventData = {
    timestamp: new Date().toISOString(),
    category: 'AUTH',
    eventType,
    userId: data.userId ? sanitizeUserId(data.userId) : undefined,
    email: data.email ? sanitizeEmail(data.email) : undefined,
    success: data.success,
    reason: data.reason,
    ip: data.ip,
    userAgent: data.userAgent,
    requestId: data.requestId,
    metadata: data.metadata,
  };

  const formattedEvent = formatSecurityEvent(event);

  if (data.success) {
    logger.info(`[SECURITY:AUTH] ${eventType}`, formattedEvent);
  } else {
    logger.warn(`[SECURITY:AUTH] ${eventType}`, formattedEvent);
  }
}

/**
 * Log an access/authorization event
 */
export function logAccessEvent(
  eventType: AccessEventType,
  data: {
    userId?: string;
    resource?: string;
    action?: string;
    allowed: boolean;
    reason?: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
  }
): void {
  const event: AccessEventData = {
    timestamp: new Date().toISOString(),
    category: 'ACCESS',
    eventType,
    userId: data.userId ? sanitizeUserId(data.userId) : undefined,
    resource: data.resource,
    action: data.action,
    allowed: data.allowed,
    reason: data.reason,
    ip: data.ip,
    userAgent: data.userAgent,
    requestId: data.requestId,
  };

  const formattedEvent = formatSecurityEvent(event);

  if (data.allowed) {
    logger.debug(`[SECURITY:ACCESS] ${eventType}`, formattedEvent);
  } else {
    logger.warn(`[SECURITY:ACCESS] ${eventType}`, formattedEvent);
  }
}

/**
 * Log a security incident or suspicious activity
 */
export function logSecurityIncident(
  eventType: SuspiciousEventType,
  data: {
    userId?: string;
    details: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    blocked: boolean;
    ip?: string;
    userAgent?: string;
    requestId?: string;
  }
): void {
  const event: SuspiciousEventData = {
    timestamp: new Date().toISOString(),
    category: 'SUSPICIOUS',
    eventType,
    userId: data.userId ? sanitizeUserId(data.userId) : undefined,
    details: sanitizeLogValue(data.details),
    severity: data.severity,
    blocked: data.blocked,
    ip: data.ip,
    userAgent: data.userAgent,
    requestId: data.requestId,
  };

  const formattedEvent = formatSecurityEvent(event);

  // Log level based on severity
  switch (data.severity) {
    case 'CRITICAL':
    case 'HIGH':
      logger.error(`[SECURITY:INCIDENT] ${eventType}`, formattedEvent);
      break;
    case 'MEDIUM':
      logger.warn(`[SECURITY:INCIDENT] ${eventType}`, formattedEvent);
      break;
    default:
      logger.info(`[SECURITY:INCIDENT] ${eventType}`, formattedEvent);
  }
}

/**
 * Log an admin action
 */
export function logAdminAction(
  eventType: AdminEventType,
  data: {
    adminUserId: string;
    targetUserId?: string;
    changes?: Record<string, unknown>;
    reason?: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
  }
): void {
  const event: AdminEventData = {
    timestamp: new Date().toISOString(),
    category: 'ADMIN',
    eventType,
    adminUserId: sanitizeUserId(data.adminUserId),
    targetUserId: data.targetUserId ? sanitizeUserId(data.targetUserId) : undefined,
    changes: data.changes,
    reason: data.reason,
    ip: data.ip,
    userAgent: data.userAgent,
    requestId: data.requestId,
  };

  const formattedEvent = formatSecurityEvent(event);
  logger.info(`[SECURITY:ADMIN] ${eventType}`, formattedEvent);
}

/**
 * Convenience methods for common auth events
 */
export const securityLogger = {
  // Auth events
  loginSuccess: (userId: string, email: string, ip?: string, userAgent?: string) =>
    logAuthEvent('LOGIN_SUCCESS', { userId, email, success: true, ip, userAgent }),

  loginFailure: (email: string, reason: string, ip?: string, userAgent?: string) =>
    logAuthEvent('LOGIN_FAILURE', { email, success: false, reason, ip, userAgent }),

  logout: (userId: string, ip?: string) =>
    logAuthEvent('LOGOUT', { userId, success: true, ip }),

  accountLocked: (email: string, reason: string, ip?: string) =>
    logAuthEvent('ACCOUNT_LOCKED', { email, success: false, reason, ip }),

  registration: (userId: string, email: string, ip?: string) =>
    logAuthEvent('REGISTRATION', { userId, email, success: true, ip }),

  // Access events
  accessDenied: (userId: string, resource: string, reason: string, ip?: string) =>
    logAccessEvent('ACCESS_DENIED', { userId, resource, allowed: false, reason, ip }),

  // Security incidents
  bruteForceAttempt: (email: string, attempts: number, ip?: string) =>
    logSecurityIncident('BRUTE_FORCE_ATTEMPT', {
      details: `${attempts} failed login attempts for ${sanitizeEmail(email)}`,
      severity: attempts >= 10 ? 'HIGH' : 'MEDIUM',
      blocked: attempts >= 5,
      ip,
    }),

  suspiciousRequest: (details: string, ip?: string, userAgent?: string) =>
    logSecurityIncident('SUSPICIOUS_HEADER', {
      details,
      severity: 'MEDIUM',
      blocked: true,
      ip,
      userAgent,
    }),

  rateLimitExceeded: (ip: string, endpoint: string) =>
    logSecurityIncident('RATE_LIMIT_EXCEEDED', {
      details: `Rate limit exceeded for ${endpoint}`,
      severity: 'LOW',
      blocked: true,
      ip,
    }),

  // Admin actions
  userRoleChanged: (adminId: string, targetUserId: string, oldRole: string, newRole: string) =>
    logAdminAction('ROLE_CHANGED', {
      adminUserId: adminId,
      targetUserId,
      changes: { oldRole, newRole },
    }),
};

export default securityLogger;
