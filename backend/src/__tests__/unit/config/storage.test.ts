/**
 * Storage Configuration Unit Tests
 * Tests storage paths, configuration, and directory initialization
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';

// Mock fs/promises
const mockAccess = jest.fn();
const mockMkdir = jest.fn();
const mockChmod = jest.fn();

jest.mock('fs/promises', () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  chmod: mockChmod,
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

describe('Storage Configuration', () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;
  const originalCwd = process.cwd();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('storageConfig', () => {
    it('should use default storage path when STORAGE_PATH not set', async () => {
      delete process.env.STORAGE_PATH;

      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.baseDir).toBe(path.join(originalCwd, 'storage'));
    });

    it('should use STORAGE_PATH from environment when provided', async () => {
      process.env.STORAGE_PATH = '/custom/storage/path';

      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.baseDir).toBe('/custom/storage/path');
    });

    it('should use default backup path when BACKUP_PATH not set', async () => {
      delete process.env.BACKUP_PATH;

      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.backupDir).toBe(path.join(originalCwd, 'storage', 'backup'));
    });

    it('should use BACKUP_PATH from environment when provided', async () => {
      process.env.BACKUP_PATH = '/custom/backup/path';

      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.backupDir).toBe('/custom/backup/path');
    });

    it('should have correct default storage limits', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.maxFileSize).toBe(15 * 1024 * 1024); // 15MB
      expect(storageConfig.maxStorageSize).toBe(10 * 1024 * 1024 * 1024); // 10GB
    });

    it('should have correct avatar settings', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.avatarSize).toBe(200); // 200x200 pixels
      expect(storageConfig.avatarQuality).toBe(90); // 90% quality
    });

    it('should have avatarsDir subdirectory configured', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.avatarsDir).toBe('avatars');
    });

    it('should have slipsDir subdirectory configured', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.slipsDir).toBe('slips');
    });

    it('should have correct slip file size limit', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.maxSlipFileSize).toBe(10 * 1024 * 1024); // 10MB
    });
  });

  describe('StoragePaths', () => {
    describe('getAvatarPath', () => {
      it('should construct correct avatar path', async () => {
        delete process.env.STORAGE_PATH;

        const { StoragePaths } = await import('../../../config/storage');

        const avatarPath = StoragePaths.getAvatarPath('user-123.jpg');
        const expectedPath = path.join(originalCwd, 'storage', 'avatars', 'user-123.jpg');

        expect(avatarPath).toBe(expectedPath);
      });

      it('should construct avatar path with custom storage directory', async () => {
        process.env.STORAGE_PATH = '/custom/storage';

        const { StoragePaths } = await import('../../../config/storage');

        const avatarPath = StoragePaths.getAvatarPath('user-456.png');
        const expectedPath = path.join('/custom/storage', 'avatars', 'user-456.png');

        expect(avatarPath).toBe(expectedPath);
      });

      it('should handle different file extensions', async () => {
        delete process.env.STORAGE_PATH;

        const { StoragePaths } = await import('../../../config/storage');

        const jpgPath = StoragePaths.getAvatarPath('avatar.jpg');
        const pngPath = StoragePaths.getAvatarPath('avatar.png');
        const webpPath = StoragePaths.getAvatarPath('avatar.webp');

        expect(jpgPath).toContain('avatar.jpg');
        expect(pngPath).toContain('avatar.png');
        expect(webpPath).toContain('avatar.webp');
      });
    });

    describe('getSlipPath', () => {
      it('should construct correct slip path', async () => {
        delete process.env.STORAGE_PATH;

        const { StoragePaths } = await import('../../../config/storage');

        const slipPath = StoragePaths.getSlipPath('booking-123-slip.jpg');
        const expectedPath = path.join(originalCwd, 'storage', 'slips', 'booking-123-slip.jpg');

        expect(slipPath).toBe(expectedPath);
      });

      it('should construct slip path with custom storage directory', async () => {
        process.env.STORAGE_PATH = '/custom/storage';

        const { StoragePaths } = await import('../../../config/storage');

        const slipPath = StoragePaths.getSlipPath('booking-456-slip.png');
        const expectedPath = path.join('/custom/storage', 'slips', 'booking-456-slip.png');

        expect(slipPath).toBe(expectedPath);
      });

      it('should handle different file extensions', async () => {
        delete process.env.STORAGE_PATH;

        const { StoragePaths } = await import('../../../config/storage');

        const jpgPath = StoragePaths.getSlipPath('slip.jpg');
        const pngPath = StoragePaths.getSlipPath('slip.png');
        const webpPath = StoragePaths.getSlipPath('slip.webp');

        expect(jpgPath).toContain('slip.jpg');
        expect(pngPath).toContain('slip.png');
        expect(webpPath).toContain('slip.webp');
      });

      it('should handle UUID-based filenames', async () => {
        delete process.env.STORAGE_PATH;

        const { StoragePaths } = await import('../../../config/storage');

        const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const slipPath = StoragePaths.getSlipPath(`${uuid}.jpg`);

        expect(slipPath).toContain(uuid);
        expect(slipPath).toContain('slips');
      });
    });

    describe('getBackupPath', () => {
      it('should construct backup path with date prefix', async () => {
        delete process.env.BACKUP_PATH;

        const { StoragePaths } = await import('../../../config/storage');

        const backupPath = StoragePaths.getBackupPath('users/user-123.jpg');
        const dateStr = new Date().toISOString().split('T')[0];
        const expectedPath = path.join(originalCwd, 'storage', 'backup', dateStr!, 'users/user-123.jpg');

        expect(backupPath).toBe(expectedPath);
      });

      it('should construct backup path with custom backup directory', async () => {
        process.env.BACKUP_PATH = '/custom/backup';

        const { StoragePaths } = await import('../../../config/storage');

        const backupPath = StoragePaths.getBackupPath('avatars/user-456.png');
        const dateStr = new Date().toISOString().split('T')[0];
        const expectedPath = path.join('/custom/backup', dateStr!, 'avatars/user-456.png');

        expect(backupPath).toBe(expectedPath);
      });

      it('should include current date in backup path', async () => {
        const { StoragePaths } = await import('../../../config/storage');

        const backupPath = StoragePaths.getBackupPath('test.jpg');
        const dateStr = new Date().toISOString().split('T')[0];

        expect(backupPath).toContain(dateStr!);
      });

      it('should preserve relative path structure in backup', async () => {
        const { StoragePaths } = await import('../../../config/storage');

        const backupPath = StoragePaths.getBackupPath('users/2024/01/file.jpg');

        expect(backupPath).toContain('users/2024/01/file.jpg');
      });
    });
  });

  describe('initializeStorage', () => {
    it('should check for existing directories', async () => {
      delete process.env.STORAGE_PATH;
      delete process.env.BACKUP_PATH;

      const { initializeStorage } = await import('../../../config/storage');

      mockAccess.mockResolvedValue(undefined as never);

      await initializeStorage();

      expect(mockAccess).toHaveBeenCalledTimes(4);
      expect(mockAccess).toHaveBeenCalledWith(path.join(originalCwd, 'storage'));
      expect(mockAccess).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'avatars'));
      expect(mockAccess).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'slips'));
      expect(mockAccess).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'backup'));
    });

    it('should create directories when they do not exist', async () => {
      delete process.env.STORAGE_PATH;

      const { initializeStorage } = await import('../../../config/storage');
      const { logger } = await import('../../../utils/logger');

      mockAccess.mockRejectedValue(new Error('ENOENT') as never);
      mockMkdir.mockResolvedValue(undefined as never);
      mockChmod.mockResolvedValue(undefined as never);

      await initializeStorage();

      expect(mockMkdir).toHaveBeenCalledTimes(4);
      expect(mockMkdir).toHaveBeenCalledWith(path.join(originalCwd, 'storage'), { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'avatars'), { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'slips'), { recursive: true });
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Created storage directory'));
    });

    it('should log when directories already exist', async () => {
      const { initializeStorage } = await import('../../../config/storage');
      const { logger } = await import('../../../utils/logger');

      mockAccess.mockResolvedValue(undefined as never);

      await initializeStorage();

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Storage directory exists'));
    });

    it('should handle directory creation errors gracefully', async () => {
      const { initializeStorage } = await import('../../../config/storage');
      const { logger } = await import('../../../utils/logger');

      mockAccess.mockRejectedValue(new Error('ENOENT') as never);
      mockMkdir.mockRejectedValue(new Error('Permission denied') as never);

      // Should not throw, just warn
      await expect(initializeStorage()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not create storage directory'),
        expect.any(Error)
      );
    });

    it('should set directory permissions on Unix-like systems', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const { initializeStorage } = await import('../../../config/storage');

      mockAccess.mockResolvedValue(undefined as never);
      mockChmod.mockResolvedValue(undefined as never);

      await initializeStorage();

      expect(mockChmod).toHaveBeenCalledWith(path.join(originalCwd, 'storage'), 0o755);
      expect(mockChmod).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'avatars'), 0o755);
      expect(mockChmod).toHaveBeenCalledWith(path.join(originalCwd, 'storage', 'slips'), 0o755);
    });

    it('should skip permissions on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const { initializeStorage } = await import('../../../config/storage');

      mockAccess.mockResolvedValue(undefined as never);

      await initializeStorage();

      expect(mockChmod).not.toHaveBeenCalled();
    });

    it('should handle permission setting errors gracefully', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const { initializeStorage } = await import('../../../config/storage');
      const { logger } = await import('../../../utils/logger');

      mockAccess.mockResolvedValue(undefined as never);
      mockChmod.mockRejectedValue(new Error('Permission denied') as never);

      await expect(initializeStorage()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        'Could not set directory permissions:',
        expect.any(Error)
      );
    });

    it('should create all required directories', async () => {
      process.env.STORAGE_PATH = '/custom/storage';
      process.env.BACKUP_PATH = '/custom/backup';

      const { initializeStorage } = await import('../../../config/storage');

      mockAccess.mockRejectedValue(new Error('ENOENT') as never);
      mockMkdir.mockResolvedValue(undefined as never);
      mockChmod.mockResolvedValue(undefined as never);

      await initializeStorage();

      expect(mockMkdir).toHaveBeenCalledWith('/custom/storage', { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith(path.join('/custom/storage', 'avatars'), { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith(path.join('/custom/storage', 'slips'), { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith('/custom/backup', { recursive: true });
    });
  });

  describe('StorageConfig Interface', () => {
    it('should have all required properties', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig).toHaveProperty('baseDir');
      expect(storageConfig).toHaveProperty('avatarsDir');
      expect(storageConfig).toHaveProperty('slipsDir');
      expect(storageConfig).toHaveProperty('backupDir');
      expect(storageConfig).toHaveProperty('maxFileSize');
      expect(storageConfig).toHaveProperty('maxStorageSize');
      expect(storageConfig).toHaveProperty('maxSlipFileSize');
      expect(storageConfig).toHaveProperty('avatarSize');
      expect(storageConfig).toHaveProperty('avatarQuality');
    });

    it('should have correct types for all properties', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(typeof storageConfig.baseDir).toBe('string');
      expect(typeof storageConfig.avatarsDir).toBe('string');
      expect(typeof storageConfig.slipsDir).toBe('string');
      expect(typeof storageConfig.backupDir).toBe('string');
      expect(typeof storageConfig.maxFileSize).toBe('number');
      expect(typeof storageConfig.maxStorageSize).toBe('number');
      expect(typeof storageConfig.maxSlipFileSize).toBe('number');
      expect(typeof storageConfig.avatarSize).toBe('number');
      expect(typeof storageConfig.avatarQuality).toBe('number');
    });

    it('should have reasonable size limits', async () => {
      const { storageConfig } = await import('../../../config/storage');

      expect(storageConfig.maxFileSize).toBeGreaterThan(0);
      expect(storageConfig.maxFileSize).toBeLessThanOrEqual(100 * 1024 * 1024); // Max 100MB
      expect(storageConfig.maxStorageSize).toBeGreaterThan(storageConfig.maxFileSize);
      expect(storageConfig.avatarSize).toBeGreaterThan(0);
      expect(storageConfig.avatarSize).toBeLessThanOrEqual(1000); // Max 1000px
      expect(storageConfig.avatarQuality).toBeGreaterThan(0);
      expect(storageConfig.avatarQuality).toBeLessThanOrEqual(100);
    });
  });
});
