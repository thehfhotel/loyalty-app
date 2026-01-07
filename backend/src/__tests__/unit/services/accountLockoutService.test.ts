import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as accountLockoutService from '../../../services/accountLockoutService';

// Define mock type for Redis client methods
type MockRedisMethod = jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

// Mock Redis client
const mockRedis = {
  incr: jest.fn() as MockRedisMethod,
  expire: jest.fn() as MockRedisMethod,
  setEx: jest.fn() as MockRedisMethod,
  ttl: jest.fn() as MockRedisMethod,
  get: jest.fn() as MockRedisMethod,
  del: jest.fn() as MockRedisMethod,
};

jest.mock('../../../config/redis', () => ({
  getRedisClient: () => mockRedis,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('AccountLockoutService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('recordFailedAttempt', () => {
    it('should record a failed attempt and return not locked when under threshold', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await accountLockoutService.recordFailedAttempt('test@example.com');

      expect(result.isLocked).toBe(false);
      expect(result.failedAttempts).toBe(1);
      expect(mockRedis.incr).toHaveBeenCalledWith('failed_attempts:test@example.com');
      expect(mockRedis.expire).toHaveBeenCalled();
    });

    it('should lock account after 5 failed attempts', async () => {
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.setEx.mockResolvedValue('OK');

      const result = await accountLockoutService.recordFailedAttempt('test@example.com');

      expect(result.isLocked).toBe(true);
      expect(result.failedAttempts).toBe(5);
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        'lockout:test@example.com',
        900, // 15 minutes
        'locked'
      );
    });

    it('should fail open on Redis error', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

      const result = await accountLockoutService.recordFailedAttempt('test@example.com');

      expect(result.isLocked).toBe(false);
      expect(result.failedAttempts).toBe(0);
    });
  });

  describe('isLocked', () => {
    it('should return locked status when account is locked', async () => {
      mockRedis.ttl.mockResolvedValue(600); // 10 minutes remaining
      mockRedis.get.mockResolvedValue('3');

      const result = await accountLockoutService.isLocked('test@example.com');

      expect(result.isLocked).toBe(true);
      expect(result.remainingSeconds).toBe(600);
      expect(result.failedAttempts).toBe(3);
    });

    it('should return not locked when TTL is negative', async () => {
      mockRedis.ttl.mockResolvedValue(-2); // Key doesn't exist
      mockRedis.get.mockResolvedValue(null);

      const result = await accountLockoutService.isLocked('test@example.com');

      expect(result.isLocked).toBe(false);
      expect(result.remainingSeconds).toBe(0);
    });

    it('should fail open on Redis error', async () => {
      mockRedis.ttl.mockRejectedValue(new Error('Redis unavailable'));

      const result = await accountLockoutService.isLocked('test@example.com');

      expect(result.isLocked).toBe(false);
    });
  });

  describe('resetAttempts', () => {
    it('should delete lockout and failed attempts keys', async () => {
      mockRedis.del.mockResolvedValue(1);

      await accountLockoutService.resetAttempts('test@example.com');

      expect(mockRedis.del).toHaveBeenCalledWith('failed_attempts:test@example.com');
      expect(mockRedis.del).toHaveBeenCalledWith('lockout:test@example.com');
    });

    it('should not throw on Redis error', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      await expect(accountLockoutService.resetAttempts('test@example.com')).resolves.not.toThrow();
    });
  });

  describe('formatLockoutTime', () => {
    it('should format seconds correctly', () => {
      expect(accountLockoutService.formatLockoutTime(30)).toBe('30 seconds');
      expect(accountLockoutService.formatLockoutTime(1)).toBe('1 second');
    });

    it('should format minutes correctly', () => {
      expect(accountLockoutService.formatLockoutTime(60)).toBe('1 minute');
      expect(accountLockoutService.formatLockoutTime(120)).toBe('2 minutes');
    });

    it('should format minutes and seconds correctly', () => {
      expect(accountLockoutService.formatLockoutTime(90)).toBe('1 minute and 30 seconds');
      expect(accountLockoutService.formatLockoutTime(125)).toBe('2 minutes and 5 seconds');
    });

    it('should handle zero', () => {
      expect(accountLockoutService.formatLockoutTime(0)).toBe('0 seconds');
    });
  });
});
