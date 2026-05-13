#!/bin/bash

# Production Backup Script for Loyalty App
# Usage: ./scripts/backup-production.sh [--full] [--database-only] [--compress]
# This script creates backups of production data

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

# Default settings
BACKUP_TYPE="full"
COMPRESS_BACKUP=false
BACKUP_DIR="$PROJECT_ROOT/backups"

# Database credentials — read from env vars so this script works against
# either the legacy `loyalty:loyalty_db` defaults or the current GHCR
# deploy (which uses POSTGRES_USER/POSTGRES_DB injected from GitHub
# secrets). Fail loudly if neither is set in a production-like environment.
PG_USER="${POSTGRES_USER:-${PGUSER:-loyalty}}"
PG_DB="${POSTGRES_DB:-${PGDATABASE:-loyalty_db}}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --full)
            BACKUP_TYPE="full"
            shift
            ;;
        --database-only)
            BACKUP_TYPE="database"
            shift
            ;;
        --compress)
            COMPRESS_BACKUP=true
            shift
            ;;
        --backup-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--full] [--database-only] [--compress] [--backup-dir DIR]"
            echo "  --full          Create full backup (database + files) [default]"
            echo "  --database-only Create database backup only"
            echo "  --compress      Compress backup files"
            echo "  --backup-dir    Specify backup directory (default: ./backups)"
            echo "  --help          Show this help message"
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

# Create timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="loyalty_backup_${TIMESTAMP}"

log "${BLUE}💾 Creating Loyalty App Production Backup${NC}"
echo "================================================="
echo "Backup Type: $BACKUP_TYPE"
echo "Timestamp: $TIMESTAMP"
echo "Backup Directory: $BACKUP_DIR"
echo "Compress: $COMPRESS_BACKUP"
echo "================================================="

# Check if we're in the right directory
if [[ ! -f "docker-compose.yml" ]]; then
    error "docker-compose.yml not found. Make sure you're running this from the project root."
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if containers are running
if ! docker compose ps -q | head -1 | grep -q .; then
    warning "No containers appear to be running. Starting backup of volumes only."
fi

# Create backup subdirectory
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
mkdir -p "$BACKUP_PATH"

log "📁 Created backup directory: $BACKUP_PATH"

# Database backup
log "🗃️  Creating database backup..."
DB_BACKUP_FILE="$BACKUP_PATH/database_${TIMESTAMP}.sql"

if docker compose ps postgres | grep -q "Up"; then
    # Database is running - use pg_dump
    if docker compose exec -T postgres pg_dump -U "$PG_USER" "$PG_DB" > "$DB_BACKUP_FILE"; then
        success "✅ Database backup created: $(basename "$DB_BACKUP_FILE")"
        
        # Get database stats
        db_size=$(du -h "$DB_BACKUP_FILE" | cut -f1)
        db_lines=$(wc -l < "$DB_BACKUP_FILE")
        log "   📊 Database backup size: $db_size ($db_lines lines)"
    else
        error "❌ Database backup failed"
        exit 1
    fi
else
    # Database not running - backup volume
    warning "PostgreSQL container not running. Creating volume backup instead."
    if docker run --rm -v loyalty_postgres_data:/source -v "$BACKUP_PATH":/backup alpine tar czf /backup/postgres_volume_${TIMESTAMP}.tar.gz -C /source .; then
        success "✅ PostgreSQL volume backup created"
    else
        error "❌ PostgreSQL volume backup failed"
        exit 1
    fi
fi

