# 🔒 CLAUDE.md - Critical Project Rules

## ⚠️ MANDATORY RULES - NEVER VIOLATE

These rules are **ABSOLUTE** and must be followed in all circumstances. No exceptions.

### 1. ✅ Docker Compose Command Syntax
**ALWAYS USE:** `docker compose` (with space)  
**NEVER USE:** `docker-compose` (with hyphen)

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

**Rationale**: Docker Compose V2 uses `docker compose` as a Docker CLI plugin. The hyphenated version is deprecated.

### 2. 🚫 Git Hooks are MANDATORY
**NEVER bypass pre-commit or pre-push hooks**

```bash
# ❌ ABSOLUTELY FORBIDDEN
git commit --no-verify   # NEVER DO THIS
git push --no-verify     # NEVER DO THIS

# ✅ ALWAYS allow hooks to run
git commit -m "message"  # Let pre-commit run
git push                 # Let pre-push run
```

**Rationale**: Git hooks ensure code quality, security, and prevent broken code from entering the repository. Bypassing them compromises the entire quality assurance system.

### 3. 🧪 Testing Integrity is ABSOLUTE
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

**Rationale**: Tests are the foundation of code reliability. Any bypassing, skipping, or fake implementations compromise system integrity and can hide critical bugs, security vulnerabilities, or breaking changes.

### 4. 🛣️ Path Handling Requirements
**MANDATORY: Absolute Path Preference and Relative Path Validation**

**ALWAYS PREFER:** Absolute paths in CI/CD configurations  
**BE EXTREMELY CAREFUL:** With relative paths, especially `../` and `../../`

#### ❌ FORBIDDEN - Risky Relative Path Usage
```yaml
# ❌ HIGH RISK - Different behavior between local and CI/CD
backend:
  build:
    context: ./backend        # May fail on CI/CD runners
    dockerfile: Dockerfile
    
frontend:
  build:
    context: ./frontend       # Context mismatch in different environments
    dockerfile: Dockerfile

# ❌ DANGEROUS - Parent directory references without validation
COPY ../shared /app/shared   # Dockerfile - may break in different build contexts
cd ../scripts && ./deploy.sh  # Shell script - working directory dependent
```

#### ✅ REQUIRED - Safe Path Practices
```yaml
# ✅ CORRECT - Absolute or carefully validated relative paths
backend:
  build:
    context: .                # Current directory context (validated)
    dockerfile: Dockerfile
    
frontend:
  build:
    context: ../frontend      # Parent reference with validation
    dockerfile: Dockerfile

# ✅ CORRECT - Explicit working directory management
- name: "Deploy from scripts directory"
  run: |
    cd /absolute/path/to/scripts
    ./deploy.sh
    
# ✅ CORRECT - Environment-aware path resolution
BACKEND_URL: ${BACKEND_URL:-http://localhost:4001}
FRONTEND_URL: ${FRONTEND_URL:-http://localhost:3000}
```

#### 🧪 Path Validation Requirements
**MANDATORY: Validate paths work in both environments**

Before using relative paths with `../` or `../../`:
1. **Test locally**: Verify path resolution from project root
2. **Test in CI/CD**: Verify path resolution from runner working directory
3. **Document assumptions**: Comment on expected working directory
4. **Add validation**: Include path existence checks where possible

```bash
# ✅ REQUIRED - Path validation in scripts
if [ ! -f "../frontend/package.json" ]; then
  echo "❌ Frontend directory not found at expected relative path"
  exit 1
fi

# ✅ REQUIRED - Working directory awareness
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}" || exit 1
```

#### 🐳 Docker Build Context Path Rules
**CRITICAL: Build context must match file structure**

```yaml
# ✅ CORRECT - Context matches Dockerfile location
services:
  backend:
    build:
      context: .              # From backend/ directory
      dockerfile: Dockerfile  # backend/Dockerfile exists
      
  frontend:
    build:
      context: ../frontend    # From backend/ to frontend/
      dockerfile: Dockerfile  # frontend/Dockerfile exists

# ❌ FORBIDDEN - Context/Dockerfile mismatch
services:
  backend:
    build:
      context: ./backend      # From project root
      dockerfile: Dockerfile  # Would look for project-root/backend/Dockerfile
```

