# Multi-stage build for optimal caching and smaller production image
FROM node:25-alpine AS base
WORKDIR /app

# Dependencies stage - production only
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Development dependencies stage
FROM base AS dev-deps
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Build stage - compile TypeScript and generate Prisma client
FROM base AS builder
COPY package*.json tsconfig.json ./
COPY --from=dev-deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client (single source of truth)
RUN npm run db:generate

# Build TypeScript - fail on errors
RUN npm run build

# Copy Prisma client to dist/generated for compiled code module resolution
RUN mkdir -p dist/generated && \
    cp -r src/generated/* dist/generated/ && \
    echo "✅ Prisma client copied to dist/generated for compiled code"

# Verify build artifacts exist
RUN test -d dist || (echo "❌ ERROR: TypeScript compilation failed - dist/ not found" && exit 1) && \
    test -f dist/index.js || (echo "❌ ERROR: dist/index.js not found" && exit 1) && \
    test -d dist/generated/prisma || (echo "❌ ERROR: Prisma client not found in dist/generated" && exit 1) && \
    echo "✅ TypeScript compilation successful"

# Base runtime stage - shared between dev and prod
FROM base AS base-runtime

# Install system dependencies (curl for health checks, netcat for database checks, postgresql-client for migrations)
RUN apk add --no-cache curl netcat-openbsd postgresql-client

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create necessary directories with proper permissions
RUN mkdir -p /app/storage /app/storage/backup /app/storage/avatars /app/logs && \
    chown -R nodejs:nodejs /app && \
    chmod 755 /app/logs

# Copy and setup entrypoint script
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh && chown nodejs:nodejs /app/entrypoint.sh

# Development stage
FROM base-runtime AS development

# Copy development dependencies
COPY --from=dev-deps /app/node_modules ./node_modules

# Copy source files and configuration
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs prisma ./prisma
COPY --chown=nodejs:nodejs package*.json tsconfig.json ./

# Copy generated Prisma client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src/generated ./src/generated

# Verify Prisma client exists
RUN test -d src/generated/prisma || (echo "❌ ERROR: Prisma client not found" && exit 1) && \
    echo "✅ Prisma client verified at src/generated/prisma"

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

# Use entrypoint script for automatic migrations
ENTRYPOINT ["/app/entrypoint.sh"]

# Development command (uses tsx for hot reload)
CMD ["npm", "run", "dev"]

# Production stage
FROM base-runtime AS runner

# Copy ONLY production dependencies (no dev dependencies like tsx, jest, @types/*)
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled JavaScript with embedded Prisma client (dist/generated)
COPY --from=builder /app/dist ./dist

# Copy Prisma client to src/generated for entrypoint script compatibility
COPY --from=builder /app/src/generated ./src/generated

# Copy Prisma schema and migrations (needed for runtime)
COPY --chown=nodejs:nodejs prisma ./prisma

# Copy generated Prisma client to node_modules for additional compatibility
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy package.json for npm scripts and metadata
COPY --chown=nodejs:nodejs package*.json ./

# Verify production artifacts exist
RUN test -f dist/index.js || (echo "❌ ERROR: Production build not found" && exit 1) && \
    test -d dist/generated/prisma || (echo "❌ ERROR: Prisma client not found in dist/generated" && exit 1) && \
    test -d src/generated/prisma || (echo "❌ ERROR: Prisma client not found in src/generated" && exit 1) && \
    test -d node_modules/.prisma || (echo "❌ ERROR: Prisma client not found in node_modules" && exit 1) && \
    echo "✅ Production artifacts verified"

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

# Use entrypoint script for automatic migrations
ENTRYPOINT ["/app/entrypoint.sh"]

# Production command (runs compiled JavaScript with Node.js)
CMD ["node", "dist/index.js"]
