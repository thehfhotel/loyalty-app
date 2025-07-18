import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { JWTPayload, User } from '@hotel-loyalty/shared/types/auth';
import { redisClient } from '../config/redis.js';

export class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  private readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
  private readonly JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
  private readonly JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  private readonly SALT_ROUNDS = 12;

  /**
   * Hash password with bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(user: Pick<User, 'id' | 'email'>, role: 'customer' | 'admin' = 'customer'): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      role,
    };

    return jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    });
  }

  /**
   * Generate JWT refresh token
   */
  generateRefreshToken(userId: string): string {
    const payload = { userId, type: 'refresh' };
    return jwt.sign(payload, this.JWT_REFRESH_SECRET, {
      expiresIn: this.JWT_REFRESH_EXPIRES_IN,
    });
  }

  /**
   * Verify JWT access token
   */
  verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, this.JWT_SECRET) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid or expired access token');
    }
  }

  /**
   * Verify JWT refresh token
   */
  verifyRefreshToken(token: string): { userId: string; type: string } {
    try {
      return jwt.verify(token, this.JWT_REFRESH_SECRET) as { userId: string; type: string };
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Store refresh token in Redis with expiration
   */
  async storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const key = `refresh_token:${userId}`;
    const expiresIn = this.parseTimeToSeconds(this.JWT_REFRESH_EXPIRES_IN);
    
    await redisClient.setex(key, expiresIn, refreshToken);
  }

  /**
   * Validate refresh token from Redis
   */
  async validateRefreshToken(userId: string, refreshToken: string): Promise<boolean> {
    const key = `refresh_token:${userId}`;
    const storedToken = await redisClient.get(key);
    
    return storedToken === refreshToken;
  }

  /**
   * Revoke refresh token (logout)
   */
  async revokeRefreshToken(userId: string): Promise<void> {
    const key = `refresh_token:${userId}`;
    await redisClient.del(key);
  }

  /**
   * Generate password reset token
   */
  generatePasswordResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Store password reset token with expiration (1 hour)
   */
  async storePasswordResetToken(email: string, token: string): Promise<void> {
    const key = `password_reset:${email}`;
    await redisClient.setex(key, 3600, token); // 1 hour expiration
  }

  /**
   * Validate password reset token
   */
  async validatePasswordResetToken(email: string, token: string): Promise<boolean> {
    const key = `password_reset:${email}`;
    const storedToken = await redisClient.get(key);
    
    return storedToken === token;
  }

  /**
   * Remove password reset token after use
   */
  async removePasswordResetToken(email: string): Promise<void> {
    const key = `password_reset:${email}`;
    await redisClient.del(key);
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    
    return authHeader.substring(7); // Remove "Bearer " prefix
  }

  /**
   * Generate secure random session ID
   */
  generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Parse time string to seconds
   */
  private parseTimeToSeconds(time: string): number {
    const match = time.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 900;
    }
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (!/(?=.*[a-z])/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/(?=.*[A-Z])/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/(?=.*\d)/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/(?=.*[@$!%*?&])/.test(password)) {
      errors.push('Password must contain at least one special character (@$!%*?&)');
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if email is in valid format and not disposable
   */
  validateEmail(email: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('Invalid email format');
    }
    
    // Basic disposable email check
    const disposableDomains = [
      '10minutemail.com', 'tempmail.org', 'guerrillamail.com',
      'mailinator.com', 'yopmail.com', 'temp-mail.org'
    ];
    
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && disposableDomains.includes(domain)) {
      errors.push('Disposable email addresses are not allowed');
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export const authService = new AuthService();