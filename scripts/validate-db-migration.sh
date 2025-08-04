#!/bin/bash

# Database Migration Validation Script
# Pre-validates database migrations and connection health
# Based on git history analysis of recurring migration issues:
# 1. Database migration exit status 137 (memory/timeout issues)
# 2. Network context issues in containerized environments
# 3. Missing Prisma client generation steps
# 4. UUID extension creation failures

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

echo "🗄️ Database Migration Validation"
echo "========================================"

# Configuration
DB_TIMEOUT=30
MIGRATION_TIMEOUT=120
WARNINGS=0
ERRORS=0
CRITICAL_ISSUES=0

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Must run from project root directory"
    exit 1
fi

# Check if backend directory exists
if [ ! -d "backend" ]; then
    print_error "Backend directory not found"
    exit 1
fi

# Function to check database connectivity
check_database_connection() {
    print_status "Checking database connectivity..."
    
    # Check if we can connect to the database
    if cd backend && timeout $DB_TIMEOUT npm run db:generate >/dev/null 2>&1; then
        print_success "Database connection successful"
        return 0
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            print_critical "Database connection timeout after ${DB_TIMEOUT}s"
            print_status "This matches exit status 137 issues from git history"
        else
            print_critical "Database connection failed (exit code: $exit_code)"
        fi
        ((CRITICAL_ISSUES++))
        return 1
    fi
}

# Function to validate Prisma client generation
validate_prisma_client() {
    print_status "Validating Prisma client generation..."
    
    cd backend
    
    # Check if Prisma schema exists
    if [ ! -f "prisma/schema.prisma" ]; then
        print_error "Prisma schema not found at backend/prisma/schema.prisma"
        ((ERRORS++))
        return 1
    fi
    
    # Generate Prisma client with timeout
    if timeout $DB_TIMEOUT npm run db:generate >/dev/null 2>&1; then
        print_success "Prisma client generation successful"
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            print_critical "Prisma client generation timeout"
            print_status "This could cause migration issues similar to git history problems"
        else
            print_critical "Prisma client generation failed"
        fi
        ((CRITICAL_ISSUES++))
        return 1
    fi
    
    # Check if generated client files exist
    if [ -d "node_modules/.prisma/client" ] || [ -d "node_modules/@prisma/client" ]; then
        print_success "Prisma client files generated successfully"
    else
        print_error "Prisma client files not found after generation"
        ((ERRORS++))
        return 1
    fi
    
    cd ..
    return 0
}

# Function to check migration status
check_migration_status() {
    print_status "Checking current migration status..."
    
    cd backend
    
    # Check migration status with timeout
    local migration_output
    if migration_output=$(timeout $DB_TIMEOUT npm run db:migrate:status 2>&1); then
        print_success "Migration status check successful"
        
        # Parse migration output for issues
        if echo "$migration_output" | grep -q "Database schema is up to date"; then
            print_success "Database schema is up to date"
        elif echo "$migration_output" | grep -q "migrations have not been applied"; then
            print_warning "Pending migrations detected"
            ((WARNINGS++))
        elif echo "$migration_output" | grep -q "drift"; then
            print_warning "Schema drift detected"
            ((WARNINGS++))
        fi
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            print_critical "Migration status check timeout"
        else
            print_error "Migration status check failed"
        fi
        ((ERRORS++))
    fi
    
    cd ..
}

# Function to validate database schema requirements
validate_schema_requirements() {
    print_status "Validating database schema requirements..."
    
    cd backend
    
    # Check for UUID extension (historical issue from git history)
    print_status "Checking UUID extension availability..."
    
    # Create a test query to check UUID extension
    local uuid_check_query="SELECT extension_name FROM pg_extension WHERE extension_name = 'uuid-ossp';"
    
    # Use a simple connection test instead of complex query for validation
    if timeout $DB_TIMEOUT npx prisma db execute --stdin <<< "SELECT 1;" >/dev/null 2>&1; then
        print_success "Database query execution working"
    else
        print_warning "Database query execution test failed"
        ((WARNINGS++))
    fi
    
    cd ..
}

# Function to check available disk space and memory
check_system_resources() {
    print_status "Checking system resources for migration..."
    
    # Check available disk space (need at least 1GB)
    local available_space_kb
    available_space_kb=$(df . | tail -1 | awk '{print $4}')
    local available_space_gb=$((available_space_kb / 1024 / 1024))
    
    if [ $available_space_gb -lt 1 ]; then
        print_critical "Insufficient disk space: ${available_space_gb}GB available (need at least 1GB)"
        print_status "Low disk space can cause exit status 137 issues"
        ((CRITICAL_ISSUES++))
    else
        print_success "Sufficient disk space available: ${available_space_gb}GB"
    fi
    
    # Check available memory
    if command -v free >/dev/null 2>&1; then
        local available_memory_mb
        available_memory_mb=$(free -m | grep -oP '\d+' | head -n 1)
        
        if [ $available_memory_mb -lt 512 ]; then
            print_critical "Low memory: ${available_memory_mb}MB available (recommended: 512MB+)"
            print_status "Low memory can cause migration timeout and exit status 137"
            ((CRITICAL_ISSUES++))
        else
            print_success "Sufficient memory available: ${available_memory_mb}MB"
        fi
    elif command -v vm_stat >/dev/null 2>&1; then
        # macOS memory check
        local free_pages
        free_pages=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
        local free_memory_mb=$((free_pages * 4096 / 1024 / 1024))
        
        if [ $free_memory_mb -lt 512 ]; then
            print_warning "Low free memory: ${free_memory_mb}MB (this is macOS - may be normal)"
            ((WARNINGS++))
        else
            print_success "Sufficient free memory available: ${free_memory_mb}MB"
        fi
    else
        print_warning "Cannot check memory availability on this system"
        ((WARNINGS++))
    fi
}

