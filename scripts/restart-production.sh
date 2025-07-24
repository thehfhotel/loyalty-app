#!/bin/bash

# Production Restart Script for Loyalty App
# Usage: ./scripts/restart-production.sh [--force] [--rebuild] [--backup]
# This script safely restarts the production system

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

# Parse command line arguments
FORCE_RESTART=false
REBUILD_IMAGES=false
CREATE_BACKUP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_RESTART=true
            shift
            ;;
        --rebuild)
            REBUILD_IMAGES=true
            shift
            ;;
        --backup)
            CREATE_BACKUP=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--force] [--rebuild] [--backup]"
            echo "  --force    Force restart (kill containers instead of graceful shutdown)"
            echo "  --rebuild  Rebuild images before restarting"
            echo "  --backup   Create database backup before restart"
            echo "  --help     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

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

log "${YELLOW}🔄 Restarting Loyalty App Production System${NC}"
echo "================================================="

# Check if we're in the right directory
if [[ ! -f "docker compose.yml" ]]; then
    error "docker compose.yml not found. Make sure you're running this from the project root."
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
else
    error "No environment file found!"
    echo "Please create an environment file:"
    if [[ -f ".env.production.example" ]]; then
        echo "  cp .env.production.example .env.production"
    fi
    exit 1
fi

# Show current status
log "📊 Current system status:"
docker compose --env-file "$ENV_FILE" ps

# Create backup if requested
if [[ "$CREATE_BACKUP" == "true" ]]; then
    log "💾 Creating database backup before restart..."
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_file="backup_before_restart_${timestamp}.sql"
    
    if docker compose --env-file "$ENV_FILE" exec -T postgres pg_dump -U loyalty loyalty_db > "$backup_file" 2>/dev/null; then
        success "✅ Database backup created: $backup_file"
    else
        warning "⚠️  Database backup failed"
        read -p "Continue with restart anyway? [y/N]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# Stop the system
log "🛑 Stopping current system..."
stop_args=""
if [[ "$FORCE_RESTART" == "true" ]]; then
    stop_args="--force"
fi

# Use our stop script
if [[ -x "$SCRIPT_DIR/stop-production.sh" ]]; then
    "$SCRIPT_DIR/stop-production.sh" $stop_args
else
    # Fallback to basic stop
    if [[ "$FORCE_RESTART" == "true" ]]; then
        docker compose --env-file "$ENV_FILE" kill
    else
        docker compose --env-file "$ENV_FILE" down --remove-orphans
    fi
fi

# Wait a moment after stop
sleep 2

# Rebuild images if requested
if [[ "$REBUILD_IMAGES" == "true" ]]; then
    log "🔨 Rebuilding application images..."
    export COMPOSE_FILE=docker compose.yml:docker compose.prod.yml
    docker compose --env-file "$ENV_FILE" build --no-cache
    
    # Clean up dangling images
    log "🧹 Cleaning up old images..."
    docker image prune -f
fi

# Start the system
log "🚀 Starting production system..."
if [[ -x "$SCRIPT_DIR/start-production.sh" ]]; then
    "$SCRIPT_DIR/start-production.sh"
else
    # Fallback to basic start
    export COMPOSE_FILE=docker compose.yml:docker compose.prod.yml
    docker compose --env-file "$ENV_FILE" up -d
    
    # Basic health check
    log "⏳ Waiting for services to start..."
    sleep 15
    
    # Check if services are running
    if ! docker compose --env-file "$ENV_FILE" ps | grep -q "Up"; then
        error "❌ Services failed to start properly"
        docker compose --env-file "$ENV_FILE" logs --tail=20
        exit 1
    fi
fi

# Show final status
log "📊 Final system status:"
docker compose --env-file "$ENV_FILE" ps

# Show resource usage
log "💻 Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Calculate restart time
restart_end_time=$(date +%s)

# Final success message
echo
echo "================================================="
success "🎉 Production system restarted successfully!"
echo

if [[ "$CREATE_BACKUP" == "true" && -f "$backup_file" ]]; then
    echo "💾 Backup created: $backup_file"
fi

if [[ "$REBUILD_IMAGES" == "true" ]]; then
    echo "🔨 Images were rebuilt"
fi

if [[ "$FORCE_RESTART" == "true" ]]; then
    warning "⚡ Force restart was used (not graceful)"
fi

echo
echo "🌐 Access Points:"
echo "   Frontend: http://localhost:4001"
echo "   Backend API: http://localhost:4000"
echo "   Database: localhost:5434 (external access)"
echo
echo "📋 Useful Commands:"
echo "   Check logs: docker compose logs -f [service]"
echo "   Check status: docker compose ps"
echo "   Monitor resources: docker stats"
echo "   Stop system: ./scripts/stop-production.sh"
echo
echo "================================================="