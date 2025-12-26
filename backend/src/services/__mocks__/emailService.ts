/**
 * Mock emailService for unit tests
 * Provides mocked implementations of email sending functions
 */

import { jest } from '@jest/globals';
import type { EmailHealthStatus, EmailTestResult } from '../emailService';

// Mock function for generating verification code
export const generateVerificationCode = jest.fn<() => string>(() => 'ABCD-1234');

// Mock email service object
export const emailService = {
  sendVerificationEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendRegistrationVerificationEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  getHealthStatus: jest.fn<() => Promise<EmailHealthStatus>>().mockResolvedValue({
    configured: true,
    smtpConnected: true,
    imapConnected: true,
  }),
  testEmailDelivery: jest.fn<(timeoutMs?: number) => Promise<EmailTestResult>>().mockResolvedValue({
    success: true,
    smtpSent: true,
    imapReceived: true,
    deliveryTimeMs: 1500,
    testId: 'email-test-123',
  }),
  isEmailConfigured: jest.fn<() => boolean>().mockReturnValue(true),
};
