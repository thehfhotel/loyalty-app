#!/bin/bash

# =============================================================================
# LOYALTY APP - DATABASE DEPLOYMENT SCRIPT
# =============================================================================
# This script provides a safe, reliable way to deploy the loyalty app database
# using the consolidated schema approach.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-loyalty_db}"
DB_USER="${DB_USER:-loyalty}"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Parse command line arguments
FORCE_DEPLOY=false
BACKUP_EXISTING=false
SEED_DATA=false

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Deploy the loyalty app database using consolidated schema"
    echo ""
    echo "OPTIONS:"
    echo "  --force          Force deployment (drops existing database)"
    echo "  --backup         Create backup before deployment"
    echo "  --seed           Load seed data after schema deployment"
    echo "  --help           Show this help message"
    echo ""
    echo "ENVIRONMENT VARIABLES:"
    echo "  DB_HOST          Database host (default: localhost)"
    echo "  DB_PORT          Database port (default: 5432)"  
    echo "  DB_NAME          Database name (default: loyalty_db)"
    echo "  DB_USER          Database user (default: loyalty)"
    echo ""
    echo "EXAMPLES:"
    echo "  $0                           # Deploy to fresh database"
    echo "  $0 --force --backup          # Force deploy with backup"
    echo "  $0 --seed                    # Deploy with seed data"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_DEPLOY=true
            shift
            ;;
        --backup)
            BACKUP_EXISTING=true
            shift
            ;;
        --seed)
            SEED_DATA=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Log functions
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

# Main deployment
main() {
    log "${GREEN}🚀 Loyalty App Database Deployment${NC}"
    echo "=============================================="
    echo "Host: $DB_HOST:$DB_PORT"
    echo "Database: $DB_NAME"
    echo "User: $DB_USER"
    echo "Force Deploy: $FORCE_DEPLOY"
    echo "Backup: $BACKUP_EXISTING"
    echo "Seed Data: $SEED_DATA"
    echo "=============================================="

    # Check prerequisites
    log "🔍 Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        error "Docker is required but not installed"
        exit 1
    fi

    if ! docker compose ps postgres | grep -q "healthy\|Up"; then
        error "PostgreSQL container is not running. Please start it first:"
        echo "  docker compose up -d postgres"
        exit 1
    fi

    # Check if consolidated schema exists
    if [[ ! -f "$SCRIPT_DIR/consolidated_schema.sql" ]]; then
        error "Consolidated schema not found: $SCRIPT_DIR/consolidated_schema.sql"
        exit 1
    fi

    success "✅ Prerequisites check passed"

    # Check if database exists and has tables
    log "🔍 Checking existing database..."
    
    TABLE_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs || echo "0")
    
    if [[ "$TABLE_COUNT" -gt 0 ]]; then
        warning "Database exists with $TABLE_COUNT tables"
        
        if [[ "$FORCE_DEPLOY" != "true" ]]; then
            echo "Use --force to redeploy existing database"
            echo "Use --backup to create backup before force deploy"
            exit 1
        fi
        
        # Create backup if requested
        if [[ "$BACKUP_EXISTING" == "true" ]]; then
            log "💾 Creating database backup..."
            BACKUP_FILE="$PROJECT_ROOT/database_backup_$(date +%Y%m%d_%H%M%S).sql"
            
            if docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE"; then
                success "✅ Backup created: $BACKUP_FILE"
            else
                error "Failed to create backup"
                exit 1
            fi
        fi
        
        # Drop and recreate database
        log "🗑️ Dropping existing database..."
        docker compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
        docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
        
        success "✅ Database recreated"
    else
        log "📄 Deploying to empty database"
    fi

    # Deploy consolidated schema
    log "🔨 Deploying consolidated schema..."
    
    if docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -f /docker-entrypoint-initdb.d/consolidated_schema.sql; then
        success "✅ Consolidated schema deployed successfully"
    else
        error "Failed to deploy consolidated schema"
        exit 1
    fi

    # Load seed data if requested
    if [[ "$SEED_DATA" == "true" ]]; then
        if [[ -f "$SCRIPT_DIR/seeds/001_survey_data.sql" ]]; then
            log "🌱 Loading seed data..."
            
            if docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -f /docker-entrypoint-initdb.d/seeds/001_survey_data.sql; then
                success "✅ Seed data loaded successfully"
            else
                warning "⚠️ Failed to load seed data (continuing)"
            fi
        else
            warning "⚠️ Seed data file not found, skipping"
        fi
    fi

    # Verify deployment
    log "🔍 Verifying deployment..."
    
    FINAL_TABLE_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | xargs)
    FUNCTION_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';" | xargs)
    
    if [[ "$FINAL_TABLE_COUNT" -eq 24 ]]; then
        success "✅ Database verification passed"
        echo "Tables: $FINAL_TABLE_COUNT"
        echo "Functions: $FUNCTION_COUNT"
        echo "Schema: Consolidated (replaces 23 migrations)"
    else
        error "Database verification failed. Expected 24 tables, got $FINAL_TABLE_COUNT"
        exit 1
    fi

    # Final success message
    echo ""
    echo "=============================================="
    success "🎉 Database deployment completed successfully!"
    echo ""
    echo "📊 Database Status:"
    echo "   Tables: $FINAL_TABLE_COUNT"
    echo "   Functions: $FUNCTION_COUNT"
    echo "   Schema Version: Consolidated"
    echo "   Seed Data: $([ "$SEED_DATA" == "true" ] && echo "Loaded" || echo "Not loaded")"
    echo ""
    echo "🔗 Connection Info:"
    echo "   Host: $DB_HOST:$DB_PORT"
    echo "   Database: $DB_NAME"
    echo "   User: $DB_USER"
    echo ""
    echo "📋 Next Steps:"
    echo "   Start application: ./scripts/start-production.sh"
    echo "   Connect to DB: docker compose exec postgres psql -U $DB_USER -d $DB_NAME"
    echo "   View tables: \\dt"
    echo "=============================================="
}

# Run main function
main "$@"