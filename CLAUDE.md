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

## 📋 Additional Project Conventions

### 5. Project Structure
```
loyalty-app/
├── backend/          # Node.js/Express API
├── frontend/         # React/TypeScript SPA
├── scripts/          # Production scripts
├── tests/           # E2E tests
└── manage.sh        # Centralized management script
```

### 6. Environment Variables
- **Production**: Always use `.env.production`
- **Development**: Use `.env` or `.env.development`
- **Never commit**: `.env` files with real secrets

### 7. Testing Requirements
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

### 8. Database Operations
- **Always use migrations**: Never modify database directly
- **Migration command**: `npm run db:migrate`
- **Generate Prisma client**: `npm run db:generate`

### 9. Security Best Practices
- **Never log sensitive data**: passwords, tokens, keys
- **Always validate input**: Use Zod schemas
- **Sanitize user content**: Prevent XSS attacks
- **Use parameterized queries**: Prevent SQL injection

### 10. Git Commit Convention
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

### 11. Pipeline & CI/CD
- **Single pipeline**: `deploy.yml` handles everything
- **Quality gates**: All tests must pass before deployment
- **Automatic deployment**: Only from main branch
- **Manual approval**: Required for production

### 12. Development Workflow
1. **Before starting**: Pull latest changes
2. **During development**: Run tests locally
3. **Before committing**: Ensure hooks pass
4. **Before pushing**: Run full quality check
5. **After merging**: Monitor pipeline status

### 13. 🚨 TypeScript Error Prevention Rules
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
5. **ALWAYS** maintain code quality standards
6. **ALWAYS** follow security best practices
7. **ALWAYS** write meaningful tests that validate actual functionality

---

**Last Updated**: December 2024  
**Enforced By**: Git hooks, CI/CD pipeline, and project conventions  
**Compliance**: MANDATORY for all contributors