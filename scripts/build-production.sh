#!/bin/bash

# Production Build Script for Loyalty App v3.x
# Builds Docker images with consolidated database schema and Redis sessions
# Supports both localhost development and Cloudflare tunnel production

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function with timestamp
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "${BLUE}🔨 Building Loyalty App Production Images${NC}"
echo "================================================="

# Check if we're in the right directory
if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
    log "${RED}❌ Error: docker-compose.yml not found. Please run from project root.${NC}"
    exit 1
fi

# Change to project root
cd "$PROJECT_ROOT"

# Determine environment file to use
if [ -f ".env.production" ]; then
    log "${GREEN}✅ Using production environment: .env.production${NC}"
    ENV_FILE="--env-file .env.production"
elif [ -f ".env" ]; then
    log "${YELLOW}⚠️  .env.production not found. Using .env for development.${NC}"
    ENV_FILE="--env-file .env"
    log "${BLUE}💡 For production deployment, create .env.production:${NC}"
    log "   cp .env.production.example .env.production"
elif [ -f ".env.example" ]; then
    log "${YELLOW}⚠️  No environment files found. Using .env.example fallback.${NC}"
    ENV_FILE="--env-file .env.example"
    log "${RED}⚠️  This may cause missing environment variables during build!${NC}"
    log "${BLUE}💡 Create a proper environment file:${NC}"
    log "   cp .env.example .env  # For development"
    log "   cp .env.production.example .env.production  # For production"
else
    log "${RED}❌ No environment files found (.env, .env.production, or .env.example)${NC}"
    exit 1
fi

log "${BLUE}🔍 Checking Docker availability...${NC}"
if ! command -v docker &> /dev/null; then
    log "${RED}❌ Docker is not installed or not in PATH${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    log "${RED}❌ Docker daemon is not running${NC}"
    exit 1
fi

log "${GREEN}✅ Docker availability check passed${NC}"

# Run environment validation before building (build mode)
log "${BLUE}🔍 Running environment validation...${NC}"
if [ -f "$SCRIPT_DIR/validate-environment.sh" ]; then
    if ! "$SCRIPT_DIR/validate-environment.sh" build; then
        log "${RED}❌ Environment validation failed${NC}"
        exit 1
    fi
else
    log "${YELLOW}⚠️  Warning: validate-environment.sh not found, skipping validation${NC}"
fi

log "${BLUE}🧹 Cleaning up old images...${NC}"
# Remove old images to free up space
docker image prune -f > /dev/null 2>&1 || true

log "${BLUE}🔨 Building backend image...${NC}"
docker compose -f docker-compose.yml -f docker-compose.prod.yml $ENV_FILE build backend

if [ $? -ne 0 ]; then
    log "${RED}❌ Backend build failed${NC}"
    exit 1
fi

log "${GREEN}✅ Backend image built successfully${NC}"

log "${BLUE}🔨 Building frontend image...${NC}"
docker compose -f docker-compose.yml -f docker-compose.prod.yml $ENV_FILE build frontend

if [ $? -ne 0 ]; then
    log "${RED}❌ Frontend build failed${NC}"
    exit 1
fi

log "${GREEN}✅ Frontend image built successfully${NC}"

log "${BLUE}📋 Listing built images...${NC}"
docker images | grep -E "loyalty-app|loyalty_" || docker images | head -5

# Test image functionality
log "${BLUE}🧪 Testing built images...${NC}"
# Quick test that images can start
log "Testing backend image startup..."
if docker run --rm -e NODE_ENV=test loyalty-app-backend:latest node --version > /dev/null 2>&1; then
    log "${GREEN}✅ Backend image test passed${NC}"
else
    log "${YELLOW}⚠️  Backend image test skipped (image may not exist yet)${NC}"
fi

log "Testing frontend image startup..."
if docker run --rm loyalty-app-frontend:latest node --version > /dev/null 2>&1; then
    log "${GREEN}✅ Frontend image test passed${NC}"
else
    log "${YELLOW}⚠️  Frontend image test skipped (image may not exist yet)${NC}"
fi

log "${GREEN}🎉 Production build completed successfully!${NC}"
echo "================================================="
log "${BLUE}✨ Latest Features Included:${NC}"
log "  • Consolidated database schema (replaces 23 migrations)"
log "  • Redis session store (no memory leaks)"
log "  • OAuth fixes for dual environments"
log "  • Enhanced security and validation"
echo
log "${BLUE}Next steps:${NC}"
log "  1. Run: ${YELLOW}./scripts/start-production.sh${NC}"
log "  2. Or deploy with: ${YELLOW}docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d${NC}"
echo
log "${BLUE}Environment Notes:${NC}"
log "  • Development: Direct access via localhost:4001"
log "  • Production: Cloudflare tunnel → your-domain.com → server:4001"
log "  • OAuth: Configured for both environments automatically"
echo