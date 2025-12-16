import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 * See https://playwright.dev/docs/test-configuration
 */
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

  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,

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
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BACKEND_URL || 'http://localhost:4202',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Timeout for each action - reduced for faster failure detection */
    actionTimeout: 10000,  // Reduced from 30s for faster feedback
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Global timeout settings - reduced for faster failure detection */
  timeout: 30000, // Reduced from 60s to 30s per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },
});
