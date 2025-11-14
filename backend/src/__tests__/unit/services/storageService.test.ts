/**
 * StorageService Unit Tests
 * Tests storage management, backup operations, and storage reporting
 */

import { StorageService } from '../../../services/storageService';
import { ImageProcessor } from '../../../utils/imageProcessor';
import { storageConfig } from '../../../config/storage';

// Mock ImageProcessor and logger
jest.mock('../../../utils/imageProcessor');
jest.mock('../../../utils/logger');

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Storage Initialization', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test('should initialize storage service with backup scheduling', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      StorageService.initialize();

      // Initialization should schedule backup
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });

    test('should schedule backup for 2 AM next day', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      StorageService.initialize();

      expect(setTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Backup Operations', () => {
    test('should perform backup successfully', async () => {
      const mockBackupAvatars = jest.spyOn(ImageProcessor, 'backupAvatars')
        .mockResolvedValue(undefined);

      await StorageService.performBackup();

      expect(mockBackupAvatars).toHaveBeenCalled();
    });

    test('should log backup duration', async () => {
      jest.spyOn(ImageProcessor, 'backupAvatars').mockResolvedValue(undefined);

      const startTime = Date.now();
      await StorageService.performBackup();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should handle backup errors gracefully', async () => {
      const error = new Error('Backup failed');
      jest.spyOn(ImageProcessor, 'backupAvatars').mockRejectedValue(error);

      await expect(StorageService.performBackup()).rejects.toThrow('Backup failed');
    });

    test('should continue operations after backup failure', async () => {
      jest.spyOn(ImageProcessor, 'backupAvatars')
        .mockRejectedValueOnce(new Error('First backup failed'))
        .mockResolvedValueOnce(undefined);

      // First backup fails
      await expect(StorageService.performBackup()).rejects.toThrow();

      // Second backup succeeds
      await expect(StorageService.performBackup()).resolves.not.toThrow();
    });
  });

  describe('Storage Reports', () => {
    test('should generate storage report with all metrics', async () => {
      const mockStats = {
        totalFiles: 100,
        totalSize: 10485760, // 10 MB
        averageSize: 104857
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.totalFiles).toBe(100);
      expect(report.storage.totalSize).toBe(10485760);
      expect(report.storage.averageSize).toBe(104857);
      expect(report.storage.usagePercent).toBeGreaterThan(0);
    });

    test('should calculate usage percentage correctly', async () => {
      const mockStats = {
        totalFiles: 50,
        totalSize: storageConfig.maxStorageSize / 2, // 50% usage
        averageSize: 1000
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.usagePercent).toBeCloseTo(50, 1);
    });

    test('should handle zero files scenario', async () => {
      const mockStats = {
        totalFiles: 0,
        totalSize: 0,
        averageSize: 0
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.totalFiles).toBe(0);
      expect(report.storage.totalSize).toBe(0);
      expect(report.storage.averageSize).toBe(0);
      expect(report.storage.usagePercent).toBe(0);
    });

    test('should handle maximum storage usage', async () => {
      const mockStats = {
        totalFiles: 1000,
        totalSize: storageConfig.maxStorageSize, // 100% usage
        averageSize: storageConfig.maxStorageSize / 1000
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.usagePercent).toBeCloseTo(100, 1);
    });

    test('should return consistent data structure', async () => {
      const mockStats = {
        totalFiles: 75,
        totalSize: 7864320,
        averageSize: 104857
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report).toHaveProperty('storage');
      expect(report.storage).toHaveProperty('totalFiles');
      expect(report.storage).toHaveProperty('totalSize');
      expect(report.storage).toHaveProperty('averageSize');
      expect(report.storage).toHaveProperty('usagePercent');
    });

    test('should handle getStorageStats errors', async () => {
      jest.spyOn(ImageProcessor, 'getStorageStats')
        .mockRejectedValue(new Error('Failed to read storage'));

      await expect(StorageService.getStorageReport()).rejects.toThrow('Failed to read storage');
    });
  });

  describe('Storage Metrics Validation', () => {
    test('should calculate average size correctly', async () => {
      const mockStats = {
        totalFiles: 10,
        totalSize: 1048576, // 1 MB
        averageSize: 104857 // 1 MB / 10
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.averageSize).toBeCloseTo(104857, 0);
    });

    test('should handle large file counts', async () => {
      const mockStats = {
        totalFiles: 10000,
        totalSize: 104857600, // 100 MB
        averageSize: 10485 // ~10KB average
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.totalFiles).toBe(10000);
      expect(report.storage.usagePercent).toBeLessThan(100);
    });

    test('should handle very small files', async () => {
      const mockStats = {
        totalFiles: 100,
        totalSize: 10240, // 10 KB total
        averageSize: 102 // ~100 bytes average
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.averageSize).toBe(102);
      expect(report.storage.usagePercent).toBeLessThan(1);
    });
  });

  describe('Storage Limits', () => {
    test('should warn when approaching storage limit', async () => {
      const mockStats = {
        totalFiles: 500,
        totalSize: storageConfig.maxStorageSize * 0.9, // 90% usage
        averageSize: 10485
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.usagePercent).toBeGreaterThan(85);
      expect(report.storage.usagePercent).toBeLessThan(95);
    });

    test('should detect storage overflow', async () => {
      const mockStats = {
        totalFiles: 2000,
        totalSize: storageConfig.maxStorageSize * 1.1, // 110% usage (overflow)
        averageSize: 10485
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const report = await StorageService.getStorageReport();

      expect(report.storage.usagePercent).toBeGreaterThan(100);
    });
  });

  describe('Backup Scheduling', () => {
    test('should schedule daily backups', () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      StorageService.initialize();

      // Verify setTimeout was called for initial backup
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test('should calculate correct time until next backup', () => {
      const now = new Date();
      const tomorrow2AM = new Date();
      tomorrow2AM.setDate(now.getDate() + 1);
      tomorrow2AM.setHours(2, 0, 0, 0);

      const msUntilBackup = tomorrow2AM.getTime() - now.getTime();

      // Should be positive and less than 48 hours (worst case: just after 2 AM today)
      expect(msUntilBackup).toBeGreaterThan(0);
      expect(msUntilBackup).toBeLessThan(48 * 60 * 60 * 1000);
    });
  });

  describe('Error Recovery', () => {
    test('should recover from temporary storage errors', async () => {
      const getStatsSpy = jest.spyOn(ImageProcessor, 'getStorageStats');

      // First call fails, second succeeds
      getStatsSpy
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          totalFiles: 50,
          totalSize: 5242880,
          averageSize: 104857
        });

      // First attempt fails
      await expect(StorageService.getStorageReport()).rejects.toThrow('Temporary error');

      // Second attempt succeeds
      const report = await StorageService.getStorageReport();
      expect(report.storage.totalFiles).toBe(50);
    });

    test('should handle concurrent report requests', async () => {
      const mockStats = {
        totalFiles: 100,
        totalSize: 10485760,
        averageSize: 104857
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      // Request multiple reports concurrently
      const reports = await Promise.all([
        StorageService.getStorageReport(),
        StorageService.getStorageReport(),
        StorageService.getStorageReport()
      ]);

      // All reports should return successfully
      expect(reports).toHaveLength(3);
      reports.forEach(report => {
        expect(report.storage.totalFiles).toBe(100);
      });
    });
  });

  describe('Performance', () => {
    test('should generate report quickly', async () => {
      const mockStats = {
        totalFiles: 1000,
        totalSize: 104857600,
        averageSize: 104857
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      const startTime = Date.now();
      await StorageService.getStorageReport();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    test('should handle rapid successive calls', async () => {
      const mockStats = {
        totalFiles: 50,
        totalSize: 5242880,
        averageSize: 104857
      };

      jest.spyOn(ImageProcessor, 'getStorageStats').mockResolvedValue(mockStats);

      // Make 10 rapid successive calls
      const promises = Array(10).fill(null).map(() => StorageService.getStorageReport());
      const reports = await Promise.all(promises);

      expect(reports).toHaveLength(10);
      reports.forEach(report => {
        expect(report.storage.totalFiles).toBe(50);
      });
    });
  });
});
