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

FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS base
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
# Desk phone numbers shown on the guest deposit page (B16). Build-time: Vite
# inlines VITE_* at `npm run build`, so these must arrive as build args from
# CI (repository variables DESK_PHONE_HF / DESK_PHONE_HFVILLE); blank = the
# page shows the "contact the front desk" line without a number.
ARG VITE_DESK_PHONE_HF=
ARG VITE_DESK_PHONE_HFVILLE=
ENV VITE_DESK_PHONE_HF=$VITE_DESK_PHONE_HF
ENV VITE_DESK_PHONE_HFVILLE=$VITE_DESK_PHONE_HFVILLE
RUN npm run build

# 2g. Verify build
RUN test -f dist/index.html && \
    echo "✅ Build successful ($(du -sh dist | cut -f1))"

# =============================================================================
# STAGE 3: Production runtime (nginx - minimal)
# =============================================================================
FROM nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752 AS production

# Refreshed base digest + apk upgrade to pull patched Alpine packages. Bumping
# the FROM digest is what makes the upgrade effective: it invalidates the cached
# upgrade layer so the rebuild fetches the latest patched packages (this round:
# libexpat 2.8.2, curl/libcurl 8.20.0, c-ares 1.34.8 — the 29-CVE cluster Trivy
# flagged against 2.8.1-r0 / 8.19.0-r0 / 1.34.6-r0).
RUN apk upgrade --no-cache

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

RUN test -f /usr/share/nginx/html/index.html && \
    echo "✅ Production ready"

EXPOSE 80
# Official nginx model: master starts as root (binds :80, reads config),
# then drops privileges — workers run as the unprivileged `nginx` user.
# Switching to nginx-unprivileged needs a coordinated port/compose change.
# nosemgrep: dockerfile.security.missing-user.missing-user
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
# Local-dev Vite stage only — never built for deploy.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
