#!/bin/bash

# Environment Validation Script for Loyalty App
# Usage: ./scripts/validate-environment.sh
# This script validates the production environment setup

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

log "${BLUE}🔍 Validating Loyalty App Production Environment${NC}"
echo "================================================="

# Check basic requirements
log "🔧 System Requirements:"
validate "Docker installation" "command -v docker" "Docker is not installed or not in PATH"
validate "Docker Compose installation" "command -v docker-compose" "Docker Compose is not installed or not in PATH"
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
    
    # OAuth validation
    validate "Google OAuth Client ID" "test -n '$GOOGLE_CLIENT_ID' && test '$GOOGLE_CLIENT_ID' != 'your-google-client-id-from-console'" "Google OAuth Client ID not configured" true
    validate "Facebook OAuth App ID" "test -n '$FACEBOOK_APP_ID' && test '$FACEBOOK_APP_ID' != 'your-facebook-app-id'" "Facebook OAuth App ID not configured" true
    validate "LINE Channel ID" "test -n '$LINE_CHANNEL_ID' && test '$LINE_CHANNEL_ID' != 'your-line-channel-id'" "LINE Channel ID not configured" true
    
else
    error "❌ .env.production file not found!"
    echo "Please create .env.production by copying from .env.production.example:"
    echo "cp .env.production.example .env.production"
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
fi

# Network connectivity checks
log "🌐 Network Connectivity:"
validate "Internet connectivity" "curl -s --max-time 5 https://www.google.com > /dev/null" "No internet connectivity (may affect OAuth and external services)" true

# Final validation summary
echo
echo "================================================="
log "📊 Validation Summary:"

if [[ $VALIDATION_ERRORS -eq 0 ]] && [[ $VALIDATION_WARNINGS -eq 0 ]]; then
    success "🎉 All validations passed! Environment is ready for production."
    echo
    echo "✅ You can now run: ./scripts/start-production.sh"
    exit 0
elif [[ $VALIDATION_ERRORS -eq 0 ]]; then
    warning "⚠️  Environment has $VALIDATION_WARNINGS warning(s) but can proceed."
    echo
    echo "You can run: ./scripts/start-production.sh"
    echo "Consider addressing the warnings above for optimal production setup."
    exit 0
else
    error "❌ Environment validation failed with $VALIDATION_ERRORS error(s) and $VALIDATION_WARNINGS warning(s)."
    echo
    echo "Please fix the errors above before starting production."
    echo "Run this script again after making corrections."
    exit 1
fi