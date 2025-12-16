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
import { appRouter, AppRouter } from '../../../trpc/routers/_app';
import type { Context } from '../../../trpc/context';

/**
 * Helper to create a tRPC caller with context
 */
const createCaller = (ctx: Context) => {
  return appRouter.createCaller(ctx);
};

describe('tRPC App Router', () => {
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

  // ========== Router Structure Tests ==========
  describe('Router Structure', () => {
    it('should have appRouter defined', () => {
      expect(appRouter).toBeDefined();
    });

    it('should have loyalty sub-router', () => {
      expect(appRouter).toHaveProperty('loyalty');
    });

    it('should have AppRouter type exported', () => {
      // Type test - this will fail at compile time if type is not exported
      const typeCheck: AppRouter = appRouter;
      expect(typeCheck).toBe(appRouter);
    });

    it('should have all expected procedures in loyalty router', () => {
      const loyaltyRouter = appRouter.loyalty;

      // Check that all procedures exist
      expect(loyaltyRouter).toHaveProperty('getStatus');
      expect(loyaltyRouter).toHaveProperty('getTransactions');
      expect(loyaltyRouter).toHaveProperty('awardPoints');
      expect(loyaltyRouter).toHaveProperty('deductPoints');
      expect(loyaltyRouter).toHaveProperty('getTierConfig');
      expect(loyaltyRouter).toHaveProperty('updateTierConfig');
    });

    it('should create caller with context', () => {
      const caller = createCaller({ user: customerUser });
      expect(caller).toBeDefined();
      expect(caller).toHaveProperty('loyalty');
    });

    it('should have loyalty namespace in caller', () => {
      const caller = createCaller({ user: customerUser });
      expect(caller.loyalty).toBeDefined();
      expect(caller.loyalty).toHaveProperty('getStatus');
      expect(caller.loyalty).toHaveProperty('getTransactions');
      expect(caller.loyalty).toHaveProperty('getTierConfig');
    });
  });

  // ========== Router Composition Tests ==========
  describe('Router Composition', () => {
    it('should access loyalty.getStatus through appRouter', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);

      const result = await caller.loyalty.getStatus({});

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual(mockLoyaltyStatus);
    });

    it('should access loyalty.getTransactions through appRouter', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);

      const result = await caller.loyalty.getTransactions({});

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-1', 1, 20);
      expect(result).toEqual(mockTransactionHistory);
    });

    it('should access loyalty.getTierConfig through appRouter', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(mockTierConfig);

      const result = await caller.loyalty.getTierConfig();

      expect(mockLoyaltyService.getTierConfiguration).toHaveBeenCalled();
      expect(result).toEqual(mockTierConfig);
    });

    it('should access loyalty.awardPoints through appRouter (admin)', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue('txn-123');

      const result = await caller.loyalty.awardPoints({
        userId: 'customer-1',
        points: 500,
        reason: 'Bonus points',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        500,
        'Bonus points',
        undefined,
        undefined,
        'admin-1',
        undefined
      );
      expect(result).toBe('txn-123');
    });

    it('should access loyalty.deductPoints through appRouter (admin)', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.deductPoints.mockResolvedValue('txn-456');

      const result = await caller.loyalty.deductPoints({
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
      expect(result).toBe('txn-456');
    });

    it('should access loyalty.updateTierConfig through appRouter (admin)', async () => {
      const caller = createCaller({ user: adminUser });
      const updatedTier = { ...mockTierConfig[0], name: 'Updated Bronze' };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);

      const result = await caller.loyalty.updateTierConfig({
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
  });

  // ========== Authentication & Authorization through App Router ==========
  describe('Authentication & Authorization', () => {
    it('should enforce authentication for loyalty.getStatus', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.loyalty.getStatus({})).rejects.toThrow(TRPCError);
      await expect(caller.loyalty.getStatus({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should enforce authentication for loyalty.getTransactions', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.loyalty.getTransactions({})).rejects.toThrow(TRPCError);
      await expect(caller.loyalty.getTransactions({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should enforce authentication for loyalty.getTierConfig', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.loyalty.getTierConfig()).rejects.toThrow(TRPCError);
      await expect(caller.loyalty.getTierConfig()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should enforce admin access for loyalty.awardPoints', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.loyalty.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.loyalty.awardPoints({
          userId: 'customer-1',
          points: 500,
          reason: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should enforce admin access for loyalty.deductPoints', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.loyalty.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.loyalty.deductPoints({
          userId: 'customer-1',
          points: 200,
          reason: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should enforce admin access for loyalty.updateTierConfig', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.loyalty.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.loyalty.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  // ========== Integration-Style Tests ==========
  describe('Integration-Style Tests', () => {
    it('should handle complete loyalty workflow for customer', async () => {
      const caller = createCaller({ user: customerUser });

      // Get status
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);
      const status = await caller.loyalty.getStatus({});
      expect(status).toEqual(mockLoyaltyStatus);

      // Get transactions
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);
      const transactions = await caller.loyalty.getTransactions({});
      expect(transactions).toEqual(mockTransactionHistory);

      // Get tier config
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(mockTierConfig);
      const tiers = await caller.loyalty.getTierConfig();
      expect(tiers).toEqual(mockTierConfig);

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyService.getTierConfiguration).toHaveBeenCalledTimes(1);
    });

    it('should handle complete admin workflow', async () => {
      const caller = createCaller({ user: adminUser });

      // Award points
      mockLoyaltyService.awardPoints.mockResolvedValue('txn-123');
      const awardResult = await caller.loyalty.awardPoints({
        userId: 'customer-1',
        points: 500,
        reason: 'Bonus',
      });
      expect(awardResult).toBe('txn-123');

      // Deduct points
      mockLoyaltyService.deductPoints.mockResolvedValue('txn-456');
      const deductResult = await caller.loyalty.deductPoints({
        userId: 'customer-1',
        points: 200,
        reason: 'Correction',
      });
      expect(deductResult).toBe('txn-456');

      // Update tier config
      const updatedTier = { ...mockTierConfig[0], name: 'New Bronze' };
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue(updatedTier);
      const tierResult = await caller.loyalty.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        name: 'New Bronze',
      });
      expect(tierResult.name).toBe('New Bronze');

      // View another user's status
      const otherUserStatus = { ...mockLoyaltyStatus, user_id: 'other-user' };
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(otherUserStatus);
      const statusResult = await caller.loyalty.getStatus({ userId: 'other-user' });
      expect(statusResult?.user_id).toBe('other-user');

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledTimes(1);
    });

    it('should handle errors from loyalty procedures', async () => {
      const caller = createCaller({ user: customerUser });

      // Service error on getStatus
      mockLoyaltyService.getUserLoyaltyStatus.mockRejectedValue(new Error('Database error'));
      await expect(caller.loyalty.getStatus({})).rejects.toThrow('Database error');

      // Service error on getTransactions
      mockLoyaltyService.getTransactionHistory.mockRejectedValue(new Error('Connection timeout'));
      await expect(caller.loyalty.getTransactions({})).rejects.toThrow('Connection timeout');

      // Service error on getTierConfig
      mockLoyaltyService.getTierConfiguration.mockRejectedValue(new Error('Config not found'));
      await expect(caller.loyalty.getTierConfig()).rejects.toThrow('Config not found');
    });

    it('should handle errors from admin procedures', async () => {
      const caller = createCaller({ user: adminUser });

      // Service error on awardPoints
      mockLoyaltyService.awardPoints.mockRejectedValue(new Error('Invalid user'));
      await expect(
        caller.loyalty.awardPoints({
          userId: 'invalid',
          points: 100,
          reason: 'Test',
        })
      ).rejects.toThrow('Invalid user');

      // Service error on deductPoints
      mockLoyaltyService.deductPoints.mockRejectedValue(new Error('Insufficient points'));
      await expect(
        caller.loyalty.deductPoints({
          userId: 'customer-1',
          points: 10000,
          reason: 'Test',
        })
      ).rejects.toThrow('Insufficient points');

      // Service error on updateTierConfig
      mockLoyaltyService.updateTierConfiguration.mockRejectedValue(new Error('Tier not found'));
      await expect(
        caller.loyalty.updateTierConfig({
          tierId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          name: 'Test',
        })
      ).rejects.toThrow('Tier not found');
    });
  });

  // ========== Type Safety Tests ==========
  describe('Type Safety', () => {
    it('should have correct type for AppRouter', () => {
      // This test verifies that the type can be assigned
      const router: AppRouter = appRouter;
      expect(router).toBe(appRouter);
    });

    it('should export AppRouter type for frontend use', () => {
      // TypeScript compilation will fail if AppRouter type is not exported
      // This test verifies the type is accessible
      type TestType = AppRouter;
      const _typeTest: TestType = appRouter;
      expect(_typeTest).toBeDefined();
    });

    it('should maintain type safety through caller', () => {
      const caller = createCaller({ user: customerUser });

      // TypeScript should enforce correct parameter types
      // These compile-time checks ensure type safety
      expect(caller.loyalty).toBeDefined();
      expect(typeof caller.loyalty.getStatus).toBe('function');
      expect(typeof caller.loyalty.getTransactions).toBe('function');
      expect(typeof caller.loyalty.getTierConfig).toBe('function');
    });
  });

  // ========== Edge Cases ==========
  describe('Edge Cases', () => {
    it('should handle null user context', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.loyalty.getStatus({})).rejects.toThrow(TRPCError);
    });

    it('should handle multiple simultaneous requests', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);
      mockLoyaltyService.getTransactionHistory.mockResolvedValue(mockTransactionHistory);
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(mockTierConfig);

      // Make multiple requests in parallel
      const [status, transactions, tiers] = await Promise.all([
        caller.loyalty.getStatus({}),
        caller.loyalty.getTransactions({}),
        caller.loyalty.getTierConfig(),
      ]);

      expect(status).toEqual(mockLoyaltyStatus);
      expect(transactions).toEqual(mockTransactionHistory);
      expect(tiers).toEqual(mockTierConfig);
    });

    it('should isolate contexts between callers', async () => {
      const customerCaller = createCaller({ user: customerUser });
      const adminCaller = createCaller({ user: adminUser });

      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockLoyaltyStatus);

      // Customer can only view own status
      await expect(customerCaller.loyalty.getStatus({ userId: 'other-user' }))
        .rejects.toThrow("Forbidden: Cannot view other user's loyalty status");

      // Admin can view any user status
      const otherUserStatus = { ...mockLoyaltyStatus, user_id: 'other-user' };
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(otherUserStatus);
      const result = await adminCaller.loyalty.getStatus({ userId: 'other-user' });
      expect(result?.user_id).toBe('other-user');
    });

    it('should handle service returning null or undefined', async () => {
      const caller = createCaller({ user: customerUser });

      // Service returns null
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(null);
      const nullResult = await caller.loyalty.getStatus({});
      expect(nullResult).toBeNull();

      // Service returns undefined
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(undefined);
      const undefinedResult = await caller.loyalty.getStatus({});
      expect(undefinedResult).toBeUndefined();
    });
  });
});
