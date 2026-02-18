import { FullConfig } from '@playwright/test';

/**
 * Global E2E Test Setup
 * Configures test environment variables and registers test users
 *
 * NOTE: E2E tests are intended to run in CI only.
 * The CI workflow (deploy.yml) handles Docker container orchestration.
 */
async function globalSetup(config: FullConfig) {
  console.log('Setting up E2E test environment...');

  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  console.log(`Environment: ${isCI ? 'CI/CD' : 'Local'}`);

  // Set E2E environment variables with correct ports
  process.env.E2E_BACKEND_PORT = process.env.E2E_BACKEND_PORT || '4202';
  process.env.E2E_DB_PORT = process.env.E2E_DB_PORT || '5436';
  process.env.E2E_REDIS_PORT = process.env.E2E_REDIS_PORT || '6381';

  // Set service URLs for tests
  process.env.BACKEND_URL = `http://localhost:${process.env.E2E_BACKEND_PORT}`;
  process.env.API_BASE_URL = `${process.env.BACKEND_URL}/api`;
  process.env.FRONTEND_URL = `http://localhost:3201`;

  console.log('E2E Configuration:');
  console.log(`  Backend: ${process.env.BACKEND_URL}`);
  console.log(`  API: ${process.env.API_BASE_URL}`);
  console.log(`  Frontend: ${process.env.FRONTEND_URL}`);

  if (!isCI) {
    console.log('Running outside CI - ensure E2E services are running manually');
    console.log('E2E tests are designed to run in CI where Docker services are provisioned by the workflow.');
  }

  // Register test users for browser tests
  await registerTestUsers(process.env.BACKEND_URL);

  console.log('E2E environment setup complete!');
}

/**
 * Register browser test users via the API.
 * These users are needed for loginViaUI in browser tests.
 * Registration is idempotent - already-registered users return 409 which we ignore.
 */
async function registerTestUsers(backendUrl: string) {
  const testUsers = [
    {
      email: 'e2e-browser@test.com',
      password: 'E2ETestPassword123!',
      firstName: 'E2E',
      lastName: 'Browser',
    },
    {
      email: 'e2e-browser-2@test.com',
      password: 'E2ETestPassword123!',
      firstName: 'E2E',
      lastName: 'Browser2',
    },
    {
      email: 'e2e-admin@test.local',
      password: 'AdminPassword123!',
      firstName: 'E2E',
      lastName: 'Admin',
    },
  ];

  console.log('Registering test users for browser tests...');

  for (const user of testUsers) {
    try {
      const response = await fetch(`${backendUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });

      if (response.ok) {
        console.log(`  Registered: ${user.email}`);
      } else if (response.status === 409) {
        console.log(`  Already exists: ${user.email}`);
      } else {
        console.log(`  Failed to register ${user.email}: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.log(`  Could not register ${user.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export default globalSetup;
