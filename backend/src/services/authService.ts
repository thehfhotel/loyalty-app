import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { query, getClient } from '../config/database';
// import { getRedisClient } from '../config/redis'; // Unused
import { AppError } from '../middleware/errorHandler';
import { User, JWTPayload, AuthTokens } from '../types/auth';
import { logger } from '../utils/logger';
import { sanitizeEmail, sanitizeLogValue } from '../utils/logSanitizer';
import { adminConfigService } from './adminConfigService';
import { loyaltyService } from './loyaltyService';
import { membershipIdService } from './membershipIdService';
import { notificationService } from './notificationService';
import { getRandomEmojiAvatar, generateEmojiAvatarUrl } from '../utils/emojiUtils';
import { userService } from './userService';

// Cryptographic secrets - NO fallback defaults for security
// Environment validation is enforced by config/environment.ts
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_EXPIRE = '15m';
const REFRESH_TOKEN_EXPIRE = '7d';

// Startup validation - fail fast if secrets are not configured
if (!JWT_SECRET || JWT_SECRET.length < 64) {
  logger.error('🔐 Security Error: JWT_SECRET must be at least 64 characters');
  throw new Error('JWT_SECRET must be configured and at least 64 characters long');
}

if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET.length < 64) {
  logger.error('🔐 Security Error: JWT_REFRESH_SECRET must be at least 64 characters');
  throw new Error('JWT_REFRESH_SECRET must be configured and at least 64 characters long');
}

export class AuthService {
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Check if user exists
      const existingUser = await query<User>(
        'SELECT * FROM users WHERE email = $1',
        [data.email]
      );

