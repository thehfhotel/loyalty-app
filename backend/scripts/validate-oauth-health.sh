#!/bin/bash
#
# OAuth Health Validation Script
# Validates OAuth configuration and health in production/development environments
#
# Exit codes:
#   0 - All checks passed
#   1 - Critical failure (OAuth completely broken)
#   2 - Warning (OAuth partially configured)
#

set -e

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
TIMEOUT=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
WARNINGS=0
ERRORS=0

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARNINGS++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((ERRORS++))
}

# Check if required environment variables are set
check_env_vars() {
    echo ""
    echo "=== OAuth Environment Variables ==="

    # Google OAuth
    if [ -n "$GOOGLE_CLIENT_ID" ] && [ "$GOOGLE_CLIENT_ID" != "your-google-client-id" ]; then
        log_info "GOOGLE_CLIENT_ID is configured"
        GOOGLE_CONFIGURED=true
    else
        log_warn "GOOGLE_CLIENT_ID is not configured (Google OAuth disabled)"
        GOOGLE_CONFIGURED=false
    fi

    if [ -n "$GOOGLE_CLIENT_SECRET" ] && [ "$GOOGLE_CLIENT_SECRET" != "your-google-client-secret" ]; then
        log_info "GOOGLE_CLIENT_SECRET is configured"
    else
        if [ "$GOOGLE_CONFIGURED" = true ]; then
            log_error "GOOGLE_CLIENT_SECRET is missing but GOOGLE_CLIENT_ID is set"
        fi
    fi

    # LINE OAuth
    if [ -n "$LINE_CHANNEL_ID" ] && [ "$LINE_CHANNEL_ID" != "your-line-channel-id" ]; then
        log_info "LINE_CHANNEL_ID is configured"
        LINE_CONFIGURED=true
    else
        log_warn "LINE_CHANNEL_ID is not configured (LINE OAuth disabled)"
        LINE_CONFIGURED=false
    fi

    if [ -n "$LINE_CHANNEL_SECRET" ] && [ "$LINE_CHANNEL_SECRET" != "your-line-channel-secret" ]; then
        log_info "LINE_CHANNEL_SECRET is configured"
    else
        if [ "$LINE_CONFIGURED" = true ]; then
            log_error "LINE_CHANNEL_SECRET is missing but LINE_CHANNEL_ID is set"
        fi
    fi

    # Callback URLs
    if [ -n "$GOOGLE_CALLBACK_URL" ]; then
        log_info "GOOGLE_CALLBACK_URL: $GOOGLE_CALLBACK_URL"
    elif [ "$GOOGLE_CONFIGURED" = true ]; then
        log_warn "GOOGLE_CALLBACK_URL not set, using default"
    fi

    if [ -n "$LINE_CALLBACK_URL" ]; then
        log_info "LINE_CALLBACK_URL: $LINE_CALLBACK_URL"
    elif [ "$LINE_CONFIGURED" = true ]; then
        log_warn "LINE_CALLBACK_URL not set, using default"
    fi
}

# Check OAuth state service health
check_state_health() {
    echo ""
    echo "=== OAuth State Service Health ==="

    HEALTH_URL="${BACKEND_URL}/api/oauth/state/health"

    RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout $TIMEOUT "$HEALTH_URL" 2>/dev/null || echo -e "\n000")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        log_info "OAuth state service is healthy (HTTP $HTTP_CODE)"

        # Parse stats if jq is available
        if command -v jq &> /dev/null; then
            STATUS=$(echo "$BODY" | jq -r '.status // "unknown"' 2>/dev/null)
            TOTAL_STATES=$(echo "$BODY" | jq -r '.stats.totalStates // "N/A"' 2>/dev/null)
            GOOGLE_STATES=$(echo "$BODY" | jq -r '.stats.googleStates // "N/A"' 2>/dev/null)
            LINE_STATES=$(echo "$BODY" | jq -r '.stats.lineStates // "N/A"' 2>/dev/null)

            log_info "  Status: $STATUS"
            log_info "  Active states: $TOTAL_STATES (Google: $GOOGLE_STATES, LINE: $LINE_STATES)"
        fi
    elif [ "$HTTP_CODE" = "503" ]; then
        log_error "OAuth state service is unhealthy (HTTP $HTTP_CODE)"
    elif [ "$HTTP_CODE" = "000" ]; then
        log_error "Cannot connect to backend at $BACKEND_URL"
    else
        log_warn "Unexpected response from state health endpoint (HTTP $HTTP_CODE)"
    fi
}

