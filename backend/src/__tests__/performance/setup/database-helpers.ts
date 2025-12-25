/* eslint-disable no-console */

import { Pool, PoolClient } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://loyalty:loyalty_password@localhost:5436/loyalty_db';

let pool: Pool | null = null;

/**
 * Get or create the database connection pool
 */
export function getDbPool(): Pool {
  pool ??= new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
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
 * Seed tiers if they don't exist
 */
async function ensureTiersExist(client: PoolClient): Promise<void> {
  const tiersExist = await client.query('SELECT COUNT(*) FROM tiers');
  if (parseInt(tiersExist.rows[0].count, 10) > 0) {
    return; // Tiers already exist
  }

  console.log('Seeding tiers for performance testing...');

  const tiers = [
    { name: 'Bronze', min_nights: 0, color: '#CD7F32', sort_order: 1 },
    { name: 'Silver', min_nights: 1, color: '#C0C0C0', sort_order: 2 },
    { name: 'Gold', min_nights: 10, color: '#FFD700', sort_order: 3 },
    { name: 'Platinum', min_nights: 20, color: '#E5E4E2', sort_order: 4 },
  ];

  for (const tier of tiers) {
    await client.query(
      `INSERT INTO tiers (name, min_points, min_nights, benefits, color, sort_order, is_active)
       VALUES ($1, 0, $2, '{}', $3, $4, true)
       ON CONFLICT (name) DO NOTHING`,
      [tier.name, tier.min_nights, tier.color, tier.sort_order]
    );
  }
  console.log('Tiers seeded successfully');
}

/**
 * Seed performance test data
 */
export async function seedPerfTestData(userCount = 100): Promise<void> {
  await withClient(async (client) => {
    console.log(`Seeding ${userCount} test users for performance testing...`);

    // Start transaction
    await client.query('BEGIN');

    try {
      // Ensure tiers exist first
      await ensureTiersExist(client);

      // Get the Bronze tier ID (first tier)
      const tierResult = await client.query(
        `SELECT id FROM tiers WHERE name = 'Bronze' OR sort_order = 1 LIMIT 1`
      );
      const tierId = tierResult.rows[0]?.id;

      if (!tierId) {
        throw new Error('Bronze tier not found after seeding. Database may be misconfigured.');
      }

      for (let i = 0; i < userCount; i++) {
        const email = `perftest_user_${i}@example.com`;
        const passwordHash = '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890'; // Dummy bcrypt hash
        const firstName = `PerfTest${i}`;
        const lastName = `User${i}`;

        // Check if user already exists
        const existingUser = await client.query(
          `SELECT id FROM users WHERE email = $1`,
          [email]
        );

        if (existingUser.rows.length > 0) {
          continue; // Skip existing user
        }

        // Insert user into users table
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, role, is_active, email_verified)
           VALUES ($1, $2, 'customer', true, true)
           RETURNING id`,
          [email, passwordHash]
        );
        const userId = userResult.rows[0].id;

        // Generate membership ID
        const membershipId = `P${String(i + 1).padStart(7, '0')}`;

        // Insert into user_profiles
        await client.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, membership_id)
           VALUES ($1, $2, $3, $4)`,
          [userId, firstName, lastName, membershipId]
        );

        // Insert into user_loyalty
        await client.query(
          `INSERT INTO user_loyalty (user_id, current_points, total_nights, tier_id)
           VALUES ($1, 0, 0, $2)`,
          [userId, tierId]
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
