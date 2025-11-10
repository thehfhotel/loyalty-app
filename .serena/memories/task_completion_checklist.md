# Task Completion Checklist

When completing ANY development task, follow this checklist to ensure quality and project compliance.

## ⚠️ CRITICAL MANDATORY RULES

### 1. Docker Compose Command Syntax
- ✅ **ALWAYS USE**: `docker compose` (with space)
- ❌ **NEVER USE**: `docker-compose` (with hyphen)
- **Rationale**: Docker Compose V2 uses `docker compose` as CLI plugin

### 2. Git Hooks are MANDATORY
- ✅ **ALWAYS**: Let hooks run (`git commit`, `git push`)
- ❌ **NEVER**: Use `--no-verify` flag
- **Rationale**: Hooks ensure code quality and prevent broken code

### 3. Testing Integrity is ABSOLUTE
- ✅ **ALWAYS**: Write real tests with meaningful assertions
- ❌ **NEVER**: Skip, bypass, or fake tests
- ❌ **FORBIDDEN**: `test.skip()`, `xit()`, `expect(true).toBe(true)`
- **Rationale**: Tests are foundation of reliability

### 4. Database Interaction Rules
- ✅ **ALWAYS**: Use backend APIs for data operations
- ❌ **NEVER**: Direct database manipulation via SQL
- **Exception**: Schema migrations and read-only inspection only
- **Rationale**: APIs maintain business logic and data integrity

### 5. Path Handling Requirements
- ✅ **PREFER**: Absolute paths in configurations
- ⚠️ **VALIDATE**: Relative paths with `../` work in both local and CI/CD
- **Rationale**: Different working directories can cause path resolution failures

## Pre-Commit Checklist

### Code Quality
- [ ] TypeScript compilation passes (`npm run typecheck`)
- [ ] ESLint passes with no errors (`npm run lint`)
- [ ] All tests pass (`npm run test`)
- [ ] No console.log in production code (use logger)
- [ ] No sensitive data in code (passwords, keys, tokens)
- [ ] No `any` types without justification
- [ ] Error handling implemented properly

### Testing
- [ ] Unit tests written for new functions/methods
- [ ] Integration tests for API endpoints
- [ ] E2E tests for user-facing features (if applicable)
- [ ] All tests have meaningful assertions
- [ ] No test bypassing patterns (`.skip()`, `xit()`, conditional returns)
- [ ] Test coverage maintained or improved

### Security
- [ ] Input validation with Zod schemas
- [ ] SQL injection prevention (use Prisma parameterized queries)
- [ ] XSS prevention (sanitize user content)
- [ ] Authentication/authorization checks
- [ ] No hardcoded secrets or credentials
- [ ] Security audit passes (`npm run security:audit`)

### Database Changes
- [ ] Prisma client regenerated (`npm run db:generate`)
- [ ] Migrations created if schema changed
- [ ] Database validation passes (`npm run db:validate`)
- [ ] Rollback safety verified (`npm run db:rollback-check`)

## Pre-Push Checklist

### Full Quality Check
```bash
npm run pre-push  # Runs quality:check + security:audit
```

This includes:
- [ ] Backend + Frontend linting
- [ ] Backend + Frontend type checking
- [ ] Test integrity validation
- [ ] All unit tests
- [ ] All integration tests
- [ ] All E2E tests (on main branch)
- [ ] Security audit (npm audit)

### OAuth Features
- [ ] OAuth health check passes (`npm run oauth:health`)
- [ ] OAuth endpoints validated
- [ ] Rate limits functioning correctly

### Git Workflow
- [ ] Working on feature branch (not main/master directly)
- [ ] Commit messages follow convention (`feat:`, `fix:`, `improve:`, etc.)
- [ ] Pre-commit hooks executed successfully
- [ ] Pre-push hooks executed successfully
- [ ] No `--no-verify` flags used

## Post-Deployment Checklist

