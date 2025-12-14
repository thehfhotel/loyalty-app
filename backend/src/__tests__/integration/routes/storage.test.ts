/**
 * Storage Routes Integration Tests
 * Tests storage statistics and backup management
 *
 * Week 2 Priority - 10-15 tests
 * Coverage Target: ~1-2% contribution
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test mocks require flexible typing */
/* eslint-disable @typescript-eslint/no-unused-vars -- Test setup may have intentionally unused variables */

import request from 'supertest';
import { Express } from 'express';
import routes from '../../../routes/storage';
import { createTestApp } from '../../fixtures';

// Mock dependencies - Service-based mocking
jest.mock('../../../services/storageService', () => ({
  StorageService: {
    getStorageReport: jest.fn(),
    performBackup: jest.fn(),
  },
}));

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    // Admin routes: GET /stats, POST /backup
    const adminPaths = ['/stats', '/backup'];
    const isAdminRoute = adminPaths.some(p => req.path.includes(p));

    req.user = isAdminRoute ? {
      id: 'admin-user-id',
      email: 'admin@example.com',
      role: 'admin',
    } : {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'customer',
    };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => {
    next();
  },
}));

// Import mocked service
import { StorageService } from '../../../services/storageService';

describe('Storage Routes Integration Tests', () => {
  let app: Express;
  const mockStorageService = StorageService as jest.Mocked<typeof StorageService>;

  beforeAll(() => {
    app = createTestApp(routes, '/api/storage');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/storage/stats (Admin)', () => {
    it('should get storage statistics', async () => {
      mockStorageService.getStorageReport.mockResolvedValue({
        storage: {
          totalFiles: 150,
          totalSize: 52428800, // 50 MB
          averageSize: 349525, // ~341 KB
          usagePercent: 5.0,
        },
      });

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.storage.totalFiles).toBe(150);
      expect(response.body.storage.totalSize).toBe(52428800);
      expect(response.body.storage.usagePercent).toBe(5.0);
    });

    it('should return storage statistics with low usage', async () => {
      mockStorageService.getStorageReport.mockResolvedValue({
        storage: {
          totalFiles: 50,
          totalSize: 10485760, // 10 MB
          averageSize: 209715, // ~205 KB
          usagePercent: 1.0,
        },
      });

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.storage.totalFiles).toBe(50);
      expect(response.body.storage.usagePercent).toBe(1.0);
    });

    it('should return storage statistics with high usage', async () => {
      mockStorageService.getStorageReport.mockResolvedValue({
        storage: {
          totalFiles: 1000,
          totalSize: 943718400, // 900 MB
          averageSize: 943718, // ~922 KB
          usagePercent: 90.0,
        },
      });

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.storage.usagePercent).toBe(90.0);
      expect(response.body.storage.totalFiles).toBe(1000);
    });

    it('should handle empty storage', async () => {
      mockStorageService.getStorageReport.mockResolvedValue({
        storage: {
          totalFiles: 0,
          totalSize: 0,
          averageSize: 0,
          usagePercent: 0,
        },
      });

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.storage.totalFiles).toBe(0);
      expect(response.body.storage.totalSize).toBe(0);
      expect(response.body.storage.usagePercent).toBe(0);
    });

    it('should return average file size', async () => {
      mockStorageService.getStorageReport.mockResolvedValue({
        storage: {
          totalFiles: 100,
          totalSize: 104857600, // 100 MB
          averageSize: 1048576, // 1 MB
          usagePercent: 10.0,
        },
      });

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.storage.averageSize).toBe(1048576);
    });

    it('should handle storage service errors', async () => {
      mockStorageService.getStorageReport.mockRejectedValue(
        new Error('Failed to read storage')
      );

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve storage statistics');
    });

    it('should return all storage metrics', async () => {
      mockStorageService.getStorageReport.mockResolvedValue({
        storage: {
          totalFiles: 250,
          totalSize: 262144000, // 250 MB
          averageSize: 1048576, // 1 MB
          usagePercent: 25.0,
        },
      });

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(200);
      expect(response.body.storage).toHaveProperty('totalFiles');
      expect(response.body.storage).toHaveProperty('totalSize');
      expect(response.body.storage).toHaveProperty('averageSize');
      expect(response.body.storage).toHaveProperty('usagePercent');
    });
  });

  describe('POST /api/storage/backup (Admin)', () => {
    it('should trigger manual backup', async () => {
      mockStorageService.performBackup.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/storage/backup');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Backup started successfully');
    });

    it('should start backup asynchronously', async () => {
      mockStorageService.performBackup.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/storage/backup');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('started');
    });

    it('should handle backup initiation without waiting', async () => {
      // Backup runs asynchronously, so response should be immediate
      mockStorageService.performBackup.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(undefined), 1000))
      );

      const startTime = Date.now();
      const response = await request(app)
        .post('/api/storage/backup');
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500); // Should respond quickly, not wait for backup
    });

    it('should return success even if backup will fail later', async () => {
      // Since backup runs asynchronously, endpoint returns success immediately
      mockStorageService.performBackup.mockRejectedValue(
        new Error('Backup process failed')
      );

      const response = await request(app)
        .post('/api/storage/backup');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Backup started successfully');
    });

    it('should handle errors starting backup process', async () => {
      // Simulate error in starting the backup process itself
      mockStorageService.performBackup.mockImplementation(() => {
        throw new Error('Cannot start backup');
      });

      const response = await request(app)
        .post('/api/storage/backup');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to start backup');
    });
  });

  describe('Error Handling', () => {
    it('should handle service unavailable for stats', async () => {
      mockStorageService.getStorageReport.mockRejectedValue(
        new Error('Service temporarily unavailable')
      );

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Failed to retrieve');
    });

    it('should handle database errors', async () => {
      mockStorageService.getStorageReport.mockRejectedValue(
        new Error('Database connection lost')
      );

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(500);
    });

    it('should handle file system errors', async () => {
      mockStorageService.getStorageReport.mockRejectedValue(
        new Error('File system error')
      );

      const response = await request(app)
        .get('/api/storage/stats');

      expect(response.status).toBe(500);
    });
  });
});
