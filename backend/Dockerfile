# Multi-stage build optimized for caching
# Layer order: base → deps → source → build → runtime
#
# Cache strategy:
# 1. Dependencies (package*.json) - rarely change, expensive to install
# 2. Prisma schema - changes occasionally
# 3. Source code - changes frequently, cheap to copy
#
# On code-only changes, only layers 3+ rebuild (fast)
# On dependency changes, layers 1+ rebuild (slow but necessary)

FROM node:25-alpine AS base
WORKDIR /app

# =============================================================================
# STAGE 1: Production dependencies (cached when package*.json unchanged)
# =============================================================================
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# =============================================================================
# STAGE 2: Development dependencies (cached when package*.json unchanged)
# =============================================================================
FROM base AS dev-deps
COPY package*.json ./
RUN npm ci && npm cache clean --force

# =============================================================================
# STAGE 3: Build stage - compile TypeScript
# Order: deps → config → prisma → source → build
# =============================================================================
FROM base AS builder

# 3a. Copy package files (for scripts)
COPY package*.json ./

# 3b. Copy node_modules from dev-deps (cached)
COPY --from=dev-deps /app/node_modules ./node_modules

# 3c. Copy config files (rarely change)
COPY tsconfig.json prisma.config.ts prisma-env-init.ts ./

# 3d. Copy Prisma schema (changes occasionally)
COPY prisma ./prisma

# 3e. Generate Prisma client
RUN npm run db:generate

# 3f. Copy source code LAST (changes frequently)
COPY src ./src

# 3g. Build TypeScript
RUN npm run build

# 3h. Copy Prisma client to dist for runtime
RUN mkdir -p dist/generated && \
    cp -r src/generated/* dist/generated/

# 3i. Verify build
RUN test -f dist/index.js && test -d dist/generated/prisma && \
    echo "✅ Build successful"

# =============================================================================
# STAGE 4: Base runtime (shared between dev and prod)
# =============================================================================
FROM base AS base-runtime

# System dependencies
RUN apk add --no-cache curl netcat-openbsd postgresql-client

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# App directories
RUN mkdir -p /app/storage /app/storage/backup /app/storage/avatars /app/logs && \
    chown -R nodejs:nodejs /app && \
    chmod 755 /app/logs

# Entrypoint
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh && chown nodejs:nodejs /app/entrypoint.sh

# =============================================================================
# STAGE 5: Development runtime
# =============================================================================
FROM base-runtime AS development

# Copy dev dependencies (cached)
COPY --from=dev-deps /app/node_modules ./node_modules

# Copy config files
COPY --chown=nodejs:nodejs package*.json tsconfig.json prisma.config.ts prisma-env-init.ts ./

# Copy Prisma schema and generated client
COPY --chown=nodejs:nodejs prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated

# Copy source code LAST
COPY --chown=nodejs:nodejs src ./src

RUN chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "run", "dev"]

# =============================================================================
# STAGE 6: Production runtime (minimal, secure)
# =============================================================================
FROM base-runtime AS runner

# Copy production dependencies only (cached)
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma client for runtime
COPY --from=builder /app/src/generated ./src/generated

# Copy Prisma schema for migrations
COPY --chown=nodejs:nodejs prisma ./prisma

# Copy package.json for npm scripts
COPY --chown=nodejs:nodejs package*.json prisma.config.ts prisma-env-init.ts ./

# Verify production artifacts
RUN test -f dist/index.js && test -d dist/generated/prisma && \
    echo "✅ Production build verified"

RUN chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
