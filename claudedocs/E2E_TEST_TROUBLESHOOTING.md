# E2E Test Troubleshooting Guide

## Overview

This guide documents the fixes applied to the E2E test suite to resolve 19 failing tests caused by service connectivity issues and missing retry logic.

## Problems Identified

### Primary Issues

1. **Backend Connectivity**: Connection refused to localhost:4202
   - Tests expected backend running but services weren't started
   - No retry logic for connection attempts
   - Hard failures on first connection attempt

2. **Frontend Connectivity**: Connection refused to localhost:3201
   - Similar issue with frontend service availability
   - Tests didn't wait for services to become ready

3. **Service Startup Timing**: Tests running before services fully initialize
   - No waiting mechanism for service readiness
   - Immediate test execution after container start

4. **Missing Retry Logic**: No resilience for connection timing issues
   - Single attempt connections caused flaky failures
   - No exponential backoff for service warm-up

## Solutions Implemented

### 1. Retry Helper Utilities (`tests/helpers/retry.ts`)

Created shared retry utilities with exponential backoff:

```typescript
// Retry HTTP requests with exponential backoff
export async function retryRequest(
  request: any,
  url: string,
  maxAttempts = 5,
  options: any = {}
): Promise<any>

// Retry page navigation with exponential backoff
export async function retryPageGoto(
  page: any,
  url: string,
  maxAttempts = 5,
  options: any = {}
): Promise<void>

// Wait for service health check to pass
export async function waitForService(
  request: any,
  healthUrl: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<void>
```

**Retry Strategy:**
- Exponential backoff: 2s, 4s, 8s, 16s (capped at 30s)
- Configurable max attempts
- Detailed logging for debugging
- Proper error messages on final failure

### 2. Test File Updates

**health.spec.ts:**
- Added retry logic to backend health checks (5 attempts)
- Added retry logic to frontend page loading (5 attempts)
- Added retry logic to API endpoint accessibility tests (3 attempts)
- Improved error messages with connection attempt context

**oauth-validation.configured.spec.ts / oauth-validation.security.spec.ts / oauth-validation.unconfigured.spec.ts:**
- Added retry logic to OAuth endpoint configuration tests (3 attempts)
- Added retry logic to OAuth callback validation (3 attempts)
- Added retry logic to OAuth /me endpoint tests (3 attempts)
- Added retry logic to security validation tests (2-3 attempts)
- Added retry logic to error handling tests (2-3 attempts)
- Updated page navigation to use retryPageGoto helper

### 3. Playwright Configuration

Created `playwright.config.ts`:
- Sequential test execution (prevent conflicts)
- 60 second timeout per test
- 30 second action timeout
- Retry on CI (2 retries)
- Screenshot and video on failure
- Single worker on CI for reliability

## Testing Workflow

### Local Development

```bash
# Ensure services are running first
docker compose up -d

# Wait for services to be ready
curl http://localhost:4001/api/health

# Run E2E tests
npm run test:e2e
```

### CI/CD Pipeline

The pipeline now includes:
1. **Port Isolation**: E2E tests use ports 3201/4202/5436/6381
2. **Service Health Checks**: Wait for healthcheck status before tests
3. **Container Readiness**: Verify services respond before test execution
4. **Retry Logic**: Tests handle temporary connectivity issues
5. **Cleanup**: Proper cleanup of containers and volumes after tests

## Common Issues & Solutions

### Issue: ECONNREFUSED errors
**Cause**: Services not started or not ready yet
**Solution**: Retry logic now handles this automatically with exponential backoff

### Issue: Tests timeout waiting for services
**Cause**: Services taking longer than expected to start
**Solution**: Increased timeout values and proper health check waiting

### Issue: Flaky tests due to timing
**Cause**: Race conditions between test start and service readiness
**Solution**: Retry logic with exponential backoff ensures services are ready

### Issue: Port conflicts
**Cause**: Multiple test runs or leftover containers
**Solution**: CI cleanup steps and port isolation strategy

## Test Patterns

### Pattern 1: Testing API Endpoints

```typescript
test('should test API endpoint', async ({ request }) => {
  // Use retry helper for resilience
  const response = await retryRequest(request, `${baseUrl}/api/endpoint`, 3);

  expect(response.status()).toBe(200);
  const data = await response.json();
  // ... assertions
});
```

### Pattern 2: Testing Page Navigation

```typescript
test('should load page', async ({ page }) => {
  // Use retryPageGoto for resilience
  await retryPageGoto(page, url, 5);

  // Page is now loaded, perform assertions
  const title = await page.title();
  expect(title).toBeTruthy();
});
```

### Pattern 3: Testing with Options

```typescript
test('should test with headers', async ({ request }) => {
  // Pass options to retry helper
  const response = await retryRequest(request, url, 3, {
    headers: {
      'Authorization': 'Bearer token'
    },
    timeout: 5000
  });

  // ... assertions
});
```

## Maintenance Notes

### When to Adjust Retry Settings

- **Increase attempts**: If services consistently need more warm-up time
- **Decrease attempts**: If tests are too slow and services are reliable
- **Adjust backoff**: If network latency patterns change

### Adding New E2E Tests

Always use retry helpers for:
1. Initial service connections
2. Page navigations
3. API requests that might fail due to timing
4. Any operation that depends on external services

### Monitoring Test Health

Watch for:
- Tests that consistently use max retries (may indicate real issues)
- Increasing test durations (may indicate service degradation)
- Flaky tests even with retries (may indicate test logic issues)

## Performance Considerations

**Retry Logic Impact:**
- Best case (immediate success): No performance impact
- Average case (2-3 retries): +4-10 seconds per test
- Worst case (max retries): +30-60 seconds per test

**Optimization Strategies:**
1. Use lower retry counts for fast operations
2. Use higher retry counts only for critical stability
3. Adjust backoff timing based on actual service startup patterns
4. Consider adding health check waits before test execution

## References

- Original workflow plan: `claudedocs/PARALLEL_TEST_SUITE_WORKFLOW.md`
- CI/CD configuration: `.github/workflows/deploy.yml`
- Retry helpers: `tests/helpers/retry.ts`
- Health tests: `tests/health.spec.ts`
- OAuth tests: `tests/oauth-validation.configured.spec.ts`, `tests/oauth-validation.security.spec.ts`, `tests/oauth-validation.unconfigured.spec.ts`

## Success Metrics

After implementing these fixes:
- ✅ All 19 failing E2E tests now pass
- ✅ Tests are resilient to service startup timing
- ✅ No flaky failures due to connection timing
- ✅ Clear error messages when tests legitimately fail
- ✅ Maintainable retry logic in shared helpers

## Next Steps

1. Monitor E2E test performance in CI/CD
2. Adjust retry settings based on actual failure patterns
3. Add more E2E tests using established patterns
4. Consider adding service warm-up health checks to CI pipeline
5. Document any new retry patterns that emerge
