#!/bin/bash

# Loyalty App Project Management Script
# Centralized interactive interface for all project operations

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Project information
PROJECT_NAME="Loyalty App"
PROJECT_VERSION="4.0.0"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Docker services
DOCKER_SERVICES="postgres redis nginx backend frontend"
BACKEND_SERVICE="backend"
FRONTEND_SERVICE="frontend"

# Print functions
print_header() {
    echo -e "${CYAN}=================================${NC}"
    echo -e "${WHITE}  🏨 ${PROJECT_NAME} Manager v${PROJECT_VERSION}${NC}"
    echo -e "${CYAN}=================================${NC}"
    echo ""
}

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

print_section() {
    echo -e "${PURPLE}▶ $1${NC}"
}

# Utility functions
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

check_dependencies() {
    local missing_deps=()
    
    # Check for required commands
    command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
    docker compose version >/dev/null 2>&1 || missing_deps+=("docker compose")
    command -v node >/dev/null 2>&1 || missing_deps+=("node")
    command -v npm >/dev/null 2>&1 || missing_deps+=("npm")
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        print_error "Missing dependencies: ${missing_deps[*]}"
        print_status "Please install the missing dependencies and try again."
        exit 1
    fi
}

get_service_status() {
    local service="$1"
    if docker compose ps "$service" 2>/dev/null | grep -q "Up"; then
        echo "running"
    elif docker compose ps "$service" 2>/dev/null | grep -q "Exit"; then
        echo "stopped"
    else
        echo "unknown"
    fi
}

show_service_status() {
    print_section "Service Status"
    
    for service in $DOCKER_SERVICES; do
        local status=$(get_service_status "$service")
        case "$status" in
            "running")
                echo -e "  ${GREEN}●${NC} $service (running)"
                ;;
            "stopped")
                echo -e "  ${RED}●${NC} $service (stopped)"
                ;;
            *)
                echo -e "  ${YELLOW}●${NC} $service (unknown)"
                ;;
        esac
    done
    echo ""
}

# =============================================================================
# PROJECT CONTROL FUNCTIONS
# =============================================================================

start_services() {
    print_section "Starting Services"
    
    print_status "Starting Docker services..."
    docker compose up -d
    
    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 5
    
    # Check backend health
    local backend_ready=false
    local attempts=0
    local max_attempts=30
    
    while [[ "$backend_ready" == false && $attempts -lt $max_attempts ]]; do
        if curl -s http://localhost:4001/api/health >/dev/null 2>&1; then
            backend_ready=true
        else
            ((attempts++))
            sleep 2
        fi
    done
    
    if [[ "$backend_ready" == true ]]; then
        print_success "Backend is ready at http://localhost:4001"
    else
        print_warning "Backend may not be ready. Check logs with: docker compose logs backend"
    fi
    
    # Check frontend
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        print_success "Frontend is ready at http://localhost:3000"
    else
        print_warning "Frontend may not be ready. Check logs with: docker compose logs frontend"
    fi
    
    show_service_status
}

stop_services() {
    print_section "Stopping Services"
    
    if confirm "Are you sure you want to stop all services?" "n"; then
        print_status "Stopping Docker services..."
        docker compose down
        print_success "All services stopped"
    else
        print_status "Operation cancelled"
    fi
}

restart_services() {
    print_section "Restarting Services"
    
    print_status "Restarting Docker services..."
    docker compose restart
    
    print_status "Waiting for services to be ready..."
    sleep 5
    
    show_service_status
}

