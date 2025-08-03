/**
 * Jest Test Setup
 * Global test configuration and database setup for isolated testing
 */

import { v4 as uuidv4 } from 'uuid';

// Mock data storage for tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUsers: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransactions: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCoupons: any[] = [];

// Mock Prisma client for testing
export const testDb = {
  users: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  user_profiles: {
    create: jest.fn(),
  },
  points_transactions: {
    create: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
    findUnique: jest.fn(),
  },
  user_coupons: {
    create: jest.fn(),
  },
};

// Setup basic mock behaviors for common operations
const setupBasicMockBehaviors = () => {
  // Mock findMany to return the mockTransactions array filtered by query
  testDb.points_transactions.findMany = jest.fn().mockImplementation((params: any) => {
    console.log('Mock findMany called with params:', params);
    console.log('Current mockTransactions:', mockTransactions);
    let transactions = [...mockTransactions];
    if (params?.where) {
      transactions = transactions.filter(t => 
        Object.keys(params.where).every(key => t[key] === params.where[key])
      );
    }
    if (params?.orderBy) {
      const orderKey = Object.keys(params.orderBy)[0];
      const orderDir = params.orderBy[orderKey];
      transactions.sort((a, b) => {
        if (orderDir === 'desc') {
          return new Date(b[orderKey]).getTime() - new Date(a[orderKey]).getTime();
        }
        return new Date(a[orderKey]).getTime() - new Date(b[orderKey]).getTime();
      });
    }
    if (params?.take) {
      transactions = transactions.slice(0, params.take);
    }
    console.log('Mock findMany returning:', transactions);
    return Promise.resolve(transactions);
  });
  
  // Mock aggregate to sum points from mockTransactions
  testDb.points_transactions.aggregate = jest.fn().mockImplementation((params: any) => {
    console.log('Mock aggregate called with params:', params);
    let transactions = [...mockTransactions];
    if (params?.where) {
      transactions = transactions.filter(t => 
        Object.keys(params.where).every(key => t[key] === params.where[key])
      );
    }
    const sum = transactions.reduce((acc, t) => acc + (t.points || 0), 0);
    console.log('Mock aggregate returning sum:', sum);
    return Promise.resolve({ _sum: { points: sum } });
  });
  
  // Mock create to throw errors for constraint violations
  (testDb.points_transactions.create as jest.Mock).mockImplementation((params: any) => {
    // Check for foreign key constraint
    if (params.data.user_id && !mockUsers.find(u => u.id === params.data.user_id)) {
      return Promise.reject(new Error('Foreign key constraint failed'));
    }
    // Check for missing required fields
    if (!params.data.type || params.data.points === undefined) {
      return Promise.reject(new Error('Missing required fields'));
    }
    
    // This should not be reached in normal helper usage, but for direct calls
    const transaction = { 
      id: params.data.id || uuidv4(), 
      created_at: params.data.created_at || new Date(),
      ...params.data 
    };
    mockTransactions.push(transaction);
    return Promise.resolve(transaction);
  });
};

// Setup before all tests
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  console.log('Test setup initialized (using mocked Prisma client)');
  setupBasicMockBehaviors();
});

// Cleanup after each test
afterEach(async () => {
  console.log('Before cleanup - users:', mockUsers.length, 'transactions:', mockTransactions.length);
  // Clear mock data
  mockUsers.length = 0;
  mockTransactions.length = 0;
  mockCoupons.length = 0;
  
  // Reset membership counter for test isolation
  membershipCounter = 0;
  
  // Don't reset the mock implementations - just clear the data arrays
});

// Cleanup after all tests
afterAll(async () => {
  console.log('Test cleanup completed');
});

// Counter for unique membership IDs
let membershipCounter = 0;

// Test utilities
export const createTestUser = async (overrides: any = {}) => {
  const userId = uuidv4();
  const membershipId = `TEST-${Date.now()}-${++membershipCounter}`;
  const email = overrides.email || `test-${uuidv4()}@example.com`;
  
  console.log('Creating user with ID:', userId);
  console.log('testDb.users.create is a mock:', jest.isMockFunction(testDb.users.create));
  
  // Create the user object
  const userData = {
    id: userId,
    email: email,
    role: overrides.role || 'customer',
    is_active: true,
    email_verified: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  // Mock the user creation - manually add to mockUsers and configure mock
  mockUsers.push(userData);
  (testDb.users.create as jest.Mock).mockResolvedValueOnce(userData);
  
  // Call the mock (this should now return our userData)
  const user = await testDb.users.create({
    data: userData,
  });
  
  console.log('User creation result:', user);
  console.log('After user creation, mockUsers length:', mockUsers.length);

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
  
  (testDb.user_profiles.create as jest.Mock).mockResolvedValueOnce(profileData);
  
  await testDb.user_profiles.create({
    data: profileData,
  });

  // Return user with profile data for convenience
  return {
    id: userId,
    email: email,
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
  console.log('Creating transaction with userId:', userId);
  console.log('testDb.points_transactions.create is a mock:', jest.isMockFunction(testDb.points_transactions.create));
  
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
  
  // Mock the transaction creation - manually add to mockTransactions and configure mock
  mockTransactions.push(transactionData);
  (testDb.points_transactions.create as jest.Mock).mockResolvedValueOnce(transactionData);
  
  const transaction = await testDb.points_transactions.create({
    data: transactionData,
  });
  
  console.log('Transaction creation result:', transaction);
  console.log('After transaction creation, mockTransactions length:', mockTransactions.length);
  return transaction;
};