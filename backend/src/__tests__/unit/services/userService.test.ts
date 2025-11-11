import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { UserService } from '../../../services/userService';
import { AppError } from '../../../middleware/errorHandler';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../services/notificationService');
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
    mockQuery.mockResolvedValue([]);
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

      mockQuery.mockResolvedValueOnce([mockProfile]);

      const result = await userService.getProfile('user-123');

      expect(result).toEqual(mockProfile);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['user-123']
      );
    });

    it('should throw error if profile not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

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

      mockQuery.mockResolvedValueOnce([mockUpdatedProfile]);

      const result = await userService.updateProfile(userId, updateData);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles'),
        expect.arrayContaining([...Object.values(updateData), userId])
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
      }]);

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
      mockQuery.mockResolvedValueOnce([mockProfile]);

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

      mockQuery.mockResolvedValueOnce(mockUsers).mockResolvedValueOnce([{ count: 2 }]);

      const result = await userService.getAllUsers(1, 10);

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should apply search filter', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);

      await userService.getAllUsers(1, 10, 'john');

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId }]);

      await userService.deleteUser(userId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        [userId]
      );
    });

    it('should not throw error if user not found (idempotent delete)', async () => {
      mockQuery.mockResolvedValueOnce([]);

      // Delete is idempotent - no error thrown if user doesn't exist
      await expect(userService.deleteUser('non-existent'))
        .resolves.not.toThrow();
    });

    it('should handle cascade deletion', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId }]);

      await userService.deleteUser(userId);

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('updateUserRole', () => {
    it('should update user role successfully', async () => {
      const userId = 'user-123';
      const newRole = 'admin';

      mockQuery.mockResolvedValueOnce([{ userId, role: newRole }]);

      await userService.updateUserRole(userId, newRole);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.arrayContaining([newRole, userId])
      );
    });

    it('should validate role enum', async () => {
      const userId = 'user-123';

      await expect(userService.updateUserRole(userId, 'invalid_role' as any))
        .rejects.toThrow();
    });
  });

  describe('updateUserStatus', () => {
    it('should activate inactive user', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId, isActive: true }]);

      await userService.updateUserStatus(userId, true);

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should deactivate active user', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([{ userId, isActive: false }]);

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
      }]);

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
        }])
        .mockResolvedValueOnce([{  // 2. UPDATE query - update profile
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
          profileCompleted: false,
          membershipId: 'MEM12345',
          newMemberCouponAwarded: false,
        }])
        .mockResolvedValueOnce([{  // 3. getProfileCompletionStatus - check completion
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
        }]);

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
        }])
        .mockResolvedValueOnce([{  // 2. UPDATE profile
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
          profileCompleted: false,
          membershipId: 'MEM12345',
          newMemberCouponAwarded: false,
        }])
        .mockResolvedValueOnce([{  // 3. getProfileCompletionStatus
          userId,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          dateOfBirth: new Date('1990-01-01'),
        }]);

      const result = await userService.completeProfile(userId, profileData);

      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(userService.getProfile('user-123'))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle invalid data format', async () => {
      const userId = 'user-123';
      const invalidData = {
        dateOfBirth: 'invalid-date' as any,
      };

      await expect(userService.updateProfile(userId, invalidData))
        .rejects.toThrow();
    });
  });
});
