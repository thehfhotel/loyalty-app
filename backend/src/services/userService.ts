import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { 
  User, 
  RegisterRequest, 
  LoginRequest, 
  AuthResponse,
  PasswordResetRequest,
  PasswordReset 
} from '@hotel-loyalty/shared/types/auth';
import { authService } from './authService.js';
import { emailService } from './emailService.js';
import { logger, securityLogger } from '../utils/logger.js';

export class UserService {
  constructor(private db: Pool) {}

  /**
   * Register a new user
   */
  async registerUser(userData: RegisterRequest): Promise<AuthResponse> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Check if user already exists
      const existingUser = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [userData.email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('User already exists with this email');
      }

      // Validate password strength
      const passwordValidation = authService.validatePasswordStrength(userData.password);
      if (!passwordValidation.valid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Validate email
      const emailValidation = authService.validateEmail(userData.email);
      if (!emailValidation.valid) {
        throw new Error(`Email validation failed: ${emailValidation.errors.join(', ')}`);
      }

      // Hash password
      const hashedPassword = await authService.hashPassword(userData.password);

      // Create user
      const userId = uuidv4();
      const userResult = await client.query(`
        INSERT INTO users (
          id, email, password_hash, first_name, last_name, 
          phone, date_of_birth, role, is_active, email_verified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'customer', true, false)
        RETURNING id, email, first_name, last_name, phone, date_of_birth, 
                  is_active, email_verified, created_at, updated_at
      `, [
        userId,
        userData.email.toLowerCase(),
        hashedPassword,
        userData.firstName,
        userData.lastName,
        userData.phone || null,
        userData.dateOfBirth || null,
      ]);

      const user = userResult.rows[0];

      // Create loyalty profile
      await client.query(`
        INSERT INTO loyalty_profiles (user_id, tier_id, points_balance)
        SELECT $1, id, 0 
        FROM loyalty_tiers 
        WHERE name = 'Bronze'
        LIMIT 1
      `, [userId]);

      await client.query('COMMIT');

      // Generate tokens
      const accessToken = authService.generateAccessToken(user, 'customer');
      const refreshToken = authService.generateRefreshToken(userId);

      // Store refresh token
      await authService.storeRefreshToken(userId, refreshToken);

      // Send verification email (async)
      this.sendVerificationEmail(user.email, userId).catch(error => {
        logger.error('Failed to send verification email:', error);
      });

      securityLogger.info('User registered successfully', {
        userId,
        email: userData.email,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          dateOfBirth: user.date_of_birth ? new Date(user.date_of_birth) : undefined,
          isActive: user.is_active,
          emailVerified: user.email_verified,
          createdAt: new Date(user.created_at),
          updatedAt: new Date(user.updated_at),
        },
        token: accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes in seconds
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Login user
   */
  async loginUser(credentials: LoginRequest): Promise<AuthResponse> {
    try {
      // Get user with password
      const userResult = await this.db.query(`
        SELECT id, email, password_hash, first_name, last_name, phone, 
               date_of_birth, role, is_active, email_verified, 
               created_at, updated_at, last_login
        FROM users 
        WHERE email = $1
      `, [credentials.email.toLowerCase()]);

      if (userResult.rows.length === 0) {
        securityLogger.warn('Login attempt with non-existent email', {
          email: credentials.email,
        });
        throw new Error('Invalid email or password');
      }

      const user = userResult.rows[0];

      // Check if user is active
      if (!user.is_active) {
        securityLogger.warn('Login attempt for inactive user', {
          userId: user.id,
          email: user.email,
        });
        throw new Error('Account is deactivated');
      }

      // Verify password
      const isValidPassword = await authService.verifyPassword(
        credentials.password,
        user.password_hash
      );

      if (!isValidPassword) {
        securityLogger.warn('Login attempt with invalid password', {
          userId: user.id,
          email: user.email,
        });
        throw new Error('Invalid email or password');
      }

      // Update last login
      await this.db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Generate tokens
      const accessToken = authService.generateAccessToken(user, user.role);
      const refreshToken = authService.generateRefreshToken(user.id);

      // Store refresh token
      await authService.storeRefreshToken(user.id, refreshToken);

      securityLogger.info('User logged in successfully', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          dateOfBirth: user.date_of_birth ? new Date(user.date_of_birth) : undefined,
          isActive: user.is_active,
          emailVerified: user.email_verified,
          createdAt: new Date(user.created_at),
          updatedAt: new Date(user.updated_at),
        },
        token: accessToken,
        refreshToken,
        expiresIn: 15 * 60, // 15 minutes in seconds
      };

    } catch (error) {
      logger.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<Pick<AuthResponse, 'token' | 'expiresIn'>> {
    try {
      // Verify refresh token
      const payload = authService.verifyRefreshToken(refreshToken);
      
      // Validate refresh token in Redis
      const isValid = await authService.validateRefreshToken(payload.userId, refreshToken);
      if (!isValid) {
        throw new Error('Invalid refresh token');
      }

      // Get user
      const userResult = await this.db.query(`
        SELECT id, email, role, is_active 
        FROM users 
        WHERE id = $1
      `, [payload.userId]);

      if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        throw new Error('User not found or inactive');
      }

      const user = userResult.rows[0];

      // Generate new access token
      const accessToken = authService.generateAccessToken(user, user.role);

      return {
        token: accessToken,
        expiresIn: 15 * 60, // 15 minutes in seconds
      };

    } catch (error) {
      logger.error('Token refresh error:', error);
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Logout user
   */
  async logoutUser(userId: string): Promise<void> {
    try {
      await authService.revokeRefreshToken(userId);
      
      securityLogger.info('User logged out', {
        userId,
      });
    } catch (error) {
      logger.error('Logout error:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    try {
      // Check if user exists
      const userResult = await this.db.query(
        'SELECT id, email, first_name FROM users WHERE email = $1',
        [request.email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        // Don't reveal if email exists or not
        logger.info('Password reset requested for non-existent email', {
          email: request.email,
        });
        return;
      }

      const user = userResult.rows[0];

      // Generate reset token
      const resetToken = authService.generatePasswordResetToken();
      
      // Store reset token
      await authService.storePasswordResetToken(user.email, resetToken);

      // Send reset email
      await emailService.sendPasswordResetEmail(
        user.email,
        user.first_name,
        resetToken
      );

      securityLogger.info('Password reset requested', {
        userId: user.id,
        email: user.email,
      });

    } catch (error) {
      logger.error('Password reset request error:', error);
      throw error;
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(resetData: PasswordReset): Promise<void> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Get user by reset token (we'll need to implement token validation)
      const userResult = await client.query(
        'SELECT id, email FROM users WHERE email IN (SELECT email FROM password_reset_tokens WHERE token = $1)',
        [resetData.token]
      );

      if (userResult.rows.length === 0) {
        throw new Error('Invalid or expired reset token');
      }

      const user = userResult.rows[0];

      // Validate reset token
      const isValid = await authService.validatePasswordResetToken(user.email, resetData.token);
      if (!isValid) {
        throw new Error('Invalid or expired reset token');
      }

      // Validate new password
      const passwordValidation = authService.validatePasswordStrength(resetData.password);
      if (!passwordValidation.valid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash new password
      const hashedPassword = await authService.hashPassword(resetData.password);

      // Update password
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [hashedPassword, user.id]
      );

      // Remove reset token
      await authService.removePasswordResetToken(user.email);

      // Revoke all refresh tokens for this user
      await authService.revokeRefreshToken(user.id);

      await client.query('COMMIT');

      securityLogger.info('Password reset completed', {
        userId: user.id,
        email: user.email,
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<User> {
    try {
      const userResult = await this.db.query(`
        SELECT id, email, first_name, last_name, phone, date_of_birth,
               is_active, email_verified, created_at, updated_at
        FROM users 
        WHERE id = $1
      `, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];

      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        dateOfBirth: user.date_of_birth ? new Date(user.date_of_birth) : undefined,
        isActive: user.is_active,
        emailVerified: user.email_verified,
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at),
      };

    } catch (error) {
      logger.error('Get user profile error:', error);
      throw error;
    }
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email: string): Promise<User | null> {
    try {
      const userResult = await this.db.query(`
        SELECT id, email, first_name, last_name, phone, date_of_birth,
               is_active, email_verified, created_at, updated_at
        FROM users 
        WHERE email = $1
      `, [email.toLowerCase()]);

      if (userResult.rows.length === 0) {
        return null;
      }

      const user = userResult.rows[0];
      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        dateOfBirth: user.date_of_birth ? new Date(user.date_of_birth) : undefined,
        isActive: user.is_active,
        emailVerified: user.email_verified,
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at),
      };
    } catch (error) {
      logger.error('Find user by email error:', error);
      throw error;
    }
  }

  /**
   * Update OAuth information for existing user
   */
  async updateOAuthInfo(userId: string, provider: string, providerId: string): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, provider) 
        DO UPDATE SET provider_user_id = EXCLUDED.provider_user_id,
                      updated_at = CURRENT_TIMESTAMP
      `, [userId, provider, providerId]);

      logger.info('OAuth info updated', { userId, provider });
    } catch (error) {
      logger.error('Update OAuth info error:', error);
      throw error;
    }
  }

  /**
   * Create user from OAuth data
   */
  async createOAuthUser(userData: {
    email: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
    provider: string;
    providerId: string;
  }): Promise<User> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Create user
      const userId = uuidv4();
      const userResult = await client.query(`
        INSERT INTO users (
          id, email, first_name, last_name, role, is_active, email_verified
        ) VALUES ($1, $2, $3, $4, 'customer', true, $5)
        RETURNING id, email, first_name, last_name, phone, date_of_birth, 
                  is_active, email_verified, created_at, updated_at
      `, [
        userId,
        userData.email.toLowerCase(),
        userData.firstName,
        userData.lastName,
        userData.emailVerified,
      ]);

      const user = userResult.rows[0];

      // Create OAuth account link
      await client.query(`
        INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id)
        VALUES ($1, $2, $3)
      `, [userId, userData.provider, userData.providerId]);

      // Create loyalty profile
      await client.query(`
        INSERT INTO loyalty_profiles (user_id, tier_id, points_balance)
        SELECT $1, id, 0 
        FROM loyalty_tiers 
        WHERE name = 'Bronze'
        LIMIT 1
      `, [userId]);

      await client.query('COMMIT');

      securityLogger.info('OAuth user created', {
        userId,
        email: userData.email,
        provider: userData.provider,
      });

      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        dateOfBirth: user.date_of_birth ? new Date(user.date_of_birth) : undefined,
        isActive: user.is_active,
        emailVerified: user.email_verified,
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at),
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(email: string, token: string): Promise<void> {
    try {
      // Validate verification token
      const isValid = await authService.validatePasswordResetToken(`verify_${email}`, token);
      if (!isValid) {
        throw new Error('Invalid or expired verification token');
      }

      // Update user email verification status
      await this.db.query(
        'UPDATE users SET email_verified = true, updated_at = CURRENT_TIMESTAMP WHERE email = $1',
        [email.toLowerCase()]
      );

      // Remove verification token
      await authService.removePasswordResetToken(`verify_${email}`);

      securityLogger.info('Email verified', { email });

    } catch (error) {
      logger.error('Email verification error:', error);
      throw error;
    }
  }

  /**
   * Send email verification
   */
  private async sendVerificationEmail(email: string, userId: string): Promise<void> {
    try {
      const verificationToken = authService.generatePasswordResetToken();
      
      // Store verification token (reusing password reset storage)
      await authService.storePasswordResetToken(`verify_${email}`, verificationToken);

      await emailService.sendEmailVerification(email, verificationToken);
      
      logger.info('Verification email sent', { email, userId });
    } catch (error) {
      logger.error('Failed to send verification email:', error);
      throw error;
    }
  }
}

import { db } from '../config/database.js';

// Initialize with database pool
export const userService = new UserService(db);