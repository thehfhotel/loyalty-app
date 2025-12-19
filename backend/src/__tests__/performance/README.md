# Performance Testing

This directory contains performance tests for the loyalty-app backend using various tools and methodologies.

## Overview

Performance tests help ensure the application maintains acceptable response times and throughput under various load conditions. The tests are organized into different categories:

- **Benchmarks** (`/benchmarks`): Micro-benchmarks for specific functions and operations
- **Load Tests** (`/k6`): HTTP load testing using k6 for realistic user scenarios

## Prerequisites

### Required Dependencies

1. **k6** - HTTP load testing tool
   - Install instructions: https://k6.io/docs/get-started/installation/
   - Verify installation: `k6 version`

2. **Running Backend**
   - The backend must be running and accessible
   - Default URL: `http://localhost:4202`
   - For E2E environment: `http://localhost:4202`
   - For development environment: `http://localhost:4001`

### Check Dependencies

Run the dependency check script to verify all tools are installed:

```bash
./backend/scripts/check-perf-deps.sh
```

## Running Tests

### k6 Load Tests

k6 load tests simulate realistic HTTP traffic patterns and measure response times, throughput, and error rates.

#### Smoke Test (Light Load)

Runs with 1 virtual user for 30 seconds to verify basic functionality:

```bash
# Using default backend URL (localhost:4202)
k6 run backend/src/__tests__/performance/k6/load-test.js

# Using custom backend URL
BACKEND_URL=http://localhost:4001 k6 run backend/src/__tests__/performance/k6/load-test.js
```

#### Load Test (Ramping Load)

Runs with ramping virtual users (0→5→10→0) to test under realistic load:

```bash
# Run load test scenario
k6 run --scenario load backend/src/__tests__/performance/k6/load-test.js

# With custom backend URL
BACKEND_URL=http://localhost:4001 k6 run --scenario load backend/src/__tests__/performance/k6/load-test.js
```

#### Run All Scenarios

To run all test scenarios sequentially:

```bash
k6 run backend/src/__tests__/performance/k6/load-test.js
```

### Benchmarks

Run micro-benchmarks for specific functions:

```bash
# Run all benchmarks
npm run test:perf

# Run specific benchmark file
npm test -- backend/src/__tests__/performance/benchmarks/sanitizer.bench.test.ts
```

## Test Coverage

### k6 Load Tests

The k6 load test (`load-test.js`) covers the following endpoints:

1. **Health Check** (`GET /api/health`)
   - Verifies application availability
   - Monitors basic connectivity
   - Target: p95 < 200ms

2. **Authentication Flow** (`POST /api/auth/login`)
   - Tests user login functionality
   - Simulates real authentication patterns
   - Target: p95 < 500ms

3. **Loyalty Status** (`GET /api/loyalty/tiers`)
   - Tests loyalty tier information retrieval
   - May require authentication
   - Target: p95 < 500ms

### Test Scenarios

#### Smoke Test
- **Purpose**: Verify basic functionality
- **Virtual Users**: 1
- **Duration**: 30 seconds
- **Use Case**: Quick sanity check before deployments

#### Load Test
- **Purpose**: Test under realistic load
- **Virtual Users**: 0 → 5 (30s) → 10 (1m) → 0 (30s)
- **Duration**: 2 minutes
- **Use Case**: Performance validation before production deployment

## Interpreting Results

### k6 Metrics

k6 provides several built-in and custom metrics:

#### Built-in HTTP Metrics
- `http_req_duration`: Total request time
  - `p(95)`: 95th percentile - 95% of requests faster than this
  - `p(99)`: 99th percentile - 99% of requests faster than this
  - `avg`: Average request duration

- `http_req_failed`: Percentage of failed requests
- `http_reqs`: Total number of requests made
- `iterations`: Total test iterations completed

#### Custom Metrics
- `errors`: Error rate (should be < 10%)
- `health_check_latency`: Health endpoint response time
- `auth_latency`: Authentication endpoint response time
- `loyalty_latency`: Loyalty endpoints response time

### Thresholds

Tests will fail if these thresholds are exceeded:

```javascript
{
  'http_req_duration': ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1s
  'errors': ['rate<0.1'],                           // Error rate < 10%
  'health_check_latency': ['p(95)<200'],            // Health check p95 < 200ms
  'auth_latency': ['p(95)<500'],                    // Auth p95 < 500ms
  'loyalty_latency': ['p(95)<500'],                 // Loyalty p95 < 500ms
}
```

### Output Files

k6 generates a `summary.json` file with detailed results:

