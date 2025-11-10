/**
 * Jest Test Setup
 * Global test configuration and database setup for isolated testing
 */

import { v4 as uuidv4 } from 'uuid';

// Type definitions for test data with index signature for flexible access
interface MockUser {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
  membershipId: string;
  [key: string]: unknown; // Allow dynamic property access
}

interface MockTransaction {
  id: string;
  user_id: string;
  type: string;
  points: number;
  description?: string;
  created_at: Date;
  [key: string]: unknown; // Allow dynamic property access
}

interface MockCoupon {
  id: string;
  user_id: string;
  coupon_id: string;
  status: string;
  qr_code: string;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  [key: string]: unknown; // Allow dynamic property access
}

// Type-safe mock data storage for tests
export const mockUsers: MockUser[] = [];
export const mockTransactions: MockTransaction[] = [];
export const mockCoupons: MockCoupon[] = [];

// Mock Prisma client interface for testing
interface MockPrismaClient {
  users: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    delete: jest.Mock;
  };
  user_profiles: {
    create: jest.Mock;
  };
  points_transactions: {
    create: jest.Mock;
    findMany: jest.Mock;
    aggregate: jest.Mock;
    findUnique: jest.Mock;
    deleteMany: jest.Mock;
  };
  user_coupons: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
}

// Mock Prisma client for testing - will be initialized in beforeAll
export const testDb: MockPrismaClient = {
  users: {} as MockPrismaClient['users'],
  user_profiles: {} as MockPrismaClient['user_profiles'],
  points_transactions: {} as MockPrismaClient['points_transactions'],
  user_coupons: {} as MockPrismaClient['user_coupons'],
};

// Removed setupBasicMockBehaviors - moved to beforeAll

// Setup before all tests
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  // Test logging removed to reduce noise - setup complete
  
  // Initialize mocks properly within Jest context
  testDb.users.create = jest.fn();
  
  testDb.users.findUnique = jest.fn();
  testDb.users.findMany = jest.fn().mockImplementation((params: { where?: Record<string, unknown>; take?: number }) => {
    let users = [...mockUsers];
    if (params?.where) {
      users = users.filter(u => 
        Object.keys(params.where!).every(key => (u as Record<string, unknown>)[key] === params.where![key])
      );
    }
    if (params?.take) {
      users = users.slice(0, params.take);
    }
    return Promise.resolve(users);
  });
  testDb.users.delete = jest.fn();
  
  testDb.user_profiles.create = jest.fn();
  
  testDb.points_transactions.create = jest.fn();
  
  testDb.points_transactions.findMany = jest.fn();
  testDb.points_transactions.aggregate = jest.fn();
  testDb.points_transactions.findUnique = jest.fn();
  testDb.points_transactions.deleteMany = jest.fn();
  
  testDb.user_coupons.create = jest.fn();
  
  testDb.user_coupons.findMany = jest.fn();
  
  // Setup persistent mock behaviors for query operations
  testDb.points_transactions.findMany = jest.fn().mockImplementation((params: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }) => {
    let transactions = [...mockTransactions];
    if (params?.where) {
      transactions = transactions.filter(t => 
        Object.keys(params.where!).every(key => (t as Record<string, unknown>)[key] === params.where![key])
      );
    }
    if (params?.orderBy) {
      const orderKey = Object.keys(params.orderBy)[0];
      if (!orderKey) {
        throw new Error('orderBy key is required');
      }
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
  
  testDb.points_transactions.aggregate = jest.fn().mockImplementation((params: { where?: Record<string, unknown>; _sum?: { points: boolean } }) => {
    let transactions = [...mockTransactions];
    if (params?.where) {
      transactions = transactions.filter(t => 
        Object.keys(params.where!).every(key => (t as Record<string, unknown>)[key] === params.where![key])
      );
    }
    
    // Check if we're summing points
    if (params?._sum?.points) {
      const sum = transactions.reduce((acc, t) => acc + (t.points || 0), 0);
      return Promise.resolve({ _sum: { points: sum } });
    }
    
    return Promise.resolve({ _sum: { points: null } });
  });
  
  testDb.points_transactions.findUnique = jest.fn().mockImplementation((params: { where?: { id?: string } }) => {
    if (params?.where?.id) {
      const transaction = mockTransactions.find(t => t.id === params.where!.id);
      return Promise.resolve(transaction || null);
    }
    return Promise.resolve(null);
  });
  
  testDb.users.findUnique = jest.fn().mockImplementation((params: { where?: { email?: string; id?: string } }) => {
    if (params?.where?.email) {
      const user = mockUsers.find(u => u.email === params.where!.email);
      return Promise.resolve(user || null);
    }
    if (params?.where?.id) {
      const user = mockUsers.find(u => u.id === params.where!.id);
      return Promise.resolve(user || null);
    }
    return Promise.resolve(null);
  });
  
  testDb.users.delete = jest.fn().mockImplementation((params: { where: { id: string } }) => {
    const index = mockUsers.findIndex(u => u.id === params.where.id);
    if (index !== -1) {
      const user = mockUsers[index];
      mockUsers.splice(index, 1);
      return Promise.resolve(user);
    }
    return Promise.reject(new Error('User not found'));
  });
  
  testDb.points_transactions.deleteMany = jest.fn().mockImplementation((params: { where?: { user_id?: string } }) => {
    if (params?.where?.user_id) {
      const toDelete = mockTransactions.filter(t => t.user_id === params.where!.user_id);
      const count = toDelete.length;
      toDelete.forEach(t => {
        const index = mockTransactions.indexOf(t);
        if (index > -1) {
          mockTransactions.splice(index, 1);
        }
      });
      return Promise.resolve({ count });
    }
    return Promise.resolve({ count: 0 });
  });
  
  // Mock implementations are now set up once and remain consistent
});

