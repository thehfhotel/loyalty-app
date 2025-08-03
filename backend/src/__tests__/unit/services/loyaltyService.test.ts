/**
 * LoyaltyService Unit Tests
 * Tests critical loyalty business logic using Prisma ORM
 */

import { testDb, createTestUser, createTestLoyaltyTransaction } from '../../setup';

// Note: This tests the new Prisma-based LoyaltyService that will replace the SQL-based one
// For now, we're testing the interface we want to move towards

describe('LoyaltyService', () => {
  let testUser: any;

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
      console.log('Creating transaction for user:', testUser.id);
      // Create a loyalty transaction (points award)
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        type: 'earned_stay',
        points: 100,
        description: 'Hotel stay points',
      });

      console.log('Transaction created:', transaction);
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

      // Query all transactions for user
      const transactions = await testDb.points_transactions.findMany({
        where: { user_id: testUser.id },
      });

      const totalPoints = transactions.reduce((sum: number, t: any) => sum + t.points, 0);
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
      await expect(
        testDb.points_transactions.create({
          data: {
            id: 'test-uuid',
            user_id: testUser.id,
            // type: missing
            points: 100,
            description: 'Test transaction',
            created_at: new Date(),
          } as any,
        })
      ).rejects.toThrow();
    });

    it('should validate points as number', async () => {
      await expect(
        testDb.points_transactions.create({
          data: {
            id: 'test-uuid',
            user_id: testUser.id,
            type: 'earned_stay',
            points: 'invalid' as any,
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

      const startTime = Date.now();
      const transactions = await testDb.points_transactions.findMany({
        where: { user_id: testUser.id },
        orderBy: { created_at: 'desc' },
        take: 5,
      });
      const queryTime = Date.now() - startTime;

      expect(transactions).toHaveLength(5);
      expect(queryTime).toBeLessThan(100); // Should be fast
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

      const startTime = Date.now();
      const result = await testDb.points_transactions.aggregate({
        where: { user_id: testUser.id },
        _sum: { points: true },
      });
      const queryTime = Date.now() - startTime;

      expect(result._sum.points).toBe(50); // 10*10 - 5*10 = 50
      expect(queryTime).toBeLessThan(50); // Aggregation should be very fast
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
        expect(timestamps[i].getTime()).toBeGreaterThanOrEqual(timestamps[i - 1].getTime());
      }
    });
  });
});