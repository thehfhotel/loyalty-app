import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './logger';
import { storageConfig } from '../config/storage';

export class ImageProcessor {
  // Storage configuration - use config values
  private static storageDir = path.join(storageConfig.baseDir, storageConfig.avatarsDir);
  private static backupDir = storageConfig.backupDir;
  
  // Avatar configuration - use values from storage config
  private static AVATAR_SIZE = storageConfig.avatarSize;
  private static AVATAR_QUALITY = storageConfig.avatarQuality;

  // Ensure directories exist
  static async ensureDirectories(): Promise<void> {
    try {
      await fs.access(this.storageDir);
    } catch {
      // Safe: storageDir is from config, not user input
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(this.storageDir, { recursive: true });
      logger.info(`Created avatar storage directory: ${this.storageDir}`);
    }

    if (!this.backupDir) {
      throw new Error('Backup directory path is not configured');
    }

    try {
      await fs.access(this.backupDir);
    } catch {
      // Safe: backupDir is from config, not user input
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(this.backupDir, { recursive: true });
      logger.info(`Created avatar backup directory: ${this.backupDir}`);
    }
  }

  // Process and save avatar image (single version)
  static async processAvatar(buffer: Buffer, originalName: string, userId: string): Promise<string> {
    await this.ensureDirectories();

    // Generate filename using user ID for easy management
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    const filename = `${userId}_avatar${ext}`;
    const filepath = path.join(this.storageDir, filename);
    
    // Delete old avatar if exists
    await this.deleteUserAvatar(userId);

    // Process image: resize to app display size, optimize for web
    await sharp(buffer)
      .resize(this.AVATAR_SIZE, this.AVATAR_SIZE, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true // Don't upscale small images
      })
      .jpeg({ 
        quality: this.AVATAR_QUALITY,
        progressive: true // Progressive JPEG for better loading
      })
      .toFile(filepath);

    logger.info(`Avatar saved for user ${userId}: ${filename}`);
    
    // Return URL path
    return `/storage/avatars/${filename}`;
  }

  // Delete user's avatar
  static async deleteUserAvatar(userId: string): Promise<void> {
    // Check for common image extensions
    const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    
    for (const ext of extensions) {
      const filename = `${userId}_avatar${ext}`;
      const filepath = path.join(this.storageDir, filename);

      try {
        // Safe: filepath is constructed from config storageDir + userId (validated)
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.unlink(filepath);
        logger.info(`Deleted old avatar for user ${userId}: ${filename}`);
        break; // Stop after deleting the first match
      } catch (_error) {
        // File doesn't exist, continue checking other extensions
      }
    }
  }

  // Delete avatar by path (for backwards compatibility)
  static async deleteAvatar(avatarPath: string): Promise<void> {
    if (!avatarPath) return;

    try {
      const filename = path.basename(avatarPath);
      const filepath = path.join(this.storageDir, filename);

      // Safe: filepath is constructed from config storageDir + basename (sanitized)
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.unlink(filepath);
      logger.info(`Deleted avatar: ${filename}`);
    } catch (error) {
      logger.warn('Error deleting avatar file:', error);
    }
  }

  // Get storage statistics
  static async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    averageSize: number;
  }> {
    try {
      // Safe: storageDir is from config, not user input
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(this.storageDir);
      let totalSize = 0;
      let fileCount = 0;

      for (const file of files) {
        try {
          // Safe: path constructed from config storageDir + directory listing
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const stats = await fs.stat(path.join(this.storageDir, file));
          if (stats.isFile()) {
            totalSize += stats.size;
            fileCount++;
          }
        } catch (_error) {
          // Skip files that can't be accessed
        }
      }

      return {
        totalFiles: fileCount,
        totalSize,
        averageSize: fileCount > 0 ? Math.round(totalSize / fileCount) : 0
      };
    } catch (error) {
      logger.error('Error getting storage stats:', error);
      return { totalFiles: 0, totalSize: 0, averageSize: 0 };
    }
  }

  // Simple backup solution
  static async backupAvatars(): Promise<void> {
    await this.ensureDirectories();

    if (!this.backupDir) {
      throw new Error('Backup directory path is not configured');
    }

    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    if (!timestamp) {
      throw new Error('Failed to generate timestamp for backup');
    }
    const backupPath = path.join(this.backupDir, timestamp);

    try {
      // Safe: backupPath is constructed from config backupDir + ISO date
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(backupPath, { recursive: true });

      // Safe: storageDir is from config, not user input
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(this.storageDir);
      let copiedCount = 0;
      
      for (const file of files) {
        const sourcePath = path.join(this.storageDir, file);
        const destPath = path.join(backupPath, file);
        
        try {
          await fs.copyFile(sourcePath, destPath);
          copiedCount++;
        } catch (error) {
          logger.warn(`Failed to backup ${file}:`, error);
        }
      }
      
      logger.info(`Backup completed: ${copiedCount} files backed up to ${backupPath}`);
      
      // Clean old backups (keep last 7 days)
      await this.cleanOldBackups();
    } catch (error) {
      logger.error('Backup failed:', error);
      throw error;
    }
  }

  // Clean backups older than 7 days
  private static async cleanOldBackups(): Promise<void> {
    if (!this.backupDir) {
      logger.warn('Backup directory not configured, skipping cleanup');
      return;
    }

    try {
      // Safe: backupDir is from config, not user input
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const backups = await fs.readdir(this.backupDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      for (const backup of backups) {
        try {
          const backupDate = new Date(backup);
          if (backupDate < cutoffDate) {
            const backupPath = path.join(this.backupDir, backup);
            await fs.rm(backupPath, { recursive: true, force: true });
            logger.info(`Deleted old backup: ${backup}`);
          }
        } catch (_error) {
          // Skip invalid directory names
        }
      }
    } catch (error) {
      logger.warn('Error cleaning old backups:', error);
    }
  }
}