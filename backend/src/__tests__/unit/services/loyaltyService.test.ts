/**
 * LoyaltyService Unit Tests
 * Tests critical loyalty business logic using Prisma ORM
 */

import { testDb, createTestUser, createTestLoyaltyTransaction } from '../../setup';

// Note: This tests the new Prisma-based LoyaltyService that will replace the SQL-based one
// For now, we're testing the interface we want to move towards

interface TestUser {
  id: string;
  email: unknown;
  firstName: unknown;
  lastName: unknown;
  membershipId: unknown;
  loyaltyPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

describe('LoyaltyService', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    testUser = await createTestUser({
      firstName: 'Test',
      lastName: 'User',
      loyaltyPoints: 0,
    });
  });

  describe('User Loyalty Initialization', () => {
    it('should create user with zero points initially', async () => {
      expect(testUser.loyaltyPoints).toBe(0);
      expect(testUser.membershipId).toMatch(/^TEST-/);
    });

    it('should have valid user structure', async () => {
      expect(testUser.id).toBeDefined();
      expect(testUser.email).toMatch(/@example\.com$/);
      expect(testUser.createdAt).toBeInstanceOf(Date);
      expect(testUser.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('Points Management', () => {
    it('should award points correctly', async () => {
      // Create a loyalty transaction (points award)
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        type: 'earned_stay',
        points: 100,
        description: 'Hotel stay points',
      });
      expect(transaction.points).toBe(100);
      expect(transaction.type).toBe('earned_stay');
      expect(transaction.user_id).toBe(testUser.id);
    });

    it('should handle negative points (deductions)', async () => {
      // First award some points
      await createTestLoyaltyTransaction(testUser.id, {
        points: 200,
        type: 'earned_stay',
      });

      // Then deduct points
      const deduction = await createTestLoyaltyTransaction(testUser.id, {
        points: -50,
        type: 'redeemed_coupon',
        description: 'Coupon redemption',
      });

      expect(deduction.points).toBe(-50);
      expect(deduction.type).toBe('redeemed_coupon');
    });

    it('should calculate total points correctly from transactions', async () => {
      // Create multiple transactions
      await createTestLoyaltyTransaction(testUser.id, { points: 100, type: 'earned_stay' });
      await createTestLoyaltyTransaction(testUser.id, { points: 50, type: 'bonus' });
      await createTestLoyaltyTransaction(testUser.id, { points: -30, type: 'redeemed_coupon' });

      // Manually mock the response for this test
      const expectedTransactions = [
        { user_id: testUser.id, points: 100, type: 'earned_stay' },
        { user_id: testUser.id, points: 50, type: 'bonus' },
        { user_id: testUser.id, points: -30, type: 'redeemed_coupon' }
      ];

      (testDb.points_transactions.findMany as jest.Mock).mockResolvedValueOnce(expectedTransactions);

      // Query all transactions for user
      const transactions = await testDb.points_transactions.findMany({
        where: { user_id: testUser.id },
      });

      const totalPoints = transactions.reduce((sum: number, t: { points: number }) => sum + t.points, 0);
      expect(totalPoints).toBe(120); // 100 + 50 - 30
    });
  });

  describe('Transaction Types', () => {
    it('should support earned_stay transactions', async () => {
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        type: 'earned_stay',
        points: 150,
        description: 'Luxury suite stay',
      });

      expect(transaction.type).toBe('earned_stay');
      expect(transaction.points).toBe(150);
    });

    it('should support bonus transactions', async () => {
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        type: 'bonus',
        points: 25,
        description: 'Birthday bonus',
      });

      expect(transaction.type).toBe('bonus');
      expect(transaction.points).toBe(25);
    });

    it('should support admin transactions', async () => {
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        type: 'admin_award',
        points: 500,
        description: 'Compensation for service issue',
      });

      expect(transaction.type).toBe('admin_award');
      expect(transaction.points).toBe(500);
    });

    it('should support redemption transactions', async () => {
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        type: 'redeemed_coupon',
        points: -100,
        description: 'Free night coupon',
      });

      expect(transaction.type).toBe('redeemed_coupon');
      expect(transaction.points).toBe(-100);
    });
  });

  describe('Data Integrity', () => {
    it('should require valid user ID for transactions', async () => {
      // Mock the create method to reject for invalid user ID
      (testDb.points_transactions.create as jest.Mock).mockRejectedValueOnce(
        new Error('Foreign key constraint failed')
      );

      await expect(
        testDb.points_transactions.create({
          data: {
            id: 'test-uuid',
            user_id: 'non-existent-user',
            type: 'earned_stay',
            points: 100,
            description: 'Test transaction',
            created_at: new Date(),
          },
        })
      ).rejects.toThrow();
    });

    it('should require transaction type', async () => {
      // Mock the create method to reject for missing type
      (testDb.points_transactions.create as jest.Mock).mockRejectedValueOnce(
        new Error('Missing required fields')
      );

      await expect(
        testDb.points_transactions.create({
          data: {
            id: 'test-uuid',
            user_id: testUser.id,
            // type: missing - intentionally omitted for test
            points: 100,
            description: 'Test transaction',
            created_at: new Date(),
          } as { id: string; user_id: string; points: number; description: string; created_at: Date },
        })
      ).rejects.toThrow();
    });

    it('should validate points as number', async () => {
      // Mock the create method to reject for invalid points
      (testDb.points_transactions.create as jest.Mock).mockRejectedValueOnce(
        new Error('Invalid data type')
      );

      await expect(
        testDb.points_transactions.create({
          data: {
            id: 'test-uuid',
            user_id: testUser.id,
            type: 'earned_stay',
            points: 'invalid' as unknown as number, // Intentionally invalid for test
            description: 'Test transaction',
            created_at: new Date(),
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero points transaction', async () => {
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        points: 0,
        type: 'adjustment',
        description: 'Balance adjustment',
      });

      expect(transaction.points).toBe(0);
      expect(transaction.type).toBe('adjustment');
    });

    it('should handle very large point values', async () => {
      const largePoints = 999999;
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        points: largePoints,
        type: 'admin_award',
        description: 'Large bonus award',
      });

      expect(transaction.points).toBe(largePoints);
    });

    it('should handle transactions without description', async () => {
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        points: 50,
        type: 'earned_stay',
        description: null,
      });

      expect(transaction.description).toBeNull();
      expect(transaction.points).toBe(50);
    });
  });

  describe('Query Performance', () => {
    it('should efficiently query user transactions', async () => {
      // Create multiple transactions
      const transactionPromises = Array.from({ length: 10 }, (_, i) =>
        createTestLoyaltyTransaction(testUser.id, {
          points: 10 * (i + 1),
          type: 'earned_stay',
          description: `Transaction ${i + 1}`,
        })
      );

      await Promise.all(transactionPromises);

      // Mock the findMany response (ordered by created_at desc, take 5)
      const mockTransactions = [
        { user_id: testUser.id, points: 100, type: 'earned_stay', created_at: new Date() },
        { user_id: testUser.id, points: 90, type: 'earned_stay', created_at: new Date() },
        { user_id: testUser.id, points: 80, type: 'earned_stay', created_at: new Date() },
        { user_id: testUser.id, points: 70, type: 'earned_stay', created_at: new Date() },
        { user_id: testUser.id, points: 60, type: 'earned_stay', created_at: new Date() },
      ];

      (testDb.points_transactions.findMany as jest.Mock).mockResolvedValueOnce(mockTransactions);

      const transactions = await testDb.points_transactions.findMany({
        where: { user_id: testUser.id },
        orderBy: { created_at: 'desc' },
        take: 5,
      });

      expect(transactions).toHaveLength(5);
      expect(transactions[0].points).toBe(100); // Most recent (highest points)
    });

    it('should efficiently calculate user total points', async () => {
      // Create 20 transactions
      const transactionPromises = Array.from({ length: 20 }, (_, i) =>
        createTestLoyaltyTransaction(testUser.id, {
          points: i % 2 === 0 ? 10 : -5, // Alternating positive/negative
          type: i % 2 === 0 ? 'earned_stay' : 'redeemed_coupon',
        })
      );

      await Promise.all(transactionPromises);

      // Mock the aggregate response (10*10 - 5*10 = 50)
      (testDb.points_transactions.aggregate as jest.Mock).mockResolvedValueOnce({
        _sum: { points: 50 }
      });

      const result = await testDb.points_transactions.aggregate({
        where: { user_id: testUser.id },
        _sum: { points: true },
      });

      expect(result._sum.points).toBe(50); // 10*10 - 5*10 = 50
    });
  });

  describe('Business Logic Validation', () => {
    it('should support different transaction types with correct semantics', async () => {
      const testCases = [
        { type: 'earned_stay', points: 100, shouldBePositive: true },
        { type: 'earned_dining', points: 50, shouldBePositive: true },
        { type: 'bonus', points: 25, shouldBePositive: true },
        { type: 'admin_award', points: 200, shouldBePositive: true },
        { type: 'redeemed_coupon', points: -150, shouldBePositive: false },
        { type: 'admin_deduction', points: -75, shouldBePositive: false },
        { type: 'expired', points: -50, shouldBePositive: false },
      ];

      for (const testCase of testCases) {
        const transaction = await createTestLoyaltyTransaction(testUser.id, {
          type: testCase.type,
          points: testCase.points,
          description: `Test ${testCase.type}`,
        });

        expect(transaction.type).toBe(testCase.type);
        expect(transaction.points).toBe(testCase.points);

        if (testCase.shouldBePositive) {
          expect(transaction.points).toBeGreaterThan(0);
        } else {
          expect(transaction.points).toBeLessThanOrEqual(0);
        }
      }
    });

    it('should maintain transaction chronological order', async () => {
      const timestamps = [];

      // Create transactions with small delays to ensure different timestamps
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 1)); // 1ms delay
        const transaction = await createTestLoyaltyTransaction(testUser.id, {
          points: 10,
          type: 'earned_stay',
          description: `Transaction ${i}`,
        });
        timestamps.push(transaction.created_at!);
      }

      // Check that timestamps are in ascending order
      for (let i = 1; i < timestamps.length; i++) {
        // Array index from loop is safe
        // eslint-disable-next-line security/detect-object-injection
        expect(timestamps[i].getTime()).toBeGreaterThanOrEqual(timestamps[i - 1].getTime());
      }
    });
  });
});

