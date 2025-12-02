#!/bin/bash
# rebuild-node-pty.sh
# Automatically switch Node.js version and rebuild node-pty for Obsidian's Electron
#
# Usage: ./scripts/rebuild-node-pty.sh
#
# This script will:
# 1. Detect the required NODE_MODULE_VERSION from Obsidian's Electron
# 2. Find or install the matching Node.js version via nvm
# 3. Rebuild node-pty with @electron/rebuild
# 4. Switch back to original Node.js version

set -e

# Configuration
ELECTRON_VERSION="${ELECTRON_VERSION:-37.10.2}"
TARGET_ABI="${TARGET_ABI:-136}"
SKIP_RESTORE="${SKIP_RESTORE:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

info() { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# NODE_MODULE_VERSION to Node.js version mapping
declare -A ABI_TO_NODE=(
    ["127"]="22"
    ["131"]="23"
    ["132"]="23"
    ["133"]="24"
    ["135"]="24"
    ["136"]="24"
)

echo ""
echo -e "${MAGENTA}============================================${NC}"
echo -e "${MAGENTA}  node-pty Rebuild Script for Obsidian${NC}"
echo -e "${MAGENTA}============================================${NC}"
echo ""

# Step 1: Get current Node.js version
info "Detecting current Node.js version..."
ORIGINAL_VERSION=""

if command -v nvm &> /dev/null; then
    ORIGINAL_VERSION=$(nvm current 2>/dev/null | sed 's/^v//')
elif command -v node &> /dev/null; then
    ORIGINAL_VERSION=$(node --version | sed 's/^v//')
fi

if [ -n "$ORIGINAL_VERSION" ]; then
    success "Current Node.js version: $ORIGINAL_VERSION"
fi

# Step 2: Determine target Node.js major version
TARGET_MAJOR="${ABI_TO_NODE[$TARGET_ABI]}"
if [ -z "$TARGET_MAJOR" ]; then
    error "Unknown ABI version: $TARGET_ABI"
    info "Supported ABI versions: ${!ABI_TO_NODE[*]}"
    exit 1
fi
info "Target ABI: $TARGET_ABI (Node.js $TARGET_MAJOR.x)"

# Step 3: Load nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v nvm &> /dev/null; then
    error "nvm is not installed. Please install nvm first."
    info "Visit: https://github.com/nvm-sh/nvm"
    exit 1
fi

# Step 4: Install target Node.js if needed
info "Checking installed Node.js versions..."
TARGET_VERSION=$(nvm ls --no-colors 2>/dev/null | grep -oP "v$TARGET_MAJOR\.\d+\.\d+" | head -1 | sed 's/^v//')

if [ -z "$TARGET_VERSION" ]; then
    warn "Node.js $TARGET_MAJOR.x is not installed"
    info "Installing Node.js $TARGET_MAJOR (latest)..."
    nvm install "$TARGET_MAJOR"
    TARGET_VERSION=$(nvm ls --no-colors 2>/dev/null | grep -oP "v$TARGET_MAJOR\.\d+\.\d+" | head -1 | sed 's/^v//')
fi

success "Target Node.js version: $TARGET_VERSION"

# Step 5: Switch to target Node.js version
info "Switching to Node.js $TARGET_VERSION..."
nvm use "$TARGET_VERSION"
success "Now using Node.js $(node --version)"

# Step 6: Navigate to project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
info "Project directory: $PROJECT_DIR"
cd "$PROJECT_DIR"

# Step 7: Fix Electron headers
echo ""
info "Step 1/4: Fixing Electron headers..."
node scripts/fix-electron-headers.mjs "$ELECTRON_VERSION"

# Step 8: Fix winpty.cc (Windows only, skip on Unix)
info "Step 2/4: Fixing winpty.cc (skipped on Unix)..."

# Step 9: Rebuild node-pty
echo ""
info "Step 3/4: Rebuilding node-pty for Electron $ELECTRON_VERSION..."
npx @electron/rebuild -m node_modules/node-pty -v "$ELECTRON_VERSION"

# Step 10: Copy binaries
info "Step 4/4: Copying binaries to pnpm directory..."
node scripts/copy-node-pty-binaries.mjs

# Step 11: Verify the build
echo ""
info "Verifying build..."

RELEASE_DIR="node_modules/node-pty/build/Release"
if [ -f "$RELEASE_DIR/pty.node" ]; then
    SIZE=$(du -k "$RELEASE_DIR/pty.node" | cut -f1)
    success "Found pty.node (${SIZE} KB)"
else
    warn "Missing: pty.node"
fi

# Step 12: Restore original Node.js version
if [ "$SKIP_RESTORE" != "true" ] && [ -n "$ORIGINAL_VERSION" ]; then
    echo ""
    info "Restoring original Node.js version: $ORIGINAL_VERSION"
    nvm use "$ORIGINAL_VERSION"
    success "Restored to Node.js $(node --version)"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Rebuild Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
info "Next steps:"
echo "  1. Run 'npm run build' to build the plugin"
echo "  2. Reload Obsidian to test the terminal plugin"
echo ""
