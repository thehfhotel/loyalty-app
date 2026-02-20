#!/bin/bash
set -e

# Security Audit Script for CI/CD Pipeline
# Validates critical security requirements before deployment

echo "🔒 Security Audit for Loyalty App Deployment"
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
# CRITICAL SECURITY CHECK 1: Rust Backend Security
# =============================================================================
echo ""
echo "🔑 Checking Backend Security (Rust/Axum)..."
echo "--------------------------------------------"

# Check for hardcoded secrets in Rust backend
if grep -rq "your-secret-key\|hardcoded.*secret\|password.*=.*\"" backend-rust/src/ 2>/dev/null; then
    log_warn "Potential hardcoded secrets detected in Rust backend"
else
    log_pass "No hardcoded secrets in Rust backend source"
fi

# Check for cargo audit vulnerabilities
if [ -f "backend-rust/Cargo.lock" ]; then
    log_pass "Cargo.lock exists for reproducible builds"
else
    log_warn "Cargo.lock not found (supply chain risk)"
fi

# =============================================================================
# CRITICAL SECURITY CHECK 2: HTTPS and Production Config
# =============================================================================
echo ""
echo "🔒 Checking Production Configuration..."
echo "-----------------------------------------"

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
if [ -f ".env.production.example" ]; then
    log_pass "Production environment template exists (.env.production.example)"
else
    log_warn ".env.production.example template not found"
fi

# Verify .env.production is NOT in git
if git ls-files --error-unmatch .env.production >/dev/null 2>&1; then
    log_fail "SECURITY: .env.production is tracked in git (should be in .gitignore)"
else
    log_pass ".env.production correctly excluded from git"
fi

# =============================================================================
# SUPPLY CHAIN SECURITY CHECKS (OWASP SCVS Aligned)
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
for dir in "." "frontend"; do
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
for dir in "." "frontend"; do
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
    for lockfile in package-lock.json frontend/package-lock.json; do
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
audit_check "frontend" "frontend"

# Check 5: Git-sourced packages without commit pinning
echo ""
echo "📌 Checking for unpinned git dependencies..."

UNPINNED_GIT=0
for lockfile in package-lock.json frontend/package-lock.json; do
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

# Check 6: Verify npm registry
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
        echo "✅ Ready for deployment"
    else
        echo -e "${YELLOW}⚠️  Security audit passed with $WARNINGS warnings${NC}"
        echo ""
        echo "✅ Safe for deployment (address warnings before next release)"
    fi
else
    echo -e "${RED}❌ Security audit FAILED with $CRITICAL_FAILURES critical issues${NC}"
    echo ""
    echo "🚨 NOT SAFE for deployment - fix critical issues first"
fi

echo ""
echo "=================================================="

exit $EXIT_CODE
