#!/bin/bash
#
# Generate TypeScript client from OpenAPI specification
#
# This script generates a type-safe TypeScript client for the Rust backend API
# using @hey-api/openapi-ts. The generated client provides full type safety
# and replaces the need for tRPC.
#
# Usage:
#   ./generate-client.sh [options]
#
# Options:
#   --url URL     Specify custom OpenAPI spec URL (default: http://localhost:4001/api/openapi.json)
#   --file FILE   Use local OpenAPI spec file instead of URL
#   --help        Show this help message
#

set -e

# Default configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
OUTPUT_DIR="$FRONTEND_DIR/src/api/generated"
DEFAULT_URL="http://localhost:4001/api/openapi.json"
OPENAPI_SOURCE="$DEFAULT_URL"
USE_FILE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    head -25 "$0" | tail -18
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --url)
            OPENAPI_SOURCE="$2"
            shift 2
            ;;
        --file)
            OPENAPI_SOURCE="$2"
            USE_FILE=true
            shift 2
            ;;
        --help|-h)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            ;;
    esac
done

# Check if we're in the correct directory structure
if [ ! -d "$FRONTEND_DIR" ]; then
    log_error "Frontend directory not found at: $FRONTEND_DIR"
    log_error "Please run this script from the loyalty-app repository root or backend-rust/scripts directory"
    exit 1
fi

# Change to frontend directory
cd "$FRONTEND_DIR"

# Check if @hey-api/openapi-ts is installed
if ! npm ls @hey-api/openapi-ts >/dev/null 2>&1; then
    log_warn "@hey-api/openapi-ts not found in dependencies"
    log_info "Installing @hey-api/openapi-ts as dev dependency..."
    npm install --save-dev @hey-api/openapi-ts @hey-api/client-fetch
fi

# Verify OpenAPI source is accessible
if [ "$USE_FILE" = true ]; then
    if [ ! -f "$OPENAPI_SOURCE" ]; then
        log_error "OpenAPI spec file not found: $OPENAPI_SOURCE"
        exit 1
    fi
    log_info "Using local OpenAPI spec: $OPENAPI_SOURCE"
else
    log_info "Checking if OpenAPI spec is available at: $OPENAPI_SOURCE"

    # Try to fetch the OpenAPI spec with a timeout
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$OPENAPI_SOURCE" 2>/dev/null || echo "000")

    if [ "$HTTP_STATUS" != "200" ]; then
        log_error "Cannot fetch OpenAPI spec from: $OPENAPI_SOURCE (HTTP status: $HTTP_STATUS)"
        log_error ""
        log_error "Make sure the Rust backend is running:"
        log_error "  cd $PROJECT_ROOT/backend-rust"
        log_error "  cargo run"
        log_error ""
        log_error "Or use a local file with: $0 --file /path/to/openapi.json"
        exit 1
    fi
    log_info "OpenAPI spec is available"
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Generate the TypeScript client
log_info "Generating TypeScript client..."
log_info "  Source: $OPENAPI_SOURCE"
log_info "  Output: $OUTPUT_DIR"

npx @hey-api/openapi-ts \
    -i "$OPENAPI_SOURCE" \
    -o "$OUTPUT_DIR" \
    -c @hey-api/client-fetch

# Check if generation was successful
if [ $? -eq 0 ] && [ -d "$OUTPUT_DIR" ]; then
    log_info "TypeScript client generated successfully!"
    log_info ""
    log_info "Generated files:"
    ls -la "$OUTPUT_DIR"
    log_info ""
    log_info "Usage in your React components:"
    log_info ""
    echo '  import { client, getUsers, createBooking } from "@/api/generated";'
    echo ''
    echo '  // Configure the client (do this once in your app initialization)'
    echo '  client.setConfig({'
    echo '    baseUrl: "http://localhost:4001/api",'
    echo '  });'
    echo ''
    echo '  // Use generated functions with full type safety'
    echo '  const users = await getUsers();'
    echo '  const booking = await createBooking({ body: { ... } });'
else
    log_error "Failed to generate TypeScript client"
    exit 1
fi
