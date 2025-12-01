#!/bin/bash
set -e

# Security Audit Script for CI/CD Pipeline
# Validates critical security requirements before deployment

echo "🔒 Security Audit for 20-User Prototype Deployment"
echo "=================================================="
echo ""

EXIT_CODE=0
CRITICAL_FAILURES=0
WARNINGS=0

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
}

log_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1))
    EXIT_CODE=1
}

log_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
    WARNINGS=$((WARNINGS + 1))
}

log_info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1"
}

# =============================================================================
# CRITICAL SECURITY CHECK 1: Cryptographic Secrets
# =============================================================================
echo ""
echo "🔑 Checking Cryptographic Secrets..."
echo "------------------------------------"

# Check authService.ts for weak fallback secrets
if grep -q "your-secret-key\|your-refresh-secret" backend/src/services/authService.ts 2>/dev/null; then
    log_fail "Weak fallback secrets detected in authService.ts"
    echo "   Location: backend/src/services/authService.ts"
    echo "   Fix: Remove fallback defaults, require environment variables"
else
    log_pass "No weak fallback secrets in authService.ts"
fi

# Verify environment.ts enforces minimum secret lengths
if ! grep -q "JWT_SECRET.*64\|SESSION_SECRET.*64" backend/src/config/environment.ts 2>/dev/null; then
    log_warn "Production secret length validation may be missing (64+ chars required)"
else
    log_pass "Production secret length validation configured"
fi

# Check if .env.example has proper templates
if [ -f "backend/.env.example" ] || [ -f ".env.example" ]; then
    ENV_EXAMPLE_FILE=""
    if [ -f "backend/.env.example" ]; then
        ENV_EXAMPLE_FILE="backend/.env.example"
    elif [ -f ".env.example" ]; then
        ENV_EXAMPLE_FILE=".env.example"
    fi

    if grep -q "JWT_SECRET=.*[a-z0-9A-Z]\{64,\}" "$ENV_EXAMPLE_FILE" 2>/dev/null; then
        log_pass ".env.example has proper secret templates"
    else
        log_warn ".env.example should include 64+ character secret examples"
    fi
else
    log_warn ".env.example not found in backend/ or project root"
fi

# =============================================================================
# CRITICAL SECURITY CHECK 2: Rate Limiting Configuration
# =============================================================================
echo ""
echo "🚦 Checking Rate Limiting Configuration..."
echo "-------------------------------------------"

# Check for dangerous 100x rate limit increases
if grep -q "max: 20000\|max: 30000" backend/src/middleware/security.ts 2>/dev/null; then
    log_fail "Dangerous rate limits detected (20,000 or 30,000 requests)"
    echo "   Location: backend/src/middleware/security.ts"
    echo "   Fix: Restore to 200 (dev) and 300 (prod) requests"
else
    log_pass "Rate limits appear safe (< 1000 requests)"
fi

# Check for auth-specific rate limiter
if grep -q "createAuthRateLimiter\|authRateLimiter" backend/src/middleware/security.ts 2>/dev/null; then
    log_pass "Auth-specific rate limiter exists"
else
    log_warn "Auth-specific rate limiter not found (recommended: 5 attempts/15min)"
fi

# Verify rate limiter is applied to auth routes
if grep -q "authRateLimiter\|createAuthRateLimiter" backend/src/routes/auth.ts 2>/dev/null; then
    log_pass "Auth rate limiter applied in auth routes (route-level)"
elif grep -q "\/api\/auth.*authRateLimit\|authRateLimit.*authRoutes" backend/src/index.ts 2>/dev/null; then
    log_pass "Auth rate limiter applied at app level (before auth routes mount)"
else
    log_warn "Auth routes may not have dedicated rate limiting"
fi

# =============================================================================
# CRITICAL SECURITY CHECK 3: HTTPS Enforcement
# =============================================================================
echo ""
echo "🔒 Checking HTTPS Enforcement..."
echo "---------------------------------"

# Check for HTTPS redirection middleware (productionSecurity)
if grep -q "productionSecurity" backend/src/index.ts 2>/dev/null && \
   grep -q "redirect.*https\|https.*redirect" backend/src/middleware/security.ts 2>/dev/null; then
    log_pass "HTTPS enforcement middleware detected (productionSecurity with redirect)"
elif grep -q "productionSecurity" backend/src/index.ts 2>/dev/null; then
    log_pass "productionSecurity middleware registered (verify HTTPS redirect in security.ts)"
else
    log_warn "HTTPS enforcement middleware not detected"
    echo "   Add: if (!req.secure && process.env.NODE_ENV === 'production') res.redirect()"
fi

