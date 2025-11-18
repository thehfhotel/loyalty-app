/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  // Allure reporting integration using custom environment that resolves Node env even when not hoisted
  testEnvironment: '<rootDir>/jest.allure.environment.js',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
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
    '!src/__tests__/**/*.test.ts',
    '!src/__tests__/setup.ts',
    '!src/types/**',
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
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  maxWorkers: '50%', // Enable parallel test execution
};