#### 🔍 Common Path Issues to Avoid
Based on actual CI/CD failures encountered:

1. **Docker Build Context Mismatch**:
   - Error: `failed to read dockerfile: open Dockerfile: no such file or directory`
   - Cause: Build context pointing to wrong directory relative to Dockerfile
   - Solution: Ensure context path + dockerfile path resolves correctly

2. **Workflow File Deletion**:
   - Error: `no such file or directory` after validation
   - Cause: File deleted after validation but before use
   - Solution: Proper cleanup timing and file lifecycle management

3. **Cross-Platform Path Differences**:
   - Error: Different path resolution between local and CI/CD
   - Cause: Working directory assumptions don't match between environments
   - Solution: Explicit working directory management and path validation

**Rationale**: Path mismatches are a leading cause of CI/CD failures. Different working directories between local development and CI/CD runners can cause relative paths to resolve incorrectly, leading to "file not found" errors and build failures.

### 5. 🗄️ Database Interaction Rules
**MANDATORY: Never Directly Interact with Database - Always Use Backend APIs**

#### ❌ ABSOLUTELY FORBIDDEN - Direct Database Access
```bash
# ❌ NEVER connect directly to database for data operations
docker compose exec postgres psql -U loyalty -d loyalty_db
psql -h localhost -U user -d database

# ❌ NEVER run raw SQL for business operations
UPDATE user_loyalty SET current_points = 500 WHERE user_id = '...';
INSERT INTO points_transactions (...) VALUES (...);
DELETE FROM users WHERE id = '...';

# ❌ NEVER bypass backend APIs for data manipulation
# Even for debugging, testing, or "quick fixes"
```

#### ✅ REQUIRED - API-First Database Interactions
```bash
# ✅ CORRECT - Use backend APIs for ALL data operations
curl -X POST "http://localhost:4001/api/loyalty/award-points" \
     -H "Content-Type: application/json" \
     -d '{"userId": "...", "points": 500, "reason": "Profile completion"}'

# ✅ CORRECT - Create API endpoints if they don't exist
# 1. Create backend route in appropriate router file
# 2. Implement service method with proper validation
# 3. Test API endpoint thoroughly
# 4. Use API from frontend or tools
```

#### 🔧 API Development Requirements
**When backend API doesn't exist, CREATE IT:**

```typescript
// ✅ REQUIRED - Create proper backend API endpoint
// backend/src/routes/loyalty.ts
router.post('/admin/fix-user-points', requireAdmin, async (req, res, next) => {
  try {
    const { userId, correctPoints, reason } = req.body;
    
    // Validate input
    if (!userId || typeof correctPoints !== 'number') {
      return res.status(400).json({ error: 'Invalid input parameters' });
    }
    
    // Use service layer with proper business logic
    const result = await loyaltyService.fixUserPointsBalance(userId, correctPoints, reason);
    
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

// ✅ REQUIRED - Implement in service layer
async fixUserPointsBalance(userId: string, correctPoints: number, reason: string) {
  // Validate user exists
  const user = await this.getUserLoyaltyStatus(userId);
  if (!user) throw new Error('User not found');
  
  // Calculate difference and create adjustment transaction
  const pointsDifference = correctPoints - user.current_points;
  
  if (pointsDifference !== 0) {
    // Use proper award_points function that maintains integrity
    return this.awardPoints(
      userId, 
      pointsDifference, 
      'admin_adjustment', 
      reason,
      undefined, 
      adminUserId, 
      'Points balance correction'
    );
  }
  
  return { message: 'Points already correct', currentPoints: user.current_points };
}
```

#### 🛡️ Database Protection Measures

**1. Access Control**
```bash
# ✅ REQUIRED - Database access only for schema operations
# Direct database access permitted ONLY for:
- Schema migrations (npm run db:migrate)
- Database setup/initialization
- Schema debugging (read-only inspection)
- Emergency disaster recovery (with documented approval)
```