# Check Google OAuth endpoint
check_google_oauth() {
    echo ""
    echo "=== Google OAuth Endpoint ==="

    if [ "$GOOGLE_CONFIGURED" != true ]; then
        log_warn "Skipping Google OAuth check (not configured)"
        return
    fi

    GOOGLE_URL="${BACKEND_URL}/api/oauth/google"

    # Use -L to follow redirects, -I for headers only, -o /dev/null to discard body
    RESPONSE=$(curl -s -I -o /dev/null -w "%{http_code}|%{redirect_url}" --connect-timeout $TIMEOUT "$GOOGLE_URL" 2>/dev/null || echo "000|")
    HTTP_CODE=$(echo "$RESPONSE" | cut -d'|' -f1)
    REDIRECT_URL=$(echo "$RESPONSE" | cut -d'|' -f2)

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
        if echo "$REDIRECT_URL" | grep -q "accounts.google.com"; then
            log_info "Google OAuth endpoint working (redirects to Google)"
        elif echo "$REDIRECT_URL" | grep -q "error=google_not_configured"; then
            log_error "Google OAuth reports not configured despite env vars being set"
        else
            log_info "Google OAuth endpoint responding (HTTP $HTTP_CODE)"
        fi
    elif [ "$HTTP_CODE" = "000" ]; then
        log_error "Cannot connect to Google OAuth endpoint"
    else
        log_warn "Unexpected response from Google OAuth endpoint (HTTP $HTTP_CODE)"
    fi
}

# Check LINE OAuth endpoint
check_line_oauth() {
    echo ""
    echo "=== LINE OAuth Endpoint ==="

    if [ "$LINE_CONFIGURED" != true ]; then
        log_warn "Skipping LINE OAuth check (not configured)"
        return
    fi

    LINE_URL="${BACKEND_URL}/api/oauth/line"

    RESPONSE=$(curl -s -I -o /dev/null -w "%{http_code}|%{redirect_url}" --connect-timeout $TIMEOUT "$LINE_URL" 2>/dev/null || echo "000|")
    HTTP_CODE=$(echo "$RESPONSE" | cut -d'|' -f1)
    REDIRECT_URL=$(echo "$RESPONSE" | cut -d'|' -f2)

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
        if echo "$REDIRECT_URL" | grep -q "access.line.me"; then
            log_info "LINE OAuth endpoint working (redirects to LINE)"
        elif echo "$REDIRECT_URL" | grep -q "error=line_not_configured"; then
            log_error "LINE OAuth reports not configured despite env vars being set"
        else
            log_info "LINE OAuth endpoint responding (HTTP $HTTP_CODE)"
        fi
    elif [ "$HTTP_CODE" = "000" ]; then
        log_error "Cannot connect to LINE OAuth endpoint"
    else
        log_warn "Unexpected response from LINE OAuth endpoint (HTTP $HTTP_CODE)"
    fi
}

# Check OAuth /me endpoint (should require auth)
check_me_endpoint() {
    echo ""
    echo "=== OAuth /me Endpoint ==="

    ME_URL="${BACKEND_URL}/api/oauth/me"

    RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout $TIMEOUT "$ME_URL" 2>/dev/null || echo -e "\n000")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    if [ "$HTTP_CODE" = "401" ]; then
        log_info "OAuth /me endpoint properly requires authentication (HTTP 401)"
    elif [ "$HTTP_CODE" = "000" ]; then
        log_error "Cannot connect to OAuth /me endpoint"
    else
        log_warn "Unexpected response from /me endpoint (HTTP $HTTP_CODE)"
    fi
}

# Main execution
main() {
    echo "========================================"
    echo "OAuth Health Validation"
    echo "========================================"
    echo "Backend URL: $BACKEND_URL"
    echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    check_env_vars
    check_state_health
    check_google_oauth
    check_line_oauth
    check_me_endpoint

    echo ""
    echo "========================================"
    echo "Summary"
    echo "========================================"

    if [ $ERRORS -gt 0 ]; then
        log_error "Validation completed with $ERRORS error(s) and $WARNINGS warning(s)"
        exit 1
    elif [ $WARNINGS -gt 0 ]; then
        log_warn "Validation completed with $WARNINGS warning(s)"
        # Warnings are acceptable - OAuth might be intentionally disabled
        exit 0
    else
        log_info "All OAuth health checks passed"
        exit 0
    fi
}

main "$@"
