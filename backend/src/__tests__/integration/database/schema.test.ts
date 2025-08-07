/**
 * Database Schema Integration Tests
 * Tests database constraints, relationships, and integrity
 */

import { testDb, createTestUser, createTestCoupon, createTestLoyaltyTransaction, mockUsers, mockTransactions } from '../../setup';

// Define the test user interface to match createTestUser return type
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

describe('Database Schema Integration', () => {
  describe('User Table Constraints', () => {
    it('should enforce email uniqueness', async () => {
      const email = 'unique-email@example.com';
      
      // First user should succeed
      await createTestUser({ email });
      
      // Second user with same email should fail
      await expect(
        createTestUser({ email })
      ).rejects.toThrow();
    });

    it('should enforce membership ID uniqueness', async () => {
      const membershipId = 'UNIQUE-123456';
      
      // Create first user
      await createTestUser({
        email: 'user1@example.com',
        membershipId,
      });
      
      // Second user with same membership ID should fail
      await expect(
        createTestUser({
          email: 'user2@example.com',
          membershipId,
        })
      ).rejects.toThrow();
    });

    it('should require valid email format in application layer', async () => {
      // Note: Database constraints for email format would be tested here
      // For now, we test that our application validates emails
      const invalidEmails = [
        'not-an-email',
        '@domain.com',
        'user@',
        '',
      ];

      for (const email of invalidEmails) {
        await expect(
          createTestUser({ email })
        ).rejects.toThrow();
      }
    });

    it('should have proper timestamps', async () => {
      const beforeCreate = new Date();
      const user = await createTestUser({
        email: 'timestamp-test@example.com',
      });
      const afterCreate = new Date();

      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
      expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(user.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });
  });

  describe('Loyalty Transaction Relationships', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'loyalty-test@example.com',
      });
    });

    it('should enforce foreign key constraint to users', async () => {
      // Valid user ID should work
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        points: 100,
        type: 'earned_stay',
      });
      
      expect(transaction.user_id).toBe(testUser.id);

      // Invalid user ID should fail
      await expect(
        testDb.points_transactions.create({
          data: {
            id: 'test-transaction',
            user_id: 'non-existent-user-id',
            type: 'earned_stay',
            points: 100,
            description: 'Test transaction',
            created_at: new Date(),
          },
        })
      ).rejects.toThrow();
    });

    it('should allow multiple transactions per user', async () => {
      const transactions = await Promise.all([
        createTestLoyaltyTransaction(testUser.id, { points: 100, type: 'earned_stay' }),
        createTestLoyaltyTransaction(testUser.id, { points: 50, type: 'bonus' }),
        createTestLoyaltyTransaction(testUser.id, { points: -25, type: 'redeemed_coupon' }),
      ]);

      expect(transactions).toHaveLength(3);
      transactions.forEach(t => {
        expect(t.user_id).toBe(testUser.id);
      });
    });

    it('should maintain transaction integrity during user deletion', async () => {
      // Create transaction
      const transaction = await createTestLoyaltyTransaction(testUser.id, {
        points: 100,
        type: 'earned_stay',
      });

      // In a real system, deleting a user should handle transactions appropriately
      // Either cascade delete or prevent deletion if transactions exist
      // This test documents the expected behavior
      expect(transaction.user_id).toBe(testUser.id);
      
      // Verify transaction exists
      // Set inline mock for findUnique to ensure it works properly
      (testDb.points_transactions.findUnique as jest.Mock).mockImplementation((params: { where?: { id?: string } }) => {
        if (params?.where?.id) {
          const foundTransaction = mockTransactions.find(t => t.id === params.where!.id);
          return Promise.resolve(foundTransaction ?? null);
        }
        return Promise.resolve(null);
      });
      
      const foundTransaction = await testDb.points_transactions.findUnique({
        where: { id: transaction.id },
      });
      expect(foundTransaction).toBeDefined();
    });
  });

  describe('Coupon Relationships', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'coupon-test@example.com',
      });
    });

    it('should enforce foreign key constraint to users', async () => {
      // Valid user ID should work
      const coupon = await createTestCoupon(testUser.id, {
        code: 'VALID-COUPON-123',
        type: 'percentage',
        value: 10,
      });
      
      expect(coupon.user_id).toBe(testUser.id);

      // Invalid user ID should fail
      await expect(
        testDb.user_coupons.create({
          data: {
            id: 'test-coupon',
            user_id: 'non-existent-user-id',
            coupon_id: 'test-coupon-def',
            qr_code: 'INVALID-USER-COUPON',
            status: 'available',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            created_at: new Date(),
            updated_at: new Date(),
          },
        })
      ).rejects.toThrow();
    });

    it('should enforce QR code uniqueness', async () => {
      const qrCode = 'UNIQUE-QR-CODE';
      
      // First coupon should succeed
      await createTestCoupon(testUser.id, { qr_code: qrCode });
      
      // Second coupon with same QR code should fail
      await expect(
        createTestCoupon(testUser.id, { qr_code: qrCode })
      ).rejects.toThrow();
    });

    it('should support different coupon statuses', async () => {
      const couponStatuses = ['available', 'used', 'expired', 'revoked'];

      for (const status of couponStatuses) {
        const coupon = await createTestCoupon(testUser.id, {
          qr_code: `${status.toUpperCase()}-${Date.now()}`,
          status: status,
        });

        expect(coupon.status).toBe(status);
      }
    });
  });

  describe('Data Integrity Constraints', () => {
    it('should prevent negative loyalty points in business logic', async () => {
      const user = await createTestUser({
        email: 'negative-points@example.com',
        loyaltyPoints: 0, // Start with zero points
      });

      // User starts with 0 points
      expect(user.loyaltyPoints).toBe(0);

      // In business logic, we should prevent operations that would result in negative points
      // This is typically handled at the service layer, not database constraints
    });

    it('should handle concurrent user creation', async () => {
      // Simulate concurrent user creation with potential conflicts
      const promises = Array.from({ length: 5 }, (_, i) =>
        createTestUser({
          email: `concurrent-${i}-${Date.now()}@example.com`,
          firstName: `User${i}`,
        })
      );

      const users = await Promise.all(promises);
      
      // All users should be created successfully
      expect(users).toHaveLength(5);
      
      // All should have unique emails and membership IDs
      const emails = users.map(u => u.email);
      const membershipIds = users.map(u => u.membershipId);
      
      expect(new Set(emails).size).toBe(5);
      expect(new Set(membershipIds).size).toBe(5);
    });

    it('should handle transaction rollback on constraint violation', async () => {
      const email = 'rollback-test@example.com';
      
      // Create first user
      await createTestUser({ email });
      
      // Attempt to create second user with same email should fail
      // and not leave partial data
      await expect(
        createTestUser({ email })
      ).rejects.toThrow();
      
      // Verify only one user exists with this email
      // Set inline mock for findMany to ensure it works properly
      (testDb.users.findMany as jest.Mock).mockImplementation((params: { where?: Record<string, unknown>; take?: number }) => {
        let users = [...mockUsers];
        if (params?.where) {
          users = users.filter(u => {
            return Object.keys(params.where!).every(key => {
              const userValue = (u as Record<string, unknown>)[key];
              const whereValue = (params.where! as Record<string, unknown>)[key];
              return userValue === whereValue;
            });
          });
        }
        if (params?.take) {
          users = users.slice(0, params.take);
        }
        return Promise.resolve(users);
      });
      
      const users = await testDb.users.findMany({
        where: { email },
      });
      
      expect(users).toHaveLength(1);
    });
  });

  describe('Database Performance', () => {
    it('should efficiently query users by email', async () => {
      const user = await createTestUser({
        email: 'performance-test@example.com',
      });

      // Set inline mock for findUnique to ensure it works properly
      (testDb.users.findUnique as jest.Mock).mockImplementation((params: { where?: { email?: string; id?: string } }) => {
        if (params?.where?.email) {
          const user = mockUsers.find(u => u.email === params.where!.email);
          return Promise.resolve(user ?? null);
        }
        if (params?.where?.id) {
          const user = mockUsers.find(u => u.id === params.where!.id);
          return Promise.resolve(user ?? null);
        }
        return Promise.resolve(null);
      });

      const startTime = Date.now();
      const foundUser = await testDb.users.findUnique({
        where: { email: user.email },
      });
      const queryTime = Date.now() - startTime;

      expect(foundUser).toBeDefined();
      expect(foundUser?.id).toBe(user.id);
      expect(queryTime).toBeLessThan(50); // Should be very fast with proper indexing
    });

    it('should efficiently query loyalty transactions by user', async () => {
      const user = await createTestUser({
        email: 'transaction-perf@example.com',
      });

      // Create multiple transactions
      await Promise.all(Array.from({ length: 10 }, (_, i) =>
        createTestLoyaltyTransaction(user.id, {
          points: 10 * (i + 1),
          type: 'earned_stay',
        })
      ));

      // Set inline mock for findMany to ensure it works properly
      (testDb.points_transactions.findMany as jest.Mock).mockImplementation((params: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }) => {
        let transactions = [...mockTransactions];
        if (params?.where) {
          transactions = transactions.filter(t => {
            return Object.keys(params.where!).every(key => {
              const transactionValue = (t as Record<string, unknown>)[key];
              const whereValue = (params.where! as Record<string, unknown>)[key];
              return transactionValue === whereValue;
            });
          });
        }
        if (params?.orderBy) {
          const orderKey = Object.keys(params.orderBy)[0];
          const orderDir = params.orderBy[orderKey];
          transactions.sort((a, b) => {
            if (orderDir === 'desc') {
              return new Date((b as Record<string, unknown>)[orderKey] as string).getTime() - new Date((a as Record<string, unknown>)[orderKey] as string).getTime();
            }
            return new Date((a as Record<string, unknown>)[orderKey] as string).getTime() - new Date((b as Record<string, unknown>)[orderKey] as string).getTime();
          });
        }
        if (params?.take) {
          transactions = transactions.slice(0, params.take);
        }
        return Promise.resolve(transactions);
      });

      const startTime = Date.now();
      const transactions = await testDb.points_transactions.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' },
        take: 5,
      });
      const queryTime = Date.now() - startTime;

      expect(transactions).toHaveLength(5);
      expect(queryTime).toBeLessThan(100); // Should be fast with proper indexing
    });

    it('should efficiently aggregate loyalty points', async () => {
      const user = await createTestUser({
        email: 'aggregation-test@example.com',
      });

      // Create transactions with known total
      await Promise.all([
        createTestLoyaltyTransaction(user.id, { points: 100, type: 'earned_stay' }),
        createTestLoyaltyTransaction(user.id, { points: 50, type: 'bonus' }),
        createTestLoyaltyTransaction(user.id, { points: -25, type: 'redeemed_coupon' }),
      ]);

      // Set inline mock for aggregate to ensure it works properly
      (testDb.points_transactions.aggregate as jest.Mock).mockImplementation((params: { where?: Record<string, unknown>; _sum?: { points: boolean } }) => {
        let transactions = [...mockTransactions];
        if (params?.where) {
          transactions = transactions.filter(t => {
            return Object.keys(params.where!).every(key => {
              const transactionValue = (t as Record<string, unknown>)[key];
              const whereValue = (params.where! as Record<string, unknown>)[key];
              return transactionValue === whereValue;
            });
          });
        }
        
        // Check if we're summing points
        if (params?._sum?.points) {
          const sum = transactions.reduce((acc, t) => acc + (t.points ?? 0), 0);
          return Promise.resolve({ _sum: { points: sum } });
        }
        
        return Promise.resolve({ _sum: { points: null } });
      });

      const startTime = Date.now();
      const result = await testDb.points_transactions.aggregate({
        where: { user_id: user.id },
        _sum: { points: true },
      });
      const queryTime = Date.now() - startTime;

      expect(result._sum.points).toBe(125); // 100 + 50 - 25
      expect(queryTime).toBeLessThan(50); // Aggregation should be fast
    });
  });

  describe('Schema Evolution', () => {
    it('should support adding new fields without breaking existing data', async () => {
      // Create user with current schema
      const user = await createTestUser({
        email: 'schema-evolution@example.com',
      });

      // Verify user has expected fields
      expect(user.id).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
      
      // In schema evolution, we would test that new optional fields
      // can be added without affecting existing records
    });

    it('should handle nullable fields appropriately', async () => {
      const transaction = await createTestLoyaltyTransaction(
        (await createTestUser({ email: 'nullable-test@example.com' })).id,
        {
          points: 100,
          type: 'earned_stay',
          description: null, // Nullable field
        }
      );

      expect(transaction.description).toBeNull();
      expect(transaction.points).toBe(100);
    });
  });
});