```bash
# View summary
cat summary.json | jq .

# Extract specific metrics
cat summary.json | jq '.metrics.http_req_duration'
```

### Example Output

```
scenarios: (100.00%) 2 scenarios, 10 max VUs, 2m30s max duration (incl. graceful stop):
           * smoke: 1 looping VUs for 30s (gracefulStop: 30s)
           * load: Up to 10 looping VUs for 2m0s over 3 stages (gracefulRampDown: 30s, gracefulStop: 30s)

running (2m00.1s), 00/10 VUs, 120 complete and 0 interrupted iterations

Metrics Summary:
================

HTTP Request Duration:
  avg: 123.45ms
  p95: 234.56ms
  p99: 345.67ms

Error Rate: 0.00%
Health Check Latency (avg): 45.67ms
Auth Latency (avg): 156.78ms
Loyalty Latency (avg): 167.89ms

✓ health check status is 200
✓ auth status is 200 or 401
✓ loyalty tiers status is 200 or 401
```

### Analyzing Performance Issues

If tests fail or show degraded performance:

1. **Check Error Rate**
   - If > 10%, investigate application logs for errors
   - Check database connectivity and health

2. **Check Latency Percentiles**
   - p95 > threshold: 5% of requests are too slow
   - p99 > threshold: 1% of requests are too slow
   - High percentiles may indicate:
     - Database query performance issues
     - Network latency
     - Resource contention

3. **Check Resource Utilization**
   ```bash
   # Monitor during test
   docker stats

   # Check backend logs
   docker compose logs -f backend

   # Check database performance
   psql -h localhost -p 5436 -U loyalty_user -d loyalty_db_test \
     -c "SELECT * FROM pg_stat_activity;"
   ```

## CI Integration

Performance tests can be integrated into CI/CD pipelines:

### GitHub Actions Example

```yaml
- name: Check Performance Test Dependencies
  run: ./backend/scripts/check-perf-deps.sh

- name: Run k6 Load Tests
  env:
    BACKEND_URL: http://localhost:4202
  run: |
    k6 run --quiet backend/src/__tests__/performance/k6/load-test.js
```

### Docker Integration

Run k6 tests using Docker (no installation required):

```bash
# Smoke test
docker run --rm -i --network=host \
  -v $PWD/backend/src/__tests__/performance/k6:/scripts \
  grafana/k6:latest run /scripts/load-test.js

# Load test with custom URL
docker run --rm -i --network=host \
  -e BACKEND_URL=http://localhost:4001 \
  -v $PWD/backend/src/__tests__/performance/k6:/scripts \
  grafana/k6:latest run /scripts/load-test.js
```

## Best Practices

1. **Run Tests Regularly**
   - Before major releases
   - After performance-critical changes
   - As part of CI/CD pipeline

2. **Baseline Metrics**
   - Establish performance baselines
   - Track trends over time
   - Set realistic thresholds based on requirements

3. **Test Environment**
   - Use production-like hardware when possible
   - Test with realistic data volumes
   - Isolate test environment from development

4. **Iterative Optimization**
   - Profile slow endpoints
   - Optimize database queries
   - Add caching where appropriate
   - Re-test after changes

5. **Monitor Production**
   - Compare test results with production metrics
   - Use APM tools for real user monitoring
   - Alert on performance degradation

## Troubleshooting

### k6 Not Installed

```bash
# Run dependency check
./backend/scripts/check-perf-deps.sh

# Install k6 (see Prerequisites section)
```

### Backend Not Running

```bash
# Start backend services
docker compose up -d

# Verify backend is accessible
curl http://localhost:4202/api/health
```

### High Error Rates

```bash
# Check backend logs
docker compose logs backend

# Check database connectivity
docker compose ps

# Verify environment variables
docker compose exec backend env | grep -E '(DATABASE_URL|REDIS_URL)'
```

### Slow Response Times

```bash
# Check resource usage
docker stats

# Check database query performance
docker compose exec postgres psql -U loyalty_user -d loyalty_db \
  -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Check for slow queries in logs
docker compose logs backend | grep -i "slow query"
```

## Additional Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Test Types](https://k6.io/docs/test-types/introduction/)
- [k6 Metrics](https://k6.io/docs/using-k6/metrics/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [Performance Testing Best Practices](https://k6.io/docs/testing-guides/performance-testing/)

## Support

For issues or questions about performance testing:

1. Check this README and k6 documentation
2. Review existing test results and baselines
3. Consult with the development team
4. File an issue with test results and logs
