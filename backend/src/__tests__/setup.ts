/**
 * Jest Test Setup
 * Global test configuration and database setup for isolated testing
 */

import { v4 as uuidv4 } from 'uuid';

// Mock data storage for tests
let mockUsers: any[] = [];
let mockTransactions: any[] = [];
let mockCoupons: any[] = [];

// Mock Prisma client for testing
export const testDb = {
  users: {
    create: jest.fn((params: any) => {
      // Simulate email uniqueness constraint
      if (params.data.email && mockUsers.find(u => u.email === params.data.email)) {
        return Promise.reject(new Error('Unique constraint failed on email'));
      }
      // Simulate invalid enum values
      if (params.data.role && !['customer', 'admin', 'super_admin'].includes(params.data.role)) {
        return Promise.reject(new Error('Invalid enum value'));
      }
      const user = { id: uuidv4(), ...params.data };
      mockUsers.push(user);
      return Promise.resolve(user);
    }),
    findUnique: jest.fn((params: any) => {
      const user = mockUsers.find(u => 
        Object.keys(params.where).every(key => u[key] === params.where[key])
      );
      return Promise.resolve(user);
    }),
    findMany: jest.fn((params: any) => {
      let users = mockUsers;
      if (params.where) {
        users = users.filter(u => 
          Object.keys(params.where).every(key => u[key] === params.where[key])
        );
      }
      return Promise.resolve(users);
    }),
  },
  user_profiles: {
    create: jest.fn((params: any) => {
      const profile = { ...params.data };
      return Promise.resolve(profile);
    }),
  },
  points_transactions: {
    create: jest.fn((params: any) => {
      // Simulate foreign key constraint for non-existent user
      if (params.data.user_id && !mockUsers.find(u => u.id === params.data.user_id)) {
        return Promise.reject(new Error('Foreign key constraint failed'));
      }
      // Simulate missing required fields
      if (!params.data.type || params.data.points === undefined) {
        return Promise.reject(new Error('Missing required fields'));
      }
      const transaction = { id: uuidv4(), created_at: new Date(), ...params.data };
      mockTransactions.push(transaction);
      return Promise.resolve(transaction);
    }),
    findMany: jest.fn((params: any) => {
      let transactions = mockTransactions;
      if (params.where) {
        transactions = transactions.filter(t => 
          Object.keys(params.where).every(key => t[key] === params.where[key])
        );
      }
      if (params.orderBy) {
        const orderKey = Object.keys(params.orderBy)[0];
        const orderDir = params.orderBy[orderKey];
        transactions.sort((a, b) => {
          if (orderDir === 'desc') {
            return b[orderKey] - a[orderKey];
          }
          return a[orderKey] - b[orderKey];
        });
      }
      if (params.take) {
        transactions = transactions.slice(0, params.take);
      }
      return Promise.resolve(transactions);
    }),
    aggregate: jest.fn((params: any) => {
      let transactions = mockTransactions;
      if (params.where) {
        transactions = transactions.filter(t => 
          Object.keys(params.where).every(key => t[key] === params.where[key])
        );
      }
      const sum = transactions.reduce((acc, t) => acc + (t.points || 0), 0);
      return Promise.resolve({ _sum: { points: sum } });
    }),
    findUnique: jest.fn((params: any) => {
      const transaction = mockTransactions.find(t => 
        Object.keys(params.where).every(key => t[key] === params.where[key])
      );
      return Promise.resolve(transaction);
    }),
  },
  user_coupons: {
    create: jest.fn((params: any) => {
      // Simulate QR code uniqueness constraint
      if (params.data.qr_code && mockCoupons.find(c => c.qr_code === params.data.qr_code)) {
        return Promise.reject(new Error('Unique constraint failed on qr_code'));
      }
      // Simulate foreign key constraint for user
      if (params.data.user_id && !mockUsers.find(u => u.id === params.data.user_id)) {
        return Promise.reject(new Error('Foreign key constraint failed'));
      }
      const coupon = { id: uuidv4(), created_at: new Date(), updated_at: new Date(), ...params.data };
      mockCoupons.push(coupon);
      return Promise.resolve(coupon);
    }),
  },
};

// Setup before all tests
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  console.log('Test setup initialized (using mocked Prisma client)');
});

// Cleanup after each test
afterEach(async () => {
  console.log('Before cleanup - users:', mockUsers.length, 'transactions:', mockTransactions.length);
  // Clear mock data
  mockUsers.length = 0;
  mockTransactions.length = 0;
  mockCoupons.length = 0;
  
  // Don't clear mocks, just reset call history
  Object.values(testDb).forEach(table => {
    Object.values(table).forEach((fn: any) => {
      if (fn.mockClear) fn.mockClear();
    });
  });
});

// Cleanup after all tests
afterAll(async () => {
  console.log('Test cleanup completed');
});

// Test utilities
export const createTestUser = async (overrides: any = {}) => {
  const userId = uuidv4();
  const membershipId = `TEST-${Date.now()}`;
  
  console.log('Creating user with ID:', userId);
  // Create user first
  await testDb.users.create({
    data: {
      id: userId,
      email: overrides.email || `test-${uuidv4()}@example.com`,
      role: overrides.role || 'customer',
      is_active: true,
      email_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });
  
  console.log('After user creation, mockUsers length:', mockUsers.length);

  // Create user profile
  await testDb.user_profiles.create({
    data: {
      user_id: userId,
      first_name: overrides.firstName || 'Test',
      last_name: overrides.lastName || 'User',
      phone: overrides.phone || null,
      membership_id: overrides.membershipId || membershipId,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  // Return user with profile data for convenience
  return {
    id: userId,
    email: overrides.email || `test-${uuidv4()}@example.com`,
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    membershipId: overrides.membershipId || membershipId,
    loyaltyPoints: 0, // Default
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

export const createTestCoupon = async (userId: string, overrides: any = {}) => {
  return await testDb.user_coupons.create({
    data: {
      id: uuidv4(),
      user_id: userId,
      coupon_id: uuidv4(), // We'll need to create actual coupon later if needed
      status: 'available',
      qr_code: `TEST-QR-${uuidv4().substring(0, 8).toUpperCase()}`,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    },
  });
};

export const createTestLoyaltyTransaction = async (userId: string, overrides: any = {}) => {
  return await testDb.points_transactions.create({
    data: {
      id: uuidv4(),
      user_id: userId,
      type: overrides.type || 'earned_stay',
      points: overrides.points || 100,
      description: overrides.description || 'Test hotel stay',
      created_at: new Date(),
      ...overrides,
    },
  });
};