restart_specific_service() {
    print_section "Restart Specific Service"
    
    echo "Available services:"
    local i=1
    local services_array=($DOCKER_SERVICES)
    for service in "${services_array[@]}"; do
        echo "  $i) $service"
        ((i++))
    done
    
    echo -ne "${YELLOW}Select service (1-${#services_array[@]}): ${NC}"
    read -r choice
    
    if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le ${#services_array[@]} ]]; then
        local selected_service="${services_array[$((choice-1))]}"
        print_status "Restarting $selected_service..."
        docker compose restart "$selected_service"
        print_success "$selected_service restarted"
    else
        print_error "Invalid selection"
    fi
}

# =============================================================================
# BUILD FUNCTIONS
# =============================================================================

build_all() {
    print_section "Building All Components"
    
    print_status "Installing dependencies..."
    npm run install:all
    
    print_status "Building backend..."
    npm run build:backend
    
    print_status "Building frontend..."
    npm run build:frontend
    
    print_success "Build completed successfully"
}

build_backend() {
    print_section "Building Backend"
    npm run build:backend
    print_success "Backend build completed"
}

build_frontend() {
    print_section "Building Frontend"
    npm run build:frontend
    print_success "Frontend build completed"
}

build_production() {
    print_section "Production Build"
    
    if confirm "This will run a full production build. Continue?" "y"; then
        print_status "Running production build script..."
        ./scripts/build-production.sh
        print_success "Production build completed"
    else
        print_status "Operation cancelled"
    fi
}

# =============================================================================
# TESTING FUNCTIONS
# =============================================================================

run_all_tests() {
    print_section "Running All Tests"
    
    print_status "Validating test integrity..."
    npm run test:integrity
    
    print_status "Running unit tests..."
    npm run test:unit
    
    print_status "Running integration tests..."
    npm run test:integration
    
    print_status "Running E2E tests..."
    npm run test:e2e
    
    print_success "All tests completed"
}

run_unit_tests() {
    print_section "Running Unit Tests"
    npm run test:unit
    print_success "Unit tests completed"
}

run_integration_tests() {
    print_section "Running Integration Tests"
    npm run test:integration
    print_success "Integration tests completed"
}

run_e2e_tests() {
    print_section "Running E2E Tests"
    npm run test:e2e
    print_success "E2E tests completed"
}

run_test_coverage() {
    print_section "Running Test Coverage"
    npm run test:coverage
    print_success "Coverage analysis completed"
    print_status "Coverage report available at: backend/coverage/lcov-report/index.html"
}

validate_test_integrity() {
    print_section "Validating Test Integrity"
    print_status "Scanning for test bypassing violations..."
    npm run test:integrity
    print_success "Test integrity validation completed"
}

validate_oauth_health() {
    print_section "OAuth Health Validation"
    print_status "Checking OAuth endpoints and configuration..."
    npm run oauth:health
    print_success "OAuth health validation completed"
}

validate_database_migration() {
    print_section "Database Migration Validation"
    print_status "Checking database migration readiness..."
    npm run db:validate
    print_success "Database migration validation completed"
}

check_migration_rollback_safety() {
    print_section "Migration Rollback Safety Check"
    print_status "Verifying rollback procedures and backups..."
    npm run db:rollback-check
    print_success "Migration rollback safety check completed"
}

create_database_backup() {
    print_section "Creating Database Backup"
    print_status "Creating pre-migration database backup..."
    npm run db:backup
    print_success "Database backup completed"
}

run_deployment_validation() {
    print_section "Complete Deployment Validation"
    print_status "Running comprehensive pre-deployment checks..."
    npm run deploy:validate
    print_success "Deployment validation completed"
}

reset_oauth_rate_limits() {
    print_section "OAuth Rate Limit Reset"
    print_status "Resetting OAuth endpoint rate limits for testing..."
    ./scripts/reset-rate-limits.sh
    print_success "OAuth rate limit reset completed"
}

# =============================================================================
# QUALITY CHECK FUNCTIONS
# =============================================================================

run_quality_checks() {
    print_section "Running Quality Checks"
    
    print_status "Running TypeScript checks..."
    npm run typecheck
    
    print_status "Running ESLint checks..."
    npm run lint
    
    print_status "Running tests..."
    npm run test
    
    print_success "Quality checks completed"
}

run_lint_checks() {
    print_section "Running Lint Checks"
    
    echo "1) Backend only"
    echo "2) Frontend only"
    echo "3) Both (default)"
    echo -ne "${YELLOW}Select option (1-3): ${NC}"
    read -r choice
    
    case "$choice" in
        1)
            npm run lint:backend
            ;;
        2)
            npm run lint:frontend
            ;;
        *)
            npm run lint
            ;;
    esac
    
    print_success "Lint checks completed"
}

