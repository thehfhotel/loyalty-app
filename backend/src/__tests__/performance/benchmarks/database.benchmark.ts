/**
 * Database Performance Benchmark Tests
 * Tests database query performance using real PostgreSQL queries
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  benchmark,
  calculateStats,
  formatBenchmarkResult,
  BenchmarkResult,
} from '../setup/perfTestSetup';
import {
  withClient,
  seedPerfTestData,
  cleanupPerfTestData,
  closeDbPool,
} from '../setup/database-helpers';

// Store benchmark results
const results: BenchmarkResult[] = [];

// Setup test data before all tests
beforeAll(async () => {
  await seedPerfTestData(100);
}, 30000); // 30 second timeout for seeding

// Cleanup test data and close connection pool
afterAll(async () => {
  // Output all results
  console.log('\n\n' + '='.repeat(60));
  console.log('DATABASE BENCHMARK RESULTS SUMMARY');
  console.log('='.repeat(60));

  results.forEach((result) => {
    console.log(formatBenchmarkResult(result));
  });

  // Write results to JSON file
  const resultsDir = join(__dirname, '../../../benchmark-results');
  try {
    mkdirSync(resultsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
  }

  const resultsPath = join(resultsDir, 'db-benchmark.json');
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${resultsPath}\n`);

  // Cleanup
  await cleanupPerfTestData();
  await closeDbPool();
}, 30000); // 30 second timeout for cleanup

describe('User Queries', () => {
  it('should query user by email within threshold (indexed)', async () => {
    const times = await benchmark(async () => {
      await withClient(async (client) => {
        await client.query(
          'SELECT id, email, role, is_active, created_at FROM users WHERE email = $1',
          ['perftest_user_50@example.com']
        );
      });
    }, 100, 10);

    const stats = calculateStats(times);

    // Store result
    results.push({
      endpoint: 'SELECT user by email',
      method: 'Query',
      samples: times.length,
      ...stats,
    });

    // Assert p95 is below 10ms threshold
    expect(stats.p95).toBeLessThan(10);
  });

  it('should query user by ID within threshold (primary key)', async () => {
    // First, get a user ID to test with
    let userId: string;
    await withClient(async (client) => {
      const result = await client.query(
        'SELECT id FROM users WHERE email = $1',
        ['perftest_user_0@example.com']
      );
      userId = result.rows[0].id;
    });

    const times = await benchmark(async () => {
      await withClient(async (client) => {
        await client.query(
          'SELECT id, email, role, is_active, created_at FROM users WHERE id = $1',
          [userId]
        );
      });
    }, 100, 10);

    const stats = calculateStats(times);

    // Store result
    results.push({
      endpoint: 'SELECT user by ID',
      method: 'Query',
      samples: times.length,
      ...stats,
    });

    // Assert p95 is below 5ms threshold
    expect(stats.p95).toBeLessThan(5);
  });
});

describe('Tier Queries', () => {
  it('should list all tiers within threshold', async () => {
    const times = await benchmark(async () => {
      await withClient(async (client) => {
        await client.query(
          'SELECT id, name, min_points, min_nights, benefits, color, sort_order FROM tiers WHERE is_active = true ORDER BY sort_order'
        );
      });
    }, 100, 10);

    const stats = calculateStats(times);

    // Store result
    results.push({
      endpoint: 'SELECT all tiers',
      method: 'Query',
      samples: times.length,
      ...stats,
    });

    // Assert p95 is below 5ms threshold
    expect(stats.p95).toBeLessThan(5);
  });
});

describe('Transaction Queries', () => {
  it('should query transactions by user within threshold', async () => {
    // First, create some test transactions
    let userId: string;
    await withClient(async (client) => {
      const userResult = await client.query(
        'SELECT id FROM users WHERE email = $1',
        ['perftest_user_0@example.com']
      );
      userId = userResult.rows[0].id;

      // Create 10 test transactions
      for (let i = 0; i < 10; i++) {
        await client.query(
          `INSERT INTO points_transactions (user_id, points, type, description)
           VALUES ($1, $2, $3, $4)`,
          [userId, 100 + i, 'earned_stay', `Test transaction ${i}`]
        );
      }
    });

    const times = await benchmark(async () => {
      await withClient(async (client) => {
        await client.query(
          `SELECT id, user_id, points, type, description, created_at
           FROM points_transactions
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [userId]
        );
      });
    }, 100, 10);

    const stats = calculateStats(times);

    // Store result
    results.push({
      endpoint: 'SELECT transactions by user',
      method: 'Query',
      samples: times.length,
      ...stats,
    });

    // Cleanup test transactions
    await withClient(async (client) => {
      await client.query(
        'DELETE FROM points_transactions WHERE user_id = $1',
        [userId]
      );
    });

    // Assert p95 is below 20ms threshold
    expect(stats.p95).toBeLessThan(20);
  });

  it('should aggregate points within threshold', async () => {
    // First, create some test transactions
    let userId: string;
    await withClient(async (client) => {
      const userResult = await client.query(
        'SELECT id FROM users WHERE email = $1',
        ['perftest_user_1@example.com']
      );
      userId = userResult.rows[0].id;

      // Create 20 test transactions
      for (let i = 0; i < 20; i++) {
        await client.query(
          `INSERT INTO points_transactions (user_id, points, type, description)
           VALUES ($1, $2, $3, $4)`,
          [userId, 50 + i, 'earned_stay', `Test aggregate transaction ${i}`]
        );
      }
    });

    const times = await benchmark(async () => {
      await withClient(async (client) => {
        await client.query(
          `SELECT
             SUM(points) as total_points,
             COUNT(*) as transaction_count,
             AVG(points) as avg_points
           FROM points_transactions
           WHERE user_id = $1`,
          [userId]
        );
      });
    }, 100, 10);

    const stats = calculateStats(times);

    // Store result
    results.push({
      endpoint: 'AGGREGATE points by user',
      method: 'Query',
      samples: times.length,
      ...stats,
    });

    // Cleanup test transactions
    await withClient(async (client) => {
      await client.query(
        'DELETE FROM points_transactions WHERE user_id = $1',
        [userId]
      );
    });

    // Assert p95 is below 30ms threshold
    expect(stats.p95).toBeLessThan(30);
  });
});
