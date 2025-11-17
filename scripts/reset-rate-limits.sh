#!/bin/bash

# Rate Limit Reset Script
# Resets rate limiting for OAuth endpoints to enable testing

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

echo "🔄 Rate Limit Reset Tool"
echo "========================================"

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:4001}"
RESET_METHODS=()

# Function to check if backend is running
check_backend_running() {
    print_status "Checking if backend service is running..."
    
    if curl -s --connect-timeout 5 "$BACKEND_URL/api/health" >/dev/null 2>&1; then
        print_success "Backend service is running"
        return 0
    else
        print_error "Backend service is not running at $BACKEND_URL"
        print_status "Please start the backend service first using: ./manage.sh start"
        return 1
    fi
}

# Method 1: Wait for rate limit expiry (safest)
wait_for_rate_limit_expiry() {
    local wait_time=${1:-60}
    
    print_status "Waiting for rate limit expiry (${wait_time}s)..."
    print_warning "This is the safest method - allows natural rate limit reset"
    
    for ((i=wait_time; i>=1; i--)); do
        printf "\r${BLUE}[INFO]${NC} Waiting... ${i}s remaining"
        sleep 1
    done
    printf "\n"
    
    print_success "Rate limit wait period completed"
    RESET_METHODS+=("Rate limit expiry wait")
}

# Method 2: Restart backend service (effective)
restart_backend_service() {
    print_status "Restarting backend service to reset rate limits..."
    print_warning "This will temporarily interrupt service"
    
    if command -v docker >/dev/null 2>&1 && docker compose ps backend >/dev/null 2>&1; then
        print_status "Using Docker Compose to restart backend..."
        docker compose restart backend
        
        # Wait for backend to be ready
        local attempts=0
        local max_attempts=30
        
        print_status "Waiting for backend to be ready..."
        while [[ $attempts -lt $max_attempts ]]; do
            if curl -s --connect-timeout 2 "$BACKEND_URL/api/health" >/dev/null 2>&1; then
                print_success "Backend service restarted successfully"
                RESET_METHODS+=("Backend service restart")
                return 0
            else
                ((attempts++))
                sleep 2
            fi
        done
        
        print_error "Backend service restart may have failed"
        return 1
    else
        print_warning "Docker Compose not available or backend not running in Docker"
        print_status "Please restart your backend service manually"
        RESET_METHODS+=("Manual backend restart required")
    fi
}

# Method 3: Clear Redis cache (if available)
clear_redis_cache() {
    print_status "Attempting to clear Redis cache..."
    
    # Check if Redis is available via Docker
    if command -v docker >/dev/null 2>&1 && docker compose ps redis >/dev/null 2>&1; then
        print_status "Clearing Redis cache via Docker..."
        
        # Execute FLUSHALL command in Redis container
        if docker compose exec redis redis-cli FLUSHALL >/dev/null 2>&1; then
            print_success "Redis cache cleared successfully"
            RESET_METHODS+=("Redis cache flush")
        else
            print_warning "Failed to clear Redis cache"
        fi
    else
        print_warning "Redis not available via Docker Compose"
        
        # Try local Redis if available
        if command -v redis-cli >/dev/null 2>&1; then
            print_status "Attempting to clear local Redis..."
            if redis-cli FLUSHALL >/dev/null 2>&1; then
                print_success "Local Redis cache cleared"
                RESET_METHODS+=("Local Redis flush")
            else
                print_warning "Failed to clear local Redis cache"
            fi
        else
            print_warning "Redis CLI not available"
        fi
    fi
}

# Method 4: Reset application memory cache (API call)
reset_app_cache() {
    print_status "Attempting to reset application cache via API..."
    
    # Try to call a cache reset endpoint (if it exists)
    local cache_endpoints=(
        "/api/admin/cache/clear"
        "/api/cache/reset"
        "/api/system/reset-rate-limits"
    )
    
    for endpoint in "${cache_endpoints[@]}"; do
        local response_code
        response_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 -X POST "$BACKEND_URL$endpoint" 2>/dev/null || echo "000")
        
        if [[ "$response_code" == "200" || "$response_code" == "204" ]]; then
            print_success "Application cache reset via $endpoint"
            RESET_METHODS+=("API cache reset")
            return 0
        fi
    done
    
    print_warning "No cache reset API endpoints available"
}

# Method 5: Change IP/Headers to bypass rate limiting (testing only)
suggest_bypass_methods() {
    print_status "Alternative testing approaches:"
    echo "  • Use different User-Agent headers in requests"
    echo "  • Test from different IP address (if possible)"
    echo "  • Use incognito/private browsing mode"
    echo "  • Clear browser cookies and local storage"
    echo "  • Wait for rate limit window to reset naturally"
}

