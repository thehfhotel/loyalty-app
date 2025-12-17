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
  fullyParallel: false, // Sequential for E2E to avoid conflicts

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Disable test-level retries - rely on request-level retries instead for faster feedback */
  retries: 0,  // Disabled: request-level retries handle transient failures more efficiently

  /* Use single worker for consistent test execution */
  workers: 1,

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

    /* Timeout for each action */
    actionTimeout: 10000,  // 10s for browser actions
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'api',
      use: { baseURL: BACKEND_URL },
      testMatch: /.*\.api\.spec\.ts/,
    },
    {
      name: 'browser',
      use: {
        baseURL: FRONTEND_URL,
        ...devices['Desktop Chrome'],
      },
      testMatch: /.*\.browser\.spec\.ts/,
    },
  ],

  /* Global timeout settings */
  timeout: 20000, // 20s per test
  expect: {
    timeout: 10000, // 10 seconds for assertions (browser needs more time)
  },
});
