#!/bin/bash

# Production Management Launcher Script
# Usage: ./scripts/production.sh [start|stop|restart|backup|validate] [options]
# This is a convenient launcher for all production management scripts

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_help() {
    echo -e "${BLUE}Loyalty App Production Management${NC}"
    echo "=================================="
    echo
    echo "Usage: $0 <command> [options]"
    echo
    echo "Commands:"
    echo "  ${GREEN}validate${NC}  - Validate production environment"
    echo "  ${GREEN}start${NC}     - Start production system"
    echo "  ${GREEN}stop${NC}      - Stop production system"
    echo "  ${GREEN}restart${NC}   - Restart production system"
    echo "  ${GREEN}backup${NC}    - Create production backup"
    echo "  ${GREEN}status${NC}    - Show system status"
    echo "  ${GREEN}logs${NC}      - Show system logs"
    echo "  ${GREEN}help${NC}      - Show this help message"
    echo
    echo "Examples:"
    echo "  $0 validate"
    echo "  $0 start"
    echo "  $0 stop --force"
    echo "  $0 restart --backup --rebuild"
    echo "  $0 backup --compress"
    echo "  $0 status"
    echo "  $0 logs backend"
    echo
    echo "For detailed help on each command, run:"
    echo "  $0 <command> --help"
    echo
}

show_status() {
    echo -e "${BLUE}Production System Status${NC}"
    echo "========================"
    echo
    if docker-compose ps -q | head -1 | grep -q .; then
        docker-compose ps
        echo
        echo -e "${BLUE}Resource Usage:${NC}"
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
    else
        echo -e "${YELLOW}No containers are running${NC}"
    fi
}

show_logs() {
    local service=${1:-""}
    
    if [[ -n "$service" ]]; then
        echo -e "${BLUE}Logs for service: $service${NC}"
        docker-compose logs -f "$service"
    else
        echo -e "${BLUE}All system logs:${NC}"
        docker-compose logs -f
    fi
}

# Check if we have at least one argument
if [[ $# -eq 0 ]]; then
    show_help
    exit 1
fi

# Get command
COMMAND="$1"
shift

# Route to appropriate script
case "$COMMAND" in
    validate|check)
        exec "$SCRIPT_DIR/validate-environment.sh" "$@"
        ;;
    start|up)
        exec "$SCRIPT_DIR/start-production.sh" "$@"
        ;;
    stop|down)
        exec "$SCRIPT_DIR/stop-production.sh" "$@"
        ;;
    restart|reload)
        exec "$SCRIPT_DIR/restart-production.sh" "$@"
        ;;
    backup)
        exec "$SCRIPT_DIR/backup-production.sh" "$@"
        ;;
    status|ps)
        show_status
        ;;
    logs|log)
        show_logs "$@"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
        echo
        show_help
        exit 1
        ;;
esac