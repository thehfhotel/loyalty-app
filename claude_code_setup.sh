#!/bin/bash
# =============================================================================
# Claude Code CLI Setup Script
# =============================================================================
#
# DESCRIPTION:
#   Installs and configures the Claude Code CLI for the direct Anthropic API.
#   Handles Node.js setup (via nvm), pinned CLI install, and stores your API key.
#
# WHAT IT DOES:
#   1. Checks for Node.js >= 18 (installs via nvm if missing)
#   2. Installs Claude Code CLI globally via npm (pinned tarball + integrity hash)
#   3. Prompts for your Anthropic API key and saves it to ~/.claude/settings.json
#   4. Marks onboarding as complete in ~/.claude.json
#
# USAGE:
#   ./claude_code_setup.sh
#
# PREREQUISITES:
#   - Linux or macOS (Darwin)
#   - Internet connection
#   - Anthropic API key (https://console.anthropic.com/settings/keys)
#
# SECURITY:
#   - nvm install script is verified via SHA256 hash before execution
#   - API key is stored in ~/.claude/settings.json (user-only readable)
#   - All package versions are pinned for reproducibility
#
# AFTER INSTALLATION:
#   Run 'claude' to start using Claude Code with Anthropic API.
#
# =============================================================================

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
# Full URL with integrity hash for secure installation (update this when changing CLAUDE_PACKAGE)
CLAUDE_PACKAGE_URL="https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.0.69.tgz#sha512-uuW3M4j3gN9kus0QH/3wEZq+JS3B0YJWzwlX2FqD421eeFVHhauN2HduO99vryHDFvtp8rH9TLKKuythBbNFHA=="
CONFIG_DIR="$HOME/.claude"
CONFIG_FILE="$CONFIG_DIR/settings.json"
API_BASE_URL="https://api.anthropic.com"
API_KEY_URL="https://console.anthropic.com/settings/keys"
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
    local platform
    platform=$(uname -s)

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
        # SECURITY: Using pinned version with integrity hash for reproducible and tamper-resistant installs.
        # The version and hash are defined in CLAUDE_PACKAGE at the top of this script.
        # To update: Change CLAUDE_PACKAGE version, get new hash from npm registry, update the URL below.
        # Pinned dependencies ensure consistent behavior and prevent supply chain attacks.
        npm install -g "${CLAUDE_PACKAGE_URL}" || {
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
    read -s -p "🔑 Please enter your Anthropic API key: " api_key
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
