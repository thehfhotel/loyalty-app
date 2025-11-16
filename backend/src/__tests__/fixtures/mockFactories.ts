/**
 * Mock Service Factories
 * Provides pre-configured mock instances of common services
 */

import { AuthService } from '../../services/authService';
import { UserService } from '../../services/userService';

/**
 * Create a mocked AuthService with common methods
 */
export const createMockAuthService = (): jest.Mocked<AuthService> => {
  return {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    verifyToken: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;
};

/**
 * Create a mocked UserService with common methods
 */
export const createMockUserService = (): jest.Mocked<UserService> => {
  return {
    getUserById: jest.fn(),
    getUserByEmail: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    getAllUsers: jest.fn(),
    uploadAvatar: jest.fn(),
    deleteAvatar: jest.fn(),
  } as unknown as jest.Mocked<UserService>;
};

/**
 * Setup common mock implementations for AuthService
 */
export const setupAuthServiceMocks = (mockService: jest.Mocked<AuthService>) => {
  mockService.login.mockResolvedValue({
    user: {
      id: 'test-user-123',
      email: 'test@example.com',
      role: 'customer',
    },
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  });

  mockService.register.mockResolvedValue({
    user: {
      id: 'new-user-123',
      email: 'newuser@example.com',
      role: 'customer',
    },
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  });

  mockService.verifyToken.mockResolvedValue({
    id: 'test-user-123',
    email: 'test@example.com',
    role: 'customer',
  });

  return mockService;
};

/**
 * Setup common mock implementations for UserService
 */
export const setupUserServiceMocks = (mockService: jest.Mocked<UserService>) => {
  mockService.getUserById.mockResolvedValue({
    id: 'test-user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'customer',
    membershipId: '26912345',
    currentPoints: 1000,
    totalNights: 5,
  });

  mockService.getUserByEmail.mockResolvedValue({
    id: 'test-user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'customer',
    membershipId: '26912345',
    currentPoints: 1000,
    totalNights: 5,
  });

  mockService.updateUser.mockResolvedValue({
    id: 'test-user-123',
    email: 'test@example.com',
    firstName: 'Updated',
    lastName: 'User',
    role: 'customer',
    membershipId: '26912345',
    currentPoints: 1000,
    totalNights: 5,
  });

  return mockService;
};

/**
 * Reset all mocks in a service
 */
export const resetServiceMocks = (mockService: any) => {
  Object.keys(mockService).forEach((key) => {
    if (typeof mockService[key]?.mockClear === 'function') {
      mockService[key].mockClear();
    }
  });
};
