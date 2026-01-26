# 🔒 CLAUDE.md - Critical Project Rules

## ⚠️ MANDATORY RULES - NEVER VIOLATE

### 1. Docker Compose Syntax
**Use:** `docker compose` (space) **Never:** `docker-compose` (hyphen)

```bash
# ✅ CORRECT
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# ❌ WRONG
docker-compose up -d
```

### 2. Git Hooks are MANDATORY
```bash
# ❌ FORBIDDEN
git commit --no-verify
git push --no-verify

# ✅ CORRECT - Let hooks run
git commit -m "feat: description"
git push
```

### 3. NEVER Merge PRs Automatically
**Human review is REQUIRED for all pull requests**

```bash
# ❌ FORBIDDEN - Auto-merge or self-merge
gh pr merge --auto
gh pr merge <PR_NUMBER>  # Without human review

# ✅ CORRECT - Create PR and wait for human review
gh pr create --title "feat: description" --body "..."
# Then STOP - let human review and merge
```

**Why:**
- Code review catches bugs, security issues, and design problems
- Auto-merge bypasses the safety net of peer review
- Even "simple" changes can have unintended consequences

### 4. Testing Integrity is ABSOLUTE
```bash
# ❌ FORBIDDEN
test.skip('test')
expect(true).toBe(true)  # Meaningless
if (process.env.SKIP_TESTS) return;

# ✅ CORRECT
expect(actualResult).toBe(expectedResult)
```

### 5. Path Handling
- **Prefer absolute paths** in CI/CD
- **Validate relative paths** (especially `../` and `../../`)
- Test paths work in both local and CI/CD environments

### 6. Database Access
**NEVER direct database access - ALWAYS use backend APIs**

```bash
# ❌ FORBIDDEN
psql -c "UPDATE user_loyalty..."

# ✅ CORRECT
curl -X POST http://localhost:4001/api/loyalty/award-points
```

**If API doesn't exist, CREATE IT first.**

## 📋 Project Architecture

### Structure
```
loyalty-app/
├── backend/          # Node.js/Express API
├── frontend/         # React/TypeScript SPA
├── scripts/          # Production scripts
├── tests/            # E2E tests
└── docker-compose.*  # Environment configs
```

### Branching Model: Trunk-Based Development

**Single branch workflow:**
- `main` is the only long-lived branch
- Feature branches merge directly to `main` via PR
- All pushes to `main` trigger: Tests → Build → Staging → Production

**Deployment flow:**
```
Feature Branch → PR → main → Tests → Build GHCR → Staging → Production (approval)
```

### Environment Configuration

**Two deployment environments (plus local):**

| Component | Local Dev | Staging | Production |
|-----------|-----------|---------|------------|
| **Compose File** | `docker-compose.yml` | `+ docker-compose.dev.yml` | `+ docker-compose.prod.yml` |
| **Container Suffix** | (none) | `_dev` | `_production` |
| **Nginx Port** | - | 5001 | 4001 |
| **PostgreSQL Port** | - | 5435 | 5434 |
| **Redis Port** | - | 6380 | 6379 |
| **Database Name** | `loyalty_db` | `loyalty_dev_db` | `loyalty_db` |
| **Docker Target** | `development` | `runner` | `runner` |
| **Deploy Path** | `/home/nut/loyalty-app` | `/home/nut/loyalty-app-develop` | `/home/nut/loyalty-app-production` |
| **GitHub Environment** | - | `staging` | `production` |

**Why 2 deployment environments?**
- Staging validates changes before production
- Production requires manual approval
- Both use GHCR images (no source code on server)
- Port isolation prevents conflicts

### CI/CD Test Port Isolation

**CRITICAL: All test environments use UNIQUE ports to prevent conflicts**

| Test Type | PostgreSQL | Redis | Backend | Frontend |
|-----------|------------|-------|---------|----------|
| **Unit Tests** | 5438 | 6383 | - | - |
| **Integration Tests** | 5437 | 6382 | - | - |
| **E2E Tests** | 5436 | 6381 | 4202 | 3201 |

**Why isolation matters:**
- Tests run in parallel with dev/prod environments
- Port conflicts cause test failures and deployment issues
- Each test type has its own isolated database and services

```bash
# Local development (base only, for IDE/testing)
docker compose up -d

# Staging server (deployed automatically from main)
# Uses GHCR images, deployed via GitHub Actions
cd /home/nut/loyalty-app-develop
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.dev.yml up -d

# Production (deployed from main with approval)
# Uses GHCR images, deployed via GitHub Actions
cd /home/nut/loyalty-app-production
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml -f docker-compose.prod.yml up -d
```

**Key Points:**
- **Trunk-based**: Only `main` branch, no `develop` branch
- Staging/Production use GHCR images (no source code on server)
- Deployment directories contain only: compose files, nginx config, .env, prisma schema
- Environment variables loaded from `.env` file created by GitHub Actions
- Production deployment requires manual approval in GitHub

### Database Operations

**Migration:**
- Single file: `backend/prisma/migrations/0_init/migration.sql`
- Commands: `npm run db:generate` → `npm run db:migrate`

**Automatic Seeding:**
- **Essential data** (runs in ALL environments on startup):
  - `membership_id_sequence` - Required for user registration
  - `tiers` - Required for loyalty system (Bronze/Silver/Gold/Platinum)
- **Sample data** (development only):
  - `surveys` - Test survey data
- Seeding is **automatic** on backend startup, no manual steps needed

**Tier System (Nights-Based):**
```
Bronze: 0+, Silver: 1+, Gold: 10+, Platinum: 20+ nights
```

