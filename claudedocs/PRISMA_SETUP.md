# Prisma Client Configuration and Troubleshooting Guide

## Overview

This document explains the Prisma client setup in the loyalty-app backend, including the custom output path configuration, TypeScript compilation considerations, and Docker containerization requirements.

## Configuration

### Prisma Schema Output Path

Location: `backend/prisma/schema.prisma`

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "../src/generated/prisma"
  binaryTargets = ["native", "linux-musl-arm64-openssl-3.0.x", "linux-musl-openssl-3.0.x"]
}
```

The Prisma client is generated to `backend/src/generated/prisma/` instead of the default `node_modules/@prisma/client`.

### TypeScript Configuration

Location: `backend/tsconfig.json`

**Critical Configuration:**

```json
{
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "**/*.backup.ts", "**/*.minimal.ts"]
}
```

**⚠️ IMPORTANT:** The `src/generated/**/*` directory must NOT be in the `exclude` array. If excluded, TypeScript cannot resolve imports from the Prisma client.

### Import Paths

From any TypeScript file in `src/`:

```typescript
// Correct import from src/config/prisma.ts
import { PrismaClient } from '../generated/prisma';

// Correct import from src/services/*.ts
import { users, user_profiles } from '../generated/prisma';
```

When compiled to JavaScript in `dist/`, these paths remain relative:
- `src/config/prisma.ts` → `dist/config/prisma.js`
- Import `'../generated/prisma'` resolves to `dist/generated/prisma/`

## Docker Setup

### Development Stage

The development stage uses volume mounts for hot-reload:

```yaml
# docker-compose.yml
backend:
  volumes:
    - ./backend:/app          # Mounts entire backend directory
    - /app/node_modules       # Excludes node_modules from mount
```

**Implication:** The Prisma client must exist in BOTH locations:
1. `src/generated/prisma/` - For TypeScript compilation
2. `dist/generated/prisma/` - For compiled JavaScript runtime

**Solution:** After generating Prisma client and building TypeScript:

```bash
cd backend
npm run db:generate                          # Generates to src/generated/prisma/
npm run build                                # Compiles TypeScript to dist/
mkdir -p dist/generated                      # Create dist/generated directory
cp -r src/generated/* dist/generated/        # Copy Prisma client to dist/
```

### Production Stage (Runner)

The runner stage in the Dockerfile handles this automatically:

```dockerfile
FROM base AS runner

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma

# Ensure Prisma client is available for runtime
RUN if [ -d "src/generated" ]; then \
      echo "✅ Prisma client found in src/generated"; \
    else \
      npm run db:generate; \
    fi && \
    mkdir -p dist/generated && cp -r src/generated/* dist/generated/ && \
    echo "✅ Prisma client copied to dist/generated"
```

## Common Issues and Solutions

### Issue 1: "Cannot find module '../generated/prisma'"

**Symptoms:**
- Backend crashes on startup
- Error: `MODULE_NOT_FOUND` for `'../generated/prisma'`
- Stack trace shows `/app/dist/config/prisma.js` trying to require the module

**Root Causes:**

1. **TypeScript Exclusion:** `src/generated/**/*` is in `tsconfig.json` exclude array
   ```bash
   # Solution: Remove from exclude in tsconfig.json
   "exclude": ["node_modules", "dist", "tests"]  # NO src/generated
   ```

2. **Missing dist/generated:** Prisma client not copied to `dist/generated/prisma/`
   ```bash
   # Solution: Copy after build
   mkdir -p dist/generated && cp -r src/generated/* dist/generated/
   ```

3. **Outdated Compiled JavaScript:** TypeScript compiled before tsconfig fix
   ```bash
   # Solution: Recompile TypeScript
   npm run build
   ```

### Issue 2: Health Check Failures

**Symptoms:**
- Container shows as unhealthy
- Backend appears to be running but health endpoint unreachable

**Solution:**
Add health check to docker-compose.prod.yml:

```yaml
backend:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:4000/api/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
```

## Development Workflow

### Initial Setup

```bash
cd backend

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Build TypeScript
npm run build

# Copy Prisma client to dist/
mkdir -p dist/generated
cp -r src/generated/* dist/generated/
```

### After Schema Changes

```bash
# Update schema
vim prisma/schema.prisma

# Regenerate Prisma client
npm run db:generate

# Create and apply migration
npm run db:migrate

# Rebuild TypeScript
npm run build

# Copy updated Prisma client
cp -r src/generated/* dist/generated/
```

### Docker Development

```bash
# Start services (uses volume mounts, hot-reload enabled)
docker compose up -d

# Restart after Prisma changes
docker compose restart backend
```

### Production Deployment

```bash
# Build with production configuration
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# Deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Verification Checklist

Before starting the backend:

- [ ] Prisma client generated: `ls -la src/generated/prisma/index.d.ts`
- [ ] TypeScript compiled: `ls -la dist/index.js`
- [ ] Prisma client copied: `ls -la dist/generated/prisma/index.d.ts`
- [ ] tsconfig exclude does not include `src/generated`
- [ ] Import paths use `'../generated/prisma'` not `'./generated/prisma'`

## Architecture Diagram

```
backend/
├── src/                           # TypeScript source
│   ├── config/
│   │   └── prisma.ts             # Imports '../generated/prisma'
│   ├── generated/                # ← Prisma client generated here
│   │   └── prisma/
│   │       ├── index.d.ts
│   │       ├── index.js
│   │       └── ...
│   └── ...
├── dist/                         # Compiled JavaScript
│   ├── config/
│   │   └── prisma.js            # Requires '../generated/prisma'
│   ├── generated/               # ← Prisma client MUST be copied here
│   │   └── prisma/
│   │       ├── index.d.ts
│   │       ├── index.js
│   │       └── ...
│   └── ...
└── prisma/
    └── schema.prisma            # output = "../src/generated/prisma"
```

## Related Documentation

- Prisma Generator Configuration: https://www.prisma.io/docs/concepts/components/prisma-schema/generators
- Docker Multi-Stage Builds: https://docs.docker.com/build/building/multi-stage/
- TypeScript Module Resolution: https://www.typescriptlang.org/docs/handbook/module-resolution.html

## Maintenance

This configuration was last updated: November 10, 2025

Key fixes applied:
1. Removed `src/generated/**/*` from tsconfig.json exclude
2. Added automatic Prisma client copy to dist/generated in Dockerfile
3. Added health checks to production docker-compose
4. Documented development workflow for Prisma updates

## Support

If you encounter Prisma-related issues not covered in this guide:
1. Check backend container logs: `docker compose logs backend`
2. Verify Prisma client generation: `docker compose exec backend ls -la src/generated/prisma/`
3. Check dist/generated: `docker compose exec backend ls -la dist/generated/prisma/`
4. Verify tsconfig exclude: `cat backend/tsconfig.json | grep exclude`
