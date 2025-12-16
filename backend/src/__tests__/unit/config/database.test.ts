/**
 * Database Configuration Unit Tests
 * Tests database connection, pool management, and query execution
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock pg Pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
      connect: mockConnect,
    })),
  };
});

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Database Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockQuery.mockReset();
    mockConnect.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('connectDatabase', () => {
    it('should throw error when DATABASE_URL is missing', async () => {
      delete process.env.DATABASE_URL;

      const { connectDatabase } = await import('../../../config/database');

      await expect(connectDatabase()).rejects.toThrow('DATABASE_URL environment variable is required');
    });

    it('should successfully connect to database', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      mockQuery.mockResolvedValue({ rows: [{ now: new Date() }], rowCount: 1 } as never);

      await connectDatabase();

      expect(mockQuery).toHaveBeenCalledWith('SELECT NOW()');
      expect(logger.info).toHaveBeenCalledWith('Database connected successfully to PostgreSQL');
    });

    it('should retry connection on failure', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      // Fail twice, succeed on third attempt
      mockQuery
        .mockRejectedValueOnce(new Error('Connection failed') as never)
        .mockRejectedValueOnce(new Error('Connection failed') as never)
        .mockResolvedValueOnce({ rows: [{ now: new Date() }], rowCount: 1 } as never);

      await connectDatabase();

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('Database connected successfully to PostgreSQL');
    });

    it('should throw error after max retry attempts', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      // Always fail
      const connectionError = new Error('Connection failed');
      mockQuery.mockRejectedValue(connectionError as never);

      await expect(connectDatabase()).rejects.toThrow('Connection failed');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledWith('Database connection failed after all attempts:', connectionError);
    });
  });

  describe('getPool', () => {
    it('should throw error when pool not initialized', async () => {
      const { getPool } = await import('../../../config/database');

      expect(() => getPool()).toThrow('Database pool not initialized. Call connectDatabase first.');
    });

    it('should return pool after initialization', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase, getPool } = await import('../../../config/database');

      mockQuery.mockResolvedValue({ rows: [{ now: new Date() }], rowCount: 1 } as never);

      await connectDatabase();
      const pool = getPool();

      expect(pool).toBeDefined();
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase } = await import('../../../config/database');
      mockQuery.mockResolvedValue({ rows: [{ now: new Date() }], rowCount: 1 } as never);

      await connectDatabase();
      jest.clearAllMocks();
    });

    it('should execute query and return rows', async () => {
      const { query } = await import('../../../config/database');

      const expectedRows = [{ id: 1, name: 'Test' }];
      mockQuery.mockResolvedValue({ rows: expectedRows, rowCount: 1 } as never);

      const result = await query('SELECT * FROM users WHERE id = $1', [1]);

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      expect(result).toEqual(expectedRows);
    });

    it('should log query execution details', async () => {
      const { query } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      await query('SELECT NOW()');

      expect(logger.debug).toHaveBeenCalledWith('Executed query', expect.objectContaining({
        text: 'SELECT NOW()',
        rows: 0,
        duration: expect.any(Number),
      }));
    });

    it('should handle query errors', async () => {
      const { query } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      const queryError = new Error('Query execution failed');
      mockQuery.mockRejectedValue(queryError as never);

      await expect(query('INVALID SQL')).rejects.toThrow('Query execution failed');

      expect(logger.error).toHaveBeenCalledWith('Database query error:', {
        text: 'INVALID SQL',
        error: queryError,
      });
    });

    it('should execute query without parameters', async () => {
      const { query } = await import('../../../config/database');

      mockQuery.mockResolvedValue({ rows: [{ count: 5 }], rowCount: 1 } as never);

      const result = await query('SELECT COUNT(*) FROM users');

      expect(mockQuery).toHaveBeenCalledWith('SELECT COUNT(*) FROM users', undefined);
      expect(result).toEqual([{ count: 5 }]);
    });
  });

  describe('queryWithMeta', () => {
    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase } = await import('../../../config/database');
      mockQuery.mockResolvedValue({ rows: [{ now: new Date() }], rowCount: 1 } as never);

      await connectDatabase();
      jest.clearAllMocks();
    });

    it('should return rows and rowCount', async () => {
      const { queryWithMeta } = await import('../../../config/database');

      const expectedRows = [{ id: 1 }, { id: 2 }];
      mockQuery.mockResolvedValue({ rows: expectedRows, rowCount: 2 } as never);

      const result = await queryWithMeta('SELECT * FROM users');

      expect(result).toEqual({
        rows: expectedRows,
        rowCount: 2,
      });
    });

    it('should handle null rowCount', async () => {
      const { queryWithMeta } = await import('../../../config/database');

      mockQuery.mockResolvedValue({ rows: [], rowCount: null } as never);

      const result = await queryWithMeta('SELECT * FROM users');

      expect(result.rowCount).toBe(0);
    });

    it('should log query execution with metadata', async () => {
      const { queryWithMeta } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 } as never);

      await queryWithMeta('SELECT * FROM users WHERE id = $1', [1]);

      expect(logger.debug).toHaveBeenCalledWith('Executed query', expect.objectContaining({
        text: 'SELECT * FROM users WHERE id = $1',
        rows: 1,
        duration: expect.any(Number),
      }));
    });

    it('should handle errors in queryWithMeta', async () => {
      const { queryWithMeta } = await import('../../../config/database');
      const { logger } = await import('../../../utils/logger');

      const queryError = new Error('Query failed');
      mockQuery.mockRejectedValue(queryError as never);

      await expect(queryWithMeta('INVALID SQL')).rejects.toThrow('Query failed');

      expect(logger.error).toHaveBeenCalledWith('Database query error:', {
        text: 'INVALID SQL',
        error: queryError,
      });
    });
  });

  describe('getClient', () => {
    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test_db';

      const { connectDatabase } = await import('../../../config/database');
      mockQuery.mockResolvedValue({ rows: [{ now: new Date() }], rowCount: 1 } as never);

      await connectDatabase();
      jest.clearAllMocks();
    });

    it('should return a client from the pool', async () => {
      const { getClient } = await import('../../../config/database');

      const mockClient = { query: jest.fn(), release: jest.fn() };
      mockConnect.mockResolvedValue(mockClient as never);

      const client = await getClient();

      expect(mockConnect).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });
  });
});
