#!/bin/bash

set -euo pipefail

# ========================
#       Define Constants
# ========================
SCRIPT_NAME=$(basename "$0")
NODE_MIN_VERSION=18
NODE_INSTALL_VERSION=22
NVM_VERSION="v0.40.3"
NVM_INSTALL_SHA256="2d8359a64a3cb07c02389ad88ceecd43f2fa469c06104f92f98df5b6f315275f"
CLAUDE_PACKAGE="@anthropic-ai/claude-code@2.0.69"
CONFIG_DIR="$HOME/.claude"
CONFIG_FILE="$CONFIG_DIR/settings.json"
API_BASE_URL="https://api.z.ai/api/anthropic"
API_KEY_URL="https://z.ai/manage-apikey/apikey-list"
API_TIMEOUT_MS=3000000

# ========================
#       Functions
# ========================

log_info() {
    echo "🔹 $*"
}

log_success() {
    echo "✅ $*"
}

log_error() {
    echo "❌ $*" >&2
}

ensure_dir_exists() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" || {
            log_error "Failed to create directory: $dir"
            exit 1
        }
    fi
}

# ========================
#     Node.js Installation
# ========================

install_nodejs() {
    local platform=$(uname -s)

    case "$platform" in
        Linux|Darwin)
            log_info "Installing Node.js on $platform..."

            # Install nvm with integrity verification
            log_info "Installing nvm ($NVM_VERSION)..."
            local nvm_script
            nvm_script=$(mktemp)
            curl -sL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" -o "$nvm_script"

            # Verify SHA256 hash before execution
            local actual_hash
            actual_hash=$(sha256sum "$nvm_script" | cut -d' ' -f1)
            if [ "$actual_hash" != "$NVM_INSTALL_SHA256" ]; then
                rm -f "$nvm_script"
                log_error "nvm install script hash mismatch!"
                log_error "Expected: $NVM_INSTALL_SHA256"
                log_error "Got: $actual_hash"
                exit 1
            fi
            log_info "Hash verified: $actual_hash"
            bash "$nvm_script"
            rm -f "$nvm_script"

            # Load nvm
            log_info "Loading nvm environment..."
            \. "$HOME/.nvm/nvm.sh"

            # Install Node.js
            log_info "Installing Node.js $NODE_INSTALL_VERSION..."
            nvm install "$NODE_INSTALL_VERSION"

            # Verify installation
            node -v &>/dev/null || {
                log_error "Node.js installation failed"
                exit 1
            }
            log_success "Node.js installed: $(node -v)"
            log_success "npm version: $(npm -v)"
            ;;
        *)
            log_error "Unsupported platform: $platform"
            exit 1
            ;;
    esac
}

# ========================
#     Node.js Check
# ========================

check_nodejs() {
    if command -v node &>/dev/null; then
        current_version=$(node -v | sed 's/v//')
        major_version=$(echo "$current_version" | cut -d. -f1)

        if [ "$major_version" -ge "$NODE_MIN_VERSION" ]; then
            log_success "Node.js is already installed: v$current_version"
            return 0
        else
            log_info "Node.js v$current_version is installed but version < $NODE_MIN_VERSION. Upgrading..."
            install_nodejs
        fi
    else
        log_info "Node.js not found. Installing..."
        install_nodejs
    fi
}

# ========================
#     Claude Code Installation
# ========================

install_claude_code() {
    if command -v claude &>/dev/null; then
        log_success "Claude Code is already installed: $(claude --version)"
    else
        log_info "Installing Claude Code..."
        npm install -g "$CLAUDE_PACKAGE" || {
            log_error "Failed to install claude-code"
            exit 1
        }
        log_success "Claude Code installed successfully"
    fi
}

configure_claude_json(){
  node --eval '
      const os = require("os");
      const fs = require("fs");
      const path = require("path");

      const homeDir = os.homedir();
      const filePath = path.join(homeDir, ".claude.json");
      if (fs.existsSync(filePath)) {
          const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          fs.writeFileSync(filePath, JSON.stringify({ ...content, hasCompletedOnboarding: true }, null, 2), "utf-8");
      } else {
          fs.writeFileSync(filePath, JSON.stringify({ hasCompletedOnboarding: true }, null, 2), "utf-8");
      }'
}

# ========================
#     API Key Configuration
# ========================

configure_claude() {
    log_info "Configuring Claude Code..."
    echo "   You can get your API key from: $API_KEY_URL"
    read -s -p "🔑 Please enter your Z.AI API key: " api_key
    echo

    if [ -z "$api_key" ]; then
        log_error "API key cannot be empty. Please run the script again."
        exit 1
    fi

    ensure_dir_exists "$CONFIG_DIR"

    # Write settings.json
    node --eval '
        const os = require("os");
        const fs = require("fs");
        const path = require("path");

        const homeDir = os.homedir();
        const filePath = path.join(homeDir, ".claude", "settings.json");
        const apiKey = "'"$api_key"'";

        const content = fs.existsSync(filePath)
            ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
            : {};

        fs.writeFileSync(filePath, JSON.stringify({
            ...content,
            env: {
                ANTHROPIC_AUTH_TOKEN: apiKey,
                ANTHROPIC_BASE_URL: "'"$API_BASE_URL"'",
                API_TIMEOUT_MS: "'"$API_TIMEOUT_MS"'",
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
            }
        }, null, 2), "utf-8");
    ' || {
        log_error "Failed to write settings.json"
        exit 1
    }

    log_success "Claude Code configured successfully"
}

# ========================
#        Main
# ========================

main() {
    echo "🚀 Starting $SCRIPT_NAME"

    check_nodejs
    install_claude_code
    configure_claude_json
    configure_claude

    echo ""
    log_success "🎉 Installation completed successfully!"
    echo ""
    echo "🚀 You can now start using Claude Code with:"
    echo "   claude"
}

main "$@"
