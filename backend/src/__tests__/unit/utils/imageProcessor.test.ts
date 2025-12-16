/**
 * ImageProcessor Unit Tests
 * Tests image processing, avatar management, backup operations, and storage statistics
 */

import { ImageProcessor } from '../../../utils/imageProcessor';
import fs from 'fs/promises';
import sharp from 'sharp';
import { logger } from '../../../utils/logger';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('sharp');
jest.mock('../../../utils/logger');
jest.mock('../../../config/storage', () => ({
  storageConfig: {
    baseDir: '/test/storage',
    avatarsDir: 'avatars',
    backupDir: '/test/backup',
    maxFileSize: 15 * 1024 * 1024,
    maxStorageSize: 10 * 1024 * 1024 * 1024,
    avatarSize: 200,
    avatarQuality: 90,
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockSharp = sharp as jest.MockedFunction<typeof sharp>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('ImageProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureDirectories', () => {
    test('should create storage directory if it does not exist', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('Directory does not exist'));
      mockFs.mkdir.mockResolvedValue(undefined);

      await ImageProcessor.ensureDirectories();

      expect(mockFs.access).toHaveBeenCalledWith('/test/storage/avatars');
      expect(mockFs.mkdir).toHaveBeenCalledWith('/test/storage/avatars', { recursive: true });
      expect(mockLogger.info).toHaveBeenCalledWith('Created avatar storage directory: /test/storage/avatars');
    });

    test('should not create storage directory if it already exists', async () => {
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.access.mockResolvedValueOnce(undefined);

      await ImageProcessor.ensureDirectories();

      expect(mockFs.access).toHaveBeenCalledWith('/test/storage/avatars');
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });

    test('should create backup directory if it does not exist', async () => {
      mockFs.access.mockResolvedValueOnce(undefined); // storage dir exists
      mockFs.access.mockRejectedValueOnce(new Error('Backup directory does not exist'));
      mockFs.mkdir.mockResolvedValue(undefined);

      await ImageProcessor.ensureDirectories();

      expect(mockFs.access).toHaveBeenCalledWith('/test/backup');
      expect(mockFs.mkdir).toHaveBeenCalledWith('/test/backup', { recursive: true });
      expect(mockLogger.info).toHaveBeenCalledWith('Created avatar backup directory: /test/backup');
    });

    test('should not create backup directory if it already exists', async () => {
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.access.mockResolvedValueOnce(undefined);

      await ImageProcessor.ensureDirectories();

      expect(mockFs.access).toHaveBeenCalledWith('/test/backup');
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });

    test('should create both directories if neither exists', async () => {
      mockFs.access.mockRejectedValue(new Error('Directory does not exist'));
      mockFs.mkdir.mockResolvedValue(undefined);

      await ImageProcessor.ensureDirectories();

      expect(mockFs.mkdir).toHaveBeenCalledTimes(2);
      expect(mockFs.mkdir).toHaveBeenCalledWith('/test/storage/avatars', { recursive: true });
      expect(mockFs.mkdir).toHaveBeenCalledWith('/test/backup', { recursive: true });
    });

    test('should handle mkdir errors gracefully', async () => {
      mockFs.access.mockRejectedValue(new Error('No access'));
      mockFs.mkdir.mockRejectedValue(new Error('Cannot create directory'));

      await expect(ImageProcessor.ensureDirectories()).rejects.toThrow();
    });
  });

  describe('processAvatar', () => {
    const mockBuffer = Buffer.from('fake-image-data');
    const userId = 'user123';

    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined);
      const mockSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      };
      mockSharp.mockReturnValue(mockSharpInstance as any);
    });

    test('should process and save avatar successfully', async () => {
      const result = await ImageProcessor.processAvatar(mockBuffer, userId);

      expect(result).toBe('/storage/avatars/user123_avatar.jpg');
      expect(mockSharp).toHaveBeenCalledWith(mockBuffer);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Avatar saved for user user123'));
    });

    test('should call ensureDirectories before processing', async () => {
      mockFs.access.mockResolvedValue(undefined);

      await ImageProcessor.processAvatar(mockBuffer, userId);

      expect(mockFs.access).toHaveBeenCalledWith('/test/storage/avatars');
    });

    test('should delete old avatar before saving new one', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await ImageProcessor.processAvatar(mockBuffer, userId);

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    test('should resize image to configured size', async () => {
      const resizeSpy = jest.fn().mockReturnThis();
      const jpegSpy = jest.fn().mockReturnThis();
      const toFileSpy = jest.fn().mockResolvedValue(undefined);

      mockSharp.mockReturnValue({
        resize: resizeSpy,
        jpeg: jpegSpy,
        toFile: toFileSpy,
      } as any);

      await ImageProcessor.processAvatar(mockBuffer, userId);

      expect(resizeSpy).toHaveBeenCalledWith(200, 200, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true,
      });
    });

    test('should convert image to JPEG with configured quality', async () => {
      const resizeSpy = jest.fn().mockReturnThis();
      const jpegSpy = jest.fn().mockReturnThis();
      const toFileSpy = jest.fn().mockResolvedValue(undefined);

      mockSharp.mockReturnValue({
        resize: resizeSpy,
        jpeg: jpegSpy,
        toFile: toFileSpy,
      } as any);

      await ImageProcessor.processAvatar(mockBuffer, userId);

      expect(jpegSpy).toHaveBeenCalledWith({
        quality: 90,
        progressive: true,
      });
    });

    test('should save file to correct path', async () => {
      const resizeSpy = jest.fn().mockReturnThis();
      const jpegSpy = jest.fn().mockReturnThis();
      const toFileSpy = jest.fn().mockResolvedValue(undefined);

      mockSharp.mockReturnValue({
        resize: resizeSpy,
        jpeg: jpegSpy,
        toFile: toFileSpy,
      } as any);

      await ImageProcessor.processAvatar(mockBuffer, userId);

      expect(toFileSpy).toHaveBeenCalledWith('/test/storage/avatars/user123_avatar.jpg');
    });

    test('should handle sharp processing errors', async () => {
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockRejectedValue(new Error('Sharp processing failed')),
      } as any);

      await expect(ImageProcessor.processAvatar(mockBuffer, userId)).rejects.toThrow('Sharp processing failed');
    });

    test('should handle different user IDs correctly', async () => {
      await ImageProcessor.processAvatar(mockBuffer, 'user456');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('user456'));

      await ImageProcessor.processAvatar(mockBuffer, 'admin789');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('admin789'));
    });

    test('should always use .jpg extension', async () => {
      const result = await ImageProcessor.processAvatar(mockBuffer, userId);
      expect(result).toMatch(/\.jpg$/);
    });

    test('should return URL path relative to web root', async () => {
      const result = await ImageProcessor.processAvatar(mockBuffer, userId);
      expect(result).toMatch(/^\/storage\/avatars\//);
    });
  });

  describe('deleteUserAvatar', () => {
    const userId = 'user123';

    beforeEach(() => {
      mockFs.unlink.mockResolvedValue(undefined);
    });

    test('should attempt to delete avatar with various extensions', async () => {
      mockFs.unlink.mockRejectedValue(new Error('File not found'));

      await ImageProcessor.deleteUserAvatar(userId);

      // Should try multiple extensions
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('user123_avatar.jpg'));
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    test('should stop after deleting the first matching file', async () => {
      mockFs.unlink
        .mockRejectedValueOnce(new Error('File not found')) // .jpg not found
        .mockResolvedValueOnce(undefined); // .jpeg found and deleted

      await ImageProcessor.deleteUserAvatar(userId);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted old avatar'));
    });

    test('should not throw error if no avatar exists', async () => {
      mockFs.unlink.mockRejectedValue(new Error('File not found'));

      await expect(ImageProcessor.deleteUserAvatar(userId)).resolves.not.toThrow();
    });

    test('should delete .jpg extension first', async () => {
      mockFs.unlink.mockResolvedValueOnce(undefined);

      await ImageProcessor.deleteUserAvatar(userId);

      expect(mockFs.unlink).toHaveBeenCalledWith('/test/storage/avatars/user123_avatar.jpg');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('user123_avatar.jpg'));
    });

    test('should try common image extensions in order', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Not found'));

      await ImageProcessor.deleteUserAvatar(userId);

      // Verify it tries multiple extensions
      expect(mockFs.unlink.mock.calls.length).toBeGreaterThan(1);
    });

    test('should handle different user IDs', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await ImageProcessor.deleteUserAvatar('user456');
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('user456_avatar'));

      await ImageProcessor.deleteUserAvatar('admin789');
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('admin789_avatar'));
    });

    test('should log successful deletion', async () => {
      mockFs.unlink.mockResolvedValueOnce(undefined);

      await ImageProcessor.deleteUserAvatar(userId);

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted old avatar'));
    });
  });

  describe('deleteAvatar', () => {
    test('should delete avatar by path', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await ImageProcessor.deleteAvatar('/storage/avatars/user123_avatar.jpg');

      expect(mockFs.unlink).toHaveBeenCalledWith('/test/storage/avatars/user123_avatar.jpg');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted avatar'));
    });

    test('should handle empty avatar path', async () => {
      await ImageProcessor.deleteAvatar('');

      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    test('should handle null avatar path', async () => {
      await ImageProcessor.deleteAvatar(null as unknown as string);

      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    test('should handle undefined avatar path', async () => {
      await ImageProcessor.deleteAvatar(undefined as unknown as string);

      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    test('should extract filename from path', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await ImageProcessor.deleteAvatar('/storage/avatars/test_avatar.jpg');

      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('test_avatar.jpg'));
    });

    test('should handle deletion errors gracefully', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      await ImageProcessor.deleteAvatar('/storage/avatars/user123_avatar.jpg');

      expect(mockLogger.warn).toHaveBeenCalledWith('Error deleting avatar file:', expect.any(Error));
    });

    test('should handle paths with different separators', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await ImageProcessor.deleteAvatar('storage/avatars/user123_avatar.jpg');

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    test('should log successful deletion', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await ImageProcessor.deleteAvatar('/storage/avatars/user123_avatar.jpg');

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted avatar'));
    });
  });

  describe('getStorageStats', () => {
    test('should return storage statistics', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg', 'file3.jpg'] as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(3000);
      expect(stats.averageSize).toBe(1000);
    });

    test('should handle empty directory', async () => {
      mockFs.readdir.mockResolvedValue([] as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.averageSize).toBe(0);
    });

    test('should skip directories when calculating stats', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'subdir', 'file2.jpg'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 1000 } as any)
        .mockResolvedValueOnce({ isFile: () => false, size: 0 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 2000 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBe(3000);
    });

    test('should skip files that cannot be accessed', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg', 'locked.jpg'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 1000 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 2000 } as any)
        .mockRejectedValueOnce(new Error('Permission denied'));

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBe(3000);
    });

    test('should calculate average size correctly', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg', 'file3.jpg'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 1000 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 2000 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 3000 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.averageSize).toBe(2000); // (1000 + 2000 + 3000) / 3
    });

    test('should round average size to nearest integer', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 1000 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 1001 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.averageSize).toBe(1001); // Math.round((1000 + 1001) / 2) = 1001
    });

    test('should handle readdir errors', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Cannot read directory'));

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.averageSize).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith('Error getting storage stats:', expect.any(Error));
    });

    test('should handle large file counts', async () => {
      const files = Array.from({ length: 1000 }, (_, i) => `file${i}.jpg`);
      mockFs.readdir.mockResolvedValue(files as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true, size: 5000 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(1000);
      expect(stats.totalSize).toBe(5000000);
      expect(stats.averageSize).toBe(5000);
    });

    test('should handle mixed file sizes', async () => {
      mockFs.readdir.mockResolvedValue(['small.jpg', 'medium.jpg', 'large.jpg'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 100 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 50000 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 5000000 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(5050100);
    });
  });

  describe('backupAvatars', () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg'] as any);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);
    });

    test('should create backup directory with timestamp', async () => {
      const dateSpy = jest.spyOn(Date.prototype, 'toISOString');
      dateSpy.mockReturnValue('2025-12-15T10:30:00.000Z');

      await ImageProcessor.backupAvatars();

      expect(mockFs.mkdir).toHaveBeenCalledWith('/test/backup/2025-12-15', { recursive: true });

      dateSpy.mockRestore();
    });

    test('should copy all files to backup directory', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg', 'file3.jpg'] as any);

      await ImageProcessor.backupAvatars();

      expect(mockFs.copyFile).toHaveBeenCalledTimes(3);
    });

    test('should log successful backup', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg'] as any);

      await ImageProcessor.backupAvatars();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Backup completed: 2 files'));
    });

    test('should handle empty storage directory', async () => {
      mockFs.readdir.mockResolvedValue([] as any);

      await ImageProcessor.backupAvatars();

      expect(mockFs.copyFile).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('0 files'));
    });

    test('should continue backup if individual file copy fails', async () => {
      mockFs.readdir.mockResolvedValue(['file1.jpg', 'file2.jpg', 'file3.jpg'] as any);
      mockFs.copyFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Copy failed'))
        .mockResolvedValueOnce(undefined);

      await ImageProcessor.backupAvatars();

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to backup'), expect.any(Error));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('2 files backed up'));
    });

    test('should handle backup creation errors', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Cannot create backup directory'));

      await expect(ImageProcessor.backupAvatars()).rejects.toThrow('Cannot create backup directory');
      expect(mockLogger.error).toHaveBeenCalledWith('Backup failed:', expect.any(Error));
    });

    test('should clean old backups after successful backup', async () => {
      mockFs.readdir
        .mockResolvedValueOnce(['file1.jpg'] as any) // For avatar files
        .mockResolvedValueOnce(['2025-12-01', '2025-12-08', '2025-12-15'] as any); // For backup dirs

      await ImageProcessor.backupAvatars();

      // Should have called readdir for both avatars and backups
      expect(mockFs.readdir).toHaveBeenCalledWith('/test/storage/avatars');
      expect(mockFs.readdir).toHaveBeenCalledWith('/test/backup');
    });

    test('should copy files to correct backup paths', async () => {
      const dateSpy = jest.spyOn(Date.prototype, 'toISOString');
      dateSpy.mockReturnValue('2025-12-15T10:30:00.000Z');

      mockFs.readdir.mockResolvedValue(['user1.jpg', 'user2.jpg'] as any);

      await ImageProcessor.backupAvatars();

      expect(mockFs.copyFile).toHaveBeenCalledWith(
        '/test/storage/avatars/user1.jpg',
        '/test/backup/2025-12-15/user1.jpg'
      );
      expect(mockFs.copyFile).toHaveBeenCalledWith(
        '/test/storage/avatars/user2.jpg',
        '/test/backup/2025-12-15/user2.jpg'
      );

      dateSpy.mockRestore();
    });
  });

  describe('cleanOldBackups (tested via backupAvatars)', () => {
    beforeEach(() => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);
    });

    test('should delete backups older than 7 days', async () => {
      const now = new Date('2025-12-15T10:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      mockFs.readdir
        .mockResolvedValueOnce(['file1.jpg'] as any) // Avatar files
        .mockResolvedValueOnce(['2025-12-01', '2025-12-08', '2025-12-14', '2025-12-15'] as any); // Backup dirs

      await ImageProcessor.backupAvatars();

      // 2025-12-01 should be deleted (> 7 days old)
      expect(mockFs.rm).toHaveBeenCalledWith(expect.stringContaining('2025-12-01'), { recursive: true, force: true });

      jest.useRealTimers();
    });

    test('should keep backups from last 7 days', async () => {
      const now = new Date('2025-12-15T10:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      mockFs.readdir
        .mockResolvedValueOnce(['file1.jpg'] as any) // Avatar files
        .mockResolvedValueOnce(['2025-12-14', '2025-12-15'] as any); // Backup dirs

      await ImageProcessor.backupAvatars();

      // Should not delete recent backups
      expect(mockFs.rm).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should handle invalid backup directory names', async () => {
      mockFs.readdir
        .mockResolvedValueOnce(['file1.jpg'] as any) // Avatar files
        .mockResolvedValueOnce(['2025-12-15', 'invalid-dir', '.DS_Store'] as any); // Backup dirs

      await ImageProcessor.backupAvatars();

      // Should not throw error, just skip invalid directories
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Backup completed'));
    });

    test('should log deletion of old backups', async () => {
      const now = new Date('2025-12-15T10:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      mockFs.readdir
        .mockResolvedValueOnce(['file1.jpg'] as any) // Avatar files
        .mockResolvedValueOnce(['2025-12-01', '2025-12-15'] as any); // Backup dirs

      await ImageProcessor.backupAvatars();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted old backup: 2025-12-01'));

      jest.useRealTimers();
    });

    test('should handle cleanup errors gracefully', async () => {
      const now = new Date('2025-12-15T10:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      mockFs.readdir
        .mockResolvedValueOnce(['file1.jpg'] as any) // Avatar files
        .mockRejectedValueOnce(new Error('Cannot read backup directory')); // Backup dir read fails

      await ImageProcessor.backupAvatars();

      // Should log warning but not throw
      expect(mockLogger.warn).toHaveBeenCalledWith('Error cleaning old backups:', expect.any(Error));

      jest.useRealTimers();
    });
  });

  describe('Integration scenarios', () => {
    test('should handle complete avatar lifecycle', async () => {
      // Setup
      mockFs.access.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      } as any);

      const buffer = Buffer.from('image-data');

      // Process avatar
      const url = await ImageProcessor.processAvatar(buffer, 'user123');
      expect(url).toBe('/storage/avatars/user123_avatar.jpg');

      // Delete avatar
      await ImageProcessor.deleteUserAvatar('user123');
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    test('should handle backup workflow', async () => {
      // Setup
      mockFs.access.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir
        .mockResolvedValueOnce(['user1.jpg', 'user2.jpg'] as any) // Avatar files
        .mockResolvedValueOnce(['user1.jpg', 'user2.jpg'] as any) // For stats
        .mockResolvedValueOnce([] as any); // Backup dirs (none to clean)
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);

      // Get stats before backup
      const statsBefore = await ImageProcessor.getStorageStats();
      expect(statsBefore.totalFiles).toBe(2);

      // Perform backup
      await ImageProcessor.backupAvatars();
      expect(mockFs.copyFile).toHaveBeenCalledTimes(2);
    });

    test('should maintain storage integrity after errors', async () => {
      // Process avatar with error
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockRejectedValue(new Error('Disk full')),
      } as any);

      const buffer = Buffer.from('image-data');
      await expect(ImageProcessor.processAvatar(buffer, 'user123')).rejects.toThrow('Disk full');

      // Storage stats should still work
      mockFs.readdir.mockResolvedValue(['existing.jpg'] as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);

      const stats = await ImageProcessor.getStorageStats();
      expect(stats.totalFiles).toBe(1);
    });
  });

  describe('Edge cases and boundary conditions', () => {
    test('should handle very large buffers', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      } as any);

      const largeBuffer = Buffer.alloc(15 * 1024 * 1024); // 15MB

      await expect(ImageProcessor.processAvatar(largeBuffer, 'user123')).resolves.toBeDefined();
    });

    test('should handle special characters in user IDs', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      } as any);

      const buffer = Buffer.from('image-data');

      await expect(ImageProcessor.processAvatar(buffer, 'user@test.com')).resolves.toBeDefined();
    });

    test('should handle concurrent avatar processing', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      } as any);

      const buffer = Buffer.from('image-data');

      const promises = [
        ImageProcessor.processAvatar(buffer, 'user1'),
        ImageProcessor.processAvatar(buffer, 'user2'),
        ImageProcessor.processAvatar(buffer, 'user3'),
      ];

      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);
      expect(results[0]).toContain('user1');
      expect(results[1]).toContain('user2');
      expect(results[2]).toContain('user3');
    });

    test('should handle zero-byte files in stats', async () => {
      mockFs.readdir.mockResolvedValue(['empty.jpg', 'normal.jpg'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 0 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 1000 } as any);

      const stats = await ImageProcessor.getStorageStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBe(1000);
    });

    test('should handle very long file names', async () => {
      const longUserId = 'a'.repeat(255);
      mockFs.access.mockResolvedValue(undefined);
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      } as any);

      const buffer = Buffer.from('image-data');

      await expect(ImageProcessor.processAvatar(buffer, longUserId)).resolves.toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should process avatars quickly', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockSharp.mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockResolvedValue(undefined),
      } as any);

      const buffer = Buffer.from('image-data');
      const startTime = Date.now();

      await ImageProcessor.processAvatar(buffer, 'user123');

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000);
    });

    test('should calculate storage stats quickly', async () => {
      mockFs.readdir.mockResolvedValue(Array.from({ length: 100 }, (_, i) => `file${i}.jpg`) as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);

      const startTime = Date.now();
      await ImageProcessor.getStorageStats();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
    });

    test('should handle rapid avatar deletions', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      const startTime = Date.now();

      await Promise.all([
        ImageProcessor.deleteUserAvatar('user1'),
        ImageProcessor.deleteUserAvatar('user2'),
        ImageProcessor.deleteUserAvatar('user3'),
        ImageProcessor.deleteUserAvatar('user4'),
        ImageProcessor.deleteUserAvatar('user5'),
      ]);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(500);
    });
  });
});
