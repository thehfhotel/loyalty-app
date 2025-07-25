import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';

export interface StorageConfig {
  // Base storage paths
  baseDir: string;
  avatarsDir: string;
  backupDir: string;
  
  // Storage limits
  maxFileSize: number;
  maxStorageSize: number;
  
  // Avatar settings
  avatarSize: number; // Single size used in app
  avatarQuality: number; // JPEG quality
}

export const storageConfig: StorageConfig = {
  // Base paths - simple structure
  baseDir: process.env.STORAGE_PATH || path.join(process.cwd(), 'storage'),
  avatarsDir: 'avatars',
  backupDir: process.env.BACKUP_PATH || path.join(process.cwd(), 'storage', 'backup'),
  
  // Storage limits
  maxFileSize: 5 * 1024 * 1024, // 5MB
  maxStorageSize: 10 * 1024 * 1024 * 1024, // 10GB total
  
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
  
  static getBackupPath(relativePath: string): string {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    return path.join(storageConfig.backupDir, dateStr, relativePath);
  }
}

// Initialize storage directories - simplified
export async function initializeStorage(): Promise<void> {
  const directories = [
    storageConfig.baseDir,
    path.join(storageConfig.baseDir, storageConfig.avatarsDir),
    storageConfig.backupDir
  ];
  
  for (const dir of directories) {
    try {
      await fs.access(dir);
      logger.info(`Storage directory exists: ${dir}`);
    } catch {
      try {
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
      await fs.chmod(storageConfig.baseDir, 0o755);
      await fs.chmod(path.join(storageConfig.baseDir, storageConfig.avatarsDir), 0o755);
    } catch (error) {
      logger.warn('Could not set directory permissions:', error);
    }
  }
}