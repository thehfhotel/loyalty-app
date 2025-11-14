#!/bin/bash

# Test Integrity Validation Script
# Scans codebase for test bypassing patterns and fake test implementations
# Part of the critical project rules enforcement

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

print_violation() {
    echo -e "${RED}[VIOLATION]${NC} $1"
}

echo "🛡️ Test Integrity Validation"
echo "========================================"

# Ensure we're in project root
if [ ! -f "package.json" ]; then
    print_error "Must run from project root directory"
    exit 1
fi

VIOLATIONS=0
WARNINGS=0

# Test file patterns to check
TEST_PATTERNS=("**/*.test.ts" "**/*.test.js" "**/*.spec.ts" "**/*.spec.js" "**/tests/**/*.ts" "**/tests/**/*.js" "**/__tests__/**/*.ts" "**/__tests__/**/*.js")

print_status "Scanning for test bypassing violations..."

# Function to check for violations in a file
check_file_violations() {
    local file="$1"
    local violations_found=0
    
    # Skip node_modules and dist directories
    if [[ "$file" == *"node_modules"* ]] || [[ "$file" == *"dist"* ]] || [[ "$file" == *"build"* ]]; then
        return 0
    fi
    
    # Check for test skipping patterns
    if grep -n "test\.skip\|it\.skip\|describe\.skip\|xit\(" "$file" >/dev/null 2>&1; then
        print_violation "Test bypassing found in $file:"
        grep -n "test\.skip\|it\.skip\|describe\.skip\|xit\(" "$file" | while read -r line; do
            echo "  → $line"
        done
        violations_found=1
        ((VIOLATIONS++))
    fi
    
    # Check for trivial test assertions
    if grep -n "expect(true)\.toBe(true)\|expect(1)\.toBe(1)\|expect(false)\.toBe(false)" "$file" >/dev/null 2>&1; then
        print_violation "Trivial test assertions found in $file:"
        grep -n "expect(true)\.toBe(true)\|expect(1)\.toBe(1)\|expect(false)\.toBe(false)" "$file" | while read -r line; do
            echo "  → $line"
        done
        violations_found=1
        ((VIOLATIONS++))
    fi
    
    # Check for conditional test bypassing
    # Note: Excludes legitimate timeout checks that throw errors
    if grep -n "if.*process\.env\.SKIP_TESTS\|if.*isTestEnvironment.*return" "$file" >/dev/null 2>&1; then
        print_violation "Conditional test bypassing found in $file:"
        grep -n "if.*process\.env\.SKIP_TESTS\|if.*isTestEnvironment.*return" "$file" | while read -r line; do
            echo "  → $line"
        done
        violations_found=1
        ((VIOLATIONS++))
    fi

    # Check for Date.now() test bypasses (but exclude legitimate timeout checks that throw errors)
    if grep -n "if.*Date\.now().*return" "$file" >/dev/null 2>&1; then
        # Only flag if it's a return without throw
        if ! grep -A1 "if.*Date\.now()" "$file" | grep -q "throw"; then
            print_violation "Conditional test bypassing with Date.now() found in $file:"
            grep -n "if.*Date\.now().*return" "$file" | while read -r line; do
                echo "  → $line"
            done
            violations_found=1
            ((VIOLATIONS++))
        fi
    fi
    
    # Check for early returns that bypass tests
    if grep -n "return true.*bypass\|return.*skip.*test\|process\.exit(0)" "$file" >/dev/null 2>&1; then
        print_violation "Test bypass patterns found in $file:"
        grep -n "return true.*bypass\|return.*skip.*test\|process\.exit(0)" "$file" | while read -r line; do
            echo "  → $line"
        done
        violations_found=1
        ((VIOLATIONS++))
    fi
    
    # Check for TODO comments in test files (incomplete tests)
    if grep -n "TODO.*test\|// TODO.*implement\|/* TODO.*test" "$file" >/dev/null 2>&1; then
        print_warning "Incomplete tests found in $file:"
        grep -n "TODO.*test\|// TODO.*implement\|/* TODO.*test" "$file" | while read -r line; do
            echo "  → $line"
        done
        ((WARNINGS++))
    fi
    
    # Check for empty test implementations
    if grep -n "it('.*', () => {});\|test('.*', () => {});" "$file" >/dev/null 2>&1; then
        print_violation "Empty test implementations found in $file:"
        grep -n "it('.*', () => {});\|test('.*', () => {});" "$file" | while read -r line; do
            echo "  → $line"
        done
        violations_found=1
        ((VIOLATIONS++))
    fi
    
    return $violations_found
}

# Scan all test files
for pattern in "${TEST_PATTERNS[@]}"; do
    # Use find to locate test files matching the pattern
    find . -path "./node_modules" -prune -o -path "./*/node_modules" -prune -o -name "*.test.ts" -print -o -name "*.test.js" -print -o -name "*.spec.ts" -print -o -name "*.spec.js" -print | while read -r file; do
        if [ -f "$file" ]; then
            check_file_violations "$file"
        fi
    done
done

# Also check test directories
if [ -d "tests" ]; then
    find tests -name "*.ts" -o -name "*.js" | while read -r file; do
        if [ -f "$file" ]; then
            check_file_violations "$file"
        fi
    done
fi

if [ -d "backend/src/__tests__" ]; then
    find backend/src/__tests__ -name "*.ts" -o -name "*.js" | while read -r file; do
        if [ -f "$file" ]; then
            check_file_violations "$file"
        fi
    done
fi

if [ -d "frontend/src/__tests__" ]; then
    find frontend/src/__tests__ -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | while read -r file; do
        if [ -f "$file" ]; then
            check_file_violations "$file"
        fi
    done
fi

echo ""
echo "========================================"

# Report results
if [ $VIOLATIONS -eq 0 ]; then
    print_success "✅ No test integrity violations found!"
    if [ $WARNINGS -gt 0 ]; then
        print_warning "⚠️  $WARNINGS warning(s) found - please address incomplete tests"
    fi
    echo ""
    print_status "Test integrity validation passed"
    exit 0
else
    print_error "❌ $VIOLATIONS test integrity violation(s) found!"
    if [ $WARNINGS -gt 0 ]; then
        print_warning "⚠️  $WARNINGS warning(s) also found"
    fi
    echo ""
    print_error "CRITICAL: Test bypassing detected - this violates project rules!"
    print_error "Fix all violations before committing or pushing"
    echo ""
    print_status "Refer to CLAUDE.md for test integrity requirements"
    exit 1
fi