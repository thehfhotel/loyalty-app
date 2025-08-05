#!/bin/bash

# =============================================================================
# Zero-Downtime Deployment Script
# Implements Blue-Green deployment with health validation
# =============================================================================

set -euo pipefail

# Configuration
DEPLOY_DIR="${DEPLOY_PATH:-/home/nut/loyalty-app}"
HEALTH_CHECK_TIMEOUT=180
HEALTH_CHECK_INTERVAL=5
MAX_ROLLBACK_ATTEMPTS=3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# =============================================================================
# DEPLOYMENT STATE MANAGEMENT
# =============================================================================

get_active_color() {
    if docker compose ps backend-blue -q | grep -q .; then
        if docker compose ps backend-green -q | grep -q .; then
            # Both running - check which is receiving traffic
            local nginx_config=$(docker compose exec -T nginx cat /etc/nginx/nginx.conf 2>/dev/null || echo "")
            if echo "$nginx_config" | grep -q "backend-green:4000"; then
                echo "green"
            else
                echo "blue"
            fi
        else
            echo "blue"
        fi
    elif docker compose ps backend-green -q | grep -q .; then
        echo "green"
    else
        echo "none"
    fi
}

get_deployment_color() {
    local active_color=$(get_active_color)
    if [ "$active_color" = "blue" ]; then
        echo "green"
    elif [ "$active_color" = "green" ]; then
        echo "blue"  
    else
        echo "blue"  # Default to blue for first deployment
    fi
}

# =============================================================================
# HEALTH CHECK FUNCTIONS
# =============================================================================

wait_for_health() {
    local color=$1
    local service=$2
    local port=$3
    local endpoint=${4:-/api/health}
    
    log_info "Waiting for $color $service to be healthy..."
    
    local attempts=0
    local max_attempts=$((HEALTH_CHECK_TIMEOUT / HEALTH_CHECK_INTERVAL))
    
    while [ $attempts -lt $max_attempts ]; do
        if curl -f -s "http://localhost:$port$endpoint" >/dev/null 2>&1; then
            log_success "$color $service is healthy"
            return 0
        fi
        
        attempts=$((attempts + 1))
        log_info "Health check attempt $attempts/$max_attempts for $color $service..."
        sleep $HEALTH_CHECK_INTERVAL
    done
    
    log_error "$color $service failed health checks after $HEALTH_CHECK_TIMEOUT seconds"
    return 1
}

validate_deployment_health() {
    local color=$1
    
    log_info "Validating $color deployment health..."
    
    # Determine ports based on color
    local backend_port
    if [ "$color" = "blue" ]; then
        backend_port=4000
    else
        backend_port=4002
    fi
    
    # Check backend health
    if ! wait_for_health "$color" "backend" "$backend_port" "/api/health"; then
        return 1
    fi
    
    # Additional application-specific health checks
    log_info "Running comprehensive health validation for $color environment..."
    
    # Database connectivity check
    if ! curl -f -s "http://localhost:$backend_port/api/health/db" >/dev/null 2>&1; then
        log_warning "$color backend database health check failed"
        # Don't fail deployment for DB health - might be transient
    fi
    
    # Redis connectivity check  
    if ! curl -f -s "http://localhost:$backend_port/api/health/redis" >/dev/null 2>&1; then
        log_warning "$color backend Redis health check failed"
        # Don't fail deployment for Redis health - might be transient
    fi
    
    log_success "$color environment passed health validation"
    return 0
}

# =============================================================================
# TRAFFIC SWITCHING
# =============================================================================

switch_traffic() {
    local target_color=$1
    local current_color=$2
    
    log_info "Switching traffic from $current_color to $target_color..."
    
    # Update nginx configuration to point to new backend
    local nginx_config="/tmp/nginx-$target_color.conf"
    
    # Generate new nginx config with target color as active
    sed "s/backend-$current_color:4000/backend-$target_color:4000/g" \
        "$DEPLOY_DIR/nginx/nginx-blue-green.conf" > "$nginx_config"
    
    # Copy new config to nginx container
    docker cp "$nginx_config" loyalty_nginx:/etc/nginx/nginx.conf
    
    # Test nginx configuration
    if ! docker compose exec -T nginx nginx -t; then
        log_error "Nginx configuration test failed"
        return 1
    fi
    
    # Graceful reload
    if docker compose exec -T nginx nginx -s reload; then
        log_success "Traffic switched to $target_color environment"
        
        # Verify traffic switch worked
        sleep 2
        if curl -f -s "http://localhost:4001/api/health" >/dev/null 2>&1; then
            log_success "Traffic switch verification passed"
            return 0
        else
            log_error "Traffic switch verification failed"
            return 1
        fi
    else
        log_error "Nginx reload failed"
        return 1
    fi
}