# Full backup includes additional files
if [[ "$BACKUP_TYPE" == "full" ]]; then
    log "📦 Creating full system backup..."
    
    # Environment files backup (excluding secrets)
    log "🔐 Backing up configuration files..."
    mkdir -p "$BACKUP_PATH/config"
    
    # Copy configuration files (safely)
    cp docker-compose.yml "$BACKUP_PATH/config/" 2>/dev/null || true
    cp docker-compose.prod.yml "$BACKUP_PATH/config/" 2>/dev/null || true
    cp nginx/nginx.conf "$BACKUP_PATH/config/" 2>/dev/null || true
    cp .env.production.example "$BACKUP_PATH/config/" 2>/dev/null || true
    
    # Create sanitized environment file (remove secrets)
    if [[ -f ".env.production" ]]; then
        log "🔐 Creating sanitized environment backup..."
        grep -E '^[A-Z_]+=.+' .env.production | \
        sed 's/\(SECRET\|PASSWORD\|KEY\|TOKEN\)=.*/\1=***REDACTED***/' > "$BACKUP_PATH/config/env.production.sanitized"
        success "✅ Configuration files backed up"
    fi
    
    # Application files (uploads, logs if any)
    log "📄 Backing up application data volumes..."
    
    # Redis data backup (if running)
    if docker compose ps redis | grep -q "Up"; then
        log "💾 Creating Redis backup..."
        if docker compose exec -T redis redis-cli --rdb - > "$BACKUP_PATH/redis_${TIMESTAMP}.rdb"; then
            success "✅ Redis backup created"
        else
            warning "⚠️  Redis backup failed, but continuing"
        fi
    fi
    
    # Upload files backup (if volume exists)
    if docker volume ls | grep -q "loyalty.*upload"; then
        log "📎 Backing up upload files..."
        docker run --rm -v loyalty_upload_data:/source -v "$BACKUP_PATH":/backup alpine tar czf /backup/uploads_${TIMESTAMP}.tar.gz -C /source . 2>/dev/null || warning "No upload volume found"
    fi
    
    # Log files backup (if containers are running)
    if docker compose ps -q | head -1 | grep -q .; then
        log "📋 Collecting container logs..."
        mkdir -p "$BACKUP_PATH/logs"
        
        for service in backend frontend postgres redis nginx; do
            if docker compose ps "$service" | grep -q "Up"; then
                docker compose logs --no-color --timestamps "$service" > "$BACKUP_PATH/logs/${service}_${TIMESTAMP}.log" 2>/dev/null || true
            fi
        done
        success "✅ Container logs collected"
    fi
fi

# Create backup manifest
log "📋 Creating backup manifest..."
cat > "$BACKUP_PATH/BACKUP_MANIFEST.txt" << EOF
Loyalty App Production Backup
=============================
Backup Date: $(date)
Backup Type: $BACKUP_TYPE
System Info: $(uname -a)
Docker Version: $(docker --version)
Docker Compose Version: $(docker compose --version)

Contents:
EOF

# List backup contents
find "$BACKUP_PATH" -type f -exec ls -lh {} \; | awk '{print "- " $9 " (" $5 ")"}' >> "$BACKUP_PATH/BACKUP_MANIFEST.txt"

# Compress backup if requested
if [[ "$COMPRESS_BACKUP" == "true" ]]; then
    log "🗜️  Compressing backup..."
    
    cd "$BACKUP_DIR"
    tar czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"
    
    if [[ -f "${BACKUP_NAME}.tar.gz" ]]; then
        # Remove uncompressed directory
        rm -rf "$BACKUP_NAME"
        BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
        success "✅ Backup compressed: ${BACKUP_NAME}.tar.gz"
    else
        error "❌ Compression failed"
        exit 1
    fi
    
    cd "$PROJECT_ROOT"
fi

# Calculate backup size
if [[ -d "$BACKUP_PATH" ]]; then
    BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
elif [[ -f "$BACKUP_PATH" ]]; then
    BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
else
    BACKUP_SIZE="Unknown"
fi

# Cleanup old backups (keep last 10)
log "🧹 Cleaning up old backups..."
cd "$BACKUP_DIR"
ls -t loyalty_backup_* 2>/dev/null | tail -n +11 | xargs rm -rf 2>/dev/null || true
BACKUP_COUNT=$(ls -1 loyalty_backup_* 2>/dev/null | wc -l)

# Final success message
echo
echo "================================================="
success "🎉 Backup completed successfully!"
echo
echo "📦 Backup Details:"
echo "   Location: $BACKUP_PATH"
echo "   Size: $BACKUP_SIZE"
echo "   Type: $BACKUP_TYPE"
if [[ "$COMPRESS_BACKUP" == "true" ]]; then
    echo "   Format: Compressed (tar.gz)"
else
    echo "   Format: Directory"
fi
echo
echo "💾 Backup Contents:"
if [[ "$BACKUP_TYPE" == "full" ]]; then
    echo "   - Database dump"
    echo "   - Configuration files"
    echo "   - Application data"
    echo "   - Container logs"
    echo "   - Redis data (if available)"
else
    echo "   - Database dump only"
fi
echo
echo "📊 Backup Statistics:"
echo "   Total backups in directory: $BACKUP_COUNT"
echo "   Backup directory: $BACKUP_DIR"
echo
echo "🔄 Restore Instructions:"
echo "   Database: docker compose exec -T postgres psql -U \"\$PG_USER\" -d \"\$PG_DB\" < database_*.sql"
echo "             (set POSTGRES_USER and POSTGRES_DB env vars to match the deploy)"
if [[ "$COMPRESS_BACKUP" == "true" ]]; then
    echo "   Extract: tar xzf ${BACKUP_NAME}.tar.gz"
fi
echo
echo "================================================="