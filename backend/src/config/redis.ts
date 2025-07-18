import { createClient } from 'redis';
import { logger } from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = createClient({
  url: REDIS_URL,
  retry_delay: 500,
  max_retry: 3,
});

redisClient.on('error', (err) => {
  logger.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  logger.info('Redis Client Connected');
});

redisClient.on('ready', () => {
  logger.info('Redis Client Ready');
});

redisClient.on('end', () => {
  logger.info('Redis Client Disconnected');
});

// Connect to Redis
export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    logger.info('Connected to Redis successfully');
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
}

// Disconnect from Redis
export async function disconnectRedis(): Promise<void> {
  try {
    await redisClient.quit();
    logger.info('Disconnected from Redis');
  } catch (error) {
    logger.error('Error disconnecting from Redis:', error);
  }
}

// Health check
export async function redisHealthCheck(): Promise<boolean> {
  try {
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
}