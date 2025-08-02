#!/bin/bash

# Emergency Deployment Rollback Script
# This script provides quick rollback capabilities for production deployments

set -e

echo "🚨 Emergency Deployment Rollback"
echo "=================================="

# Configuration
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
BACKUP_DIR="backups"
MAX_ROLLBACK_ATTEMPTS=3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --commit HASH       Rollback to specific commit"
    echo "  --backup FILE       Restore specific database backup"
    echo "  --quick             Quick rollback (stop containers only)"
    echo "  --full              Full rollback (containers + database)"
    echo "  --list-backups      List available database backups"
    echo "  --list-commits      List recent commits for rollback"
    echo "  --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --quick                           # Quick container rollback"
    echo "  $0 --commit abc1234                  # Rollback to specific commit"
    echo "  $0 --backup backup_20250802_120000.sql  # Restore specific backup"
    echo "  $0 --full --commit abc1234           # Full rollback with database"
}

# Function to list available backups
list_backups() {
    log_info "Available database backups:"
    if [ -d "$BACKUP_DIR" ] && [ "$(ls -A $BACKUP_DIR)" ]; then
        ls -lah "$BACKUP_DIR"/backup_*.sql | tail -10
    else
        log_warn "No backups found in $BACKUP_DIR"
    fi
}

# Function to list recent commits
list_commits() {
    log_info "Recent commits (last 10):"
    git log --oneline -10
}

# Function to check if containers are running
check_containers() {
    if docker compose $COMPOSE_FILES ps -q | head -1 | grep -q .; then
        return 0
    else
        return 1
    fi
}

# Function to quick rollback (containers only)
quick_rollback() {
    log_info "Performing quick rollback (containers only)..."
    
    if check_containers; then
        log_info "Stopping containers..."
        docker compose $COMPOSE_FILES down --timeout 30 || {
            log_warn "Graceful shutdown failed, forcing stop..."
            docker compose $COMPOSE_FILES down --timeout 5 -v
        }
        log_info "✅ Containers stopped"
    else
        log_warn "No containers currently running"
    fi
    
    # Clean up problematic resources
    log_info "Cleaning up resources..."
    docker system prune -f 2>/dev/null || true
    docker volume prune -f 2>/dev/null || true
    
    log_info "✅ Quick rollback completed"
}

# Function to rollback to specific commit
commit_rollback() {
    local target_commit=$1
    
    if [ -z "$target_commit" ]; then
        log_error "No commit specified"
        exit 1
    fi
    
    log_info "Rolling back to commit: $target_commit"
    
    # Validate commit exists
    if ! git rev-parse --verify "$target_commit" >/dev/null 2>&1; then
        log_error "Invalid commit hash: $target_commit"
        exit 1
    fi
    
    # Stop containers first
    quick_rollback
    
    # Create rollback branch
    rollback_branch="rollback-$(date +%Y%m%d-%H%M%S)"
    log_info "Creating rollback branch: $rollback_branch"
    git checkout -b "$rollback_branch"
    
    # Reset to target commit
    log_info "Resetting to commit: $target_commit"
    git reset --hard "$target_commit"
    
    log_info "✅ Code rollback completed to commit: $target_commit"
    log_warn "Remember to rebuild and restart containers"
}

# Function to restore database backup
restore_backup() {
    local backup_file=$1
    
    if [ -z "$backup_file" ]; then
        log_error "No backup file specified"
        exit 1
    fi
    
    local backup_path="$BACKUP_DIR/$backup_file"
    
    if [ ! -f "$backup_path" ]; then
        log_error "Backup file not found: $backup_path"
        exit 1
    fi
    
    log_warn "⚠️  DATABASE RESTORE OPERATION ⚠️"
    log_warn "This will REPLACE the current database with: $backup_file"
    read -p "Are you sure? (type 'yes' to continue): " confirm
    
    if [ "$confirm" != "yes" ]; then
        log_info "Database restore cancelled"
        return 1
    fi
    
    log_info "Restoring database from: $backup_file"
    
    # Ensure database container is running
    if ! docker compose $COMPOSE_FILES ps postgres | grep -q "running"; then
        log_info "Starting database container..."
        docker compose $COMPOSE_FILES up -d postgres
        sleep 10
    fi
    
    # Create current backup before restore
    current_backup="$BACKUP_DIR/pre-rollback-$(date +%Y%m%d_%H%M%S).sql"
    log_info "Creating current database backup: $current_backup"
    docker compose $COMPOSE_FILES exec -T postgres pg_dump -U loyalty -d loyalty_db > "$current_backup" || {
        log_warn "Failed to create pre-rollback backup"
    }
    
    # Restore the backup
    log_info "Restoring database..."
    if docker compose $COMPOSE_FILES exec -T postgres psql -U loyalty -d loyalty_db < "$backup_path"; then
        log_info "✅ Database restored successfully"
    else
        log_error "❌ Database restore failed"
        exit 1
    fi
}

# Function to perform full rollback
full_rollback() {
    local target_commit=$1
    local backup_file=$2
    
    log_warn "⚠️  FULL ROLLBACK OPERATION ⚠️"
    log_warn "This will rollback both code and database"
    read -p "Are you sure? (type 'yes' to continue): " confirm
    
    if [ "$confirm" != "yes" ]; then
        log_info "Full rollback cancelled"
        return 1
    fi
    
    # Rollback code if commit specified
    if [ -n "$target_commit" ]; then
        commit_rollback "$target_commit"
    fi
    
    # Restore database if backup specified
    if [ -n "$backup_file" ]; then
        restore_backup "$backup_file"
    fi
    
    log_info "✅ Full rollback completed"
}

# Main script logic
QUICK_ROLLBACK=false
FULL_ROLLBACK=false
TARGET_COMMIT=""
BACKUP_FILE=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --commit)
            TARGET_COMMIT="$2"
            shift 2
            ;;
        --backup)
            BACKUP_FILE="$2"
            shift 2
            ;;
        --quick)
            QUICK_ROLLBACK=true
            shift
            ;;
        --full)
            FULL_ROLLBACK=true
            shift
            ;;
        --list-backups)
            list_backups
            exit 0
            ;;
        --list-commits)
            list_commits
            exit 0
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    log_error "docker-compose.yml not found. Please run from project root directory."
    exit 1
fi

# Execute based on options
if [ "$QUICK_ROLLBACK" = true ]; then
    quick_rollback
elif [ "$FULL_ROLLBACK" = true ]; then
    full_rollback "$TARGET_COMMIT" "$BACKUP_FILE"
elif [ -n "$TARGET_COMMIT" ]; then
    commit_rollback "$TARGET_COMMIT"
elif [ -n "$BACKUP_FILE" ]; then
    restore_backup "$BACKUP_FILE"
else
    log_error "No action specified"
    show_usage
    exit 1
fi

log_info "Rollback operation completed at $(date)"