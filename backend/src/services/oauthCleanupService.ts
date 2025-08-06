import { oauthStateService } from './oauthStateService';
import { logger } from '../utils/logger';

export class OAuthCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Start periodic cleanup of expired OAuth states
   */
  start(): void {
    if (this.cleanupInterval) {
      logger.warn('[OAuth Cleanup] Service already running');
      return;
    }

    logger.info(`[OAuth Cleanup] Starting periodic cleanup (interval: ${this.CLEANUP_INTERVAL_MS / 1000}s)`);

    // Run initial cleanup
    this.runCleanup();

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, this.CLEANUP_INTERVAL_MS);

    // Ensure cleanup runs on process exit
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  /**
   * Stop periodic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('[OAuth Cleanup] Stopped periodic cleanup');
    }
  }

  /**
   * Run cleanup manually
   */
  private async runCleanup(): Promise<void> {
    try {
      const deletedCount = await oauthStateService.cleanupExpiredStates();
      
      if (deletedCount > 0) {
        logger.info(`[OAuth Cleanup] Cleaned up ${deletedCount} expired states`);
      } else {
        logger.debug('[OAuth Cleanup] No expired states to clean up');
      }

      // Log stats occasionally
      if (Math.random() < 0.1) { // 10% chance
        const stats = await oauthStateService.getStateStats();
        logger.debug('[OAuth Cleanup] Current state statistics', stats);
      }
    } catch (error) {
      logger.error('[OAuth Cleanup] Cleanup failed:', error);
    }
  }

  /**
   * Get cleanup service status
   */
  getStatus(): {
    running: boolean;
    intervalMs: number;
    nextCleanupIn?: number;
  } {
    return {
      running: this.cleanupInterval !== null,
      intervalMs: this.CLEANUP_INTERVAL_MS,
      nextCleanupIn: this.cleanupInterval ? this.CLEANUP_INTERVAL_MS : undefined
    };
  }
}

export const oauthCleanupService = new OAuthCleanupService();