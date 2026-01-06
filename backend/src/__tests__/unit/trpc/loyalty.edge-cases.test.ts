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

describe('tRPC Loyalty Router - Edge Cases', () => {
  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };
  const superAdminUser = {
    id: 'super-admin-1',
    role: 'super_admin' as const,
    email: 'superadmin@test.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== Boundary Value Tests ==========
  describe('Boundary Value Tests', () => {
    describe('awardPoints - Maximum Integer Values', () => {
      it('should handle maximum safe integer points', async () => {
        const caller = createCaller({ user: adminUser });
        const maxPoints = Number.MAX_SAFE_INTEGER;
        mockLoyaltyService.awardPoints.mockResolvedValue({
          transactionId: 'txn-max',
          pointsAwarded: maxPoints,
        });

        const result = await caller.awardPoints({
          userId: 'customer-1',
          points: maxPoints,
          reason: 'Maximum points test',
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          maxPoints,
          'Maximum points test',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
        expect(result).toMatchObject({ transactionId: 'txn-max' });
      });

      it('should handle very large but valid integer points', async () => {
        const caller = createCaller({ user: adminUser });
        const largePoints = 999999999;
        mockLoyaltyService.awardPoints.mockResolvedValue({
          transactionId: 'txn-large',
          pointsAwarded: largePoints,
        });

        const result = await caller.awardPoints({
          userId: 'customer-1',
          points: largePoints,
          reason: 'Large points test',
        });

        expect(result).toMatchObject({ transactionId: 'txn-large' });
      });

      it('should handle minimum valid positive points (1)', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.awardPoints.mockResolvedValue({
          transactionId: 'txn-min',
          pointsAwarded: 1,
        });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 1,
          reason: 'Minimum points test',
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          1,
          'Minimum points test',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });
    });

    describe('deductPoints - Maximum Integer Values', () => {
      it('should handle maximum safe integer points', async () => {
        const caller = createCaller({ user: adminUser });
        const maxPoints = Number.MAX_SAFE_INTEGER;
        mockLoyaltyService.deductPoints.mockResolvedValue({
          transactionId: 'txn-max-deduct',
          pointsDeducted: maxPoints,
        });

        await caller.deductPoints({
          userId: 'customer-1',
          points: maxPoints,
          reason: 'Maximum deduction test',
        });

        expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
          'customer-1',
          maxPoints,
          'Maximum deduction test',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });
    });

    describe('Very Long Strings for reason/notes', () => {
      it('should handle very long reason string (1000 characters)', async () => {
        const caller = createCaller({ user: adminUser });
        const longReason = 'A'.repeat(1000);
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-long' });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: longReason,
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          longReason,
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });

      it('should handle very long notes string (5000 characters)', async () => {
        const caller = createCaller({ user: adminUser });
        const longNotes = 'B'.repeat(5000);
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-long-notes' });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          notes: longNotes,
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          'Test',
          undefined,
          undefined,
          'admin-1',
          longNotes
        );
      });

      it('should handle extremely long referenceId', async () => {
        const caller = createCaller({ user: adminUser });
        const longReferenceId = 'ref-' + 'x'.repeat(500);
        mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-long-ref' });

        await caller.deductPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          referenceId: longReferenceId,
        });

        expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          'Test',
          undefined,
          longReferenceId,
          'admin-1',
          undefined
        );
      });
    });

    describe('Very Large Page Numbers', () => {
      it('should handle very large page number', async () => {
        const caller = createCaller({ user: customerUser });
        const largePage = 999999;
        mockLoyaltyService.getTransactionHistory.mockResolvedValue({
          transactions: [],
          total: 0,
          page: largePage,
          pageSize: 20,
          totalPages: 0,
        });

        const result = await caller.getTransactions({ page: largePage, pageSize: 20 });

        expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith(
          'customer-1',
          largePage,
          20
        );
        expect(result.page).toBe(largePage);
      });

      it('should handle maximum safe integer as page number', async () => {
        const caller = createCaller({ user: customerUser });
        const maxPage = Number.MAX_SAFE_INTEGER;
        mockLoyaltyService.getTransactionHistory.mockResolvedValue({
          transactions: [],
          total: 0,
          page: maxPage,
          pageSize: 20,
          totalPages: 0,
        });

        const result = await caller.getTransactions({ page: maxPage, pageSize: 20 });

        expect(result.page).toBe(maxPage);
      });
    });

    describe('Unicode Characters in reason/notes', () => {
      it('should handle emoji in reason', async () => {
        const caller = createCaller({ user: adminUser });
        const emojiReason = 'Great customer! 🎉🎊🎈 Bonus points';
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-emoji' });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: emojiReason,
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          emojiReason,
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });

      it('should handle multi-language characters (Chinese, Arabic, Cyrillic)', async () => {
        const caller = createCaller({ user: adminUser });
        const multiLangReason = '测试 التجربة Тест Test';
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-multilang' });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: multiLangReason,
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          multiLangReason,
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });

      it('should handle special Unicode characters (zero-width, RTL marks)', async () => {
        const caller = createCaller({ user: adminUser });
        const specialUnicode = 'Test\u200B\u200C\u200D\u202A\u202BString';
        mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-special' });

        await caller.deductPoints({
          userId: 'customer-1',
          points: 100,
          reason: specialUnicode,
        });

        expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          specialUnicode,
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });
    });
  });

  // ========== Concurrent/Race Condition Scenarios ==========
  describe('Concurrent/Race Condition Scenarios (Conceptual)', () => {
    it('should handle multiple simultaneous award calls for same user', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-concurrent' });

      const promises = Array(10)
        .fill(null)
        .map(() =>
          caller.awardPoints({
            userId: 'customer-1',
            points: 100,
            reason: 'Concurrent test',
          })
        );

      const results = await Promise.all(promises);

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledTimes(10);
      expect(results).toHaveLength(10);
      results.forEach((result) => expect(result).toMatchObject({ transactionId: 'txn-concurrent' }));
    });

    it('should handle rapid sequential getStatus calls', async () => {
      const caller = createCaller({ user: customerUser });
      const mockStatus = {
        user_id: 'customer-1',
        current_points: 1000,
        total_nights: 5,
        tier_name: 'Silver',
        tier_color: '#C0C0C0',
        tier_benefits: {},
        tier_level: 1,
        progress_percentage: 50,
        next_tier_nights: 10,
        next_tier_name: 'Gold',
        nights_to_next_tier: 5,
      };
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(mockStatus);

      const promises = Array(5)
        .fill(null)
        .map(() => caller.getStatus({}));
      const results = await Promise.all(promises);

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledTimes(5);
      expect(results).toHaveLength(5);
      results.forEach((result) => expect(result).toBeTruthy());
    });

    it('should handle mixed award and deduct operations', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-award' });
      mockLoyaltyService.deductPoints.mockResolvedValue({ transactionId: 'txn-deduct' });

      const awardPromises = Array(3)
        .fill(null)
        .map(() =>
          caller.awardPoints({ userId: 'customer-1', points: 100, reason: 'Award' })
        );
      const deductPromises = Array(3)
        .fill(null)
        .map(() =>
          caller.deductPoints({ userId: 'customer-1', points: 50, reason: 'Deduct' })
        );

      await Promise.all([...awardPromises, ...deductPromises]);

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledTimes(3);
      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledTimes(3);
    });
  });

  // ========== Service Error Handling ==========
  describe('Service Error Handling', () => {
    it('should handle TRPCError from service layer', async () => {
      const caller = createCaller({ user: customerUser });
      const trpcError = new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
      mockLoyaltyService.getUserLoyaltyStatus.mockRejectedValue(trpcError);

      await expect(caller.getStatus({})).rejects.toThrow(TRPCError);
      await expect(caller.getStatus({})).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    });

    it('should handle generic Error from service layer', async () => {
      const caller = createCaller({ user: adminUser });
      const genericError = new Error('Unexpected database connection error');
      mockLoyaltyService.awardPoints.mockRejectedValue(genericError);

      await expect(
        caller.awardPoints({ userId: 'customer-1', points: 100, reason: 'Test' })
      ).rejects.toThrow('Unexpected database connection error');
    });

    it('should handle timeout-like errors', async () => {
      const caller = createCaller({ user: customerUser });
      const timeoutError = new Error('ETIMEDOUT: Connection timeout');
      mockLoyaltyService.getTransactionHistory.mockRejectedValue(timeoutError);

      await expect(caller.getTransactions({})).rejects.toThrow('ETIMEDOUT: Connection timeout');
    });

    it('should handle service returning null unexpectedly', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(null);

      const result = await caller.getStatus({});
      expect(result).toBeNull();
    });

    it('should handle service returning undefined unexpectedly', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue(undefined);

      const result = await caller.getStatus({});
      expect(result).toBeUndefined();
    });

    it('should handle service throwing string error', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.deductPoints.mockRejectedValue('String error message');

      await expect(
        caller.deductPoints({ userId: 'customer-1', points: 100, reason: 'Test' })
      ).rejects.toThrow();
    });

    it('should handle service throwing object without message', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockRejectedValue({ code: 'ERR_UNKNOWN' });

      await expect(caller.getTransactions({})).rejects.toThrow();
    });

    it('should handle partial failure - tier config with some invalid data', async () => {
      const caller = createCaller({ user: customerUser });
      const partialConfig = [
        { id: 'valid-uuid', name: 'Bronze' },
        null,
        { id: 'another-valid', name: 'Silver' },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(partialConfig as any);

      const result = await caller.getTierConfig();
      expect(result).toEqual(partialConfig);
    });
  });

  // ========== Input Validation Edge Cases ==========
  describe('Input Validation Edge Cases', () => {
    describe('Whitespace-only Strings', () => {
      it('should accept whitespace-only reason (validated by service)', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-whitespace' });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: '   ',
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          '   ',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });

      it('should accept whitespace-only notes', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.deductPoints.mockResolvedValue({
          transactionId: 'txn-whitespace-notes',
        });

        await caller.deductPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          notes: '\t\n\r  ',
        });

        expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          'Test',
          undefined,
          undefined,
          'admin-1',
          '\t\n\r  '
        );
      });

      it('should accept whitespace-only referenceId', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.awardPoints.mockResolvedValue({
          transactionId: 'txn-whitespace-ref',
        });

        await caller.awardPoints({
          userId: 'customer-1',
          points: 100,
          reason: 'Test',
          referenceId: '    ',
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          'customer-1',
          100,
          'Test',
          undefined,
          '    ',
          'admin-1',
          undefined
        );
      });
    });

    describe('Special Characters in userId', () => {
      it('should handle userId with SQL injection attempt', async () => {
        const caller = createCaller({ user: adminUser });
        const maliciousUserId = "'; DROP TABLE users; --";
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-sql-injection' });

        await caller.awardPoints({
          userId: maliciousUserId,
          points: 100,
          reason: 'Test',
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          maliciousUserId,
          100,
          'Test',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });

      it('should handle userId with path traversal attempt', async () => {
        const caller = createCaller({ user: adminUser });
        const maliciousUserId = '../../../etc/passwd';
        mockLoyaltyService.deductPoints.mockResolvedValue({
          transactionId: 'txn-path-traversal',
        });

        await caller.deductPoints({
          userId: maliciousUserId,
          points: 100,
          reason: 'Test',
        });

        expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
          maliciousUserId,
          100,
          'Test',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });

      it('should handle userId with Unicode normalization issues', async () => {
        const caller = createCaller({ user: adminUser });
        const unicodeUserId = 'user-\u0041\u0301'; // A with combining acute accent
        mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-unicode' });

        await caller.awardPoints({
          userId: unicodeUserId,
          points: 100,
          reason: 'Test',
        });

        expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
          unicodeUserId,
          100,
          'Test',
          undefined,
          undefined,
          'admin-1',
          undefined
        );
      });
    });

    describe('UUID Format Validation Edge Cases', () => {
      it('should reject uppercase UUID with mixed case', async () => {
        const caller = createCaller({ user: adminUser });

        await expect(
          caller.updateTierConfig({
            tierId: '11111111-1111-1111-1111-11111111111G', // Invalid character
            name: 'Test',
          })
        ).rejects.toThrow();
      });

      it('should reject UUID with wrong length', async () => {
        const caller = createCaller({ user: adminUser });

        await expect(
          caller.updateTierConfig({
            tierId: '11111111-1111-1111-1111-111111111', // Too short
            name: 'Test',
          })
        ).rejects.toThrow();
      });

      it('should reject UUID without hyphens', async () => {
        const caller = createCaller({ user: adminUser });

        await expect(
          caller.updateTierConfig({
            tierId: '11111111111111111111111111111111', // No hyphens
            name: 'Test',
          })
        ).rejects.toThrow();
      });

      it('should accept valid lowercase UUID', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: 'abcdef12-3456-7890-abcd-ef1234567890',
          name: 'Test',
          required_points: 0,
          benefits: [],
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: 'abcdef12-3456-7890-abcd-ef1234567890',
          name: 'Test',
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalled();
      });

      it('should accept UUID with all zeros', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Test',
          required_points: 0,
          benefits: [],
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: '00000000-0000-0000-0000-000000000000',
          name: 'Test',
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalled();
      });
    });

    describe('Benefits Array Edge Cases', () => {
      it('should accept empty benefits array', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
          required_points: 0,
          benefits: [],
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          benefits: [],
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
          '11111111-1111-1111-1111-111111111111',
          { benefits: [] }
        );
      });

      it('should accept benefits array with empty strings', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
          required_points: 0,
          benefits: ['', ''],
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          benefits: ['', ''],
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
          '11111111-1111-1111-1111-111111111111',
          { benefits: ['', ''] }
        );
      });

      it('should accept benefits array with very long strings', async () => {
        const caller = createCaller({ user: adminUser });
        const longBenefit = 'A'.repeat(1000);
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
          required_points: 0,
          benefits: [longBenefit],
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          benefits: [longBenefit],
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
          '11111111-1111-1111-1111-111111111111',
          { benefits: [longBenefit] }
        );
      });

      it('should accept benefits array with duplicate values', async () => {
        const caller = createCaller({ user: adminUser });
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
          required_points: 0,
          benefits: ['Perk', 'Perk', 'Perk'],
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          benefits: ['Perk', 'Perk', 'Perk'],
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
          '11111111-1111-1111-1111-111111111111',
          { benefits: ['Perk', 'Perk', 'Perk'] }
        );
      });

      it('should accept benefits array with Unicode characters', async () => {
        const caller = createCaller({ user: adminUser });
        const unicodeBenefits = [
          '免费升级 🎁',
          'الدعم ذات الأولوية',
          'Приоритетная поддержка',
        ];
        mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Test',
          required_points: 0,
          benefits: unicodeBenefits,
          color: '#000',
          icon: 'icon',
        });

        await caller.updateTierConfig({
          tierId: '11111111-1111-1111-1111-111111111111',
          benefits: unicodeBenefits,
        });

        expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
          '11111111-1111-1111-1111-111111111111',
          { benefits: unicodeBenefits }
        );
      });
    });
  });

  // ========== Authorization Edge Cases ==========
  describe('Authorization Edge Cases', () => {
    it('should allow super_admin to award points (has admin privileges)', async () => {
      const caller = createCaller({ user: superAdminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({
        transactionId: 'txn-super-admin',
        pointsAwarded: 500,
      });

      const result = await caller.awardPoints({
        userId: 'customer-1',
        points: 500,
        reason: 'Super admin award',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        500,
        'Super admin award',
        undefined,
        undefined,
        'super-admin-1',
        undefined
      );
      expect(result).toMatchObject({ transactionId: 'txn-super-admin' });
    });

    it('should allow super_admin to deduct points (has admin privileges)', async () => {
      const caller = createCaller({ user: superAdminUser });
      mockLoyaltyService.deductPoints.mockResolvedValue({
        transactionId: 'txn-super-admin-deduct',
        pointsDeducted: 200,
      });

      const result = await caller.deductPoints({
        userId: 'customer-1',
        points: 200,
        reason: 'Super admin deduction',
      });

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-1',
        200,
        'Super admin deduction',
        undefined,
        undefined,
        'super-admin-1',
        undefined
      );
      expect(result).toMatchObject({ transactionId: 'txn-super-admin-deduct' });
    });

    it('should allow super_admin to update tier config (has admin privileges)', async () => {
      const caller = createCaller({ user: superAdminUser });
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Updated by Super Admin',
        minNights: 0,
        benefits: {},
        color: '#000000',
        icon: 'star',
      });

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        name: 'Updated by Super Admin',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        { name: 'Updated by Super Admin' }
      );
      expect(result).toMatchObject({ name: 'Updated by Super Admin' });
    });

    it('should reject super_admin when trying to view other user status (admin-only)', async () => {
      const caller = createCaller({ user: superAdminUser });

      await expect(caller.getStatus({ userId: 'other-user' })).rejects.toThrow(
        "Forbidden: Cannot view other user's loyalty status"
      );
    });

    it('should handle user with null email', async () => {
      const caller = createCaller({
        user: { id: 'user-no-email', role: 'customer', email: null },
      });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue({
        user_id: 'user-no-email',
        current_points: 100,
        total_nights: 1,
        tier_name: 'Bronze',
        tier_color: '#CD7F32',
        tier_benefits: {},
        tier_level: 0,
        progress_percentage: 10,
        next_tier_nights: 1,
        next_tier_name: 'Silver',
        nights_to_next_tier: 0,
      });

      const result = await caller.getStatus({});

      expect(result).toMatchObject({ user_id: 'user-no-email' });
    });

    it('should handle admin with special characters in ID', async () => {
      const specialAdminUser = {
        id: 'admin-with-special-!@#$%^&*()',
        role: 'admin' as const,
        email: 'admin@test.com',
      };
      const caller = createCaller({ user: specialAdminUser });
      mockLoyaltyService.awardPoints.mockResolvedValue({ transactionId: 'txn-special-admin' });

      await caller.awardPoints({
        userId: 'customer-1',
        points: 100,
        reason: 'Test',
      });

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        100,
        'Test',
        undefined,
        undefined,
        'admin-with-special-!@#$%^&*()',
        undefined
      );
    });

    it('should handle customer trying to access their own status with exact ID match', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue({
        user_id: 'customer-1',
        current_points: 1000,
        total_nights: 5,
        tier_name: 'Silver',
        tier_color: '#C0C0C0',
        tier_benefits: {},
        tier_level: 1,
        progress_percentage: 50,
        next_tier_nights: 10,
        next_tier_name: 'Gold',
        nights_to_next_tier: 5,
      });

      const result = await caller.getStatus({ userId: 'customer-1' });

      expect(result).toMatchObject({ user_id: 'customer-1' });
    });

    it('should reject customer accessing status with case-different userId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getStatus({ userId: 'CUSTOMER-1' }) // Different case
      ).rejects.toThrow("Forbidden: Cannot view other user's loyalty status");
    });

    it('should reject customer accessing status with whitespace-padded userId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getStatus({ userId: ' customer-1 ' }) // Whitespace padding
      ).rejects.toThrow("Forbidden: Cannot view other user's loyalty status");
    });
  });

  // ========== Miscellaneous Edge Cases ==========
  describe('Miscellaneous Edge Cases', () => {
    it('should handle getTierConfig returning very large array', async () => {
      const caller = createCaller({ user: customerUser });
      const largeTierArray = Array(1000)
        .fill(null)
        .map((_, i) => ({
          id: `tier-${i}`,
          name: `Tier ${i}`,
          required_points: i * 1000,
          benefits: [`Benefit ${i}`],
          color: '#000000',
          icon: `icon-${i}`,
        }));
      mockLoyaltyService.getTierConfiguration.mockResolvedValue(largeTierArray);

      const result = await caller.getTierConfig();

      expect(result).toHaveLength(1000);
    });

    it('should handle transaction history with empty transactions array', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue({
        transactions: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const result = await caller.getTransactions({});

      expect(result.transactions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle updateTierConfig with no optional fields', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Original Name',
        required_points: 1000,
        benefits: ['Original Benefit'],
        color: '#000',
        icon: 'icon',
      });

      const result = await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        {}
      );
      expect(result.name).toBe('Original Name');
    });

    it('should handle color field with various valid formats', async () => {
      const caller = createCaller({ user: adminUser });
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Test',
        required_points: 0,
        benefits: [],
        color: 'rgb(255, 0, 0)',
        icon: 'icon',
      });

      await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        color: 'rgb(255, 0, 0)',
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        { color: 'rgb(255, 0, 0)' }
      );
    });

    it('should handle icon field with very long string', async () => {
      const caller = createCaller({ user: adminUser });
      const longIcon = 'icon-' + 'x'.repeat(500);
      mockLoyaltyService.updateTierConfiguration.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Test',
        required_points: 0,
        benefits: [],
        color: '#000',
        icon: longIcon,
      });

      await caller.updateTierConfig({
        tierId: '11111111-1111-1111-1111-111111111111',
        icon: longIcon,
      });

      expect(mockLoyaltyService.updateTierConfiguration).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        { icon: longIcon }
      );
    });

    it('should handle pageSize of exactly 100 (boundary)', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getTransactionHistory.mockResolvedValue({
        transactions: [],
        total: 0,
        page: 1,
        pageSize: 100,
        totalPages: 0,
      });

      const result = await caller.getTransactions({ pageSize: 100 });

      expect(mockLoyaltyService.getTransactionHistory).toHaveBeenCalledWith('customer-1', 1, 100);
      expect(result.pageSize).toBe(100);
    });

    it('should handle getStatus returning status with negative values', async () => {
      const caller = createCaller({ user: customerUser });
      mockLoyaltyService.getUserLoyaltyStatus.mockResolvedValue({
        user_id: 'customer-1',
        current_points: -100, // Service layer might return negative in error scenarios
        total_nights: 0,
        tier_name: 'Bronze',
        tier_color: '#CD7F32',
        tier_benefits: {},
        tier_level: 0,
        progress_percentage: 0,
        next_tier_nights: 1,
        next_tier_name: 'Silver',
        nights_to_next_tier: 1,
      });

      const result = await caller.getStatus({});

      expect(result).toMatchObject({ current_points: -100 });
    });
  });
});
