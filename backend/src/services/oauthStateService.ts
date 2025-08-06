import { randomUUID } from 'crypto';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

export interface OAuthStateData {
  sessionId?: string;
  userId?: string;
  userAgent: string;
  timestamp: number;
  returnUrl: string;
  provider: 'google' | 'line';
  originalUrl: string;
  ip: string;
  secure: boolean;
  host: string;
}

export class OAuthStateService {
  private readonly EXPIRATION_SECONDS = 600; // 10 minutes
  private readonly KEY_PREFIX = 'oauth:state';

  /**
   * Create and store OAuth state data
   */
  async createState(data: OAuthStateData): Promise<string> {
    try {
      const stateKey = randomUUID();
      const redisKey = `${this.KEY_PREFIX}:${data.provider}:${stateKey}`;
      
      const stateData = {
        ...data,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.EXPIRATION_SECONDS * 1000).toISOString()
      };

      const redisClient = getRedisClient();
      await redisClient.setEx(redisKey, this.EXPIRATION_SECONDS, JSON.stringify(stateData));

      logger.debug(`[OAuth State] Created state for ${data.provider}`, {
        stateKey,
        provider: data.provider,
        userAgent: data.userAgent,
        returnUrl: data.returnUrl,
        expiresIn: this.EXPIRATION_SECONDS
      });

      return stateKey;
    } catch (error) {
      logger.error('[OAuth State] Failed to create state:', error);
      throw new Error('Failed to create OAuth state');
    }
  }

  /**
   * Retrieve and validate OAuth state data
   */
  async getState(stateKey: string, provider: 'google' | 'line'): Promise<OAuthStateData | null> {
    try {
      const redisKey = `${this.KEY_PREFIX}:${provider}:${stateKey}`;
      const redisClient = getRedisClient();
      
      const stateDataJson = await redisClient.get(redisKey);
      
      if (!stateDataJson) {
        logger.warn(`[OAuth State] State not found or expired`, {
          stateKey,
          provider,
          redisKey
        });
        return null;
      }

      const stateData = JSON.parse(stateDataJson) as OAuthStateData & {
        createdAt: string;
        expiresAt: string;
      };

      // Additional expiration check (redundant but safer)
      if (new Date() > new Date(stateData.expiresAt)) {
        logger.warn(`[OAuth State] State expired`, {
          stateKey,
          provider,
          expiresAt: stateData.expiresAt
        });
        await this.deleteState(stateKey, provider);
        return null;
      }

      logger.debug(`[OAuth State] Retrieved state for ${provider}`, {
        stateKey,
        provider,
        createdAt: stateData.createdAt,
        ageSeconds: Math.floor((Date.now() - stateData.timestamp) / 1000)
      });

      // Return without the metadata fields
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { createdAt, expiresAt, ...cleanStateData } = stateData;
      return cleanStateData;
    } catch (error) {
      logger.error('[OAuth State] Failed to retrieve state:', error);
      return null;
    }
  }

  /**
   * Delete OAuth state data (cleanup after use)
   */
  async deleteState(stateKey: string, provider: 'google' | 'line'): Promise<void> {
    try {
      const redisKey = `${this.KEY_PREFIX}:${provider}:${stateKey}`;
      const redisClient = getRedisClient();
      
      await redisClient.del(redisKey);
      
      logger.debug(`[OAuth State] Deleted state for ${provider}`, {
        stateKey,
        provider
      });
    } catch (error) {
      logger.error('[OAuth State] Failed to delete state:', error);
      // Don't throw - this is cleanup, shouldn't break the flow
    }
  }

  /**
   * Cleanup expired states (maintenance function)
   */
  async cleanupExpiredStates(): Promise<number> {
    try {
      const redisClient = getRedisClient();
      const pattern = `${this.KEY_PREFIX}:*`;
      
      let cursor = 0;
      let deletedCount = 0;
      
      do {
        const result = await redisClient.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        });
        
        cursor = result.cursor;
        const keys = result.keys;
        
        for (const key of keys) {
          try {
            const stateDataJson = await redisClient.get(key);
            if (!stateDataJson) continue;
            
            const stateData = JSON.parse(stateDataJson);
            if (new Date() > new Date(stateData.expiresAt)) {
              await redisClient.del(key);
              deletedCount++;
            }
          } catch (error) {
            // Invalid data, delete it
            await redisClient.del(key);
            deletedCount++;
          }
        }
      } while (cursor !== 0);
      
      if (deletedCount > 0) {
        logger.info(`[OAuth State] Cleaned up ${deletedCount} expired states`);
      }
      
      return deletedCount;
    } catch (error) {
      logger.error('[OAuth State] Failed to cleanup expired states:', error);
      return 0;
    }
  }

  /**
   * Get statistics about stored states
   */
  async getStateStats(): Promise<{
    total: number;
    byProvider: { google: number; line: number };
    oldestTimestamp?: number;
  }> {
    try {
      const redisClient = getRedisClient();
      const pattern = `${this.KEY_PREFIX}:*`;
      
      let cursor = 0;
      const stats = {
        total: 0,
        byProvider: { google: 0, line: 0 },
        oldestTimestamp: undefined as number | undefined
      };
      
      do {
        const result = await redisClient.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        });
        
        cursor = result.cursor;
        const keys = result.keys;
        
        for (const key of keys) {
          try {
            const stateDataJson = await redisClient.get(key);
            if (!stateDataJson) continue;
            
            const stateData = JSON.parse(stateDataJson);
            stats.total++;
            
            if (key.includes(':google:')) {
              stats.byProvider.google++;
            } else if (key.includes(':line:')) {
              stats.byProvider.line++;
            }
            
            if (!stats.oldestTimestamp || stateData.timestamp < stats.oldestTimestamp) {
              stats.oldestTimestamp = stateData.timestamp;
            }
          } catch (error) {
            // Invalid data, don't count it
          }
        }
      } while (cursor !== 0);
      
      return stats;
    } catch (error) {
      logger.error('[OAuth State] Failed to get stats:', error);
      return {
        total: 0,
        byProvider: { google: 0, line: 0 }
      };
    }
  }
}

export const oauthStateService = new OAuthStateService();