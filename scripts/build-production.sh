#!/bin/bash

# Production Build Script for Loyalty App
# This script builds Docker images for production deployment

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

# Check for production environment file
if [ ! -f ".env.production" ]; then
    log "${YELLOW}⚠️  Warning: .env.production not found. Using development environment.${NC}"
    ENV_FILE="--env-file .env.example"
else
    log "${GREEN}✅ Using production environment: .env.production${NC}"
    ENV_FILE="--env-file .env.production"
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

log "${BLUE}🧹 Cleaning up old images...${NC}"
# Remove old images to free up space
docker image prune -f > /dev/null 2>&1 || true

log "${BLUE}🔨 Building backend image...${NC}"
docker compose -f docker-compose.production.yml $ENV_FILE build backend

if [ $? -ne 0 ]; then
    log "${RED}❌ Backend build failed${NC}"
    exit 1
fi

log "${GREEN}✅ Backend image built successfully${NC}"

log "${BLUE}🔨 Building frontend image...${NC}"
docker compose -f docker-compose.production.yml $ENV_FILE build frontend

if [ $? -ne 0 ]; then
    log "${RED}❌ Frontend build failed${NC}"
    exit 1
fi

log "${GREEN}✅ Frontend image built successfully${NC}"

log "${BLUE}📋 Listing built images...${NC}"
docker images | grep loyalty-app

log "${GREEN}🎉 Production build completed successfully!${NC}"
echo "================================================="
log "${BLUE}Next steps:${NC}"
log "  1. Run: ${YELLOW}./scripts/start-production.sh${NC}"
log "  2. Or deploy with: ${YELLOW}docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d${NC}"
echo ""