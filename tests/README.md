# E2E Test Suite Documentation

## Test Organization

The E2E test suite is organized into multiple files based on test requirements and OAuth configuration needs.

### Test Files

#### 1. `health.spec.ts`
Basic health checks and endpoint availability tests.
- **Requires OAuth:** No
- **Test Count:** 3
- **Purpose:** Validate backend health endpoint and basic API accessibility

#### 2. `build-validation.spec.ts`
Build integrity and TypeScript compilation validation.
- **Requires OAuth:** No
- **Test Count:** 17
- **Purpose:** Ensure Prisma client generation, TypeScript compilation, and build artifacts are correct

#### 3. `oauth-validation.configured.spec.ts`
OAuth flow tests requiring configured OAuth credentials.
- **Requires OAuth:** **YES** - Tests will be skipped if OAuth is not configured
- **Test Count:** 11
- **Purpose:** Test full OAuth flow with Google and LINE providers
- **Requirements:**
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in GitHub Secrets
  - `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` in GitHub Secrets
- **Tests Include:**
  - OAuth endpoint configuration validation
  - OAuth callback handling
  - Error message display
  - Timeout scenarios
  - Redirect loop prevention
  - Concurrent request handling

#### 4. `oauth-validation.unconfigured.spec.ts`
OAuth tests that work without configured OAuth credentials.
- **Requires OAuth:** No
- **Test Count:** 3
- **Purpose:** Test OAuth endpoints that function without external provider configuration
- **Tests Include:**
  - `/oauth/me` endpoint authentication requirements
  - Invalid token rejection
  - Malformed authorization header handling

#### 5. `oauth-validation.security.spec.ts`
OAuth security validation tests.
- **Requires OAuth:** No (but some tests are environment-specific)
- **Test Count:** 3
- **Purpose:** Validate security measures regardless of OAuth configuration
- **Tests Include:**
  - HTTPS enforcement in production
  - Cloudflare Tunnel proxy header handling
  - Redirect URI security (open redirect prevention)

## OAuth Configuration Detection

The `oauth-validation.configured.spec.ts` suite automatically detects OAuth configuration:

```typescript
// In beforeAll hook
const googleResponse = await request.get(`${baseUrl}/api/oauth/google`);
if (googleResponse.status() === 302) {
  const location = googleResponse.headers()['location'];
  isOAuthConfigured = location?.includes('accounts.google.com') ?? false;
}
```

- **If OAuth is configured:** All 11 tests run
- **If OAuth is NOT configured:** All tests are skipped with message: `"OAuth not configured in this environment"`

## GitHub Secrets Configuration

### Required Secrets for Full OAuth Testing

Add these secrets in your GitHub repository settings (Settings → Secrets and variables → Actions):

1. **`GOOGLE_CLIENT_ID`** - Google OAuth Client ID
2. **`GOOGLE_CLIENT_SECRET`** - Google OAuth Client Secret
3. **`LINE_CHANNEL_ID`** - LINE OAuth Channel ID
4. **`LINE_CHANNEL_SECRET`** - LINE OAuth Channel Secret

### Workflow Integration

The E2E workflow (`deploy.yml`) automatically provides these secrets to the test environment:

```yaml
env:
  GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID || 'test-google-not-configured' }}
  GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET || 'test-google-secret-not-configured' }}
  LINE_CHANNEL_ID: ${{ secrets.LINE_CHANNEL_ID || 'test-line-not-configured' }}
  LINE_CHANNEL_SECRET: ${{ secrets.LINE_CHANNEL_SECRET || 'test-line-secret-not-configured' }}
```

**Fallback Behavior:**
- If secrets are not configured, placeholder values are used
- Tests detect the placeholders and skip accordingly
- No test failures occur due to missing OAuth configuration

## Local Development

### Running Tests Locally

#### Without OAuth Configuration
```bash
# Only unconfigured and security tests will run
# Configured OAuth tests will be skipped
npm run test:e2e
```

#### With OAuth Configuration
```bash
# Set environment variables in your shell or .env file
export GOOGLE_CLIENT_ID="your-google-client-id"
export GOOGLE_CLIENT_SECRET="your-google-client-secret"
export LINE_CHANNEL_ID="your-line-channel-id"
export LINE_CHANNEL_SECRET="your-line-channel-secret"

# All OAuth tests will run
npm run test:e2e
```

### E2E Tests in CI Only

E2E tests are designed to run in CI/CD only. The GitHub Actions workflow handles Docker container orchestration automatically.

## CI/CD Environment

### E2E Infrastructure

