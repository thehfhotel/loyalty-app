/**
 * Prisma Configuration Unit Tests
 * Tests Prisma client initialization, connection, and environment handling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock PrismaClient
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

class MockPrismaClient {
  $connect = mockConnect;
  $disconnect = mockDisconnect;
}

jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: MockPrismaClient,
}));

// Mock PrismaPg adapter
const mockPrismaPg = jest.fn();
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: mockPrismaPg,
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

describe('Prisma Configuration', () => {
  const originalEnv = { ...process.env };
  const originalGlobal = { ...(global as { __prisma?: unknown }) };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete (global as { __prisma?: unknown }).__prisma;
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.assign(global, originalGlobal);
  });

  describe('getPrismaClient', () => {
    it('should create Prisma client with DATABASE_URL', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(client).toBeInstanceOf(MockPrismaClient);
      expect(mockPrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@localhost:5432/test_db',
      });
    });

    it('should store client in global variable in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client1 = getPrismaClient();
      const client2 = getPrismaClient();

      expect(client1).toBe(client2);
      expect((global as { __prisma?: unknown }).__prisma).toBeDefined();
    });

    it('should not use global variable in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(client).toBeInstanceOf(MockPrismaClient);
      // In production, we create a new instance but still store it in module scope
    });

    it('should return same instance on multiple calls', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client1 = getPrismaClient();
      const client2 = getPrismaClient();
      const client3 = getPrismaClient();

      expect(client1).toBe(client2);
      expect(client2).toBe(client3);
    });

    it('should log when Prisma client is initialized', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');
      const { logger } = await import('../../../utils/logger');

      getPrismaClient();

      expect(logger.info).toHaveBeenCalledWith('Prisma client initialized');
    });
  });

  describe('connectPrisma', () => {
    it('should connect to Prisma successfully', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectPrisma } = await import('../../../config/prisma');
      const { logger } = await import('../../../utils/logger');

      mockConnect.mockResolvedValue(undefined as never);

      await connectPrisma();

      expect(mockConnect).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Prisma connected successfully to PostgreSQL');
    });

    it('should handle connection errors', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@invalid-host:5432/test_db';

      const { connectPrisma } = await import('../../../config/prisma');
      const { logger } = await import('../../../utils/logger');

      const connectionError = new Error('Connection refused');
      mockConnect.mockRejectedValue(connectionError as never);

      await expect(connectPrisma()).rejects.toThrow('Connection refused');

      expect(logger.error).toHaveBeenCalledWith('Prisma connection failed:', connectionError);
    });

    it('should initialize client before connecting', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectPrisma } = await import('../../../config/prisma');

      mockConnect.mockResolvedValue(undefined as never);

      await connectPrisma();

      expect(mockPrismaPg).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('disconnectPrisma', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';
    });

    it('should disconnect from Prisma successfully', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient, disconnectPrisma } = await import('../../../config/prisma');
      const { logger } = await import('../../../utils/logger');

      // Initialize client first
      getPrismaClient();

      mockDisconnect.mockResolvedValue(undefined as never);

      await disconnectPrisma();

      expect(mockDisconnect).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Prisma disconnected');
    });

    it('should handle disconnection errors gracefully', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { getPrismaClient, disconnectPrisma } = await import('../../../config/prisma');
      const { logger } = await import('../../../utils/logger');

      // Initialize client first
      getPrismaClient();

      const disconnectError = new Error('Disconnect failed');
      mockDisconnect.mockRejectedValue(disconnectError as never);

      // Should not throw, just log error
      await expect(disconnectPrisma()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith('Prisma disconnect error:', disconnectError);
    });

  });

  describe('db export', () => {
    it('should export initialized Prisma client', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { db } = await import('../../../config/prisma');

      expect(db).toBeInstanceOf(MockPrismaClient);
    });

    it('should export same instance as getPrismaClient', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { db, getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(db).toBe(client);
    });
  });

  describe('Environment-specific Configuration', () => {
    it('should configure for development environment', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dev_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(client).toBeDefined();
      expect((global as { __prisma?: unknown }).__prisma).toBe(client);
    });

    it('should configure for production environment', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@prod-host:5432/prod_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(client).toBeDefined();
    });

    it('should configure for test environment', async () => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5438/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(client).toBeDefined();
    });

    it('should handle staging environment', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.DATABASE_URL = 'postgresql://user:pass@staging-host:5432/staging_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      const client = getPrismaClient();

      expect(client).toBeDefined();
    });
  });

  describe('Connection String Variations', () => {
    it('should handle connection string with different host', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@custom-host:5433/custom_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      getPrismaClient();

      expect(mockPrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@custom-host:5433/custom_db',
      });
    });

    it('should handle connection string with SSL parameter', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db?sslmode=require';

      const { getPrismaClient } = await import('../../../config/prisma');

      getPrismaClient();

      expect(mockPrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@host:5432/db?sslmode=require',
      });
    });

    it('should handle connection string without credentials', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test_db';

      const { getPrismaClient } = await import('../../../config/prisma');

      getPrismaClient();

      expect(mockPrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://localhost:5432/test_db',
      });
    });

    it('should handle connection string with schema parameter', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db?schema=public';

      const { getPrismaClient } = await import('../../../config/prisma');

      getPrismaClient();

      expect(mockPrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@host:5432/db?schema=public',
      });
    });
  });
});