**2. API Completeness**
```typescript
// ✅ REQUIRED - Comprehensive API coverage
// Every database operation must have corresponding API:
- Create: POST /api/resource
- Read: GET /api/resource/:id
- Update: PUT/PATCH /api/resource/:id  
- Delete: DELETE /api/resource/:id
- Admin operations: POST /api/resource/admin/:operation
- Bulk operations: POST /api/resource/bulk
```

**3. Data Integrity Protection**
```typescript
// ✅ REQUIRED - Use database functions for complex operations
await loyaltyService.awardPoints(userId, points);  // Uses award_points() function
await loyaltyService.deductPoints(userId, points); // Maintains balance integrity
await userService.completeProfile(userId, data);   // Handles rewards properly
```

#### 🔍 Database Interaction Checklist
Before ANY database-related operation:
- [ ] Check if backend API endpoint exists for the operation
- [ ] If no API exists, create one following proper patterns
- [ ] Test API endpoint thoroughly with validation
- [ ] Use API instead of direct database access
- [ ] Document new API in appropriate documentation
- [ ] Never bypass APIs even for "quick fixes" or debugging

#### 🚨 Common Database Interaction Violations
1. **Direct SQL for Data Fixes**: Running UPDATE/INSERT commands directly
2. **Bypassing Business Logic**: Skipping validation and integrity checks
3. **Missing Transaction Context**: Not using proper database functions
4. **Emergency Shortcuts**: Using direct access during troubleshooting
5. **Development Convenience**: Quick data manipulation during testing

#### ⚡ Emergency Exception Protocol
**ONLY in extreme emergencies with proper documentation:**

```bash
# ✅ EMERGENCY PROTOCOL - Document everything
1. Document the emergency reason and timeline pressure
2. Document exactly what direct database operation was performed
3. Create GitHub issue to implement proper API endpoint
4. Add TODO comments linking to the issue
5. Implement proper API as immediate next priority
6. Test that new API produces same results as direct operation
```

**Rationale**: Direct database manipulation bypasses critical business logic, validation, transaction management, and data integrity functions. The recent points balance issue occurred because direct INSERT bypassed the `award_points()` stored procedure that maintains consistency between `points_transactions` and `user_loyalty` tables. All database interactions must go through properly designed APIs that maintain data integrity and business rules.

## 🔧 ESLint Migration Priority Plan

### ⚠️ CRITICAL PRIORITY: ESLint Configuration Technical Debt

The ESLint configuration has been systematically weakened by downgrading critical errors to warnings to allow pipeline passage. This represents **significant technical debt** and **security vulnerabilities** that must be addressed immediately.

**Security Rules Improperly Suppressed:**
- `security/detect-object-injection: 'warn'` → **~130 injection points** 
- `security/detect-child-process: 'warn'` → **Process injection risk**
- `security/detect-non-literal-fs-filename: 'warn'` → **File system attacks**

**Type Safety Issues:**
- `@typescript-eslint/no-explicit-any: 'warn'` → **~300 unsafe types**
- `@typescript-eslint/no-unused-vars: 'warn'` → **Dead code**

**React Critical Issues:**
- `react-hooks/exhaustive-deps: 'warn'` → **~28 stale closures**

### Implementation Plan Location
📋 **Full migration plan**: `/Users/nut/loyalty-app/ESLINT_MIGRATION_PLAN.md`

**Phase 1 (Week 1)**: Security Critical Rules → errors
**Phase 2 (Week 2)**: Type Safety Rules → errors  
**Phase 3 (Week 3)**: React Critical Rules → errors

This ESLint migration is **TOP PRIORITY** for codebase security and reliability.

## 📋 Additional Project Conventions

### 6. Project Structure
```
loyalty-app/
├── backend/          # Node.js/Express API
├── frontend/         # React/TypeScript SPA
├── scripts/          # Production scripts
├── tests/           # E2E tests
└── manage.sh        # Centralized management script
```

### 7. Environment Variables
- **Production**: Always use `.env.production`
- **Development**: Use `.env` or `.env.development`
- **Never commit**: `.env` files with real secrets

