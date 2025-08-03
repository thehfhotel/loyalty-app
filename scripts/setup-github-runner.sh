#!/bin/bash

# ============================================================================
# GitHub Self-Hosted Runner Setup Script
# ============================================================================
# This script installs and configures a GitHub Actions runner on your server
# Run this script ON YOUR SERVER, not on your dev machine
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
RUNNER_NAME="${RUNNER_NAME:-loyalty-app-runner}"
RUNNER_DIR="${HOME}/actions-runner"
RUNNER_VERSION="2.311.0"  # Update to latest version as needed

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Main setup
main() {
    log "🚀 GitHub Actions Self-Hosted Runner Setup"
    echo "=============================================="
    
    # Check if running on server (not dev machine)
    if [[ "$(hostname)" == *"local"* ]] || [[ "$(hostname)" == *"MacBook"* ]]; then
        warning "This script should be run on your production server, not dev machine!"
        read -p "Continue anyway? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    # Get repository information
    log "📝 Please provide your GitHub repository information:"
    read -p "GitHub username or organization: " GITHUB_USER
    read -p "Repository name: " REPO_NAME
    
    log "🔑 Getting runner registration token..."
    echo ""
    echo "To get your runner token:"
    echo "1. Go to: https://github.com/${GITHUB_USER}/${REPO_NAME}/settings/actions/runners"
    echo "2. Click 'New self-hosted runner'"
    echo "3. Copy the token from the configuration section"
    echo ""
    read -p "Enter runner registration token: " RUNNER_TOKEN
    
    # Check prerequisites
    log "🔍 Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is required but not installed. Please install Docker first."
    fi
    
    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        error "Docker Compose is required but not installed."
    fi
    
    success "Prerequisites check passed"
    
    # Create runner directory
    log "📁 Creating runner directory..."
    mkdir -p "$RUNNER_DIR"
    cd "$RUNNER_DIR"
    
    # Download runner
    log "📥 Downloading GitHub Actions runner..."
    curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz -L \
        https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
    
    # Extract runner
    log "📦 Extracting runner..."
    tar xzf ./actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
    rm actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
    
    # Configure runner
    log "⚙️ Configuring runner..."
    ./config.sh --url "https://github.com/${GITHUB_USER}/${REPO_NAME}" \
        --token "${RUNNER_TOKEN}" \
        --name "${RUNNER_NAME}" \
        --labels "self-hosted,Linux,X64,production" \
        --work "_work" \
        --unattended \
        --replace
    
    # Install as service
    log "🔧 Installing runner as service..."
    sudo ./svc.sh install
    
    # Start service
    log "▶️ Starting runner service..."
    sudo ./svc.sh start
    
    # Check status
    log "📊 Checking runner status..."
    sudo ./svc.sh status
    
    # Create helper scripts
    log "📝 Creating helper scripts..."
    
    # Create start script
    cat > "${HOME}/start-runner.sh" << 'EOF'
#!/bin/bash
cd "${HOME}/actions-runner"
sudo ./svc.sh start
sudo ./svc.sh status
EOF
    chmod +x "${HOME}/start-runner.sh"
    
    # Create stop script
    cat > "${HOME}/stop-runner.sh" << 'EOF'
#!/bin/bash
cd "${HOME}/actions-runner"
sudo ./svc.sh stop
EOF
    chmod +x "${HOME}/stop-runner.sh"
    
    # Create logs script
    cat > "${HOME}/runner-logs.sh" << 'EOF'
#!/bin/bash
cd "${HOME}/actions-runner"
tail -f _diag/Runner_*.log
EOF
    chmod +x "${HOME}/runner-logs.sh"
    
    # Final instructions
    echo ""
    echo "=============================================="
    success "🎉 GitHub Actions runner installed successfully!"
    echo ""
    echo "📋 Runner Information:"
    echo "   Name: ${RUNNER_NAME}"
    echo "   Location: ${RUNNER_DIR}"
    echo "   Status: Running as service"
    echo ""
    echo "🔧 Useful commands:"
    echo "   Start runner: ${HOME}/start-runner.sh"
    echo "   Stop runner: ${HOME}/stop-runner.sh"
    echo "   View logs: ${HOME}/runner-logs.sh"
    echo "   Check status: sudo ${HOME}/actions-runner/svc.sh status"
    echo ""
    echo "📌 Next steps:"
    echo "1. Go to: https://github.com/${GITHUB_USER}/${REPO_NAME}/settings/actions/runners"
    echo "2. Verify the runner appears as 'Idle'"
    echo "3. Push to main branch to trigger deployment"
    echo ""
    echo "⚠️ Important:"
    echo "- Runner will start automatically on server reboot"
    echo "- Keep your server firewall configured (no new ports needed)"
    echo "- Runner connects outbound to GitHub (no inbound required)"
    echo "=============================================="
}

# Run main function
main "$@"