/**
 * tRPC User Router Integration Tests
 * Tests all 16 procedures with authentication, authorization, and error handling
 */

import { TRPCError } from '@trpc/server';
import { mockUsers, mockProfile, createCallerWithUser, createUnauthenticatedCaller } from './helpers';

// Create mock userService instance
const mockUserService = {
  getProfile: jest.fn(),
  updateProfile: jest.fn(),
  updateAvatar: jest.fn(),
  deleteAvatar: jest.fn(),
  updateEmojiAvatar: jest.fn(),
  completeProfile: jest.fn(),
  getProfileCompletionStatus: jest.fn(),
  initiateEmailChange: jest.fn(),
  verifyEmailChange: jest.fn(),
  resendVerificationCode: jest.fn(),
  getPendingEmailChange: jest.fn(),
  verifyRegistrationEmail: jest.fn(),
  resendRegistrationVerification: jest.fn(),
  getEmailVerificationStatus: jest.fn(),
};

// Mock the userService before importing the router
jest.mock('../../../services/userService', () => ({
  userService: mockUserService,
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
import { userRouter } from '../../../trpc/routers/user';

describe('tRPC User Router - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== 1. getProfile Tests ==========
  describe('getProfile', () => {
    it('should return user profile for authenticated user', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.getProfile.mockResolvedValue(mockProfile);

      const result = await caller.getProfile();

      expect(mockUserService.getProfile).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(mockProfile);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.getProfile()).rejects.toThrow(TRPCError);
      await expect(caller.getProfile()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(mockUserService.getProfile).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.getProfile.mockRejectedValue(new Error('Profile not found'));

      await expect(caller.getProfile()).rejects.toThrow('Profile not found');
    });
  });

  // ========== 2. updateProfile Tests ==========
  describe('updateProfile', () => {
    it('should update profile with all fields', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const updateData = {
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+9876543210',
        dateOfBirth: '1995-05-15',
        gender: 'female',
        occupation: 'Designer',
        preferences: { theme: 'light' },
      };
      const updatedProfile = { ...mockProfile, ...updateData };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-test-id', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with partial fields', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const updateData = { firstName: 'Jane' };
      const updatedProfile = { ...mockProfile, firstName: 'Jane' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-test-id', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should reject empty firstName', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.updateProfile({ firstName: '' })
      ).rejects.toThrow(TRPCError);
    });

    it('should handle empty string dateOfBirth by transforming to undefined', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.updateProfile.mockResolvedValue(mockProfile);

      await caller.updateProfile({ dateOfBirth: '' });

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-test-id', {
        dateOfBirth: undefined,
      });
    });

    it('should reject invalid date format', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.updateProfile({ dateOfBirth: 'invalid-date' })
      ).rejects.toThrow(TRPCError);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.updateProfile({ firstName: 'Jane' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateProfile({ firstName: 'Jane' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 3. completeProfile Tests ==========
  describe('completeProfile', () => {
    it('should complete profile and return result', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const profileData = {
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
      };
      const completionResult = {
        profile: mockProfile,
        couponAwarded: false,
        coupon: null,
        pointsAwarded: 0,
      };
      mockUserService.completeProfile.mockResolvedValue(completionResult);

      const result = await caller.completeProfile(profileData);

      expect(mockUserService.completeProfile).toHaveBeenCalledWith('customer-test-id', profileData);
      expect(result).toEqual(completionResult);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.completeProfile({ firstName: 'John' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 4. getProfileCompletionStatus Tests ==========
  describe('getProfileCompletionStatus', () => {
    it('should return profile completion status', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const status = {
        isComplete: true,
        missingFields: [],
        newMemberCouponAvailable: false,
      };
      mockUserService.getProfileCompletionStatus.mockResolvedValue(status);

      const result = await caller.getProfileCompletionStatus();

      expect(mockUserService.getProfileCompletionStatus).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(status);
    });

    it('should return incomplete status with missing fields', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const status = {
        isComplete: false,
        missingFields: ['phone', 'dateOfBirth'],
        newMemberCouponAvailable: false,
      };
      mockUserService.getProfileCompletionStatus.mockResolvedValue(status);

      const result = await caller.getProfileCompletionStatus();

      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toEqual(['phone', 'dateOfBirth']);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.getProfileCompletionStatus()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 5. updateEmail Tests ==========
  describe('updateEmail', () => {
    it('should initiate email change', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.initiateEmailChange.mockResolvedValue(undefined);

      const result = await caller.updateEmail({ email: 'newemail@test.com' });

      expect(mockUserService.initiateEmailChange).toHaveBeenCalledWith(
        'customer-test-id',
        'newemail@test.com'
      );
      expect(result).toEqual({
        success: true,
        message: 'Verification code sent to new email address',
        pendingVerification: true,
      });
    });

    it('should reject invalid email format', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.updateEmail({ email: 'invalid-email' })
      ).rejects.toThrow(TRPCError);
    });

    it('should handle EMAIL_ALREADY_IN_USE error', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const error = new Error('Email is already in use');
      (error as Error & { code?: string; statusCode?: number }).code = 'EMAIL_ALREADY_IN_USE';
      (error as Error & { code?: string; statusCode?: number }).statusCode = 409;
      mockUserService.initiateEmailChange.mockRejectedValue(error);

      await expect(
        caller.updateEmail({ email: 'duplicate@test.com' })
      ).rejects.toThrow('Email is already in use');
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.updateEmail({ email: 'new@test.com' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 6. verifyEmail Tests ==========
  describe('verifyEmail', () => {
    it('should verify email change with valid code', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.verifyEmailChange.mockResolvedValue('newemail@test.com');

      const result = await caller.verifyEmail({ code: 'ABCD-1234' });

      expect(mockUserService.verifyEmailChange).toHaveBeenCalledWith(
        'customer-test-id',
        'ABCD-1234'
      );
      expect(result).toEqual({ success: true, email: 'newemail@test.com' });
    });

    it('should reject invalid code format', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.verifyEmail({ code: 'invalid' })
      ).rejects.toThrow(TRPCError);
    });

    it('should reject code with wrong separator', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.verifyEmail({ code: 'ABCD_1234' })
      ).rejects.toThrow(TRPCError);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.verifyEmail({ code: 'ABCD-1234' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 7. resendVerificationCode Tests ==========
  describe('resendVerificationCode', () => {
    it('should resend verification code', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.resendVerificationCode.mockResolvedValue(undefined);

      const result = await caller.resendVerificationCode();

      expect(mockUserService.resendVerificationCode).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ success: true, message: 'Verification code resent' });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.resendVerificationCode()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 8. getPendingEmailChange Tests ==========
  describe('getPendingEmailChange', () => {
    it('should return pending email change', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const pending = {
        email: 'pending@test.com',
        expiresAt: new Date('2025-12-31'),
      };
      mockUserService.getPendingEmailChange.mockResolvedValue(pending);

      const result = await caller.getPendingEmailChange();

      expect(mockUserService.getPendingEmailChange).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(pending);
    });

    it('should return null when no pending change', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.getPendingEmailChange.mockResolvedValue(null);

      const result = await caller.getPendingEmailChange();

      expect(result).toBeNull();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.getPendingEmailChange()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 9. updateEmojiAvatar Tests ==========
  describe('updateEmojiAvatar', () => {
    it('should update emoji avatar', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const updatedProfile = { ...mockProfile, avatarUrl: 'emoji://😀' };
      mockUserService.updateEmojiAvatar.mockResolvedValue(updatedProfile);

      const result = await caller.updateEmojiAvatar({ emoji: '😀' });

      expect(mockUserService.updateEmojiAvatar).toHaveBeenCalledWith('customer-test-id', '😀');
      expect(result).toEqual(updatedProfile);
    });

    it('should reject empty emoji', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.updateEmojiAvatar({ emoji: '' })
      ).rejects.toThrow(TRPCError);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.updateEmojiAvatar({ emoji: '😀' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 10. getSettings Tests ==========
  describe('getSettings', () => {
    it('should return user settings', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.getProfile.mockResolvedValue(mockProfile);

      const result = await caller.getSettings();

      expect(mockUserService.getProfile).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({
        preferences: mockProfile.preferences,
        gender: mockProfile.gender,
        occupation: mockProfile.occupation,
      });
    });

    it('should return settings with undefined gender and occupation', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const profileWithoutExtras = {
        ...mockProfile,
        gender: undefined,
        occupation: undefined,
      };
      mockUserService.getProfile.mockResolvedValue(profileWithoutExtras);

      const result = await caller.getSettings();

      expect(result).toEqual({
        preferences: mockProfile.preferences,
        gender: undefined,
        occupation: undefined,
      });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.getSettings()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 11. updateSettings Tests ==========
  describe('updateSettings', () => {
    it('should update settings with all fields', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const updateData = {
        preferences: { theme: 'light', newsletter: false },
        gender: 'female',
        occupation: 'Designer',
      };
      const updatedProfile = { ...mockProfile, ...updateData };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateSettings(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-test-id', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update settings with preferences only', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const updateData = { preferences: { theme: 'dark' } };
      const updatedProfile = { ...mockProfile, preferences: { theme: 'dark' } };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateSettings(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-test-id', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.updateSettings({ preferences: { theme: 'light' } })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 12. updateAvatar Tests ==========
  describe('updateAvatar', () => {
    it('should update avatar successfully', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const avatarUrl = 'https://example.com/new-avatar.jpg';
      const updatedProfile = { ...mockProfile, avatarUrl };
      mockUserService.updateAvatar.mockResolvedValue(undefined);
      mockUserService.getProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateAvatar({ avatarUrl });

      expect(mockUserService.updateAvatar).toHaveBeenCalledWith('customer-test-id', avatarUrl);
      expect(mockUserService.getProfile).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(updatedProfile);
    });

    it('should reject empty avatarUrl', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.updateAvatar({ avatarUrl: '' })
      ).rejects.toThrow(TRPCError);
    });

    it('should accept emoji avatar URL', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const emojiUrl = 'emoji://😀';
      const updatedProfile = { ...mockProfile, avatarUrl: emojiUrl };
      mockUserService.updateAvatar.mockResolvedValue(undefined);
      mockUserService.getProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateAvatar({ avatarUrl: emojiUrl });

      expect(mockUserService.updateAvatar).toHaveBeenCalledWith('customer-test-id', emojiUrl);
      expect(result).toEqual(updatedProfile);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.updateAvatar({ avatarUrl: 'https://example.com/avatar.jpg' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 13. deleteAvatar Tests ==========
  describe('deleteAvatar', () => {
    it('should delete avatar successfully', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.deleteAvatar.mockResolvedValue(undefined);

      const result = await caller.deleteAvatar();

      expect(mockUserService.deleteAvatar).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ success: true });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.deleteAvatar()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.deleteAvatar.mockRejectedValue(new Error('Delete failed'));

      await expect(caller.deleteAvatar()).rejects.toThrow('Delete failed');
    });
  });

  // ========== 14. verifyRegistrationEmail Tests ==========
  describe('verifyRegistrationEmail', () => {
    it('should verify registration email with valid code', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.verifyRegistrationEmail.mockResolvedValue(undefined);

      const result = await caller.verifyRegistrationEmail({ code: 'ABCD-1234' });

      expect(mockUserService.verifyRegistrationEmail).toHaveBeenCalledWith(
        'customer-test-id',
        'ABCD-1234'
      );
      expect(result).toEqual({ success: true });
    });

    it('should reject invalid code format', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.verifyRegistrationEmail({ code: 'invalid' })
      ).rejects.toThrow(TRPCError);
    });

    it('should reject lowercase code', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);

      await expect(
        caller.verifyRegistrationEmail({ code: 'abcd-1234' })
      ).rejects.toThrow(TRPCError);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(
        caller.verifyRegistrationEmail({ code: 'ABCD-1234' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== 15. resendRegistrationVerification Tests ==========
  describe('resendRegistrationVerification', () => {
    it('should resend registration verification code', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.resendRegistrationVerification.mockResolvedValue(undefined);

      const result = await caller.resendRegistrationVerification();

      expect(mockUserService.resendRegistrationVerification).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ success: true, message: 'Verification code resent' });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.resendRegistrationVerification()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.resendRegistrationVerification.mockRejectedValue(new Error('User not found'));

      await expect(caller.resendRegistrationVerification()).rejects.toThrow('User not found');
    });
  });

  // ========== 16. getEmailVerificationStatus Tests ==========
  describe('getEmailVerificationStatus', () => {
    it('should return email verification status for verified user', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const status = {
        emailVerified: true,
        email: 'customer@test.com',
      };
      mockUserService.getEmailVerificationStatus.mockResolvedValue(status);

      const result = await caller.getEmailVerificationStatus();

      expect(mockUserService.getEmailVerificationStatus).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(status);
    });

    it('should return email verification status for unverified user', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      const status = {
        emailVerified: false,
        email: 'unverified@test.com',
      };
      mockUserService.getEmailVerificationStatus.mockResolvedValue(status);

      const result = await caller.getEmailVerificationStatus();

      expect(result.emailVerified).toBe(false);
      expect(result.email).toBe('unverified@test.com');
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(userRouter);

      await expect(caller.getEmailVerificationStatus()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(userRouter, mockUsers.customer);
      mockUserService.getEmailVerificationStatus.mockRejectedValue(new Error('User not found'));

      await expect(caller.getEmailVerificationStatus()).rejects.toThrow('User not found');
    });
  });
});
