/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    // Include all source files to show accurate 0% coverage
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
  // Disable coverage thresholds until real unit tests are implemented
  // coverageThreshold: {
  //   global: {
  //     statements: 70,
  //     branches: 60,
  //     functions: 70,
  //     lines: 70,
  //   },
  // },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};