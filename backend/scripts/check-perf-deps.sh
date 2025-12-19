#!/bin/bash
# check-perf-deps.sh - Check if performance testing dependencies are installed

set -e

echo "========================================="
echo "Performance Testing Dependencies Check"
echo "========================================="
echo ""

# Check for k6
echo "Checking for k6..."
if command -v k6 &> /dev/null; then
    K6_VERSION=$(k6 version | head -n 1)
    echo "✓ k6 is installed: $K6_VERSION"
else
    echo "✗ k6 is NOT installed"
    echo ""
    echo "To install k6, visit: https://k6.io/docs/get-started/installation/"
    echo ""
    echo "Quick install options:"
    echo ""
    echo "  macOS (Homebrew):"
    echo "    brew install k6"
    echo ""
    echo "  Debian/Ubuntu:"
    echo "    sudo gpg -k"
    echo "    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69"
    echo "    echo 'deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main' | sudo tee /etc/apt/sources.list.d/k6.list"
    echo "    sudo apt-get update"
    echo "    sudo apt-get install k6"
    echo ""
    echo "  Fedora/CentOS:"
    echo "    sudo dnf install https://dl.k6.io/rpm/repo.rpm"
    echo "    sudo dnf install k6"
    echo ""
    echo "  Docker:"
    echo "    docker pull grafana/k6:latest"
    echo ""
    K6_MISSING=1
fi

echo ""

# Check for psql (optional, for debugging)
echo "Checking for psql (optional, for debugging)..."
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version)
    echo "✓ psql is installed: $PSQL_VERSION"
else
    echo "✗ psql is NOT installed (optional)"
    echo "  psql is useful for debugging database issues during performance tests"
    echo "  Install PostgreSQL client tools if needed"
fi

echo ""
echo "========================================="

if [ -n "$K6_MISSING" ]; then
    echo "Status: Missing required dependencies"
    echo "========================================="
    exit 1
else
    echo "Status: All required dependencies installed"
    echo "========================================="
    exit 0
fi
