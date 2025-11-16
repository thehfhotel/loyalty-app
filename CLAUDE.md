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

### 3. Testing Integrity is ABSOLUTE
```bash
# ❌ FORBIDDEN
test.skip('test')
expect(true).toBe(true)  # Meaningless
if (process.env.SKIP_TESTS) return;

# ✅ CORRECT
expect(actualResult).toBe(expectedResult)
```

### 4. Path Handling
- **Prefer absolute paths** in CI/CD
- **Validate relative paths** (especially `../` and `../../`)
- Test paths work in both local and CI/CD environments

### 5. Database Access
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

### Environment Configuration

| Component | Development | Production |
|-----------|-------------|------------|
| **Nginx Port** | 5001 | 4001 |
| **PostgreSQL Port** | 5435 | 5434 |
| **Redis Port** | 6380 | 6379 |
| **Container Suffix** | `_dev` | (none) |
| **Database Name** | `loyalty_dev_db` | `loyalty_db` |
| **Docker Target** | `development` | `runner` |

```bash
# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Production (self-contained, no --env-file needed)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**Production Deployment:**
- All environment variables are hardcoded in `docker-compose.prod.yml`
- No manual steps or flags needed - deployment is fully self-contained
- GitHub Actions and manual deployments use the same command
- Environment variables are read from `.env.production` and baked into `docker-compose.prod.yml`

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

**Ports:** Frontend: 3201, Backend: 4202, DB: 5436, Redis: 6381

**Requirements:** Clean ports before tests, health checks with retry logic, clean volumes between runs.

#### Docker Compose Files

The project uses **two distinct** E2E docker-compose configurations:

**1. docker-compose.e2e.local.yml** - Local Development
- **Purpose**: Playwright test development and debugging
- **Usage**: `npm run test:e2e` (via Playwright's global-setup.ts)
- **Services**: postgres, redis, backend only
- **Frontend**: Run separately with `npm run dev` for hot-reload
- **Volume Mounts**: Yes (`./backend:/app`) for live code changes
- **Lifecycle**: Persistent (manually managed)
- **Location**: Committed to repository

**2. docker-compose.e2e.ci.yml** - CI/CD
- **Purpose**: GitHub Actions automated testing
- **Usage**: Generated inline in `.github/workflows/deploy.yml`
- **Services**: postgres, redis, backend, frontend (all containerized)
- **Frontend**: Containerized build (no hot-reload needed)
- **Volume Mounts**: No (immutable builds)
- **Lifecycle**: Generated → Used → Deleted per workflow run
- **Location**: NOT committed (generated, in .gitignore)

**CRITICAL: Both files MUST use identical network configuration:**
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
    environment:
      PORT: 4202
      DATABASE_URL: postgresql://...@localhost:5436/...
      REDIS_URL: redis://localhost:6381
```

**Why host network?**
- GitHub self-hosted runners run in Docker Compose (Docker-in-Docker)
- Host network ensures E2E containers can communicate reliably
- tmpfs mount (`/dev/shm:size=256m`) more reliable than `shm_size` in DinD

**Why two files?**
- Different services: Local dev doesn't need containerized frontend
- Different lifecycles: Local persistent, CI ephemeral
- Different volume needs: Local needs hot-reload, CI needs immutability

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
# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
npm run db:generate && npm run db:migrate
npm run quality:check

# Git workflow
git commit -m "feat: description"  # Hooks run automatically
git push

# Quality checks
npm run lint
npm run typecheck
npm run test
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
- Production uses `runner` stage, dev uses `development` stage
- Container names: Dev has `_dev` suffix, prod has none

---

**Last Updated**: November 15, 2025
**Enforced By**: Git hooks, CI/CD pipeline, project conventions
**Compliance**: MANDATORY for all contributors
