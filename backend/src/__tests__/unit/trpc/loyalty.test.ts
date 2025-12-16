import { TRPCError } from '@trpc/server';

// Create mock loyaltyService instance
const mockLoyaltyService = {
  getUserLoyaltyStatus: jest.fn(),
  getTransactionHistory: jest.fn(),
  awardPoints: jest.fn(),
  deductPoints: jest.fn(),
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

// Import router and tRPC test caller after mocks are set up
import { loyaltyRouter } from '../../../trpc/routers/loyalty';
import type { Context } from '../../../trpc/context';

/**
 * Helper to create a tRPC caller with context
 */
const createCaller = (ctx: Context) => {
  return loyaltyRouter.createCaller(ctx);
};

describe('tRPC Loyalty Router', () => {
  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  const mockLoyaltyStatus = {
    user_id: 'customer-1',
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
        user_id: 'customer-1',
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
    it('should return loyalty status for authenticated user without userId', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);

      const result = await caller.getStatus({});

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual(mockLoyaltyStatus);
    });

    it('should return loyalty status for authenticated user with own userId', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);

      const result = await caller.getStatus({ userId: 'customer-1' });

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual(mockLoyaltyStatus);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getStatus({})).rejects.toThrow(TRPCError);
      await expect(caller.getStatus({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw error when customer tries to view another user status', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(caller.getStatus({ userId: 'other-user' })).rejects.toThrow(
        "Forbidden: Cannot view other user's loyalty status"
      );
    });

    it('should allow admin to view other user status', async () => {
      const caller = createCaller({ user: adminUser });
      const otherUserStatus = { ...mockLoyaltyStatus, user_id: 'other-user' };
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(otherUserStatus);

      const result = await caller.getStatus({ userId: 'other-user' });

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('other-user');
      expect(result).toEqual(otherUserStatus);
    });

    it('should allow admin to view own status without userId', async () => {
      const caller = createCaller({ user: adminUser });
      const adminStatus = { ...mockLoyaltyStatus, user_id: 'admin-1' };
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(adminStatus);

      const result = await caller.getStatus({});

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('admin-1');
      expect(result).toEqual(adminStatus);
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockRejectedValue(new Error('Database error'));

      await expect(caller.getStatus({})).rejects.toThrow('Database error');
    });
  });

  // ========== getTransactions Tests ==========
  describe('getTransactions', () => {
    it('should return transactions for authenticated user with default pagination', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      const result = await caller.getTransactions({});

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-1', 1, 20);
      expect(result).toEqual(mockTransactionHistory);
    });

    it('should return transactions with custom pagination', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      const result = await caller.getTransactions({ page: 2, pageSize: 50 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-1', 2, 50);
      expect(result).toEqual(mockTransactionHistory);
    });

    it('should enforce maximum pageSize of 100', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      await caller.getTransactions({ page: 1, pageSize: 100 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-1', 1, 100);
    });

    it('should reject pageSize greater than 100', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getTransactions({ page: 1, pageSize: 101 })
      ).rejects.toThrow();
    });

    it('should reject negative page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getTransactions({ page: -1, pageSize: 20 })
      ).rejects.toThrow();
    });

    it('should reject zero page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getTransactions({ page: 0, pageSize: 20 })
      ).rejects.toThrow();
    });

    it('should reject negative pageSize', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getTransactions({ page: 1, pageSize: -10 })
      ).rejects.toThrow();
    });

    it('should reject zero pageSize', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getTransactions({ page: 1, pageSize: 0 })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getTransactions({})).rejects.toThrow(TRPCError);
      await expect(caller.getTransactions({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw error when customer tries to view another user transactions', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getTransactions({ userId: 'other-user' })
      ).rejects.toThrow("Forbidden: Cannot view other user's transactions");
    });

    it('should allow admin to view other user transactions', async () => {
      const caller = createCaller({ user: adminUser });
      const otherUserTransactions = { ...mockTransactionHistory, userId: 'other-user' };
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(otherUserTransactions);

      const result = await caller.getTransactions({ userId: 'other-user', page: 1, pageSize: 20 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('other-user', 1, 20);
      expect(result).toEqual(otherUserTransactions);
    });

    it('should allow customer to view own transactions with explicit userId', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      const result = await caller.getTransactions({ userId: 'customer-1' });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-1', 1, 20);
      expect(result).toEqual(mockTransactionHistory);
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockRejectedValue(new Error('Database error'));

      await expect(caller.getTransactions({})).rejects.toThrow('Database error');
    });
  });

  // ========== awardPoints Tests (Admin Only) ==========
  describe('awardPoints', () => {
    it('should award points successfully as admin', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = { transactionId: 'txn-123', pointsAwarded: 500 };
      mockLoyaltyService.awardPoints.mockResolvedValue(mockResult);

      const result = await caller.awardPoints({
        userId: 'customer-1',
        points: 500,
        reason: 'Bonus points for feedback',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        500,
        'Bonus points for feedback',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
      expect(result).toEqual(mockResult);
    });

    it('should award points with all optional parameters', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = { transactionId: 'txn-123', pointsAwarded: 500 };
      mockLoyaltyService.awardPoints.mockResolvedValue(mockResult);

      const result = await caller.awardPoints({
        userId: 'customer-1',
        points: 500,
        reason: 'Booking completion',
        referenceType: 'booking',
        referenceId: 'booking-123',
        notes: 'Completed first booking',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        500,
        'Booking completion',
        'booking',
        'booking-123',
        'admin-1',
        'Completed first booking'
      );
      expect(result).toEqual(mockResult);
    });

    it('should accept valid referenceType values', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-123' });

      const validTypes = ['booking', 'purchase', 'referral', 'bonus', 'admin_adjustment'] as const;

      for (const type of validTypes) {
        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          referenceType: type,
        });
      }

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledTimes(5);
    });

    it('should reject invalid referenceType', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          referenceType: 'invalid_type' as any,
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to award points', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should reject zero points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 0,
          reason: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should reject negative points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: -100,
          reason: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should reject non-integer points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 99.5,
          reason: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should accept empty userId string (validated by service layer)', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-123' });

      await caller.awardPoints({
        userId: '',
        points: 100,
        reason: 'Test',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        '',
        100,
        'Test',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
    });

    it('should accept empty reason string (validated by service layer)', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-123' });

      await caller.awardPoints({
        userId: 'customer-1',
        points: 100,
        reason: '',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        100,
        '',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockRejectedValue(new Error('Insufficient balance'));

      await expect(
        caller.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toThrow('Insufficient balance');
    });
  });

  // ========== deductPoints Tests (Admin Only) ==========
  describe('deductPoints', () => {
    it('should deduct points successfully as admin', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = { transactionId: 'txn-456', pointsDeducted: 200 };
      mockLoyaltyService.deductPoints.mockResolvedValue(mockResult);

      const result = await caller.deductPoints({
        userId: 'customer-1',
        points: 200,
        reason: 'Points correction',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-1',
        200,
        'Points correction',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
      expect(result).toEqual(mockResult);
    });

    it('should deduct points with all optional parameters', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = { transactionId: 'txn-456', pointsDeducted: 200 };
      mockLoyaltyService.deductPoints.mockResolvedValue(mockResult);

      const result = await caller.deductPoints({
        userId: 'customer-1',
        points: 200,
        reason: 'Redemption',
        referenceType: 'redemption',
        referenceId: 'redemption-123',
        notes: 'Redeemed for hotel stay',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-1',
        200,
        'Redemption',
        'redemption',
        'redemption-123',
        'admin-1',
        'Redeemed for hotel stay'
      );
      expect(result).toEqual(mockResult);
    });

    it('should accept valid referenceType values', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-123' });

      const validTypes = ['redemption', 'correction', 'admin_adjustment'] as const;

      for (const type of validTypes) {
        await caller.deductPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          referenceType: type,
        });
      }

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledTimes(3);
    });

    it('should reject invalid referenceType', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          referenceType: 'invalid_type' as any,
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to deduct points', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should reject zero points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 0,
          reason: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should reject negative points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: -100,
          reason: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should reject non-integer points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 50.25,
          reason: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should accept empty userId string (validated by service layer)', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-456' });

      await caller.deductPoints({
        userId: '',
        points: 100,
        reason: 'Test',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        '',
        100,
        'Test',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
    });

    it('should accept empty reason string (validated by service layer)', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-456' });

      await caller.deductPoints({
        userId: 'customer-1',
        points: 100,
        reason: '',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-1',
        100,
        '',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.deductPoints.mockRejectedValue(new Error('Insufficient points'));

      await expect(
        caller.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toThrow('Insufficient points');
    });
  });

  // ========== getTierConfig Tests ==========
  describe('getTierConfig', () => {
    it('should return tier configuration for authenticated user', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(mockTierConfig);

      const result = await caller.getTierConfig();

      expect(mockLoyaltyService.getTierConfiguration).toHaveBeenCalled();
      expect(result).toEqual(mockTierConfig);
    });

    it('should return tier configuration for admin', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(mockTierConfig);

      const result = await caller.getTierConfig();

      expect(mockLoyaltyService.getTierConfiguration).toHaveBeenCalled();
      expect(result).toEqual(mockTierConfig);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getTierConfig()).rejects.toThrow(TRPCError);
      await expect(caller.getTierConfig()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle empty tier configuration', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTierConfiguration.mockResolvedValue([]);

      const result = await caller.getTierConfig();

      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTierConfiguration.mockRejectedValue(new Error('Database error'));

      await expect(caller.getTierConfig()).rejects.toThrow('Database error');
    });
  });

  // ========== updateTierConfig Tests (Admin Only) ==========
  describe('updateTierConfig', () => {
    it('should update tier configuration as admin', async () => {
      const caller = createCaller({ user: adminUser });
      const updatedTier = { ...mockTierConfig[0], name: 'Updated Bronze' };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        name: 'Updated Bronze',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {
          name: 'Updated Bronze',
        }
      );
      expect(result).toEqual(updatedTier);
    });

    it('should update tier with required_points', async () => {
      const caller = createCaller({ user: adminUser });
      const updatedTier = { ...mockTierConfig[0], required_points: 500 };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        required_points: 500,
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {
          required_points: 500,
        }
      );
      expect(result).toEqual(updatedTier);
    });

    it('should update tier with benefits array', async () => {
      const caller = createCaller({ user: adminUser });
      const updatedTier = { ...mockTierConfig[0], benefits: ['Perk 1', 'Perk 2'] };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        benefits: ['Perk 1', 'Perk 2'],
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {
          benefits: ['Perk 1', 'Perk 2'],
        }
      );
      expect(result).toEqual(updatedTier);
    });

    it('should update tier with color and icon', async () => {
      const caller = createCaller({ user: adminUser });
      const updatedTier = { ...mockTierConfig[0], color: '#FF0000', icon: 'new-icon' };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        color: '#FF0000',
        icon: 'new-icon',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {
          color: '#FF0000',
          icon: 'new-icon',
        }
      );
      expect(result).toEqual(updatedTier);
    });

    it('should update tier with all fields', async () => {
      const caller = createCaller({ user: adminUser });
      const updatedTier = { ...mockTierConfig[0] };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.updateTierConfig({
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
      expect(result).toEqual(updatedTier);
    });

    it('should accept zero required_points', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(mockTierConfig[0]);

      await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        required_points: 0,
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {
          required_points: 0,
        }
      );
    });

    it('should reject negative required_points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.updateTierConfig({
          tierId: 'tier-1',
          required_points: -100,
        })
      ).rejects.toThrow();
    });

    it('should reject non-integer required_points', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.updateTierConfig({
          tierId: 'tier-1',
          required_points: 99.5,
        })
      ).rejects.toThrow();
    });

    it('should require valid UUID for tierId', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.updateTierConfig({
          tierId: 'not-a-uuid',
          name: 'Test',
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to update tier', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.updateTierConfiguration.mockRejectedValue(
        new Error('Tier not found')
      );

      await expect(
        caller.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toThrow('Tier not found');
    });
  });
});