### 8. Testing Requirements
All code changes must:
- ✅ Pass TypeScript compilation
- ✅ Pass ESLint checks (warnings acceptable, errors not)
- ✅ Pass all unit tests **WITHOUT BYPASSING**
- ✅ Pass all integration tests **WITHOUT SKIPPING**
- ✅ Pass all E2E tests (when applicable)
- ✅ Maintain or improve code coverage
- ✅ Have meaningful assertions that validate actual functionality
- ❌ **NEVER** use trivial tests like `expect(true).toBe(true)`
- ❌ **NEVER** skip tests with `.skip()`, `xit()`, or conditional returns
- ❌ **NEVER** mock critical functionality without proper validation

### 9. Database Operations
- **Always use migrations**: Never modify database directly
- **Migration command**: `npm run db:migrate`
- **Generate Prisma client**: `npm run db:generate`

### 10. Security Best Practices
- **Never log sensitive data**: passwords, tokens, keys
- **Always validate input**: Use Zod schemas
- **Sanitize user content**: Prevent XSS attacks
- **Use parameterized queries**: Prevent SQL injection

### 11. Git Commit Convention
```bash
# Format: <type>: <description>
feat: Add new feature
fix: Fix bug
improve: Enhance existing functionality
refactor: Code restructuring
test: Add or update tests
docs: Documentation changes
chore: Maintenance tasks
```

### 12. Pipeline & CI/CD
- **Single pipeline**: `deploy.yml` handles everything
- **Quality gates**: All tests must pass before deployment
- **Automatic deployment**: Only from main branch
- **Manual approval**: Required for production

### 13. Development Workflow
1. **Before starting**: Pull latest changes
2. **During development**: Run tests locally
3. **Before committing**: Ensure hooks pass
4. **Before pushing**: Run full quality check
5. **After merging**: Monitor pipeline status

### 14. 🚨 TypeScript Error Prevention Rules
**MANDATORY: Proper Error Handling to Prevent Build Failures**

#### ❌ FORBIDDEN - Unknown Error Types
```typescript
// ❌ WILL CAUSE: error TS18046: 'error' is of type 'unknown'
try {
  // some operation
} catch (error) {
  console.log(error.message);  // TypeScript error!
  throw new Error(error);      // TypeScript error!
}
```

#### ✅ REQUIRED - Proper Error Type Handling
```typescript
// ✅ CORRECT - Explicit type checking
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

// ✅ CORRECT - Type assertion (when you're certain)
try {
  // some operation
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  throw new AppError(500, `Operation failed: ${errorMessage}`);
}

// ✅ CORRECT - Unknown parameter with proper handling
export const handleError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
```

#### 🔧 Build System Requirements
**MANDATORY: Prisma Client Generation Before Build**

#### ❌ FORBIDDEN - Building Without Prisma Generation
```bash
# ❌ WILL CAUSE: Cannot find module '../generated/prisma'
npm run build  # Without generating Prisma client first
```

#### ✅ REQUIRED - Proper Build Sequence
```bash
# ✅ CORRECT - Always generate Prisma client first
npm run db:generate  # Generate Prisma client
npm run build       # Then build application

# ✅ CORRECT - CI/CD pipeline must include:
- name: "Generate Prisma Client"
  run: cd backend && npm run db:generate
- name: "Build Application"  
  run: npm run build
```

#### 🐳 Docker Compose Validation Rules
**MANDATORY: Proper Docker Compose Syntax**

#### ❌ FORBIDDEN - Invalid Docker Compose Properties
```yaml
# ❌ WILL CAUSE: Additional property container_name is not allowed
volumes:
  backend:
    container_name: backend_container  # INVALID - containers only!
```

#### ✅ REQUIRED - Correct Docker Compose Structure
```yaml
# ✅ CORRECT - container_name only in services
services:
  backend:
    container_name: backend_container  # Valid location
    
volumes:
  backend_data:  # No container_name property allowed here
```

#### 🧪 Build Validation Testing
**MANDATORY: Tests to Prevent Build Failures**

All projects must include `tests/build-validation.spec.ts` with:
- ✅ Prisma client generation validation
- ✅ TypeScript compilation validation  
- ✅ Docker Compose syntax validation
- ✅ Error handling pattern detection
- ✅ CI/CD configuration validation