### Production Validation
- [ ] CI/CD pipeline passed all phases
- [ ] Database backup created automatically
- [ ] Migrations applied successfully
- [ ] Services health checks passed
- [ ] OAuth validation passed in production
- [ ] No errors in production logs

### Monitoring
- [ ] Application accessible at production URL
- [ ] Backend API responding correctly
- [ ] Frontend loading without errors
- [ ] Database connections stable
- [ ] Redis cache functioning

## Code Review Checklist

### Architecture & Design
- [ ] Follows project structure conventions
- [ ] Service layer properly separated from controllers
- [ ] Business logic in services, not controllers
- [ ] Proper error handling with try-catch
- [ ] No code duplication (DRY principle)

### Performance
- [ ] No N+1 queries (use Prisma includes)
- [ ] Proper database indexing considered
- [ ] Large datasets paginated
- [ ] Image optimization if uploading images
- [ ] Caching implemented where appropriate

### Documentation
- [ ] JSDoc comments for public APIs
- [ ] Complex logic explained with inline comments
- [ ] README updated if adding new features
- [ ] API documentation updated if endpoints changed

## Special Cases

### Prisma Schema Changes
1. Update `schema.prisma`
2. Run `npm run db:generate` to update Prisma client
3. Create migration: `npm run db:migrate`
4. Test migration rollback safety
5. Update TypeScript types if needed
6. Update tests for new schema

### API Route Changes
1. Define route in appropriate router file
2. Check router mounting in `index.ts`
3. Test endpoint with curl or Postman
4. Update frontend service with correct full path
5. Add integration tests
6. Update API documentation

### Frontend Component Changes
1. Ensure Tailwind plugins installed (`@tailwindcss/forms`)
2. Verify component renders in development
3. Test responsive behavior
4. Check accessibility (ARIA labels, keyboard navigation)
5. Test in different browsers if critical
6. Update parent components if props changed

### Environment Variable Changes
1. Add to `.env.example`
2. Add to `docker-compose.yml` if needed
3. Add to GitHub Actions secrets if production
4. Update `environment.ts` configuration
5. Document in ENVIRONMENT.md

## Quality Standards

### TypeScript
- Strict mode enabled
- No implicit any
- No unused variables or parameters
- Proper return types for functions
- Type guards for unknown errors

### ESLint
- Security rules must pass (no errors)
- Type safety rules must pass
- Code quality warnings addressed
- No disabled rules without justification

### Testing
- Unit test coverage >70%
- Integration tests for all API routes
- E2E tests for critical user flows
- All tests must validate actual functionality
- No trivial or bypass tests

### Git Commits
- Clear, descriptive commit messages
- Atomic commits (one logical change per commit)
- Follow conventional commits format
- All hooks executed successfully

## Emergency Procedures

### If Tests Fail
1. ❌ **NEVER** skip or disable tests
2. ✅ **ALWAYS** fix the underlying issue
3. If test is flaky, fix the flakiness
4. If test is wrong, fix the test
5. If code is broken, fix the code

### If Build Fails
1. Check Prisma client generation
2. Check TypeScript compilation errors
3. Check Docker Compose syntax
4. Verify error handling patterns
5. Review CI/CD logs for specific errors

### If Deployment Fails
1. Check CI/CD pipeline logs
2. Verify all quality gates passed
3. Check database migration status
4. Verify OAuth configuration
5. Review production environment variables

## Enforcement

These checks are enforced through:
- **Git Hooks**: Pre-commit and pre-push validation
- **CI/CD Pipeline**: Automated quality gates
- **Code Reviews**: Manual verification
- **Serena Memory**: Cross-session compliance tracking

## Quick Command Reference

```bash
# Full quality check (before committing)
npm run quality:check

# Full deployment validation (before pushing)
npm run deploy:validate

# Individual checks
npm run lint           # ESLint
npm run typecheck      # TypeScript
npm run test          # All tests
npm run test:integrity # Test bypass detection
npm run security:audit # Security audit
npm run oauth:health   # OAuth validation
npm run db:validate    # Database validation
```
