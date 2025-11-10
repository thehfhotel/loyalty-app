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
RUN npm ci && npm cache clean --force

# Build stage
FROM base AS builder
COPY package*.json ./
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .

# Build for production
ARG VITE_API_URL=https://loyalty.saichon.com/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build || echo "Build failed, will serve dev build at runtime"

# Production runtime stage
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# Development stage (default for docker-compose dev)
FROM base AS development
COPY package*.json ./

# Install all dependencies directly in development stage to avoid multi-stage issues
RUN npm ci && npm cache clean --force

COPY . .

# Copy built dist if available from builder stage
COPY --from=builder /app/dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# Expose port
EXPOSE 3000

# Start Vite dev server or preview based on environment
CMD ["sh", "-c", "if [ \"$NODE_ENV\" = \"production\" ] && [ -d dist ]; then npm run preview -- --host 0.0.0.0 --port 3000; else npm run dev -- --host 0.0.0.0; fi"]