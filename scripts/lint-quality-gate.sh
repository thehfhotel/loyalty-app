#!/bin/bash

# ESLint Quality Gate Script
# Intelligently handles ESLint errors vs warnings to prevent blocking commits on non-critical issues

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

# Function to run ESLint with smart error categorization
run_eslint_check() {
    local project_dir="$1"
    local project_name="$2"
    
    print_status "Running ESLint quality gate for $project_name..."
    
    if [ ! -d "$project_dir" ]; then
        print_error "$project_name directory not found"
        return 1
    fi
    
    cd "$project_dir"
    
    # Check if ESLint is configured
    if [ ! -f ".eslintrc.js" ] && [ ! -f ".eslintrc.json" ] && [ ! -f "eslint.config.js" ]; then
        print_warning "$project_name ESLint not configured - skipping"
        return 0
    fi
    
    # Run ESLint and capture output
    local eslint_output
    local eslint_exit_code
    
    if command -v npm > /dev/null 2>&1 && [ -f "package.json" ]; then
        eslint_output=$(npm run lint 2>&1) || eslint_exit_code=$?
    else
        print_warning "npm or package.json not found in $project_name - skipping ESLint"
        return 0
    fi
    
    # Parse ESLint output for critical vs warning issues
    local error_count=0
    local warning_count=0
    local critical_errors=()
    local non_critical_warnings=()
    
    # Count errors and warnings from output
    if echo "$eslint_output" | grep -q "✖.*problems"; then
        # Extract error and warning counts
        error_count=$(echo "$eslint_output" | grep -oE '[0-9]+ errors?' | head -1 | grep -oE '[0-9]+' || echo "0")
        warning_count=$(echo "$eslint_output" | grep -oE '[0-9]+ warnings?' | head -1 | grep -oE '[0-9]+' || echo "0")
        
        # Identify critical errors that should block commits
        while IFS= read -r line; do
            if [[ "$line" =~ error.*(@typescript-eslint/no-unused-vars|no-undef|no-unreachable|@typescript-eslint/no-inferrable-types) ]]; then
                critical_errors+=("$line")
            elif [[ "$line" =~ error.*security/detect-(child-process|eval-with-expression|new-buffer|pseudoRandomBytes) ]]; then
                critical_errors+=("$line")
            elif [[ "$line" =~ error ]]; then
                # Other errors - need to evaluate case by case
                critical_errors+=("$line")
            fi
        done <<< "$eslint_output"
        
        # Collect non-critical warnings that shouldn't block
        while IFS= read -r line; do
            if [[ "$line" =~ warning.*(no-console|@typescript-eslint/no-explicit-any|security/detect-object-injection|react-hooks/exhaustive-deps) ]]; then
                non_critical_warnings+=("$line")
            fi
        done <<< "$eslint_output"
    fi
    
    # Determine if we should pass or fail
    local should_fail=false
    
    # Always fail on actual ESLint errors (severity 2)
    if [ "$error_count" -gt 0 ]; then
        print_error "$project_name has $error_count ESLint errors that must be fixed:"
        printf '%s\n' "${critical_errors[@]}" | head -10  # Show first 10 critical errors
        if [ ${#critical_errors[@]} -gt 10 ]; then
            print_warning "... and $((${#critical_errors[@]} - 10)) more errors"
        fi
        should_fail=true
    fi
    
    # Show summary of warnings but don't fail
    if [ "$warning_count" -gt 0 ]; then
        print_warning "$project_name has $warning_count ESLint warnings (non-blocking):"
        
        # Categorize warnings - ensure numeric values
        local console_warnings
        local any_warnings
        local security_warnings
        local hooks_warnings
        
        console_warnings=$(echo "$eslint_output" | grep -c "no-console" 2>/dev/null)
        any_warnings=$(echo "$eslint_output" | grep -c "no-explicit-any" 2>/dev/null)  
        security_warnings=$(echo "$eslint_output" | grep -c "security/detect-object-injection" 2>/dev/null)
        hooks_warnings=$(echo "$eslint_output" | grep -c "react-hooks/exhaustive-deps" 2>/dev/null)
        
        # Ensure all are numeric - handle empty or invalid values
        case "$console_warnings" in
            ''|*[!0-9]*) console_warnings=0 ;;
        esac
        case "$any_warnings" in
            ''|*[!0-9]*) any_warnings=0 ;;
        esac
        case "$security_warnings" in
            ''|*[!0-9]*) security_warnings=0 ;;
        esac
        case "$hooks_warnings" in
            ''|*[!0-9]*) hooks_warnings=0 ;;
        esac
        
        if [ "$console_warnings" -gt 0 ]; then
            print_warning "  - $console_warnings console statement warnings (consider removing in production)"
        fi
        if [ "$any_warnings" -gt 0 ]; then
            print_warning "  - $any_warnings TypeScript 'any' type warnings (consider proper typing)"
        fi
        if [ "$security_warnings" -gt 0 ]; then
            print_warning "  - $security_warnings object injection warnings (review for security)"
        fi
        if [ "$hooks_warnings" -gt 0 ]; then
            print_warning "  - $hooks_warnings React hooks dependency warnings"
        fi
        
        print_status "💡 These warnings don't block commits but should be addressed over time"
    fi
    
    # Return appropriate exit code
    if [ "$should_fail" = true ]; then
        print_error "$project_name ESLint quality gate failed - fix critical errors above"
        return 1
    else
        print_success "$project_name ESLint quality gate passed ✅"
        if [ "$warning_count" -gt 0 ]; then
            print_warning "($warning_count warnings to address when convenient)"
        fi
        return 0
    fi
}

# Main execution
if [ $# -eq 0 ]; then
    print_error "Usage: $0 <backend|frontend|both>"
    exit 1
fi

PROJECT_ROOT="$(pwd)"

case "$1" in
    backend)
        run_eslint_check "$PROJECT_ROOT/backend" "Backend"
        ;;
    frontend)
        run_eslint_check "$PROJECT_ROOT/frontend" "Frontend"
        ;;
    both)
        backend_result=0
        frontend_result=0
        
        run_eslint_check "$PROJECT_ROOT/backend" "Backend" || backend_result=$?
        run_eslint_check "$PROJECT_ROOT/frontend" "Frontend" || frontend_result=$?
        
        if [ "$backend_result" -ne 0 ] || [ "$frontend_result" -ne 0 ]; then
            print_error "ESLint quality gate failed for one or more projects"
            exit 1
        else
            print_success "✅ ESLint quality gate passed for all projects"
        fi
        ;;
    *)
        print_error "Invalid argument: $1. Use 'backend', 'frontend', or 'both'"
        exit 1
        ;;
esac