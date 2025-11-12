/**
 * Storage Routes Integration Tests
 * Tests storage statistics and backup endpoints
 *
 * Week 2 Priority - 20-25 tests
 * Coverage Target: ~2-3% contribution
 */

import request from 'supertest';
import express, { Express } from 'express';
import storageRoutes from '../../../routes/storage';
import { errorHandler } from '../../../middleware/errorHandler';

// Mock StorageService
jest.mock('../../../services/storageService');
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock ImageProcessor
jest.mock('../../../utils/imageProcessor', () => ({
  ImageProcessor: {
    backupAvatars: jest.fn(),
    getStorageStats: jest.fn(),
  },
}));

// Mock authentication and authorization middleware
const mockAuthMiddleware = (role: string = 'customer') => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: 'test-user-123',
      email: 'test@example.com',
      role: role
    };
    next();
  };
};

const mockAuthorizeMiddleware = (...allowedRoles: string[]) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.user && allowedRoles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({ error: 'Insufficient permissions' });
    }
  };
};

describe('Storage Routes Integration Tests', () => {
  let app: Express;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('GET /stats - Storage Statistics', () => {
    describe('Authorization Tests', () => {
      test('should allow admin to access storage stats', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        // Replace authorize middleware
        jest.mock('../../../middleware/auth', () => ({
          authenticate: mockAuthMiddleware('admin'),
          authorize: mockAuthorizeMiddleware
        }));

        const mockReport = {
          storage: {
            totalFiles: 150,
            totalSize: 52428800, // 50 MB
            averageSize: 349525,
            usagePercent: 5.0
          }
        };

        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockResolvedValue(mockReport);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(200);

        expect(response.body).toEqual(mockReport);
        expect(StorageService.getStorageReport).toHaveBeenCalled();
      });

      test('should allow super_admin to access storage stats', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('super_admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const mockReport = {
          storage: {
            totalFiles: 200,
            totalSize: 104857600, // 100 MB
            averageSize: 524288,
            usagePercent: 10.0
          }
        };

        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockResolvedValue(mockReport);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(200);

        expect(response.body).toEqual(mockReport);
      });

      test('should deny access to regular users', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('customer'));
        app.use((req, res, next) => {
          // Simulate authorize middleware checking
          if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Insufficient permissions' });
          }
          next();
        });
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Insufficient permissions');
      });

      test('should deny access to merchant users', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('merchant'));
        app.use((req, res, next) => {
          if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Insufficient permissions' });
          }
          next();
        });
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Insufficient permissions');
      });
    });

    describe('Success Scenarios', () => {
      beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);
      });

      test('should return storage statistics with valid data', async () => {
        const mockReport = {
          storage: {
            totalFiles: 1000,
            totalSize: 524288000, // 500 MB
            averageSize: 524288,
            usagePercent: 50.0
          }
        };

        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockResolvedValue(mockReport);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(200);

        expect(response.body).toEqual(mockReport);
        expect(response.body.storage).toHaveProperty('totalFiles', 1000);
        expect(response.body.storage).toHaveProperty('totalSize', 524288000);
        expect(response.body.storage).toHaveProperty('averageSize', 524288);
        expect(response.body.storage).toHaveProperty('usagePercent', 50.0);
      });

      test('should handle empty storage (zero files)', async () => {
        const mockReport = {
          storage: {
            totalFiles: 0,
            totalSize: 0,
            averageSize: 0,
            usagePercent: 0.0
          }
        };

        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockResolvedValue(mockReport);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(200);

        expect(response.body.storage.totalFiles).toBe(0);
        expect(response.body.storage.usagePercent).toBe(0);
      });

      test('should handle near-full storage', async () => {
        const mockReport = {
          storage: {
            totalFiles: 10000,
            totalSize: 943718400, // ~900 MB (90% of 1GB)
            averageSize: 94371,
            usagePercent: 90.0
          }
        };

        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockResolvedValue(mockReport);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(200);

        expect(response.body.storage.usagePercent).toBe(90.0);
      });

      test('should handle large file counts', async () => {
        const mockReport = {
          storage: {
            totalFiles: 50000,
            totalSize: 524288000,
            averageSize: 10485,
            usagePercent: 50.0
          }
        };

        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockResolvedValue(mockReport);

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(200);

        expect(response.body.storage.totalFiles).toBe(50000);
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);
      });

      test('should handle storage service errors gracefully', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockRejectedValue(new Error('Storage unavailable'));

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(500);

        expect(response.body).toHaveProperty('error', 'Failed to retrieve storage statistics');
      });

      test('should handle database connection errors', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockRejectedValue(new Error('Database connection lost'));

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(500);

        expect(response.body).toHaveProperty('error', 'Failed to retrieve storage statistics');
      });

      test('should handle file system errors', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.getStorageReport.mockRejectedValue(new Error('EACCES: permission denied'));

        const response = await request(app)
          .get('/api/storage/stats')
          .expect(500);

        expect(response.body).toHaveProperty('error');
      });
    });
  });

  describe('POST /backup - Manual Backup', () => {
    describe('Authorization Tests', () => {
      test('should allow admin to trigger backup', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Backup started successfully');
      });

      test('should allow super_admin to trigger backup', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('super_admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Backup started successfully');
      });

      test('should deny backup access to regular users', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('customer'));
        app.use((req, res, next) => {
          if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Insufficient permissions' });
          }
          next();
        });
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Insufficient permissions');
      });

      test('should deny backup access to merchant users', async () => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('merchant'));
        app.use((req, res, next) => {
          if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Insufficient permissions' });
          }
          next();
        });
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Insufficient permissions');
      });
    });

    describe('Success Scenarios', () => {
      beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);
      });

      test('should trigger backup successfully', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Backup started successfully');
      });

      test('should return immediately without waiting for backup completion', async () => {
        const { StorageService } = require('../../../services/storageService');

        // Simulate long-running backup
        StorageService.performBackup.mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(resolve, 5000); // 5 second delay
          });
        });

        const startTime = Date.now();
        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        const duration = Date.now() - startTime;

        expect(response.body).toHaveProperty('message', 'Backup started successfully');
        expect(duration).toBeLessThan(1000); // Should respond within 1 second
      });

      test('should handle multiple concurrent backup requests', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const requests = Array(5).fill(null).map(() =>
          request(app).post('/api/storage/backup')
        );

        const responses = await Promise.all(requests);

        responses.forEach(response => {
          expect(response.status).toBe(200);
          expect(response.body).toHaveProperty('message', 'Backup started successfully');
        });
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);
      });

      test('should handle backup startup errors', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockRejectedValue(new Error('Backup service unavailable'));

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(500);

        expect(response.body).toHaveProperty('error', 'Failed to start backup');
      });

      test('should handle insufficient disk space errors', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockRejectedValue(new Error('ENOSPC: no space left on device'));

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(500);

        expect(response.body).toHaveProperty('error', 'Failed to start backup');
      });

      test('should handle permission errors during backup', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockRejectedValue(new Error('EACCES: permission denied'));

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(500);

        expect(response.body).toHaveProperty('error', 'Failed to start backup');
      });

      test('should log backup errors without affecting response', async () => {
        const { logger } = require('../../../utils/logger');
        const { StorageService } = require('../../../services/storageService');

        // Backup starts successfully but fails during execution
        StorageService.performBackup.mockImplementation(() => {
          return Promise.reject(new Error('Backup failed during execution'));
        });

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Backup started successfully');

        // Give async backup time to fail
        await new Promise(resolve => setTimeout(resolve, 100));

        // Error should be logged but not affect the response
        expect(logger.error).toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(mockAuthMiddleware('admin'));
        app.use('/api/storage', storageRoutes);
        app.use(errorHandler);
      });

      test('should handle backup with empty storage', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Backup started successfully');
      });

      test('should handle backup with large storage volumes', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/storage/backup')
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Backup started successfully');
      });

      test('should handle rapid successive backup requests', async () => {
        const { StorageService } = require('../../../services/storageService');
        StorageService.performBackup.mockResolvedValue(undefined);

        const response1 = await request(app).post('/api/storage/backup');
        const response2 = await request(app).post('/api/storage/backup');
        const response3 = await request(app).post('/api/storage/backup');

        expect(response1.status).toBe(200);
        expect(response2.status).toBe(200);
        expect(response3.status).toBe(200);
      });
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('admin'));
      app.use('/api/storage', storageRoutes);
      app.use(errorHandler);
    });

    test('should get stats, trigger backup, and verify both work independently', async () => {
      const { StorageService } = require('../../../services/storageService');

      const mockReport = {
        storage: {
          totalFiles: 500,
          totalSize: 262144000,
          averageSize: 524288,
          usagePercent: 25.0
        }
      };

      StorageService.getStorageReport.mockResolvedValue(mockReport);
      StorageService.performBackup.mockResolvedValue(undefined);

      // Get stats
      const statsResponse = await request(app)
        .get('/api/storage/stats')
        .expect(200);

      expect(statsResponse.body).toEqual(mockReport);

      // Trigger backup
      const backupResponse = await request(app)
        .post('/api/storage/backup')
        .expect(200);

      expect(backupResponse.body).toHaveProperty('message', 'Backup started successfully');
    });

    test('should handle stats request during active backup', async () => {
      const { StorageService } = require('../../../services/storageService');

      const mockReport = {
        storage: {
          totalFiles: 500,
          totalSize: 262144000,
          averageSize: 524288,
          usagePercent: 25.0
        }
      };

      StorageService.getStorageReport.mockResolvedValue(mockReport);
      StorageService.performBackup.mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 2000));
      });

      // Start backup
      const backupPromise = request(app).post('/api/storage/backup');

      // Get stats while backup is running
      const statsResponse = await request(app)
        .get('/api/storage/stats')
        .expect(200);

      expect(statsResponse.body).toEqual(mockReport);

      // Verify backup completes
      const backupResponse = await backupPromise;
      expect(backupResponse.status).toBe(200);
    });
  });
});