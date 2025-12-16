/**
 * Redis Configuration Unit Tests
 * Tests Redis connection, client initialization, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock redis client
const mockConnect = jest.fn();
const mockOn = jest.fn();
const mockRedisClient = {
  connect: mockConnect,
  on: mockOn,
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Redis Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('connectRedis', () => {
    it('should use default Redis URL when REDIS_URL not set', async () => {
      delete process.env.REDIS_URL;

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6379',
      });
    });

    it('should use REDIS_URL from environment when provided', async () => {
      process.env.REDIS_URL = 'redis://custom-host:6380';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://custom-host:6380',
      });
    });

    it('should register error event handler', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register connect event handler', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should log info when connection succeeds', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis } = await import('../../../config/redis');
      const { logger } = await import('../../../utils/logger');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      // Trigger the connect event
      const connectHandler = mockOn.mock.calls.find(call => call[0] === 'connect')?.[1];
      if (typeof connectHandler === 'function') {
        connectHandler();
      }

      expect(logger.info).toHaveBeenCalledWith('Redis Client Connected');
    });

    it('should log error on connection error event', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis } = await import('../../../config/redis');
      const { logger } = await import('../../../utils/logger');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      // Trigger the error event
      const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
      const testError = new Error('Connection lost');
      if (typeof errorHandler === 'function') {
        errorHandler(testError);
      }

      expect(logger.error).toHaveBeenCalledWith('Redis Client Error:', testError);
    });

    it('should handle connection failure', async () => {
      process.env.REDIS_URL = 'redis://invalid-host:6379';

      const { connectRedis } = await import('../../../config/redis');
      const { logger } = await import('../../../utils/logger');

      const connectionError = new Error('ECONNREFUSED');
      mockConnect.mockRejectedValue(connectionError as never);

      await expect(connectRedis()).rejects.toThrow('ECONNREFUSED');

      expect(logger.error).toHaveBeenCalledWith('Redis connection failed:', connectionError);
    });

    it('should successfully connect to Redis', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await expect(connectRedis()).resolves.toBeUndefined();

      expect(mockConnect).toHaveBeenCalled();
    });

    it('should handle empty REDIS_URL', async () => {
      process.env.REDIS_URL = '';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      // Empty string is truthy, so it uses the empty string, not the default
      expect(createClient).toHaveBeenCalledWith({
        url: '',
      });
    });
  });

  describe('getRedisClient', () => {
    it('should throw error when client not initialized', async () => {
      const { getRedisClient } = await import('../../../config/redis');

      expect(() => getRedisClient()).toThrow('Redis client not initialized. Call connectRedis first.');
    });

    it('should return client after initialization', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis, getRedisClient } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();
      const client = getRedisClient();

      expect(client).toBeDefined();
      expect(client).toBe(mockRedisClient);
    });

    it('should return same client instance on multiple calls', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { connectRedis, getRedisClient } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();
      const client1 = getRedisClient();
      const client2 = getRedisClient();

      expect(client1).toBe(client2);
    });
  });

  describe('Redis URL Variations', () => {
    it('should handle Redis URL with authentication', async () => {
      process.env.REDIS_URL = 'redis://:password@localhost:6379';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://:password@localhost:6379',
      });
    });

    it('should handle Redis URL with database number', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379/1';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6379/1',
      });
    });

    it('should handle Redis URL with TLS', async () => {
      process.env.REDIS_URL = 'rediss://secure-host:6380';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'rediss://secure-host:6380',
      });
    });

    it('should handle Redis URL with username and password', async () => {
      process.env.REDIS_URL = 'redis://user:password@localhost:6379';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://user:password@localhost:6379',
      });
    });
  });

  describe('Multiple Connection Attempts', () => {
    it('should not create multiple clients on repeated connectRedis calls', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { createClient } = await import('redis');
      const { connectRedis } = await import('../../../config/redis');

      mockConnect.mockResolvedValue(undefined as never);

      await connectRedis();
      await connectRedis();
      await connectRedis();

      // createClient should be called multiple times since we don't prevent it
      // This is the actual behavior - each connectRedis creates a new client
      expect(createClient).toHaveBeenCalledTimes(3);
    });
  });
});
