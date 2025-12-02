#!/bin/bash

# OAuth Health Check Script
# Validates OAuth configuration and endpoints for common issues
# Based on git history analysis of recurring OAuth problems

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

echo "🔐 OAuth Health Validation"
echo "========================================"

# Configuration
# IMPORTANT: BACKEND_URL and FRONTEND_URL must be provided via environment variables
# Example: BACKEND_URL=http://localhost:4001 FRONTEND_URL=http://localhost:4001 ./scripts/validate-oauth-health.sh
if [ -z "$BACKEND_URL" ]; then
    print_error "BACKEND_URL environment variable is required"
    print_status "Usage: BACKEND_URL=http://localhost:4001 FRONTEND_URL=http://localhost:4001 $0"
    print_status "Or set BACKEND_URL and FRONTEND_URL in your .env file and source it:"
    print_status "  source .env && $0"
    exit 1
fi

if [ -z "$FRONTEND_URL" ]; then
    print_error "FRONTEND_URL environment variable is required"
    print_status "Usage: BACKEND_URL=http://localhost:4001 FRONTEND_URL=http://localhost:4001 $0"
    print_status "Or set BACKEND_URL and FRONTEND_URL in your .env file and source it:"
    print_status "  source .env && $0"
    exit 1
fi

MAX_REDIRECT_DEPTH=5
TIMEOUT=10

WARNINGS=0
ERRORS=0
CRITICAL_ISSUES=0

# Function to check if service is running
check_service_running() {
    local url="$1"
    local service_name="$2"
    
    print_status "Checking if $service_name is running..."
    
    if curl -s --connect-timeout 5 "$url/api/health" >/dev/null 2>&1; then
        print_success "$service_name is running"
        return 0
    else
        print_error "$service_name is not running at $url"
        ((CRITICAL_ISSUES++))
        return 1
    fi
}

# Function to check OAuth endpoint accessibility
check_oauth_endpoint() {
    local endpoint="$1"
    local provider="$2"
    
    print_status "Checking $provider OAuth endpoint: $endpoint"
    
    # Check endpoint accessibility
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time $TIMEOUT "$endpoint" 2>/dev/null || echo "000")
    
    case "$response_code" in
        "000")
            print_error "$provider OAuth endpoint unreachable"
            ((ERRORS++))
            return 1
            ;;
        "200")
            print_warning "$provider OAuth endpoint returned 200 (should redirect)"
            ((WARNINGS++))
            ;;
        "301"|"302")
            print_success "$provider OAuth endpoint properly redirects ($response_code)"
            
            # Check redirect location
            local redirect_location
            redirect_location=$(curl -s -I --connect-timeout 5 --max-time $TIMEOUT "$endpoint" 2>/dev/null | grep -i "location:" | cut -d' ' -f2- | tr -d '\r\n' || echo "")
            
            if [ -n "$redirect_location" ]; then
                print_status "Redirect location: $redirect_location"
                
                # Check for redirect loop patterns (from git history issues)
                if echo "$redirect_location" | grep -q "/api/oauth.*$provider"; then
                    print_critical "Potential redirect loop detected in $provider OAuth!"
                    ((CRITICAL_ISSUES++))
                fi
                
                # Check for URL duplication (from git history issues)
                # Exclude URL-encoded parameters which contain legitimate http/https
                if echo "$redirect_location" | grep -v "redirect_uri=" | grep -q "http.*http"; then
                    print_critical "URL duplication detected in $provider OAuth redirect!"
                    ((CRITICAL_ISSUES++))
                fi
                
                # Check if redirecting to proper OAuth provider
                case "$provider" in
                    "Google")
                        if echo "$redirect_location" | grep -q "accounts\.google\.com\|login\?error="; then
                            print_success "$provider OAuth redirects to proper destination"
                        else
                            print_warning "$provider OAuth redirect destination unexpected"
                            ((WARNINGS++))
                        fi
                        ;;
                    "LINE")
                        if echo "$redirect_location" | grep -q "access\.line\.me\|login\?error="; then
                            print_success "$provider OAuth redirects to proper destination"
                        else
                            print_warning "$provider OAuth redirect destination unexpected"
                            ((WARNINGS++))
                        fi
                        ;;
                esac
            else
                print_warning "No redirect location found for $provider OAuth"
                ((WARNINGS++))
            fi
            ;;
        "400"|"401"|"403")
            print_warning "$provider OAuth endpoint returned $response_code (may be normal if not configured)"
            ;;
        "404")
            print_error "$provider OAuth endpoint not found (404)"
            ((ERRORS++))
            ;;
        "500"|"502"|"503")
            print_critical "$provider OAuth endpoint server error ($response_code)"
            ((CRITICAL_ISSUES++))
            ;;
        *)
            print_warning "$provider OAuth endpoint returned unexpected code: $response_code"
            ((WARNINGS++))
            ;;
    esac
    
    return 0
}

