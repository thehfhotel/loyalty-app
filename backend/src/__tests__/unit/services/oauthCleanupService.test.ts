/**
 * OAuthCleanupService Unit Tests
 * Tests periodic cleanup of expired OAuth states
 */

import { OAuthCleanupService } from '../../../services/oauthCleanupService';
import { oauthStateService } from '../../../services/oauthStateService';
import { logger } from '../../../utils/logger';

// Mock oauthStateService
jest.mock('../../../services/oauthStateService', () => ({
  oauthStateService: {
    cleanupExpiredStates: jest.fn(),
    getStateStats: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('OAuthCleanupService', () => {
  let service: OAuthCleanupService;
  let mockCleanupExpiredStates: jest.MockedFunction<typeof oauthStateService.cleanupExpiredStates>;
  let mockGetStateStats: jest.MockedFunction<typeof oauthStateService.getStateStats>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new OAuthCleanupService();
    mockCleanupExpiredStates = oauthStateService.cleanupExpiredStates as jest.MockedFunction<
      typeof oauthStateService.cleanupExpiredStates
    >;
    mockGetStateStats = oauthStateService.getStateStats as jest.MockedFunction<
      typeof oauthStateService.getStateStats
    >;
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  describe('start', () => {
    it('should start periodic cleanup successfully', () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();

      expect(logger.info).toHaveBeenCalledWith(
        '[OAuth Cleanup] Starting periodic cleanup (interval: 300s)'
      );
    });

    it('should run initial cleanup immediately on start', async () => {
      mockCleanupExpiredStates.mockResolvedValue(5);

      service.start();

      // Wait for promises to resolve
      await Promise.resolve();

      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(1);
    });

    it('should not start if already running', () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      service.start(); // Try to start again

      expect(logger.warn).toHaveBeenCalledWith('[OAuth Cleanup] Service already running');
    });

    it('should schedule periodic cleanup at correct interval', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();

      // Initial cleanup
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(1);

      // Advance time by 5 minutes (300000ms)
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(2);

      // Advance time by another 5 minutes
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(3);
    });

    it('should register SIGTERM handler', () => {
      const processOnSpy = jest.spyOn(process, 'on');
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();

      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should register SIGINT handler', () => {
      const processOnSpy = jest.spyOn(process, 'on');
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();

      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });
  });

  describe('stop', () => {
    it('should stop periodic cleanup', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      service.stop();

      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Stopped periodic cleanup');
    });

    it('should prevent further cleanup executions after stop', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(1);

      service.stop();

      // Advance time and verify no more cleanups
      jest.advanceTimersByTime(600000); // 10 minutes
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(1); // Still 1, no new calls
    });

    it('should handle stop when not running', () => {
      service.stop();

      // Should not throw or log
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should clear the cleanup interval', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      const status = service.getStatus();
      expect(status.running).toBe(true);

      service.stop();

      const statusAfterStop = service.getStatus();
      expect(statusAfterStop.running).toBe(false);
    });
  });

  describe('runCleanup', () => {
    it('should log deleted count when states are cleaned', async () => {
      mockCleanupExpiredStates.mockResolvedValue(10);

      service.start();
      await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Cleaned up 10 expired states');
    });

    it('should log debug message when no states are cleaned', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      expect(logger.debug).toHaveBeenCalledWith('[OAuth Cleanup] No expired states to clean up');
    });

    it('should handle cleanup errors gracefully', async () => {
      mockCleanupExpiredStates.mockRejectedValue(new Error('Cleanup failed'));

      service.start();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith('[OAuth Cleanup] Cleanup failed:', expect.any(Error));
    });

    it('should continue running after cleanup error', async () => {
      // First cleanup fails
      mockCleanupExpiredStates.mockRejectedValueOnce(new Error('Cleanup failed'));
      // Second cleanup succeeds
      mockCleanupExpiredStates.mockResolvedValueOnce(5);

      service.start();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalled();

      // Advance to next cleanup
      jest.advanceTimersByTime(300000);
      await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Cleaned up 5 expired states');
    });

    it('should occasionally log state statistics', async () => {
      mockCleanupExpiredStates.mockResolvedValue(5);
      mockGetStateStats.mockResolvedValue({
        total: 10,
        byProvider: { google: 7, line: 3 },
        oldestTimestamp: Date.now() - 300000,
      });

      // Mock Math.random to return value < 0.1 for stats logging
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.05);

      service.start();
      await Promise.resolve();
      await Promise.resolve(); // Extra resolve for stats promise

      expect(mockGetStateStats).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        '[OAuth Cleanup] Current state statistics',
        expect.objectContaining({
          total: 10,
          byProvider: { google: 7, line: 3 },
        })
      );

      Math.random = originalRandom;
    });

    it('should not log stats when random check fails', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      // Mock Math.random to return value >= 0.1
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.5);

      service.start();
      await Promise.resolve();

      expect(mockGetStateStats).not.toHaveBeenCalled();

      Math.random = originalRandom;
    });

    it('should handle stats retrieval errors', async () => {
      mockCleanupExpiredStates.mockResolvedValue(5);
      mockGetStateStats.mockRejectedValue(new Error('Stats failed'));

      // Mock Math.random to trigger stats logging
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.05);

      service.start();
      await Promise.resolve();
      await Promise.resolve(); // Extra resolve for stats promise

      // Should not crash, error is caught in runCleanup
      expect(logger.error).toHaveBeenCalled();

      Math.random = originalRandom;
    });
  });

  describe('getStatus', () => {
    it('should return correct status when running', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      const status = service.getStatus();

      expect(status.running).toBe(true);
      expect(status.intervalMs).toBe(300000); // 5 minutes
      expect(status.nextCleanupIn).toBe(300000);
    });

    it('should return correct status when not running', () => {
      const status = service.getStatus();

      expect(status.running).toBe(false);
      expect(status.intervalMs).toBe(300000);
      expect(status.nextCleanupIn).toBeUndefined();
    });

    it('should update running status after stop', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      expect(service.getStatus().running).toBe(true);

      service.stop();

      expect(service.getStatus().running).toBe(false);
    });

    it('should maintain correct interval value', () => {
      const status = service.getStatus();
      expect(status.intervalMs).toBe(300000); // 5 minutes = 300000ms
    });
  });

  describe('Lifecycle Management', () => {
    it('should handle start-stop-start cycle', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      // First start
      service.start();
      await Promise.resolve();
      expect(service.getStatus().running).toBe(true);

      // Stop
      service.stop();
      expect(service.getStatus().running).toBe(false);

      // Second start
      service.start();
      await Promise.resolve();
      expect(service.getStatus().running).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[OAuth Cleanup] Starting periodic cleanup (interval: 300s)'
      );
    });

    it('should clean up resources on SIGTERM', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      const stopSpy = jest.spyOn(service, 'stop');
      service.start();
      await Promise.resolve();

      // Simulate SIGTERM
      process.emit('SIGTERM');

      expect(stopSpy).toHaveBeenCalled();
    });

    it('should clean up resources on SIGINT', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      const stopSpy = jest.spyOn(service, 'stop');
      service.start();
      await Promise.resolve();

      // Simulate SIGINT
      process.emit('SIGINT');

      expect(stopSpy).toHaveBeenCalled();
    });

    it('should handle multiple SIGTERM calls', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      process.emit('SIGTERM');
      process.emit('SIGTERM'); // Second call

      expect(service.getStatus().running).toBe(false);
    });
  });

  describe('Periodic Execution', () => {
    it('should execute cleanup at regular intervals', async () => {
      mockCleanupExpiredStates.mockResolvedValue(2);

      service.start();
      await Promise.resolve();

      // Initial cleanup
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(1);

      // First interval
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(2);

      // Second interval
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(3);

      // Third interval
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(4);
    });

    it('should maintain consistent interval timing', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();
      await Promise.resolve();

      const initialCalls = mockCleanupExpiredStates.mock.calls.length;

      // Advance by exactly one interval
      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(initialCalls + 1);

      // Advance by half interval (should not trigger)
      jest.advanceTimersByTime(150000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(initialCalls + 1);

      // Complete the interval
      jest.advanceTimersByTime(150000);
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(initialCalls + 2);
    });

    it('should handle cleanup taking longer than interval', async () => {
      let cleanupDelay = 0;
      mockCleanupExpiredStates.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(1), cleanupDelay);
        });
      });

      service.start();

      // First cleanup is quick
      cleanupDelay = 100;
      await Promise.resolve();
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(1);

      // Next cleanup takes longer than interval
      cleanupDelay = 400000; // Longer than 5-minute interval
      jest.advanceTimersByTime(300000);
      await Promise.resolve();

      // Should still trigger next cleanup after interval
      expect(mockCleanupExpiredStates).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from network errors', async () => {
      // First two cleanups fail
      mockCleanupExpiredStates
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValue(5);

      service.start();
      await Promise.resolve();
      expect(logger.error).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(logger.error).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(300000);
      await Promise.resolve();
      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Cleaned up 5 expired states');
    });

    it('should not stop service on repeated errors', async () => {
      mockCleanupExpiredStates.mockRejectedValue(new Error('Persistent error'));

      service.start();

      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(300000);
      }

      expect(service.getStatus().running).toBe(true);
      expect(mockCleanupExpiredStates).toHaveBeenCalled();
    });

    it('should handle unexpected errors during cleanup', async () => {
      mockCleanupExpiredStates.mockImplementation(() => {
        throw new Error('Unexpected synchronous error');
      });

      service.start();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalled();
      expect(service.getStatus().running).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle high cleanup load', async () => {
      // Simulate cleaning many expired states
      mockCleanupExpiredStates.mockResolvedValue(1000);

      service.start();
      await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Cleaned up 1000 expired states');
    });

    it('should handle zero states consistently', async () => {
      mockCleanupExpiredStates.mockResolvedValue(0);

      service.start();

      for (let i = 0; i < 3; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(300000);
      }

      expect(logger.debug).toHaveBeenCalledWith('[OAuth Cleanup] No expired states to clean up');
    });

    it('should handle variable cleanup results', async () => {
      mockCleanupExpiredStates
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(0);

      service.start();

      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(300000);
      }

      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Cleaned up 5 expired states');
      expect(logger.info).toHaveBeenCalledWith('[OAuth Cleanup] Cleaned up 12 expired states');
      expect(logger.debug).toHaveBeenCalledWith('[OAuth Cleanup] No expired states to clean up');
    });
  });
});
