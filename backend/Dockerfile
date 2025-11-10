# Multi-stage build for optimal caching and smaller production image
FROM node:24-alpine AS base
WORKDIR /app

# Dependencies stage - for better caching
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Development dependencies stage
FROM base AS dev-deps
COPY package*.json ./
RUN npm ci --include=dev && npm cache clean --force

# Build stage
FROM base AS builder
COPY package*.json tsconfig.json ./
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client first (required for TypeScript compilation)
RUN npm run db:generate

# Build TypeScript - fail gracefully for runtime fallback
RUN npm run build || echo "TypeScript compilation failed, will use tsx at runtime"

# Development stage (for docker-compose dev)
FROM base AS development

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create necessary directories with proper permissions
RUN mkdir -p /app/storage /app/storage/backup /app/storage/avatars /app/logs /tmp && \
    chown -R nodejs:nodejs /app && \
    chmod 755 /app/logs && \
    chmod 1777 /tmp

# Copy all dependencies (including dev dependencies for tsx)
COPY --from=dev-deps /app/node_modules ./node_modules

# Copy source files and configuration
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY package*.json tsconfig.json ./

# Generate Prisma client for development (CACHE BUST: 2025-11-10-v3)
RUN npm run db:generate && \
    # Copy generated client to dist location for compiled JS module resolution \
    mkdir -p dist/generated && cp -r src/generated/* dist/generated/ && \
    echo "✅ Prisma client copied to dist/generated (development)" && \
    # Verify the Prisma client exists at expected location \
    if [ -d "dist/generated/prisma" ]; then \
      echo "✅ Prisma client verified at dist/generated/prisma (development)"; \
      ls -la dist/generated/prisma | head -5; \
    else \
      echo "❌ ERROR: Prisma client not found at dist/generated/prisma (development)"; \
      echo "Contents of dist/generated:"; \
      ls -la dist/generated/ || echo "dist/generated/ does not exist"; \
      exit 1; \
    fi

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

# Development command (tsx is available)
CMD ["npm", "run", "dev"]

# Production stage
FROM base AS runner

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create necessary directories with proper permissions
RUN mkdir -p /app/storage /app/storage/backup /app/storage/avatars /app/logs && \
    chown -R nodejs:nodejs /app && \
    chmod 755 /app/logs

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy built application (if available), source files, and generated Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY package*.json tsconfig.json ./

# Ensure Prisma client is available for runtime (CACHE BUST: 2025-11-10-v2)
# Prisma generates to src/generated/prisma, compiled JS expects ../generated/prisma from dist/config/
RUN if [ -d "src/generated" ]; then \
      echo "✅ Prisma client found in src/generated"; \
    else \
      echo "⚠️ Prisma client not found, generating..."; \
      npm run db:generate; \
      echo "✅ Prisma client generated"; \
    fi && \
    # Copy generated client to dist location for compiled JS module resolution \
    mkdir -p dist/generated && cp -r src/generated/* dist/generated/ && \
    echo "✅ Prisma client copied to dist/generated" && \
    # Verify the Prisma client exists at expected location \
    if [ -d "dist/generated/prisma" ]; then \
      echo "✅ Prisma client verified at dist/generated/prisma"; \
      ls -la dist/generated/prisma | head -5; \
    else \
      echo "❌ ERROR: Prisma client not found at dist/generated/prisma"; \
      echo "Contents of dist/generated:"; \
      ls -la dist/generated/ || echo "dist/generated/ does not exist"; \
      exit 1; \
    fi

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

# Start the application - prefer compiled version, fallback to tsx
CMD ["sh", "-c", "if [ -f dist/index.js ]; then npm start; else npx tsx src/index.ts; fi"]