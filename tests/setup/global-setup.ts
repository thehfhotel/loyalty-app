import { FullConfig } from '@playwright/test';

/**
 * Global E2E Test Setup
 * Configures test environment variables
 *
 * NOTE: E2E tests are intended to run in CI only.
 * The CI workflow (deploy.yml) handles Docker container orchestration.
 */
async function globalSetup(config: FullConfig) {
  console.log('🚀 Setting up E2E test environment...');

  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  console.log(`📦 Environment: ${isCI ? 'CI/CD' : 'Local'}`);

  // Set E2E environment variables with correct ports
  process.env.E2E_BACKEND_PORT = process.env.E2E_BACKEND_PORT || '4202';
  process.env.E2E_DB_PORT = process.env.E2E_DB_PORT || '5436';
  process.env.E2E_REDIS_PORT = process.env.E2E_REDIS_PORT || '6381';

  // Set service URLs for tests
  process.env.BACKEND_URL = `http://localhost:${process.env.E2E_BACKEND_PORT}`;
  process.env.API_BASE_URL = `${process.env.BACKEND_URL}/api`;
  process.env.FRONTEND_URL = `http://localhost:3201`;

  console.log('📋 E2E Configuration:');
  console.log(`  Backend: ${process.env.BACKEND_URL}`);
  console.log(`  API: ${process.env.API_BASE_URL}`);
  console.log(`  Frontend: ${process.env.FRONTEND_URL}`);

  if (!isCI) {
    console.log('⚠️  Running outside CI - ensure E2E services are running manually');
    console.log('   E2E tests are designed to run in CI where Docker services are provisioned by the workflow.');
  }

  console.log('🎯 E2E environment setup complete!');
}

export default globalSetup;
