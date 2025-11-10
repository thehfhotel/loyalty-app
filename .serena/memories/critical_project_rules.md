# Critical Project Rules (from CLAUDE.md)

These rules are **ABSOLUTE** and must be followed in all circumstances. No exceptions.

## 1. Docker Compose Command Syntax ✅
**ALWAYS USE:** `docker compose` (with space)  
**NEVER USE:** `docker-compose` (with hyphen)

**Why**: Docker Compose V2 uses `docker compose` as a Docker CLI plugin. The hyphenated version is deprecated.

**Examples:**
```bash
# ✅ CORRECT
docker compose up -d
docker compose down
docker compose ps
docker compose logs
docker compose exec backend npm test

# ❌ WRONG - NEVER USE
docker-compose up -d     # VIOLATION
docker-compose down      # VIOLATION
```

## 2. Git Hooks are MANDATORY 🚫
**NEVER bypass pre-commit or pre-push hooks**

```bash
# ❌ ABSOLUTELY FORBIDDEN
git commit --no-verify   # NEVER DO THIS
git push --no-verify     # NEVER DO THIS

# ✅ ALWAYS allow hooks to run
git commit -m "message"  # Let pre-commit run
git push                 # Let pre-push run
```

**Why**: Git hooks ensure code quality, security, and prevent broken code from entering the repository. Bypassing them compromises the entire quality assurance system.

## 3. Testing Integrity is ABSOLUTE 🧪
**NEVER bypass, skip, or fake any test**

```bash
# ❌ ABSOLUTELY FORBIDDEN - TEST BYPASSING EXAMPLES
if (true === true) { /* skip test logic */ }    # NEVER DO THIS
test.skip('important test')                     # FORBIDDEN
xit('critical test', () => {})                 # FORBIDDEN
it.skip('security test', () => {})             # FORBIDDEN
describe.skip('auth tests', () => {})          # FORBIDDEN
beforeAll(() => { process.exit(0); })         # FORBIDDEN
return true; // bypass test validation        # FORBIDDEN
jest.mock('critical-module', () => ({}))      # WITHOUT PROPER IMPLEMENTATION

# ❌ FORBIDDEN - FAKE TEST IMPLEMENTATIONS
expect(true).toBe(true)  // meaningless assertion
expect(1).toBe(1)        // trivial bypass
// TODO: implement test   // incomplete test

# ❌ FORBIDDEN - CONDITIONAL TEST BYPASSING
if (process.env.SKIP_TESTS) return;           # NEVER DO THIS
if (!isTestEnvironment) return;               # FORBIDDEN
if (Date.now() > someDate) return;            # TIME-BASED BYPASS FORBIDDEN

# ✅ CORRECT - ALL TESTS MUST RUN AND VALIDATE
expect(actualResult).toBe(expectedResult)     # Real validation
expect(userService.createUser).toHaveReturned() # Proper assertion
await expectAsync(promise).toBeRejected()     # Proper async testing
```

**Why**: Tests are the foundation of code reliability. Any bypassing, skipping, or fake implementations compromise system integrity and can hide critical bugs, security vulnerabilities, or breaking changes.

## 4. Path Handling Requirements 🛣️
**MANDATORY: Absolute Path Preference and Relative Path Validation**

**ALWAYS PREFER:** Absolute paths in CI/CD configurations  
**BE EXTREMELY CAREFUL:** With relative paths, especially `../` and `../../`

### Path Validation Requirements
Before using relative paths with `../` or `../../`:
1. Test locally from project root
2. Test in CI/CD from runner working directory
3. Document expected working directory
4. Add path existence checks where possible

**Why**: Path mismatches are a leading cause of CI/CD failures. Different working directories between local development and CI/CD runners can cause relative paths to resolve incorrectly.

## 5. Database Interaction Rules 🗄️
**MANDATORY: Never Directly Interact with Database - Always Use Backend APIs**

```bash
# ❌ NEVER connect directly to database for data operations
docker compose exec postgres psql -U loyalty -d loyalty_db
psql -h localhost -U user -d database

# ❌ NEVER run raw SQL for business operations
UPDATE user_loyalty SET current_points = 500 WHERE user_id = '...';
INSERT INTO points_transactions (...) VALUES (...);
DELETE FROM users WHERE id = '...';

# ✅ CORRECT - Use backend APIs for ALL data operations
curl -X POST "http://localhost:4001/api/loyalty/award-points" \
     -H "Content-Type: application/json" \
     -d '{"userId": "...", "points": 500, "reason": "Profile completion"}'
```

### When Backend API Doesn't Exist, CREATE IT:
```typescript
// ✅ REQUIRED - Create proper backend API endpoint
router.post('/admin/operation', requireAdmin, async (req, res, next) => {
  try {
    const result = await service.performOperation(req.body);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});
```

### Database Access Permitted ONLY For:
- Schema migrations (`npm run db:migrate`)
- Database setup/initialization
- Schema debugging (read-only inspection)
- Emergency disaster recovery (with documented approval)

**Why**: Direct database manipulation bypasses critical business logic, validation, transaction management, and data integrity functions. The recent points balance issue occurred because direct INSERT bypassed the `award_points()` stored procedure that maintains consistency between `points_transactions` and `user_loyalty` tables.

