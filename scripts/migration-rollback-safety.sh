#!/bin/bash

# Migration Rollback Safety Script
# Creates database backups and provides safe rollback procedures
# Prevents data loss during migration issues

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_critical() {
    echo -e "${RED}[CRITICAL]${NC} $1"
}

# Configuration
BACKUP_DIR="./database/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MAX_BACKUPS=10

echo "🛡️ Migration Rollback Safety"
echo "========================================"

# Parse command line arguments
OPERATION="${1:-check}"
BACKUP_NAME="${2:-migration_backup_$TIMESTAMP}"

case "$OPERATION" in
    "backup")
        print_status "Creating database backup before migration..."
        ;;
    "rollback")
        print_status "Preparing rollback procedures..."
        ;;
    "check")
        print_status "Checking rollback safety status..."
        ;;
    "cleanup")
        print_status "Cleaning up old backups..."
        ;;
    *)
        echo "Usage: $0 {backup|rollback|check|cleanup} [backup_name]"
        echo ""
        echo "Commands:"
        echo "  backup   - Create database backup before migration"
        echo "  rollback - Show rollback procedures and options"
        echo "  check    - Check rollback safety and backup status"
        echo "  cleanup  - Remove old backups (keep last $MAX_BACKUPS)"
        exit 1
        ;;
esac

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Must run from project root directory"
    exit 1
fi

if [ ! -d "backend" ]; then
    print_error "Backend directory not found"
    exit 1
fi

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

# Function to create database backup
create_database_backup() {
    local backup_name="$1"
    local backup_file="$BACKUP_DIR/${backup_name}.sql"
    
    print_status "Creating database backup: $backup_name"
    
    cd backend
    
    # Get database URL from environment or .env
    local db_url
    if [ -f ".env" ]; then
        db_url=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"')
    fi
    
    if [ -z "$db_url" ]; then
        db_url="$DATABASE_URL"
    fi
    
    if [ -z "$db_url" ]; then
        print_error "DATABASE_URL not found in environment or .env file"
        cd ..
        return 1
    fi
    
    # Extract database connection details
    local db_host db_port db_name db_user db_pass
    
    # Parse PostgreSQL URL format: postgresql://user:pass@host:port/dbname
    if echo "$db_url" | grep -q "postgresql://"; then
        local url_without_scheme="${db_url#postgresql://}"
        local user_pass_host="${url_without_scheme%/*}"
        db_name="${url_without_scheme##*/}"
        
        if echo "$user_pass_host" | grep -q "@"; then
            local user_pass="${user_pass_host%@*}"
            local host_port="${user_pass_host#*@}"
            
            if echo "$user_pass" | grep -q ":"; then
                db_user="${user_pass%:*}"
                db_pass="${user_pass#*:}"
            else
                db_user="$user_pass"
                db_pass=""
            fi
            
            if echo "$host_port" | grep -q ":"; then
                db_host="${host_port%:*}"
                db_port="${host_port#*:}"
            else
                db_host="$host_port"
                db_port="5432"
            fi
        else
            db_host="$user_pass_host"
            db_port="5432"
            db_user="postgres"
            db_pass=""
        fi
    else
        print_error "Unsupported database URL format"
        cd ..
        return 1
    fi
    
    print_status "Connecting to database: $db_user@$db_host:$db_port/$db_name"
    
    # Create backup using pg_dump
    if command -v pg_dump >/dev/null 2>&1; then
        # Set password if provided
        if [ -n "$db_pass" ]; then
            export PGPASSWORD="$db_pass"
        fi
        
        if pg_dump -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" \
           --clean --if-exists --create --verbose \
           > "../$backup_file" 2>/dev/null; then
            print_success "Database backup created: $backup_file"
            
            # Get backup file size
            local backup_size
            backup_size=$(du -h "../$backup_file" | cut -f1)
            print_status "Backup size: $backup_size"
            
            # Create backup metadata
            cat > "../$BACKUP_DIR/${backup_name}.meta" <<EOF
{
  "backup_name": "$backup_name",
  "timestamp": "$TIMESTAMP",
  "database_url": "$db_host:$db_port/$db_name",
  "database_user": "$db_user",
  "backup_file": "$backup_file",
  "backup_size": "$backup_size",
  "created_by": "migration-rollback-safety.sh"
}
EOF
            
            unset PGPASSWORD
            cd ..
            return 0
        else
            print_error "Failed to create database backup"
            unset PGPASSWORD
            cd ..
            return 1
        fi
    else
        print_error "pg_dump not found - install PostgreSQL client tools"
        cd ..
        return 1
    fi
}

