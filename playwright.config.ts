import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 * See https://playwright.dev/docs/test-configuration
 */
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4202';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3201';

export default defineConfig({
  /* Global setup and teardown for E2E environment configuration
   * Note: E2E tests are designed to run in CI where the workflow manages Docker containers.
   * Global setup configures environment variables.
   */
  globalSetup: './tests/setup/global-setup.ts',
  globalTeardown: './tests/setup/global-teardown.ts',
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true, // Enable parallel execution

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Disable test-level retries - rely on request-level retries instead for faster feedback */
  retries: 0,  // Disabled: request-level retries handle transient failures more efficiently

  /* Use multiple workers for faster execution */
  workers: 2,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['line'], // Console output for CI/local visibility
    ['allure-playwright', {
      outputFolder: 'allure-results',
      detail: true,
      suiteTitle: true,
    }],
  ],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'api',
      use: {
        baseURL: BACKEND_URL,
        // API requests need longer timeout than browser actions
        // This prevents POST requests from timing out during authentication
        extraHTTPHeaders: {
          'Accept': 'application/json',
        },
      },
      testMatch: /.*\.api\.spec\.ts/,
      // API tests run sequentially to prevent race conditions with auth
      fullyParallel: false,
      // Longer timeout for API tests (includes beforeAll hooks)
      timeout: 30000,
    },
    {
      name: 'browser',
      use: {
        baseURL: FRONTEND_URL,
        ...devices['Desktop Chrome'],
        // Browser actions timeout (clicks, fills, etc.)
        actionTimeout: 10000,
      },
      testMatch: /.*\.browser\.spec\.ts/,
      timeout: 30000, // 30s for browser tests (login can take time)
    },
  ],

  /* Global timeout settings */
  timeout: 20000, // 20s per test
  expect: {
    timeout: 10000, // 10 seconds for assertions (browser needs more time)
  },
});