## 6. TypeScript Error Prevention Rules 🚨
**MANDATORY: Proper Error Handling to Prevent Build Failures**

```typescript
// ❌ FORBIDDEN - Unknown Error Types
try {
  // some operation
} catch (error) {
  console.log(error.message);  // TypeScript error: 'error' is of type 'unknown'
  throw new Error(error);      // TypeScript error!
}

// ✅ CORRECT - Explicit Type Checking
try {
  // some operation
} catch (error) {
  if (error instanceof Error) {
    console.log(error.message);
    throw new AppError(500, error.message);
  } else {
    console.log('Unknown error:', String(error));
    throw new AppError(500, `Unknown error: ${String(error)}`);
  }
}
```

## 7. Build System Requirements 🔧
**MANDATORY: Prisma Client Generation Before Build**

```bash
# ❌ FORBIDDEN - Building Without Prisma Generation
npm run build  # Without generating Prisma client first

# ✅ CORRECT - Proper Build Sequence
npm run db:generate  # Generate Prisma client
npm run build       # Then build application
```

## 8. E2E Testing Infrastructure Rules 🎭
**MANDATORY: Comprehensive E2E Test Isolation and Validation**

### Port Allocation Strategy
```bash
# ✅ CORRECT - Use non-conflicting E2E ports
E2E_FRONTEND_PORT: 3201   # Safe high port for frontend
E2E_BACKEND_PORT: 4202    # Safe high port for backend
E2E_DB_PORT: 5436        # Different from production 5434
E2E_REDIS_PORT: 6381     # Different from production 6379
```

### Configuration File Management
- Create file ONCE at the beginning
- Use variables for ALL port references
- Validate file exists before use
- Clean up after tests complete

**Why**: E2E tests failed repeatedly due to port conflicts, configuration inconsistencies, missing health check tools, and state persistence.

## 9. Frontend Dependency Management Rules 🎨
**MANDATORY: Consistent CSS Framework and Build Dependencies**

### Dockerfile Multi-Stage Strategy
```dockerfile
# ✅ CORRECT - Install dependencies directly in target stage
FROM base AS development
COPY package*.json ./
RUN npm ci && npm cache clean --force  # All deps in development
COPY . .
```

### CSS Framework Dependencies
```bash
# ✅ REQUIRED - Explicit CSS framework plugin installation
"dependencies": {
  "@tailwindcss/forms": "^0.5.10",    # PRODUCTION dependency
  "@tailwindcss/typography": "^0.5.10" # If used in production builds
}
```

**Why**: Tailwind CSS plugin errors occurred repeatedly when multi-stage Docker builds created inconsistent dependency environments.

## 10. API Route Path Consistency Rules 🔗
**MANDATORY: Frontend Service Paths Must Match Backend Route Definitions**

### Route Definition Verification
```bash
# ✅ REQUIRED - Before creating frontend service calls:
1. Check which router file contains the endpoint
2. Check how the router is mounted in index.ts
3. Construct full path: /api/{mount-path}/{route-path}
```

**Example:**
- Backend: `user.ts` has `router.get('/admin/settings')`
- Mount: `index.ts` has `app.use('/api/users', userRoutes)`
- Frontend: Must use `/users/admin/settings` (NOT `/admin/settings`)

**Why**: AxiosError 404 errors frequently occur when frontend services use incorrect API paths. Backend routes defined in router files are mounted under specific paths in index.ts, creating nested URLs that must be matched exactly.

## Enforcement

These rules are enforced through:
- **Git hooks**: Automatic validation on commit/push
- **CI/CD pipeline**: GitHub Actions validation
- **Code reviews**: Manual verification
- **manage.sh script**: Standardized operations
- **Serena memory**: Cross-session compliance tracking

## Violations Detection

The project includes automated violation detection:
```bash
# Detect Docker Compose violations
grep -r "docker-compose " . --exclude-dir=node_modules

# Detect git hook bypasses
git log --grep="--no-verify"

# Detect test bypassing patterns
grep -r "test.skip\|xit\|describe.skip" tests/ --include="*.ts"

# Detect direct database access in code
grep -r "psql\|pg_dump" . --exclude-dir=node_modules --include="*.ts" --include="*.sh"
```

## Recent Violations & Lessons Learned

### Points Balance Issue (Database Direct Access)
- **Violation**: Direct INSERT to `points_transactions` bypassing `award_points()` function
- **Impact**: Data inconsistency between `points_transactions` and `user_loyalty`
- **Lesson**: ALWAYS use backend APIs that call proper database functions

### CI/CD Path Failures
- **Violation**: Relative paths with `../` not validated for CI/CD environment
- **Impact**: Pipeline failures with "file not found" errors
- **Lesson**: Test relative paths in both local and CI/CD environments

### Tailwind Plugin Errors
- **Violation**: CSS plugins in wrong package.json section, multi-stage Docker issues
- **Impact**: Frontend build failures with missing module errors
- **Lesson**: Install all dependencies directly in target Docker stage

### OAuth 404 Errors
- **Violation**: Frontend using `/admin/endpoint` when backend mounted at `/users/admin/endpoint`
- **Impact**: API calls failing with 404 errors
- **Lesson**: Always verify full API path including router mount point
