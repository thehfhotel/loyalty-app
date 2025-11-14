# 🔐 Environment Configuration Guide

## Overview

This project uses **separate environment files** for development and production to ensure proper isolation and configuration management.

## 📁 Environment Files Structure

```
loyalty-app/
├── .env.development          # Development configuration (port 5001, dev DB)
├── .env.production           # Production configuration (port 4001, prod DB)
├── .env.example              # Development template (safe to commit)
├── .env.production.example   # Production template (safe to commit)
└── .gitignore                # Excludes .env.* (except examples)
```

## 🎯 File Usage Matrix

| File | Used By | Port | Database | Secrets | Git Status |
|------|---------|------|----------|---------|------------|
| `.env.development` | `docker-compose.dev.yml` | 5001 | `loyalty_dev_db` | Dev-safe | ❌ Ignored |
| `.env.production` | `docker-compose.prod.yml` | 4001 | `loyalty_db` | Production | ❌ Ignored |
| `.env.example` | Template only | 5001 | Dev template | Placeholders | ✅ Committed |
| `.env.production.example` | Template only | 4001 | Prod template | Placeholders | ✅ Committed |

## 🔧 Configuration Details

### Development (.env.development)

**Port Configuration:**
```env
# Development uses port 5001 to avoid conflicts with production
FRONTEND_URL=http://localhost:5001
BACKEND_URL=http://localhost:5001/api
VITE_API_URL=http://localhost:5001/api
```

**Database:**
```env
# Separate development database
DATABASE_URL=postgresql://loyalty_dev:loyalty_dev_pass@postgres:5432/loyalty_dev_db
```

**External Access:**
- Nginx: `localhost:5001`
- PostgreSQL: `localhost:5435`
- Redis: `localhost:6380`

**Secrets:**
- Development-safe secrets (not for production)
- Safe to share within team
- Pre-configured OAuth credentials for testing

### Production (.env.production)

**Port Configuration:**
```env
# Production uses port 4001
FRONTEND_URL=https://loyalty.saichon.com
BACKEND_URL=https://loyalty.saichon.com/api
VITE_API_URL=https://loyalty.saichon.com/api
```

**Database:**
```env
# Production database
DATABASE_URL=postgresql://loyalty:loyalty_pass@postgres:5432/loyalty_db
```

**External Access:**
- Nginx: `loyalty.saichon.com:4001`
- PostgreSQL: Internal only (no external port)
- Redis: Internal only (no external port)

**Secrets:**
- Production secrets (NEVER commit)
- Managed via GitHub Actions secrets
- Strong randomly-generated values

## 🚀 Usage Commands

### Development

```bash
# Start development environment (reads .env.development)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# View development logs
docker compose logs -f

# Stop development
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### Production

```bash
# Start production environment (reads .env.production)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View production logs
docker compose logs -f

# Stop production
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

## 🔍 How It Works

### Docker Compose env_file Directive

Each environment-specific compose file specifies which `.env` file to load:

**docker-compose.dev.yml:**
```yaml
services:
  backend:
    env_file:
      - .env.development  # Automatically loads development vars
    environment:
      NODE_ENV: development
```

**docker-compose.prod.yml:**
```yaml
services:
  backend:
    env_file:
      - .env.production  # Automatically loads production vars
    environment:
      NODE_ENV: production
```

### Variable Override Priority

1. **Shell environment** (highest priority)
2. **`environment` section** in docker-compose file
3. **`env_file`** specified file (.env.development or .env.production)
4. **Dockerfile ENV** (lowest priority)

## 🛡️ Security Best Practices

### ✅ DO

- ✅ Use `.env.development` for local development with dev-safe secrets
- ✅ Use `.env.production` for production with strong secrets
- ✅ Keep `.env.example` files updated with new variables (use placeholders)
- ✅ Store production secrets in GitHub Actions secrets
- ✅ Use `openssl rand -base64 32` to generate strong secrets
- ✅ Review `.gitignore` to ensure env files are excluded

