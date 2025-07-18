import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authService } from '../services/authService.js';

describe('AuthService', () => {
  describe('Password Hashing', () => {
    it('should hash password correctly', async () => {
      const password = 'TestPassword123!';
      const hash = await authService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should verify password correctly', async () => {
      const password = 'TestPassword123!';
      const hash = await authService.hashPassword(password);
      
      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
      
      const isInvalid = await authService.verifyPassword('WrongPassword', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('JWT Token Generation', () => {
    it('should generate access token', () => {
      const user = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
      };
      
      const token = authService.generateAccessToken(user, 'customer');
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should generate refresh token', () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      
      const token = authService.generateRefreshToken(userId);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should verify access token', () => {
      const user = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
      };
      
      const token = authService.generateAccessToken(user, 'customer');
      const payload = authService.verifyAccessToken(token);
      
      expect(payload.userId).toBe(user.id);
      expect(payload.email).toBe(user.email);
      expect(payload.role).toBe('customer');
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        authService.verifyAccessToken('invalid-token');
      }).toThrow('Invalid or expired access token');
    });
  });

  describe('Password Validation', () => {
    it('should validate strong password', () => {
      const result = authService.validatePasswordStrength('StrongPass123!');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject weak passwords', () => {
      const weakPasswords = [
        'short',
        'nouppercase123!',
        'NOLOWERCASE123!',
        'NoNumbers!',
        'NoSpecialChars123',
      ];
      
      weakPasswords.forEach(password => {
        const result = authService.validatePasswordStrength(password);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Email Validation', () => {
    it('should validate correct email format', () => {
      const validEmails = [
        'test@example.com',
        'user.name@domain.co.uk',
        'user+tag@example.org',
      ];
      
      validEmails.forEach(email => {
        const result = authService.validateEmail(email);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'invalid-email',
        '@example.com',
        'user@',
        'user@.com',
      ];
      
      invalidEmails.forEach(email => {
        const result = authService.validateEmail(email);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should reject disposable email domains', () => {
      const disposableEmails = [
        'test@10minutemail.com',
        'user@tempmail.org',
        'spam@guerrillamail.com',
      ];
      
      disposableEmails.forEach(email => {
        const result = authService.validateEmail(email);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Disposable email addresses are not allowed');
      });
    });
  });

  describe('Token Extraction', () => {
    it('should extract token from Bearer header', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const authHeader = `Bearer ${token}`;
      
      const extracted = authService.extractTokenFromHeader(authHeader);
      expect(extracted).toBe(token);
    });

    it('should return null for invalid header format', () => {
      const invalidHeaders = [
        undefined,
        '',
        'InvalidFormat token',
        'Bearer',
        'token-without-bearer',
      ];
      
      invalidHeaders.forEach(header => {
        const extracted = authService.extractTokenFromHeader(header);
        expect(extracted).toBeNull();
      });
    });
  });

  describe('Password Reset Token', () => {
    it('should generate password reset token', () => {
      const token = authService.generatePasswordResetToken();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes hex = 64 characters
    });

    it('should generate unique tokens', () => {
      const token1 = authService.generatePasswordResetToken();
      const token2 = authService.generatePasswordResetToken();
      
      expect(token1).not.toBe(token2);
    });
  });

  describe('Session ID Generation', () => {
    it('should generate session ID', () => {
      const sessionId = authService.generateSessionId();
      
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBe(64); // 32 bytes hex = 64 characters
    });

    it('should generate unique session IDs', () => {
      const id1 = authService.generateSessionId();
      const id2 = authService.generateSessionId();
      
      expect(id1).not.toBe(id2);
    });
  });
});