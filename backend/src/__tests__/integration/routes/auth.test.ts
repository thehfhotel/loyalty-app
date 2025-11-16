/**
 * Auth Routes Integration Tests
 * Migrated to service-based mocking pattern
 * Following proven pattern from coupon.test.ts
 */

import request from 'supertest';
import { Express } from 'express';
import authRoutes from '../../../routes/auth';
import { createTestApp } from '../../fixtures';

// Mock dependencies - Service-based mocking
jest.mock('../../../services/authService', () => {
  const mockService = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    verifyEmail: jest.fn(),
    resetPasswordRequest: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    getUserProfile: jest.fn(),
  };

  return {
    AuthService: jest.fn().mockImplementation(() => mockService),
    authService: mockService,
  };
});

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    // Auth routes that require authentication: /me and /logout
    const requiresAuth = req.path === '/me' || req.path === '/logout';

    if (requiresAuth) {
      req.user = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    }
    next();
  },
}));

// Import mocked service
import { authService } from '../../../services/authService';
const mockAuthService = authService as jest.Mocked<typeof authService>;

describe('Auth Routes Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp(authRoutes, '/api/auth');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user with valid data', async () => {
      const mockResult = {
        user: {
          id: 'user-123',
          email: 'newuser@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'customer' as const,
          isActive: true,
          emailVerified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      };

      mockAuthService.register.mockResolvedValue(mockResult as any);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe(mockResult.user.email);
      expect(response.body.user.firstName).toBe(mockResult.user.firstName);
      expect(response.body.tokens).toEqual(mockResult.tokens);
      expect(mockAuthService.register).toHaveBeenCalled();
    });

    it('should reject registration with invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: '123', // Too weak
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          // Missing password, firstName, lastName
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const mockResult = {
        user: {
          id: 'user-123',
          email: 'user@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'customer' as const,
          isActive: true,
          emailVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      };

      mockAuthService.login.mockResolvedValue(mockResult as any);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe(mockResult.user.email);
      expect(response.body.user.firstName).toBe(mockResult.user.firstName);
      expect(response.body.tokens).toEqual(mockResult.tokens);
      expect(mockAuthService.login).toHaveBeenCalled();
    });

    it('should reject login with invalid credentials', async () => {
      mockAuthService.login.mockRejectedValue(
        new Error('Invalid credentials')
      );

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'WrongPassword',
        });

      expect(response.status).toBe(500);
    });

    it('should reject login with missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          // Missing password
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockAuthService.refreshToken.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'valid-refresh-token',
        });

      expect(response.status).toBe(200);
      expect(response.body.tokens).toEqual(mockResult);
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
    });

    it('should reject refresh with invalid token', async () => {
      mockAuthService.refreshToken.mockRejectedValue(
        new Error('Invalid refresh token')
      );

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'invalid-token',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout user successfully', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/logout')
        .send({
          refreshToken: 'valid-refresh-token',
        });

      expect(response.status).toBe(200);
      expect(mockAuthService.logout).toHaveBeenCalled();
    });
  });

  describe('GET /api/auth/me', () => {
    it('should get current user info when authenticated', async () => {
      const mockUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'customer' as const,
        isActive: true,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockAuthService.getUserProfile.mockResolvedValue(mockUser as any);

      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe('test-user-id');
      expect(mockAuthService.getUserProfile).toHaveBeenCalledWith('test-user-id');
    });
  });

  describe('POST /api/auth/reset-password/request', () => {
    it('should send password reset email', async () => {
      mockAuthService.resetPasswordRequest.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/reset-password/request')
        .send({
          email: 'user@example.com',
        });

      expect(response.status).toBe(200);
      expect(mockAuthService.resetPasswordRequest).toHaveBeenCalled();
    });

    it('should reject request with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password/request')
        .send({
          email: 'invalid-email',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      mockAuthService.resetPassword.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'valid-reset-token',
          password: 'NewSecurePass123!',
        });

      expect(response.status).toBe(200);
      expect(mockAuthService.resetPassword).toHaveBeenCalled();
    });

    it('should reject reset with invalid token', async () => {
      mockAuthService.resetPassword.mockRejectedValue(
        new Error('Invalid or expired token')
      );

      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'invalid-token',
          password: 'NewSecurePass123!',
        });

      expect(response.status).toBe(500);
    });
  });
});
