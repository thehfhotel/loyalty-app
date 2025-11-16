/**
 * Auth Routes Integration Tests
 * Tests complete authentication flow including registration, login, token refresh, logout
 *
 * Week 1 Priority - 25-30 tests
 * Coverage Target: ~3% contribution
 */

import request from 'supertest';
import express, { Express } from 'express';
import authRoutes from '../../../routes/auth';
import { AuthService } from '../../../services/authService';
import {
  createTestApp,
  createTestCustomer,
  createTestTokens,
  createMockAuthService,
  setupAuthServiceMocks,
  resetServiceMocks,
} from '../../fixtures';

// Mock dependencies
jest.mock('../../../services/authService');
jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Mock authenticated user
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'customer',
    };
    next();
  },
}));

describe('Auth Routes Integration Tests', () => {
  let app: Express;
  let authService: jest.Mocked<AuthService>;

  beforeAll(() => {
    // Create Express app with standard configuration using fixture
    app = createTestApp(authRoutes, '/api/auth');
  });

  beforeEach(() => {
    // Create and setup mocked auth service using fixtures
    authService = createMockAuthService();
    setupAuthServiceMocks(authService);
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
          role: 'customer',
        },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      };

      authService.register = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toEqual(mockResult.user);
      expect(response.body.tokens).toEqual(mockResult.tokens);
      expect(authService.register).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
      });
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
      expect(response.body.error).toBeDefined();
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
      expect(response.body.error).toBeDefined();
    });

    it('should reject registration with missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          // Missing password, firstName, lastName
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject registration with duplicate email', async () => {
      authService.register = jest.fn().mockRejectedValue(
        new Error('Email already exists')
      );

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'SecurePass123!',
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(response.status).toBe(500);
      expect(authService.register).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const mockResult = {
        user: {
          id: 'user-123',
          email: 'user@example.com',
          role: 'customer',
        },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      };

      authService.login = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'ValidPass123!',
        });

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual(mockResult.user);
      expect(response.body.tokens).toEqual(mockResult.tokens);
      expect(authService.login).toHaveBeenCalledWith(
        'user@example.com',
        'ValidPass123!',
        undefined
      );
    });

    it('should login with rememberMe flag', async () => {
      const mockResult = {
        user: { id: 'user-123', email: 'user@example.com', role: 'customer' },
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      };

      authService.login = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'ValidPass123!',
          rememberMe: true,
        });

      expect(response.status).toBe(200);
      expect(authService.login).toHaveBeenCalledWith(
        'user@example.com',
        'ValidPass123!',
        true
      );
    });

    it('should reject login with invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'ValidPass123!',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject login with missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          // Missing password
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject login with invalid credentials', async () => {
      authService.login = jest.fn().mockRejectedValue(
        new Error('Invalid credentials')
      );

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(500);
      expect(authService.login).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      authService.refreshToken = jest.fn().mockResolvedValue(mockTokens);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'valid-refresh-token',
        });

      expect(response.status).toBe(200);
      expect(response.body.tokens).toEqual(mockTokens);
      expect(authService.refreshToken).toHaveBeenCalledWith('valid-refresh-token');
    });

    it('should reject refresh without refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Refresh token required');
    });

    it('should reject refresh with invalid refresh token', async () => {
      authService.refreshToken = jest.fn().mockRejectedValue(
        new Error('Invalid refresh token')
      );

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'invalid-refresh-token',
        });

      expect(response.status).toBe(500);
      expect(authService.refreshToken).toHaveBeenCalled();
    });

    it('should reject refresh with expired refresh token', async () => {
      authService.refreshToken = jest.fn().mockRejectedValue(
        new Error('Refresh token expired')
      );

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'expired-refresh-token',
        });

      expect(response.status).toBe(500);
      expect(authService.refreshToken).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout authenticated user', async () => {
      authService.logout = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/logout')
        .send({
          refreshToken: 'valid-refresh-token',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Logged out successfully');
      expect(authService.logout).toHaveBeenCalledWith(
        'test-user-id',
        'valid-refresh-token'
      );
    });

    it('should logout without refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Logged out successfully');
      expect(authService.logout).not.toHaveBeenCalled();
    });

    it('should handle logout errors gracefully', async () => {
      authService.logout = jest.fn().mockRejectedValue(
        new Error('Logout failed')
      );

      const response = await request(app)
        .post('/api/auth/logout')
        .send({
          refreshToken: 'valid-refresh-token',
        });

      expect(response.status).toBe(500);
      expect(authService.logout).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/reset-password/request', () => {
    it('should request password reset with valid email', async () => {
      authService.resetPasswordRequest = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/reset-password/request')
        .send({
          email: 'user@example.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        'If the email exists, a password reset link has been sent'
      );
      expect(authService.resetPasswordRequest).toHaveBeenCalledWith('user@example.com');
    });

    it('should reject password reset request with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password/request')
        .send({
          email: 'invalid-email',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject password reset request without email', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password/request')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should return generic message for non-existent email (security)', async () => {
      authService.resetPasswordRequest = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/reset-password/request')
        .send({
          email: 'nonexistent@example.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        'If the email exists, a password reset link has been sent'
      );
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should reset password with valid token and password', async () => {
      authService.resetPassword = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'valid-reset-token',
          password: 'NewSecurePass123!',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Password reset successfully');
      expect(authService.resetPassword).toHaveBeenCalledWith(
        'valid-reset-token',
        'NewSecurePass123!'
      );
    });

    it('should reject password reset with invalid token', async () => {
      authService.resetPassword = jest.fn().mockRejectedValue(
        new Error('Invalid or expired reset token')
      );

      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'invalid-token',
          password: 'NewSecurePass123!',
        });

      expect(response.status).toBe(500);
      expect(authService.resetPassword).toHaveBeenCalled();
    });

    it('should reject password reset with weak password', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'valid-reset-token',
          password: '123', // Too weak
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject password reset without token', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          password: 'NewSecurePass123!',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject password reset without password', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: 'valid-reset-token',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/auth/me', () => {
    it('should get current user profile', async () => {
      const mockProfile = {
        id: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'customer',
        loyaltyPoints: 1000,
      };

      authService.getUserProfile = jest.fn().mockResolvedValue(mockProfile);

      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual(mockProfile);
      expect(authService.getUserProfile).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle errors when fetching user profile', async () => {
      authService.getUserProfile = jest.fn().mockRejectedValue(
        new Error('User not found')
      );

      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(500);
      expect(authService.getUserProfile).toHaveBeenCalled();
    });
  });
});
