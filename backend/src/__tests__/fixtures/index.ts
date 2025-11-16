/**
 * Test Fixtures Barrel Export
 * Central export for all test fixtures and utilities
 */

// User fixtures
export {
  createTestCustomer,
  createTestAdmin,
  createTestSuperAdmin,
  createTestUsers,
  createTestTokens,
  createTestSession,
  type TestUser,
} from './userFixtures';

// App fixtures
export {
  createTestApp,
  createMockAuthMiddleware,
  createMockMulterMiddleware,
  createMockErrorHandler,
} from './appFixtures';

// Mock factories
export {
  createMockAuthService,
  createMockUserService,
  createMockSurveyService,
  setupAuthServiceMocks,
  setupUserServiceMocks,
  setupSurveyServiceMocks,
  resetServiceMocks,
} from './mockFactories';
