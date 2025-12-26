/**
 * OAuthService Unit Tests
 * Tests OAuth authentication with Google and LINE providers
 */

// Configure environment before any imports
process.env.JWT_SECRET = 'test-jwt-secret-key-that-is-at-least-sixty-four-characters-long-for-security';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-that-is-at-least-sixty-four-characters-long';

import { describe, expect, jest, beforeEach } from '@jest/globals';
jest.mock('../../../services/loyaltyService');
jest.mock('../../../services/notificationService');
import { oauthService } from '../../../services/oauthService';
import { User } from '../../../types/auth';
import * as database from '../../../config/database';
import { adminConfigService } from '../../../services/adminConfigService';
import { LoyaltyService } from '../../../services/loyaltyService';
import { notificationService } from '../../../services/notificationService';

// Type helper for accessing private OAuth methods in tests
type OAuthServiceWithPrivates = {
  handleGoogleAuth: (profile: unknown) => Promise<{
    user: { id: string; email: string | null; emailVerified: boolean; role: string };
    tokens: { accessToken: string; refreshToken: string };
    isNewUser: boolean;
  }>;
  handleLineAuth: (profile: unknown) => Promise<{
    user: { id: string; email: string | null; emailVerified: boolean; role: string };
    tokens: { accessToken: string; refreshToken: string };
    isNewUser: boolean;
  }>;
  generateTokensForUser: (user: User) => Promise<{
    accessToken: string;
    refreshToken: string;
  }>;
  getRequiredRole: (email: string) => string | null;
};

// Mock passport strategies - we test the handler functions directly
jest.mock('passport');
jest.mock('passport-google-oauth20');
jest.mock('passport-line-auth');
jest.mock('../../../config/database');

// Mock admin config service
jest.mock('../../../services/adminConfigService', () => ({
  adminConfigService: {
    getRequiredRole: jest.fn()
  }
} as never));

// Create mock type for LoyaltyService
const mockLoyaltyService = LoyaltyService as jest.MockedClass<typeof LoyaltyService>;

