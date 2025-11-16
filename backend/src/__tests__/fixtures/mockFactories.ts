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
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    },
  });

  mockService.register.mockResolvedValue({
    user: {
      id: 'new-user-123',
      email: 'newuser@example.com',
      role: 'customer',
      isActive: true,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    },
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
    email: 'test@example.com',
    role: 'customer',
    isActive: true,
    emailVerified: true,
    password: 'hashed-password',
    createdAt: new Date(),
    updatedAt: new Date(),
    user_profiles: {
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: null,
      dateOfBirth: null,
      preferredLanguage: 'en',
      avatarUrl: null,
    },
  } as any);

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
