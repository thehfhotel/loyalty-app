import { performance } from 'perf_hooks';

export interface BenchmarkResult {
  endpoint: string;
  method: string;
  samples: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
}

export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4202';

/**
 * Calculate statistics from an array of timing values
 */
export function calculateStats(times: number[]): {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
} {
  if (times.length === 0) {
    throw new Error('Cannot calculate stats from empty array');
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / sorted.length;

  // Calculate standard deviation
  const squaredDiffs = sorted.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / sorted.length;
  const stdDev = Math.sqrt(variance);

  // Calculate percentiles
  const getPercentile = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] as number;
  };

  return {
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean,
    median: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
    stdDev,
  };
}

/**
 * Benchmark a function by running it multiple times
 */
export async function benchmark(
  fn: () => Promise<void> | void,
  iterations = 100,
  warmup = 10
): Promise<number[]> {
  const times: number[] = [];

  // Warmup phase
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  return times;
}

/**
 * Format benchmark result for console output
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  const lines = [
    `\n${'='.repeat(60)}`,
    `Benchmark: ${result.method} ${result.endpoint}`,
    `${'='.repeat(60)}`,
    `Samples: ${result.samples}`,
    `Min:     ${result.min.toFixed(2)}ms`,
    `Max:     ${result.max.toFixed(2)}ms`,
    `Mean:    ${result.mean.toFixed(2)}ms`,
    `Median:  ${result.median.toFixed(2)}ms`,
    `P95:     ${result.p95.toFixed(2)}ms`,
    `P99:     ${result.p99.toFixed(2)}ms`,
    `StdDev:  ${result.stdDev.toFixed(2)}ms`,
    `${'='.repeat(60)}\n`,
  ];

  return lines.join('\n');
}
