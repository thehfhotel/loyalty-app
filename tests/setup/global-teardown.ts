import { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Global E2E Test Teardown
 * Cleans up test environment and stops services
 */
async function globalTeardown(config: FullConfig) {
  console.log('🧹 Tearing down E2E test environment...');

  try {
    // Stop and remove E2E containers
    console.log('🐳 Stopping E2E containers...');
    execSync('docker compose -f docker-compose.e2e.yml down -v --remove-orphans', {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    // Clean up any remaining test volumes
    console.log('🗑️ Cleaning up E2E volumes...');
    try {
      execSync('docker volume rm $(docker volume ls -q -f name=e2e) 2>/dev/null || true', {
        stdio: 'inherit'
      });
    } catch (error) {
      // No volumes to clean up
    }

    console.log('✅ E2E environment teardown complete!');
  } catch (error) {
    console.error('❌ Error during E2E teardown:', error);
  }
}

export default globalTeardown;