# Function to check OAuth callback endpoint
check_oauth_callback() {
    local endpoint="$1"
    local provider="$2"
    
    print_status "Checking $provider OAuth callback endpoint: $endpoint"
    
    # Test callback with error parameter (should handle gracefully)
    local callback_with_error="${endpoint}?error=access_denied&error_description=User%20denied%20access"
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time $TIMEOUT "$callback_with_error" 2>/dev/null || echo "000")
    
    case "$response_code" in
        "000")
            print_error "$provider OAuth callback endpoint unreachable"
            ((ERRORS++))
            ;;
        "302")
            print_success "$provider OAuth callback handles errors properly"
            
            # Check redirect location for error handling
            local redirect_location
            redirect_location=$(curl -s -I --connect-timeout 5 --max-time $TIMEOUT "$callback_with_error" 2>/dev/null | grep -i "location:" | cut -d' ' -f2- | tr -d '\r\n' || echo "")
            
            if echo "$redirect_location" | grep -q "login.*error="; then
                print_success "$provider OAuth callback redirects to login with error"
            else
                print_warning "$provider OAuth callback error handling may be incomplete"
                ((WARNINGS++))
            fi
            ;;
        "401")
            # 401 may be expected for some OAuth providers during error conditions
            if [ "$provider" = "LINE" ]; then
                print_warning "$provider OAuth callback returned 401 (may need error handling improvement)"
                ((WARNINGS++))
            else
                print_error "$provider OAuth callback authentication failed unexpectedly"
                ((ERRORS++))
            fi
            ;;
        "404")
            print_error "$provider OAuth callback endpoint not found"
            ((ERRORS++))
            ;;
        *)
            print_warning "$provider OAuth callback returned unexpected code: $response_code"
            ((WARNINGS++))
            ;;
    esac
}

# Function to check OAuth me endpoint security
check_oauth_me_endpoint() {
    local endpoint="$BACKEND_URL/api/oauth/me"
    
    print_status "Checking OAuth /me endpoint security..."
    
    # Test without authorization header
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time $TIMEOUT "$endpoint" 2>/dev/null || echo "000")
    
    if [ "$response_code" = "401" ]; then
        print_success "OAuth /me endpoint properly requires authentication"
    else
        print_critical "OAuth /me endpoint security issue - should return 401 without auth"
        ((CRITICAL_ISSUES++))
    fi
    
    # Test with invalid token
    local invalid_token_code
    invalid_token_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time $TIMEOUT -H "Authorization: Bearer invalid_token" "$endpoint" 2>/dev/null || echo "000")
    
    if [ "$invalid_token_code" = "401" ]; then
        print_success "OAuth /me endpoint properly rejects invalid tokens"
    else
        print_critical "OAuth /me endpoint security issue - should reject invalid tokens"
        ((CRITICAL_ISSUES++))
    fi
}

