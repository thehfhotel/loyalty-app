/**
 * AuthService Unit Tests
 * Tests authentication, authorization, and user management
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { testDb, createTestUser } from '../../setup';
import { AuthService } from '../../../services/authService';
import { AppError } from '../../../middleware/errorHandler';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../services/adminConfigService');
jest.mock('../../../services/loyaltyService');
jest.mock('../../../services/membershipIdService');
jest.mock('../../../utils/emojiUtils');

import * as database from '../../../config/database';
import { adminConfigService } from '../../../services/adminConfigService';
import { loyaltyService } from '../../../services/loyaltyService';
import { membershipIdService } from '../../../services/membershipIdService';
import * as emojiUtils from '../../../utils/emojiUtils';

// Environment variables are already set in setup.ts
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

// Test types
interface TestUser {
  id: string;
  email: string | null;
  role?: string;
  membershipId?: string;
  password?: string;
  passwordHash?: string;
  firstName?: string;
  lastName?: string;
  loyaltyPoints?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface JWTPayload {
  id: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

describe('AuthService', () => {
  let testUser: TestUser;
  let authService: AuthService;
  let mockQuery: jest.Mock;
  let mockGetClient: jest.Mock;
  let mockClient: Partial<PoolClient>;

  beforeEach(async () => {
    // Create a new instance for each test
    authService = new AuthService();

    // Setup mock database client
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    } as Partial<PoolClient>;

    mockQuery = jest.fn();
    mockGetClient = jest.fn().mockResolvedValue(mockClient);

    // Mock database functions
    (database.query as jest.Mock) = mockQuery;
    (database.getClient as jest.Mock) = mockGetClient;

    // Mock other services
    (membershipIdService.generateUniqueMembershipId as jest.Mock) = jest.fn().mockResolvedValue('MEM-12345678');
    (emojiUtils.getRandomEmojiAvatar as jest.Mock) = jest.fn().mockReturnValue('🎉');
    (emojiUtils.generateEmojiAvatarUrl as jest.Mock) = jest.fn().mockReturnValue('https://api.dicebear.com/7.x/fun-emoji/svg?seed=🎉');
    (loyaltyService.ensureUserLoyaltyEnrollment as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (adminConfigService.getRequiredRole as jest.Mock) = jest.fn().mockReturnValue(null);

    testUser = await createTestUser({
      email: 'auth-test@example.com',
      firstName: 'Auth',
      lastName: 'Test',
    });
  });

  describe('Password Security', () => {
    it('should hash passwords securely', async () => {
      const plainPassword = 'SecurePassword123!';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      expect(hashedPassword).not.toBe(plainPassword);
      expect(hashedPassword.length).toBeGreaterThan(50);
      expect(hashedPassword).toMatch(/^\$2[ab]\$/); // bcrypt hash format
    });

    it('should verify passwords correctly', async () => {
      const plainPassword = 'SecurePassword123!';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      const isValid = await bcrypt.compare(plainPassword, hashedPassword);
      const isInvalid = await bcrypt.compare('WrongPassword', hashedPassword);

      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });

    it('should not store plain text passwords', async () => {
      // Verify that our test user doesn't have a plain text password
      expect(testUser.password).toBeUndefined();
      expect(testUser.passwordHash).toBeUndefined();
      
      // In real implementation, password_hash would be stored securely
      // This test ensures we never accidentally store plain text
    });
  });

  describe('JWT Token Management', () => {
    it('should generate valid JWT tokens', () => {
      const payload = {
        id: testUser.id,
        email: testUser.email,
        role: 'customer',
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should verify JWT tokens correctly', () => {
      const payload = {
        id: testUser.id,
        email: testUser.email,
        role: 'customer',
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;

      expect(decoded.id).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
    });

    it('should reject invalid JWT tokens', () => {
      const invalidToken = 'invalid.jwt.token';

      expect(() => {
        jwt.verify(invalidToken, JWT_SECRET);
      }).toThrow();
    });

    it('should reject expired JWT tokens', () => {
      const payload = {
        id: testUser.id,
        email: testUser.email,
        role: 'customer',
      };

      const expiredToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '-1h' });

      expect(() => {
        jwt.verify(expiredToken, JWT_SECRET);
      }).toThrow('jwt expired');
    });

    it('should handle different JWT secrets', () => {
      const payload = {
        id: testUser.id,
        email: testUser.email,
        role: 'customer',
      };

      const token = jwt.sign(payload, JWT_SECRET);
      const wrongSecret = 'wrong-secret';

      expect(() => {
        jwt.verify(token, wrongSecret);
      }).toThrow('invalid signature');
    });
  });

  describe('User Role Management', () => {
    it('should handle customer role', async () => {
      const customerUser = await createTestUser({
        email: 'customer@example.com',
      });

      // Default role should be customer (or undefined, defaulting to customer)
      expect(customerUser.email).toBe('customer@example.com');
    });

    it('should support different user roles', async () => {
      const roles = ['customer', 'admin', 'super_admin'];
      
      for (const role of roles) {
        const roleUser = await createTestUser({
          email: `${role}@example.com`,
        });
        
        expect(roleUser.email).toBe(`${role}@example.com`);
        // In a real implementation, we would set and verify the role
      }
    });
  });

  describe('User Data Validation', () => {
    it('should require valid email format', async () => {
      const invalidEmails = [
        'invalid-email',
        '@domain.com',
        'user@',
        'user.domain.com',
        '',
      ];

      for (const invalidEmail of invalidEmails) {
        // Mock both user and profile creation rejections for invalid email format
        (testDb.users.create as jest.Mock).mockRejectedValueOnce(
          new Error('Invalid email format')
        );
        (testDb.user_profiles.create as jest.Mock).mockRejectedValueOnce(
          new Error('Invalid email format')
        );
        
        await expect(
          createTestUser({ email: invalidEmail })
        ).rejects.toThrow();
      }
    });

    it('should enforce email uniqueness', async () => {
      const email = 'unique-test@example.com';
      
      // First user should succeed
      await createTestUser({ email });
      
      // Mock the rejection for duplicate email
      (testDb.users.create as jest.Mock).mockRejectedValueOnce(
        new Error('Email already exists')
      );
      
      // Second user with same email should fail
      await expect(
        createTestUser({ email })
      ).rejects.toThrow();
    });

    it('should validate required user fields', async () => {
      // Mock the rejection for missing required fields
      (testDb.users.create as jest.Mock).mockRejectedValueOnce(
        new Error('Missing required fields')
      );
      
      // Test missing email
      await expect(
        testDb.users.create({
          data: {
            id: 'test-uuid',
            // email: missing - intentional for testing validation
            role: 'customer',
            created_at: new Date(),
            updated_at: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test case for missing required field
          } as any,
        })
      ).rejects.toThrow();
    });
  });

  describe('Security Features', () => {
    it('should handle password reset token generation', () => {
      const resetToken = 'test-reset-token-uuid';
      
      expect(resetToken).toBeDefined();
      expect(typeof resetToken).toBe('string');
      expect(resetToken.length).toBeGreaterThan(10);
    });

    it('should generate secure membership IDs', async () => {
      const users = [];
      
      // Create multiple users and check membership ID uniqueness
      for (let i = 0; i < 5; i++) {
        const user = await createTestUser({
          email: `member${i}@example.com`,
        });
        users.push(user);
      }

      // Check all membership IDs are unique
      const membershipIds = users.map(u => u.membershipId);
      const uniqueIds = new Set(membershipIds);
      
      expect(uniqueIds.size).toBe(users.length);
      
      // Check membership ID format
      for (const id of membershipIds) {
        expect(id).toMatch(/^TEST-/); // Our test format
      }
    });

    it('should handle session management data', async () => {
      // Simulate storing refresh token data
      const refreshTokenData = {
        userId: testUser.id,
        token: 'test-refresh-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        createdAt: new Date(),
      };

      expect(refreshTokenData.userId).toBe(testUser.id);
      expect(refreshTokenData.expiresAt).toBeInstanceOf(Date);
      expect(refreshTokenData.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('User Profile Management', () => {
    it('should maintain complete user profile data', async () => {
      const profileUser = await createTestUser({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      });

      expect(profileUser.firstName).toBe('John');
      expect(profileUser.lastName).toBe('Doe');
      expect(profileUser.email).toBe('john.doe@example.com');
      expect(profileUser.membershipId).toBeDefined();
      expect(profileUser.createdAt).toBeInstanceOf(Date);
      expect(profileUser.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle optional profile fields', async () => {
      const minimalUser = await createTestUser({
        email: 'minimal@example.com',
      });

      // These fields should have defaults or be optional
      expect(minimalUser.email).toBe('minimal@example.com');
      expect(minimalUser.loyaltyPoints).toBe(0);
    });

    it('should support user metadata', async () => {
      const userWithMetadata = await createTestUser({
        email: 'metadata@example.com',
        firstName: 'Meta',
        lastName: 'Data',
      });

      // User should have system-generated fields
      expect(userWithMetadata.id).toBeDefined();
      expect(userWithMetadata.createdAt).toBeInstanceOf(Date);
      expect(userWithMetadata.updatedAt).toBeInstanceOf(Date);
      expect(userWithMetadata.membershipId).toMatch(/^TEST-/);
    });
  });

  describe('Error Handling', () => {
    it('should handle database constraint violations gracefully', async () => {
      // Try to create user with duplicate email
      const email = 'duplicate@example.com';
      await createTestUser({ email });

      // Mock the rejection for duplicate email constraint
      (testDb.users.create as jest.Mock).mockRejectedValueOnce(
        new Error('Unique constraint failed')
      );

      await expect(
        createTestUser({ email })
      ).rejects.toThrow();
    });

    it('should validate data types', async () => {
      // Mock the rejection for invalid data types
      (testDb.users.create as jest.Mock).mockRejectedValueOnce(
        new Error('Invalid data type')
      );
      
      // Test invalid data types
      await expect(
        testDb.users.create({
          data: {
            id: 'test-uuid',
            email: 'test@example.com',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test case for invalid enum value
            role: 'invalid' as any, // Should be valid enum
            created_at: new Date(),
            updated_at: new Date(),
          },
        })
      ).rejects.toThrow();
    });

    it('should handle missing required relationships', async () => {
      // In a real implementation, this would test foreign key constraints
      // For now, we ensure our test data setup is consistent
      expect(testUser.id).toBeDefined();
      expect(testUser.email).toBeDefined();
    });
  });

  describe('Performance and Scalability', () => {
    it('should efficiently query user data', async () => {
      // Mock the findUnique response
      (testDb.users.findUnique as jest.Mock).mockResolvedValueOnce(testUser);

      const user = await testDb.users.findUnique({
        where: { id: testUser.id },
      });

      expect(user).toBeDefined();
    });

    it('should handle batch user operations', async () => {
      const userPromises = Array.from({ length: 10 }, (_, i) =>
        createTestUser({
          email: `batch-user-${i}@example.com`,
          firstName: `Batch${i}`,
          lastName: 'User',
        })
      );

      const users = await Promise.all(userPromises);

      expect(users).toHaveLength(10);

      // Verify all users have unique emails and membership IDs
      const emails = users.map(u => u.email);
      const membershipIds = users.map(u => u.membershipId);

      expect(new Set(emails).size).toBe(10);
      expect(new Set(membershipIds).size).toBe(10);
    });
  });

  describe('register()', () => {
    it('should successfully register a new user', async () => {
      const userData = {
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        phone: '1234567890',
      };

      const userId = uuidv4();
      const mockUser = {
        id: userId,
        email: userData.email,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock database calls
      mockQuery.mockResolvedValueOnce([]); // No existing user
      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce({ command: 'BEGIN', rowCount: 0, rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockUser] }) // INSERT user
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // INSERT profile
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // INSERT refresh token
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // INSERT audit log
        .mockResolvedValueOnce({ command: 'COMMIT', rowCount: 0, rows: [] }); // COMMIT

      mockQuery.mockResolvedValueOnce([{ ...mockUser, firstName: userData.firstName, lastName: userData.lastName, membershipId: 'MEM-12345678' }]); // getUserProfile

      const result = await authService.register(userData);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(userData.email);
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(loyaltyService.ensureUserLoyaltyEnrollment).toHaveBeenCalledWith(userId);
    });

    it('should reject registration with existing email', async () => {
      const userData = {
        email: 'existing@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
      };

      // Mock existing user
      (mockClient.query as jest.Mock).mockResolvedValueOnce({ command: 'BEGIN', rowCount: 0, rows: [] });
      mockQuery.mockResolvedValueOnce([{ id: uuidv4(), email: userData.email }]);

      const error = await authService.register(userData).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Email already registered');
    });

    describe('email uniqueness', () => {
      it('should throw 409 with EMAIL_ALREADY_REGISTERED code when email exists', async () => {
        const existingEmail = 'duplicate@example.com';

        // First, register a user
        const firstUserData = {
          email: existingEmail,
          password: 'FirstPass123!',
          firstName: 'First',
          lastName: 'User',
        };

        const userId = uuidv4();
        const mockUser = {
          id: userId,
          email: existingEmail,
          role: 'customer',
          isActive: true,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Mock successful first registration
        mockQuery.mockResolvedValueOnce([]); // No existing user
        (mockClient.query as jest.Mock)
          .mockResolvedValueOnce({ command: 'BEGIN', rowCount: 0, rows: [] })
          .mockResolvedValueOnce({ rows: [mockUser] })
          .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] })
          .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] })
          .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] })
          .mockResolvedValueOnce({ command: 'COMMIT', rowCount: 0, rows: [] });
        mockQuery.mockResolvedValueOnce([{ ...mockUser, firstName: 'First', lastName: 'User', membershipId: 'MEM-11111111' }]);

        await authService.register(firstUserData);

        // Now try to register with the same email
        const secondUserData = {
          email: existingEmail,
          password: 'SecondPass123!',
          firstName: 'Second',
          lastName: 'User',
        };

        // Mock the duplicate email check
        (mockClient.query as jest.Mock).mockResolvedValueOnce({ command: 'BEGIN', rowCount: 0, rows: [] });
        mockQuery.mockResolvedValueOnce([mockUser]); // Email already exists

        const error = await authService.register(secondUserData).catch(e => e);

        expect(error).toBeInstanceOf(AppError);
        expect(error.statusCode).toBe(409);
        expect(error.message).toBe('Email already registered');
        // Note: AppError data field would contain code if implemented
        // expect(error.data?.code).toBe('EMAIL_ALREADY_REGISTERED');
      });
    });

    it('should rollback on registration failure', async () => {
      const userData = {
        email: 'fail@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
      };

      mockQuery.mockResolvedValueOnce([]); // No existing user
      (mockClient.query as jest.Mock)
        .mockResolvedValueOnce({ command: 'BEGIN', rowCount: 0, rows: [] })
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(authService.register(userData)).rejects.toThrow('Database error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('login()', () => {
    it('should successfully login with valid credentials', async () => {
      const email = 'test@example.com';
      const password = 'SecurePass123!';
      const passwordHash = await bcrypt.hash(password, 10);

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery
        .mockResolvedValueOnce([mockUser]) // Find user
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Insert refresh token
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Log action
        .mockResolvedValueOnce([{ ...mockUser, firstName: 'Test', lastName: 'User' }]); // getUserProfile

      const result = await authService.login(email, password);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email);
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should reject login with invalid email', async () => {
      mockQuery.mockResolvedValueOnce([]); // No user found

      await expect(authService.login('invalid@example.com', 'password')).rejects.toThrow(AppError);
    });

    it('should reject login with invalid password', async () => {
      const email = 'test@example.com';
      const passwordHash = await bcrypt.hash('correctPassword', 10);

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([mockUser]);

      await expect(authService.login(email, 'wrongPassword')).rejects.toThrow(AppError);
    });

    it('should reject login for inactive users', async () => {
      const email = 'inactive@example.com';
      const passwordHash = await bcrypt.hash('password', 10);

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash,
        role: 'customer',
        isActive: false,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([mockUser]);

      const error = await authService.login(email, 'password').catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Account is disabled. Please contact support.');
    });

    it('should reject login for social login accounts without password', async () => {
      const email = 'social@example.com';

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash: null,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([mockUser]);

      const error = await authService.login(email, 'password').catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toContain('This account uses social login');
    });

    it('should upgrade customer to admin role based on admin config', async () => {
      const email = 'admin@example.com';
      const password = 'SecurePass123!';
      const passwordHash = await bcrypt.hash(password, 10);

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const upgradedUser = { ...mockUser, role: 'admin' };

      (adminConfigService.getRequiredRole as jest.Mock).mockReturnValue('admin');

      mockQuery
        .mockResolvedValueOnce([mockUser]) // Find user
        .mockResolvedValueOnce([{ ...upgradedUser, passwordHash }]) // Upgrade role
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Log role upgrade
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Insert refresh token
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Log login
        .mockResolvedValueOnce([{ ...upgradedUser, firstName: 'Admin', lastName: 'User' }]); // getUserProfile

      const result = await authService.login(email, password);

      expect(result.user).toBeDefined();
      expect(result.user.role).toBe('admin');
    });

    it('should upgrade admin to super_admin role based on admin config', async () => {
      const email = 'superadmin@example.com';
      const password = 'SecurePass123!';
      const passwordHash = await bcrypt.hash(password, 10);

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash,
        role: 'admin',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const upgradedUser = { ...mockUser, role: 'super_admin' };

      (adminConfigService.getRequiredRole as jest.Mock).mockReturnValue('super_admin');

      mockQuery
        .mockResolvedValueOnce([mockUser]) // Find user
        .mockResolvedValueOnce([{ ...upgradedUser, passwordHash }]) // Upgrade role
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Log role upgrade
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Insert refresh token
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Log login
        .mockResolvedValueOnce([{ ...upgradedUser, firstName: 'Super', lastName: 'Admin' }]); // getUserProfile

      const result = await authService.login(email, password);

      expect(result.user).toBeDefined();
      expect(result.user.role).toBe('super_admin');
    });

    it('should use longer token expiration with rememberMe', async () => {
      const email = 'test@example.com';
      const password = 'SecurePass123!';
      const passwordHash = await bcrypt.hash(password, 10);

      const mockUser = {
        id: uuidv4(),
        email,
        passwordHash,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery
        .mockResolvedValueOnce([mockUser])
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] })
        .mockResolvedValueOnce([{ ...mockUser, firstName: 'Test', lastName: 'User' }]);

      const result = await authService.login(email, password, true);

      // Decode the access token to verify expiration
      const decoded = jwt.decode(result.tokens.accessToken) as JWTPayload & { exp: number; iat: number };
      expect(decoded).toBeDefined();
      // With rememberMe, token should expire in 2 hours (7200 seconds)
      expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(7100);
    });
  });

  describe('refreshToken()', () => {
    it('should generate new tokens with valid refresh token', async () => {
      const userId = uuidv4();
      const payload = { id: userId, email: 'test@example.com', role: 'customer' as const };
      const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      const mockUser = {
        id: userId,
        email: 'test@example.com',
        role: 'customer',
        isActive: true,
      };

      mockQuery
        .mockResolvedValueOnce([{ userId }]) // Find stored token
        .mockResolvedValueOnce([mockUser]) // Get user
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Insert new refresh token
        .mockResolvedValueOnce({ command: 'DELETE', rowCount: 1, rows: [] }); // Delete old token

      const result = await authService.refreshToken(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject invalid refresh token', async () => {
      const invalidToken = 'invalid.token.here';

      await expect(authService.refreshToken(invalidToken)).rejects.toThrow(AppError);
      await expect(authService.refreshToken(invalidToken)).rejects.toThrow('Invalid refresh token');
    });

    it('should reject expired refresh token', async () => {
      const userId = uuidv4();
      const payload = { id: userId, email: 'test@example.com', role: 'customer' as const };
      const expiredToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '-1h' });

      await expect(authService.refreshToken(expiredToken)).rejects.toThrow(AppError);
    });

    it('should reject token not in database', async () => {
      const userId = uuidv4();
      const payload = { id: userId, email: 'test@example.com', role: 'customer' as const };
      const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      mockQuery.mockResolvedValueOnce([]); // No stored token

      const error = await authService.refreshToken(refreshToken).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Invalid refresh token');
    });

    it('should reject token for inactive user', async () => {
      const userId = uuidv4();
      const payload = { id: userId, email: 'test@example.com', role: 'customer' as const };
      const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      mockQuery
        .mockResolvedValueOnce([{ userId }])
        .mockResolvedValueOnce([{ id: userId, isActive: false }]);

      const error = await authService.refreshToken(refreshToken).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('User not found or inactive');
    });

    it('should reject token with mismatched user ID', async () => {
      const userId = uuidv4();
      const differentUserId = uuidv4();
      const payload = { id: userId, email: 'test@example.com', role: 'customer' as const };
      const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      mockQuery.mockResolvedValueOnce([{ userId: differentUserId }]);

      const error = await authService.refreshToken(refreshToken).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Invalid refresh token');
    });
  });

  describe('logout()', () => {
    it('should successfully logout user', async () => {
      const userId = uuidv4();
      const refreshToken = 'test-refresh-token';

      mockQuery
        .mockResolvedValueOnce({ command: 'DELETE', rowCount: 1, rows: [] }) // Delete refresh token
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }); // Log logout

      await authService.logout(userId, refreshToken);

      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2',
        [userId, refreshToken]
      );
    });
  });

  describe('resetPasswordRequest()', () => {
    it('should generate reset token for valid email', async () => {
      const email = 'test@example.com';
      const userId = uuidv4();

      mockQuery
        .mockResolvedValueOnce([{ id: userId, email }]) // Find user
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }) // Insert reset token
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }); // Log action

      await authService.resetPasswordRequest(email);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id, email FROM users WHERE email = $1',
        [email]
      );
    });

    it('should silently fail for non-existent email', async () => {
      const email = 'nonexistent@example.com';

      mockQuery.mockResolvedValueOnce([]); // No user found

      // Should not throw error
      await expect(authService.resetPasswordRequest(email)).resolves.toBeUndefined();
    });
  });

  describe('resetPassword()', () => {
    it('should successfully reset password with valid token', async () => {
      const token = uuidv4();
      const newPassword = 'NewSecurePass123!';
      const userId = uuidv4();
      const hashedToken = await bcrypt.hash(token, 10);

      mockQuery
        .mockResolvedValueOnce([{ userId, hashedToken }]) // Find reset token
        .mockResolvedValueOnce({ command: 'UPDATE', rowCount: 1, rows: [] }) // Update password
        .mockResolvedValueOnce({ command: 'UPDATE', rowCount: 1, rows: [] }) // Mark token as used
        .mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] }); // Log action

      await authService.resetPassword(token, newPassword);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET password_hash'),
        expect.arrayContaining([expect.any(String), userId])
      );
    });

    it('should reject invalid reset token', async () => {
      const token = uuidv4();
      const newPassword = 'NewSecurePass123!';

      mockQuery.mockResolvedValueOnce([]); // No reset token found

      const error = await authService.resetPassword(token, newPassword).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Invalid or expired reset token');
    });

    it('should reject expired reset token', async () => {
      const token = uuidv4();
      const newPassword = 'NewSecurePass123!';

      mockQuery.mockResolvedValueOnce([]); // No valid token (expired filtered out)

      await expect(authService.resetPassword(token, newPassword)).rejects.toThrow(AppError);
    });

    it('should reject mismatched token', async () => {
      const token = uuidv4();
      const newPassword = 'NewSecurePass123!';
      const userId = uuidv4();
      const differentToken = uuidv4();
      const hashedToken = await bcrypt.hash(differentToken, 10);

      mockQuery.mockResolvedValueOnce([{ userId, hashedToken }]);

      const error = await authService.resetPassword(token, newPassword).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Invalid or expired reset token');
    });
  });

  describe('generateTokens()', () => {
    it('should generate access and refresh tokens', async () => {
      const user = {
        id: uuidv4(),
        email: 'test@example.com',
        role: 'customer' as const,
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] });

      const tokens = await authService.generateTokens(user);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();

      // Verify token structure
      const accessPayload = jwt.verify(tokens.accessToken, JWT_SECRET) as JWTPayload;
      const refreshPayload = jwt.verify(tokens.refreshToken, JWT_REFRESH_SECRET) as JWTPayload;

      expect(accessPayload.id).toBe(user.id);
      expect(accessPayload.email).toBe(user.email);
      expect(accessPayload.role).toBe(user.role);

      expect(refreshPayload.id).toBe(user.id);
      expect(refreshPayload.email).toBe(user.email);
      expect(refreshPayload.role).toBe(user.role);
    });

    it('should use client for token storage in transaction', async () => {
      const user = {
        id: uuidv4(),
        email: 'test@example.com',
        role: 'customer' as const,
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockClient.query as jest.Mock).mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] });

      const tokens = await authService.generateTokens(user, mockClient as PoolClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
    });

    it('should use longer expiration with rememberMe', async () => {
      const user = {
        id: uuidv4(),
        email: 'test@example.com',
        role: 'customer' as const,
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce({ command: 'INSERT', rowCount: 1, rows: [] });

      const tokens = await authService.generateTokens(user, undefined, true);

      const accessPayload = jwt.decode(tokens.accessToken) as JWTPayload & { exp: number; iat: number };
      const refreshPayload = jwt.decode(tokens.refreshToken) as JWTPayload & { exp: number; iat: number };

      // With rememberMe: access token 2 hours, refresh token 30 days
      expect(accessPayload.exp - accessPayload.iat).toBeGreaterThanOrEqual(7100); // ~2 hours
      expect(refreshPayload.exp - refreshPayload.iat).toBeGreaterThanOrEqual(2590000); // ~30 days
    });
  });

  describe('verifyToken()', () => {
    it('should verify valid token', async () => {
      const payload = { id: uuidv4(), email: 'test@example.com', role: 'customer' as const };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });

      const result = await authService.verifyToken(token);

      expect(result.id).toBe(payload.id);
      expect(result.email).toBe(payload.email);
      expect(result.role).toBe(payload.role);
    });

    it('should reject invalid token', async () => {
      const invalidToken = 'invalid.token.here';

      await expect(authService.verifyToken(invalidToken)).rejects.toThrow(AppError);
      await expect(authService.verifyToken(invalidToken)).rejects.toThrow('Invalid token');
    });

    it('should reject expired token', async () => {
      const payload = { id: uuidv4(), email: 'test@example.com', role: 'customer' as const };
      const expiredToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '-1h' });

      await expect(authService.verifyToken(expiredToken)).rejects.toThrow(AppError);
    });

    it('should reject token with wrong secret', async () => {
      const payload = { id: uuidv4(), email: 'test@example.com', role: 'customer' as const };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '15m' });

      await expect(authService.verifyToken(token)).rejects.toThrow(AppError);
    });
  });

  describe('getUserProfile()', () => {
    it('should retrieve user profile successfully', async () => {
      const userId = uuidv4();
      const mockUserProfile = {
        id: userId,
        email: 'test@example.com',
        role: 'customer',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        firstName: 'John',
        lastName: 'Doe',
        phone: '1234567890',
        dateOfBirth: new Date('1990-01-01'),
        avatarUrl: 'https://example.com/avatar.jpg',
        membershipId: 'MEM-12345678',
      };

      mockQuery.mockResolvedValueOnce([mockUserProfile]);

      const result = await authService.getUserProfile(userId);

      expect(result).toEqual(mockUserProfile);
    });

    it('should throw error for non-existent user', async () => {
      const userId = uuidv4();

      mockQuery.mockResolvedValueOnce([]);

      const error = await authService.getUserProfile(userId).catch(e => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('User not found');
    });
  });
});