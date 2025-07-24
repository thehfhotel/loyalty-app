#!/bin/bash

# Production Start Script for Loyalty App
# Usage: ./scripts/start-production.sh
# This script starts the entire production system with health checks

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Log function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Change to project root
cd "$PROJECT_ROOT"

log "${GREEN}🚀 Starting Loyalty App Production System${NC}"
echo "================================================="

# Check if we're in the right directory
if [[ ! -f "docker-compose.yml" ]]; then
    error "docker-compose.yml not found. Make sure you're running this from the project root."
    exit 1
fi

# Determine which environment file to use
ENV_FILE=""
if [[ -f ".env.production" ]]; then
    ENV_FILE=".env.production"
    success "✅ Using production environment: .env.production"
elif [[ -f ".env" ]]; then
    warning "⚠️  .env.production not found, using .env for development mode"
    ENV_FILE=".env"
    echo "For production deployment, create .env.production:"
    echo "cp .env.production.example .env.production"
    echo "Then edit .env.production with your production settings."
    echo
    read -p "Continue with .env file? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    error "No environment file found!"
    echo "Please create an environment file:"
    echo
    if [[ -f ".env.production.example" ]]; then
        echo "For production:"
        echo "  cp .env.production.example .env.production"
        echo "  # Edit .env.production with your production settings"
    fi
    if [[ -f ".env.example" ]]; then
        echo "For development:"
        echo "  cp .env.example .env"
        echo "  # Edit .env with your development settings"
    fi
    echo
    echo "Then run this script again."
    exit 1
fi

# Check Docker and Docker Compose
log "🔍 Checking system requirements..."

if ! command -v docker &> /dev/null; then
    error "Docker is not installed or not in PATH"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    error "Docker Compose plugin is not available (install Docker Compose V2)"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    error "Docker daemon is not running"
    exit 1
fi

success "✅ System requirements check passed"

# Check for conflicting services
log "🔍 Checking for port conflicts..."

check_port() {
    local port=$1
    local service=$2
    if netstat -tln 2>/dev/null | grep -q ":$port "; then
        warning "Port $port is already in use (needed for $service)"
        echo "Consider stopping the conflicting service or change the port configuration"
        read -p "Continue anyway? [y/N]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

check_port 4001 "Frontend"
check_port 4000 "Backend API"
check_port 5434 "PostgreSQL"
check_port 6379 "Redis"

success "✅ Port availability check completed"

# Stop any existing containers
log "🛑 Stopping any existing containers..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" down --remove-orphans 2>/dev/null || true

# Pull latest base images (postgres, redis, nginx)
log "📥 Pulling latest base images..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" pull postgres redis nginx

# Check if application images exist
log "🔍 Checking for pre-built application images..."
if ! docker images | grep -q "loyalty-app-backend" || ! docker images | grep -q "loyalty-app-frontend"; then
    warning "⚠️  Application images not found!"
    echo "Please build the application images first by running:"
    echo "  ./scripts/build-production.sh"
    echo ""
    read -p "Would you like to build the images now? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "🔨 Building application images..."
        docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" build backend frontend
    else
        error "Cannot start without application images"
        exit 1
    fi
else
    success "✅ Using pre-built application images"
fi

# Start the production system
log "🚀 Starting production services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d

# Wait for services to start
log "⏳ Waiting for services to initialize..."
sleep 10

# Health check function
health_check() {
    local service=$1
    local url=$2
    local timeout=${3:-30}
    local count=0
    
    log "🔍 Checking $service health..."
    
    while [ $count -lt $timeout ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
            success "✅ $service is healthy"
            return 0
        fi
        
        count=$((count + 1))
        sleep 1
        echo -n "."
    done
    
    echo
    error "❌ $service health check failed after ${timeout}s"
    return 1
}

# Perform health checks
log "🏥 Performing health checks..."

# Check application through nginx proxy
if ! health_check "Application (via nginx)" "http://localhost:4001" 60; then
    error "Application is not responding through nginx proxy"
    echo "Checking individual service logs:"
    echo "Frontend logs:"
    docker compose --env-file "$ENV_FILE" logs frontend | tail -10
    echo "Backend logs:"
    docker compose --env-file "$ENV_FILE" logs backend | tail -10
    echo "Nginx logs:"
    docker compose --env-file "$ENV_FILE" logs nginx | tail -10
    exit 1
fi

# Check API endpoint through nginx
if ! health_check "Backend API (via nginx)" "http://localhost:4001/api/health" 30; then
    warning "API health endpoint not responding (this may be normal if no health endpoint exists)"
fi

# Check database connectivity
log "🔍 Checking database connectivity..."
if docker compose --env-file "$ENV_FILE" exec -T postgres pg_isready -U loyalty -d loyalty_db >/dev/null 2>&1; then
    success "✅ Database is ready"
else
    error "❌ Database connection failed"
    docker compose --env-file "$ENV_FILE" logs postgres | tail -20
    exit 1
fi

# Check Redis connectivity
log "🔍 Checking Redis connectivity..."
if docker compose --env-file "$ENV_FILE" exec -T redis redis-cli ping | grep -q PONG; then
    success "✅ Redis is ready"
else
    error "❌ Redis connection failed"
    docker compose --env-file "$ENV_FILE" logs redis | tail -20
    exit 1
fi

# Display service status
log "📊 Service Status:"
docker compose --env-file "$ENV_FILE" ps

# Show resource usage
log "💻 Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Final success message
echo
echo "================================================="
success "🎉 Production system started successfully!"
echo
echo "🌐 Access Points:"
echo "   Application: http://localhost:4001 (via nginx proxy)"
echo "   API Endpoints: http://localhost:4001/api/* (via nginx proxy)"
echo "   Database: localhost:5434 (external access for development only)"
echo
echo "📋 Management Commands:"
echo "   Stop system: ./scripts/stop-production.sh"
echo "   Restart system: ./scripts/restart-production.sh"
echo "   View logs: docker compose logs -f [service]"
echo "   Check status: docker compose ps"
echo
echo "📁 Log Files Location:"
echo "   View logs: docker compose logs [service]"
echo "   Follow logs: docker compose logs -f"
echo
warning "🔒 Security Reminder:"
echo "   - Ensure your .env.production file is secure"
echo "   - Keep your OAuth secrets confidential"
echo "   - Monitor system resources and logs"
echo "   - Set up proper firewall rules"
echo
echo "================================================="