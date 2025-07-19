import { Pool } from 'pg';
import { logger } from '../utils/logger.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://loyalty_user:loyalty_pass@localhost:5432/loyalty_app';

export const db = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

db.on('error', (err) => {
  logger.error('Unexpected database error:', err);
});

db.on('connect', () => {
  logger.info('Database connection established');
});

// Connect to database
export async function connectDatabase(): Promise<{ pool: Pool }> {
  try {
    await db.query('SELECT NOW()');
    logger.info('Connected to database successfully');
    return { pool: db };
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    throw error;
  }
}

// Disconnect from database
export async function disconnectDatabase(): Promise<void> {
  try {
    await db.end();
    logger.info('Disconnected from database');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
}

// Health check
export async function databaseHealthCheck(): Promise<boolean> {
  try {
    const result = await db.query('SELECT NOW()');
    return !!result.rows[0];
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}