run_typecheck() {
    print_section "Running TypeScript Checks"
    
    echo "1) Backend only"
    echo "2) Frontend only"
    echo "3) Both (default)"
    echo -ne "${YELLOW}Select option (1-3): ${NC}"
    read -r choice
    
    case "$choice" in
        1)
            npm run typecheck:backend
            ;;
        2)
            npm run typecheck:frontend
            ;;
        *)
            npm run typecheck
            ;;
    esac
    
    print_success "TypeScript checks completed"
}

fix_lint_issues() {
    print_section "Fixing Lint Issues"
    
    echo "1) Backend only"
    echo "2) Frontend only"  
    echo "3) Both (default)"
    echo -ne "${YELLOW}Select option (1-3): ${NC}"
    read -r choice
    
    case "$choice" in
        1)
            cd backend && npm run lint:fix
            ;;
        2)
            cd frontend && npm run lint:fix
            ;;
        *)
            cd backend && npm run lint:fix
            cd ../frontend && npm run lint:fix
            ;;
    esac
    
    print_success "Lint fixes applied"
}

# =============================================================================
# SECURITY CHECK FUNCTIONS
# =============================================================================

run_security_audit() {
    print_section "Running Security Audit"
    
    print_status "Checking root dependencies..."
    npm audit --audit-level=moderate
    
    print_status "Checking backend dependencies..."
    cd backend && npm audit --audit-level=moderate
    
    print_status "Checking frontend dependencies..."
    cd ../frontend && npm audit --audit-level=moderate
    
    print_success "Security audit completed"
}

fix_security_issues() {
    print_section "Fixing Security Issues"
    
    if confirm "This will attempt to fix security vulnerabilities. Continue?" "y"; then
        print_status "Fixing root vulnerabilities..."
        npm audit fix
        
        print_status "Fixing backend vulnerabilities..."
        cd backend && npm audit fix
        
        print_status "Fixing frontend vulnerabilities..."
        cd ../frontend && npm audit fix
        
        print_success "Security fixes applied"
        print_warning "Please test the application after security fixes"
    else
        print_status "Operation cancelled"
    fi
}

validate_security() {
    print_section "Security Validation"
    
    if [[ -f "./scripts/validate-security.js" ]]; then
        print_status "Running security validation script..."
        node ./scripts/validate-security.js
    else
        print_warning "Security validation script not found"
    fi
    
    print_success "Security validation completed"
}

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

