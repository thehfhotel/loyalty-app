#!/bin/bash

# Script to run the registration flow tests
set -e

echo "🚀 Starting Hotel Loyalty App Registration Tests"
echo "================================================="

# Navigate to test directory
cd "$(dirname "$0")"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing test dependencies..."
    npm install
fi

# Install Playwright browsers if not already installed
echo "🌐 Installing Playwright browsers..."
npx playwright install --with-deps

# Check if the app is running
echo "🔍 Checking if the app is running..."
if ! curl -s http://192.168.100.228:3010 > /dev/null; then
    echo "❌ App is not running at http://192.168.100.228:3010"
    echo "Please start the app with: docker-compose up -d"
    exit 1
fi

echo "✅ App is running!"

# Run the registration tests
echo "🧪 Running registration flow tests..."
echo "======================================"

# Run tests with different options based on arguments
if [ "$1" = "--headed" ]; then
    echo "Running tests in headed mode..."
    npx playwright test --headed
elif [ "$1" = "--debug" ]; then
    echo "Running tests in debug mode..."
    npx playwright test --debug
elif [ "$1" = "--ui" ]; then
    echo "Running tests in UI mode..."
    npx playwright test --ui
else
    echo "Running tests in headless mode..."
    npx playwright test
fi

echo ""
echo "✅ Tests completed!"
echo "📊 Test results are available in playwright-report/"
echo ""
echo "To view the HTML report, run:"
echo "npx playwright show-report"