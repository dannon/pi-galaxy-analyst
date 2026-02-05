#!/usr/bin/env bash
#
# Pi-Galaxy-Analyst Installer
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/galaxyproject/pi-galaxy-analyst/main/install.sh | bash
#
# Or download and run:
#   chmod +x install.sh && ./install.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Pi-Galaxy-Analyst Installer            ║${NC}"
echo -e "${GREEN}║     Galaxy Co-Scientist for Bioinformatics ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
info "Checking prerequisites..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    error "Node.js is required but not installed. Please install Node.js 18+ from https://nodejs.org/"
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ is required. You have $(node -v). Please upgrade."
fi
success "Node.js $(node -v) found"

# Check for npm
if ! command -v npm &> /dev/null; then
    error "npm is required but not installed."
fi
success "npm $(npm -v) found"

# Check for Python/uv (for galaxy-mcp)
if command -v uv &> /dev/null; then
    success "uv found (for galaxy-mcp)"
    PYTHON_TOOL="uv"
elif command -v python3 &> /dev/null; then
    success "python3 found (for galaxy-mcp)"
    PYTHON_TOOL="python3"
else
    warn "Neither uv nor python3 found. galaxy-mcp may need manual setup."
    PYTHON_TOOL=""
fi

# Check if Pi is installed
if ! command -v pi &> /dev/null; then
    info "Pi coding agent not found. Installing..."
    npm install -g @mariozechner/pi-coding-agent
    success "Pi coding agent installed"
else
    success "Pi coding agent found"
fi

# Check if pi-mcp-adapter is installed
PI_DIR="$HOME/.pi/agent"
if [ ! -d "$PI_DIR" ]; then
    mkdir -p "$PI_DIR"
fi

info "Installing pi-mcp-adapter..."
pi install npm:pi-mcp-adapter 2>/dev/null || {
    warn "pi-mcp-adapter install via pi failed, trying npm..."
    npm install -g pi-mcp-adapter 2>/dev/null || warn "Could not install pi-mcp-adapter globally"
}

# Clone/update pi-galaxy-analyst
INSTALL_DIR="$HOME/.pi-galaxy-analyst"
info "Installing pi-galaxy-analyst..."

if [ -d "$INSTALL_DIR" ]; then
    info "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || warn "Could not update, using existing version"
else
    git clone https://github.com/galaxyproject/pi-galaxy-analyst.git "$INSTALL_DIR" 2>/dev/null || {
        # If repo doesn't exist yet, use local copy if available
        if [ -d "$(dirname "$0")" ] && [ -f "$(dirname "$0")/package.json" ]; then
            info "Using local installation..."
            cp -r "$(dirname "$0")" "$INSTALL_DIR"
        else
            error "Could not clone pi-galaxy-analyst. Repository may not be public yet."
        fi
    }
fi

# Install the Pi package
info "Registering with Pi..."
pi install "git:$INSTALL_DIR" 2>/dev/null || {
    # Fallback: symlink to Pi skills directory
    mkdir -p "$PI_DIR/skills"
    ln -sf "$INSTALL_DIR/skills/"* "$PI_DIR/skills/" 2>/dev/null || true
    mkdir -p "$PI_DIR/extensions"
    ln -sf "$INSTALL_DIR/extensions/"* "$PI_DIR/extensions/" 2>/dev/null || true
    success "Installed via symlinks"
}

# Clone/update galaxy-mcp
GALAXY_MCP_DIR="$HOME/.galaxy-mcp"
info "Setting up galaxy-mcp..."

if [ -d "$GALAXY_MCP_DIR" ]; then
    info "galaxy-mcp already installed"
else
    git clone https://github.com/galaxyproject/galaxy-mcp.git "$GALAXY_MCP_DIR" 2>/dev/null || {
        warn "Could not clone galaxy-mcp. You'll need to set it up manually."
        GALAXY_MCP_DIR=""
    }
fi

