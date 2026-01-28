#!/bin/bash
# Deploy from GHCR (GitHub Container Registry)
# Usage: ./deploy-from-ghcr.sh <environment> <image_tag> <commit_sha>
#
# This script deploys pre-built Docker images from GHCR to the target environment.
# It does NOT perform git operations - config files are fetched via raw GitHub URLs.
#
# Prerequisites:
# - GHCR_TOKEN environment variable set (for docker login)
# - .env file exists in deployment directory (created by CI/CD)
# - Deployment directory structure exists (created during initial setup)
#
# Example:
#   GHCR_TOKEN=ghp_xxx ./deploy-from-ghcr.sh production abc1234 abc1234

set -euo pipefail

# =============================================================================
# CONFIGURATION
# =============================================================================

ENVIRONMENT="${1:-production}"
IMAGE_TAG="${2:-latest}"
COMMIT_SHA="${3:-main}"
REPO="thehfhotel/loyalty-app"
GHCR_REGISTRY="ghcr.io"
GHCR_USER="thehfhotel"

# Environment-specific settings
if [ "$ENVIRONMENT" = "development" ]; then
  DEPLOY_PATH="/home/nut/loyalty-app-develop"
  COMPOSE_OVERRIDE="docker-compose.dev.yml"
  HEALTH_PORT="5001"
  ENV_SUFFIX="_dev"
else
  DEPLOY_PATH="/home/nut/loyalty-app-production"
  COMPOSE_OVERRIDE="docker-compose.prod.yml"
  HEALTH_PORT="4001"
  ENV_SUFFIX="_production"
fi

# Compose files for deployment
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.ghcr.yml -f $COMPOSE_OVERRIDE"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
  exit 1
}

# Update a config file from GitHub raw content
update_config() {
  local file="$1"
  local url="https://raw.githubusercontent.com/${REPO}/${COMMIT_SHA}/${file}"

  # Create parent directory if needed
  local dir=$(dirname "$file")
  if [ "$dir" != "." ]; then
    mkdir -p "$dir"
  fi

  log "Updating $file from commit $COMMIT_SHA..."
  if ! curl -sfL "$url" -o "$file"; then
    log "Warning: Could not update $file (may not exist in repo)"
    return 1
  fi
  return 0
}

# =============================================================================
# MAIN DEPLOYMENT
# =============================================================================

log "=========================================="
log "GHCR Deployment: $ENVIRONMENT"
log "Image tag: $IMAGE_TAG"
log "Commit: $COMMIT_SHA"
log "Deploy path: $DEPLOY_PATH"
log "=========================================="

# Validate environment
if [ -z "${GHCR_TOKEN:-}" ]; then
  error "GHCR_TOKEN environment variable is required"
fi

if [ ! -d "$DEPLOY_PATH" ]; then
  error "Deployment directory does not exist: $DEPLOY_PATH"
fi

cd "$DEPLOY_PATH"

if [ ! -f ".env" ]; then
  error ".env file not found in $DEPLOY_PATH (should be created by CI/CD)"
fi

# Export IMAGE_TAG for docker compose
export IMAGE_TAG

# =============================================================================
# STEP 1: Update config files from GitHub
# =============================================================================
log "Step 1: Updating config files from GitHub..."

update_config "docker-compose.yml" || true
update_config "docker-compose.ghcr.yml" || true
update_config "$COMPOSE_OVERRIDE" || true
update_config "nginx/nginx.conf" || true

# Prisma schema for migrations
mkdir -p "backend/prisma/migrations"
update_config "backend/prisma/schema.prisma" || true

# Copy migrations directory structure if needed
# Note: Migrations are run inside the container which has the full schema

log "Config files updated"

# =============================================================================
# STEP 2: Login to GHCR
# =============================================================================
log "Step 2: Logging into GHCR..."

echo "$GHCR_TOKEN" | docker login "$GHCR_REGISTRY" -u "$GHCR_USER" --password-stdin

log "Logged into GHCR"

# =============================================================================
# STEP 3: Pull images
# =============================================================================
log "Step 3: Pulling images from GHCR..."

docker compose $COMPOSE_FILES pull backend frontend

log "Images pulled successfully"

# =============================================================================
# STEP 4: Run database migrations
# =============================================================================
log "Step 4: Running database migrations..."

# First, ensure postgres is up
docker compose $COMPOSE_FILES up -d postgres redis

# Wait for postgres to be healthy
log "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker compose $COMPOSE_FILES exec -T postgres pg_isready -U loyalty 2>/dev/null; then
    log "PostgreSQL is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    error "PostgreSQL failed to become ready"
  fi
  sleep 2
done

# Run migrations using the backend image
log "Applying Prisma migrations..."
docker compose $COMPOSE_FILES run --rm backend npx prisma migrate deploy || {
  log "Warning: Migration failed or no pending migrations"
}

log "Database migrations complete"

# =============================================================================
# STEP 5: Deploy services
# =============================================================================
log "Step 5: Deploying services..."

docker compose $COMPOSE_FILES up -d --remove-orphans

log "Services started"

# =============================================================================
# STEP 6: Health check
# =============================================================================
log "Step 6: Running health check..."

HEALTH_URL="http://localhost:${HEALTH_PORT}/api/health"
MAX_RETRIES=30
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    log "Health check passed!"
    log "=========================================="
    log "Deployment successful!"
    log "Environment: $ENVIRONMENT"
    log "Image tag: $IMAGE_TAG"
    log "Health URL: $HEALTH_URL"
    log "=========================================="

    # Show running containers
    docker compose $COMPOSE_FILES ps

    exit 0
  fi

  log "Health check attempt $i/$MAX_RETRIES failed, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

# Health check failed - show logs for debugging
log "Health check failed after $MAX_RETRIES attempts"
log "Showing backend logs:"
docker compose $COMPOSE_FILES logs --tail=50 backend

error "Deployment health check failed"
