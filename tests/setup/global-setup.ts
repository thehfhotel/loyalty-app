import { chromium, FullConfig } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Global E2E Test Setup
 * Configures test environment variables and starts required services
 */
async function globalSetup(config: FullConfig) {
  console.log('🚀 Setting up E2E test environment...');

  // Set E2E environment variables with correct ports
  process.env.E2E_BACKEND_PORT = process.env.E2E_BACKEND_PORT || '4202';
  process.env.E2E_DB_PORT = process.env.E2E_DB_PORT || '5436';
  process.env.E2E_REDIS_PORT = process.env.E2E_REDIS_PORT || '6381';

  // Set service URLs for tests
  process.env.BACKEND_URL = `http://localhost:${process.env.E2E_BACKEND_PORT}`;
  process.env.API_BASE_URL = `${process.env.BACKEND_URL}/api`;

  console.log('📋 E2E Configuration:');
  console.log(`  Backend: ${process.env.BACKEND_URL}`);
  console.log(`  API: ${process.env.API_BASE_URL}`);

  // Clean up any existing E2E containers
  console.log('🧹 Cleaning up any existing E2E containers...');

  try {
    // Stop and remove E2E containers if they exist
    execSync('docker compose -f docker-compose.e2e.yml down -v --remove-orphans', {
      stdio: 'inherit',
      cwd: process.cwd()
    });
  } catch (error) {
    console.log('No existing E2E containers to clean up');
  }

  // Clean up ports to avoid conflicts
  console.log('🔧 Cleaning up E2E ports...');
  const ports = [
    process.env.E2E_BACKEND_PORT,
    process.env.E2E_DB_PORT,
    process.env.E2E_REDIS_PORT
  ];

  for (const port of ports) {
    try {
      const pid = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (pid) {
        console.log(`Killing process on port ${port}: ${pid}`);
        execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'inherit' });
      }
    } catch (error) {
      // Port not in use, which is fine
    }
  }

  // Build E2E services first (separate from up to avoid dependency issues)
  console.log('🔨 Building E2E services...');
  try {
    execSync(`docker compose -f docker-compose.e2e.yml build`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 300000 // 5 minutes
    });
  } catch (error) {
    console.error('❌ Failed to build E2E services:', error);
    throw error;
  }

  // Start E2E services (without --build to avoid dependency resolution issues)
  console.log('🐳 Starting E2E services with Docker Compose...');
  try {
    execSync(`docker compose -f docker-compose.e2e.yml up -d`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 120000 // 2 minutes (faster since build is already done)
    });
  } catch (error) {
    console.error('❌ Failed to start E2E services:', error);
    throw error;
  }

  // Wait for services to be healthy
  console.log('⏳ Waiting for services to be healthy...');
  const maxWaitTime = 120000; // 2 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const healthResult = execSync(
        'docker compose -f docker-compose.e2e.yml ps --format "table {{.Name}}\t{{.Status}}"',
        { encoding: 'utf8', cwd: process.cwd() }
      );

      const services = healthResult.split('\n').slice(1).filter(line => line.trim());
      const healthyServices = services.filter(line => line.includes('healthy'));

      console.log(`Services ready: ${healthyServices.length}/${services.length}`);

      if (healthyServices.length === 3) { // postgres, redis, backend
        console.log('✅ All E2E services are healthy!');
        break;
      }

      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Services did not become healthy within timeout period');
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.log('Checking service health...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log('🎯 E2E environment setup complete!');
}

export default globalSetup;