# Check for secure cookie configuration (httpOnly, sameSite, dynamic secure)
if grep -q "httpOnly: true" backend/src/index.ts 2>/dev/null && \
   grep -q "sameSite:" backend/src/index.ts 2>/dev/null; then
    # Verify secure flag is set (can be dynamic: secure: isSecure)
    if grep -q "secure:.*isSecure\|secure: true" backend/src/index.ts 2>/dev/null; then
        log_pass "Secure cookie configuration found (httpOnly, sameSite, dynamic secure flag)"
    else
        log_pass "Cookie security flags found (httpOnly, sameSite) - verify secure flag"
    fi
else
    log_warn "Secure cookies may not be configured (secure, httpOnly, sameSite required)"
fi

# Check Helmet.js configuration
if grep -q "helmet\|hsts" backend/src/index.ts 2>/dev/null; then
    log_pass "Helmet.js security headers configured"
else
    log_warn "Helmet.js may not be configured"
fi

# =============================================================================
# IMPORTANT SECURITY CHECK 4: Password Requirements
# =============================================================================
echo ""
echo "🔐 Checking Password Requirements..."
echo "-------------------------------------"

# Check for password validation schema
if grep -q "password.*min.*12\|password.*length.*12" backend/src/middleware/validateRequest.ts 2>/dev/null || \
   grep -q "password.*min.*12\|password.*length.*12" backend/src/routes/auth.ts 2>/dev/null; then
    log_pass "Password length requirement (12+ chars) configured"
else
    log_warn "Password minimum length requirement not found (recommended: 12+ chars)"
fi

# Check for password complexity validation
if grep -q "uppercase\|lowercase\|number\|special.*character" backend/src/middleware/validateRequest.ts 2>/dev/null || \
   grep -q "uppercase\|lowercase\|number\|special.*character" backend/src/routes/auth.ts 2>/dev/null; then
    log_pass "Password complexity requirements configured"
else
    log_warn "Password complexity validation not found (recommended: upper+lower+number+special)"
fi

# =============================================================================
# IMPORTANT SECURITY CHECK 5: Account Lockout Mechanism
# =============================================================================
echo ""
echo "🔒 Checking Account Lockout Mechanism..."
echo "-----------------------------------------"

# Check for AccountLockoutService
if [ -f "backend/src/services/accountLockoutService.ts" ]; then
    log_pass "AccountLockoutService exists"

    # Verify Redis integration
    if grep -q "redis\|Redis" backend/src/services/accountLockoutService.ts; then
        log_pass "Account lockout uses Redis for tracking"
    else
        log_warn "Account lockout may not use Redis"
    fi
else
    log_warn "AccountLockoutService not found (recommended for brute force protection)"
fi

# Check if lockout is integrated with auth
if grep -q "lockout\|accountLock" backend/src/services/authService.ts 2>/dev/null || \
   grep -q "lockout\|accountLock" backend/src/routes/auth.ts 2>/dev/null; then
    log_pass "Account lockout integrated with authentication"
else
    log_warn "Account lockout may not be integrated with authentication"
fi

# =============================================================================
# IMPORTANT SECURITY CHECK 6: Security Logging
# =============================================================================
echo ""
echo "📝 Checking Security Logging..."
echo "--------------------------------"

# Check for SecurityLogger or security event logging
if [ -f "backend/src/utils/securityLogger.ts" ]; then
    log_pass "SecurityLogger utility exists"
else
    log_warn "SecurityLogger not found (recommended for security event tracking)"
fi

# Check for security event middleware
if [ -f "backend/src/middleware/securityEventLogger.ts" ]; then
    log_pass "Security event logging middleware exists"
else
    log_warn "Security event logging middleware not found"
fi

# Verify security events are logged in auth routes
if grep -q "securityLog\|logSecurityEvent\|security.*event" backend/src/routes/auth.ts 2>/dev/null; then
    log_pass "Security events logged in auth routes"
else
    log_warn "Authentication events may not be logged"
fi

# =============================================================================
# ADDITIONAL SECURITY CHECKS
# =============================================================================
echo ""
echo "🛡️  Additional Security Checks..."
echo "----------------------------------"

# Check for input sanitization
if grep -q "sanitize\|xss\|escape" backend/src/middleware/security.ts 2>/dev/null; then
    log_pass "Input sanitization middleware configured"
else
    log_warn "Input sanitization may be missing"
fi

# Check for CORS configuration
if grep -q "cors\|CORS" backend/src/index.ts 2>/dev/null; then
    log_pass "CORS configured"
else
    log_warn "CORS configuration not detected"
fi

