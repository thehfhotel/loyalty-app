/**
 * User Test Fixtures
 * Provides pre-built user data for integration tests
 */

export interface TestUser {
  id: string;
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role: 'customer' | 'admin' | 'super_admin';
  membershipId?: string;
  currentPoints?: number;
  totalNights?: number;
}

/**
 * Create a test customer user
 */
export const createTestCustomer = (overrides: Partial<TestUser> = {}): TestUser => ({
  id: 'test-customer-123',
  email: 'customer@test.com',
  password: 'Test123!@#',
  firstName: 'Test',
  lastName: 'Customer',
  role: 'customer',
  membershipId: '26912345',
  currentPoints: 1000,
  totalNights: 5,
  ...overrides,
});

/**
 * Create a test admin user
 */
export const createTestAdmin = (overrides: Partial<TestUser> = {}): TestUser => ({
  id: 'test-admin-456',
  email: 'admin@test.com',
  password: 'Admin123!@#',
  firstName: 'Test',
  lastName: 'Admin',
  role: 'admin',
  membershipId: '26987654',
  currentPoints: 5000,
  totalNights: 20,
  ...overrides,
});

/**
 * Create a test super admin user
 */
export const createTestSuperAdmin = (overrides: Partial<TestUser> = {}): TestUser => ({
  id: 'test-superadmin-789',
  email: 'superadmin@test.com',
  password: 'SuperAdmin123!@#',
  firstName: 'Test',
  lastName: 'SuperAdmin',
  role: 'super_admin',
  membershipId: '26900001',
  currentPoints: 10000,
  totalNights: 50,
  ...overrides,
});

/**
 * Create multiple test users at once
 */
export const createTestUsers = (count: number, role: 'customer' | 'admin' = 'customer'): TestUser[] => {
  return Array.from({ length: count }, (_, i) => {
    const baseUser = role === 'admin' ? createTestAdmin() : createTestCustomer();
    return {
      ...baseUser,
      id: `test-${role}-${i + 1}`,
      email: `${role}${i + 1}@test.com`,
      membershipId: `2691${String(i + 1).padStart(4, '0')}`,
    };
  });
};

/**
 * Mock JWT tokens for testing
 */
export const createTestTokens = (userId: string = 'test-user-123') => ({
  accessToken: `mock-access-token-${userId}`,
  refreshToken: `mock-refresh-token-${userId}`,
});

/**
 * Mock authentication session
 */
export const createTestSession = (user: TestUser) => ({
  userId: user.id,
  email: user.email,
  role: user.role,
  membershipId: user.membershipId,
});
