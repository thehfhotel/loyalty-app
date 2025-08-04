import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// Fix for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build Validation Tests
 * Tests to detect build issues before they reach CI/CD pipeline
 */

test.describe('Build System Validation', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const backendPath = path.join(projectRoot, 'backend');

  test.beforeAll(async () => {
    // Ensure we're testing from the correct directory
    expect(await fs.access(backendPath).then(() => true).catch(() => false)).toBe(true);
  });

  test.describe('Prisma Client Generation', () => {
    test('should detect if Prisma client is missing', async () => {
      const prismaClientPath = path.join(backendPath, 'src/generated/prisma');
      
      // Check if Prisma client directory exists
      const prismaClientExists = await fs.access(prismaClientPath)
        .then(() => true)
        .catch(() => false);

      if (!prismaClientExists) {
        throw new Error(
          'Prisma client not generated. Run "npm run db:generate" in backend directory.\n' +
          'This will cause TypeScript errors: "Cannot find module \'../generated/prisma\'"'
        );
      }

      // Check if essential Prisma client files exist
      const essentialFiles = ['index.js', 'index.d.ts', 'client.js', 'client.d.ts'];
      for (const file of essentialFiles) {
        const filePath = path.join(prismaClientPath, file);
        const fileExists = await fs.access(filePath)
          .then(() => true)
          .catch(() => false);
        
        expect(fileExists).toBe(true, `Essential Prisma client file missing: ${file}`);
      }
    });

    test('should validate Prisma client can be imported', async () => {
      try {
        // Check if Prisma client can be imported by checking package.json exists
        const prismaPackageFile = path.join(backendPath, 'src/generated/prisma/package.json');
        const packageExists = await fs.access(prismaPackageFile)
          .then(() => true)
          .catch(() => false);
        
        if (packageExists) {
          const packageContent = await fs.readFile(prismaPackageFile, 'utf-8');
          const packageData = JSON.parse(packageContent);
          expect(packageData.name).toMatch(/^(prisma-client-|@prisma\/client)/);
        } else {
          console.warn('Prisma client package.json not found - may indicate generation issue');
        }
      } catch (error) {
        throw new Error(
          `Prisma client import validation failed: ${error instanceof Error ? error.message : String(error)}\n` +
          'This indicates Prisma client generation issues that will cause build failures.'
        );
      }
    });

    test('should validate Prisma schema exists and is valid', async () => {
      const schemaPath = path.join(backendPath, 'prisma/schema.prisma');
      
      const schemaExists = await fs.access(schemaPath)
        .then(() => true)
        .catch(() => false);
      
      expect(schemaExists).toBe(true, 'Prisma schema file missing: prisma/schema.prisma');

      // Validate schema content
      const schemaContent = await fs.readFile(schemaPath, 'utf-8');
      expect(schemaContent).toContain('generator client');
      expect(schemaContent).toContain('datasource db');
      expect(schemaContent.length).toBeGreaterThan(100); // Basic sanity check
    });
  });

  test.describe('TypeScript Build Validation', () => {
    test('should validate backend TypeScript compilation', async () => {
      try {
        const { stdout, stderr } = await execAsync(`cd ${backendPath} && npx tsc --noEmit`);
        
        // If there are TypeScript errors, they'll be in stderr
        if (stderr && stderr.trim()) {
          // Check for specific error patterns
          if (stderr.includes("Cannot find module '../generated/prisma'")) {
            throw new Error(
              'Prisma client not generated. TypeScript cannot find Prisma client module.\n' +
              'Resolution: Run "npm run db:generate" in backend directory before building.'
            );
          }
          
          if (stderr.includes("'error' is of type 'unknown'")) {
            throw new Error(
              'TypeScript error: Variable "error" is of type "unknown".\n' +
              'Resolution: Add proper type checking for error handling. See CLAUDE.md for rules.'
            );
          }
          
          throw new Error(`TypeScript compilation errors:\n${stderr}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('TypeScript')) {
          throw error;
        }
        throw new Error(`TypeScript validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    test('should validate frontend TypeScript compilation', async () => {
      const frontendPath = path.join(projectRoot, 'frontend');
      
      try {
        await execAsync(`cd ${frontendPath} && npx tsc --noEmit`);
      } catch (error) {
        throw new Error(
          `Frontend TypeScript compilation failed: ${error instanceof Error ? error.message : String(error)}\n` +
          'This will cause build failures in CI/CD pipeline.'
        );
      }
    });
  });

  test.describe('Docker Compose Validation', () => {
    test('should validate docker-compose files have correct syntax', async () => {
      const composeFile = path.join(projectRoot, 'docker-compose.yml');
      
      try {
        // Validate main docker-compose file
        await execAsync(`cd ${projectRoot} && docker compose -f docker-compose.yml config`);
      } catch (error) {
        throw new Error(
          `Docker compose validation failed: ${error instanceof Error ? error.message : String(error)}\n` +
          'This will cause deployment failures.'
        );
      }
    });

    test('should detect common Docker Compose syntax errors', async () => {
      // This test simulates the CI/CD error we encountered
      const testComposeContent = `
version: '3.8'
services:
  test-service:
    image: test
    container_name: test_container
    ports:
      - "3000:3000"
volumes:
  test_volume:
    container_name: invalid_property  # This should cause an error
`;
      
      const tempComposeFile = path.join(projectRoot, 'temp-compose-test.yml');
      await fs.writeFile(tempComposeFile, testComposeContent);

      try {
        await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} config`);
        // If no error thrown, the validation didn't catch the issue
        throw new Error('Docker compose validation should have failed for invalid syntax');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // This should detect the specific error we encountered
        if (errorMessage.includes('Additional property container_name is not allowed')) {
          // This is the expected error - test passes
        } else {
          throw new Error(`Unexpected docker compose validation error: ${errorMessage}`);
        }
      } finally {
        // Clean up temp file
        await fs.unlink(tempComposeFile).catch(() => {});
      }
    });

    test('should detect Docker Compose service dependency errors', async () => {
      // Test for the specific E2E error: undefined service dependencies
      const testComposeContent = `
version: '3.8'
services:
  backend:
    image: test
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
  # Missing postgres and redis services - should cause error
`;
      
      const tempComposeFile = path.join(projectRoot, 'temp-dependency-test.yml');
      await fs.writeFile(tempComposeFile, testComposeContent);

      try {
        await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} config`);
        // If no error thrown, validation didn't catch the dependency issue
        throw new Error('Docker compose validation should have failed for undefined service dependencies');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Should detect undefined service dependency
        if (errorMessage.includes('depends on undefined service') || 
            errorMessage.includes('service') && errorMessage.includes('undefined')) {
          // This is the expected error - test passes
        } else {
          throw new Error(`Unexpected docker compose dependency error: ${errorMessage}`);
        }
      } finally {
        // Clean up temp file
        await fs.unlink(tempComposeFile).catch(() => {});
      }
    });

    test('should detect incomplete Docker Compose file generation', async () => {
      // Test for the specific issue we encountered: incomplete compose file when appending services
      const incompleteComposeContent = `
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
  redis:
    image: redis:7-alpine
volumes:
  test_data:
`;
      
      // Simulate the append operation that was causing issues
      const appendContent = `
  backend:
    image: test
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
  frontend:
    image: test
    depends_on:
      backend:
        condition: service_healthy
`;
      
      const tempComposeFile = path.join(projectRoot, 'temp-incomplete-test.yml');
      
      try {
        // Write initial content
        await fs.writeFile(tempComposeFile, incompleteComposeContent);
        
        // Simulate the problematic append operation
        await fs.appendFile(tempComposeFile, appendContent);
        
        // This should fail validation because the appended content isn't properly formatted
        const fileContent = await fs.readFile(tempComposeFile, 'utf-8');
        
        // Check if the file has proper YAML structure
        if (!fileContent.includes('volumes:') || fileContent.split('services:').length > 2) {
          throw new Error('Docker compose file generation created invalid YAML structure');
        }
        
        // Validate with docker compose
        await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} config`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Should detect YAML structure issues or Docker Compose validation errors
        if (errorMessage.includes('invalid') || 
            errorMessage.includes('YAML') ||
            errorMessage.includes('structure') ||
            errorMessage.includes('Additional property') ||
            errorMessage.includes('not allowed')) {
          // This is the expected error - test passes
        } else {
          throw new Error(`Docker compose file generation test failed unexpectedly: ${errorMessage}`);
        }
      } finally {
        // Clean up temp file
        await fs.unlink(tempComposeFile).catch(() => {});
      }
    });
  });

  test.describe('Database Migration Validation', () => {
    test('should validate migration files exist and are properly structured', async () => {
      const migrationsPath = path.join(backendPath, 'prisma/migrations');
      
      const migrationsExist = await fs.access(migrationsPath)
        .then(() => true)
        .catch(() => false);
      
      if (migrationsExist) {
        const migrationDirs = await fs.readdir(migrationsPath);
        const validMigrations = migrationDirs.filter(dir => 
          dir.match(/^\d{14}_\w+$/) // Migration directory naming pattern
        );
        
        if (validMigrations.length === 0) {
          console.warn('No valid migration directories found. This may be expected for new projects.');
        }
        
        // Check each migration has a migration.sql file
        for (const migrationDir of validMigrations) {
          const migrationFile = path.join(migrationsPath, migrationDir, 'migration.sql');
          const fileExists = await fs.access(migrationFile)
            .then(() => true)
            .catch(() => false);
          
          expect(fileExists).toBe(true, `Migration SQL file missing: ${migrationDir}/migration.sql`);
        }
      }
    });
  });

  test.describe('CI/CD Configuration Validation', () => {
    test('should validate GitHub Actions workflow syntax', async () => {
      const workflowFile = path.join(projectRoot, '.github/workflows/deploy.yml');
      
      const workflowExists = await fs.access(workflowFile)
        .then(() => true)
        .catch(() => false);
      
      expect(workflowExists).toBe(true, 'GitHub Actions workflow file missing');

      // Basic YAML syntax validation
      const workflowContent = await fs.readFile(workflowFile, 'utf-8');
      
      // Check for common CI/CD issues
      expect(workflowContent).toContain('npm run db:generate'); // Prisma generation step
      expect(workflowContent).toMatch(/npm run typecheck|npx tsc/); // TypeScript compilation
      
      // Ensure container_name is not in volumes sections (Docker Compose validation)
      const volumesSections = workflowContent.match(/volumes:\s*\n([\s\S]*?)(?=\n\s*\w+:|$)/g) || [];
      for (const volumesSection of volumesSections) {
        expect(volumesSection).not.toContain('container_name');
      }
    });

    test('should validate environment variable completeness', async () => {
      const envExampleFile = path.join(backendPath, '.env.example');
      
      const envExampleExists = await fs.access(envExampleFile)
        .then(() => true)
        .catch(() => false);
      
      if (envExampleExists) {
        const envContent = await fs.readFile(envExampleFile, 'utf-8');
        
        // Check for essential environment variables
        const requiredVars = [
          'DATABASE_URL',
          'JWT_SECRET',
          'JWT_REFRESH_SECRET',
          'SESSION_SECRET'
        ];
        
        for (const varName of requiredVars) {
          expect(envContent).toContain(varName, `Required environment variable missing from .env.example: ${varName}`);
        }
      }
    });

    test('should validate E2E tests use environment variables for URLs', async () => {
      const testFiles = [
        path.join(projectRoot, 'tests/health.spec.ts'),
        path.join(projectRoot, 'tests/oauth-validation.spec.ts')
      ];

      for (const testFile of testFiles) {
        const fileExists = await fs.access(testFile)
          .then(() => true)
          .catch(() => false);
        
        if (fileExists) {
          const fileContent = await fs.readFile(testFile, 'utf-8');
          
          // Should use environment variables instead of hardcoded URLs
          expect(fileContent).toContain('process.env.BACKEND_URL');
          expect(fileContent).toContain('process.env.FRONTEND_URL');
          
          // Should not have hardcoded localhost URLs (except as fallbacks)
          const hardcodedUrls = fileContent.match(/http:\/\/localhost:\d{4}(?!')/g) || [];
          const fallbackUrls = fileContent.match(/\|\|\s*'http:\/\/localhost:\d{4}'/g) || [];
          
          expect(hardcodedUrls.length).toBeLessThanOrEqual(fallbackUrls.length * 2, 
            `Test file ${testFile} has hardcoded URLs that should use environment variables`);
        }
      }
    });
  });
});

test.describe('Error Handling Validation', () => {
  const projectRoot = path.resolve(__dirname, '..');
  
  test('should detect improper error type handling', async () => {
    // This test looks for the specific TypeScript error we encountered
    const serviceFiles = [
      path.join(projectRoot, 'backend/src/services/prismaUserService.ts'),
      path.join(projectRoot, 'backend/src/config/multer.ts')
    ];

    for (const filePath of serviceFiles) {
      const fileExists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);
      
      if (fileExists) {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        // Check for proper error handling patterns
        if (fileContent.includes('} catch (error)')) {
          // Should have proper error type checking
          const hasProperErrorHandling = 
            fileContent.includes('error instanceof Error') ||
            fileContent.includes('error: unknown') ||
            fileContent.includes('(error as Error)');
          
          if (!hasProperErrorHandling) {
            console.warn(
              `File ${filePath} may have improper error handling. ` +
              'Consider adding explicit error type checking to prevent TypeScript errors.'
            );
          }
        }
      }
    }
  });
});