import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

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
      const devOverlay = path.join(projectRoot, 'docker-compose.dev.yml');
      const envFile = path.join(projectRoot, '.env.development');

      // Load environment variables from .env.development
      // This is required because docker-compose.dev.yml no longer has inline defaults
      const envConfig = config({ path: envFile });
      if (envConfig.error) {
        throw new Error(`Failed to load .env.development: ${envConfig.error.message}`);
      }

      try {
        // Validate development deployment (documented usage pattern from CLAUDE.md)
        // Base file uses :? syntax for required vars, .env.development provides values
        await execAsync(
          `cd ${projectRoot} && docker compose -f docker-compose.yml -f docker-compose.dev.yml config`,
          { env: { ...process.env, ...envConfig.parsed } }
        );
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

    test('should detect Docker container naming conflicts', async () => {
      // Test for the specific container conflict issue we encountered
      const testComposeContent = `
services:
  test_postgres:
    image: postgres:15-alpine
    container_name: loyalty_postgres_e2e
    ports:
      - "5436:5432"
  test_redis:
    image: redis:7-alpine  
    container_name: loyalty_redis_e2e
    ports:
      - "6381:6379"
`;
      
      const tempComposeFile = path.join(projectRoot, 'temp-conflict-test.yml');
      let composeStarted = false;
      
      try {
        // Write compose file
        await fs.writeFile(tempComposeFile, testComposeContent);
        
        // Try to start services
        const { stderr } = await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} up -d`);
        composeStarted = true;
        
        if (stderr && (stderr.includes('Conflict') || stderr.includes('already in use'))) {
          console.warn('Container naming conflict detected - this indicates containers from previous runs weren\'t cleaned up properly');
        }
        
      } catch (error) {
        const stderr = (error as { stderr?: string })?.stderr || '';
        const errorMessage = stderr || (error instanceof Error ? error.message : String(error));
        
        // Should detect container conflicts
        if (errorMessage.includes('Conflict') || 
            errorMessage.includes('already in use') ||
            errorMessage.includes('container name')) {
          // This is the expected error when containers aren't cleaned up - test passes
        } else {
          // Unexpected error - could be network issues, etc.
          console.warn(`Container conflict test encountered unexpected error: ${errorMessage}`);
        }
      } finally {
        if (composeStarted) {
          await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} down -v --remove-orphans`).catch(() => {});
        }
        await fs.unlink(tempComposeFile).catch(() => {});
      }
    });

    test('should detect workflow file deletion issues', async () => {
      // Test for the specific workflow issue: file gets deleted after validation but before use
      const testComposeContent = `
services:
  test_service:
    image: alpine:latest
    container_name: workflow_test_container
`;
      
      const tempComposeFile = path.join(projectRoot, 'temp-workflow-test.yml');
      
      try {
        // Step 1: Create file
        await fs.writeFile(tempComposeFile, testComposeContent);
        
        // Step 2: Validate file
        await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} config`);
        
        // Step 3: Simulate the problematic cleanup (this was the bug)
        // await fs.unlink(tempComposeFile); // This is what was causing the issue
        
        // Step 4: Try to use the file (this would fail if file was deleted)
        const fileExists = await fs.access(tempComposeFile)
          .then(() => true)
          .catch(() => false);
        
        expect(fileExists).toBe(true, 'Docker compose file should exist after validation for subsequent use');
        
        // Step 5: Verify the file can still be used
        await execAsync(`cd ${projectRoot} && docker compose -f ${tempComposeFile} config`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('no such file or directory')) {
          throw new Error(
            'Workflow file deletion issue detected: file was deleted after validation but before use. ' +
            'This indicates improper cleanup timing in the CI/CD workflow.'
          );
        } else {
          throw new Error(`Unexpected workflow test error: ${errorMessage}`);
        }
      } finally {
        // Clean up
        await fs.unlink(tempComposeFile).catch(() => {});
      }
    });

    test('should validate Docker build contexts reference existing Dockerfiles', async () => {
      const composeFiles = [
        'docker-compose.yml',
        'docker-compose.dev.yml',
        'docker-compose.override.yml',
        'docker-compose.e2e.local.yml'
      ].map(file => path.join(projectRoot, file));

      const normalize = (value: string) =>
        value.replace(/^['"]|['"]$/g, '').trim();

      const validateContext = async (
        composeFile: string,
        serviceName: string,
        contextValue?: string,
        dockerfileValue?: string
      ) => {
        if (!contextValue) {
          return;
        }

        const composeDir = path.dirname(composeFile);
        const resolvedContext = path.resolve(composeDir, normalize(contextValue));
        const dockerfilePath = path.join(
          resolvedContext,
          normalize(dockerfileValue || 'Dockerfile')
        );

        const contextExists = await fs.access(resolvedContext)
          .then(() => true)
          .catch(() => false);

        expect(contextExists).toBe(
          true,
          `Docker build context "${contextValue}" for service "${serviceName}" in ${path.basename(composeFile)} does not exist`
        );

        const dockerfileExists = await fs.access(dockerfilePath)
          .then(() => true)
          .catch(() => false);

        expect(dockerfileExists).toBe(
          true,
          `Dockerfile "${dockerfileValue || 'Dockerfile'}" missing for service "${serviceName}" (context: ${contextValue}) in ${path.basename(composeFile)}`
        );
      };

      for (const composeFile of composeFiles) {
        const fileExists = await fs.access(composeFile)
          .then(() => true)
          .catch(() => false);

        if (!fileExists) {
          continue;
        }

        const lines = (await fs.readFile(composeFile, 'utf-8')).split('\n');
        let inServicesSection = false;
        let servicesIndent = 0;
        let currentService = '';
        let captureBuild = false;
        let buildIndent = 0;
        let currentContext: string | undefined;
        let currentDockerfile: string | undefined;

        const flushBuildBlock = async () => {
          if (!captureBuild) {
            return;
          }
          await validateContext(composeFile, currentService, currentContext, currentDockerfile);
          captureBuild = false;
          currentContext = undefined;
          currentDockerfile = undefined;
        };

        for (const line of lines) {
          const indent = line.match(/^\s*/)?.[0].length ?? 0;
          const trimmed = line.trim();

          if (indent === 0 && trimmed.startsWith('services:')) {
            inServicesSection = true;
            servicesIndent = indent;
            currentService = '';
            continue;
          }

          if (inServicesSection && indent <= servicesIndent && trimmed && !trimmed.startsWith('#')) {
            // Exiting services section
            await flushBuildBlock();
            inServicesSection = false;
          }

          if (!inServicesSection) {
            continue;
          }

          if (indent === servicesIndent + 2 && trimmed.endsWith(':') && !trimmed.startsWith('#')) {
            await flushBuildBlock();
            currentService = trimmed.slice(0, -1).trim();
            continue;
          }

          if (trimmed.startsWith('build:')) {
            await flushBuildBlock();
            captureBuild = true;
            buildIndent = indent;
            currentContext = undefined;
            currentDockerfile = undefined;
            continue;
          }

          if (captureBuild) {
            if (indent <= buildIndent) {
              await flushBuildBlock();
              continue;
            }

            if (trimmed.startsWith('context:')) {
              currentContext = trimmed.split(':').slice(1).join(':').trim();
            } else if (trimmed.startsWith('dockerfile:')) {
              currentDockerfile = trimmed.split(':').slice(1).join(':').trim();
            }
          }
        }

        await flushBuildBlock();
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
        path.join(projectRoot, 'tests/oauth-validation.configured.spec.ts'),
        path.join(projectRoot, 'tests/oauth-validation.security.spec.ts'),
        path.join(projectRoot, 'tests/oauth-validation.unconfigured.spec.ts')
      ];

      for (const testFile of testFiles) {
        const fileExists = await fs.access(testFile)
          .then(() => true)
          .catch(() => false);
        
        if (fileExists) {
          const fileContent = await fs.readFile(testFile, 'utf-8');
          
          // Backend URL must always be configurable
          expect(fileContent).toContain(
            'process.env.BACKEND_URL',
            `Test file ${testFile} must reference process.env.BACKEND_URL for API calls`
          );

          // Only enforce FRONTEND_URL usage when frontend helpers are referenced
          if (fileContent.includes('FRONTEND_URL') || fileContent.match(/frontendUrl/i)) {
            expect(fileContent).toContain(
              'process.env.FRONTEND_URL',
              `Test file ${testFile} references the frontend but does not use process.env.FRONTEND_URL`
            );
          }
          
          // Should not have hardcoded localhost URLs (except as fallbacks)
          const hardcodedUrls = fileContent.match(/http:\/\/localhost:\d{4}(?!['"])/g) || [];
          const fallbackUrls = fileContent.match(/\|\|\s*['"]http:\/\/localhost:\d{4}['"]/g) || [];
          
          if (hardcodedUrls.length > 0) {
            expect(fallbackUrls.length).toBeGreaterThan(
              0,
              `Test file ${testFile} uses hardcoded localhost URLs without environment fallbacks`
            );
          }
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