# Create MCP configuration
MCP_CONFIG="$PI_DIR/mcp.json"
if [ -n "$GALAXY_MCP_DIR" ] && [ ! -f "$MCP_CONFIG" ]; then
    info "Creating MCP configuration..."
    cat > "$MCP_CONFIG" << EOF
{
  "mcpServers": {
    "galaxy": {
      "command": "uv",
      "args": ["run", "--directory", "$GALAXY_MCP_DIR", "galaxy-mcp"],
      "lifecycle": "lazy",
      "directTools": [
        "connect", "get_histories", "create_history",
        "get_history_contents", "get_dataset_details",
        "upload_file", "search_tools_by_name",
        "get_tool_details", "run_tool", "get_job_details",
        "recommend_iwc_workflows", "invoke_workflow",
        "get_invocations"
      ]
    }
  }
}
EOF
    success "MCP configuration created at $MCP_CONFIG"
elif [ -f "$MCP_CONFIG" ]; then
    warn "MCP config already exists at $MCP_CONFIG - not overwriting"
fi

# Create a launcher script
LAUNCHER="$HOME/.local/bin/galaxy-analyst"
mkdir -p "$HOME/.local/bin"

cat > "$LAUNCHER" << 'EOF'
#!/usr/bin/env bash
#
# Galaxy Analyst - Launch Pi with Galaxy co-scientist configuration
#

# Check for Galaxy credentials
if [ -z "$GALAXY_URL" ] || [ -z "$GALAXY_API_KEY" ]; then
    # Check config file
    CONFIG_FILE="$HOME/.galaxy-analyst.env"
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
    fi
fi

# If still no credentials, prompt for them
if [ -z "$GALAXY_URL" ] || [ -z "$GALAXY_API_KEY" ]; then
    echo ""
    echo "╔════════════════════════════════════════════╗"
    echo "║     Galaxy Analyst - First Time Setup      ║"
    echo "╚════════════════════════════════════════════╝"
    echo ""
    echo "I need your Galaxy credentials to connect."
    echo ""

    read -p "Galaxy Server URL [https://usegalaxy.org]: " GALAXY_URL
    GALAXY_URL="${GALAXY_URL:-https://usegalaxy.org}"

    echo ""
    echo "To get your API key:"
    echo "  1. Log into $GALAXY_URL"
    echo "  2. Go to User → Preferences → Manage API Key"
    echo "  3. Create a new key if needed, then copy it"
    echo ""

    read -p "Galaxy API Key: " GALAXY_API_KEY

    if [ -z "$GALAXY_API_KEY" ]; then
        echo "Error: API key is required"
        exit 1
    fi

    # Save for next time
    echo ""
    read -p "Save credentials for future sessions? [Y/n]: " SAVE_CREDS
    SAVE_CREDS="${SAVE_CREDS:-Y}"

    if [[ "$SAVE_CREDS" =~ ^[Yy] ]]; then
        cat > "$HOME/.galaxy-analyst.env" << ENVEOF
export GALAXY_URL="$GALAXY_URL"
export GALAXY_API_KEY="$GALAXY_API_KEY"
ENVEOF
        chmod 600 "$HOME/.galaxy-analyst.env"
        echo "Credentials saved to ~/.galaxy-analyst.env"
    fi

    echo ""
fi

export GALAXY_URL
export GALAXY_API_KEY

echo ""
echo "Starting Galaxy Analyst..."
echo "Connected to: $GALAXY_URL"
echo ""
echo "Tips:"
echo "  - Say 'I want to analyze RNA-seq data' to start"
echo "  - Use /plan to see your analysis plan"
echo "  - Type /help for more commands"
echo ""

# Launch Pi
exec pi "$@"
EOF

chmod +x "$LAUNCHER"
success "Launcher created at $LAUNCHER"

# Add to PATH reminder
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    warn "Add ~/.local/bin to your PATH to use 'galaxy-analyst' command"
    echo ""
    echo "Add this to your ~/.bashrc or ~/.zshrc:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

# Done!
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Installation Complete!                 ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "To start Galaxy Analyst:"
echo ""
echo "  galaxy-analyst"
echo ""
echo "Or if ~/.local/bin is not in PATH:"
echo ""
echo "  ~/.local/bin/galaxy-analyst"
echo ""
echo "The first time you run it, you'll be asked for your Galaxy"
echo "server URL and API key."
echo ""
echo "Happy analyzing! 🧬"
echo ""
