# Multi-stage build for optimal caching and smaller production image
FROM node:25-alpine AS base
WORKDIR /app

# Development dependencies stage
FROM base AS dev-deps
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Build stage - compile production bundle
FROM base AS builder
COPY package*.json ./
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .

# Build for production
ARG VITE_API_URL=https://loyalty.saichon.com/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Verify build artifacts exist
RUN test -d dist || (echo "❌ ERROR: Vite build failed - dist/ not found" && exit 1) && \
    test -f dist/index.html || (echo "❌ ERROR: dist/index.html not found" && exit 1) && \
    echo "✅ Vite build successful" && \
    echo "📦 Build size: $(du -sh dist | cut -f1)"

# Production runtime stage - nginx
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

# Verify production artifacts
RUN test -f /usr/share/nginx/html/index.html || (echo "❌ ERROR: Production files not found" && exit 1) && \
    echo "✅ Production artifacts verified"

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# Development stage - Vite dev server with HMR
FROM base AS development

# Install curl for health checks
RUN apk add --no-cache curl

COPY package*.json ./

# Install all dependencies directly in development stage
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000} || exit 1

# Expose port
EXPOSE 3000

# Start Vite dev server with HMR
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