The CI/CD pipeline creates an isolated E2E environment with:
- **PostgreSQL** on port `5436`
- **Redis** on port `6381`
- **Backend** on port `4202`
- **Frontend** on port `3201`

All services use **host network mode** for Docker-in-Docker compatibility.

### OAuth in CI

OAuth credentials are automatically injected from GitHub Secrets:
1. Workflow reads secrets from repository settings
2. Secrets are passed as environment variables to the step
3. Docker Compose file is generated with these variables
4. Backend container receives OAuth configuration
5. Tests detect configuration and run accordingly

## Test Execution Flow

```
1. Global Setup (tests/setup/global-setup.ts)
   ├─ Detect environment (CI vs Local)
   ├─ Select compose file (ci vs local)
   ├─ Clean up old containers/ports
   ├─ Build services
   ├─ Start services
   └─ Wait for health checks (4 services in CI, 3 in local)

2. Run Test Suites
   ├─ health.spec.ts (always runs)
   ├─ build-validation.spec.ts (always runs)
   ├─ oauth-validation.unconfigured.spec.ts (always runs)
   ├─ oauth-validation.security.spec.ts (always runs)
   └─ oauth-validation.configured.spec.ts (conditional)
       ├─ beforeAll: Detect OAuth configuration
       ├─ If configured: Run all 11 tests
       └─ If not configured: Skip all tests

3. Global Teardown (tests/setup/global-teardown.ts)
   ├─ Stop all E2E containers
   ├─ Remove volumes
   └─ Clean up resources
```

## Test Statistics

| Test Suite | Tests | Requires OAuth | Always Runs |
|------------|-------|----------------|-------------|
| health.spec.ts | 3 | No | ✅ Yes |
| build-validation.spec.ts | 17 | No | ✅ Yes |
| oauth-validation.unconfigured.spec.ts | 3 | No | ✅ Yes |
| oauth-validation.security.spec.ts | 3 | No | ✅ Yes |
| oauth-validation.configured.spec.ts | 11 | **YES** | ❌ Conditional |
| **Total** | **37** | - | **26 always, 11 conditional** |

## Troubleshooting

### OAuth Tests Always Skipped

**Symptom:** Configured OAuth tests show as skipped even with secrets configured.

**Possible Causes:**
1. GitHub Secrets not set in repository settings
2. Secrets have placeholder values (e.g., `'test-google-not-configured'`)
3. Backend not redirecting to actual OAuth providers
4. OAuth provider callback URLs not matching E2E environment URLs

**Solution:**
```bash
# Check backend logs
docker logs loyalty_backend_e2e

# Verify OAuth endpoint behavior
curl -I http://localhost:4202/api/oauth/google

# Should redirect to accounts.google.com if configured
```

### All Tests Failing

**Symptom:** All E2E tests fail, including health checks.

**Possible Causes:**
1. Services not starting (check global-setup logs)
2. Port conflicts (4202, 5436, 6381, 3201 already in use)
3. Docker-in-Docker issues in CI environment

**Solution:**
```bash
# Check service health
docker compose -f docker-compose.e2e.ci.yml ps

# Check logs
docker compose -f docker-compose.e2e.ci.yml logs backend
docker compose -f docker-compose.e2e.ci.yml logs postgres
```

### OAuth Tests Failing (Not Skipped)

**Symptom:** OAuth configured tests run but fail.

**Possible Causes:**
1. OAuth callback URLs don't match test environment
2. OAuth provider credentials are invalid
3. Network issues reaching OAuth providers

**Solution:**
- Verify callback URLs in OAuth provider console match `http://localhost:4202/api/oauth/{provider}/callback`
- Check OAuth credentials are correct
- Review backend logs for OAuth errors

## Best Practices

1. **Always configure OAuth secrets in GitHub** for comprehensive E2E coverage
2. **Use production OAuth credentials** for realistic testing (separate OAuth apps if needed)
3. **Monitor test results** - skipped tests indicate missing configuration
4. **Review backend logs** when OAuth tests fail to understand provider errors
5. **Keep callback URLs updated** if E2E ports change
6. **Test locally with OAuth** before pushing to ensure credentials work

## Migration from Old Test Suite

The original `oauth-validation.spec.ts` has been split into three files:
- **Before:** 16 tests in single file, all failed without OAuth
- **After:** 26 tests always run, 11 tests conditional on OAuth

**Migration completed:** Original file backed up as `oauth-validation.spec.ts.backup`

**Benefits:**
- ✅ Tests pass without OAuth configuration
- ✅ Clear separation of concerns
- ✅ Better test organization
- ✅ Automatic OAuth detection
- ✅ Graceful degradation
