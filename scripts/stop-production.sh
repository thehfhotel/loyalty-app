#!/bin/bash

# Production Stop Script for Loyalty App
# Usage: ./scripts/stop-production.sh [--force] [--with-volumes]
# This script gracefully stops the production system

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
FORCE_STOP=false
REMOVE_VOLUMES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_STOP=true
            shift
            ;;
        --with-volumes)
            REMOVE_VOLUMES=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--force] [--with-volumes]"
            echo "  --force        Force stop containers (kill instead of graceful shutdown)"
            echo "  --with-volumes Remove volumes and all data (DESTRUCTIVE)"
            echo "  --help         Show this help message"
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

log "${RED}🛑 Stopping Loyalty App Production System${NC}"
echo "================================================="

# Check if we're in the right directory
if [[ ! -f "docker-compose.yml" ]]; then
    error "docker-compose.yml not found. Make sure you're running this from the project root."
    exit 1
fi

# Check if containers are running
if ! docker compose ps -q | head -1 | grep -q .; then
    warning "No containers appear to be running"
    success "✅ System is already stopped"
    exit 0
fi

# Show current status
log "📊 Current system status:"
docker compose ps

# Warning for volume removal
if [[ "$REMOVE_VOLUMES" == "true" ]]; then
    echo
    warning "⚠️  DESTRUCTIVE OPERATION WARNING ⚠️"
    echo "You have requested to remove volumes with --with-volumes flag."
    echo "This will permanently delete:"
    echo "  - All database data"
    echo "  - All uploaded files"
    echo "  - All Redis cache data"
    echo "  - All log files"
    echo
    read -p "Are you absolutely sure? Type 'DELETE ALL DATA' to confirm: " confirm
    if [[ "$confirm" != "DELETE ALL DATA" ]]; then
        log "Operation cancelled by user"
        exit 0
    fi
fi

# Create backup before stopping (if requested)
if [[ "$REMOVE_VOLUMES" == "false" ]]; then
    log "💾 Creating database backup before shutdown..."
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_file="backup_before_stop_${timestamp}.sql"
    
    if docker compose exec -T postgres pg_dump -U loyalty loyalty_db > "$backup_file" 2>/dev/null; then
        success "✅ Database backup created: $backup_file"
    else
        warning "⚠️  Database backup failed, but continuing with shutdown"
    fi
fi

# Graceful shutdown vs force stop
if [[ "$FORCE_STOP" == "true" ]]; then
    log "⚡ Force stopping all services..."
    docker compose kill
else
    log "🕐 Initiating graceful shutdown..."
    
    # Stop services in reverse dependency order
    log "🛑 Stopping nginx proxy..."
    docker compose stop nginx || true
    
    log "🛑 Stopping frontend..."
    docker compose stop frontend || true
    
    log "🛑 Stopping backend..."
    docker compose stop backend || true
    
    log "🛑 Stopping Redis..."
    docker compose stop redis || true
    
    log "🛑 Stopping PostgreSQL..."
    docker compose stop postgres || true
    
    # Wait a moment for graceful shutdown
    sleep 3
fi

# Remove containers
log "🗑️  Removing containers..."
if [[ "$REMOVE_VOLUMES" == "true" ]]; then
    docker compose down --volumes --remove-orphans
    success "✅ Containers and volumes removed"
else
    docker compose down --remove-orphans
    success "✅ Containers removed"
fi

# Clean up unused Docker resources
log "🧹 Cleaning up unused Docker resources..."
docker system prune -f --volumes=false

# Remove dangling images
log "🗑️  Removing dangling images..."
docker image prune -f

# Final status check
log "📊 Final status check:"
running_containers=$(docker compose ps -q)
if [[ -z "$running_containers" ]]; then
    success "✅ All containers stopped successfully"
else
    warning "⚠️  Some containers may still be running:"
    docker compose ps
fi

# Show disk space recovered
log "💽 Docker disk usage after cleanup:"
docker system df

# Final success message
echo
echo "================================================="
success "🏁 Production system stopped successfully!"
echo

if [[ "$REMOVE_VOLUMES" == "true" ]]; then
    warning "🗑️  All data has been permanently deleted"
    echo "   - Database data: DELETED"
    echo "   - Upload files: DELETED"
    echo "   - Redis cache: DELETED"
    echo "   - Logs: DELETED"
else
    echo "💾 Data preserved:"
    echo "   - Database data: PRESERVED"
    echo "   - Upload files: PRESERVED"
    echo "   - Redis cache: PRESERVED"
    echo "   - Logs: PRESERVED"
    if [[ -f "$backup_file" ]]; then
        echo "   - Backup created: $backup_file"
    fi
fi

echo
echo "📋 Next Steps:"
echo "   Start system: ./scripts/start-production.sh"
echo "   Restart system: ./scripts/restart-production.sh"
echo "   View remaining containers: docker ps -a"
echo "   Clean all Docker data: docker system prune -a --volumes"
echo
echo "================================================="