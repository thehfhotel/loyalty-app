/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
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
  // Re-enable coverage thresholds after fixing coverage tool
  coverageThreshold: {
    global: {
      statements: 42,
      branches: 35,
      functions: 42,
      lines: 42,
    },
  },
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