**Key Functions:**
- `recalculate_user_tier_by_nights(user_id)` - Auto tier updates
- `award_points(...)` - Awards points/nights, triggers tier recalc

**Use stored procedures, never direct UPDATE queries.**

### TypeScript Error Handling

```typescript
// ✅ CORRECT
catch (error) {
  if (error instanceof Error) {
    console.log(error.message);
  } else {
    console.log('Unknown error:', String(error));
  }
}
```

### Frontend Dependencies

```dockerfile
# ✅ CORRECT - Install deps directly in target stage
FROM base AS development
RUN npm ci && npm cache clean --force

# ❌ FORBIDDEN - Multi-stage node_modules copying
COPY --from=dev-deps /app/node_modules ./node_modules
```

**CSS Framework:** Tailwind plugins in correct package.json section, validate before build.

### API Routes

Before creating frontend API calls:
1. Find backend route in router file
2. Check router mount path in `index.ts`
3. Construct full path: `/api/{mount-path}/{route-path}`
4. Test with curl

```typescript
// Example: router.get('/admin/settings') in user.ts
// Mounted: app.use('/api/users', userRoutes)
// Frontend: api.get('/users/admin/settings')
```

### E2E Testing

**E2E tests run in CI only.** The GitHub Actions workflow manages Docker containers.

**Ports:** Frontend: 3201, Backend: 4202, DB: 5436, Redis: 6381

**Docker Compose (CI):**
- Generated inline in `.github/workflows/deploy.yml`
- Services: postgres, redis, backend, frontend (all containerized)
- Uses host network mode for Docker-in-Docker compatibility
- E2E admin config (`backend/config/admins.e2e.json`) is mounted for test admin privileges

**Network Configuration:**
```yaml
# Required for Docker-in-Docker (GitHub self-hosted runners)
services:
  postgres:
    network_mode: host
    environment:
      PGPORT: 5436
  redis:
    network_mode: host
    command: redis-server --port 6381
  backend:
    network_mode: host
    volumes:
      - ./backend/config/admins.e2e.json:/app/config/admins.json:ro
    environment:
      PORT: 4202
      DATABASE_URL: postgresql://...@localhost:5436/...
      REDIS_URL: redis://localhost:6381
```

**Concurrency Control:**
- E2E tests run sequentially (one at a time) to prevent port conflicts
- Configured via `concurrency: { group: e2e-tests, cancel-in-progress: false }`
- Other jobs (unit, integration, security) still run in parallel

## 🔧 Development Standards

### Security
- Never log sensitive data (passwords, tokens, keys)
- Validate input (Zod schemas)
- Sanitize user content (prevent XSS)
- Parameterized queries (prevent SQL injection)
- Use stored procedures for complex operations
- **Log injection prevention**: Always use `sanitizeUserId()`, `sanitizeEmail()`, `sanitizeLogValue()` from `backend/src/utils/logSanitizer.ts` for user-controlled values in logs

### CodeQL Code Scanning

**Important Limitations:**
1. **JavaScript model packs don't support sanitizers** - CodeQL can't be taught to recognize custom sanitizer functions
2. **Inline comments (`// codeql[]`, `// lgtm[]`) don't work** with GitHub Code Scanning - only with CLI
3. **Dismiss false positives via API** when sanitizers are properly used:
   ```bash
   gh api -X PATCH repos/OWNER/REPO/code-scanning/alerts/NUMBER \
     -f state=dismissed -f dismissed_reason="false positive" \
     -f dismissed_comment="Sanitized via sanitizeUserId/sanitizeLogValue"
   ```

See `SECURITY.md` for full documentation.

### Git Commits
```
feat: Add feature
fix: Fix bug
improve: Enhance functionality
refactor: Restructure code
test: Add/update tests
docs: Update documentation
chore: Maintenance
```

### Testing Requirements
- Pass TypeScript compilation
- Pass ESLint (warnings OK, errors NOT OK)
- Pass ALL tests without bypassing
- Maintain code coverage
- Meaningful assertions only

### Environment Variables
- **Production:** `.env.production`
- **Development:** `.env` or `.env.development`
- **Never commit secrets**

## 📝 Quick Reference

```bash
# Local development
docker compose up -d

# Staging (auto-deployed from main)
# Managed by GitHub Actions - no manual deployment needed

# Production (deployed from main with approval)
# Managed by GitHub Actions - approve in GitHub UI

# Database
npm run db:generate && npm run db:migrate

# Git workflow (trunk-based)
git checkout -b feature/my-feature
# ... make changes ...
git commit -m "feat: description"  # Hooks run automatically
git push -u origin feature/my-feature
gh pr create --base main  # Create PR to main
# After merge: auto-deploy to staging, then approve for production

# Quality checks
npm run lint && npm run typecheck && npm run test
```

## ⚠️ NON-NEGOTIABLE

1. Use `docker compose` (never `docker-compose`)
2. Never bypass git hooks
3. Never bypass, skip, or fake tests
4. Prefer absolute paths, validate relative paths
5. Never direct database access - use APIs
6. Use environment-specific compose files
7. Use stored procedures for complex DB ops
8. Maintain code quality standards
9. Follow security best practices
10. Write meaningful tests

**Critical Facts:**
- Tiers based on `total_nights` NOT `current_points`
- **Trunk-based development**: Only `main` branch, no `develop`
- Both staging and production use `runner` Docker stage (GHCR images)
- Container names: Local has no suffix, staging has `_dev`, prod has `_production`
- Deployment directories have NO source code, only config files
- Staging deploys automatically, production requires approval

---

**Last Updated**: January 26, 2026
**Enforced By**: Git hooks, CI/CD pipeline, project conventions
**Compliance**: MANDATORY for all contributors
