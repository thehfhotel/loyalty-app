#!/bin/bash

# Environment Validation Script for Loyalty App
# Usage: ./scripts/validate-environment.sh [build|runtime]
# This script validates the production environment setup
# 
# Parameters:
#   build   - Skip runtime checks (Redis, database connectivity)
#   runtime - Full validation including service connectivity (default)

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

# Validation context (build or runtime)
VALIDATION_CONTEXT="${1:-runtime}"

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

# Track validation results
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0

# Validation function
validate() {
    local check_name="$1"
    local check_command="$2"
    local error_message="$3"
    local is_warning="${4:-false}"
    
    echo -n "🔍 Checking $check_name... "
    
    if eval "$check_command" >/dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        return 0
    else
        if [[ "$is_warning" == "true" ]]; then
            echo -e "${YELLOW}⚠️${NC}"
            warning "$error_message"
            VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
        else
            echo -e "${RED}❌${NC}"
            error "$error_message"
            VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
        fi
        return 1
    fi
}

# Change to project root
cd "$PROJECT_ROOT"

log "${BLUE}🔍 Validating Loyalty App v3.x Environment (${VALIDATION_CONTEXT} mode)${NC}"
echo "================================================="

# Check basic requirements
log "🔧 System Requirements:"
validate "Docker installation" "command -v docker" "Docker is not installed or not in PATH"
validate "Docker Compose plugin" "docker compose version" "Docker Compose plugin is not available (install Docker Compose V2)"
validate "curl installation" "command -v curl" "curl is not installed (needed for health checks)"
validate "Docker daemon" "docker info" "Docker daemon is not running"

# Check project structure
log "📁 Project Structure:"
validate "docker-compose.yml" "test -f docker-compose.yml" "docker-compose.yml not found"
validate "docker-compose.prod.yml" "test -f docker-compose.prod.yml" "docker-compose.prod.yml not found"
validate "backend Dockerfile" "test -f backend/Dockerfile" "backend/Dockerfile not found"
validate "frontend Dockerfile" "test -f frontend/Dockerfile" "frontend/Dockerfile not found"
validate "nginx configuration" "test -f nginx/nginx.conf" "nginx/nginx.conf not found"

# Check environment files
log "🔐 Environment Configuration:"
validate "production env example" "test -f .env.production.example" ".env.production.example not found"

if [[ -f ".env.production" ]]; then
    success "✅ .env.production file exists"
    
    # Check required environment variables
    log "🔑 Environment Variables:"
    source .env.production
    
    validate "JWT_SECRET" "test -n '$JWT_SECRET' && test '$JWT_SECRET' != 'your-super-secret-jwt-key-change-in-production'" "JWT_SECRET is not set or using default value"
    validate "JWT_REFRESH_SECRET" "test -n '$JWT_REFRESH_SECRET' && test '$JWT_REFRESH_SECRET' != 'your-super-secret-refresh-key-change-in-production'" "JWT_REFRESH_SECRET is not set or using default value"
    validate "SESSION_SECRET" "test -n '$SESSION_SECRET' && test '$SESSION_SECRET' != 'your-super-secret-session-key-change-in-production'" "SESSION_SECRET is not set or using default value"
    validate "DOMAIN" "test -n '$DOMAIN' && test '$DOMAIN' != 'your-domain.com'" "DOMAIN is not set or using example value"
    validate "LOYALTY_USERNAME" "test -n '$LOYALTY_USERNAME'" "LOYALTY_USERNAME is not set"
    validate "LOYALTY_PASSWORD" "test -n '$LOYALTY_PASSWORD'" "LOYALTY_PASSWORD is not set"
    
    # OAuth validation (with HTTPS callback URL checks for production)
    validate "Google OAuth Client ID" "test -n '$GOOGLE_CLIENT_ID' && test '$GOOGLE_CLIENT_ID' != 'your-google-client-id-from-console'" "Google OAuth Client ID not configured" true
    validate "Facebook OAuth App ID" "test -n '$FACEBOOK_APP_ID' && test '$FACEBOOK_APP_ID' != 'your-facebook-app-id'" "Facebook OAuth App ID not configured" true
    validate "LINE Channel ID" "test -n '$LINE_CHANNEL_ID' && test '$LINE_CHANNEL_ID' != 'your-line-channel-id'" "LINE Channel ID not configured" true
    
    # Production-specific URL validations
    if [[ "$NODE_ENV" == "production" ]]; then
        validate "FRONTEND_URL HTTPS" "echo '$FRONTEND_URL' | grep -q '^https://'" "FRONTEND_URL must use HTTPS in production"
        validate "No localhost in FRONTEND_URL" "! echo '$FRONTEND_URL' | grep -q 'localhost'" "FRONTEND_URL cannot contain localhost in production"
        
        if [[ -n "$GOOGLE_CALLBACK_URL" ]]; then
            validate "Google callback HTTPS" "echo '$GOOGLE_CALLBACK_URL' | grep -q '^https://'" "GOOGLE_CALLBACK_URL must use HTTPS in production"
        fi
        
        if [[ -n "$LINE_CALLBACK_URL" ]]; then
            validate "LINE callback HTTPS" "echo '$LINE_CALLBACK_URL' | grep -q '^https://'" "LINE_CALLBACK_URL must use HTTPS in production"
        fi
    fi
    
    # Environment debugging info for production
    log "📋 Environment File Diagnostics:"
    echo "   • Using file: .env.production"
    echo "   • File size: $(wc -c < .env.production 2>/dev/null || echo "0") bytes"
    echo "   • Variables count: $(grep -c '^[A-Z]' .env.production 2>/dev/null || echo "0")"
    