# Function to check for environment variable security
check_oauth_env_security() {
    print_status "Checking OAuth environment variable security..."
    
    # Check if OAuth endpoints expose sensitive information
    local google_response
    google_response=$(curl -s --connect-timeout 5 --max-time $TIMEOUT "$BACKEND_URL/api/oauth/google" 2>/dev/null || echo "")
    
    if echo "$google_response" | grep -qi "client_secret\|CLIENT_SECRET\|GOOGLE_CLIENT_SECRET"; then
        print_critical "OAuth endpoint exposing client secrets!"
        ((CRITICAL_ISSUES++))
    else
        print_success "OAuth endpoints do not expose client secrets"
    fi
}

# Function to test Cloudflare proxy handling (from git history issues)
check_cloudflare_proxy_handling() {
    print_status "Testing Cloudflare proxy header handling..."
    
    local endpoint="$BACKEND_URL/api/oauth/google"
    
    # Test with Cloudflare headers that caused issues
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout 5 --max-time $TIMEOUT \
        -H "CF-Ray: 123456789abcdef0-SJC" \
        -H "CF-Connecting-IP: 1.2.3.4" \
        -H "X-Forwarded-Proto: https" \
        -H "X-Forwarded-Host: example.com" \
        -H "X-Real-IP: 1.2.3.4" \
        "$endpoint" 2>/dev/null || echo "000")
    
    case "$response_code" in
        "000")
            print_warning "OAuth endpoint unreachable with Cloudflare headers"
            ((WARNINGS++))
            ;;
        "500"|"502"|"503")
            print_critical "OAuth endpoint fails with Cloudflare headers - proxy trust issue!"
            ((CRITICAL_ISSUES++))
            ;;
        *)
            print_success "OAuth endpoint handles Cloudflare headers properly"
            ;;
    esac
}

# Main validation
print_status "Starting OAuth health validation..."
echo ""

# 1. Check if backend service is running
if ! check_service_running "$BACKEND_URL" "Backend service"; then
    print_critical "Cannot proceed with OAuth validation - backend service not running"
    exit 1
fi

echo ""
print_status "=== OAuth Endpoint Tests ==="

# 2. Check OAuth endpoints
check_oauth_endpoint "$BACKEND_URL/api/oauth/google" "Google"
echo ""
check_oauth_endpoint "$BACKEND_URL/api/oauth/line" "LINE"
echo ""

print_status "=== OAuth Callback Tests ==="

# 3. Check OAuth callbacks
check_oauth_callback "$BACKEND_URL/api/oauth/google/callback" "Google"
echo ""
check_oauth_callback "$BACKEND_URL/api/oauth/line/callback" "LINE"
echo ""

print_status "=== OAuth Security Tests ==="

# 4. Check OAuth security
check_oauth_me_endpoint
echo ""
check_oauth_env_security
echo ""

print_status "=== Cloudflare Proxy Tests ==="

# 5. Check Cloudflare proxy handling (historical issue)
check_cloudflare_proxy_handling
echo ""

# Summary
echo "========================================"
echo "OAuth Health Validation Summary"
echo "========================================"

if [ $CRITICAL_ISSUES -eq 0 ] && [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    print_success "✅ All OAuth health checks passed!"
    print_status "OAuth configuration appears to be working correctly"
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
    print_critical "CRITICAL: OAuth has serious issues that could cause redirect loops or security vulnerabilities!"
    print_status "These issues match patterns from git history analysis"
    print_status "Fix critical issues before deploying to production"
    exit 1
elif [ $ERRORS -gt 0 ]; then
    print_error "❌ $ERRORS error(s) found"
    if [ $WARNINGS -gt 0 ]; then
        print_warning "⚠️ $WARNINGS warning(s) also found"
    fi
    echo ""
    print_error "OAuth has configuration errors that need attention"
    print_status "Review errors above and fix before production deployment"
    exit 1
else
    print_warning "⚠️ $WARNINGS warning(s) found"
    echo ""
    print_status "OAuth validation completed with warnings"
    print_status "Warnings should be reviewed but may not block deployment"
    exit 0
fi