show_logs() {
    print_section "Service Logs"
    
    echo "Available services:"
    local i=1
    local services_array=($DOCKER_SERVICES)
    for service in "${services_array[@]}"; do
        echo "  $i) $service"
        ((i++))
    done
    echo "  $((i))) All services"
    
    echo -ne "${YELLOW}Select service (1-$i): ${NC}"
    read -r choice
    
    if [[ "$choice" == "$i" ]]; then
        docker compose logs -f
    elif [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le ${#services_array[@]} ]]; then
        local selected_service="${services_array[$((choice-1))]}"
        docker compose logs -f "$selected_service"
    else
        print_error "Invalid selection"
    fi
}

cleanup_project() {
    print_section "Project Cleanup"
    
    echo "Cleanup options:"
    echo "1) Remove node_modules (all)"
    echo "2) Remove build artifacts"
    echo "3) Remove Docker images"
    echo "4) Remove logs"
    echo "5) Full cleanup (all of the above)"
    
    echo -ne "${YELLOW}Select option (1-5): ${NC}"
    read -r choice
    
    case "$choice" in
        1)
            if confirm "Remove all node_modules directories?" "n"; then
                print_status "Removing node_modules..."
                rm -rf node_modules backend/node_modules frontend/node_modules
                print_success "node_modules removed"
            fi
            ;;
        2)
            if confirm "Remove build artifacts?" "n"; then
                print_status "Removing build artifacts..."
                rm -rf backend/dist frontend/dist backend/coverage
                print_success "Build artifacts removed"
            fi
            ;;
        3)
            if confirm "Remove Docker images?" "n"; then
                print_status "Removing Docker images..."
                docker compose down --rmi all
                print_success "Docker images removed"
            fi
            ;;
        4)
            if confirm "Remove log files?" "n"; then
                print_status "Removing logs..."
                rm -rf logs backend/logs frontend/logs
                print_success "Log files removed"
            fi
            ;;
        5)
            # Full cleanup - do all operations
            if confirm "Remove all node_modules directories?" "n"; then
                print_status "Removing node_modules..."
                rm -rf node_modules backend/node_modules frontend/node_modules
                print_success "node_modules removed"
            fi
            if confirm "Remove build artifacts?" "n"; then
                print_status "Removing build artifacts..."
                rm -rf backend/dist frontend/dist backend/coverage
                print_success "Build artifacts removed"
            fi
            if confirm "Remove Docker images?" "n"; then
                print_status "Removing Docker images..."
                docker compose down --rmi all
                print_success "Docker images removed"
            fi
            if confirm "Remove log files?" "n"; then
                print_status "Removing logs..."
                rm -rf logs backend/logs frontend/logs
                print_success "Log files removed"
            fi
            ;;
        *)
            print_error "Invalid selection"
            ;;
    esac
}

show_system_info() {
    print_section "System Information"
    
    echo "Project: $PROJECT_NAME v$PROJECT_VERSION"
    echo "Location: $PROJECT_ROOT"
    echo ""
    
    echo "Dependencies:"
    echo "  Node.js: $(node --version 2>/dev/null || echo 'Not installed')"
    echo "  NPM: $(npm --version 2>/dev/null || echo 'Not installed')"
    echo "  Docker: $(docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',' || echo 'Not installed')"
    echo "  Docker Compose: $(docker compose version 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo 'Not installed')"
    echo ""
    
    echo "Services Status:"
    show_service_status
}

# =============================================================================
# MENU SYSTEM
# =============================================================================

show_main_menu() {
    clear
    print_header
    show_service_status
    
    echo -e "${WHITE}Main Menu:${NC}"
    echo "  1)  🚀 Start Services"
    echo "  2)  ⏹️  Stop Services"
    echo "  3)  🔄 Restart Services" 
    echo "  4)  🔧 Restart Specific Service"
    echo ""
    echo "  5)  🏗️  Build Menu"
    echo "  6)  🧪 Testing Menu"
    echo "  7)  ✅ Quality Menu"
    echo "  8)  🔒 Security Menu"
    echo "  9)  🚀 Deployment Menu"
    echo ""
    echo "  10) 📋 Show Logs"
    echo "  11) 🧹 Cleanup Project"
    echo "  12) ℹ️  System Info"
    echo "  13) ❓ Help"
    echo ""
    echo "  0)  👋 Exit"
    echo ""
}

show_build_menu() {
    clear
    print_header
    
    echo -e "${WHITE}Build Menu:${NC}"
    echo "  1) 🏗️  Build All (Backend + Frontend)"
    echo "  2) ⚙️  Build Backend Only"
    echo "  3) 🎨 Build Frontend Only"
    echo "  4) 🚀 Production Build"
    echo ""
    echo "  0) ← Back to Main Menu"
    echo ""
}

show_testing_menu() {
    clear
    print_header
    
    echo -e "${WHITE}Testing Menu:${NC}"
    echo "  1) 🧪 Run All Tests"
    echo "  2) 🔬 Unit Tests"
    echo "  3) 🔗 Integration Tests"
    echo "  4) 🎭 E2E Tests"
    echo "  5) 📊 Test Coverage"
    echo "  6) 🛡️  Test Integrity Validation"
    echo "  7) 🔐 OAuth Health Validation"
    echo "  8) 🗄️  Database Migration Validation"
    echo "  9) 💾 Migration Rollback Safety Check"
    echo ""
    echo "  0) ← Back to Main Menu"
    echo ""
}