#### 🚨 Enforcement in CI/CD
**REQUIRED: Pipeline Build Validation Steps**

```yaml
# MANDATORY CI/CD steps to prevent build failures:
- name: "Validate Prisma Generation"
  run: |
    if [ ! -d "backend/src/generated/prisma" ]; then
      echo "❌ Prisma client not generated!"
      exit 1
    fi

- name: "Validate TypeScript Compilation"  
  run: |
    cd backend && npx tsc --noEmit
    cd ../frontend && npx tsc --noEmit

- name: "Validate Docker Compose"
  run: docker compose config
```

## 🚨 Enforcement

These rules are enforced through:
- **Git hooks**: Automatic validation on commit/push
- **CI/CD pipeline**: GitHub Actions validation
- **Code reviews**: Manual verification
- **manage.sh script**: Standardized operations

## 📝 Quick Reference Commands

```bash
# Docker operations (CORRECT SYNTAX)
docker compose up -d
docker compose down
docker compose ps
docker compose logs -f backend
docker compose exec backend bash
docker compose restart backend

# Git operations (WITH HOOKS)
git add .
git commit -m "feat: description"  # Pre-commit runs
git push origin main               # Pre-push runs

# Quality checks
npm run quality:check
npm run lint
npm run typecheck
npm run test

# Project management
./manage.sh              # Interactive menu
./manage.sh start        # Start services
./manage.sh test         # Run tests
./manage.sh quality      # Run quality checks
```

## ⚠️ REMINDER

**THESE RULES ARE NON-NEGOTIABLE**

