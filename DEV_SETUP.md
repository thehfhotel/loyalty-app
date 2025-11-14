# 🛠️ Development Environment Setup

This guide explains how to set up the development environment on the same machine as production without port conflicts.

## 📋 Overview

The loyalty app supports running **both development and production** environments on the same machine using different port assignments:

| Environment | Nginx Port | PostgreSQL Port | Redis Port | Usage |
|-------------|------------|-----------------|------------|-------|
| **Development** | **5001** | **5435** | **6380** | Local development |
| **Production** | **4001** | **5434** | **6379** | Deployed via GitHub Actions |

## 🚀 Quick Start (Development)

### 1. Environment File Setup

The project uses **separate environment files** for dev and prod:
- **Development**: `.env.development` (port 5001, dev database)
- **Production**: `.env.production` (port 4001, prod database)

**Development file already exists** with proper configuration. No manual copying needed!

If you need to customize development settings, edit `.env.development`:

```bash
# .env.development is pre-configured for development
# Customize only if needed
nano .env.development
```

### 2. Verify Development Configuration

The `.env.development` file should contain:

```bash
# Key development settings (already configured)
NODE_ENV=development
FRONTEND_URL=http://localhost:5001
DATABASE_URL=postgresql://loyalty_dev:loyalty_dev_pass@postgres:5432/loyalty_dev_db

# Development secrets (safe for local use)
JWT_SECRET=dev_jwt_secret_not_for_production
LOYALTY_USERNAME=admin@dev.local
```

**Note**: The development file comes pre-configured with safe defaults. You only need to update OAuth credentials if using OAuth features.

### 3. Start Development Environment

```bash
# Start with development configuration
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# View logs
docker compose logs -f

# Stop services
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### 4. Access Development Application

- **Frontend**: http://localhost:5001
- **Backend API**: http://localhost:5001/api
- **Database**: localhost:5435 (external access)
- **Redis**: localhost:6380 (external access)

## 🔧 Configuration Files

### docker-compose.yml (Base)
- Shared configuration for all environments
- Defines service structure and dependencies

### docker-compose.dev.yml (Development Override)
- Development-specific port mappings (5001, 5435, 6380)
- Development database credentials
- Volume mounts for hot-reload
- Debug logging enabled

### docker-compose.prod.yml (Production Override)
- Production port mappings (4001, 5434, 6379)
- Production-optimized builds
- No external database/redis exposure
- Used by GitHub Actions deployment

## 📊 Port Assignment Details

### Development Ports (docker-compose.dev.yml)

```yaml
nginx:
  ports:
    - "5001:80"  # External access on port 5001

postgres:
  ports:
    - "5435:5432"  # External access on port 5435
  environment:
    POSTGRES_DB: loyalty_dev_db
    POSTGRES_USER: loyalty_dev
    POSTGRES_PASSWORD: loyalty_dev_pass

redis:
  ports:
    - "6380:6379"  # External access on port 6380
```

### Production Ports (docker-compose.prod.yml)

```yaml
nginx:
  ports:
    - "4001:80"  # External access on port 4001

postgres:
  ports: []  # No external access (security)

redis:
  ports: []  # No external access (security)
```

## 🔄 Switching Between Environments

### Start Development
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Start Production (Manual - normally done via GitHub Actions)
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Stop Current Environment
```bash
# Stop development
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Stop production
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

## 🗄️ Database Management

### Development Database Access

```bash
# Connect to development database (external port 5435)
psql -h localhost -p 5435 -U loyalty_dev -d loyalty_dev_db

# Via Docker
docker compose exec postgres psql -U loyalty_dev -d loyalty_dev_db
```

### Run Migrations (Development)

```bash
# Inside backend container
docker compose exec backend npm run db:migrate

# Or from host (if npm installed locally)
cd backend && npm run db:migrate
```

### Seed Development Data

```bash
docker compose exec backend npm run db:seed
```

## 🧪 Testing in Development

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- backend/tests/loyalty.test.ts
```

## 🔍 Debugging

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

### Check Service Health

```bash
docker compose ps
```

### Access Backend Shell

```bash
docker compose exec backend sh
```

### Access Database Shell

```bash
docker compose exec postgres psql -U loyalty_dev -d loyalty_dev_db
```

## ⚠️ Important Notes

### 1. Port Conflicts
- Development **must use port 5001** (not 4001) to avoid conflicts with production
- If you see "port already in use" errors, check if production is running
- Stop production before starting development if on same machine

### 2. Database Separation
- Development uses `loyalty_dev_db` database
- Production uses `loyalty_db` database
- They are completely isolated even when running simultaneously

### 3. OAuth Callbacks
- Update OAuth provider settings to use port 5001 for development
- Production OAuth callbacks use port 4001

### 4. Environment Variables
- **NEVER commit `.env` file** with real secrets
- Use `.env.example` as template
- Generate strong secrets for development

## 🚨 Common Issues

### Port Already in Use

```bash
# Check what's using port 5001
lsof -ti:5001

# Kill process (if needed)
kill -9 $(lsof -ti:5001)

# Or stop production first
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Restart PostgreSQL
docker compose restart postgres

# Check logs
docker compose logs postgres
```

### Hot Reload Not Working

```bash
# Rebuild containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## 📝 Development Workflow

1. **Start Development Environment**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```

2. **Make Code Changes**
   - Edit files in `backend/` or `frontend/`
   - Changes automatically reload (hot-reload enabled)

3. **Run Tests**
   ```bash
   npm test
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: description"
   git push
   ```

5. **Stop Development**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml down
   ```

## 🔗 Related Documentation

- [CLAUDE.md](CLAUDE.md) - Project rules and conventions
- [README.md](README.md) - Project overview and setup
- [docker-compose.yml](docker-compose.yml) - Base configuration
- [docker-compose.dev.yml](docker-compose.dev.yml) - Development overrides
- [docker-compose.prod.yml](docker-compose.prod.yml) - Production overrides

## 💡 Tips

- Use `docker compose logs -f backend` to monitor backend logs during development
- Access frontend dev tools at http://localhost:5001
- Use VS Code Remote Containers extension for better development experience
- Keep development database separate from production for safety
- Test with production configuration locally before deploying:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml build
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up
  ```
