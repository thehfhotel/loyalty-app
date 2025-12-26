/**
 * Mock emailService for unit tests
 * Provides mocked implementations of email sending functions
 */

import { jest } from '@jest/globals';

// Mock function for generating verification code
export const generateVerificationCode = jest.fn<() => string>(() => 'ABCD-1234');

// Mock email service object
export const emailService = {
  sendVerificationEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendRegistrationVerificationEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};