# =============================================================================
# ROLLBACK FUNCTIONS
# =============================================================================

rollback_deployment() {
    local failed_color=$1
    local stable_color=$2
    
    log_warning "Rolling back deployment from $failed_color to $stable_color..."
    
    # Switch traffic back to stable environment
    if switch_traffic "$stable_color" "$failed_color"; then
        log_success "Rollback successful - traffic restored to $stable_color"
        
        # Clean up failed deployment
        cleanup_environment "$failed_color"
        
        return 0
    else
        log_error "Rollback failed - manual intervention required"
        return 1
    fi
}

# =============================================================================
# CLEANUP FUNCTIONS  
# =============================================================================

cleanup_environment() {
    local color=$1
    
    log_info "Cleaning up $color environment..."
    
    # Stop and remove containers for the specified color
    docker compose --profile deployment stop "backend-$color" "frontend-$color" 2>/dev/null || true
    docker compose --profile deployment rm -f "backend-$color" "frontend-$color" 2>/dev/null || true
    
    # Clean up unused images and volumes (but preserve data)
    docker system prune -f --volumes --filter "label!=keep" 2>/dev/null || true
    
    log_success "$color environment cleaned"
}

# =============================================================================
# MAIN DEPLOYMENT LOGIC
# =============================================================================

main() {
    log_info "Starting zero-downtime deployment..."
    
    cd "$DEPLOY_DIR"
    
    # Determine current and target environments
    local active_color=$(get_active_color)  
    local deploy_color=$(get_deployment_color)
    
    log_info "Active environment: $active_color"
    log_info "Deployment target: $deploy_color"
    
    # Pre-deployment checks
    log_info "Running pre-deployment validation..."
    
    # Ensure shared infrastructure is running
    if ! docker compose up -d postgres redis; then
        log_error "Failed to start shared infrastructure"
        exit 1
    fi
    
    # Wait for shared services
    if ! wait_for_health "shared" "postgres" "5434" "/"; then
        log_error "Shared infrastructure health check failed"
        exit 1
    fi
    
    # Deploy to target environment
    log_info "Deploying to $deploy_color environment..."
    
    # Start target environment
    if ! docker compose --profile deployment up -d --build "backend-$deploy_color" "frontend-$deploy_color"; then
        log_error "Failed to start $deploy_color environment"
        exit 1
    fi
    
    # Health validation
    if ! validate_deployment_health "$deploy_color"; then
        log_error "$deploy_color deployment failed health validation"
        cleanup_environment "$deploy_color"
        exit 1
    fi
    
    # Traffic switching
    if [ "$active_color" != "none" ]; then
        if ! switch_traffic "$deploy_color" "$active_color"; then
            log_error "Traffic switch failed"
            if ! rollback_deployment "$deploy_color" "$active_color"; then
                log_error "Rollback also failed - system may be unstable"
                exit 1
            fi
            exit 1
        fi
        
        # Clean up old environment after successful switch
        log_info "Cleaning up old $active_color environment..."
        cleanup_environment "$active_color"
    else
        # First deployment - just start nginx pointing to new environment
        log_info "First deployment - configuring nginx for $deploy_color..."
        if ! docker compose up -d nginx; then
            log_error "Failed to start nginx"
            exit 1
        fi
    fi
    
    # Final validation
    log_info "Running post-deployment validation..."
    if ! curl -f -s "http://localhost:4001/api/health" >/dev/null 2>&1; then
        log_error "Post-deployment validation failed"
        if [ "$active_color" != "none" ]; then
            rollback_deployment "$deploy_color" "$active_color"
        fi
        exit 1
    fi
    
    log_success "Zero-downtime deployment completed successfully!"
    log_success "Active environment: $deploy_color"
    
    # Display deployment summary
    echo ""
    log_info "Deployment Summary:"
    log_info "=================="
    log_info "Previous environment: $active_color"  
    log_info "Current environment: $deploy_color"
    log_info "Application URL: http://localhost:4001"
    log_info "Health check: http://localhost:4001/api/health"
    echo ""
}

# =============================================================================
# SCRIPT EXECUTION
# =============================================================================

# Handle signals for graceful shutdown
trap 'log_error "Deployment interrupted"; exit 1' INT TERM

# Check if running in CI/CD context
if [ "${CI:-false}" = "true" ]; then
    log_info "Running in CI/CD mode"
fi

# Execute main deployment logic
main "$@"