# Function to list available backups
list_backups() {
    print_status "Available database backups:"
    
    if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR"/*.sql 2>/dev/null)" ]; then
        echo ""
        printf "%-25s %-15s %-10s %s\n" "BACKUP NAME" "DATE" "SIZE" "STATUS"
        echo "------------------------------------------------------------"
        
        for backup_file in "$BACKUP_DIR"/*.sql; do
            if [ -f "$backup_file" ]; then
                local backup_name
                backup_name=$(basename "$backup_file" .sql)
                local backup_date
                backup_date=$(date -r "$backup_file" +"%Y-%m-%d %H:%M" 2>/dev/null || stat -c %y "$backup_file" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
                local backup_size
                backup_size=$(du -h "$backup_file" | cut -f1)
                
                printf "%-25s %-15s %-10s %s\n" "$backup_name" "$backup_date" "$backup_size" "✓ Ready"
            fi
        done
        echo ""
    else
        print_warning "No database backups found in $BACKUP_DIR"
        echo ""
    fi
}

# Function to show rollback procedures
show_rollback_procedures() {
    print_status "Database Rollback Procedures"
    echo ""
    
    echo "1. EMERGENCY ROLLBACK (if migration fails):"
    echo "   ./scripts/migration-rollback-safety.sh backup pre_rollback_\$(date +%Y%m%d_%H%M%S)"
    echo "   cd backend && npm run db:migrate:reset"
    echo "   # Restore from most recent backup"
    echo ""
    
    echo "2. SELECTIVE ROLLBACK (rollback specific migration):"
    echo "   # Currently not supported by Prisma - would require custom SQL"
    echo "   # Best practice: Create new migration to undo changes"
    echo ""
    
    echo "3. FULL DATABASE RESTORE:"
    echo "   # Drop and recreate database, then restore from backup"
    echo "   # WARNING: This will lose ALL data since backup"
    echo ""
    
    echo "4. DATA-SAFE ROLLBACK:"
    echo "   # Recommended approach - create reverse migration"
    echo "   cd backend && npx prisma migrate dev --name \"rollback_previous_migration\""
    echo ""
    
    list_backups
    
    if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR"/*.sql 2>/dev/null)" ]; then
        echo "To restore from a backup:"
        echo "  psql -h HOST -p PORT -U USER -d DATABASE < $BACKUP_DIR/BACKUP_NAME.sql"
        echo ""
    fi
}

# Function to check rollback safety
check_rollback_safety() {
    local safety_score=0
    local max_score=7
    
    print_status "Checking rollback safety status..."
    echo ""
    
    # Check 1: Backup availability
    if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR"/*.sql 2>/dev/null)" ]; then
        print_success "✓ Database backups available"
        ((safety_score++))
    else
        print_warning "✗ No database backups found"
    fi
    
    # Check 2: Recent backup (within last 24 hours)
    local recent_backup=false
    if [ -d "$BACKUP_DIR" ]; then
        for backup_file in "$BACKUP_DIR"/*.sql; do
            if [ -f "$backup_file" ]; then
                local file_age_hours
                file_age_hours=$(( ($(date +%s) - $(date -r "$backup_file" +%s 2>/dev/null || stat -c %Y "$backup_file" 2>/dev/null || echo 0)) / 3600 ))
                if [ $file_age_hours -lt 24 ]; then
                    recent_backup=true
                    break
                fi
            fi
        done
    fi
    
    if [ "$recent_backup" = true ]; then
        print_success "✓ Recent backup available (< 24 hours)"
        ((safety_score++))
    else
        print_warning "✗ No recent backups (create one before migration)"
    fi
    
    # Check 3: pg_dump availability
    if command -v pg_dump >/dev/null 2>&1; then
        print_success "✓ pg_dump available for backups"
        ((safety_score++))
    else
        print_warning "✗ pg_dump not available (install PostgreSQL client)"
    fi
    
    # Check 4: Database connectivity
    cd backend
    if timeout 10 npm run db:generate >/dev/null 2>&1; then
        print_success "✓ Database connection working"
        ((safety_score++))
    else
        print_warning "✗ Database connection issues"
    fi
    cd ..
    
    # Check 5: Migration files present
    if [ -d "backend/prisma/migrations" ] && [ "$(ls -A backend/prisma/migrations 2>/dev/null)" ]; then
        print_success "✓ Migration files available"
        ((safety_score++))
    else
        print_warning "✗ No migration files found"
    fi
    
    # Check 6: Sufficient disk space
    local available_space_gb
    available_space_gb=$(df . | tail -1 | awk '{print $4}')
    available_space_gb=$((available_space_gb / 1024 / 1024))
    
    if [ $available_space_gb -gt 1 ]; then
        print_success "✓ Sufficient disk space (${available_space_gb}GB)"
        ((safety_score++))
    else
        print_warning "✗ Low disk space (${available_space_gb}GB)"
    fi
    
    # Check 7: Environment configuration
    if [ -f "backend/.env" ] || [ -n "$DATABASE_URL" ]; then
        print_success "✓ Database configuration present"
        ((safety_score++))
    else
        print_warning "✗ Database configuration missing"
    fi
    
    echo ""
    print_status "Rollback Safety Score: $safety_score/$max_score"
    
    if [ $safety_score -eq $max_score ]; then
        print_success "🛡️ EXCELLENT - Rollback safety fully configured"
        return 0
    elif [ $safety_score -ge 5 ]; then
        print_success "✅ GOOD - Rollback safety mostly configured"
        return 0
    elif [ $safety_score -ge 3 ]; then
        print_warning "⚠️ FAIR - Some rollback safety issues"
        return 1
    else
        print_error "❌ POOR - Significant rollback safety risks"
        return 1
    fi
}

# Function to cleanup old backups
cleanup_old_backups() {
    print_status "Cleaning up old backups (keeping last $MAX_BACKUPS)..."
    
    if [ ! -d "$BACKUP_DIR" ]; then
        print_status "No backup directory found"
        return 0
    fi
    
    local backup_count
    backup_count=$(ls -1 "$BACKUP_DIR"/*.sql 2>/dev/null | wc -l)
    
    if [ $backup_count -le $MAX_BACKUPS ]; then
        print_success "Only $backup_count backups found, no cleanup needed"
        return 0
    fi
    
    print_status "Found $backup_count backups, removing oldest $(($backup_count - $MAX_BACKUPS))"
    
    # Remove oldest backups (keep newest MAX_BACKUPS)
    ls -t "$BACKUP_DIR"/*.sql | tail -n +$(($MAX_BACKUPS + 1)) | while read -r old_backup; do
        local backup_name
        backup_name=$(basename "$old_backup" .sql)
        print_status "Removing old backup: $backup_name"
        rm -f "$old_backup"
        rm -f "$BACKUP_DIR/${backup_name}.meta"
    done
    
    print_success "Backup cleanup completed"
}

# Execute operation
case "$OPERATION" in
    "backup")
        create_database_backup "$BACKUP_NAME"
        ;;
    "rollback")
        show_rollback_procedures
        ;;
    "check")
        check_rollback_safety
        ;;
    "cleanup")
        cleanup_old_backups
        ;;
esac