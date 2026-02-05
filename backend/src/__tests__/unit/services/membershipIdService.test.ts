/**
 * MembershipIdService Unit Tests
 * Tests membership ID generation, retrieval, and statistics functionality
 */

import { describe, expect, jest, beforeEach, test } from '@jest/globals';
import { membershipIdService } from '../../../services/membershipIdService';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

describe('MembershipIdService', () => {
  let mockQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock the query function
    mockQuery = jest.fn();
    (database as unknown as Record<string, unknown>).query = mockQuery;
  });

  describe('generateUniqueMembershipId', () => {
    test('should generate an 8-digit membership ID starting with 269', async () => {
      // Mock atomic increment
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 45
      }] as never);

      // Mock ID existence check (returns false = ID doesn't exist)
      mockQuery.mockResolvedValueOnce([{
        exists: false
      }] as never);

      const result = await membershipIdService.generateUniqueMembershipId();

      expect(result).toMatch(/^269\d{5}$/);  // 269 followed by 5 digits
      expect(result).toHaveLength(8);
    });

    test('should generate sequential IDs within block boundaries', async () => {
      // Mock Math.random to return predictable but different values
      const mockRandom = jest.spyOn(Math, 'random');
      mockRandom.mockReturnValueOnce(0.1);  // First call returns low value
      mockRandom.mockReturnValueOnce(0.9);  // Second call returns high value

      // Mock first user
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 1
      }] as never);
      mockQuery.mockResolvedValueOnce([{
        exists: false
      }] as never);

      const firstId = await membershipIdService.generateUniqueMembershipId();

      // Mock second user
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 2
      }] as never);
      mockQuery.mockResolvedValueOnce([{
        exists: false
      }] as never);

      const secondId = await membershipIdService.generateUniqueMembershipId();

      // Restore Math.random
      mockRandom.mockRestore();

      // Both should start with 269 and be 8 digits
      expect(firstId).toMatch(/^269\d{5}$/);
      expect(secondId).toMatch(/^269\d{5}$/);
      expect(firstId).not.toBe(secondId);  // Should be different
    });

    test('should handle block boundaries correctly', async () => {
      // Mock user at block boundary (100th user)
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 100
      }] as never);
      mockQuery.mockResolvedValueOnce([{
        exists: false
      }] as never);

      const boundaryId = await membershipIdService.generateUniqueMembershipId();

      expect(boundaryId).toMatch(/^269\d{5}$/);
    });

    test('should retry with fallback block if primary block is full', async () => {
      // Mock atomic increment
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 50
      }] as never);

      // Mock primary block full (all IDs exist)
      mockQuery.mockResolvedValueOnce([{
        exists: true  // ID exists
      }] as never);
      mockQuery.mockResolvedValueOnce([{
        exists: true  // Another ID exists
      }] as never);
      mockQuery.mockResolvedValueOnce([{
        exists: true  // All attempts fail
      }] as never);

      // Mock fallback block successful
      mockQuery.mockResolvedValueOnce([{
        exists: false  // ID available in fallback block
      }] as never);

      const result = await membershipIdService.generateUniqueMembershipId();

      expect(result).toMatch(/^269\d{5}$/);
      expect(mockQuery).toHaveBeenCalledTimes(5);  // 1 increment + 4 existence checks
    });

    test('should throw error when all fallback blocks are exhausted', async () => {
      // Mock atomic increment
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 50
      }] as never);

      // Mock all blocks full
      for (let i = 0; i < 25; i++) {  // More than MAX_FALLBACK_BLOCKS*2 (10 forward + 10 backward)
        mockQuery.mockResolvedValueOnce([{
          exists: true  // All IDs exist
        }] as never);
      }

      await expect(membershipIdService.generateUniqueMembershipId()).rejects.toThrow(
        'Membership ID system approaching capacity'
      );
    });

    test('should handle database errors gracefully', async () => {
      // Mock database error
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed') as never);

      await expect(membershipIdService.generateUniqueMembershipId()).rejects.toThrow(
        'Failed to generate membership ID'
      );
    });
  });

  describe('getUserByMembershipId', () => {
    test('should return user data for valid membership ID', async () => {
      const membershipId = '26912345';
      const expectedUser = {
        userId: 'user-123',
        membershipId: '26912345',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        isActive: true  // MUST be true to not throw error
      };

      mockQuery.mockResolvedValueOnce([expectedUser] as never);

      const result = await membershipIdService.getUserByMembershipId(membershipId);

      expect(result).toEqual(expectedUser);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SELECT.*user_id/s),
        [membershipId]
      );
    });

    test('should throw error for non-existent membership ID', async () => {
      const membershipId = '26999999';

      mockQuery.mockResolvedValueOnce([] as never);

      await expect(
        membershipIdService.getUserByMembershipId(membershipId)
      ).rejects.toThrow('User not found with this membership ID');
    });

    test('should validate membership ID format', async () => {
      const invalidIds = ['', '12345678', '269', '269123456', 'abcde', '269abcd'];

      for (const invalidId of invalidIds) {
        await expect(membershipIdService.getUserByMembershipId(invalidId)).rejects.toThrow(
          expect.objectContaining({
            message: expect.stringContaining('Invalid membership ID format')
          } as never)
        );
      }
    });
  });

  describe('getMembershipIdByUserId', () => {
    test('should return membership ID for valid user ID', async () => {
      const userId = 'user-123';
      const expectedMembershipId = '26912345';

      mockQuery.mockResolvedValueOnce([{
        membershipId: expectedMembershipId  // Use camelCase to match service
      }] as never);

      const result = await membershipIdService.getMembershipIdByUserId(userId);

      expect(result).toBe(expectedMembershipId);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT membership_id'),
        expect.arrayContaining([userId] as never)
      );
    });

    test('should return null for user with null membership ID', async () => {
      const userId = 'user-456';

      mockQuery.mockResolvedValueOnce([{
        membershipId: null
      }] as never);

      const result = await membershipIdService.getMembershipIdByUserId(userId);

      expect(result).toBeNull();
    });

    test('should handle empty result for non-existent user', async () => {
      const userId = 'non-existent-user';

      mockQuery.mockResolvedValueOnce([] as never);

      await expect(membershipIdService.getMembershipIdByUserId(userId)).rejects.toThrow(
        'User profile not found'  // Match actual error message
      );
    });
  });

  describe('regenerateMembershipId', () => {
    test('should generate new membership ID for existing user', async () => {
      const userId = 'user-123';
      const oldMembershipId = '26900001';
      const newMembershipId = '26954321';

      // Mock atomic increment for new ID
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 150
      }] as never);

      // Mock ID existence check for new ID
      mockQuery.mockResolvedValueOnce([{
        exists: false
      }] as never);

      // Mock current user data
      mockQuery.mockResolvedValueOnce([{
        id: userId,
        membership_id: oldMembershipId
      }] as never);

      // Mock update operation
      mockQuery.mockResolvedValueOnce([{
        membership_id: newMembershipId
      }] as never);

      const result = await membershipIdService.regenerateMembershipId(userId);

      expect(result).toMatch(/^269\d{5}$/);
      expect(result).not.toBe(oldMembershipId);  // Should be different
    });

    test('should throw error for non-existent user', async () => {
      const userId = 'non-existent-user';

      // Mock generation phase (increment + check)
      mockQuery.mockResolvedValueOnce([{ current_user_count: 10 }] as never);
      mockQuery.mockResolvedValueOnce([{ exists: false }] as never);

      // Mock UPDATE returning empty (user not found)
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(membershipIdService.regenerateMembershipId(userId)).rejects.toThrow(
        'User profile not found'  // Match actual error message
      );
    });

    test('should handle database errors during regeneration', async () => {
      const userId = 'user-123';

      // Mock user exists
      mockQuery.mockResolvedValueOnce([{
        id: userId,
        membership_id: '26900001'
      }] as never);

      // Mock error during ID generation
      mockQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expect(membershipIdService.regenerateMembershipId(userId)).rejects.toThrow();
    });
  });

  describe('getMembershipIdStats', () => {
    test('should return comprehensive membership ID statistics', async () => {
      // Mock user statistics
      mockQuery.mockResolvedValueOnce([{
        totalUsers: '1000',
        usersWithMembershipId: '850',
        usersWithoutMembershipId: '150'
      }] as never);

      // Mock sequence information
      mockQuery.mockResolvedValueOnce([{
        current_user_count: 950
      }] as never);

      const result = await membershipIdService.getMembershipIdStats();

      expect(result).toEqual({
        totalUsers: 1000,
        usersWithMembershipId: 850,
        usersWithoutMembershipId: 150,
        currentUserCount: 950,
        currentBlock: 9,  // Math.floor((950-1)/100) = 9
        currentBlockRange: '901-1000',  // (9*100 + 1) to ((9+1)*100)
        blocksInUse: 10  // Math.floor((950-1)/100) + 1 = 10
      } as never);
    });

    test('should handle zero users correctly', async () => {
      // Mock empty statistics
      mockQuery.mockResolvedValueOnce([{
        totalUsers: '0',
        usersWithMembershipId: '0',
        usersWithoutMembershipId: '0'
      }] as never);

      // Mock no sequence info
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await membershipIdService.getMembershipIdStats();

      expect(result).toEqual({
        totalUsers: 0,
        usersWithMembershipId: 0,
        usersWithoutMembershipId: 0,
        currentUserCount: 0,  // Default value when sequenceInfo is undefined
        currentBlock: -1,  // Math.floor((0-1)/100) = -1
        currentBlockRange: '-99-0',  // (-1*100 + 1) to ((-1+1)*100)
        blocksInUse: 0  // Math.max(0, 0) = 0
      } as never);
    });

    test('should handle missing sequence information', async () => {
      // Mock user statistics
      mockQuery.mockResolvedValueOnce([{
        totalUsers: '500',
        usersWithMembershipId: '400',
        usersWithoutMembershipId: '100'
      }] as never);

      // Mock empty sequence info
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await membershipIdService.getMembershipIdStats();

      expect(result.currentUserCount).toBe(0);  // Default when sequenceInfo is undefined
      expect(result.currentBlock).toBe(-1);  // Math.floor((0-1)/100) = -1
      expect(result.currentBlockRange).toBe('-99-0');  // (-1*100 + 1) to ((-1+1)*100)
    });

    test('should calculate block boundaries correctly for different user counts', async () => {
      const testCases = [
        { userCount: 1, expectedBlock: 0, expectedRange: '1-100' },
        { userCount: 50, expectedBlock: 0, expectedRange: '1-100' },
        { userCount: 100, expectedBlock: 0, expectedRange: '1-100' },
        { userCount: 101, expectedBlock: 1, expectedRange: '101-200' },
        { userCount: 250, expectedBlock: 2, expectedRange: '201-300' },
        { userCount: 1000, expectedBlock: 9, expectedRange: '901-1000' }
      ];

      for (const testCase of testCases) {
        // Mock empty user stats
        mockQuery.mockResolvedValueOnce([{
          totalUsers: '0',
          usersWithMembershipId: '0',
          usersWithoutMembershipId: '0'
        }] as never);

        // Mock specific user count
        mockQuery.mockResolvedValueOnce([{
          current_user_count: testCase.userCount
        }] as never);

        const result = await membershipIdService.getMembershipIdStats();

        expect(result.currentBlock).toBe(testCase.expectedBlock);
        expect(result.currentBlockRange).toBe(testCase.expectedRange);
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed database responses', async () => {
      // Mock malformed response (missing required fields)
      mockQuery.mockResolvedValueOnce([{}] as never);

      await expect(membershipIdService.getMembershipIdStats()).rejects.toThrow();
    });

    test('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection timeout') as never);

      await expect(membershipIdService.getMembershipIdStats()).rejects.toThrow();
    });

    test('should handle SQL syntax errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Syntax error in SQL statement') as never);

      await expect(membershipIdService.getUserByMembershipId('26912345')).rejects.toThrow();
    });
  });
});