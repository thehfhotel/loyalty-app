import { FullConfig } from '@playwright/test';

/**
 * Global E2E Test Teardown
 *
 * NOTE: E2E tests are intended to run in CI only.
 * The CI workflow (deploy.yml) handles Docker container cleanup.
 */
async function globalTeardown(config: FullConfig) {
  console.log('🧹 E2E test teardown...');
  console.log('✅ E2E environment teardown complete!');
}

export default globalTeardown;