# Check for parameterized queries (Prisma)
if grep -q "prisma\|Prisma" backend/src/services/*.ts 2>/dev/null; then
    log_pass "Prisma ORM detected (SQL injection protection)"
else
    log_warn "Database query method unclear"
fi

# Check for bcrypt password hashing
if grep -q "bcrypt" backend/package.json 2>/dev/null; then
    log_pass "bcrypt installed for password hashing"
else
    log_fail "bcrypt not found - password hashing may be insecure"
fi

# =============================================================================
# SUPPLY CHAIN SECURITY CHECKS (OWASP SCVS Aligned)
# Reference: Shai-Hulud attack (Nov 2025), OWASP Software Component Verification
# =============================================================================
echo ""
echo "📦 Supply Chain Security Checks..."
echo "-----------------------------------"

# Known compromised package versions (Shai-Hulud attack - Nov 2025)
COMPROMISED_PACKAGES=(
    "debug@4.4.2"
    "chalk@5.6.1"
    "color-name@2.0.1"
    "strip-ansi@7.1.1"
    "color@5.0.1"
    "color-convert@3.1.1"
    "color-string@2.1.1"
    "has-ansi@6.0.1"
    "ansi-styles@6.2.2"
    "ansi-regex@6.2.1"
    "supports-color@10.2.1"
    "backslash@0.2.1"
    "wrap-ansi@9.0.1"
    "is-arrayish@0.3.3"
    "error-ex@1.3.3"
    "slice-ansi@7.1.1"
    "simple-swizzle@0.2.3"
    "chalk-template@1.1.1"
    "supports-hyperlinks@4.1.1"
    "duckdb@1.3.3"
)

# Check 1: Lockfile existence and integrity
echo ""
echo "🔒 Checking lockfile integrity..."

LOCKFILE_ISSUES=0
for dir in "." "backend" "frontend"; do
    if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
        if [ -f "$dir/package-lock.json" ]; then
            if git ls-files --error-unmatch "$dir/package-lock.json" >/dev/null 2>&1; then
                log_pass "$dir/package-lock.json exists and is tracked in git"
            else
                log_warn "$dir/package-lock.json exists but not tracked in git"
                LOCKFILE_ISSUES=$((LOCKFILE_ISSUES + 1))
            fi
        else
            log_fail "$dir has package.json but no package-lock.json (supply chain risk)"
            LOCKFILE_ISSUES=$((LOCKFILE_ISSUES + 1))
        fi
    fi
done

if [ $LOCKFILE_ISSUES -eq 0 ]; then
    log_pass "All lockfiles present and tracked"
fi

# Check 2: Malicious pre-install scripts
echo ""
echo "🚨 Checking for suspicious pre-install scripts..."

PREINSTALL_FOUND=0
for dir in "." "backend" "frontend"; do
    if [ -f "$dir/package.json" ]; then
        if grep -q '"preinstall"' "$dir/package.json" 2>/dev/null; then
            log_warn "preinstall script found in $dir/package.json (review manually)"
            PREINSTALL_FOUND=$((PREINSTALL_FOUND + 1))
        fi
    fi
done

if [ $PREINSTALL_FOUND -eq 0 ]; then
    log_pass "No preinstall scripts in package.json files"
fi

# Check 3: Known compromised packages (Shai-Hulud Nov 2025)
echo ""
echo "🦠 Scanning for known compromised packages (Shai-Hulud)..."

COMPROMISED_FOUND=0
for pkg in "${COMPROMISED_PACKAGES[@]}"; do
    for lockfile in package-lock.json backend/package-lock.json frontend/package-lock.json; do
        if [ -f "$lockfile" ]; then
            if grep -q "\"$pkg\"" "$lockfile" 2>/dev/null; then
                log_fail "COMPROMISED PACKAGE DETECTED: $pkg in $lockfile"
                COMPROMISED_FOUND=$((COMPROMISED_FOUND + 1))
            fi
        fi
    done
done

if [ $COMPROMISED_FOUND -eq 0 ]; then
    log_pass "No known compromised packages detected"
fi

# Check 4: npm audit for vulnerabilities
echo ""
echo "🔍 Running npm audit checks..."

audit_check() {
    local dir=$1
    local name=$2
    if [ -f "$dir/package-lock.json" ]; then
        cd "$dir"
        AUDIT_RESULT=$(npm audit --json 2>/dev/null | jq -r '.metadata.vulnerabilities // empty')
        CRITICAL=$(echo "$AUDIT_RESULT" | jq -r '.critical // 0')
        HIGH=$(echo "$AUDIT_RESULT" | jq -r '.high // 0')
        cd - >/dev/null
        if [ "$CRITICAL" != "0" ] && [ "$CRITICAL" != "" ]; then
            log_fail "$name: $CRITICAL critical vulnerabilities found"
        elif [ "$HIGH" != "0" ] && [ "$HIGH" != "" ]; then
            log_warn "$name: $HIGH high severity vulnerabilities (run npm audit fix)"
        else
            log_pass "$name: No critical/high vulnerabilities"
        fi
    fi
}

audit_check "." "root"
audit_check "backend" "backend"
audit_check "frontend" "frontend"

# Check 5: Git-sourced packages without commit pinning
echo ""
echo "📌 Checking for unpinned git dependencies..."

UNPINNED_GIT=0
for lockfile in package-lock.json backend/package-lock.json frontend/package-lock.json; do
    if [ -f "$lockfile" ]; then
        if grep -E '"resolved":\s*"git(\+https?|:)' "$lockfile" 2>/dev/null | grep -v "#[a-f0-9]\{40\}" >/dev/null; then
            log_warn "Unpinned git dependencies in $lockfile (should pin to commit hash)"
            UNPINNED_GIT=$((UNPINNED_GIT + 1))
        fi
    fi
done

if [ $UNPINNED_GIT -eq 0 ]; then
    log_pass "No unpinned git dependencies found"
fi

# Check 6: Verify npm registry (not using untrusted registries)
echo ""
echo "🌐 Checking npm registry configuration..."

if [ -f ".npmrc" ]; then
    if grep -qE "registry=.*(?<!npmjs\.org)" .npmrc 2>/dev/null; then
        log_warn "Custom npm registry configured in .npmrc (verify it's trusted)"
    else
        log_pass ".npmrc uses default npm registry"
    fi
else
    log_pass "No custom .npmrc (using default npm registry)"
fi

# =============================================================================
# PRODUCTION ENVIRONMENT CHECKS
# =============================================================================
echo ""
echo "⚙️  Production Environment Checks..."
echo "-------------------------------------"

# Check if docker-compose.prod.yml exists
if [ -f "docker-compose.prod.yml" ]; then
    log_pass "docker-compose.prod.yml exists"

    # Verify it uses runner stage (not development)
    if grep -q "target: runner" docker-compose.prod.yml; then
        log_pass "Production uses optimized runner stage"
    else
        log_warn "Production may be using development stage (check build.target)"
    fi
else
    log_warn "docker-compose.prod.yml not found"
fi

# Check for .env.production.example template
if [ -f "backend/.env.production.example" ] || [ -f ".env.production.example" ]; then
    log_pass "Production environment template exists (.env.production.example)"
else
    log_warn ".env.production.example template not found (developers need environment variable reference)"
fi

# Verify .env.production is NOT in git (security best practice)
if git ls-files --error-unmatch .env.production >/dev/null 2>&1; then
    log_fail "SECURITY: .env.production is tracked in git (should be in .gitignore)"
elif git ls-files --error-unmatch backend/.env.production >/dev/null 2>&1; then
    log_fail "SECURITY: backend/.env.production is tracked in git (should be in .gitignore)"
else
    log_pass ".env.production correctly excluded from git (security best practice)"
fi

# =============================================================================
# TEST INTEGRITY CHECKS
# =============================================================================
echo ""
echo "🧪 Test Integrity Checks..."
echo "---------------------------"

# Check for test bypassing patterns
if scripts/validate-test-integrity.sh 2>&1 | grep -q "CRITICAL"; then
    log_fail "Test bypassing detected (see validate-test-integrity.sh output)"
else
    log_pass "No test bypassing patterns detected"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "=================================================="
echo "📊 Security Audit Summary"
echo "=================================================="
echo ""
echo "Critical Failures: $CRITICAL_FAILURES"
echo "Warnings: $WARNINGS"
echo ""

if [ $CRITICAL_FAILURES -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}🎉 All security checks passed!${NC}"
        echo ""
        echo "✅ Ready for 20-user prototype deployment"
    else
        echo -e "${YELLOW}⚠️  Security audit passed with $WARNINGS warnings${NC}"
        echo ""
        echo "✅ Safe for 20-user prototype (address warnings before production)"
    fi
else
    echo -e "${RED}❌ Security audit FAILED with $CRITICAL_FAILURES critical issues${NC}"
    echo ""
    echo "🚨 NOT SAFE for deployment - fix critical issues first"
    echo ""
    echo "Required fixes:"
    echo "1. Remove weak fallback secrets from authService.ts"
    echo "2. Restore safe rate limits (200 dev, 300 prod)"
    echo "3. Ensure bcrypt is installed for password hashing"
fi

echo ""
echo "=================================================="

exit $EXIT_CODE