# Verify rate limit reset
verify_oauth_endpoints() {
    print_status "Verifying OAuth endpoints are accessible..."
    
    local endpoints=(
        "/api/oauth/google"
        "/api/oauth/line"
        "/api/oauth/me"
    )
    
    local success_count=0
    
    for endpoint in "${endpoints[@]}"; do
        local response_code
        response_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$BACKEND_URL$endpoint" 2>/dev/null || echo "000")
        
        case "$response_code" in
            "200"|"302"|"401")
                print_success "✓ $endpoint responding (${response_code})"
                ((success_count++))
                ;;
            "429")
                print_warning "⚠ $endpoint still rate limited (${response_code})"
                ;;
            "000")
                print_error "✗ $endpoint unreachable"
                ;;
            *)
                print_warning "? $endpoint returned ${response_code}"
                ;;
        esac
    done
    
    if [[ $success_count -eq ${#endpoints[@]} ]]; then
        print_success "All OAuth endpoints are responding normally"
        return 0
    elif [[ $success_count -gt 0 ]]; then
        print_warning "Some OAuth endpoints may still be rate limited"
        return 1  
    else
        print_error "OAuth endpoints are not responding properly"
        return 2
    fi
}

# Interactive reset method selection
select_reset_method() {
    echo ""
    echo -e "${YELLOW}Select rate limit reset method:${NC}"
    echo "  1) 🕐 Wait for rate limit expiry (60s) - Safest"
    echo "  2) 🔄 Restart backend service - Most effective"
    echo "  3) 🗄️  Clear Redis cache - If using Redis"
    echo "  4) 🔧 Reset application cache - Via API"
    echo "  5) 🚀 Try all methods - Comprehensive reset"
    echo "  6) ℹ️  Show bypass suggestions - Testing tips"
    echo ""
    echo -ne "${YELLOW}Enter your choice (1-6): ${NC}"
    read -r choice
    
    case "$choice" in
        1)
            wait_for_rate_limit_expiry 60
            ;;
        2)
            restart_backend_service
            ;;
        3)
            clear_redis_cache
            ;;
        4)
            reset_app_cache
            ;;
        5)
            print_status "Attempting comprehensive rate limit reset..."
            clear_redis_cache
            reset_app_cache
            restart_backend_service
            ;;
        6)
            suggest_bypass_methods
            return 0
            ;;
        *)
            print_error "Invalid selection"
            return 1
            ;;
    esac
}

# Main execution
main() {
    print_status "Starting rate limit reset process..."
    echo ""
    
    # Check if backend is running
    if ! check_backend_running; then
        exit 1
    fi
    
    echo ""
    
    # Show current rate limit status
    print_status "Checking current rate limit status..."
    if ! verify_oauth_endpoints; then
        echo ""
        print_warning "Some endpoints appear to be rate limited"
    else
        echo ""
        print_success "No active rate limiting detected"
        print_status "You may not need to reset rate limits"
        echo ""
        if ! confirm "Continue with rate limit reset anyway?" "n"; then
            print_status "Rate limit reset cancelled"
            exit 0
        fi
    fi
    
    echo ""
    
    # Interactive method selection
    select_reset_method
    
    echo ""
    
    # Verify reset was successful
    print_status "Verifying rate limit reset..."
    if verify_oauth_endpoints; then
        echo ""
        print_success "✅ Rate limit reset completed successfully!"
        
        if [[ ${#RESET_METHODS[@]} -gt 0 ]]; then
            print_status "Methods used:"
            for method in "${RESET_METHODS[@]}"; do
                echo "  • $method"
            done
        fi
        
        echo ""
        print_status "You can now test OAuth endpoints:"
        echo "  • Run OAuth health check: npm run oauth:health"
        echo "  • Run OAuth E2E tests: npm run test:e2e -- tests/oauth-validation.configured.spec.ts tests/oauth-validation.security.spec.ts tests/oauth-validation.unconfigured.spec.ts"
        echo "  • Test via manage.sh: ./manage.sh (Deployment Menu → OAuth Health Check)"
        
    else
        echo ""
        print_error "❌ Rate limit reset may not have been fully successful"
        print_status "Try waiting a few minutes or manually restarting services"
        print_status "Alternative: Test OAuth from a different browser/IP"
    fi
}

# Confirmation utility function
confirm() {
    local message="$1"
    local default="${2:-n}"
    
    if [[ "$default" == "y" ]]; then
        prompt="[Y/n]"
    else
        prompt="[y/N]"
    fi
    
    echo -ne "${YELLOW}$message $prompt: ${NC}"
    read -r response
    
    if [[ -z "$response" ]]; then
        response="$default"
    fi
    
    [[ "$response" =~ ^[Yy]$ ]]
}

# Run main function
main "$@"
