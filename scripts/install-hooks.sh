#!/bin/bash

# Install Git Hooks Script
# Copies hooks from scripts/hooks to .git/hooks and makes them executable

echo "🔧 Installing Git Hooks..."

# Create scripts/hooks directory if it doesn't exist
mkdir -p scripts/hooks

# Copy hooks to scripts/hooks directory for version control
if [ -f ".git/hooks/pre-commit" ]; then
    cp .git/hooks/pre-commit scripts/hooks/pre-commit
    echo "✅ Pre-commit hook backed up to scripts/hooks/"
fi

if [ -f ".git/hooks/pre-push" ]; then
    cp .git/hooks/pre-push scripts/hooks/pre-push
    echo "✅ Pre-push hook backed up to scripts/hooks/"
fi

# Install hooks from scripts/hooks if they exist
if [ -f "scripts/hooks/pre-commit" ]; then
    cp scripts/hooks/pre-commit .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✅ Pre-commit hook installed"
fi

if [ -f "scripts/hooks/pre-push" ]; then
    cp scripts/hooks/pre-push .git/hooks/pre-push
    chmod +x .git/hooks/pre-push
    echo "✅ Pre-push hook installed"
fi

echo ""
echo "🎉 Git hooks installed successfully!"
echo ""
echo "📋 Installed hooks:"
echo "  • pre-commit: Quick TypeScript and lint checks"
echo "  • pre-push: Full quality gate (tests, lint, typecheck, build)"
echo ""
echo "💡 Tips:"
echo "  • Run 'npm run pre-push' to test the quality gate manually"
echo "  • Use 'git push --no-verify' to bypass hooks in emergencies"
echo "  • Hooks ensure code quality and prevent broken code in repository"