/**
 * tRPC Admin Router Integration Tests
 * Tests admin email management endpoints with authentication and authorization
 */

import { TRPCError } from '@trpc/server';
import { mockUsers, createCallerWithUser, createUnauthenticatedCaller } from './helpers';

// Create mock emailService instance
const mockEmailService = {
  getHealthStatus: jest.fn(),
  testEmailDelivery: jest.fn(),
};

// Mock the emailService before importing the router
jest.mock('../../../services/emailService', () => ({
  emailService: mockEmailService,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import router after mocks are set up
import { adminRouter } from '../../../trpc/routers/admin';

describe('tRPC Admin Router - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== admin.email.getStatus Tests ==========
  describe('admin.email.getStatus', () => {
    it('should return email status for admin user', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockStatus = {
        configured: true,
        smtpConnected: true,
        imapConnected: true,
        lastTestResult: {
          success: true,
          timestamp: '2024-01-15T10:30:00Z',
          deliveryTimeMs: 1500,
        },
      };
      mockEmailService.getHealthStatus.mockResolvedValue(mockStatus);

      const result = await caller.email.getStatus();

      expect(mockEmailService.getHealthStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStatus);
    });

    it('should return email status for super admin user', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.superAdmin);
      const mockStatus = {
        configured: true,
        smtpConnected: false,
        imapConnected: false,
      };
      mockEmailService.getHealthStatus.mockResolvedValue(mockStatus);

      const result = await caller.email.getStatus();

      expect(mockEmailService.getHealthStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStatus);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(adminRouter);

      await expect(caller.email.getStatus()).rejects.toThrow(TRPCError);
      await expect(caller.email.getStatus()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(mockEmailService.getHealthStatus).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when user is a customer', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.customer);

      await expect(caller.email.getStatus()).rejects.toThrow(TRPCError);
      await expect(caller.email.getStatus()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
      expect(mockEmailService.getHealthStatus).not.toHaveBeenCalled();
    });

    it('should return status with no lastTestResult when no test has been run', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockStatus = {
        configured: true,
        smtpConnected: true,
        imapConnected: true,
      };
      mockEmailService.getHealthStatus.mockResolvedValue(mockStatus);

      const result = await caller.email.getStatus();

      expect(result.lastTestResult).toBeUndefined();
    });

    it('should return configured: false when email not configured', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockStatus = {
        configured: false,
        smtpConnected: false,
        imapConnected: false,
      };
      mockEmailService.getHealthStatus.mockResolvedValue(mockStatus);

      const result = await caller.email.getStatus();

      expect(result.configured).toBe(false);
      expect(result.smtpConnected).toBe(false);
      expect(result.imapConnected).toBe(false);
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      mockEmailService.getHealthStatus.mockRejectedValue(new Error('Health check failed'));

      await expect(caller.email.getStatus()).rejects.toThrow('Health check failed');
    });
  });

  // ========== admin.email.runTest Tests ==========
  describe('admin.email.runTest', () => {
    it('should run email test for admin user with default timeout', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult = {
        success: true,
        smtpSent: true,
        imapReceived: true,
        deliveryTimeMs: 2500,
        testId: 'email-test-123',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest();

      expect(mockEmailService.testEmailDelivery).toHaveBeenCalledWith(30000);
      expect(result).toEqual(mockResult);
    });

    it('should run email test with custom timeout', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult = {
        success: true,
        smtpSent: true,
        imapReceived: true,
        deliveryTimeMs: 3200,
        testId: 'email-test-456',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest({ timeout: 60000 });

      expect(mockEmailService.testEmailDelivery).toHaveBeenCalledWith(60000);
      expect(result).toEqual(mockResult);
    });

    it('should run email test for super admin user', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.superAdmin);
      const mockResult = {
        success: true,
        smtpSent: true,
        imapReceived: true,
        deliveryTimeMs: 1800,
        testId: 'email-test-789',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest({ timeout: 45000 });

      expect(mockEmailService.testEmailDelivery).toHaveBeenCalledWith(45000);
      expect(result).toEqual(mockResult);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(adminRouter);

      await expect(caller.email.runTest()).rejects.toThrow(TRPCError);
      await expect(caller.email.runTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(mockEmailService.testEmailDelivery).not.toHaveBeenCalled();
    });

    it('should throw FORBIDDEN when user is a customer', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.customer);

      await expect(caller.email.runTest()).rejects.toThrow(TRPCError);
      await expect(caller.email.runTest()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
      expect(mockEmailService.testEmailDelivery).not.toHaveBeenCalled();
    });

    it('should return failed result when SMTP not configured', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult = {
        success: false,
        smtpSent: false,
        imapReceived: false,
        error: 'SMTP not configured (missing SMTP_USER or SMTP_PASS)',
        testId: 'email-test-fail-1',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest();

      expect(result.success).toBe(false);
      expect(result.error).toContain('SMTP not configured');
    });

    it('should return failed result when IMAP not configured', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult = {
        success: false,
        smtpSent: false,
        imapReceived: false,
        error: 'IMAP not configured (missing IMAP_HOST, IMAP_USER, or IMAP_PASS)',
        testId: 'email-test-fail-2',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest();

      expect(result.success).toBe(false);
      expect(result.error).toContain('IMAP not configured');
    });

    it('should return partial success when email sent but not received', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult = {
        success: false,
        smtpSent: true,
        imapReceived: false,
        error: 'Email sent but not received within 30000ms timeout',
        testId: 'email-test-partial',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest();

      expect(result.success).toBe(false);
      expect(result.smtpSent).toBe(true);
      expect(result.imapReceived).toBe(false);
    });

    it('should reject timeout less than 5000ms', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);

      await expect(
        caller.email.runTest({ timeout: 3000 })
      ).rejects.toThrow(TRPCError);
    });

    it('should reject timeout greater than 60000ms', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);

      await expect(
        caller.email.runTest({ timeout: 70000 })
      ).rejects.toThrow(TRPCError);
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      mockEmailService.testEmailDelivery.mockRejectedValue(new Error('Test failed'));

      await expect(caller.email.runTest()).rejects.toThrow('Test failed');
    });

    it('should return deliveryTimeMs when test succeeds', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult = {
        success: true,
        smtpSent: true,
        imapReceived: true,
        deliveryTimeMs: 4200,
        testId: 'email-test-timing',
      };
      mockEmailService.testEmailDelivery.mockResolvedValue(mockResult);

      const result = await caller.email.runTest();

      expect(result.deliveryTimeMs).toBe(4200);
      expect(result.deliveryTimeMs).toBeGreaterThan(0);
    });

    it('should return unique testId for each test', async () => {
      const caller = createCallerWithUser(adminRouter, mockUsers.admin);
      const mockResult1 = {
        success: true,
        smtpSent: true,
        imapReceived: true,
        deliveryTimeMs: 1500,
        testId: 'email-test-unique-1',
      };
      const mockResult2 = {
        success: true,
        smtpSent: true,
        imapReceived: true,
        deliveryTimeMs: 1600,
        testId: 'email-test-unique-2',
      };

      mockEmailService.testEmailDelivery.mockResolvedValueOnce(mockResult1);
      const result1 = await caller.email.runTest();

      mockEmailService.testEmailDelivery.mockResolvedValueOnce(mockResult2);
      const result2 = await caller.email.runTest();

      expect(result1.testId).not.toBe(result2.testId);
    });
  });
});
