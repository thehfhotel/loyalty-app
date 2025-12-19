import { Pool, PoolClient } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://loyalty:loyalty_password@localhost:5436/loyalty_db';

let pool: Pool | null = null;

/**
 * Get or create the database connection pool
 */
export function getDbPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

/**
 * Close the database connection pool
 */
export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute a function with a pooled database client
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Seed performance test data
 */
export async function seedPerfTestData(userCount: number = 100): Promise<void> {
  await withClient(async (client) => {
    console.log(`Seeding ${userCount} test users for performance testing...`);

    // Start transaction
    await client.query('BEGIN');

    try {
      for (let i = 0; i < userCount; i++) {
        const email = `perftest_user_${i}@example.com`;
        const password = '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890'; // Dummy bcrypt hash
        const firstName = `PerfTest${i}`;
        const lastName = `User${i}`;

        // Insert user
        await client.query(
          `INSERT INTO users (email, password, first_name, last_name, membership_id, tier_id, current_points, total_nights)
           VALUES ($1, $2, $3, $4, nextval('membership_id_sequence'), 1, 0, 0)
           ON CONFLICT (email) DO NOTHING`,
          [email, password, firstName, lastName]
        );
      }

      await client.query('COMMIT');
      console.log(`Successfully seeded ${userCount} test users`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * Cleanup performance test data
 */
export async function cleanupPerfTestData(): Promise<void> {
  await withClient(async (client) => {
    console.log('Cleaning up performance test data...');

    // Delete all users with email starting with 'perftest_user_'
    const result = await client.query(
      `DELETE FROM users WHERE email LIKE 'perftest_user_%'`
    );

    console.log(`Deleted ${result.rowCount} test users`);
  });
}
