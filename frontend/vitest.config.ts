import { defineConfig, coverageConfigDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Pool config at root level (Vitest 4+)
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: true  // Run all tests in single fork for CI stability
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // CI-specific settings
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 1000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.spec.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/types.ts',
        '**/*.d.ts',
        ...coverageConfigDefaults.exclude
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