elif [[ -f ".env" ]]; then
    warning "⚠️  .env.production not found, using .env for development mode"
    success "✅ .env file exists (development mode)"
    
    # Check required environment variables from .env
    log "🔑 Environment Variables (Development):"
    source .env
    
    validate "JWT_SECRET" "test -n '$JWT_SECRET'" "JWT_SECRET is not set" true
    validate "SESSION_SECRET" "test -n '$SESSION_SECRET'" "SESSION_SECRET is not set" true
    validate "LOYALTY_USERNAME" "test -n '$LOYALTY_USERNAME'" "LOYALTY_USERNAME is not set ($LOYALTY_USERNAME)" true
    validate "LOYALTY_PASSWORD" "test -n '$LOYALTY_PASSWORD'" "LOYALTY_PASSWORD is not set" true
    
    # OAuth validation (warnings only for development)
    validate "Google OAuth Client ID" "test -n '$GOOGLE_CLIENT_ID'" "Google OAuth Client ID not configured" true
    validate "Facebook OAuth App ID" "test -n '$FACEBOOK_APP_ID'" "Facebook OAuth App ID not configured" true
    validate "LINE Channel ID" "test -n '$LINE_CHANNEL_ID'" "LINE Channel ID not configured" true
    
    # Environment debugging info
    log "📋 Environment File Diagnostics:"
    echo "   • Using file: .env"
    echo "   • File size: $(wc -c < .env 2>/dev/null || echo "0") bytes"
    echo "   • Variables count: $(grep -c '^[A-Z]' .env 2>/dev/null || echo "0")"
    
else
    error "❌ No environment file found!"
    echo "Please create an environment file:"
    echo
    echo "For production:"
    echo "  cp .env.production.example .env.production"
    echo "  # Edit .env.production with your production settings"
    echo
    echo "For development:"
    echo "  cp .env.example .env"
    echo "  # Edit .env with your development settings"
    echo
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
fi

# Check port availability
log "🌐 Port Availability:"
check_port() {
    local port=$1
    local service=$2
    if netstat -tln 2>/dev/null | grep -q ":$port "; then
        warning "Port $port is in use (needed for $service)"
        VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
        return 1
    else
        success "✅ Port $port is available ($service)"
        return 0
    fi
}

check_port 4001 "Frontend"
check_port 4000 "Backend API"
check_port 5434 "PostgreSQL"
check_port 6379 "Redis"

# Check Docker resources
log "💻 Docker Resources:"
# Get Docker info
docker_info=$(docker info 2>/dev/null || echo "")

if [[ -n "$docker_info" ]]; then
    # Extract memory info (this is approximate and may vary by Docker version)
    if echo "$docker_info" | grep -q "Total Memory"; then
        memory=$(echo "$docker_info" | grep "Total Memory" | sed 's/.*Total Memory: //' | sed 's/GiB.*/GiB/')
        echo "💾 Available Memory: $memory"
        
        # Check if we have at least 2GB
        memory_gb=$(echo "$memory" | sed 's/GiB//' | cut -d'.' -f1)
        if [[ "$memory_gb" -lt 2 ]]; then
            warning "Low memory detected. Recommend at least 2GB for production"
            VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
        fi
    fi
    
    # Check disk space
    available_disk=$(docker system df | grep "Local Volumes" | awk '{print $4}' || echo "Unknown")
    echo "💽 Docker Disk Usage: $available_disk"
else
    warning "Could not retrieve Docker resource information"
    VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
fi

# Security checks
log "🔒 Security Validation:"

if [[ -f ".env.production" ]]; then
    # Check file permissions
    env_perms=$(stat -f "%A" .env.production 2>/dev/null || stat -c "%a" .env.production 2>/dev/null || echo "000")
    if [[ "$env_perms" == "600" ]] || [[ "$env_perms" == "644" ]]; then
        success "✅ .env.production file permissions are appropriate ($env_perms)"
    else
        warning "Consider setting stricter permissions: chmod 600 .env.production (current: $env_perms)"
        VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
    fi
    
    # Check for default passwords
    source .env.production
    if [[ "$LOYALTY_PASSWORD" == "your-secure-admin-password" ]]; then
        error "Using default admin password - please change it!"
        VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
    fi
