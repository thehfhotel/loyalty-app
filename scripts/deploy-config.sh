#!/bin/bash

# ============================================================================
# Deployment Configuration Helper
# ============================================================================
# This script helps configure GitHub secrets for deployment
# Run this on your DEV MACHINE
# ============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[NOTE]${NC} $1"
}

main() {
    echo "======================================"
    echo "🔧 GitHub Deployment Configuration"
    echo "======================================"
    echo ""
    
    log "This script will help you set up GitHub secrets for deployment."
    echo ""
    
    # Check if gh CLI is installed
    if command -v gh &> /dev/null; then
        log "GitHub CLI detected. Setting up secrets automatically..."
        
        # Check if authenticated
        if ! gh auth status &>/dev/null; then
            warning "Please authenticate with GitHub CLI first:"
            echo "  gh auth login"
            exit 1
        fi
        
        # Load .env.production if exists
        if [ -f .env.production ]; then
            log "Loading secrets from .env.production..."
            
            # Read .env.production and set as GitHub secrets
            while IFS='=' read -r key value; do
                # Skip comments and empty lines
                [[ "$key" =~ ^#.*$ ]] && continue
                [[ -z "$key" ]] && continue
                
                # Remove quotes from value
                value="${value%\"}"
                value="${value#\"}"
                
                # Set as GitHub secret
                echo "Setting secret: $key"
                echo "$value" | gh secret set "$key" 2>/dev/null || true
            done < .env.production
            
            success "Secrets configured via GitHub CLI!"
        else
            warning ".env.production not found. Please create it first."
        fi
    else
        warning "GitHub CLI not installed. Please set secrets manually."
        echo ""
        echo "Manual Setup Instructions:"
        echo "=========================="
        echo ""
        echo "1. Go to your repository on GitHub"
        echo "2. Navigate to Settings → Secrets and variables → Actions"
        echo "3. Add these secrets:"
        echo ""
        echo "Required Secrets:"
        echo "  - DATABASE_URL: postgresql://loyalty:password@postgres:5432/loyalty_db"
        echo "  - JWT_SECRET: (generate with: openssl rand -base64 32)"
        echo "  - JWT_REFRESH_SECRET: (generate with: openssl rand -base64 32)"
        echo "  - SESSION_SECRET: (generate with: openssl rand -base64 32)"
        echo "  - REDIS_URL: redis://redis:6379"
        echo ""
        echo "OAuth Secrets (if using):"
        echo "  - GOOGLE_CLIENT_ID"
        echo "  - GOOGLE_CLIENT_SECRET"
        echo "  - FACEBOOK_APP_ID"
        echo "  - FACEBOOK_APP_SECRET"
        echo "  - LINE_CLIENT_ID"
        echo "  - LINE_CLIENT_SECRET"
        echo ""
        echo "To install GitHub CLI:"
        echo "  brew install gh  # macOS"
        echo "  sudo apt install gh  # Ubuntu/Debian"
    fi
    
    echo ""
    echo "======================================"
    echo "📋 Deployment Checklist"
    echo "======================================"
    echo ""
    echo "On your DEV MACHINE:"
    echo "  ✓ GitHub secrets configured"
    echo "  ✓ .github/workflows/deploy.yml created"
    echo "  ✓ Ready to push to GitHub"
    echo ""
    echo "On your SERVER:"
    echo "  □ Run: bash scripts/setup-github-runner.sh"
    echo "  □ Verify runner appears in GitHub settings"
    echo "  □ Ensure Docker and Docker Compose installed"
    echo "  □ Create the deployment directory (default: /srv/loyalty-app-<env>; override via DEPLOY_ROOT)"
    echo ""
    echo "Testing:"
    echo "  □ Push to main branch"
    echo "  □ Check Actions tab in GitHub"
    echo "  □ Verify deployment succeeded"
    echo ""
    success "Configuration helper completed!"
}

main "$@"