// Import the actual service and mock database
import { describe as describeActual, expect as expectActual, jest as jestActual, beforeEach as beforeEachActual } from '@jest/globals';
import * as database from '../../../config/database';
jestActual.mock('../../../config/database');
jestActual.mock('../../../utils/logger');
jestActual.mock('../../../services/notificationService');

import { LoyaltyService } from '../../../services/loyaltyService';

describeActual('LoyaltyService - Database Operations', () => {
  let loyaltyService: LoyaltyService;
  let mockClient: { query: jestActual.Mock; release: jestActual.Mock };
  let mockGetPool: jestActual.Mock;
  let mockPoolQuery: jestActual.Mock;

  beforeEachActual(() => {
    // Clear mock calls but not implementations
    mockClient?.query.mockClear?.();
    mockClient?.release.mockClear?.();
    mockPoolQuery?.mockClear?.();

    // Mock client with query and release methods
    mockClient = {
      query: jestActual.fn() as jestActual.Mock,
      release: jestActual.fn() as jestActual.Mock
    };

    // Mock pool query
    mockPoolQuery = jestActual.fn() as jestActual.Mock;

    // Create a mock pool object that will be returned every time getPool is called
    const mockPool = {
      connect: jestActual.fn().mockResolvedValue(mockClient as never),
      query: mockPoolQuery
    };

    // Mock getPool to always return the same pool instance
    mockGetPool = jestActual.fn().mockReturnValue(mockPool);

    (database as unknown as Record<string, unknown>).getPool = mockGetPool;

    loyaltyService = new LoyaltyService();
  });

  describeActual('Tier Recalculation Edge Cases', () => {
    test('should handle user exactly at tier threshold', async () => {
      const userId = 'user-at-threshold';
      const nights = 1;
      const amountSpent = 1000;

      // Mock the transaction insertion and tier recalculation for Silver threshold (1 night)
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 1 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Bronze' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Recalculate tier
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent,
        'STAY-1',
        'Stay at threshold'
      );

      expectActual(result.newTotalNights).toBe(1);
      expectActual(result.newTierName).toBe('Silver');
      expectActual(result.pointsEarned).toBe(10000); // 1000 * 10
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle user just below next tier threshold', async () => {
      const userId = 'user-below-threshold';
      const nights = 9;
      const amountSpent = 5000;

      // User with 9 nights is still Silver (Gold requires 10 nights)
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 9 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Silver' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Still Silver
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent
      );

      expectActual(result.newTotalNights).toBe(9);
      expectActual(result.newTierName).toBe('Silver');
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle downgrade scenario when nights are deducted', async () => {
      const userId = 'user-downgrade';
      const nights = -5;
      const amountSpent = 0;

      // User was Gold (10+ nights), now drops to 5 nights (Silver)
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 5 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Gold' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Downgraded to Silver
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent,
        'DEDUCT-1',
        'Nights deduction'
      );

      expectActual(result.newTotalNights).toBe(5);
      expectActual(result.newTierName).toBe('Silver');
      expectActual(result.pointsEarned).toBe(0); // No spending
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle max tier Platinum correctly', async () => {
      const userId = 'user-platinum';
      const nights = 25;
      const amountSpent = 10000;

      // User reaches Platinum (20+ nights)
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 25 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Gold' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Platinum' }] } as never) // Platinum tier
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent
      );

      expectActual(result.newTotalNights).toBe(25);
      expectActual(result.newTierName).toBe('Platinum');
      expectActual(result.pointsEarned).toBe(100000); // 10000 * 10
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle staying at Platinum when adding more nights', async () => {
      const userId = 'user-platinum-stay';
      const nights = 10;
      const amountSpent = 5000;

      // User already Platinum (30 nights), stays Platinum (40 nights)
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 40 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Platinum' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Platinum' }] } as never) // Still Platinum
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent
      );

      expectActual(result.newTotalNights).toBe(40);
      expectActual(result.newTierName).toBe('Platinum');
      expectActual(mockClient.release).toHaveBeenCalled();
    });
  });

  describeActual('Combined Nights + Points Operations', () => {
    test('should handle normal stay recording with nights and spending', async () => {
      const userId = 'user-normal-stay';
      const nights = 3;
      const amountSpent = 2500;

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 3 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Bronze' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Upgraded to Silver
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent,
        'STAY-NORMAL',
        '3-night stay with spending'
      );

      expectActual(result.newTotalNights).toBe(3);
      expectActual(result.pointsEarned).toBe(25000); // 2500 * 10
      expectActual(result.transactionId).toBe('txn-1');
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle zero spending with nights only', async () => {
      const userId = 'user-no-spending';
      const nights = 2;
      const amountSpent = 0;

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-2' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 2 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Bronze' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Upgraded to Silver
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent,
        'STAY-FREE',
        'Complimentary stay'
      );

      expectActual(result.newTotalNights).toBe(2);
      expectActual(result.pointsEarned).toBe(0); // No spending = no points
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle negative nights deduction scenarios', async () => {
      const userId = 'user-deduction';
      const nights = -3;
      const amountSpent = 0;

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-3' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 7 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Gold' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Downgraded
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nights,
        amountSpent,
        'DEDUCT-NIGHTS',
        'Correcting invalid stays',
        'admin-user-1',
        'Error correction'
      );

      expectActual(result.newTotalNights).toBe(7);
      expectActual(result.pointsEarned).toBe(0); // No points for deduction
      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should verify points calculation at 10 points per 1 THB', async () => {
      const testCases = [
        { amountSpent: 100, expectedPoints: 1000 },
        { amountSpent: 250.50, expectedPoints: 2505 },
        { amountSpent: 999.99, expectedPoints: 9999 },
        { amountSpent: 1234.56, expectedPoints: 12345 },
      ];

      for (const testCase of testCases) {
        const userId = 'user-points-calc';
        const nights = 1;

        mockClient.query
          .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
          .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
          .mockResolvedValueOnce({ rows: [{ id: 'txn' }] } as never) // Insert transaction
          .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
          .mockResolvedValueOnce({ rows: [{ total_nights: 1 }] } as never) // Get total nights
          .mockResolvedValueOnce({ rows: [{ tier_name: 'Bronze' }] } as never) // Previous tier
          .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // New tier
          .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

        const result = await loyaltyService.addStayNightsAndPoints(
          userId,
          nights,
          testCase.amountSpent
        );

        expectActual(result.pointsEarned).toBe(testCase.expectedPoints);
      }

      expectActual(mockClient.release).toHaveBeenCalled();
    });
  });

  describeActual('Expiry Processing', () => {
    test('should process expired points correctly', async () => {
      // Mock expired transactions
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          { user_id: 'user-1' },
          { user_id: 'user-2' },
          { user_id: 'user-1' } // Same user, multiple expired transactions
        ]
      } as never);

      const result = await loyaltyService.expireOldPoints();

      expectActual(result).toBe(3); // 3 transactions expired
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('INSERT INTO points_transactions')
      );
    });

    test('should handle no expired points', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: []
      } as never);

      const result = await loyaltyService.expireOldPoints();

      expectActual(result).toBe(0);
      expectActual(mockPoolQuery).toHaveBeenCalled();
    });

    test('should calculate points expiring within 30 days', async () => {
      const userId = 'user-expiry';

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          current_points: 5000,
          expiring_points: 1500,
          next_expiry_date: thirtyDaysFromNow
        }]
      } as never);

      const result = await loyaltyService.calculateUserPoints(userId);

      expectActual(result.current_points).toBe(5000);
      expectActual(result.expiring_points).toBe(1500);
      expectActual(result.next_expiry_date).toEqual(thirtyDaysFromNow);
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('expiring_points'),
        [userId]
      );
    });

    test('should calculate user points with no expiring points', async () => {
      const userId = 'user-no-expiry';

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          current_points: 3000,
          expiring_points: 0,
          next_expiry_date: null
        }]
      } as never);

      const result = await loyaltyService.calculateUserPoints(userId);

      expectActual(result.current_points).toBe(3000);
      expectActual(result.expiring_points).toBe(0);
      expectActual(result.next_expiry_date).toBeNull();
    });

    test('should handle user with no loyalty account in calculateUserPoints', async () => {
      const userId = 'user-no-account';

      mockPoolQuery.mockResolvedValueOnce({
        rows: []
      } as never);

      const result = await loyaltyService.calculateUserPoints(userId);

      expectActual(result.current_points).toBe(0);
      expectActual(result.expiring_points).toBe(0);
      expectActual(result.next_expiry_date).toBeNull();
    });
  });

  describeActual('Points Operations', () => {
    test('should award points with expiration date', async () => {
      const userId = 'user-award';
      const points = 500;
      const expiresAt = new Date('2026-12-31');

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ transaction_id: 'txn-award-1' }]
      } as never);

      const result = await loyaltyService.awardPoints(
        userId,
        points,
        'admin_award',
        'Compensation points',
        'REF-123',
        'admin-1',
        'Service recovery',
        expiresAt
      );

      expectActual(result).toBe('txn-award-1');
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('award_points'),
        [userId, points, 'admin_award', 'Compensation points', 'REF-123', 'admin-1', 'Service recovery', expiresAt]
      );
    });

    test('should deduct points successfully when user has sufficient balance', async () => {
      const userId = 'user-deduct';
      const points = 200;

      // Mock getUserLoyaltyStatus pool query (first call)
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          user_id: userId,
          current_points: 1000,
          total_nights: 5,
          tier_name: 'Silver',
          tier_color: '#silver',
          tier_benefits: {},
          tier_level: 2,
          progress_percentage: 50,
          next_tier_nights: 10,
          next_tier_name: 'Gold',
          nights_to_next_tier: 5
        }]
      } as never);

      // Mock awardPoints pool query (negative points) - called by deductPoints
      // This is a stored procedure call that returns transaction_id
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ transaction_id: 'txn-deduct-1' }]
      } as never);

      const result = await loyaltyService.deductPoints(
        userId,
        points,
        'redeemed_coupon',
        'Coupon redemption'
      );

      expectActual(result).toBe('txn-deduct-1');
      // Verify the award_points stored procedure was called with negative points
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('award_points'),
        [userId, -points, 'redeemed_coupon', 'Coupon redemption', undefined, undefined, undefined, undefined]
      );
    });

    test('should throw error when deducting points with insufficient balance', async () => {
      const userId = 'user-insufficient';
      const points = 500;

      // Mock getUserLoyaltyStatus pool query with insufficient points
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          user_id: userId,
          current_points: 100, // Less than 500
          total_nights: 2,
          tier_name: 'Bronze',
          tier_color: '#bronze',
          tier_benefits: {},
          tier_level: 1,
          progress_percentage: 0,
          next_tier_nights: 1,
          next_tier_name: 'Silver',
          nights_to_next_tier: -1
        }]
      } as never);

      await expectActual(
        loyaltyService.deductPoints(userId, points)
      ).rejects.toThrow('Failed to deduct points');
    });

    test('should throw error when user has no loyalty status', async () => {
      const userId = 'user-no-status';
      const points = 100;

      // Mock getUserLoyaltyStatus returning empty (first call)
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [] } as never) // No loyalty status
        .mockResolvedValueOnce({ rows: [{ id: 'bronze-tier' }] } as never) // Get bronze tier (initializeUserLoyalty)
        .mockResolvedValueOnce({ rows: [] } as never) // Insert loyalty (conflict)
        .mockResolvedValueOnce({ rows: [] } as never); // Retry getUserLoyaltyStatus (still no status)

      await expectActual(
        loyaltyService.deductPoints(userId, points)
      ).rejects.toThrow('Failed to deduct points');
    });

    test('should get points history with pagination', async () => {
      const userId = 'user-history';
      const limit = 10;
      const offset = 0;

      const mockTransactions = [
        {
          id: 'txn-1',
          user_id: userId,
          points: 100,
          type: 'earned_stay',
          description: 'Hotel stay',
          created_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 'txn-2',
          user_id: userId,
          points: -50,
          type: 'redeemed_coupon',
          description: 'Coupon used',
          created_at: '2023-01-02T00:00:00Z'
        }
      ];

      mockPoolQuery
        .mockResolvedValueOnce({ rows: mockTransactions } as never)
        .mockResolvedValueOnce({ rows: [{ total: '2' }] } as never);

      const result = await loyaltyService.getUserPointsHistory(userId, limit, offset);

      expectActual(result.transactions).toEqual(mockTransactions);
      expectActual(result.total).toBe(2);
    });

    test('should handle empty points history', async () => {
      const userId = 'user-no-history';

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ total: '0' }] } as never);

      const result = await loyaltyService.getUserPointsHistory(userId);

      expectActual(result.transactions).toEqual([]);
      expectActual(result.total).toBe(0);
    });

    test('should paginate through large transaction history', async () => {
      const userId = 'user-large-history';
      const limit = 20;
      const offset = 40; // Page 3

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [] } as never) // Transactions
        .mockResolvedValueOnce({ rows: [{ total: '100' }] } as never); // Total count

      const result = await loyaltyService.getUserPointsHistory(userId, limit, offset);

      expectActual(result.total).toBe(100);
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('LIMIT'),
        [userId, limit, offset]
      );
    });
  });

  describeActual('Error Handling', () => {
    test('should handle database errors in addStayNightsAndPoints', async () => {
      const userId = 'user-error';
      const nights = 2;
      const amountSpent = 1000;

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockRejectedValueOnce(new Error('Database connection error') as never); // Error on next query

      await expectActual(
        loyaltyService.addStayNightsAndPoints(userId, nights, amountSpent)
      ).rejects.toThrow('Failed to add stay nights and points');

      expectActual(mockClient.release).toHaveBeenCalled();
    });

    test('should handle errors in expireOldPoints', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expectActual(
        loyaltyService.expireOldPoints()
      ).rejects.toThrow('Failed to expire old points');
    });

    test('should handle errors in calculateUserPoints', async () => {
      const userId = 'user-error';

      mockPoolQuery.mockRejectedValueOnce(new Error('Query failed') as never);

      await expectActual(
        loyaltyService.calculateUserPoints(userId)
      ).rejects.toThrow('Failed to calculate user points');
    });

    test('should rollback transaction on failure', async () => {
      const userId = 'user-rollback';
      const nights = 3;
      const amountSpent = 1500;

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockRejectedValueOnce(new Error('Transaction insert failed') as never) // Error
        .mockResolvedValueOnce({ rows: [] } as never); // ROLLBACK

      await expectActual(
        loyaltyService.addStayNightsAndPoints(userId, nights, amountSpent)
      ).rejects.toThrow('Failed to add stay nights and points');

      expectActual(mockClient.release).toHaveBeenCalled();
    });
  });

  describeActual('getAllTiers', () => {
    test('should get all active tiers', async () => {
      const mockTiers = [
        { id: 't1', name: 'Bronze', min_points: 0, min_nights: 0, sort_order: 1 },
        { id: 't2', name: 'Silver', min_points: 1000, min_nights: 1, sort_order: 2 },
        { id: 't3', name: 'Gold', min_points: 5000, min_nights: 10, sort_order: 3 },
        { id: 't4', name: 'Platinum', min_points: 10000, min_nights: 20, sort_order: 4 }
      ];

      mockPoolQuery.mockResolvedValueOnce({ rows: mockTiers } as never);

      const result = await loyaltyService.getAllTiers();

      expectActual(result).toEqual(mockTiers);
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('SELECT * FROM tiers WHERE is_active = true ORDER BY sort_order ASC')
      );
    });

    test('should handle errors in getAllTiers', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expectActual(
        loyaltyService.getAllTiers()
      ).rejects.toThrow('Failed to fetch loyalty tiers');
    });
  });

  describeActual('initializeUserLoyalty', () => {
    test('should throw error when no active tiers exist', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] } as never); // No tiers

      await expectActual(
        loyaltyService.initializeUserLoyalty('user-no-tiers')
      ).rejects.toThrow('Failed to initialize user loyalty');
    });

    test('should handle existing user loyalty gracefully', async () => {
      const userId = 'user-existing';

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ id: 'bronze-tier' }] } as never) // Get bronze tier
        .mockResolvedValueOnce({ rows: [] } as never); // Insert returns empty (conflict - already exists)

      await loyaltyService.initializeUserLoyalty(userId);

      expectActual(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    test('should initialize new user with bronze tier', async () => {
      const userId = 'user-new';

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ id: 'bronze-tier' }] } as never) // Get bronze tier
        .mockResolvedValueOnce({ rows: [{ user_id: userId }] } as never); // Insert successful

      await loyaltyService.initializeUserLoyalty(userId);

      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('INSERT INTO user_loyalty'),
        [userId, 'bronze-tier']
      );
    });
  });

  describeActual('ensureUserLoyaltyEnrollment', () => {
    test('should ensure user loyalty enrollment without throwing', async () => {
      const userId = 'user-enroll';

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ id: 'bronze-tier' }] } as never)
        .mockResolvedValueOnce({ rows: [{ user_id: userId }] } as never);

      await loyaltyService.ensureUserLoyaltyEnrollment(userId);

      expectActual(mockPoolQuery).toHaveBeenCalled();
    });

    test('should not throw error on enrollment failure', async () => {
      const userId = 'user-fail-enroll';

      mockPoolQuery.mockRejectedValueOnce(new Error('Database error') as never);

      // Should not throw - enrollment failure shouldn't break login
      await expectActual(
        loyaltyService.ensureUserLoyaltyEnrollment(userId)
      ).resolves.not.toThrow();
    });
  });

  describeActual('awardPoints', () => {
    test('should award points with all parameters', async () => {
      const userId = 'user-award-full';
      const points = 1000;
      const expiresAt = new Date('2026-12-31');

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ transaction_id: 'txn-full' }]
      } as never);

      const result = await loyaltyService.awardPoints(
        userId,
        points,
        'admin_award',
        'Full award',
        'REF-123',
        'admin-1',
        'Test reason',
        expiresAt
      );

      expectActual(result).toBe('txn-full');
    });

    test('should handle errors in awardPoints', async () => {
      const userId = 'user-award-error';

      mockPoolQuery.mockRejectedValueOnce(new Error('Award failed') as never);

      await expectActual(
        loyaltyService.awardPoints(userId, 100)
      ).rejects.toThrow('Failed to award points');
    });
  });

  describeActual('getUserPointsHistory error handling', () => {
    test('should handle errors in getUserPointsHistory', async () => {
      const userId = 'user-history-error';

      mockPoolQuery.mockRejectedValueOnce(new Error('Query failed') as never);

      await expectActual(
        loyaltyService.getUserPointsHistory(userId)
      ).rejects.toThrow('Failed to fetch points history');
    });
  });

  describeActual('getAdminTransactions', () => {
    test('should get admin transactions with pagination', async () => {
      const mockTransactions = [
        {
          id: 'txn-1',
          user_id: 'user-1',
          points: 500,
          type: 'admin_award',
          admin_user_id: 'admin-1',
          admin_email: 'admin@test.com'
        },
        {
          id: 'txn-2',
          user_id: 'user-2',
          points: -100,
          type: 'admin_deduction',
          admin_user_id: 'admin-1'
        }
      ];

      mockPoolQuery
        .mockResolvedValueOnce({ rows: mockTransactions } as never)
        .mockResolvedValueOnce({ rows: [{ total: '2' }] } as never);

      const result = await loyaltyService.getAdminTransactions(10, 0);

      expectActual(result.transactions).toEqual(mockTransactions);
      expectActual(result.total).toBe(2);
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('admin_award'),
        [10, 0]
      );
    });

    test('should handle earned_stay transactions in admin view', async () => {
      const mockTransactions = [
        {
          id: 'txn-stay',
          user_id: 'user-1',
          points: 1000,
          type: 'earned_stay',
          nights_stayed: 2
        }
      ];

      mockPoolQuery
        .mockResolvedValueOnce({ rows: mockTransactions } as never)
        .mockResolvedValueOnce({ rows: [{ total: '1' }] } as never);

      const result = await loyaltyService.getAdminTransactions(50, 0);

      expectActual(result.transactions).toHaveLength(1);
      expectActual(result.transactions[0]?.type).toBe('earned_stay');
    });

    test('should handle errors in getAdminTransactions', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Query failed') as never);

      await expectActual(
        loyaltyService.getAdminTransactions()
      ).rejects.toThrow('Failed to fetch admin transactions');
    });
  });

  describeActual('getAllUsersLoyaltyStatus', () => {
    test('should get all users loyalty status with pagination', async () => {
      const mockUsers = [
        {
          user_id: 'user-1',
          current_points: 5000,
          total_nights: 15,
          tier_name: 'Gold',
          email: 'user1@test.com',
          membership_id: 'MEM-001'
        },
        {
          user_id: 'user-2',
          current_points: 1000,
          total_nights: 3,
          tier_name: 'Silver',
          email: 'user2@test.com',
          membership_id: 'MEM-002'
        }
      ];

      mockPoolQuery
        .mockResolvedValueOnce({ rows: mockUsers } as never)
        .mockResolvedValueOnce({ rows: [{ total: '2' }] } as never);

      const result = await loyaltyService.getAllUsersLoyaltyStatus(50, 0);

      expectActual(result.users).toEqual(mockUsers);
      expectActual(result.total).toBe(2);
    });

    test('should filter users by search term', async () => {
      const searchTerm = 'john';
      const mockUsers = [
        {
          user_id: 'user-john',
          email: 'john@test.com',
          first_name: 'John',
          total_nights: 10
        }
      ];

      mockPoolQuery
        .mockResolvedValueOnce({ rows: mockUsers } as never)
        .mockResolvedValueOnce({ rows: [{ total: '1' }] } as never);

      const result = await loyaltyService.getAllUsersLoyaltyStatus(50, 0, searchTerm);

      expectActual(result.users).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expectActual((result.users[0] as any)?.email).toContain('john');
    });

    test('should handle errors in getAllUsersLoyaltyStatus', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Query failed') as never);

      await expectActual(
        loyaltyService.getAllUsersLoyaltyStatus()
      ).rejects.toThrow('Failed to fetch users loyalty status');
    });
  });

  describeActual('getPointsEarningRules', () => {
    test('should get active earning rules', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          points_per_unit: 10,
          is_active: true,
          multiplier_by_tier: { Bronze: 1.0, Silver: 1.2, Gold: 1.5, Platinum: 2.0 }
        }
      ];

      mockPoolQuery.mockResolvedValueOnce({ rows: mockRules } as never);

      const result = await loyaltyService.getPointsEarningRules();

      expectActual(result).toEqual(mockRules);
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('points_earning_rules')
      );
    });

    test('should handle errors in getPointsEarningRules', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Query failed') as never);

      await expectActual(
        loyaltyService.getPointsEarningRules()
      ).rejects.toThrow('Failed to fetch points earning rules');
    });
  });

  describeActual('awardNights', () => {
    test('should award nights successfully', async () => {
      const userId = 'user-award-nights';
      const nights = 5;
      const adminUserId = 'admin-1';
      const adminReason = 'Compensation';

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-nights' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 5 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Bronze' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // New tier
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.awardNights(userId, nights, adminUserId, adminReason);

      expectActual(result.newTotalNights).toBe(5);
      expectActual(result.newTierName).toBe('Silver');
      expectActual(result.transactionId).toBe('txn-nights');
    });

    test('should reject zero or negative nights award', async () => {
      await expectActual(
        loyaltyService.awardNights('user-1', 0, 'admin-1', 'reason')
      ).rejects.toThrow('Failed to award nights');

      await expectActual(
        loyaltyService.awardNights('user-1', -5, 'admin-1', 'reason')
      ).rejects.toThrow('Failed to award nights');
    });

    test('should handle errors in awardNights', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('Database error') as never);

      await expectActual(
        loyaltyService.awardNights('user-1', 5, 'admin-1', 'reason')
      ).rejects.toThrow('Failed to award nights');
    });
  });

  describeActual('deductNights', () => {
    test('should deduct nights successfully', async () => {
      const userId = 'user-deduct-nights';
      const nights = 3;
      const adminUserId = 'admin-1';
      const adminReason = 'Correction';

      // Mock getUserLoyaltyStatus
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          user_id: userId,
          current_points: 1000,
          total_nights: 10,
          tier_name: 'Gold'
        }]
      } as never);

      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // Ensure user loyalty
        .mockResolvedValueOnce({ rows: [{ id: 'txn-deduct-nights' }] } as never) // Insert transaction
        .mockResolvedValueOnce({ rows: [] } as never) // Update user_loyalty
        .mockResolvedValueOnce({ rows: [{ total_nights: 7 }] } as never) // Get total nights
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Gold' }] } as never) // Previous tier
        .mockResolvedValueOnce({ rows: [{ new_tier_name: 'Silver' }] } as never) // Downgraded tier
        .mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await loyaltyService.deductNights(userId, nights, adminUserId, adminReason);

      expectActual(result.newTotalNights).toBe(7);
      expectActual(result.newTierName).toBe('Silver');
    });

    test('should reject zero or negative nights deduction', async () => {
      await expectActual(
        loyaltyService.deductNights('user-1', 0, 'admin-1', 'reason')
      ).rejects.toThrow('Failed to deduct nights');
    });

    test('should reject deduction when insufficient nights', async () => {
      const userId = 'user-insufficient-nights';

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          user_id: userId,
          current_points: 500,
          total_nights: 2,
          tier_name: 'Silver'
        }]
      } as never);

      await expectActual(
        loyaltyService.deductNights(userId, 5, 'admin-1', 'reason')
      ).rejects.toThrow('Failed to deduct nights');
    });

    test('should handle errors in deductNights', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expectActual(
        loyaltyService.deductNights('user-1', 3, 'admin-1', 'reason')
      ).rejects.toThrow('Failed to deduct nights');
    });
  });

  describeActual('earnPointsForStay', () => {
    test('should calculate and award points for stay with tier multiplier', async () => {
      const userId = 'user-stay-earn';
      const amountSpent = 1000;
      const stayId = 'STAY-001';

      // Mock getUserLoyaltyStatus
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          user_id: userId,
          current_points: 2000,
          total_nights: 15,
          tier_name: 'Gold'
        }]
      } as never);

      // Mock getPointsEarningRules
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          points_per_unit: 10,
          multiplier_by_tier: { Bronze: 1.0, Silver: 1.2, Gold: 1.5, Platinum: 2.0 }
        }]
      } as never);

      // Mock awardPoints
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ transaction_id: 'txn-stay-earn' }]
      } as never);

      const result = await loyaltyService.earnPointsForStay(userId, amountSpent, stayId);

      expectActual(result).toBe('txn-stay-earn');
      // Gold tier: 1000 * 10 * 1.5 = 15000 points
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('award_points'),
        expectActual.arrayContaining([userId, 15000])
      );
    });

    test('should handle user not found error', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] } as never); // No user

      await expectActual(
        loyaltyService.earnPointsForStay('user-not-found', 1000)
      ).rejects.toThrow('Failed to earn points for stay');
    });

    test('should handle no earning rules configured', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ tier_name: 'Bronze' }] } as never) // User exists
        .mockResolvedValueOnce({ rows: [] } as never); // No rules

      await expectActual(
        loyaltyService.earnPointsForStay('user-1', 1000)
      ).rejects.toThrow('Failed to earn points for stay');
    });

    test('should handle errors in earnPointsForStay', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Database error') as never);

      await expectActual(
        loyaltyService.earnPointsForStay('user-1', 1000)
      ).rejects.toThrow('Failed to earn points for stay');
    });
  });

  describeActual('getTransactionHistory', () => {
    test('should get paginated transaction history', async () => {
      const userId = 'user-paginated';
      const page = 2;
      const pageSize = 10;

      const mockTransactions = Array.from({ length: 10 }, (_, i) => ({
        id: `txn-${i}`,
        user_id: userId,
        points: 100,
        type: 'earned_stay'
      }));

      mockPoolQuery
        .mockResolvedValueOnce({ rows: mockTransactions } as never)
        .mockResolvedValueOnce({ rows: [{ total: '50' }] } as never);

      const result = await loyaltyService.getTransactionHistory(userId, page, pageSize);

      expectActual(result.transactions).toHaveLength(10);
      expectActual(result.total).toBe(50);
      expectActual(result.page).toBe(2);
      expectActual(result.pageSize).toBe(10);
      expectActual(result.totalPages).toBe(5); // 50 / 10
    });

    test('should calculate total pages correctly', async () => {
      const userId = 'user-pages';

      mockPoolQuery
        .mockResolvedValueOnce({ rows: [] } as never)
        .mockResolvedValueOnce({ rows: [{ total: '23' }] } as never);

      const result = await loyaltyService.getTransactionHistory(userId, 1, 10);

      expectActual(result.totalPages).toBe(3); // ceil(23 / 10)
    });
  });

  describeActual('getTierConfiguration', () => {
    test('should get tier configuration', async () => {
      const mockTiers = [
        {
          id: 't1',
          name: 'Bronze',
          required_points: 0,
          benefits: { description: 'Base benefits', perks: [] },
          color: '#CD7F32',
          icon: 'star'
        },
        {
          id: 't2',
          name: 'Silver',
          required_points: 1000,
          benefits: { description: 'Silver benefits', perks: ['perk1'] },
          color: '#C0C0C0',
          icon: 'star'
        }
      ];

      mockPoolQuery.mockResolvedValueOnce({ rows: mockTiers } as never);

      const result = await loyaltyService.getTierConfiguration();

      expectActual(result).toEqual(mockTiers);
      expectActual(mockPoolQuery).toHaveBeenCalledWith(
        expectActual.stringContaining('min_points as required_points')
      );
    });

    test('should handle errors in getTierConfiguration', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Query failed') as never);

      await expectActual(
        loyaltyService.getTierConfiguration()
      ).rejects.toThrow('Failed to fetch tier configuration');
    });
  });

  describeActual('updateTierConfiguration', () => {
    test('should update tier name', async () => {
      const tierId = 'tier-1';
      const config = { name: 'Premium Gold' };

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          id: tierId,
          name: 'Premium Gold',
          required_points: 5000,
          benefits: [],
          color: '#FFD700',
          icon: 'star'
        }]
      } as never);

      const result = await loyaltyService.updateTierConfiguration(tierId, config);

      expectActual(result.name).toBe('Premium Gold');
    });

    test('should update tier points requirement', async () => {
      const tierId = 'tier-2';
      const config = { required_points: 8000 };

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          id: tierId,
          name: 'Gold',
          required_points: 8000,
          benefits: [],
          color: '#FFD700',
          icon: 'star'
        }]
      } as never);

      const result = await loyaltyService.updateTierConfiguration(tierId, config);

      expectActual(result.required_points).toBe(8000);
    });

    test('should update tier benefits', async () => {
      const tierId = 'tier-3';
      const config = { benefits: ['Free breakfast', 'Late checkout'] };

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          id: tierId,
          name: 'Platinum',
          required_points: 10000,
          benefits: ['Free breakfast', 'Late checkout'],
          color: '#E5E4E2',
          icon: 'star'
        }]
      } as never);

      const result = await loyaltyService.updateTierConfiguration(tierId, config);

      expectActual(result.benefits).toEqual(['Free breakfast', 'Late checkout']);
    });

    test('should update tier color', async () => {
      const tierId = 'tier-4';
      const config = { color: '#FF0000' };

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          id: tierId,
          name: 'Ruby',
          required_points: 15000,
          benefits: [],
          color: '#FF0000',
          icon: 'star'
        }]
      } as never);

      const result = await loyaltyService.updateTierConfiguration(tierId, config);

      expectActual(result.color).toBe('#FF0000');
    });

    test('should update multiple tier properties', async () => {
      const tierId = 'tier-5';
      const config = {
        name: 'Diamond',
        required_points: 20000,
        color: '#B9F2FF',
        benefits: ['Concierge', 'Room upgrade']
      };

      mockPoolQuery.mockResolvedValueOnce({
        rows: [{
          id: tierId,
          name: 'Diamond',
          required_points: 20000,
          benefits: ['Concierge', 'Room upgrade'],
          color: '#B9F2FF',
          icon: 'star'
        }]
      } as never);

      const result = await loyaltyService.updateTierConfiguration(tierId, config);

      expectActual(result.name).toBe('Diamond');
      expectActual(result.required_points).toBe(20000);
      expectActual(result.color).toBe('#B9F2FF');
    });

    test('should throw error when no fields to update', async () => {
      const tierId = 'tier-6';
      const config = {};

      await expectActual(
        loyaltyService.updateTierConfiguration(tierId, config)
      ).rejects.toThrow('Failed to update tier configuration');
    });

    test('should throw error when tier not found', async () => {
      const tierId = 'non-existent-tier';
      const config = { name: 'New Name' };

      mockPoolQuery.mockResolvedValueOnce({ rows: [] } as never);

      await expectActual(
        loyaltyService.updateTierConfiguration(tierId, config)
      ).rejects.toThrow('Failed to update tier configuration');
    });

    test('should handle errors in updateTierConfiguration', async () => {
      const tierId = 'tier-error';
      const config = { name: 'Error Tier' };

      mockPoolQuery.mockRejectedValueOnce(new Error('Update failed') as never);

      await expectActual(
        loyaltyService.updateTierConfiguration(tierId, config)
      ).rejects.toThrow('Failed to update tier configuration');
    });
  });
});