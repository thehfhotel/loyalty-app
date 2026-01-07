/**
 * tRPC Loyalty Router Integration Tests
 * Tests the Loyalty router with actual service integration
 */

 

import { TRPCError } from '@trpc/server';

// Create mock loyaltyService instance
const mockLoyaltyService = {
  getUserLoyaltyStatus: jest.fn(),
  getTransactionHistory: jest.fn(),
  awardPoints: jest.fn(),
  deductPoints: jest.fn(),
  getAllTiers: jest.fn(),
  getTierConfiguration: jest.fn(),
  updateTierConfiguration: jest.fn(),
};

// Mock the loyaltyService before importing the router
jest.mock('../../../services/loyaltyService', () => ({
  loyaltyService: mockLoyaltyService,
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
import { loyaltyRouter } from '../../../trpc/routers/loyalty';
import { mockUsers, createCallerWithUser } from './helpers';

describe('tRPC Loyalty Router Integration Tests', () => {
  const adminUser = mockUsers.admin;
  const customerUser = mockUsers.customer;

  const mockLoyaltyStatus = {
    user_id: 'customer-test-id',
    current_points: 5000,
    total_nights: 12,
    tier_name: 'Gold',
    tier_color: '#FFD700',
    tier_benefits: { perks: ['Priority check-in', 'Room upgrades'] },
    tier_level: 2,
    progress_percentage: 60,
    next_tier_nights: 20,
    next_tier_name: 'Platinum',
    nights_to_next_tier: 8,
  };

  const mockTransactionHistory = {
    transactions: [
      {
        id: 'txn-1',
        user_id: 'customer-test-id',
        points: 500,
        type: 'earn',
        description: 'Hotel stay points',
        reference_id: 'stay-123',
        admin_user_id: null,
        admin_reason: null,
        expires_at: new Date('2026-01-01'),
        created_at: new Date('2025-01-01'),
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };

  const mockAllTiers = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Bronze',
      min_nights: 0,
      benefits: ['Basic rewards'],
      color: '#CD7F32',
      icon: 'bronze-icon',
      level: 0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Silver',
      min_nights: 1,
      benefits: ['Enhanced rewards', 'Priority support'],
      color: '#C0C0C0',
      icon: 'silver-icon',
      level: 1,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];

  const mockTierConfig = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Bronze',
      required_points: 0,
      benefits: ['Basic rewards'],
      color: '#CD7F32',
      icon: 'bronze-icon',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Silver',
      required_points: 1000,
      benefits: ['Enhanced rewards', 'Priority support'],
      color: '#C0C0C0',
      icon: 'silver-icon',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getStatus Tests ==========
  describe('getStatus', () => {
    it('should return loyalty status for authenticated user', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);

      const result = await caller.getStatus({});

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(mockLoyaltyStatus);
    });

    it('should allow user to view own status with explicit userId', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);

      const result = await caller.getStatus({ userId: 'customer-test-id' });

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual(mockLoyaltyStatus);
    });

    it('should allow admin to view other user status', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const otherUserStatus = { ...mockLoyaltyStatus, user_id: 'other-user-id' };
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(otherUserStatus);

      const result = await caller.getStatus({ userId: 'other-user-id' });

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('other-user-id');
      expect(result).toEqual(otherUserStatus);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(caller.getStatus({})).rejects.toThrow(TRPCError);
      await expect(caller.getStatus({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw error when customer tries to view another user status', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(caller.getStatus({ userId: 'other-user-id' })).rejects.toThrow(
        "Forbidden: Cannot view other user's loyalty status"
      );
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getUserLoyaltyStatus.mockRejectedValue(new Error('Database error'));

      await expect(caller.getStatus({})).rejects.toThrow('Database error');
    });
  });

  // ========== getTransactions Tests ==========
  describe('getTransactions', () => {
    it('should return transactions for authenticated user with default pagination', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      const result = await caller.getTransactions({});

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-test-id', 1, 20);
      expect(result).toEqual(mockTransactionHistory);
    });

    it('should support custom pagination', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      await caller.getTransactions({ page: 2, pageSize: 50 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-test-id', 2, 50);
    });

    it('should enforce maximum pageSize of 100', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      await caller.getTransactions({ page: 1, pageSize: 100 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-test-id', 1, 100);
    });

    it('should reject pageSize greater than 100', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(caller.getTransactions({ page: 1, pageSize: 101 })).rejects.toThrow();
    });

    it('should reject invalid page numbers', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(caller.getTransactions({ page: 0, pageSize: 20 })).rejects.toThrow();
      await expect(caller.getTransactions({ page: -1, pageSize: 20 })).rejects.toThrow();
    });

    it('should allow admin to view other user transactions', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      await caller.getTransactions({ userId: 'other-user-id', page: 1, pageSize: 20 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('other-user-id', 1, 20);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(caller.getTransactions({})).rejects.toThrow(TRPCError);
      await expect(caller.getTransactions({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw error when customer tries to view another user transactions', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(caller.getTransactions({ userId: 'other-user-id' })).rejects.toThrow(
        "Forbidden: Cannot view other user's transactions"
      );
    });
  });

  // ========== awardPoints Tests (Admin Only) ==========
  describe('awardPoints', () => {
    it('should award points successfully as admin', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const mockResult = { transactionId: 'txn-123', pointsAwarded: 500 };
      mockLoyaltyService.awardPoints.mockResolvedValue(mockResult);

      const result = await caller.awardPoints({
        userId: 'customer-test-id',
        points: 500,
        reason: 'Bonus points for feedback',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-test-id',
        500,
        'Bonus points for feedback',
        undefined,
        undefined,
        'admin-test-id',
        undefined
      );
      expect(result).toEqual(mockResult);
    });

    it('should award points with all optional parameters', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const mockResult = { transactionId: 'txn-123', pointsAwarded: 500 };
      mockLoyaltyService.awardPoints.mockResolvedValue(mockResult);

      await caller.awardPoints({
        userId: 'customer-test-id',
        points: 500,
        reason: 'Booking completion',
        referenceType: 'booking',
        referenceId: 'booking-123',
        notes: 'Completed first booking',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-test-id',
        500,
        'Booking completion',
        'booking',
        'booking-123',
        'admin-test-id',
        'Completed first booking'
      );
    });

    it('should accept valid referenceType values', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-123' });

      const validTypes = ['booking', 'purchase', 'referral', 'bonus', 'admin_adjustment'] as const;

      for (const type of validTypes) {
        await caller.awardPoints({
          userId: 'customer-test-id',
          points: 100,
          reason: 'Test',
          referenceType: type,
        });
      }

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledTimes(5);
    });

    it('should reject invalid points values', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);

      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: 0, reason: 'Test' })
      ).rejects.toThrow();

      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: -100, reason: 'Test' })
      ).rejects.toThrow();

      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: 99.5, reason: 'Test' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: 500, reason: 'Test' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: 500, reason: 'Test' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to award points', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: 500, reason: 'Test' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.awardPoints({ userId: 'customer-test-id', points: 500, reason: 'Test' })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== deductPoints Tests (Admin Only) ==========
  describe('deductPoints', () => {
    it('should deduct points successfully as admin', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const mockResult = { transactionId: 'txn-456', pointsDeducted: 200 };
      mockLoyaltyService.deductPoints.mockResolvedValue(mockResult);

      const result = await caller.deductPoints({
        userId: 'customer-test-id',
        points: 200,
        reason: 'Points correction',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-test-id',
        200,
        'Points correction',
        undefined,
        undefined,
        'admin-test-id',
        undefined
      );
      expect(result).toEqual(mockResult);
    });

    it('should deduct points with all optional parameters', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const mockResult = { transactionId: 'txn-456', pointsDeducted: 200 };
      mockLoyaltyService.deductPoints.mockResolvedValue(mockResult);

      await caller.deductPoints({
        userId: 'customer-test-id',
        points: 200,
        reason: 'Redemption',
        referenceType: 'redemption',
        referenceId: 'redemption-123',
        notes: 'Redeemed for hotel stay',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-test-id',
        200,
        'Redemption',
        'redemption',
        'redemption-123',
        'admin-test-id',
        'Redeemed for hotel stay'
      );
    });

    it('should accept valid referenceType values', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-123' });

      const validTypes = ['redemption', 'correction', 'admin_adjustment'] as const;

      for (const type of validTypes) {
        await caller.deductPoints({
          userId: 'customer-test-id',
          points: 100,
          reason: 'Test',
          referenceType: type,
        });
      }

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledTimes(3);
    });

    it('should reject invalid points values', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);

      await expect(
        caller.deductPoints({ userId: 'customer-test-id', points: 0, reason: 'Test' })
      ).rejects.toThrow();

      await expect(
        caller.deductPoints({ userId: 'customer-test-id', points: -100, reason: 'Test' })
      ).rejects.toThrow();

      await expect(
        caller.deductPoints({ userId: 'customer-test-id', points: 50.25, reason: 'Test' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(
        caller.deductPoints({ userId: 'customer-test-id', points: 200, reason: 'Test' })
      ).rejects.toThrow(TRPCError);
    });

    it('should throw FORBIDDEN when customer tries to deduct points', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(
        caller.deductPoints({ userId: 'customer-test-id', points: 200, reason: 'Test' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.deductPoints({ userId: 'customer-test-id', points: 200, reason: 'Test' })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== getAllTiers Tests ==========
  describe('getAllTiers', () => {
    it('should return all tiers for authenticated user', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getAllTiers.mockResolvedValue(mockAllTiers);

      const result = await caller.getAllTiers();

      expect(mockLoyaltyService.getAllTiers).toHaveBeenCalled();
      expect(result).toEqual(mockAllTiers);
    });

    it('should return all tiers for admin', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      mockLoyaltyService.getAllTiers.mockResolvedValue(mockAllTiers);

      const result = await caller.getAllTiers();

      expect(mockLoyaltyService.getAllTiers).toHaveBeenCalled();
      expect(result).toEqual(mockAllTiers);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(caller.getAllTiers()).rejects.toThrow(TRPCError);
      await expect(caller.getAllTiers()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle empty tier list', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getAllTiers.mockResolvedValue([]);

      const result = await caller.getAllTiers();

      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getAllTiers.mockRejectedValue(new Error('Database error'));

      await expect(caller.getAllTiers()).rejects.toThrow('Database error');
    });
  });

  // ========== getTierConfig Tests ==========
  describe('getTierConfig', () => {
    it('should return tier configuration for authenticated user', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(mockTierConfig);

      const result = await caller.getTierConfig();

      expect(mockLoyaltyService.getTierConfiguration).toHaveBeenCalled();
      expect(result).toEqual(mockTierConfig);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(caller.getTierConfig()).rejects.toThrow(TRPCError);
      await expect(caller.getTierConfig()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);
      mockLoyaltyService.getTierConfiguration.mockRejectedValue(new Error('Database error'));

      await expect(caller.getTierConfig()).rejects.toThrow('Database error');
    });
  });

  // ========== updateTierConfig Tests (Admin Only) ==========
  describe('updateTierConfig', () => {
    it('should update tier configuration as admin', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const updatedTier = { ...mockTierConfig[0], name: 'Updated Bronze' };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        name: 'Updated Bronze',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        { name: 'Updated Bronze' }
      );
      expect(result).toEqual(updatedTier);
    });

    it('should update tier with all fields', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      const updatedTier = { ...mockTierConfig[0] };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        name: 'Updated Name',
        required_points: 1000,
        benefits: ['Benefit 1', 'Benefit 2'],
        color: '#00FF00',
        icon: 'updated-icon',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {
          name: 'Updated Name',
          required_points: 1000,
          benefits: ['Benefit 1', 'Benefit 2'],
          color: '#00FF00',
          icon: 'updated-icon',
        }
      );
    });

    it('should accept zero required_points', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(mockTierConfig[0]);

      await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        required_points: 0,
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        { required_points: 0 }
      );
    });

    it('should reject negative required_points', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);

      await expect(
        caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          required_points: -100,
        })
      ).rejects.toThrow();
    });

    it('should require valid UUID for tierId', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);

      await expect(
        caller.updateTierConfig({
          tierId: 'not-a-uuid',
          name: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCallerWithUser(loyaltyRouter, null);

      await expect(
        caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
        })
      ).rejects.toThrow(TRPCError);
    });

    it('should throw FORBIDDEN when customer tries to update tier', async () => {
      const caller = createCallerWithUser(loyaltyRouter, customerUser);

      await expect(
        caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCallerWithUser(loyaltyRouter, adminUser);
      mockLoyaltyService.updateTierConfiguration.mockRejectedValue(new Error('Tier not found'));

      await expect(
        caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
        })
      ).rejects.toThrow('Tier not found');
    });
  });

  // ========== Nullable Fields Tests ==========
  describe('nullable fields handling', () => {
    describe('getStatus with null fields', () => {
      it('should handle null next_tier_name for top-tier users', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        const topTierStatus = {
          ...mockLoyaltyStatus,
          tier_name: 'Platinum',
          tier_level: 3,
          next_tier_name: null,
          next_tier_nights: null,
          nights_to_next_tier: null,
          progress_percentage: 100,
        };
        mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(topTierStatus);

        const result = await caller.getStatus({});

        expect(result).not.toBeNull();
        expect(result!.next_tier_name).toBeNull();
        expect(result!.nights_to_next_tier).toBeNull();
        expect(result!.next_tier_nights).toBeNull();
      });

      it('should handle null tier_benefits', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        const statusWithNullBenefits = {
          ...mockLoyaltyStatus,
          tier_benefits: null,
        };
        mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(statusWithNullBenefits);

        const result = await caller.getStatus({});

        expect(result).not.toBeNull();
        expect(result!.tier_benefits).toBeNull();
      });

      it('should handle user with no loyalty record (null response)', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(null);

        const result = await caller.getStatus({});

        expect(result).toBeNull();
      });

      it('should handle loyalty status with minimal fields', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        const minimalStatus = {
          user_id: 'customer-test-id',
          current_points: 0,
          total_nights: 0,
          tier_name: 'Bronze',
          tier_color: null,
          tier_benefits: null,
          tier_level: 0,
          progress_percentage: null,
          next_tier_nights: null,
          next_tier_name: null,
          nights_to_next_tier: null,
        };
        mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(minimalStatus);

        const result = await caller.getStatus({});

        expect(result).not.toBeNull();
        expect(result!.tier_color).toBeNull();
        expect(result!.tier_benefits).toBeNull();
        expect(result!.progress_percentage).toBeNull();
      });
    });

    describe('getTransactions with null fields', () => {
      it('should handle null admin fields in transactions', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        const transactionsWithNullAdmin = {
          ...mockTransactionHistory,
          transactions: [
            {
              id: 'txn-1',
              user_id: 'customer-test-id',
              points: 500,
              type: 'earn',
              description: 'Hotel stay points',
              reference_id: 'stay-123',
              admin_user_id: null,
              admin_reason: null,
              expires_at: null,
              created_at: new Date('2025-01-01'),
            },
          ],
        };
        mockLoyaltyService.getTransactionHistory.mockResolvedValue(transactionsWithNullAdmin);

        const result = await caller.getTransactions({});

        expect(result.transactions[0]?.admin_user_id).toBeNull();
        expect(result.transactions[0]?.admin_reason).toBeNull();
        expect(result.transactions[0]?.expires_at).toBeNull();
      });

      it('should handle null transaction description', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        const transactionsWithNullDescription = {
          ...mockTransactionHistory,
          transactions: [
            {
              id: 'txn-1',
              user_id: 'customer-test-id',
              points: 500,
              type: 'earn',
              description: null,
              reference_id: null,
              admin_user_id: null,
              admin_reason: null,
              expires_at: null,
              created_at: new Date('2025-01-01'),
            },
          ],
        };
        mockLoyaltyService.getTransactionHistory.mockResolvedValue(transactionsWithNullDescription);

        const result = await caller.getTransactions({});

        expect(result.transactions[0]?.description).toBeNull();
        expect(result.transactions[0]?.reference_id).toBeNull();
      });

      it('should handle empty transaction list', async () => {
        const caller = createCallerWithUser(loyaltyRouter, customerUser);
        const emptyTransactions = {
          transactions: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 0,
        };
        mockLoyaltyService.getTransactionHistory.mockResolvedValue(emptyTransactions);

        const result = await caller.getTransactions({});

        expect(result.transactions).toHaveLength(0);
        expect(result.total).toBe(0);
      });
    });
  });
});
