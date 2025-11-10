import { storageConfig } from '../config/storage';
import { logger } from '../utils/logger';
import { ImageProcessor } from '../utils/imageProcessor';

interface StorageReport {
  storage: {
    totalFiles: number;
    totalSize: number;
    averageSize: number;
    usagePercent: number;
  };
}

export class StorageService {
  // Initialize simple daily backup
  static initialize(): void {
    // Schedule daily backup at 2 AM - simple approach without cron job complexity
    this.scheduleBackup();
    logger.info('Storage service initialized with daily backup');
  }
  
  // Simple backup scheduling
  private static scheduleBackup(): void {
    const now = new Date();
    const tomorrow2AM = new Date();
    tomorrow2AM.setDate(now.getDate() + 1);
    tomorrow2AM.setHours(2, 0, 0, 0);
    
    const msUntilBackup = tomorrow2AM.getTime() - now.getTime();
    
    setTimeout(() => {
      this.performBackup().catch(error => {
        logger.error('Backup failed:', error);
      });
      
      // Schedule next backup in 24 hours
      setInterval(() => {
        this.performBackup().catch(error => {
          logger.error('Backup failed:', error);
        });
      }, 24 * 60 * 60 * 1000);
    }, msUntilBackup);
  }
  
  // Simple backup method
  static async performBackup(): Promise<void> {
    logger.info('Starting avatar backup...');
    
    const startTime = Date.now();
    await ImageProcessor.backupAvatars();
    
    logger.info(`Backup completed in ${Date.now() - startTime}ms`);
  }
  
  // Get simple storage report
  static async getStorageReport(): Promise<StorageReport> {
    const stats = await ImageProcessor.getStorageStats();
    
    return {
      storage: {
        totalFiles: stats.totalFiles,
        totalSize: stats.totalSize,
        averageSize: stats.averageSize,
        usagePercent: (stats.totalSize / storageConfig.maxStorageSize) * 100
      }
    };
  }
}