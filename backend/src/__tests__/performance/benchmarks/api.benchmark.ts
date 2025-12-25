/* eslint-disable no-console */

import request from 'supertest';
import {
  benchmark,
  calculateStats,
  formatBenchmarkResult,
  BACKEND_URL,
  BenchmarkResult,
} from '../setup/perfTestSetup';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Health Endpoint', () => {
  const results: BenchmarkResult[] = [];

  it('should respond within threshold', async () => {
    const times = await benchmark(
      async () => {
        const response = await request(BACKEND_URL).get('/api/health');
        expect(response.status).toBe(200);
      },
      50,
      5
    );

    const stats = calculateStats(times);
    const result: BenchmarkResult = {
      endpoint: '/api/health',
      method: 'GET',
      samples: 50,
      ...stats,
    };

    results.push(result);

    // Assert p95 < 100ms, p99 < 200ms
    expect(stats.p95).toBeLessThan(100);
    expect(stats.p99).toBeLessThan(200);
  });

  afterAll(async () => {
    // Output results
    results.forEach((result) => {
      console.log(formatBenchmarkResult(result));
    });

    // Write results to file
    const resultsDir = path.join(__dirname, '../../../benchmark-results');
    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, 'api-benchmark.json');

    const existingData: { timestamp: string; results: BenchmarkResult[] }[] = [];
    try {
      const existingContent = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(existingContent);
      if (Array.isArray(parsed)) {
        existingData.push(...parsed);
      } else {
        existingData.push(parsed);
      }
    } catch {
      // File doesn't exist or is invalid, start fresh
    }

    existingData.push({
      timestamp: new Date().toISOString(),
      results,
    });

    await fs.writeFile(outputPath, JSON.stringify(existingData, null, 2), 'utf-8');
  });
});

describe('Authentication Endpoint', () => {
  const results: BenchmarkResult[] = [];

  it('should handle login attempts within threshold', async () => {
    const times = await benchmark(
      async () => {
        const response = await request(BACKEND_URL).post('/api/auth/login').send({
          email: 'test@example.com',
          password: 'testpassword123',
        });
        // Accept both 200 (success) and 401 (unauthorized) - user may not exist
        expect([200, 401]).toContain(response.status);
      },
      50,
      5
    );

    const stats = calculateStats(times);
    const result: BenchmarkResult = {
      endpoint: '/api/auth/login',
      method: 'POST',
      samples: 50,
      ...stats,
    };

    results.push(result);

    // Assert p95 < 300ms
    expect(stats.p95).toBeLessThan(300);
  });

  afterAll(async () => {
    // Output results
    results.forEach((result) => {
      console.log(formatBenchmarkResult(result));
    });

    // Write results to file
    const resultsDir = path.join(__dirname, '../../../benchmark-results');
    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, 'api-benchmark.json');

    const existingData: { timestamp: string; results: BenchmarkResult[] }[] = [];
    try {
      const existingContent = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(existingContent);
      if (Array.isArray(parsed)) {
        existingData.push(...parsed);
      } else {
        existingData.push(parsed);
      }
    } catch {
      // File doesn't exist or is invalid, start fresh
    }

    existingData.push({
      timestamp: new Date().toISOString(),
      results,
    });

    await fs.writeFile(outputPath, JSON.stringify(existingData, null, 2), 'utf-8');
  });
});

describe('Loyalty Endpoints', () => {
  const results: BenchmarkResult[] = [];

  it('should get tiers within threshold', async () => {
    const times = await benchmark(
      async () => {
        const response = await request(BACKEND_URL).get('/api/loyalty/tiers');
        // Accept both 200 (success) and 401 (unauthorized)
        expect([200, 401]).toContain(response.status);
      },
      50,
      5
    );

    const stats = calculateStats(times);
    const result: BenchmarkResult = {
      endpoint: '/api/loyalty/tiers',
      method: 'GET',
      samples: 50,
      ...stats,
    };

    results.push(result);

    // Assert p95 < 200ms
    expect(stats.p95).toBeLessThan(200);
  });

  afterAll(async () => {
    // Output results
    results.forEach((result) => {
      console.log(formatBenchmarkResult(result));
    });

    // Write results to file
    const resultsDir = path.join(__dirname, '../../../benchmark-results');
    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, 'api-benchmark.json');

    const existingData: { timestamp: string; results: BenchmarkResult[] }[] = [];
    try {
      const existingContent = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(existingContent);
      if (Array.isArray(parsed)) {
        existingData.push(...parsed);
      } else {
        existingData.push(parsed);
      }
    } catch {
      // File doesn't exist or is invalid, start fresh
    }

    existingData.push({
      timestamp: new Date().toISOString(),
      results,
    });

    await fs.writeFile(outputPath, JSON.stringify(existingData, null, 2), 'utf-8');
  });
});