      if (existingUser.length > 0) {
        throw new AppError(409, 'Email already registered', { code: 'EMAIL_ALREADY_REGISTERED' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(data.password, 10);

      // Generate unique membership ID
      const membershipId = await membershipIdService.generateUniqueMembershipId();

      // Generate random emoji avatar for new user
      const randomEmoji = getRandomEmojiAvatar();
      const emojiAvatarUrl = generateEmojiAvatarUrl(randomEmoji);

      // Create user
      const [user] = await client.query<User>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [data.email, passwordHash]
      ).then(res => res.rows);

      if (!user) {
        throw new AppError(500, 'Failed to create user');
      }

      // Create user profile with membership ID and emoji avatar
      await client.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, phone, membership_id, avatar_url) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, data.firstName, data.lastName, data.phone, membershipId, emojiAvatarUrl]
      );

      // codeql[js/log-injection] - Values sanitized via sanitizeLogValue/sanitizeEmail (removes newlines/control chars)
      logger.info(`User registered with membership ID: ${sanitizeLogValue(membershipId)}, emoji: ${sanitizeLogValue(randomEmoji)} (email: ${sanitizeEmail(data.email)})`);

      // Generate tokens (pass client for transaction)
      const tokens = await this.generateTokens(user, client);

      // Log registration
      await this.logUserAction(user.id, 'register', { email: data.email }, client);

      await client.query('COMMIT');

      // After transaction commit - these use separate connections and require the user to exist
      // Create default notification preferences (non-blocking, trigger is fallback)
      try {
        await notificationService.createDefaultPreferences(user.id);
      } catch (notifError) {
        // Log error but don't fail registration - trigger will create preferences
        logger.error('Failed to create notification preferences:', notifError);
      }

      // Auto-enroll in loyalty program
      await loyaltyService.ensureUserLoyaltyEnrollment(user.id);

      // Send registration verification email (non-blocking, don't fail registration if email fails)
      try {
        await userService.initiateRegistrationVerification(user.id, data.email);
      } catch (emailError) {
        // Log error but don't fail registration
        logger.error('Failed to send registration verification email:', emailError);
      }

      // Get complete user profile including avatar (even though avatar will be null for new users)
      const userProfile = await this.getUserProfile(user.id);

      return { user: userProfile, tokens };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async login(email: string, password: string, rememberMe = false): Promise<{ user: User; tokens: AuthTokens }> {
    // Find user
    const [user] = await query<User & { passwordHash: string | null }>(
      `SELECT id, email, password_hash AS "passwordHash", role, is_active AS "isActive", 
              email_verified AS "emailVerified", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE email = $1`,
      [email]
    );

    if (!user) {
      // In development, provide helpful error messages
      // In production, use generic message to prevent account enumeration
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const errorMessage = isDevelopment
        ? 'No account found with this email address. Please check your email or register a new account.'
        : 'Invalid email or password';
      throw new AppError(401, errorMessage);
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AppError(403, 'Account is disabled. Please contact support.');
    }

    // Handle accounts created via social login that don't have a password
    if (!user.passwordHash) {
      throw new AppError(
        400,
        'This account uses social login. Please sign in with Google/LINE or reset your password to set one.'
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const errorMessage = isDevelopment
        ? 'Incorrect password. Please try again or use "Forgot Password" to reset.'
        : 'Invalid email or password';
      throw new AppError(401, errorMessage);
    }

    // Check if email should have elevated role and update if necessary
    let updatedUser = user;
    const requiredRole = adminConfigService.getRequiredRole(email);
    
    if (requiredRole && user.role === 'customer') {
      // codeql[js/log-injection] - Values sanitized via sanitizeEmail/sanitizeLogValue
      logger.info(`Upgrading user ${sanitizeEmail(email)} to ${sanitizeLogValue(requiredRole)} role based on admin config`);

      // Update user role
      const [upgradedUser] = await query<User & { passwordHash: string }>(
        `UPDATE users SET role = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, password_hash AS "passwordHash", role, is_active AS "isActive",
                   email_verified AS "emailVerified", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [requiredRole, user.id]
      );

      if (!upgradedUser) {
        throw new AppError(500, 'Failed to upgrade user role');
      }

      updatedUser = upgradedUser;
      
      // Log role upgrade
      await this.logUserAction(user.id, 'role_upgrade', { 
        oldRole: 'customer', 
        newRole: requiredRole, 
        reason: 'admin_config_match' 
      });
    } else if (requiredRole && user.role === 'admin' && requiredRole === 'super_admin') {
      // Handle upgrade from admin to super_admin
      // codeql[js/log-injection] - Email sanitized via sanitizeEmail
      logger.info(`Upgrading user ${sanitizeEmail(email)} from admin to super_admin role based on admin config`);

      const [upgradedUser] = await query<User & { passwordHash: string }>(
        `UPDATE users SET role = 'super_admin', updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, password_hash AS "passwordHash", role, is_active AS "isActive",
                   email_verified AS "emailVerified", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [user.id]
      );

      if (!upgradedUser) {
        throw new AppError(500, 'Failed to upgrade user role');
      }

      updatedUser = upgradedUser;
      
      // Log role upgrade
      await this.logUserAction(user.id, 'role_upgrade', { 
        oldRole: 'admin', 
        newRole: 'super_admin', 
        reason: 'admin_config_precedence' 
      });
    }

    // Generate tokens with updated user data (pass rememberMe parameter)
    const tokens = await this.generateTokens(updatedUser, undefined, rememberMe);

    // Log login
    await this.logUserAction(updatedUser.id, 'login', { email });

    // Auto-enroll in loyalty program (ensure enrollment on every login)
    await loyaltyService.ensureUserLoyaltyEnrollment(updatedUser.id);

    // Get complete user profile including avatar
    const userProfile = await this.getUserProfile(updatedUser.id);
    
    return { user: userProfile, tokens };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET!) as JWTPayload;

      // Check if token exists in database
      const [storedToken] = await query<{ userId: string }>(
        'SELECT user_id AS "userId" FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
        [refreshToken]
      );

      if (storedToken?.userId !== payload.id) {
        throw new AppError(401, 'Invalid refresh token');
      }

      // Get user
      const [user] = await query<User>(
        `SELECT id, email, role, is_active AS "isActive" 
         FROM users WHERE id = $1`,
        [payload.id]
      );

      if (!user?.isActive) {
        throw new AppError(401, 'User not found or inactive');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      // Delete old refresh token
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

      return tokens;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError(401, 'Invalid refresh token');
      }
      throw error;
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    // Delete refresh token
    await query('DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2', [
      userId,
      refreshToken,
    ]);

    // Log logout
    await this.logUserAction(userId, 'logout');
  }

  async resetPasswordRequest(email: string): Promise<void> {
    const [user] = await query<User>('SELECT id, email FROM users WHERE email = $1', [email]);

    if (!user) {
      // Don't reveal if email exists
      // codeql[js/log-injection] - Email sanitized via sanitizeEmail
      logger.info('Password reset requested for non-existent email:', sanitizeEmail(email));
      return;
    }

    // Generate reset token
    const resetToken = uuidv4();
    const hashedToken = await bcrypt.hash(resetToken, 10);

    // Store token (expires in 1 hour)
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) 
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, hashedToken]
    );

    // TODO: Send email with reset link containing resetToken
    // codeql[js/log-injection] - Email sanitized via sanitizeEmail
    logger.info('Password reset token generated for:', sanitizeEmail(email));
    // Note: Reset token should not be logged in production - this is only for development debugging
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Reset token generated (dev only)');
    }

    await this.logUserAction(user.id, 'password_reset_request');
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Find valid token
    const [resetToken] = await query<{ userId: string; hashedToken: string }>(
      `SELECT user_id AS "userId", token AS "hashedToken" 
       FROM password_reset_tokens 
       WHERE expires_at > NOW() AND used = false 
       ORDER BY created_at DESC 
       LIMIT 1`,
      []
    );

    if (!resetToken) {
      throw new AppError(400, 'Invalid or expired reset token');
    }

    // Verify token
    const isValidToken = await bcrypt.compare(token, resetToken.hashedToken);
    if (!isValidToken) {
      throw new AppError(400, 'Invalid or expired reset token');
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      resetToken.userId,
    ]);

    // Mark token as used
    await query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [
      resetToken.hashedToken,
    ]);

    await this.logUserAction(resetToken.userId, 'password_reset_complete');
  }

    async generateTokens(user: User, client?: PoolClient, rememberMe = false): Promise<AuthTokens> {
    const payload: JWTPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    // Use longer token expiration times for "Remember Me"
    const accessTokenExpire = rememberMe ? '2h' : ACCESS_TOKEN_EXPIRE; // 2 hours vs 15 minutes
    const refreshTokenExpire = rememberMe ? '30d' : REFRESH_TOKEN_EXPIRE; // 30 days vs 7 days
    const refreshTokenDbInterval = rememberMe ? '30 days' : '7 days';

    const accessToken = jwt.sign(payload, JWT_SECRET!, {
      expiresIn: accessTokenExpire,
    });

    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET!, {
      expiresIn: refreshTokenExpire,
    });

    // Store refresh token with appropriate expiration
    if (client) {
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at) 
         VALUES ($1, $2, NOW() + INTERVAL '${refreshTokenDbInterval}')`,
        [user.id, refreshToken]
      );
    } else {
      await query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at) 
         VALUES ($1, $2, NOW() + INTERVAL '${refreshTokenDbInterval}')`,
        [user.id, refreshToken]
      );
    }

    return { accessToken, refreshToken };
  }

    private async logUserAction(
    userId: string,
    action: string,
    details: Record<string, unknown> = {},
        client?: PoolClient
  ): Promise<void> {
    if (client) {
      await client.query(
        'INSERT INTO user_audit_log (user_id, action, details) VALUES ($1, $2, $3)',
        [userId, action, details]
      );
    } else {
      await query(
        'INSERT INTO user_audit_log (user_id, action, details) VALUES ($1, $2, $3)',
        [userId, action, details]
      );
    }
  }

  async verifyToken(token: string): Promise<JWTPayload> {
    try {
      return jwt.verify(token, JWT_SECRET!) as JWTPayload;
    } catch {
      throw new AppError(401, 'Invalid token');
    }
  }

  async getUserProfile(userId: string): Promise<User> {
    const [user] = await query<User>(
      `SELECT
        u.id,
        u.email,
        u.role,
        u.is_active AS "isActive",
        u.email_verified AS "emailVerified",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",
        u.oauth_provider AS "oauthProvider",
        up.first_name AS "firstName",
        up.last_name AS "lastName",
        up.phone,
        up.date_of_birth AS "dateOfBirth",
        up.avatar_url AS "avatarUrl",
        up.membership_id AS "membershipId"
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    return user;
  }
}

// Export singleton instance for use in tests and other services
export const authService = new AuthService();
