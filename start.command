#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  NexLink — Mac launcher
#  Double-click this file to start NexLink.
#  First run installs everything automatically (~30 seconds).
# ─────────────────────────────────────────────────────────────

# Get the directory this script lives in
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Open a visible Terminal window that runs this script
if [ "$TERM_PROGRAM" != "Apple_Terminal" ] && [ "$TERM_PROGRAM" != "iTerm.app" ] && [ -z "$NEXLINK_LAUNCHED" ]; then
  export NEXLINK_LAUNCHED=1
  osascript -e "tell application \"Terminal\"
    activate
    do script \"export NEXLINK_LAUNCHED=1 && bash '$DIR/start.command'\"
  end tell"
  exit 0
fi

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║           NexLink Launcher               ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── CHECK / INSTALL NODE ──────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  ⚠  Node.js not found. Installing via Homebrew..."
  echo ""

  if ! command -v brew &>/dev/null; then
    echo "  Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for Apple Silicon
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  fi

  brew install node
  echo ""
fi

NODE_VER=$(node -v)
echo "  ✓  Node.js $NODE_VER"

# ── INSTALL DEPENDENCIES IF NEEDED ───────────────────────────
if [ ! -d "$DIR/node_modules" ] || [ ! -f "$DIR/node_modules/.install-done" ]; then
  echo "  ⬇  Installing dependencies (first run only)..."
  echo ""
  cd "$DIR"
  npm install --silent
  touch "$DIR/node_modules/.install-done"
  echo "  ✓  Dependencies installed"
  echo ""
fi

# ── FIND A FREE PORT ──────────────────────────────────────────
PORT=3000
while lsof -i :$PORT &>/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

# ── START SERVER ──────────────────────────────────────────────
echo "  🚀  Starting NexLink on port $PORT..."
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  Open this in your browser:             │"
echo "  │                                         │"
printf "  │    http://localhost:%-20s│\n" "$PORT  "
echo "  │                                         │"
echo "  │  Share this with people on your         │"
echo "  │  network or use ngrok for internet:     │"
echo "  │    ngrok http $PORT                        │"
echo "  │                                         │"
echo "  │  Press Ctrl+C to stop NexLink           │"
echo "  └─────────────────────────────────────────┘"
echo ""

# Open browser after a short delay
(sleep 2 && open "http://localhost:$PORT") &

# Start the server
PORT=$PORT node "$DIR/server.js"
