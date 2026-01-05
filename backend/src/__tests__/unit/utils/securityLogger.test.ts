import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  logAuthEvent,
  logAccessEvent,
  logSecurityIncident,
  logAdminAction,
  securityLogger,
} from '../../../utils/securityLogger';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import the mocked logger to verify calls
import { logger } from '../../../utils/logger';

describe('SecurityLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logAuthEvent', () => {
    it('should log successful auth events as info', () => {
      logAuthEvent('LOGIN_SUCCESS', {
        userId: 'user-123',
        email: 'test@example.com',
        success: true,
        ip: '192.168.1.1',
      });

      expect(logger.info).toHaveBeenCalledWith(
        '[SECURITY:AUTH] LOGIN_SUCCESS',
        expect.objectContaining({
          category: 'AUTH',
          eventType: 'LOGIN_SUCCESS',
          success: true,
          _security: true,
        })
      );
    });

    it('should log failed auth events as warn', () => {
      logAuthEvent('LOGIN_FAILURE', {
        email: 'test@example.com',
        success: false,
        reason: 'Invalid password',
        ip: '192.168.1.1',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        '[SECURITY:AUTH] LOGIN_FAILURE',
        expect.objectContaining({
          category: 'AUTH',
          eventType: 'LOGIN_FAILURE',
          success: false,
          reason: 'Invalid password',
          _security: true,
        })
      );
    });
  });

  describe('logAccessEvent', () => {
    it('should log allowed access events as debug', () => {
      logAccessEvent('ACCESS_GRANTED', {
        userId: 'user-123',
        resource: '/api/admin',
        allowed: true,
      });

      expect(logger.debug).toHaveBeenCalledWith(
        '[SECURITY:ACCESS] ACCESS_GRANTED',
        expect.objectContaining({
          category: 'ACCESS',
          allowed: true,
        })
      );
    });

    it('should log denied access events as warn', () => {
      logAccessEvent('ACCESS_DENIED', {
        userId: 'user-123',
        resource: '/api/admin',
        allowed: false,
        reason: 'Insufficient permissions',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        '[SECURITY:ACCESS] ACCESS_DENIED',
        expect.objectContaining({
          category: 'ACCESS',
          allowed: false,
        })
      );
    });
  });

  describe('logSecurityIncident', () => {
    it('should log HIGH severity incidents as error', () => {
      logSecurityIncident('BRUTE_FORCE_ATTEMPT', {
        details: '10 failed login attempts',
        severity: 'HIGH',
        blocked: true,
        ip: '192.168.1.1',
      });

      expect(logger.error).toHaveBeenCalledWith(
        '[SECURITY:INCIDENT] BRUTE_FORCE_ATTEMPT',
        expect.objectContaining({
          category: 'SUSPICIOUS',
          severity: 'HIGH',
          blocked: true,
        })
      );
    });

    it('should log MEDIUM severity incidents as warn', () => {
      logSecurityIncident('SUSPICIOUS_HEADER', {
        details: 'Suspicious User-Agent detected',
        severity: 'MEDIUM',
        blocked: true,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        '[SECURITY:INCIDENT] SUSPICIOUS_HEADER',
        expect.objectContaining({
          severity: 'MEDIUM',
        })
      );
    });

    it('should log LOW severity incidents as info', () => {
      logSecurityIncident('RATE_LIMIT_EXCEEDED', {
        details: 'Rate limit exceeded for /api/auth',
        severity: 'LOW',
        blocked: true,
        ip: '192.168.1.1',
      });

      expect(logger.info).toHaveBeenCalledWith(
        '[SECURITY:INCIDENT] RATE_LIMIT_EXCEEDED',
        expect.objectContaining({
          severity: 'LOW',
        })
      );
    });
  });

  describe('logAdminAction', () => {
    it('should log admin actions as info', () => {
      logAdminAction('ROLE_CHANGED', {
        adminUserId: 'admin-123',
        targetUserId: 'user-456',
        changes: { oldRole: 'customer', newRole: 'admin' },
      });

      expect(logger.info).toHaveBeenCalledWith(
        '[SECURITY:ADMIN] ROLE_CHANGED',
        expect.objectContaining({
          category: 'ADMIN',
          eventType: 'ROLE_CHANGED',
        })
      );
    });
  });

  describe('securityLogger convenience methods', () => {
    it('should log login success', () => {
      securityLogger.loginSuccess('user-123', 'test@example.com', '192.168.1.1');
      expect(logger.info).toHaveBeenCalled();
    });

    it('should log login failure', () => {
      securityLogger.loginFailure('test@example.com', 'Invalid credentials', '192.168.1.1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should log logout', () => {
      securityLogger.logout('user-123', '192.168.1.1');
      expect(logger.info).toHaveBeenCalled();
    });

    it('should log account locked', () => {
      securityLogger.accountLocked('test@example.com', '5 failed attempts', '192.168.1.1');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should log brute force attempt', () => {
      securityLogger.bruteForceAttempt('test@example.com', 10, '192.168.1.1');
      expect(logger.error).toHaveBeenCalled(); // HIGH severity for 10+ attempts
    });

    it('should log rate limit exceeded', () => {
      securityLogger.rateLimitExceeded('192.168.1.1', '/api/auth');
      expect(logger.info).toHaveBeenCalled(); // LOW severity
    });
  });
});