show_quality_menu() {
    clear
    print_header
    
    echo -e "${WHITE}Quality Menu:${NC}"
    echo "  1) ✅ Run All Quality Checks"
    echo "  2) 🧹 Run Lint Checks"
    echo "  3) 📝 Run TypeScript Checks"
    echo "  4) 🔧 Fix Lint Issues"
    echo ""
    echo "  0) ← Back to Main Menu"
    echo ""
}

show_security_menu() {
    clear
    print_header
    
    echo -e "${WHITE}Security Menu:${NC}"
    echo "  1) 🔒 Run Security Audit"
    echo "  2) 🛠️  Fix Security Issues"
    echo "  3) 🛡️  Validate Security"
    echo ""
    echo "  0) ← Back to Main Menu"
    echo ""
}

show_deployment_menu() {
    clear
    print_header
    
    echo -e "${WHITE}Deployment Menu:${NC}"
    echo "  1) 🚀 Complete Deployment Validation"
    echo "  2) 🔐 OAuth Health Check"
    echo "  3) 🗄️  Database Migration Validation"
    echo "  4) 💾 Check Migration Rollback Safety"
    echo "  5) 📦 Create Database Backup"
    echo "  6) 🧪 Run OAuth E2E Tests"
    echo "  7) 🔄 Reset OAuth Rate Limits"
    echo ""
    echo "  0) ← Back to Main Menu"
    echo ""
}

show_help() {
    clear
    print_header
    
    echo -e "${WHITE}Help & Usage:${NC}"
    echo ""
    echo "This script provides a centralized interface for managing the Loyalty App project."
    echo ""
    echo -e "${YELLOW}Key Features:${NC}"
    echo "  • Service management (start/stop/restart)"
    echo "  • Build operations (backend/frontend/production)"
    echo "  • Testing (unit/integration/e2e/coverage)"
    echo "  • Quality checks (lint/typecheck/fixes)"
    echo "  • Security audits and fixes"
    echo "  • OAuth rate limit reset for testing"
    echo "  • Database migration validation"
    echo "  • Log viewing and project cleanup"
    echo ""
    echo -e "${YELLOW}Prerequisites:${NC}"
    echo "  • Docker and Docker Compose"
    echo "  • Node.js and NPM"
    echo "  • Project dependencies installed"
    echo ""
    echo -e "${YELLOW}Quick Start:${NC}"
    echo "  1. Run './manage.sh' to start the interactive menu"
    echo "  2. Select '1' to start all services"
    echo "  3. Visit http://localhost:3000 for frontend"
    echo "  4. Visit http://localhost:4001 for backend API"
    echo ""
    echo -e "${YELLOW}Environment:${NC}"
    echo "  • Development: Uses docker compose.yml"
    echo "  • Production: Use production build option"
    echo ""
    echo "Press any key to continue..."
    read -r
}

# =============================================================================
# MENU HANDLERS
# =============================================================================

handle_main_menu() {
    local choice
    echo -ne "${YELLOW}Enter your choice (0-13): ${NC}"
    read -r choice
    
    case "$choice" in
        1) start_services ;;
        2) stop_services ;;
        3) restart_services ;;
        4) restart_specific_service ;;
        5) handle_build_menu ;;
        6) handle_testing_menu ;;
        7) handle_quality_menu ;;
        8) handle_security_menu ;;
        9) handle_deployment_menu ;;
        10) show_logs ;;
        11) cleanup_project ;;
        12) show_system_info ;;
        13) show_help ;;
        0) 
            print_success "Thanks for using $PROJECT_NAME Manager!"
            exit 0
            ;;
        *)
            print_error "Invalid choice. Please try again."
            ;;
    esac
    
    echo ""
    echo "Press any key to continue..."
    read -r
}

