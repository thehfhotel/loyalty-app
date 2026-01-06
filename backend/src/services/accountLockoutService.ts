/**
 * Account Lockout Service
 * Provides brute force protection by tracking failed login attempts
 * and temporarily locking accounts after too many failures.
 */

import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { sanitizeUserId, sanitizeEmail } from '../utils/logSanitizer';

// Configuration
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
const FAILED_ATTEMPT_WINDOW_SECONDS = 60 * 60; // 1 hour window for counting attempts

// Redis key prefixes
const LOCKOUT_KEY_PREFIX = 'lockout:';
const FAILED_ATTEMPTS_KEY_PREFIX = 'failed_attempts:';

interface LockoutStatus {
  isLocked: boolean;
  remainingSeconds: number;
  failedAttempts: number;
}

/**
 * Get Redis key for lockout status
 */
function getLockoutKey(identifier: string): string {
  return `${LOCKOUT_KEY_PREFIX}${identifier}`;
}

/**
 * Get Redis key for failed attempts counter
 */
function getFailedAttemptsKey(identifier: string): string {
  return `${FAILED_ATTEMPTS_KEY_PREFIX}${identifier}`;
}

/**
 * Record a failed login attempt for a user/email
 * If max attempts reached, locks the account
 * @param identifier - User ID or email address
 * @returns Current lockout status
 */
export async function recordFailedAttempt(identifier: string): Promise<LockoutStatus> {
  const redis = getRedisClient();
  const failedKey = getFailedAttemptsKey(identifier);
  const lockoutKey = getLockoutKey(identifier);

  try {
    // Increment failed attempts
    const attemptsResult = await redis.incr(failedKey);
    const attempts = typeof attemptsResult === 'number' ? attemptsResult : parseInt(String(attemptsResult), 10);

    // Set expiry on first attempt
    if (attempts === 1) {
      await redis.expire(failedKey, FAILED_ATTEMPT_WINDOW_SECONDS);
    }

    logger.warn('Failed login attempt recorded', {
      identifier: sanitizeEmail(identifier),
      attempts,
      maxAttempts: MAX_FAILED_ATTEMPTS,
    });

    // Check if we should lock the account
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      // Set lockout
      await redis.setEx(lockoutKey, LOCKOUT_DURATION_SECONDS, 'locked');

      logger.warn('Account locked due to too many failed attempts', {
        identifier: sanitizeEmail(identifier),
        lockoutDuration: LOCKOUT_DURATION_SECONDS,
      });

      return {
        isLocked: true,
        remainingSeconds: LOCKOUT_DURATION_SECONDS,
        failedAttempts: attempts,
      };
    }

    return {
      isLocked: false,
      remainingSeconds: 0,
      failedAttempts: attempts,
    };
  } catch (error) {
    logger.error('Error recording failed attempt', {
      identifier: sanitizeEmail(identifier),
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, don't block login - fail open
    return {
      isLocked: false,
      remainingSeconds: 0,
      failedAttempts: 0,
    };
  }
}

/**
 * Check if an account is currently locked
 * @param identifier - User ID or email address
 * @returns Current lockout status
 */
export async function isLocked(identifier: string): Promise<LockoutStatus> {
  const redis = getRedisClient();
  const lockoutKey = getLockoutKey(identifier);
  const failedKey = getFailedAttemptsKey(identifier);

  try {
    // Check lockout status
    const ttlResult = await redis.ttl(lockoutKey);
    const ttl = typeof ttlResult === 'number' ? ttlResult : parseInt(String(ttlResult), 10);
    const isCurrentlyLocked = ttl > 0;

    // Get current failed attempts
    const attemptsStr = await redis.get(failedKey);
    const failedAttempts = attemptsStr ? parseInt(String(attemptsStr), 10) : 0;

    if (isCurrentlyLocked) {
      logger.debug('Account lockout check', {
        identifier: sanitizeEmail(identifier),
        isLocked: true,
        remainingSeconds: ttl,
      });
    }

    return {
      isLocked: isCurrentlyLocked,
      remainingSeconds: isCurrentlyLocked ? ttl : 0,
      failedAttempts,
    };
  } catch (error) {
    logger.error('Error checking lockout status', {
      identifier: sanitizeEmail(identifier),
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, don't block login - fail open
    return {
      isLocked: false,
      remainingSeconds: 0,
      failedAttempts: 0,
    };
  }
}

/**
 * Reset failed attempts after successful login
 * @param identifier - User ID or email address
 */
export async function resetAttempts(identifier: string): Promise<void> {
  const redis = getRedisClient();
  const failedKey = getFailedAttemptsKey(identifier);
  const lockoutKey = getLockoutKey(identifier);

  try {
    await redis.del(failedKey);
    await redis.del(lockoutKey);

    logger.debug('Failed attempts reset after successful login', {
      identifier: sanitizeEmail(identifier),
    });
  } catch (error) {
    logger.error('Error resetting failed attempts', {
      identifier: sanitizeEmail(identifier),
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-critical error, don't throw
  }
}

/**
 * Get remaining lockout time in a human-readable format
 * @param seconds - Remaining seconds
 * @returns Human-readable string
 */
export function formatLockoutTime(seconds: number): string {
  if (seconds <= 0) return '0 seconds';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
  }

  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  return `${minutes} minute${minutes !== 1 ? 's' : ''} and ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
}

/**
 * Get lockout status for admin/monitoring purposes
 * @param identifier - User ID or email address
 */
export async function getLockoutInfo(identifier: string): Promise<{
  identifier: string;
  status: LockoutStatus;
  maxAttempts: number;
  lockoutDuration: number;
}> {
  const status = await isLocked(identifier);

  return {
    identifier: sanitizeUserId(identifier),
    status,
    maxAttempts: MAX_FAILED_ATTEMPTS,
    lockoutDuration: LOCKOUT_DURATION_SECONDS,
  };
}

// Export configuration for testing
export const config = {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_SECONDS,
  FAILED_ATTEMPT_WINDOW_SECONDS,
};