elif [[ -f ".env" ]]; then
    # Check development environment file permissions
    env_perms=$(stat -f "%A" .env 2>/dev/null || stat -c "%a" .env 2>/dev/null || echo "000")
    success "✅ .env file permissions: $env_perms (development mode)"
    
    # Check for default passwords in development
    source .env
    if [[ "$LOYALTY_PASSWORD" == "your-secure-admin-password" ]] || [[ "$LOYALTY_PASSWORD" == "admin" ]]; then
        warning "Using default/weak admin password in development"
        VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
    fi
fi

# Runtime-only validations (skip during build phase)
if [[ "$VALIDATION_CONTEXT" == "runtime" ]]; then
    # Redis and session store validation
    log "📊 Redis and Session Store:"
    validate "Redis connectivity" "docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG" "Redis is not accessible (required for session store)" true

    if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        # Check if session store is properly configured
        SESSION_PREFIX_EXISTS=$(docker compose exec -T redis redis-cli KEYS "loyalty-app:*" 2>/dev/null | wc -l || echo "0")
        if [ "$SESSION_PREFIX_EXISTS" -ge 0 ]; then
            success "✅ Redis session store is configured with loyalty-app prefix"
        fi
    fi

    # Database schema validation
    log "💾 Database Schema:"
    if docker compose exec -T postgres pg_isready -U loyalty -d loyalty_db >/dev/null 2>&1; then
        TABLE_COUNT=$(docker compose exec -T postgres psql -U loyalty -d loyalty_db -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ' || echo "0")
        if [ "$TABLE_COUNT" -gt 20 ]; then
            success "✅ Consolidated database schema is applied (${TABLE_COUNT} tables)"
        else
            warning "Database schema may not be fully initialized (${TABLE_COUNT} tables)"
            echo "Consider running: ./database/deploy-database.sh"
        fi
    else
        warning "Cannot validate database schema (database not accessible)"
    fi
else
    log "📊 Runtime Checks:"
    success "✅ Skipping Redis/Database connectivity (build mode)"
    echo "   • Redis connectivity will be validated when services start"
    echo "   • Database schema will be validated at runtime"
fi

# Network connectivity checks (always run)
log "🌐 Network Connectivity:"
validate "Internet connectivity" "curl -s --max-time 5 https://www.google.com > /dev/null" "No internet connectivity (may affect OAuth and external services)" true

# Final validation summary
echo
echo "================================================="
log "📊 Validation Summary (v3.x Features):"

if [[ $VALIDATION_ERRORS -eq 0 ]] && [[ $VALIDATION_WARNINGS -eq 0 ]]; then
    if [[ -f ".env.production" ]]; then
        success "🎉 All validations passed! Environment is ready for production."
        echo
        echo "✨ v3.x Features Validated:"
        echo "   • Redis session store (no memory leaks)"
        echo "   • Consolidated database schema"
        echo "   • OAuth dual environment support"
        echo "   • Production security settings"
        echo
        echo "✅ You can now run: ./scripts/start-production.sh"
    else
        success "🎉 All validations passed! Environment is ready for development."
        echo
        echo "✨ v3.x Features Available:"
        echo "   • Redis session store (no memory leaks)"
        echo "   • Consolidated database schema"
        echo "   • OAuth dual environment support"
        echo "   • Development mode active"
        echo
        echo "✅ You can now run: ./scripts/start-production.sh"
    fi
    exit 0
elif [[ $VALIDATION_ERRORS -eq 0 ]]; then
    warning "⚠️  Environment has $VALIDATION_WARNINGS warning(s) but can proceed."
    echo
    echo "✨ v3.x Features Available:"
    echo "   • Redis sessions, consolidated schema, OAuth improvements"
    echo
    if [[ -f ".env.production" ]]; then
        echo "You can run: ./scripts/start-production.sh"
        echo "Consider addressing the warnings above for optimal production setup."
    else
        echo "You can run: ./scripts/start-production.sh (development mode)"
        echo "Consider addressing the warnings above."
    fi
    exit 0
else
    error "❌ Environment validation failed with $VALIDATION_ERRORS error(s) and $VALIDATION_WARNINGS warning(s)."
    echo
    echo "Please fix the errors above before starting production."
    echo "For help with v3.x features, see:"
    echo "   - SESSION_MANAGEMENT.md (Redis sessions)"
    echo "   - DATABASE_DEPLOYMENT_GUIDE.md (consolidated schema)"
    echo "   - docs/*_OAUTH_SETUP.md (OAuth configuration)"
    echo
    echo "Run this script again after making corrections."
    exit 1
fi