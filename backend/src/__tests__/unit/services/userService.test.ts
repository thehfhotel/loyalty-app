import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { UserService } from '../../../services/userService';
import { AppError } from '../../../middleware/errorHandler';
import * as database from '../../../config/database';
import * as emailService from '../../../services/emailService';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../services/notificationService');
jest.mock('../../../services/emailService');
jest.mock('../../../utils/logger');

describe('UserService', () => {
  let userService: UserService;
  let mockQuery: jest.MockedFunction<typeof database.query>;
  let mockQueryWithMeta: jest.MockedFunction<typeof database.queryWithMeta>;

  beforeEach(() => {
    jest.clearAllMocks();
    userService = new UserService();
    mockQuery = database.query as jest.MockedFunction<typeof database.query>;
    mockQueryWithMeta = database.queryWithMeta as jest.MockedFunction<typeof database.queryWithMeta>;
    mockQuery.mockResolvedValue([] as never);
    mockQueryWithMeta.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('getProfile', () => {
    it('should return user profile successfully', async () => {
      const mockProfile = {
        userId: 'user-123',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        membershipId: 'MEM12345',
        dateOfBirth: new Date('1990-01-01'),
        preferences: {},
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([mockProfile] as never);

      const result = await userService.getProfile('user-123');

      expect(result).toEqual(mockProfile);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['user-123']
      );
    });

    it('should throw error if profile not found', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(userService.getProfile('non-existent'))
        .rejects.toThrow(AppError);
      await expect(userService.getProfile('non-existent'))
        .rejects.toMatchObject({
          statusCode: 404,
          message: 'Profile not found',
        });
    });
  });

  describe('updateProfile', () => {
    it('should update profile fields successfully', async () => {
      const userId = 'user-123';
      const updateData = {
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+0987654321',
      };

      const mockUpdatedProfile = {
        userId,
        ...updateData,
        membershipId: 'MEM12345',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([mockUpdatedProfile] as never);

      const result = await userService.updateProfile(userId, updateData);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles'),
        expect.arrayContaining([...Object.values(updateData), userId] as never)
      );
    });

    it('should handle partial profile updates', async () => {
      const userId = 'user-123';
      const updateData = {
        firstName: 'Jane',
      };

      mockQuery.mockResolvedValueOnce([{
        userId,
        firstName: 'Jane',
        membershipId: 'MEM12345',
      }] as never);

      const result = await userService.updateProfile(userId, updateData);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle emoji avatar updates', async () => {
      const userId = 'user-123';
      const emoji = '😀';

      const mockProfile = {
        userId,
        avatarUrl: `emoji://${emoji}`,
        membershipId: 'MEM12345',
      };

      // Mock updateAvatar query (uses queryWithMeta)
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // Mock getProfile query
      mockQuery.mockResolvedValueOnce([mockProfile] as never);

      const result = await userService.updateEmojiAvatar(userId, emoji);

      expect(result).toBeDefined();
      expect(mockQueryWithMeta).toHaveBeenCalled();
    });
  });

  describe('getAllUsers', () => {
    it('should return paginated users list', async () => {
      const mockUsers = [
        {
          userId: 'user-1',
          email: 'user1@example.com',
          role: 'customer',
          firstName: 'User',
          lastName: 'One',
        },
        {
          userId: 'user-2',
          email: 'user2@example.com',
          role: 'customer',
          firstName: 'User',
          lastName: 'Two',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockUsers).mockResolvedValueOnce([{ count: 2 }] as never);

      const result = await userService.getAllUsers(1, 10);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should apply search filter', async () => {
      mockQuery.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ count: 0 }] as never);

      await userService.getAllUsers(1, 10, 'john');

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId }] as never);

      await userService.deleteUser(userId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        [userId]
      );
    });

    it('should not throw error if user not found (idempotent delete)', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      // Delete is idempotent - no error thrown if user doesn't exist
      await expect(userService.deleteUser('non-existent'))
        .resolves.not.toThrow();
    });

    it('should handle cascade deletion', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId }] as never);

      await userService.deleteUser(userId);

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('updateUserRole', () => {
    it('should update user role successfully', async () => {
      const userId = 'user-123';
      const newRole = 'admin';

      mockQuery.mockResolvedValueOnce([{ userId, role: newRole }] as never);

      await userService.updateUserRole(userId, newRole);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.arrayContaining([newRole, userId] as never)
      );
    });

    it('should validate role enum', async () => {
      const userId = 'user-123';

      await expect(userService.updateUserRole(userId, 'invalid_role' as never))
        .rejects.toThrow();
    });
  });

  describe('updateUserStatus', () => {
    it('should activate inactive user', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId, isActive: true }] as never);

      await userService.updateUserStatus(userId, true);

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should deactivate active user', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId, isActive: false }] as never);

      await userService.updateUserStatus(userId, false);

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('getUserStats', () => {
    it('should return user statistics', async () => {
      // getUserStats makes a single query that returns all stats
      mockQuery.mockResolvedValueOnce([{
        total: '100',
        active: '90',
        admins: '10',
        recentlyJoined: '15'
      }] as never);

      const result = await userService.getUserStats();

      expect(result).toBeDefined();
      expect(result.total).toBe(100);
      expect(result.active).toBe(90);
      expect(result.admins).toBe(10);
      expect(result.recentlyJoined).toBe(15);
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('completeProfile', () => {
    it('should mark profile as completed', async () => {
      const userId = 'user-123';
      const profileData = {
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
      };

      // Mock the queries in correct order that completeProfile makes:
      mockQuery
        .mockResolvedValueOnce([{  // 1. getProfile - get current profile
          userId,
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '+1111111111',
          profileCompleted: false,
          newMemberCouponAwarded: false,
          membershipId: 'MEM12345',
        }] as never)
        .mockResolvedValueOnce([{  // 2. UPDATE query - update profile
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
          profileCompleted: false,
          membershipId: 'MEM12345',
          newMemberCouponAwarded: false,
        }] as never)
        .mockResolvedValueOnce([{  // 3. getProfileCompletionStatus - check completion
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
        }] as never);

      const result = await userService.completeProfile(userId, profileData);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle profile updates with rewards', async () => {
      const userId = 'user-123';
      const profileData = {
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        dateOfBirth: '1990-01-01',
      };

      mockQuery
        .mockResolvedValueOnce([{  // 1. getProfile
          userId,
          firstName: 'Jane',
          profileCompleted: false,
          newMemberCouponAwarded: false,
          membershipId: 'MEM12345',
        }] as never)
        .mockResolvedValueOnce([{  // 2. UPDATE profile
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
          profileCompleted: false,
          membershipId: 'MEM12345',
          newMemberCouponAwarded: false,
        }] as never)
        .mockResolvedValueOnce([{  // 3. getProfileCompletionStatus
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
        }] as never);

      const result = await userService.completeProfile(userId, profileData);

      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed') as never);

      await expect(userService.getProfile('user-123'))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle invalid data format', async () => {
      const userId = 'user-123';
      const invalidData = {
        dateOfBirth: 'invalid-date',
      };

      await expect(userService.updateProfile(userId, invalidData as never))
        .rejects.toThrow();
    });
  });

  describe('updateAvatar', () => {
    it('should update user avatar successfully', async () => {
      const userId = 'user-123';
      const avatarUrl = 'https://example.com/avatar.jpg';

      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await userService.updateAvatar(userId, avatarUrl);

      expect(mockQueryWithMeta).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles'),
        [avatarUrl, userId]
      );
    });

    it('should throw error if user not found', async () => {
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(userService.updateAvatar('non-existent', 'url'))
        .rejects.toThrow('User profile not found');
    });
  });

  describe('deleteAvatar', () => {
    it('should delete user avatar', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId }] as never);

      await userService.deleteAvatar(userId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles'),
        [userId]
      );
    });
  });

  describe('updateUserEmail', () => {
    it('should update user email successfully', async () => {
      const userId = 'user-123';
      const newEmail = 'newemail@example.com';

      mockQuery.mockResolvedValueOnce([] as never); // No existing user with this email
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await userService.updateUserEmail(userId, newEmail);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM users'),
        [newEmail, userId]
      );
      expect(mockQueryWithMeta).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        [newEmail, userId]
      );
    });

    it('should throw error if email already in use', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'other-user' }] as never);

      await expect(userService.updateUserEmail('user-123', 'existing@example.com'))
        .rejects.toMatchObject({
          statusCode: 409,
          message: 'Email is already in use by another account',
        });
    });

    it('should throw error if user not found', async () => {
      mockQuery.mockResolvedValueOnce([] as never);
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(userService.updateUserEmail('non-existent', 'email@example.com'))
        .rejects.toMatchObject({
          statusCode: 404,
          message: 'User not found',
        });
    });
  });

  describe('getProfileCompletionStatus', () => {
    it('should return complete status when all fields present', async () => {
      mockQuery.mockResolvedValueOnce([{
        userId: 'user-123',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        dateOfBirth: new Date('1990-01-01'),
        membershipId: 'MEM12345',
      }] as never);

      const result = await userService.getProfileCompletionStatus('user-123');

      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toHaveLength(0);
    });

    it('should return incomplete status with missing fields', async () => {
      mockQuery.mockResolvedValueOnce([{
        userId: 'user-123',
        firstName: 'John',
        membershipId: 'MEM12345',
      }] as never);

      const result = await userService.getProfileCompletionStatus('user-123');

      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('lastName');
      expect(result.missingFields).toContain('phone');
      expect(result.missingFields).toContain('dateOfBirth');
    });

    it('should handle errors and wrap them', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expect(userService.getProfileCompletionStatus('user-123'))
        .rejects.toThrow('Failed to get profile completion status');
    });
  });

  describe('getUserById', () => {
    it('should return user by ID', async () => {
      const mockUser = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'customer',
        isActive: true,
        firstName: 'John',
        lastName: 'Doe',
      };

      mockQuery.mockResolvedValueOnce([mockUser] as never);

      const result = await userService.getUserById('user-123');

      expect(result).toEqual(mockUser);
    });

    it('should throw error if user not found', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(userService.getUserById('non-existent'))
        .rejects.toMatchObject({
          statusCode: 404,
          message: 'User not found',
        });
    });
  });

  describe('getNewMemberCouponSettings', () => {
    it('should return existing settings', async () => {
      const mockSettings = {
        id: 1,
        isEnabled: true,
        selectedCouponId: 'coupon-123',
        pointsEnabled: true,
        pointsAmount: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockQuery.mockResolvedValueOnce([mockSettings] as never);

      const result = await userService.getNewMemberCouponSettings();

      expect(result).toEqual(mockSettings);
    });

    it('should create default settings if none exist', async () => {
      const mockDefaultSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockQuery
        .mockResolvedValueOnce([] as never) // No existing settings
        .mockResolvedValueOnce([mockDefaultSettings] as never); // Created settings

      const result = await userService.getNewMemberCouponSettings();

      expect(result).toEqual(mockDefaultSettings);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO new_member_coupon_settings'),
        [false, null, false, null]
      );
    });

    it('should throw error if default creation fails', async () => {
      mockQuery
        .mockResolvedValueOnce([] as never) // No existing settings
        .mockResolvedValueOnce([] as never); // Failed to create

      await expect(userService.getNewMemberCouponSettings())
        .rejects.toMatchObject({
          statusCode: 500,
          message: 'Failed to create default coupon settings',
        });
    });
  });

  describe('updateNewMemberCouponSettings', () => {
    it('should update settings successfully', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockCoupon = {
        id: 'coupon-123',
        code: 'WELCOME',
        name: 'Welcome Coupon',
        status: 'active',
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      };

      const mockUpdatedSettings = {
        ...mockCurrentSettings,
        isEnabled: true,
        selectedCouponId: 'coupon-123',
        pointsEnabled: true,
        pointsAmount: 500,
      };

      mockQuery
        .mockResolvedValueOnce([mockCurrentSettings] as never) // getNewMemberCouponSettings
        .mockResolvedValueOnce([mockCoupon] as never) // Validate coupon
        .mockResolvedValueOnce([mockUpdatedSettings] as never); // Update settings

      const result = await userService.updateNewMemberCouponSettings({
        isEnabled: true,
        selectedCouponId: 'coupon-123',
        pointsEnabled: true,
        pointsAmount: 500,
      });

      expect(result).toEqual(mockUpdatedSettings);
    });

    it('should throw error if selected coupon not found', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockQuery
        .mockResolvedValueOnce([mockCurrentSettings] as never)
        .mockResolvedValueOnce([] as never); // Coupon not found

      await expect(userService.updateNewMemberCouponSettings({
        isEnabled: true,
        selectedCouponId: 'non-existent',
        pointsEnabled: false,
        pointsAmount: null,
      })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Selected coupon not found',
      });
    });

    it('should throw error if coupon is not active', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockInactiveCoupon = {
        id: 'coupon-123',
        code: 'EXPIRED',
        name: 'Expired Coupon',
        status: 'expired',
        validUntil: null,
      };

      mockQuery
        .mockResolvedValueOnce([mockCurrentSettings] as never)
        .mockResolvedValueOnce([mockInactiveCoupon] as never);

      await expect(userService.updateNewMemberCouponSettings({
        isEnabled: true,
        selectedCouponId: 'coupon-123',
        pointsEnabled: false,
        pointsAmount: null,
      })).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Only active coupons can be used'),
      });
    });

    it('should throw error if coupon has expired', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockExpiredCoupon = {
        id: 'coupon-123',
        code: 'EXPIRED',
        name: 'Expired Coupon',
        status: 'active',
        validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
      };

      mockQuery
        .mockResolvedValueOnce([mockCurrentSettings] as never)
        .mockResolvedValueOnce([mockExpiredCoupon] as never);

      await expect(userService.updateNewMemberCouponSettings({
        isEnabled: true,
        selectedCouponId: 'coupon-123',
        pointsEnabled: false,
        pointsAmount: null,
      })).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('has expired'),
      });
    });

    it('should throw error if points amount is invalid when enabled', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockQuery.mockResolvedValueOnce([mockCurrentSettings] as never);

      await expect(userService.updateNewMemberCouponSettings({
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: true,
        pointsAmount: 0,
      })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Points amount must be a positive number when points are enabled',
      });
    });

    it('should throw error if points amount exceeds maximum', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockQuery.mockResolvedValueOnce([mockCurrentSettings] as never);

      await expect(userService.updateNewMemberCouponSettings({
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: true,
        pointsAmount: 15000,
      })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Points amount cannot exceed 10,000 points',
      });
    });

    it('should throw error if update fails', async () => {
      const mockCurrentSettings = {
        id: 1,
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockQuery
        .mockResolvedValueOnce([mockCurrentSettings] as never)
        .mockResolvedValueOnce([] as never); // Update failed

      await expect(userService.updateNewMemberCouponSettings({
        isEnabled: false,
        selectedCouponId: null,
        pointsEnabled: false,
        pointsAmount: null,
      })).rejects.toMatchObject({
        statusCode: 404,
        message: 'Failed to update new member coupon settings',
      });
    });
  });

  describe('getCouponStatusForAdmin', () => {
    it('should return coupon status with no warning for valid coupon', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'SUMMER20',
        name: 'Summer Sale',
        status: 'active',
        validFrom: null,
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      mockQuery.mockResolvedValueOnce([mockCoupon] as never);

      const result = await userService.getCouponStatusForAdmin('coupon-123');

      expect(result.id).toBe('coupon-123');
      expect(result.isExpired).toBe(false);
      expect(result.warningLevel).toBe('none');
      expect(result.daysUntilExpiry).toBeGreaterThan(7);
    });

    it('should return warning level for soon-to-expire coupon', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'EXPIRING',
        name: 'Expiring Soon',
        status: 'active',
        validFrom: null,
        validUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days
      };

      mockQuery.mockResolvedValueOnce([mockCoupon] as never);

      const result = await userService.getCouponStatusForAdmin('coupon-123');

      expect(result.warningLevel).toBe('warning');
      expect(result.daysUntilExpiry).toBeLessThanOrEqual(7);
    });

    it('should return danger level for expired coupon', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'EXPIRED',
        name: 'Expired Coupon',
        status: 'active',
        validFrom: null,
        validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
      };

      mockQuery.mockResolvedValueOnce([mockCoupon] as never);

      const result = await userService.getCouponStatusForAdmin('coupon-123');

      expect(result.isExpired).toBe(true);
      expect(result.warningLevel).toBe('danger');
    });

    it('should handle coupon with no expiry date', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'FOREVER',
        name: 'No Expiry',
        status: 'active',
        validFrom: null,
        validUntil: null,
      };

      mockQuery.mockResolvedValueOnce([mockCoupon] as never);

      const result = await userService.getCouponStatusForAdmin('coupon-123');

      expect(result.isExpired).toBe(false);
      expect(result.daysUntilExpiry).toBeNull();
      expect(result.warningLevel).toBe('none');
    });

    it('should throw error if coupon not found', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(userService.getCouponStatusForAdmin('non-existent'))
        .rejects.toMatchObject({
          statusCode: 404,
          message: 'Coupon not found',
        });
    });
  });

  describe('updateProfile with preferences', () => {
    it('should merge preferences correctly', async () => {
      const userId = 'user-123';
      const currentPrefs = { theme: 'dark', language: 'en' };
      const newPrefs = { notifications: true };

      mockQuery
        .mockResolvedValueOnce([{ preferences: currentPrefs }] as never) // Get current prefs
        .mockResolvedValueOnce([{
          userId,
          firstName: 'John',
          preferences: { ...currentPrefs, ...newPrefs },
          membershipId: 'MEM12345',
        }] as never); // Updated profile

      const result = await userService.updateProfile(userId, {
        preferences: newPrefs,
      });

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT preferences'),
        [userId]
      );
    });

    it('should handle gender and occupation in preferences', async () => {
      const userId = 'user-123';

      mockQuery
        .mockResolvedValueOnce([{ preferences: {} }] as never)
        .mockResolvedValueOnce([{
          userId,
          preferences: { gender: 'male', occupation: 'engineer' },
          membershipId: 'MEM12345',
        }] as never);

      const result = await userService.updateProfile(userId, {
        gender: 'male',
        occupation: 'engineer',
      });

      expect(result.gender).toBe('male');
      expect(result.occupation).toBe('engineer');
    });
  });

  describe('Email Verification', () => {
    beforeEach(() => {
      // Mock the email service methods
      jest.spyOn(emailService.emailService, 'sendVerificationEmail').mockResolvedValue(undefined);
      jest.spyOn(emailService, 'generateVerificationCode').mockReturnValue('ABCD-1234');
    });

    describe('initiateEmailChange', () => {
      it('should reject if new email already in use', async () => {
        const userId = 'user-123';
        const newEmail = 'existing@example.com';

        // Mock email already exists for another user
        mockQuery.mockResolvedValueOnce([{ id: 'other-user' }] as never);

        await expect(userService.initiateEmailChange(userId, newEmail))
          .rejects.toMatchObject({
            statusCode: 409,
            message: 'Email is already in use by another account',
          });
      });

      it('should invalidate previous pending tokens for user', async () => {
        const userId = 'user-123';
        const newEmail = 'newemail@example.com';

        // Mock no existing user with that email
        mockQuery.mockResolvedValueOnce([] as never);
        // Mock invalidating existing tokens
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 2 });
        // Mock creating new token
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await userService.initiateEmailChange(userId, newEmail);

        // Verify the invalidation query was called
        expect(mockQueryWithMeta).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE email_verification_tokens SET used = true'),
          [userId]
        );
      });

      it('should create new verification token in database', async () => {
        const userId = 'user-123';
        const newEmail = 'newemail@example.com';

        mockQuery.mockResolvedValueOnce([] as never);
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Invalidate
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // Insert

        await userService.initiateEmailChange(userId, newEmail);

        // Verify the insert query was called with correct parameters
        expect(mockQueryWithMeta).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO email_verification_tokens'),
          expect.arrayContaining([userId, newEmail, 'ABCD-1234'])
        );
      });

      it('should send verification email to new address', async () => {
        const userId = 'user-123';
        const newEmail = 'newemail@example.com';

        mockQuery.mockResolvedValueOnce([] as never);
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await userService.initiateEmailChange(userId, newEmail);

        // Verify email was sent
        expect(emailService.emailService.sendVerificationEmail).toHaveBeenCalledWith(
          newEmail,
          'ABCD-1234'
        );
      });

      it('should succeed without updating user email yet', async () => {
        const userId = 'user-123';
        const newEmail = 'newemail@example.com';

        mockQuery.mockResolvedValueOnce([] as never);
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await userService.initiateEmailChange(userId, newEmail);

        // Verify no UPDATE on users table was called
        expect(mockQueryWithMeta).not.toHaveBeenCalledWith(
          expect.stringContaining('UPDATE users SET email'),
          expect.anything()
        );
      });
    });

    describe('verifyEmailChange', () => {
      it('should reject invalid/non-existent codes', async () => {
        const userId = 'user-123';
        const code = 'INVALID-CODE';

        // Mock no token found
        mockQuery.mockResolvedValueOnce([] as never);

        await expect(userService.verifyEmailChange(userId, code))
          .rejects.toMatchObject({
            statusCode: 400,
            message: 'Invalid verification code',
          });
      });

      it('should reject expired codes', async () => {
        const userId = 'user-123';
        const code = 'ABCD-1234';

        // Mock expired token
        mockQuery.mockResolvedValueOnce([{
          id: 'token-1',
          new_email: 'newemail@example.com',
          expires_at: new Date(Date.now() - 1000), // Expired
          used: false,
        }] as never);

        await expect(userService.verifyEmailChange(userId, code))
          .rejects.toMatchObject({
            statusCode: 400,
            message: 'Verification code has expired',
          });
      });

      it('should reject already-used codes', async () => {
        const userId = 'user-123';
        const code = 'ABCD-1234';

        // Mock used token
        mockQuery.mockResolvedValueOnce([{
          id: 'token-1',
          new_email: 'newemail@example.com',
          expires_at: new Date(Date.now() + 60000),
          used: true,
        }] as never);

        await expect(userService.verifyEmailChange(userId, code))
          .rejects.toMatchObject({
            statusCode: 400,
            message: 'Verification code has already been used',
          });
      });

      it('should update user email on valid code', async () => {
        const userId = 'user-123';
        const code = 'ABCD-1234';
        const newEmail = 'newemail@example.com';

        // Mock valid token
        mockQuery
          .mockResolvedValueOnce([{
            id: 'token-1',
            new_email: newEmail,
            expires_at: new Date(Date.now() + 60000),
            used: false,
          }] as never)
          // Mock email not taken
          .mockResolvedValueOnce([] as never);

        // Mock update user email
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        // Mock mark token as used
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const result = await userService.verifyEmailChange(userId, code);

        expect(result).toBe(newEmail);
        expect(mockQueryWithMeta).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE users SET email = $1, email_verified = true'),
          [newEmail, userId]
        );
      });

      it('should mark token as used after verification', async () => {
        const userId = 'user-123';
        const code = 'ABCD-1234';

        mockQuery
          .mockResolvedValueOnce([{
            id: 'token-1',
            new_email: 'newemail@example.com',
            expires_at: new Date(Date.now() + 60000),
            used: false,
          }] as never)
          .mockResolvedValueOnce([] as never);

        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await userService.verifyEmailChange(userId, code);

        expect(mockQueryWithMeta).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE email_verification_tokens SET used = true'),
          ['token-1']
        );
      });
    });

    describe('resendVerificationCode', () => {
      it('should reject if no pending verification exists', async () => {
        const userId = 'user-123';

        mockQuery.mockResolvedValueOnce([] as never);

        await expect(userService.resendVerificationCode(userId))
          .rejects.toMatchObject({
            statusCode: 404,
            message: 'No pending email verification found',
          });
      });

      it('should generate new code and update token', async () => {
        const userId = 'user-123';

        // Mock existing pending token
        mockQuery.mockResolvedValueOnce([{
          id: 'token-1',
          new_email: 'newemail@example.com',
        }] as never);

        // Mock update token
        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await userService.resendVerificationCode(userId);

        expect(mockQueryWithMeta).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE email_verification_tokens SET code = $1'),
          expect.arrayContaining(['ABCD-1234'])
        );
      });

      it('should send new email with new code', async () => {
        const userId = 'user-123';

        mockQuery.mockResolvedValueOnce([{
          id: 'token-1',
          new_email: 'newemail@example.com',
        }] as never);

        mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await userService.resendVerificationCode(userId);

        expect(emailService.emailService.sendVerificationEmail).toHaveBeenCalledWith(
          'newemail@example.com',
          'ABCD-1234'
        );
      });
    });

    describe('getPendingEmailChange', () => {
      it('should return null if no pending verification', async () => {
        const userId = 'user-123';

        mockQuery.mockResolvedValueOnce([] as never);

        const result = await userService.getPendingEmailChange(userId);

        expect(result).toBeNull();
      });

      it('should return pending email and expiry if exists', async () => {
        const userId = 'user-123';
        const expiresAt = new Date(Date.now() + 3600000);

        mockQuery.mockResolvedValueOnce([{
          new_email: 'newemail@example.com',
          expires_at: expiresAt,
        }] as never);

        const result = await userService.getPendingEmailChange(userId);

        expect(result).toEqual({
          pendingEmail: 'newemail@example.com',
          expiresAt: expiresAt,
        });
      });

      it('should not return expired tokens', async () => {
        const userId = 'user-123';

        // The query should filter out expired tokens, so empty result
        mockQuery.mockResolvedValueOnce([] as never);

        const result = await userService.getPendingEmailChange(userId);

        expect(result).toBeNull();
      });
    });
  });
});