// Cleanup after each test
afterEach(async () => {
  // Clear mock data with silent cleanup for better test performance
  mockUsers.length = 0;
  mockTransactions.length = 0;
  mockCoupons.length = 0;
  
  // Reset membership counter for test isolation
  membershipCounter = 0;
  
  // Mock implementations are now applied inline in helper functions
});

// Cleanup after all tests
afterAll(async () => {
  // Test cleanup completed - logging removed for cleaner output
});

// Counter for unique membership IDs
let membershipCounter = 0;

// Test utilities
export const createTestUser = async (overrides: Record<string, unknown> = {}) => {
  const userId = uuidv4();
  const membershipId = overrides.membershipId || `TEST-${Date.now()}-${++membershipCounter}`;
  const email = overrides.email !== undefined ? overrides.email : `test-${uuidv4()}@example.com`;
  
  // Create the user object
  const userData = {
    id: userId,
    email: email,
    role: overrides.role || 'customer',
    is_active: true,
    email_verified: false,
    created_at: new Date(),
    updated_at: new Date(),
    membershipId: membershipId, // Add membershipId to user data
  };
  
  // Apply mock implementation inline to avoid Jest clearing it
  
  // Set mock implementation inline to ensure it's available
  (testDb.users.create as jest.Mock).mockImplementation((params: { data: Partial<MockUser> }) => {
    const userData = params.data;
    
    // Check for email uniqueness
    const existingUserByEmail = mockUsers.find(u => u.email === userData.email);
    if (existingUserByEmail) {
      return Promise.reject(new Error('Unique constraint failed on the fields: (`email`)'));
    }
    
    // Check for membership ID uniqueness
    const existingUserByMembership = mockUsers.find(u => u.membershipId === userData.membershipId);
    if (existingUserByMembership) {
      return Promise.reject(new Error('Unique constraint failed on the fields: (`membership_id`)'));
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email as string)) {
      return Promise.reject(new Error('invalid email format'));
    }
    
    // Success case
    const user = { 
      id: userData.id || uuidv4(), 
      created_at: userData.created_at || new Date(),
      updated_at: userData.updated_at || new Date(),
      ...userData 
    } as MockUser;
    mockUsers.push(user);
    return Promise.resolve(user);
  });
  
  await testDb.users.create({
    data: userData,
  });
  

  // Mock profile creation
  const profileData = {
    user_id: userId,
    first_name: overrides.firstName || 'Test',
    last_name: overrides.lastName || 'User',
    phone: overrides.phone || null,
    membership_id: overrides.membershipId || membershipId,
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  // Set mock implementation for user profile creation
  (testDb.user_profiles.create as jest.Mock).mockImplementation((params: { data: Record<string, unknown> }) => {
    const profile = { 
      id: uuidv4(), 
      created_at: new Date(),
      updated_at: new Date(),
      ...params.data 
    };
    return Promise.resolve(profile);
  });
  
  await testDb.user_profiles.create({
    data: profileData,
  });

  // Return user with profile data for convenience
  const returnUser = {
    id: userId,
    email: email,
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    membershipId: membershipId,
    loyaltyPoints: 0, // Default
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  return returnUser;
};

export const createTestCoupon = async (userId: string, overrides: Record<string, unknown> = {}) => {
  const couponData = {
    id: uuidv4(),
    user_id: userId,
    coupon_id: uuidv4(),
    status: overrides.status || 'available',
    qr_code: overrides.qr_code || `TEST-QR-${uuidv4().substring(0, 8).toUpperCase()}`,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  
  // Set mock implementation inline
  (testDb.user_coupons.create as jest.Mock).mockImplementation((params: { data: Partial<MockCoupon> }) => {
    // Check if user exists (foreign key constraint)
    const userExists = mockUsers.find(u => u.id === params?.data?.user_id);
    if (!userExists) {
      return Promise.reject(new Error('Foreign key constraint failed on the field: `user_id`'));
    }
    
    const qrCode = params?.data?.qr_code || `TEST-QR-${uuidv4().substring(0, 8).toUpperCase()}`;
    
    // Check for QR code uniqueness
    const existingCoupon = mockCoupons.find(c => c.qr_code === qrCode);
    if (existingCoupon) {
      return Promise.reject(new Error('Unique constraint failed on the fields: (`qr_code`)'));
    }
    
    const couponData = {
      id: uuidv4(),
      ...params.data,
      qr_code: qrCode,
    } as MockCoupon;
    
    // Add to mock storage
    mockCoupons.push(couponData);
    return Promise.resolve(couponData);
  });
  
  return await testDb.user_coupons.create({
    data: couponData,
  });
};

export const createTestLoyaltyTransaction = async (userId: string, overrides: Record<string, unknown> = {}) => {
  
  // Create the transaction object
  const transactionData = {
    id: uuidv4(),
    user_id: userId,
    type: overrides.type || 'earned_stay',
    points: overrides.points || 100,
    description: overrides.description || 'Test hotel stay',
    created_at: new Date(),
    ...overrides,
  };
  
  // Set mock implementation inline
  (testDb.points_transactions.create as jest.Mock).mockImplementation((params: { data: Partial<MockTransaction> }) => {
    // Check for foreign key constraint
    if (params?.data?.user_id && !mockUsers.find(u => u.id === params.data.user_id)) {
      return Promise.reject(new Error('Foreign key constraint failed'));
    }
    // Check for missing required fields
    if (!params?.data?.type || params?.data?.points === undefined) {
      return Promise.reject(new Error('Missing required fields'));
    }
    
    // Success case
    const transaction = { 
      id: params.data.id || uuidv4(), 
      created_at: params.data.created_at || new Date(),
      ...params.data 
    } as MockTransaction;
    mockTransactions.push(transaction);
    return Promise.resolve(transaction);
  });
  
  const transaction = await testDb.points_transactions.create({
    data: transactionData,
  });
  
  return transaction;
};