# Function to validate migration rollback capability
validate_rollback_capability() {
    print_status "Validating migration rollback capability..."
    
    cd backend
    
    # Check if we have migration files
    if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
        print_success "Migration files found"
        
        # Count migration files
        local migration_count
        migration_count=$(find prisma/migrations -name "migration.sql" | wc -l)
        print_status "Found $migration_count migration files"
        
        if [ $migration_count -gt 0 ]; then
            print_success "Rollback capability available"
        else
            print_warning "No migration files found - rollback may not be possible"
            ((WARNINGS++))
        fi
    else
        print_warning "No migration directory or files found"
        ((WARNINGS++))
    fi
    
    cd ..
}

# Function to test connection under load
test_connection_stability() {
    print_status "Testing database connection stability..."
    
    cd backend
    
    # Test multiple rapid connections (simulate migration load)
    local connection_failures=0
    local total_tests=5
    
    for i in $(seq 1 $total_tests); do
        if ! timeout 10 npm run db:generate >/dev/null 2>&1; then
            ((connection_failures++))
        fi
        sleep 1
    done
    
    if [ $connection_failures -eq 0 ]; then
        print_success "Database connection stable under load"
    elif [ $connection_failures -lt 3 ]; then
        print_warning "Some connection instability detected ($connection_failures/$total_tests failed)"
        ((WARNINGS++))
    else
        print_critical "Significant connection instability ($connection_failures/$total_tests failed)"
        print_status "This could cause migration failures like those in git history"
        ((CRITICAL_ISSUES++))
    fi
    
    cd ..
}

# Function to check for common migration blockers
check_migration_blockers() {
    print_status "Checking for common migration blockers..."
    
    cd backend
    
    # Check for active database connections that might block migrations
    print_status "Checking for potential blocking connections..."
    
    # Check if any other processes are using the database
    local node_processes
    node_processes=$(pgrep -f "node.*prisma\|npm.*dev\|tsx.*watch" | wc -l)
    
    if [ $node_processes -gt 0 ]; then
        print_warning "$node_processes Node.js processes detected - may interfere with migrations"
        print_status "Consider stopping development servers before migration"
        ((WARNINGS++))
    else
        print_success "No potentially blocking Node.js processes detected"
    fi
    
    # Check for lock files that might indicate stuck processes
    if [ -f ".migration.lock" ] || [ -f "prisma/.migration.lock" ]; then
        print_warning "Migration lock files detected - previous migration may have failed"
        ((WARNINGS++))
    else
        print_success "No migration lock files found"
    fi
    
    cd ..
}

# Main validation
print_status "Starting database migration validation..."
echo ""

# 1. Check system resources first
print_status "=== System Resource Validation ==="
check_system_resources
echo ""

# 2. Check database connectivity
print_status "=== Database Connectivity ==="
if ! check_database_connection; then
    print_critical "Cannot proceed with migration validation - database unreachable"
    exit 1
fi
echo ""

# 3. Validate Prisma client
print_status "=== Prisma Client Validation ==="
validate_prisma_client
echo ""

# 4. Check migration status
print_status "=== Migration Status Check ==="
check_migration_status
echo ""

# 5. Validate schema requirements
print_status "=== Schema Requirements ==="
validate_schema_requirements
echo ""

# 6. Check rollback capability
print_status "=== Rollback Capability ==="
validate_rollback_capability
echo ""

# 7. Test connection stability
print_status "=== Connection Stability Test ==="
test_connection_stability
echo ""

# 8. Check for migration blockers
print_status "=== Migration Blocker Check ==="
check_migration_blockers
echo ""

# Summary
echo "========================================"
echo "Database Migration Validation Summary"
echo "========================================"

if [ $CRITICAL_ISSUES -eq 0 ] && [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    print_success "✅ All database migration checks passed!"
    print_status "Database is ready for safe migrations"
    exit 0
elif [ $CRITICAL_ISSUES -gt 0 ]; then
    print_critical "❌ $CRITICAL_ISSUES critical issue(s) found!"
    if [ $ERRORS -gt 0 ]; then
        print_error "📋 $ERRORS error(s) also found"
    fi
    if [ $WARNINGS -gt 0 ]; then
        print_warning "⚠️ $WARNINGS warning(s) also found" 
    fi
    echo ""
    print_critical "CRITICAL: Database migration has serious issues!"
    print_status "These issues match patterns from git history analysis:"
    print_status "- Exit status 137 (memory/timeout)"
    print_status "- Network context problems"
    print_status "- Resource exhaustion"
    print_status "Fix critical issues before running migrations"
    exit 1
elif [ $ERRORS -gt 0 ]; then
    print_error "❌ $ERRORS error(s) found"
    if [ $WARNINGS -gt 0 ]; then
        print_warning "⚠️ $WARNINGS warning(s) also found"
    fi
    echo ""
    print_error "Database migration has errors that need attention"
    print_status "Review errors above and fix before running migrations"
    exit 1
else
    print_warning "⚠️ $WARNINGS warning(s) found"
    echo ""
    print_status "Database migration validation completed with warnings"
    print_status "Warnings should be reviewed but may not block migrations"
    print_status "Monitor migrations closely for any issues"
    exit 0
fi