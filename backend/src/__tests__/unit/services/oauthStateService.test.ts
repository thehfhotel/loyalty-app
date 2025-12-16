/**
 * OAuthStateService Unit Tests
 * Tests OAuth state management with Redis
 */

// Mock Redis client needs to be created before mocking
const mockSetEx = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockScan = jest.fn();

const mockRedisClient = {
  setEx: mockSetEx,
  get: mockGet,
  del: mockDel,
  scan: mockScan,
};

// Mock getRedisClient
jest.mock('../../../config/redis', () => ({
  getRedisClient: () => mockRedisClient,
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock crypto randomUUID - use jest.fn() inline
jest.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { OAuthStateService, OAuthStateData } from '../../../services/oauthStateService';
import { logger } from '../../../utils/logger';

describe('OAuthStateService', () => {
  let service: OAuthStateService;
  let mockStateData: OAuthStateData;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OAuthStateService();

    mockStateData = {
      sessionId: 'session-123',
      userId: 'user-456',
      userAgent: 'Mozilla/5.0',
      timestamp: Date.now(),
      returnUrl: '/dashboard',
      provider: 'google',
      originalUrl: 'https://example.com/auth/google',
      ip: '127.0.0.1',
      secure: true,
      host: 'example.com',
      isPWA: false,
      isStandalone: false,
      platform: 'web',
    };
  });

  describe('createState', () => {
    it('should create and store OAuth state data successfully', async () => {
      mockSetEx.mockResolvedValue('OK');

      const stateKey = await service.createState(mockStateData);

      expect(stateKey).toBe('test-uuid-1234');
      expect(mockSetEx).toHaveBeenCalledWith(
        'oauth:state:google:test-uuid-1234',
        600,
        expect.stringContaining('"provider":"google"')
      );
      expect(logger.debug).toHaveBeenCalledWith(
        '[OAuth State] Created state for google',
        expect.objectContaining({
          stateKey: 'test-uuid-1234',
          provider: 'google',
          expiresIn: 600,
        })
      );
    });

    it('should store state with correct expiration metadata', async () => {
      mockSetEx.mockResolvedValue('OK');
      const startTime = Date.now();

      await service.createState(mockStateData);

      const callArgs = mockSetEx.mock.calls[0];
      const storedData = JSON.parse(callArgs[2] as string);

      expect(storedData).toHaveProperty('createdAt');
      expect(storedData).toHaveProperty('expiresAt');
      expect(new Date(storedData.createdAt).getTime()).toBeGreaterThanOrEqual(startTime);
      expect(new Date(storedData.expiresAt).getTime()).toBeGreaterThan(startTime);
    });

    it('should handle LINE provider state creation', async () => {
      mockSetEx.mockResolvedValue('OK');
      const lineStateData = { ...mockStateData, provider: 'line' as const };

      const stateKey = await service.createState(lineStateData);

      expect(stateKey).toBe('test-uuid-1234');
      expect(mockSetEx).toHaveBeenCalledWith(
        'oauth:state:line:test-uuid-1234',
        600,
        expect.stringContaining('"provider":"line"')
      );
    });

    it('should include PWA context in stored state', async () => {
      mockSetEx.mockResolvedValue('OK');
      const pwaStateData = {
        ...mockStateData,
        isPWA: true,
        isStandalone: true,
        platform: 'ios',
      };

      await service.createState(pwaStateData);

      const callArgs = mockSetEx.mock.calls[0];
      const storedData = JSON.parse(callArgs[2] as string);

      expect(storedData.isPWA).toBe(true);
      expect(storedData.isStandalone).toBe(true);
      expect(storedData.platform).toBe('ios');
    });

    it('should handle Redis setEx errors', async () => {
      mockSetEx.mockRejectedValue(new Error('Redis connection failed'));

      await expect(service.createState(mockStateData)).rejects.toThrow('Failed to create OAuth state');
      expect(logger.error).toHaveBeenCalledWith(
        '[OAuth State] Failed to create state:',
        expect.any(Error)
      );
    });

    it('should use correct expiration time of 10 minutes', async () => {
      mockSetEx.mockResolvedValue('OK');

      await service.createState(mockStateData);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String),
        600, // 10 minutes in seconds
        expect.any(String)
      );
    });
  });

  describe('getState', () => {
    it('should retrieve valid OAuth state data', async () => {
      const storedData = {
        ...mockStateData,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
      mockGet.mockResolvedValue(JSON.stringify(storedData));

      const result = await service.getState('test-uuid-1234', 'google');

      expect(result).toBeDefined();
      expect(result?.provider).toBe('google');
      expect(result?.userAgent).toBe('Mozilla/5.0');
      expect(result).not.toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('expiresAt');
      expect(logger.debug).toHaveBeenCalledWith(
        '[OAuth State] Retrieved state for google',
        expect.objectContaining({
          stateKey: 'test-uuid-1234',
          provider: 'google',
        })
      );
    });

    it('should return null for non-existent state', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.getState('non-existent', 'google');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        '[OAuth State] State not found or expired',
        expect.objectContaining({
          stateKey: 'non-existent',
          provider: 'google',
        })
      );
    });

    it('should return null for expired state', async () => {
      const expiredData = {
        ...mockStateData,
        createdAt: new Date(Date.now() - 700000).toISOString(), // 11+ minutes ago
        expiresAt: new Date(Date.now() - 100000).toISOString(), // expired
      };
      mockGet.mockResolvedValue(JSON.stringify(expiredData));
      mockDel.mockResolvedValue(1);

      const result = await service.getState('test-uuid-1234', 'google');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        '[OAuth State] State expired',
        expect.objectContaining({
          stateKey: 'test-uuid-1234',
          provider: 'google',
        })
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:state:google:test-uuid-1234');
    });

    it('should handle LINE provider state retrieval', async () => {
      const lineStateData = {
        ...mockStateData,
        provider: 'line',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
      mockGet.mockResolvedValue(JSON.stringify(lineStateData));

      const result = await service.getState('test-uuid-1234', 'line');

      expect(result).toBeDefined();
      expect(result?.provider).toBe('line');
      expect(mockRedisClient.get).toHaveBeenCalledWith('oauth:state:line:test-uuid-1234');
    });

    it('should handle invalid JSON data gracefully', async () => {
      mockGet.mockResolvedValue('invalid-json-{]');

      const result = await service.getState('test-uuid-1234', 'google');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[OAuth State] Failed to retrieve state:',
        expect.any(Error)
      );
    });

    it('should handle Redis get errors', async () => {
      mockGet.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.getState('test-uuid-1234', 'google');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[OAuth State] Failed to retrieve state:',
        expect.any(Error)
      );
    });

    it('should preserve PWA context from stored state', async () => {
      const pwaStateData = {
        ...mockStateData,
        isPWA: true,
        isStandalone: true,
        platform: 'android',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
      mockGet.mockResolvedValue(JSON.stringify(pwaStateData));

      const result = await service.getState('test-uuid-1234', 'google');

      expect(result?.isPWA).toBe(true);
      expect(result?.isStandalone).toBe(true);
      expect(result?.platform).toBe('android');
    });
  });

  describe('deleteState', () => {
    it('should delete OAuth state successfully', async () => {
      mockDel.mockResolvedValue(1);

      await service.deleteState('test-uuid-1234', 'google');

      expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:state:google:test-uuid-1234');
      expect(logger.debug).toHaveBeenCalledWith(
        '[OAuth State] Deleted state for google',
        expect.objectContaining({
          stateKey: 'test-uuid-1234',
          provider: 'google',
        })
      );
    });

    it('should handle LINE provider state deletion', async () => {
      mockDel.mockResolvedValue(1);

      await service.deleteState('test-uuid-1234', 'line');

      expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:state:line:test-uuid-1234');
    });

    it('should not throw on Redis deletion errors', async () => {
      mockDel.mockRejectedValue(new Error('Redis connection failed'));

      await expect(service.deleteState('test-uuid-1234', 'google')).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        '[OAuth State] Failed to delete state:',
        expect.any(Error)
      );
    });

    it('should handle deletion of non-existent state', async () => {
      mockDel.mockResolvedValue(0); // 0 keys deleted

      await service.deleteState('non-existent', 'google');

      expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:state:google:non-existent');
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredStates', () => {
    it('should cleanup expired states successfully', async () => {
      const expiredState = {
        ...mockStateData,
        expiresAt: new Date(Date.now() - 100000).toISOString(),
      };
      const validState = {
        ...mockStateData,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };

      // Mock scan returning multiple keys
      mockScan
        .mockResolvedValueOnce({
          cursor: '10',
          keys: ['oauth:state:google:expired-1', 'oauth:state:line:valid-1'],
        })
        .mockResolvedValueOnce({
          cursor: '0',
          keys: ['oauth:state:google:expired-2'],
        });

      // Mock get for each key
      mockGet
        .mockResolvedValueOnce(JSON.stringify(expiredState))
        .mockResolvedValueOnce(JSON.stringify(validState))
        .mockResolvedValueOnce(JSON.stringify(expiredState));

      mockDel.mockResolvedValue(1);

      const deletedCount = await service.cleanupExpiredStates();

      expect(deletedCount).toBe(2); // 2 expired states deleted
      expect(mockRedisClient.del).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('[OAuth State] Cleaned up 2 expired states');
    });

    it('should delete invalid JSON data during cleanup', async () => {
      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['oauth:state:google:invalid-1'],
      });
      mockGet.mockResolvedValueOnce('invalid-json-{]');
      mockDel.mockResolvedValue(1);

      const deletedCount = await service.cleanupExpiredStates();

      expect(deletedCount).toBe(1);
      expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:state:google:invalid-1');
    });

    it('should handle multiple scan iterations', async () => {
      // First scan iteration
      mockScan
        .mockResolvedValueOnce({
          cursor: '10',
          keys: ['oauth:state:google:key-1'],
        })
        .mockResolvedValueOnce({
          cursor: '20',
          keys: ['oauth:state:line:key-2'],
        })
        .mockResolvedValueOnce({
          cursor: '0', // End of scan
          keys: ['oauth:state:google:key-3'],
        });

      mockGet.mockResolvedValue(null); // All keys already expired
      mockDel.mockResolvedValue(1);

      await service.cleanupExpiredStates();

      expect(mockRedisClient.scan).toHaveBeenCalledTimes(3);
      expect(mockRedisClient.scan).toHaveBeenCalledWith('0', {
        MATCH: 'oauth:state:*',
        COUNT: 100,
      });
    });

    it('should return 0 when no expired states found', async () => {
      const validState = {
        ...mockStateData,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };

      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['oauth:state:google:valid-1'],
      });
      mockGet.mockResolvedValueOnce(JSON.stringify(validState));

      const deletedCount = await service.cleanupExpiredStates();

      expect(deletedCount).toBe(0);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should handle Redis scan errors gracefully', async () => {
      mockScan.mockRejectedValue(new Error('Redis scan failed'));

      const deletedCount = await service.cleanupExpiredStates();

      expect(deletedCount).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[OAuth State] Failed to cleanup expired states:',
        expect.any(Error)
      );
    });

    it('should skip keys with missing data', async () => {
      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['oauth:state:google:missing-1', 'oauth:state:line:missing-2'],
      });
      mockGet.mockResolvedValue(null); // Both keys have no data

      const deletedCount = await service.cleanupExpiredStates();

      expect(deletedCount).toBe(0);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('getStateStats', () => {
    it('should return statistics about stored states', async () => {
      const state1 = { ...mockStateData, timestamp: Date.now() - 300000, provider: 'google' };
      const state2 = { ...mockStateData, timestamp: Date.now() - 200000, provider: 'line' };
      const state3 = { ...mockStateData, timestamp: Date.now() - 100000, provider: 'google' };

      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: [
          'oauth:state:google:key-1',
          'oauth:state:line:key-2',
          'oauth:state:google:key-3',
        ],
      });

      mockGet
        .mockResolvedValueOnce(JSON.stringify(state1))
        .mockResolvedValueOnce(JSON.stringify(state2))
        .mockResolvedValueOnce(JSON.stringify(state3));

      const stats = await service.getStateStats();

      expect(stats.total).toBe(3);
      expect(stats.byProvider.google).toBe(2);
      expect(stats.byProvider.line).toBe(1);
      expect(stats.oldestTimestamp).toBe(state1.timestamp);
    });

    it('should handle empty state store', async () => {
      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: [],
      });

      const stats = await service.getStateStats();

      expect(stats.total).toBe(0);
      expect(stats.byProvider.google).toBe(0);
      expect(stats.byProvider.line).toBe(0);
      expect(stats.oldestTimestamp).toBeUndefined();
    });

    it('should skip invalid JSON during stats collection', async () => {
      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['oauth:state:google:valid-1', 'oauth:state:line:invalid-1'],
      });

      mockGet
        .mockResolvedValueOnce(JSON.stringify(mockStateData))
        .mockResolvedValueOnce('invalid-json-{]');

      const stats = await service.getStateStats();

      expect(stats.total).toBe(1); // Only valid state counted
      expect(stats.byProvider.google).toBe(1);
      expect(stats.byProvider.line).toBe(0);
    });

    it('should handle multiple scan iterations for stats', async () => {
      mockScan
        .mockResolvedValueOnce({
          cursor: '10',
          keys: ['oauth:state:google:key-1'],
        })
        .mockResolvedValueOnce({
          cursor: '0',
          keys: ['oauth:state:line:key-2'],
        });

      mockGet
        .mockResolvedValueOnce(JSON.stringify({ ...mockStateData, provider: 'google', timestamp: 1000 }))
        .mockResolvedValueOnce(JSON.stringify({ ...mockStateData, provider: 'line', timestamp: 2000 }));

      const stats = await service.getStateStats();

      expect(stats.total).toBe(2);
      expect(stats.oldestTimestamp).toBe(1000);
    });

    it('should handle Redis errors during stats collection', async () => {
      mockScan.mockRejectedValue(new Error('Redis connection failed'));

      const stats = await service.getStateStats();

      expect(stats.total).toBe(0);
      expect(stats.byProvider.google).toBe(0);
      expect(stats.byProvider.line).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[OAuth State] Failed to get stats:',
        expect.any(Error)
      );
    });

    it('should skip keys with missing data during stats', async () => {
      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['oauth:state:google:key-1', 'oauth:state:line:key-2'],
      });

      mockGet
        .mockResolvedValueOnce(JSON.stringify(mockStateData))
        .mockResolvedValueOnce(null); // Missing data

      const stats = await service.getStateStats();

      expect(stats.total).toBe(1); // Only the valid one counted
    });

    it('should correctly identify oldest timestamp across providers', async () => {
      const now = Date.now();
      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: [
          'oauth:state:google:key-1',
          'oauth:state:line:key-2',
          'oauth:state:google:key-3',
        ],
      });

      mockGet
        .mockResolvedValueOnce(JSON.stringify({ ...mockStateData, timestamp: now - 500 }))
        .mockResolvedValueOnce(JSON.stringify({ ...mockStateData, timestamp: now - 1000 })) // Oldest
        .mockResolvedValueOnce(JSON.stringify({ ...mockStateData, timestamp: now - 200 }));

      const stats = await service.getStateStats();

      expect(stats.oldestTimestamp).toBe(now - 1000);
    });
  });

  describe('Error Recovery', () => {
    it('should handle partial Redis failures during cleanup', async () => {
      const expiredState = {
        ...mockStateData,
        expiresAt: new Date(Date.now() - 100000).toISOString(),
      };

      mockScan.mockResolvedValueOnce({
        cursor: '0',
        keys: ['oauth:state:google:key-1', 'oauth:state:line:key-2'],
      });

      mockGet
        .mockResolvedValueOnce(JSON.stringify(expiredState))
        .mockResolvedValueOnce(JSON.stringify(expiredState));

      // First deletion succeeds, second fails but deletion counter still increments
      mockDel
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      const deletedCount = await service.cleanupExpiredStates();

      expect(deletedCount).toBe(2); // Both expired states are counted
    });

    it('should handle network timeouts gracefully', async () => {
      mockGet.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Network timeout')), 100);
        });
      });

      const result = await service.getState('test-uuid-1234', 'google');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
