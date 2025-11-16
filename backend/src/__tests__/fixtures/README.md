# Test Fixtures Guide

Centralized test data and utilities for faster, more maintainable integration tests.

## Overview

Test fixtures provide pre-built, reusable test data and mock configurations to:
- **Reduce test execution time** - Pre-built data loads faster than creating on-the-fly
- **Improve maintainability** - Update fixtures in one place, not across 36+ test files
- **Ensure consistency** - Same data structures across all tests
- **Simplify test setup** - Less boilerplate in each test file

## Quick Start

### Basic Usage

```typescript
import {
  createTestApp,
  createTestCustomer,
  createMockAuthService,
  setupAuthServiceMocks,
} from '../fixtures';

describe('My Route Tests', () => {
  let app: Express;
  let authService: jest.Mocked<AuthService>;

  beforeAll(() => {
    // Create Express app with standard configuration
    app = createTestApp(myRoutes, '/api/my-route');
  });

  beforeEach(() => {
    // Create and setup mocked service
    authService = createMockAuthService();
    setupAuthServiceMocks(authService);
    jest.clearAllMocks();
  });

  it('should work with test data', async () => {
    const testUser = createTestCustomer({ email: 'custom@test.com' });
    // ... use testUser in test
  });
});
```

## Available Fixtures

### User Fixtures (`userFixtures.ts`)

Create test users with predefined roles and data:

```typescript
// Create a customer user
const customer = createTestCustomer();
// Override specific fields
const customCustomer = createTestCustomer({
  email: 'myemail@test.com',
  currentPoints: 5000
});

// Create an admin user
const admin = createTestAdmin();

// Create a super admin user
const superAdmin = createTestSuperAdmin();

// Create multiple users at once
const users = createTestUsers(5, 'customer'); // Creates 5 customers

// Create mock tokens
const tokens = createTestTokens('user-123');

// Create mock session
const session = createTestSession(customer);
```

**Default User Structure:**
```typescript
{
  id: string,
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  role: 'customer' | 'admin' | 'super_admin',
  membershipId: string,
  currentPoints: number,
  totalNights: number
}
```

### App Fixtures (`appFixtures.ts`)

Create Express apps and middleware for route testing:

```typescript
// Create test app with standard middleware
const app = createTestApp(routes, '/api/base-path');

// Create mock authentication middleware
const mockAuth = createMockAuthMiddleware('admin', 'user-123');
app.use(mockAuth);

// Create mock file upload middleware
const mockUpload = createMockMulterMiddleware();
app.use(mockUpload);

// Create custom error handler
const errorHandler = createMockErrorHandler();
app.use(errorHandler);
```

### Mock Factories (`mockFactories.ts`)

Create pre-configured mock service instances:

```typescript
// Create mocked AuthService
const authService = createMockAuthService();

// Setup with common implementations
setupAuthServiceMocks(authService);

// Create mocked UserService
const userService = createMockUserService();
setupUserServiceMocks(userService);

// Reset all mocks
resetServiceMocks(authService);
```

**Pre-configured Mock Behaviors:**

The `setupAuthServiceMocks()` automatically configures:
- `login()` - Returns mock user with tokens
- `register()` - Returns new user with tokens
- `verifyToken()` - Returns decoded user data

The `setupUserServiceMocks()` automatically configures:
- `getUserById()` - Returns test user
- `getUserByEmail()` - Returns test user
- `updateUser()` - Returns updated user

## Migration Guide

### Before (Without Fixtures)

```typescript
describe('Auth Tests', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    authService = new AuthService() as jest.Mocked<AuthService>;
    authService.login.mockResolvedValue({
      user: {
        id: 'test-user',
        email: 'test@example.com',
        role: 'customer'
      },
      accessToken: 'token',
      refreshToken: 'refresh'
    });
  });

  it('should login', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });
    // ...
  });
});
```

### After (With Fixtures)

```typescript
import { createTestApp, createMockAuthService, setupAuthServiceMocks } from '../fixtures';

describe('Auth Tests', () => {
  let app: Express;
  let authService: jest.Mocked<AuthService>;

  beforeAll(() => {
    app = createTestApp(authRoutes, '/api/auth');
  });

  beforeEach(() => {
    authService = createMockAuthService();
    setupAuthServiceMocks(authService);
  });

  it('should login', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });
    // ...
  });
});
```

**Benefits:**
- **8 lines reduced to 3** in setup
- **Consistent** app and service configuration
- **Easier to update** - change fixture, not 36 test files

## Performance Impact

### Before Fixtures
- Average test file setup: ~15-20 lines of boilerplate
- Duplicate mock configurations across 36 test files
- Inconsistent test data structures

### After Fixtures
- Average test file setup: ~5-8 lines
- Single source of truth for mocks
- Consistent, reusable test data

**Expected Improvements:**
- **Code reduction**: ~400 lines of boilerplate eliminated
- **Faster execution**: Pre-built fixtures load instantly
- **Easier maintenance**: Update once, affect all tests

## Best Practices

### DO:
✅ Use fixtures for common test scenarios
✅ Override fixture defaults when needed for specific tests
✅ Keep fixtures simple and focused
✅ Document custom fixture additions

### DON'T:
❌ Create test-specific fixtures (use overrides instead)
❌ Put business logic in fixtures (keep them pure data)
❌ Duplicate fixtures across different files
❌ Make fixtures too complex (they should be simple)

## Extending Fixtures

To add new fixtures:

1. Create new fixture file in `src/__tests__/fixtures/`
2. Export fixtures from the file
3. Add exports to `index.ts`
4. Document usage in this README

Example:
```typescript
// couponFixtures.ts
export const createTestCoupon = (overrides = {}) => ({
  id: 'test-coupon-123',
  code: 'TEST10',
  discount: 10,
  ...overrides
});

// index.ts
export { createTestCoupon } from './couponFixtures';
```

## Troubleshooting

### Fixture not found
Ensure you're importing from `../fixtures` or `../../fixtures` depending on test file location.

### Mock not working
Remember to call `setupXServiceMocks()` after creating the mock service.

### Test data conflicts
Use overrides to customize fixtures per-test:
```typescript
const user1 = createTestCustomer({ email: 'user1@test.com' });
const user2 = createTestCustomer({ email: 'user2@test.com' });
```

## Related Documentation

- [Jest Configuration](../../jest.config.js)
- [Integration Test Guide](../integration/README.md)
- [Test Reporting](../../../../claudedocs/TEST_REPORTING.md)
