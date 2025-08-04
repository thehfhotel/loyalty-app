# 🧪 Testing & Quality Assurance Guide

## Overview

This project implements a comprehensive testing and quality assurance system that ensures code quality and prevents broken code from reaching production.

## 📋 Testing Structure

### Test Types

1. **Unit Tests** - Test individual functions and components in isolation
2. **Integration Tests** - Test database interactions and service integrations  
3. **End-to-End (E2E) Tests** - Test complete user workflows using Playwright

### Test Locations

```
loyalty-app/
├── backend/src/__tests__/
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   └── setup.ts              # Test configuration
├── tests/                    # E2E tests (Playwright)
│   └── *.spec.ts
└── frontend/src/__tests__/   # Frontend tests (future)
```

## 🚀 Running Tests

### From Project Root

```bash
# Run all tests
npm test

# Run specific test types
npm run test:unit         # Backend unit tests only
npm run test:integration  # Backend integration tests only
npm run test:e2e         # End-to-end tests only
npm run test:coverage    # Tests with coverage report

# Individual components
npm run test:backend     # All backend tests
npm run test:frontend    # Frontend tests (when implemented)
```

### From Backend Directory

```bash
cd backend

# Run all backend tests
npm test

# Run specific test patterns
npm run test:unit
npm run test:integration
npm run test:db          # Database-specific tests
npm run test:watch       # Watch mode for development
npm run test:coverage    # Generate coverage report
```

## 🔧 Quality Tools

### TypeScript Checking
```bash
npm run typecheck            # Check all projects
npm run typecheck:backend    # Backend only
npm run typecheck:frontend   # Frontend only
```

### Linting
```bash
npm run lint                 # Lint all projects
npm run lint:backend         # Backend ESLint
npm run lint:frontend        # Frontend ESLint
```

### Build Verification
```bash
npm run build               # Build all projects
npm run build:backend       # Backend build
npm run build:frontend      # Frontend build
```

### Security Auditing
```bash
npm run security:audit      # Check for vulnerabilities
```

### Complete Quality Check
```bash
npm run quality:check       # Run all quality checks
npm run pre-push           # Full quality gate
```

## 🪝 Git Hooks

### Pre-Commit Hook
Runs automatically on `git commit`:
- Quick TypeScript type checking
- ESLint on staged files
- Fast feedback for common issues

### Pre-Push Hook  
Runs automatically on `git push`:
- Complete TypeScript compilation
- Full ESLint checks on all files
- All unit tests
- All integration tests
- Build verification
- Security audit
- E2E tests (if app is running)

### Bypassing Hooks
```bash
# Skip pre-commit hook
git commit --no-verify

# Skip pre-push hook  
git push --no-verify

# ⚠️ Use sparingly and only in emergencies!
```

## 🔄 Continuous Integration

### GitHub Actions Workflows

**Unified CI/CD Pipeline** (`.github/workflows/deploy.yml`)
- **Phase 1**: Parallel quality validation (security analysis, unit/integration tests, E2E tests)
- **Phase 2**: Build validation (only on main branch)
- **Phase 3**: Production deployment (only on main branch, after all tests pass)
- **Phase 4**: Post-deployment monitoring and cleanup

**Quality Gates Integration**:
- ✅ TypeScript type checking
- ✅ ESLint security rules and code quality
- ✅ npm security audit
- ✅ Custom security validation
- ✅ Unit and integration tests
- ✅ E2E tests (conditional on main/PR to main)
- ✅ Build verification
- ✅ Coverage reporting

### Branch Protection

Recommended GitHub branch protection rules for `main`:
- Require pull request reviews
- Require status checks to pass (deploy.yml pipeline jobs)
- Require branches to be up to date
- Restrict pushes to matching branches

## 📊 Test Coverage

### Viewing Coverage Reports

```bash
# Generate and view coverage
cd backend
npm run test:coverage

# Coverage files location
backend/coverage/
├── lcov-report/index.html   # HTML report
├── lcov.info               # LCOV format
└── coverage-final.json     # JSON format
```

