/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  // Allure reporting integration using custom environment that resolves Node env even when not hoisted
  testEnvironment: '<rootDir>/jest.allure.environment.js',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  // Enable caching for faster subsequent runs
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // Transform ESM .js files from packages like uuid v13+
    '^.+\\.js$': 'babel-jest',
  },
  // Transform ESM packages like uuid v13+ (uses ES modules)
  transformIgnorePatterns: [
    '/node_modules/(?!(uuid)/)',
  ],
  // Use v8 coverage provider instead of babel/istanbul (Node 24 compatible)
  coverageProvider: 'v8',
  collectCoverageFrom: [
    // Include all source files to show accurate coverage
    'src/**/*.ts',
    // Standard exclusions
    '!src/**/*.d.ts',
    '!src/generated/**',
    '!src/index.ts',
    '!src/test-prisma.ts',
    '!src/__tests__/**',  // Exclude all test files, fixtures, factories, utils
    '!src/types/**',
    '!src/routes/**',  // Routes are thin wrappers tested via integration tests
  ],
  // Coverage thresholds disabled - tracking via reports instead
  // Coverage is monitored but won't block CI/CD pipeline
  // See TEST_REPORTING.md for coverage strategy and goals
  // coverageThreshold: {
  //   global: {
  //     statements: 25,
  //     branches: 67.5,
  //     functions: 40,
  //     lines: 25,
  //   },
  // },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json', 'json-summary'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 5000,
  // Disable verbose in CI for faster output
  verbose: !process.env.CI,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  // Use more workers in CI (75%) vs local (50%)
  maxWorkers: process.env.CI ? '75%' : '50%',
};