### ❌ DON'T

- ❌ Commit `.env.development` or `.env.production` to git
- ❌ Use production secrets in development
- ❌ Use development secrets in production
- ❌ Share production `.env.production` file via unsecure channels
- ❌ Copy production secrets into example files

## 🔄 Migration from Old Setup

**Before (PROBLEM):**
```
.env  # Single file used by both dev and prod (PORT CONFLICT!)
```

**After (SOLUTION):**
```
.env.development  # Development only (port 5001)
.env.production   # Production only (port 4001)
```

### What Changed

1. **Separated configurations**: Dev and prod now have dedicated files
2. **Port isolation**: Dev (5001) and prod (4001) can coexist
3. **Database isolation**: Separate databases (`loyalty_dev_db` vs `loyalty_db`)
4. **Explicit loading**: Each compose file explicitly loads its env file
5. **Better security**: Clear separation prevents accidental prod config in dev

## 📋 Checklist for New Team Members

### Setting Up Development

- [ ] Verify `.env.development` exists
- [ ] Review development configuration (ports, database, secrets)
- [ ] Start development: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
- [ ] Access at `http://localhost:5001`
- [ ] Verify dev database connection on port 5435

### Understanding Production

- [ ] Review `.env.production.example` for required variables
- [ ] Understand production deploys via GitHub Actions (not manual)
- [ ] Know that production uses port 4001
- [ ] Never manually edit production environment on server

## ⚠️ Common Issues

### Issue: "Port 5001 already in use"

**Solution:**
```bash
# Check what's using the port
lsof -ti:5001

# Stop production if running
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Or kill the process
kill -9 $(lsof -ti:5001)
```

### Issue: "Environment variables not loading"

**Solution:**
```bash
# Verify env file exists
ls -la .env.development .env.production

# Check docker compose config
docker compose -f docker-compose.yml -f docker-compose.dev.yml config | grep NODE_ENV

# Rebuild if needed
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Issue: "Wrong database connection"

**Solution:**
```bash
# Check which env file is being used
docker compose -f docker-compose.yml -f docker-compose.dev.yml config | grep DATABASE_URL

# Should see: postgresql://loyalty_dev:loyalty_dev_pass@...
```

## 🔗 Related Documentation

- [DEV_SETUP.md](DEV_SETUP.md) - Complete development setup guide
- [CLAUDE.md](CLAUDE.md) - Project rules and port assignments
- [docker-compose.dev.yml](docker-compose.dev.yml) - Development overrides
- [docker-compose.prod.yml](docker-compose.prod.yml) - Production overrides

## 📊 Environment Comparison

| Aspect | Development | Production |
|--------|-------------|------------|
| **Env File** | `.env.development` | `.env.production` |
| **Compose File** | `docker-compose.dev.yml` | `docker-compose.prod.yml` |
| **Port** | 5001 | 4001 |
| **Database** | `loyalty_dev_db` (port 5435) | `loyalty_db` (no external port) |
| **Redis** | Port 6380 exposed | No external port |
| **NODE_ENV** | `development` | `production` |
| **Secrets** | Dev-safe | Production-strong |
| **Hot Reload** | ✅ Enabled | ❌ Disabled |
| **Volumes** | Code mounted | Compiled code only |
| **Logging** | `debug` | `info` |
| **Build Target** | `development` | `runner` (optimized) |
| **Deployment** | Manual command | GitHub Actions |

## 🎓 Key Takeaways

1. **Never mix dev and prod configs** - Each has dedicated files
2. **Port 5001 = Dev, Port 4001 = Prod** - Prevents conflicts
3. **Separate databases** - Complete isolation between environments
4. **Explicit env_file directives** - Clear which config is loaded
5. **Git ignores sensitive files** - Only templates are committed
6. **Production secrets in GitHub** - Not in repository files

---

**Last Updated**: 2025-11-14
**Maintained By**: Development Team
**Questions**: See DEV_SETUP.md or CLAUDE.md