### Coverage Targets
- **Unit Tests**: >80% line coverage
- **Integration Tests**: >70% of critical paths
- **Combined**: >85% overall coverage

## 🛠️ Development Workflow

### Recommended Workflow

1. **Before Starting Work**
   ```bash
   git pull origin main
   npm run validate         # Ensure everything works
   ```

2. **During Development**
   ```bash
   npm run test:watch       # Run tests in watch mode
   npm run typecheck        # Check types frequently
   ```

3. **Before Committing**
   ```bash
   npm run quality:check    # Run full quality check
   git add .
   git commit -m "feat: your changes"  # Pre-commit hook runs
   ```

4. **Before Pushing**
   ```bash
   git push origin feature-branch  # Pre-push hook runs
   ```

## 🚨 Troubleshooting

### Common Issues

**TypeScript Errors**
```bash
# Regenerate Prisma client if needed
npm run db:generate

# Clear TypeScript cache
cd backend && npx tsc --build --clean
```

**Test Database Issues**
```bash
# Reset test database
cd backend && npm run db:migrate
```

**Hook Installation**
```bash
# Reinstall Git hooks
./scripts/install-hooks.sh
```

**E2E Test Issues**
```bash
# Install Playwright browsers
npx playwright install

# Run with UI for debugging
npx playwright test --ui
```

### Debugging Tests

**Unit/Integration Tests**
```bash
# Run specific test file
cd backend && npm test -- user.test.ts

# Run with debug output
cd backend && npm test -- --verbose

# Run single test
cd backend && npm test -- --testNamePattern="should create user"
```

**E2E Tests**
```bash
# Run in headed mode (see browser)
npx playwright test --headed

# Run specific test
npx playwright test health.spec.ts

# Generate test report
npx playwright show-report
```

## 📚 Writing Tests

### Unit Test Example
```typescript
// backend/src/__tests__/unit/services/userService.test.ts
import { UserService } from '../../../services/userService';

describe('UserService', () => {
  it('should create user successfully', async () => {
    const userService = new UserService();
    const userData = { email: 'test@example.com', ... };
    
    const user = await userService.createUser(userData);
    
    expect(user.email).toBe(userData.email);
    expect(user.id).toBeDefined();
  });
});
```

### Integration Test Example
```typescript
// backend/src/__tests__/integration/auth.test.ts
import { query } from '../../config/database';

describe('Authentication Integration', () => {
  it('should authenticate user with valid credentials', async () => {
    // Create test user in database
    const [user] = await query('INSERT INTO users ...');
    
    // Test authentication
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password' });
    
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});
```

### E2E Test Example
```typescript
// tests/user-flow.spec.ts
import { test, expect } from '@playwright/test';

test('user registration flow', async ({ page }) => {
  await page.goto('http://localhost:4001/register');
  
  await page.fill('[data-testid="email"]', 'test@example.com');
  await page.fill('[data-testid="password"]', 'password123');
  await page.click('[data-testid="submit"]');
  
  await expect(page).toHaveURL('/dashboard');
});
```

## 📈 Monitoring & Metrics

### Key Metrics
- Test execution time
- Coverage percentage
- Build success rate
- Deployment frequency
- Mean time to recovery (MTTR)

### Performance Targets
- Unit tests: <30 seconds
- Integration tests: <2 minutes  
- E2E tests: <5 minutes
- Full quality gate: <10 minutes

## 👥 Team Guidelines

### For All Developers
1. **Never bypass hooks** without good reason
2. **Write tests** for new features
3. **Maintain coverage** above targets
4. **Fix failing tests** immediately

### For Code Reviews
1. Check that tests are included
2. Verify test quality and coverage
3. Ensure CI passes before merging
4. Review test failure patterns

### For Deployments
1. All tests must pass
2. Security audit must be clean
3. Coverage requirements met
4. Manual testing completed

## 🔧 Configuration Files

- `jest.config.js` - Jest test configuration
- `playwright.config.js` - Playwright E2E configuration
- `.eslintrc.js` - ESLint rules and security checks
- `tsconfig.json` - TypeScript configuration
- Package.json scripts - Test automation commands