describe('OAuthService', () => {
  let testUser: { id: string; email: string | null };
  let mockQuery: jest.MockedFunction<typeof database.query>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = database.query as jest.MockedFunction<typeof database.query>;

    // Mock loyalty enrollment to prevent Prisma calls
    (mockLoyaltyService.prototype.ensureUserLoyaltyEnrollment as jest.Mock) = jest
      .fn()
      .mockImplementation(async () => {});

    // Mock notification service
    (notificationService.createDefaultPreferences as jest.Mock) = jest
      .fn()
      .mockResolvedValue(11 as never);

    // Mock test user
    testUser = {
      id: 'test-user-id',
      email: 'oauth-test@example.com'
    };
  });

  describe('Google OAuth Authentication', () => {
    const mockGoogleProfile = {
      id: 'google123',
      displayName: 'Test User',
      name: {
        givenName: 'Test',
        familyName: 'User'
      },
      emails: [
        {
          value: 'googleuser@example.com',
          verified: true
        }
      ],
      photos: [
        {
          value: 'https://example.com/photo.jpg'
        }
      ]
    };

    test('should create new user with Google OAuth', async () => {
      // Mock existing user lookup (empty - new user)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock email-based account lookup (empty - no existing email account)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock user creation
      mockQuery.mockResolvedValueOnce([{
        id: 'new-user-id',
        email: 'googleuser@example.com',
        emailVerified: true,
        role: 'customer',
        isActive: true,
        oauth_provider_unused: 'google',
        oauth_provider_id_unused: 'google123'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-user-id',
        first_name: 'Test',
        last_name: 'User',
        avatar_url: 'https://example.com/photo.jpg',
        membership_id: 'MEMB123'
      }] as never);

      // Mock refresh token INSERT (from authService.generateTokens)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-user-id',
        action: 'oauth_login',
        details: { provider: 'google' }
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(mockGoogleProfile);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('googleuser@example.com');
      expect(result.user.emailVerified).toBe(true);
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.isNewUser).toBe(true);
    });

    test('should authenticate existing Google user', async () => {
      // Mock existing user lookup
      const existingUser = {
        id: 'existing-user-id',
        email: 'googleuser@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google123'
      };

      mockQuery.mockResolvedValueOnce([existingUser] as never);

      // Mock refresh token INSERT (from authService.generateTokens)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([{
        user_id: existingUser.id,
        action: 'oauth_login',
        details: { provider: 'google' }
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(mockGoogleProfile);

      expect(result.user.id).toBe(existingUser.id);
      expect(result.user.email).toBe('googleuser@example.com');
      expect(result.isNewUser).toBe(false);
      expect(result.tokens).toBeDefined();
    });

    test('should update existing user profile from Google data', async () => {
      // Mock existing user lookup
      const existingUser = {
        id: 'existing-user-id',
        email: 'googleuser@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google123'
      };

      // Mock existing profile lookup (empty names)
      mockQuery.mockResolvedValueOnce([existingUser] as never);
      mockQuery.mockResolvedValueOnce([{
        user_id: existingUser.id,
        first_name: '',
        last_name: '',
        avatar_url: null
      }] as never);

      await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(mockGoogleProfile);

      // Verify profile update was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles'),
        expect.arrayContaining(['Test', 'User', 'https://example.com/photo.jpg', existingUser.id] as never)
      );
    });

    test('should preserve local avatar over Google avatar', async () => {
      // Mock existing user with local avatar
      const existingUser = {
        id: 'existing-user-id',
        email: 'googleuser@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google123'
      };

      mockQuery.mockResolvedValueOnce([existingUser] as never);

      // Mock profile UPDATE (Google avatar will be passed but SQL CASE will preserve local)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock refresh token INSERT (from authService.generateTokens)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([] as never);

      await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(mockGoogleProfile);

      // Verify profile update was called with Google avatar in params
      // (SQL CASE logic will preserve local avatar at database level)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_profiles'),
        expect.arrayContaining([existingUser.id, 'Test', 'User', 'https://example.com/photo.jpg'] as never)
      );
    });

    test('should mark email as verified for Google users', async () => {
      // Mock unverified user
      const unverifiedUser = {
        id: 'unverified-user-id',
        email: 'googleuser@example.com',
        email_verified: false,
        role: 'customer',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google123'
      };

      mockQuery.mockResolvedValueOnce([unverifiedUser] as never);
      mockQuery.mockResolvedValueOnce([{
        user_id: unverifiedUser.id,
        first_name: 'Test',
        last_name: 'User',
        avatar_url: null
      }] as never);

      await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(mockGoogleProfile);

      // Verify email verification update
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET email_verified = true'),
        expect.arrayContaining([unverifiedUser.id] as never)
      );
    });

    test('should throw error if Google provides no email', async () => {
      const profileWithoutEmail = {
        ...mockGoogleProfile,
        emails: undefined
      };

      await expect((oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(profileWithoutEmail)).rejects.toThrow(
        'No email provided by Google'
      );
    });

    test('should generate tokens for Google user', async () => {
      // Mock user creation
      mockQuery.mockResolvedValueOnce([{
        id: 'new-user-id',
        email: 'googleuser@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google123'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-user-id',
        first_name: 'Test',
        last_name: 'User',
        avatar_url: 'https://example.com/photo.jpg',
        membership_id: 'MEMB123'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-user-id',
        current_points: 0
      }] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-user-id',
        action: 'oauth_login',
        details: { provider: 'google' }
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(mockGoogleProfile);

      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(typeof result.tokens.accessToken).toBe('string');
      expect(typeof result.tokens.refreshToken).toBe('string');
    });
  });

  describe('LINE OAuth Authentication', () => {
    const mockLineProfile = {
      id: 'line123',
      displayName: 'LINE User',
      pictureUrl: 'https://profile.line-scdn.net/photo.jpg',
      statusMessage: 'Hello from LINE',
      email: 'lineuser@example.com'
    };

    test('should create new user with LINE OAuth and email', async () => {
      // Mock existing user lookup (empty - new user)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock user creation
      mockQuery.mockResolvedValueOnce([{
        id: 'new-line-user-id',
        email: 'lineuser@example.com',
        emailVerified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line123'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-line-user-id',
        first_name: 'LINE',
        last_name: 'User',
        avatar_url: 'https://profile.line-scdn.net/photo.jpg',
        membership_id: 'MEMB124'
      }] as never);

      // Mock refresh token INSERT (from authService.generateTokens)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(mockLineProfile);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('lineuser@example.com');
      expect(result.user.emailVerified).toBe(true);
      expect(result.tokens).toBeDefined();
      expect(result.isNewUser).toBe(true);
    });

    test('should create new user with LINE OAuth without email', async () => {
      const profileWithoutEmail = {
        ...mockLineProfile,
        email: undefined
      };

      // Mock existing user lookup (empty - new user)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock user creation (no email)
      mockQuery.mockResolvedValueOnce([{
        id: 'new-line-no-email-id',
        email: null,
        emailVerified: false,
        role: 'customer',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line123'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'new-line-no-email-id',
        first_name: 'LINE',
        last_name: 'User',
        avatar_url: 'https://profile.line-scdn.net/photo.jpg',
        membership_id: 'MEMB125'
      }] as never);

      // Mock refresh token INSERT (from authService.generateTokens)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(profileWithoutEmail);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBeNull();
      expect(result.user.emailVerified).toBe(false);
      expect(result.tokens).toBeDefined();
      expect(result.isNewUser).toBe(true);
    });

    test('should authenticate existing LINE user', async () => {
      // Mock existing LINE user
      const existingUser = {
        id: 'existing-line-id',
        email: 'lineuser@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line123'
      };

      mockQuery.mockResolvedValueOnce([existingUser] as never);
      mockQuery.mockResolvedValueOnce([{
        user_id: existingUser.id,
        first_name: 'Existing',
        last_name: 'LINE User'
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(mockLineProfile);

      expect(result.user.id).toBe(existingUser.id);
      expect(result.user.email).toBe('lineuser@example.com');
      expect(result.isNewUser).toBe(false);
    });

    test('should update existing LINE user email if previously null', async () => {
      // Mock LINE user without email
      const existingUser = {
        id: 'line-no-email-id',
        email: null,
        emailVerified: false,
        role: 'customer',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line123'
      };

      // Mock existing user lookup
      mockQuery.mockResolvedValueOnce([existingUser] as never);

      // Mock email update - must return array with updated user
      mockQuery.mockResolvedValueOnce([{
        id: existingUser.id,
        email: 'lineuser@example.com',
        emailVerified: true,
        role: 'customer',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }] as never);

      // Mock avatar check query (empty array for no existing profile avatar)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock profile update
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock refresh token INSERT (from authService.generateTokens)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(mockLineProfile);

      expect(result.user.email).toBe('lineuser@example.com');
      expect(result.user.emailVerified).toBe(true);

      // Verify email update was called with correct parameters
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        ['lineuser@example.com', existingUser.id]
      );
    });

    test('should log LINE OAuth login to audit trail', async () => {
      // Mock user creation
      mockQuery.mockResolvedValueOnce([{
        id: 'audit-line-user-id',
        email: 'lineuser@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line123'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'audit-line-user-id',
        first_name: 'LINE',
        last_name: 'User',
        avatar_url: 'https://profile.line-scdn.net/photo.jpg',
        membership_id: 'MEMB126'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'audit-line-user-id',
        current_points: 0
      }] as never);

      // Mock audit log
      mockQuery.mockResolvedValueOnce([{
        user_id: 'audit-line-user-id',
        action: 'oauth_login',
        details: { provider: 'line', lineId: 'line123' }
      }] as never);

      await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(mockLineProfile);

      // Verify audit log was created
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_audit_log'),
        expect.arrayContaining(['audit-line-user-id', 'oauth_login', expect.anything()] as never)
      );
    });
  });

  describe('Admin Role Elevation', () => {

    beforeEach(() => {
      // Mock adminConfigService to return required roles
      (adminConfigService.getRequiredRole as jest.Mock).mockImplementation((email: unknown): string | null => {
        const emailStr = String(email);
        if (emailStr === 'admin@example.com') return 'admin';
        if (emailStr === 'superadmin@example.com') return 'super_admin';
        return null;
      });
    });

    test('should elevate Google user to admin role', async () => {
      const adminProfile = {
        id: 'google-admin',
        displayName: 'Admin User',
        name: { givenName: 'Admin', familyName: 'User' },
        emails: [{ value: 'admin@example.com', verified: true }],
        photos: []
      };

      // Mock user creation with admin role
      mockQuery.mockResolvedValueOnce([{
        id: 'admin-user-id',
        email: 'admin@example.com',
        email_verified: true,
        role: 'admin',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google-admin'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'admin-user-id',
        first_name: 'Admin',
        last_name: 'User',
        avatar_url: null,
        membership_id: 'MEMB127'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'admin-user-id',
        current_points: 0
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(adminProfile);

      expect(result.user.role).toBe('admin');
    });

    test('should elevate Google user to super_admin role', async () => {
      const superAdminProfile = {
        id: 'google-superadmin',
        displayName: 'Super Admin',
        name: { givenName: 'Super', familyName: 'Admin' },
        emails: [{ value: 'superadmin@example.com', verified: true }],
        photos: []
      };

      // Mock user creation with super_admin role
      mockQuery.mockResolvedValueOnce([{
        id: 'super-admin-user-id',
        email: 'superadmin@example.com',
        email_verified: true,
        role: 'super_admin',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google-superadmin'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'super-admin-user-id',
        first_name: 'Super',
        last_name: 'Admin',
        avatar_url: null,
        membership_id: 'MEMB128'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'super-admin-user-id',
        current_points: 0
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(superAdminProfile);

      expect(result.user.role).toBe('super_admin');
    });

    test('should elevate LINE user with email to admin role', async () => {
      const adminProfile = {
        id: 'line-admin',
        displayName: 'LINE Admin',
        pictureUrl: 'https://line.me/admin.jpg',
        email: 'admin@example.com'
      };

      // Mock user creation with admin role
      mockQuery.mockResolvedValueOnce([{
        id: 'line-admin-user-id',
        email: 'admin@example.com',
        email_verified: true,
        role: 'admin',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line-admin'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'line-admin-user-id',
        first_name: 'LINE',
        last_name: 'Admin',
        avatar_url: 'https://line.me/admin.jpg',
        membership_id: 'MEMB129'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'line-admin-user-id',
        current_points: 0
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(adminProfile);

      expect(result.user.role).toBe('admin');
    });

    test('should not elevate LINE user without email', async () => {
      const profileWithoutEmail = {
        id: 'line-user',
        displayName: 'LINE User',
        pictureUrl: 'https://line.me/user.jpg'
      };

      // Mock user creation with default role (no email = no elevation)
      mockQuery.mockResolvedValueOnce([{
        id: 'line-user-id',
        email: null,
        email_verified: false,
        role: 'customer',
        is_active: true,
        oauth_provider: 'line',
        oauth_provider_id: 'line-user'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'line-user-id',
        first_name: 'LINE',
        last_name: 'User',
        avatar_url: 'https://line.me/user.jpg',
        membership_id: 'MEMB130'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'line-user-id',
        current_points: 0
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleLineAuth(profileWithoutEmail);

      expect(result.user.role).toBe('customer');
    });
  });

  describe('Token Generation', () => {
    test('should generate tokens for authenticated user', async () => {
      // Mock full user object for token generation
      const fullUser = {
        id: testUser.id,
        email: testUser.email,
        role: 'customer',
        isActive: true,
        emailVerified: true
      } as User;

      const tokens = await oauthService.generateTokensForUser(fullUser);

      expect(tokens).toBeDefined();
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
      expect(tokens.accessToken.length).toBeGreaterThan(0);
      expect(tokens.refreshToken.length).toBeGreaterThan(0);
    });

    test('should generate different tokens for different users', async () => {
      // Mock two different users
      const user1 = {
        id: 'user1-id',
        email: 'user1@example.com',
        role: 'customer',
        isActive: true,
        emailVerified: true
      } as User;

      const user2 = {
        id: 'user2-id',
        email: 'user2@example.com',
        role: 'customer',
        isActive: true,
        emailVerified: true
      } as User;

      const tokens1 = await oauthService.generateTokensForUser(user1);
      const tokens2 = await oauthService.generateTokensForUser(user2);

      expect(tokens1.accessToken).not.toBe(tokens2.accessToken);
      expect(tokens1.refreshToken).not.toBe(tokens2.refreshToken);
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully during Google auth', async () => {
      // Mock database error
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed') as never);

      const profile = {
        id: 'google-error',
        displayName: 'Error User',
        name: { givenName: 'Error', familyName: 'User' },
        emails: undefined, // This will trigger error
        photos: []
      };

      await expect((oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(profile)).rejects.toThrow();
    });

    test('should handle missing profile data gracefully', async () => {
      const minimalProfile = {
        id: 'google-minimal',
        displayName: 'Minimal User',
        name: { givenName: '', familyName: '' },
        emails: [{ value: 'minimal@example.com', verified: true }],
        photos: []
      };

      // Mock user creation
      mockQuery.mockResolvedValueOnce([{
        id: 'minimal-user-id',
        email: 'minimal@example.com',
        email_verified: true,
        role: 'customer',
        is_active: true,
        oauth_provider: 'google',
        oauth_provider_id: 'google-minimal'
      }] as never);

      // Mock profile creation
      mockQuery.mockResolvedValueOnce([{
        user_id: 'minimal-user-id',
        first_name: '',
        last_name: '',
        avatar_url: null,
        membership_id: 'MEMB131'
      }] as never);

      // Mock loyalty enrollment
      mockQuery.mockResolvedValueOnce([{
        user_id: 'minimal-user-id',
        current_points: 0
      }] as never);

      const result = await (oauthService as unknown as OAuthServiceWithPrivates).handleGoogleAuth(minimalProfile);

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('minimal@example.com');
    });
  });
});
