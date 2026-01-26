import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';

export interface StorageConfig {
  // Base storage paths
  baseDir: string;
  avatarsDir: string;
  slipsDir: string;
  backupDir?: string;

  // Storage limits
  maxFileSize: number;
  maxStorageSize: number;
  maxSlipFileSize: number;

  // Avatar settings
  avatarSize: number; // Single size used in app
  avatarQuality: number; // JPEG quality
}

export const storageConfig: StorageConfig = {
  // Base paths - simple structure
  baseDir: process.env.STORAGE_PATH ?? path.join(process.cwd(), 'storage'),
  avatarsDir: 'avatars',
  slipsDir: 'slips',
  backupDir: (process.env.BACKUP_PATH ?? path.join(process.cwd(), 'storage', 'backup')) as string,

  // Storage limits
  maxFileSize: 15 * 1024 * 1024, // 15MB - allows large images that will be processed and compressed
  maxStorageSize: 10 * 1024 * 1024 * 1024, // 10GB total
  maxSlipFileSize: 10 * 1024 * 1024, // 10MB for payment slips

  // Avatar settings - single version only
  avatarSize: 200, // 200x200 pixels as used in app
  avatarQuality: 90 // High quality since we only store one version
};

// Storage paths helper - simplified for single avatar per user
export class StoragePaths {
  static getAvatarPath(filename: string): string {
    return path.join(
      storageConfig.baseDir,
      storageConfig.avatarsDir,
      filename
    );
  }

  static getSlipPath(filename: string): string {
    return path.join(
      storageConfig.baseDir,
      storageConfig.slipsDir,
      filename
    );
  }

  static getBackupPath(relativePath: string): string {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]!;
    return path.join(
      (process.env.BACKUP_PATH ?? path.join(process.cwd(), 'storage', 'backup')) as string,
      dateStr,
      relativePath
    );
  }
}

// Initialize storage directories - simplified
export async function initializeStorage(): Promise<void> {
  const directories = [
    storageConfig.baseDir,
    path.join(storageConfig.baseDir, storageConfig.avatarsDir),
    path.join(storageConfig.baseDir, storageConfig.slipsDir),
    storageConfig.backupDir!
  ];
  
  for (const dir of directories) {
    try {
      await fs.access(dir);
      logger.info(`Storage directory exists: ${dir}`);
    } catch {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: dir constructed with path.join from controlled inputs
        await fs.mkdir(dir, { recursive: true });
        logger.info(`Created storage directory: ${dir}`);
      } catch (error) {
        logger.warn(`Could not create storage directory ${dir}:`, error);
        // Continue execution - directory creation is not critical
      }
    }
  }
  
  // Set proper permissions (Unix-like systems)
  if (process.platform !== 'win32') {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: baseDir is controlled config value
      await fs.chmod(storageConfig.baseDir, 0o755);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: path constructed with path.join from controlled inputs
      await fs.chmod(path.join(storageConfig.baseDir, storageConfig.avatarsDir), 0o755);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Safe: path constructed with path.join from controlled inputs
      await fs.chmod(path.join(storageConfig.baseDir, storageConfig.slipsDir), 0o755);
    } catch (error) {
      logger.warn('Could not set directory permissions:', error);
    }
  }
}