import { Pool } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool;

export async function connectDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    const error = new Error('DATABASE_URL environment variable is required');
    logger.error('Database configuration missing:', error);
    throw error;
  }

  try {
    const config = {
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Retry connection attempts
      retryAttempts: 3,
      retryDelay: 2000,
    };

    pool = new Pool(config);
    
    // Test the connection with retry logic
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        await pool.query('SELECT NOW()');
        logger.info('Database connected successfully to PostgreSQL');
        return;
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw error;
        }
        logger.warn(`Database connection attempt ${attempts} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    logger.error('Database connection failed after all attempts:', error);
    throw error;
  }
}


export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call connectDatabase first.');
  }
  return pool;
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: result.rowCount });
    return result.rows;
  } catch (error) {
    logger.error('Database query error:', { text, error });
    throw error;
  }
}

export async function queryWithMeta<T>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: result.rowCount });
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error) {
    logger.error('Database query error:', { text, error });
    throw error;
  }
}

export async function getClient() {
  return pool.connect();
}