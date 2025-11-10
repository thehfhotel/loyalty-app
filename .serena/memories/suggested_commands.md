# Suggested Commands for Development

## 🚀 Quick Start Commands

### Start Development Environment
```bash
# Start all services (recommended)
docker compose up -d

# OR use the management script
./manage.sh start
```

### Stop Development Environment
```bash
# Stop all services
docker compose down

# OR with volume cleanup
docker compose down -v
```

## 🔨 Development Commands

### Backend Development
```bash
cd backend
npm run dev              # Start development server
npm run build           # Build for production
npm run typecheck       # Type checking only
npm run lint            # Run ESLint
npm run test           # Run all tests
npm run test:unit      # Run unit tests only
npm run test:integration # Run integration tests
npm run test:coverage  # Generate coverage report
```

### Frontend Development
```bash
cd frontend
npm run dev           # Start Vite dev server
npm run build         # Production build
npm run preview       # Preview production build
npm run typecheck     # Type checking only
npm run lint          # Run ESLint
npm run lint:fix      # Fix ESLint errors
```

### Database Commands
```bash
cd backend
npm run db:generate   # Generate Prisma client (REQUIRED before build)
npm run db:migrate    # Run migrations in development
npm run db:migrate:deploy # Deploy migrations to production
npm run db:migrate:status # Check migration status
npm run db:studio     # Open Prisma Studio GUI
npm run db:seed       # Seed database with initial data
```

## ✅ Quality Assurance Commands

### Run All Quality Checks (Pre-commit/Pre-push)
```bash
# From project root
npm run quality:check    # Lint + typecheck + test integrity + tests
npm run deploy:validate  # Full deployment validation
```

### Individual Quality Checks
```bash
npm run lint            # Lint backend + frontend
npm run typecheck       # Type check backend + frontend
npm run test           # Run all tests (unit + integration + E2E)
npm run test:unit      # Unit tests only
npm run test:integration # Integration tests only
npm run test:e2e       # E2E tests with Playwright
npm run test:integrity # Validate test integrity (no bypassing)
npm run security:audit # npm audit on all packages
```

### OAuth & Database Validation
```bash
npm run oauth:health        # Validate OAuth endpoints
npm run oauth:reset-limits  # Reset OAuth rate limits
npm run db:validate         # Validate database migrations
npm run db:backup          # Backup database
npm run db:rollback-check  # Check rollback safety
```

## 🐳 Docker Commands (MANDATORY SYNTAX)

### ⚠️ CRITICAL: Always use `docker compose` (with space), NEVER `docker-compose`
```bash
# ✅ CORRECT
docker compose up -d
docker compose down
docker compose ps
docker compose logs -f backend
docker compose exec backend bash
docker compose restart backend

# ❌ WRONG - NEVER USE
docker-compose up -d      # FORBIDDEN
docker-compose down       # FORBIDDEN
```

## 📊 Monitoring & Debugging

### View Logs
```bash
docker compose logs -f              # All services
docker compose logs -f backend     # Backend only
docker compose logs -f frontend    # Frontend only
docker compose logs --tail=100 backend # Last 100 lines
```

### Database Access (Schema Operations Only)
```bash
# Connect to PostgreSQL (read-only inspection, schema debugging)
docker compose exec postgres psql -U loyalty -d loyalty_db

# ⚠️ WARNING: NEVER use direct database access for data operations
# Always use backend APIs for data manipulation
```

### Redis Access
```bash
docker compose exec redis redis-cli
```

## 🧪 Testing Commands

### Build Validation Tests
```bash
npm run test:build-validation  # Validate Prisma, TypeScript, Docker Compose
```

### E2E Testing with Playwright
```bash
npx playwright test                    # Run all E2E tests
npx playwright test --ui              # Run with UI mode
npx playwright test --debug           # Run with debugger
npx playwright test tests/auth.spec.ts # Run specific test file
npx playwright show-report            # Show last test report
```

## 🔧 Management Script (./manage.sh)

### Interactive Menu
```bash
./manage.sh              # Show interactive menu
```

### Direct Commands
```bash
./manage.sh start        # Start services
./manage.sh stop         # Stop services
./manage.sh restart      # Restart services
./manage.sh status       # Show service status
./manage.sh logs         # View logs
./manage.sh test         # Run tests
./manage.sh quality      # Run quality checks
./manage.sh clean        # Clean build artifacts
```

## 📦 Installation Commands

### Initial Setup
```bash
# Install all dependencies (root + backend + frontend)
npm run install:all

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Build everything
npm run build
```

### Individual Package Installation
```bash
cd backend && npm install   # Backend dependencies
cd frontend && npm install  # Frontend dependencies
```

## 🚀 Pre-Push Checklist Commands
```bash
# Run before every git push (automated by git hooks)
npm run pre-push  # quality:check + security:audit
```

## 🔍 Useful System Commands (Linux)

### File Operations
```bash
ls -la              # List all files with details
find . -name "*.ts" # Find TypeScript files
grep -r "pattern" . # Search pattern in files
```

### Process Management
```bash
lsof -ti:4001      # Find process using port 4001
kill -9 <PID>      # Kill process by PID
```

### Git Operations (Hooks MANDATORY)
```bash
git status         # Check git status
git add .          # Stage changes
git commit -m "feat: description"  # Commit (pre-commit hook runs)
git push origin main               # Push (pre-push hook runs)

# ⚠️ NEVER bypass hooks
# FORBIDDEN: git commit --no-verify
# FORBIDDEN: git push --no-verify
```