1. **ALWAYS** use `docker compose` (never `docker-compose`)
2. **NEVER** bypass git hooks (`--no-verify` is FORBIDDEN)
3. **NEVER** bypass, skip, or fake any tests (test integrity is ABSOLUTE)
4. **ALWAYS** prefer absolute paths and validate relative paths with `../` or `../../`
5. **NEVER** interact directly with database - always use backend APIs (if API doesn't exist, create one)
6. **ALWAYS** maintain code quality standards
7. **ALWAYS** follow security best practices
8. **ALWAYS** write meaningful tests that validate actual functionality

### 15. 🎭 E2E Testing Infrastructure Rules
**MANDATORY: Comprehensive E2E Test Isolation and Validation**

#### ❌ FORBIDDEN - E2E Testing Anti-patterns
```bash
# ❌ NEVER use production ports for E2E tests
FRONTEND_PORT: 3000    # FORBIDDEN - conflicts with production
BACKEND_PORT: 4000     # FORBIDDEN - conflicts with production

# ❌ NEVER assume port availability without cleanup
docker compose up -d   # WITHOUT port cleanup

# ❌ NEVER create duplicate configurations
cat > docker-compose.yml << EOF   # Multiple times with different content

# ❌ NEVER skip container health validation
curl http://localhost:port  # WITHOUT proper retry logic
```

#### ✅ REQUIRED - E2E Testing Best Practices

**1. Port Allocation Strategy**
```bash
# ✅ CORRECT - Use non-conflicting E2E ports
E2E_FRONTEND_PORT: 3201   # Safe high port for frontend
E2E_BACKEND_PORT: 4202    # Safe high port for backend
E2E_DB_PORT: 5436        # Different from production 5434
E2E_REDIS_PORT: 6381     # Different from production 6379

# ✅ REQUIRED - Port cleanup before E2E tests
for port in 3201 4202 5436 6381; do
  pid=$(lsof -ti:$port 2>/dev/null || true)
  if [ ! -z "$pid" ]; then
    kill -9 $pid 2>/dev/null || true
  fi
done
```

**2. Configuration File Management**
```bash
# ✅ REQUIRED - Single source of truth for configurations
# If creating Docker compose files dynamically:
1. Create file ONCE at the beginning
2. Use variables for ALL port references
3. Validate file exists before use
4. Clean up after tests complete

# ✅ CORRECT - Consistent port usage
export E2E_FRONTEND_PORT="3201"
export E2E_BACKEND_PORT="4202"
# Use these variables EVERYWHERE
```

**3. Container Health Validation**
```bash
# ✅ REQUIRED - Proper health check dependencies
# For Alpine containers:
RUN apk add --no-cache curl

# ✅ REQUIRED - Robust connection testing
for i in {1..40}; do
  if curl -s http://localhost:${PORT}/health; then
    echo "✅ Service ready"
    break
  fi
  sleep 3
done
```

**4. Volume and State Management**
```bash
# ✅ REQUIRED - Clean state between runs
docker compose -f docker-compose.e2e.yml down -v
docker volume rm $(docker volume ls -q -f name=e2e) 2>/dev/null || true
```

**5. Path Resolution**
```bash
# ✅ REQUIRED - Explicit working directory
cd "${GITHUB_WORKSPACE}" || exit 1
# Use absolute paths or validate relative paths
```

#### 🔍 E2E Configuration Validation Checklist
Before running E2E tests, validate:
- [ ] All E2E ports are different from production ports
- [ ] Port variables are used consistently across ALL configurations
- [ ] Docker compose files are created exactly ONCE
- [ ] Container health checks have required tools (curl)
- [ ] Previous test volumes are cleaned up
- [ ] Retry logic exists for service readiness
- [ ] Working directories are explicitly set

#### 🚨 Common E2E Pitfalls to Avoid
1. **Port Assumption**: Never assume ports are free - always clean up
2. **Configuration Duplication**: Never create the same config file multiple times
3. **Partial Updates**: When changing ports, update ALL occurrences
4. **State Persistence**: Always clean volumes between test runs
5. **Path Ambiguity**: Always use absolute paths or validate context

**Rationale**: E2E tests failed repeatedly due to port conflicts, configuration inconsistencies, missing health check tools, and state persistence. These rules ensure complete isolation, consistent configuration, and reliable test execution.

### 16. 🎨 Frontend Dependency Management Rules
**MANDATORY: Consistent CSS Framework and Build Dependencies**

#### ❌ FORBIDDEN - Dependency Management Anti-patterns
```dockerfile
# ❌ NEVER rely on multi-stage node_modules copying for dev environments
COPY --from=dev-deps /app/node_modules ./node_modules  # UNRELIABLE

# ❌ NEVER mix production and development dependency stages
RUN npm ci --only=production  # Then expect dev tools to work

# ❌ NEVER assume CSS framework plugins are available without explicit installation
require('@tailwindcss/forms')  # WITHOUT ensuring it's installed in current stage
```

#### ✅ REQUIRED - Frontend Dependency Best Practices

**1. Dockerfile Multi-Stage Strategy**
```dockerfile
# ✅ CORRECT - Install dependencies directly in target stage
FROM base AS development
COPY package*.json ./
RUN npm ci && npm cache clean --force  # All deps in development
COPY . .

# ✅ CORRECT - Separate stages for different purposes
FROM base AS production
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
```

**2. CSS Framework Dependencies**
```bash
# ✅ REQUIRED - Explicit CSS framework plugin installation
# Always ensure Tailwind plugins are in correct dependency section:
"dependencies": {
  "@tailwindcss/forms": "^0.5.10",    # PRODUCTION dependency
  "@tailwindcss/typography": "^0.5.10" # If used in production builds
}

# ✅ REQUIRED - Validate CSS framework dependencies before build
npm ls @tailwindcss/forms @tailwindcss/typography
```

**3. Container Dependency Verification**
```bash
# ✅ REQUIRED - Pre-flight dependency check in containers
RUN npm ls || (echo "❌ Missing dependencies detected" && exit 1)

# ✅ REQUIRED - CSS framework plugin verification
RUN node -e "require('@tailwindcss/forms')" || (echo "❌ Tailwind plugins missing" && exit 1)
```

**4. Development Environment Consistency**
```bash
# ✅ REQUIRED - Consistent development setup
1. Use same Node version in Docker and local development
2. Install ALL dependencies in development stage (not just production)
3. Verify CSS framework plugins before starting dev server
4. Clear Docker build cache when dependency issues occur
```

#### 🔍 Frontend Dependency Validation Checklist
Before starting development or building:
- [ ] All CSS framework plugins are in correct package.json section
- [ ] Docker development stage installs ALL dependencies (not just production)
- [ ] Tailwind config plugins match installed packages
- [ ] Build process validates required dependencies exist
- [ ] Development containers don't rely on multi-stage node_modules copying

#### 🚨 Common Frontend Dependency Pitfalls
1. **Multi-Stage Confusion**: Copying node_modules between Docker stages causes inconsistencies
2. **Dependency Section Mismatch**: CSS plugins in wrong package.json section (dev vs prod)
3. **Build Cache Issues**: Stale Docker layers with outdated dependencies
4. **Runtime vs Build Environment**: Different dependency availability between build and runtime
5. **Plugin Configuration**: Requiring plugins that aren't installed in current stage

**Rationale**: Tailwind CSS plugin errors occurred repeatedly when multi-stage Docker builds created inconsistent dependency environments. Direct dependency installation in target stages prevents module resolution failures and ensures CSS framework plugins are available when needed.

### 17. 🔗 API Route Path Consistency Rules
**MANDATORY: Frontend Service Paths Must Match Backend Route Definitions**

#### ❌ FORBIDDEN - API Path Mismatches
```typescript
// ❌ FRONTEND assumes direct admin routes
adminService.get('/admin/new-member-coupon-settings')

// ❌ BACKEND defines routes under user router
router.get('/admin/new-member-coupon-settings')  // Actually at /api/users/admin/...
```

#### ✅ REQUIRED - API Path Best Practices

**1. Route Definition Verification**
```bash
# ✅ REQUIRED - Before creating frontend service calls:
1. Check which router file contains the endpoint
2. Check how the router is mounted in index.ts
3. Construct full path: /api/{mount-path}/{route-path}

# Example:
# If user.ts has: router.get('/admin/settings')
# And index.ts has: app.use('/api/users', userRoutes)
# Then frontend must use: '/users/admin/settings'
```

**2. Frontend Service Implementation**
```typescript
// ✅ CORRECT - Match actual backend route structure
export const adminService = {
  async getSettings() {
    // Check backend route mounting first!
    return api.get('/users/admin/settings');  // NOT '/admin/settings'
  }
}
```

**3. Route Testing Protocol**
```bash
# ✅ REQUIRED - Test routes before implementing frontend
curl -s http://localhost:4001/api/admin/endpoint  # Try direct path
curl -s http://localhost:4001/api/users/admin/endpoint  # Try nested path
curl -s http://localhost:4001/api/[router]/admin/endpoint  # Check router mounting
```

**4. Common Route Patterns**
```typescript
// Backend route definitions typically follow:
// router.ts: router.get('/admin/feature')
// index.ts: app.use('/api/entity', router)
// Result: /api/entity/admin/feature

// Admin routes commonly found in:
- /api/users/admin/*     # User management admin routes
- /api/coupons/admin/*   # Coupon admin routes
- /api/loyalty/admin/*   # Loyalty admin routes
```

#### 🔍 API Path Validation Checklist
Before implementing frontend API calls:
- [ ] Locate the backend route definition file
- [ ] Check how the router is mounted in index.ts
- [ ] Construct the full API path including mount point
- [ ] Test the endpoint with curl before coding
- [ ] Update frontend service to use correct full path

#### 🚨 Common API Path Pitfalls
1. **Assuming Direct Routes**: Frontend assumes `/api/admin/*` when routes are nested
2. **Missing Mount Path**: Forgetting router mount path from index.ts
3. **Inconsistent Patterns**: Different routers use different admin path patterns
4. **Documentation Gaps**: API paths not clearly documented
5. **Testing Shortcuts**: Implementing without testing actual endpoint

**Rationale**: AxiosError 404 errors frequently occur when frontend services use incorrect API paths. Backend routes defined in router files are mounted under specific paths in index.ts, creating nested URLs that must be matched exactly in frontend services.

---

**Last Updated**: August 2025  
**Enforced By**: Git hooks, CI/CD pipeline, and project conventions  
**Compliance**: MANDATORY for all contributors