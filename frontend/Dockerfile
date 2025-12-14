# Multi-stage build optimized for caching
# Layer order: base → deps → source → build → runtime
#
# Cache strategy:
# 1. Dependencies (package*.json) - rarely change, expensive to install
# 2. Config files (vite.config.ts, etc) - rarely change
# 3. Source code - changes frequently, cheap to copy
#
# On code-only changes, only layers 3+ rebuild (fast)
# On dependency changes, layers 1+ rebuild (slow but necessary)

FROM node:25-alpine AS base
WORKDIR /app

# =============================================================================
# STAGE 1: Dependencies (cached when package*.json unchanged)
# =============================================================================
FROM base AS deps
COPY package*.json ./
RUN npm ci && npm cache clean --force

# =============================================================================
# STAGE 2: Build stage - compile production bundle
# Order: deps → config → source → build
# =============================================================================
FROM base AS builder

# 2a. Copy package files
COPY package*.json ./

# 2b. Copy node_modules from deps (cached)
COPY --from=deps /app/node_modules ./node_modules

# 2c. Copy config files (rarely change)
COPY tsconfig*.json vite.config.ts postcss.config.js tailwind.config.js index.html ./

# 2d. Copy public assets (change occasionally)
COPY public ./public

# 2e. Copy source code LAST (changes frequently)
COPY src ./src

# 2f. Build with production API URL
ARG VITE_API_URL=https://loyalty.saichon.com/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# 2g. Verify build
RUN test -f dist/index.html && \
    echo "✅ Build successful ($(du -sh dist | cut -f1))"

# =============================================================================
# STAGE 3: Production runtime (nginx - minimal)
# =============================================================================
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

RUN test -f /usr/share/nginx/html/index.html && \
    echo "✅ Production ready"

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# =============================================================================
# STAGE 4: Development runtime (Vite dev server with HMR)
# =============================================================================
FROM base AS development

# System dependencies
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install dependencies (cached when package*.json unchanged)
RUN npm ci && npm cache clean --force

# Copy config files (rarely change)
COPY tsconfig*.json vite.config.ts postcss.config.js tailwind.config.js index.html ./

# Copy public assets
COPY public ./public

# Copy source code LAST (changes frequently)
COPY src ./src

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000} || exit 1

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