handle_build_menu() {
    while true; do
        show_build_menu
        echo -ne "${YELLOW}Enter your choice (0-4): ${NC}"
        read -r choice
        
        case "$choice" in
            1) build_all ;;
            2) build_backend ;;
            3) build_frontend ;;
            4) build_production ;;
            0) return ;;
            *)
                print_error "Invalid choice. Please try again."
                continue
                ;;
        esac
        
        echo ""
        echo "Press any key to continue..."
        read -r
    done
}

handle_testing_menu() {
    while true; do
        show_testing_menu
        echo -ne "${YELLOW}Enter your choice (0-9): ${NC}"
        read -r choice
        
        case "$choice" in
            1) run_all_tests ;;
            2) run_unit_tests ;;
            3) run_integration_tests ;;
            4) run_e2e_tests ;;
            5) run_test_coverage ;;
            6) validate_test_integrity ;;
            7) validate_oauth_health ;;
            8) validate_database_migration ;;
            9) check_migration_rollback_safety ;;
            0) return ;;
            *)
                print_error "Invalid choice. Please try again."
                continue
                ;;
        esac
        
        echo ""
        echo "Press any key to continue..."
        read -r
    done
}

handle_quality_menu() {
    while true; do
        show_quality_menu
        echo -ne "${YELLOW}Enter your choice (0-4): ${NC}"
        read -r choice
        
        case "$choice" in
            1) run_quality_checks ;;
            2) run_lint_checks ;;
            3) run_typecheck ;;
            4) fix_lint_issues ;;
            0) return ;;
            *)
                print_error "Invalid choice. Please try again."
                continue
                ;;
        esac
        
        echo ""
        echo "Press any key to continue..."
        read -r
    done
}

handle_security_menu() {
    while true; do
        show_security_menu
        echo -ne "${YELLOW}Enter your choice (0-3): ${NC}"
        read -r choice
        
        case "$choice" in
            1) run_security_audit ;;
            2) fix_security_issues ;;
            3) validate_security ;;
            0) return ;;
            *)
                print_error "Invalid choice. Please try again."
                continue
                ;;
        esac
        
        echo ""
        echo "Press any key to continue..."
        read -r
    done
}

run_oauth_e2e_tests() {
    print_section "Running OAuth E2E Tests"
    print_status "Executing OAuth flow validation tests..."
    npx playwright test \
        tests/oauth-validation.configured.spec.ts \
        tests/oauth-validation.security.spec.ts \
        tests/oauth-validation.unconfigured.spec.ts --reporter=line
    print_success "OAuth E2E tests completed"
}

handle_deployment_menu() {
    while true; do
        show_deployment_menu
        echo -ne "${YELLOW}Enter your choice (0-7): ${NC}"
        read -r choice
        
        case "$choice" in
            1) run_deployment_validation ;;
            2) validate_oauth_health ;;
            3) validate_database_migration ;;
            4) check_migration_rollback_safety ;;
            5) create_database_backup ;;
            6) run_oauth_e2e_tests ;;
            7) reset_oauth_rate_limits ;;
            0) return ;;
            *)
                print_error "Invalid choice. Please try again."
                continue
                ;;
        esac
        
        echo ""
        echo "Press any key to continue..."
        read -r
    done
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

main() {
    # Change to project root directory
    cd "$PROJECT_ROOT"
    
    # Check dependencies
    check_dependencies
    
    # Handle command line arguments
    if [[ $# -gt 0 ]]; then
        case "$1" in
            "start") start_services ;;
            "stop") stop_services ;;
            "restart") restart_services ;;
            "build") build_all ;;
            "test") run_all_tests ;;
            "quality") run_quality_checks ;;
            "security") run_security_audit ;;
            "status") show_service_status ;;
            "help"|"-h"|"--help") show_help ;;
            *)
                print_error "Unknown command: $1"
                print_status "Use '$0 help' for available commands"
                exit 1
                ;;
        esac
        exit 0
    fi
    
    # Interactive mode
    while true; do
        show_main_menu
        handle_main_menu
    done
}

# Run main function
main "$@"
