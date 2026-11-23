#!/bin/bash
# ReCut — double-click to start. Keep this window open while you work; close it to quit.
cd "$(dirname "$0")/app" || { echo "The 'app' folder is missing next to ReCut.command."; read -r; exit 1; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-5173}"
URL="http://localhost:$PORT"

clear
echo ""
echo "  ReCut"
echo "  ─────"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ReCut needs Node.js (free). Opening the download page…"
  echo "  Install the LTS version, then double-click ReCut again."
  open "https://nodejs.org/en/download"
  echo ""; read -r -p "  Press Enter to close…"; exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "  Your Node.js is too old ($(node -v)). Install the LTS version from nodejs.org, then try again."
  open "https://nodejs.org/en/download"; read -r -p "  Press Enter to close…"; exit 1
fi

if curl -s "$URL/api/status" 2>/dev/null | grep -q '"server":true'; then
  echo "  ReCut is already running. Opening it…"
  open "$URL"; sleep 1; exit 0
fi

if [ ! -d node_modules ]; then
  echo "  First start: installing (needs internet, about a minute)…"
  npm install --omit=dev --no-audit --no-fund || { read -r -p "  Install failed. Press Enter to close…"; exit 1; }
fi

( for i in $(seq 1 40); do sleep 0.25; curl -s "$URL/api/status" >/dev/null 2>&1 && break; done; open "$URL" ) &
node server/server.js
echo ""; read -r -p "  ReCut stopped. Press Enter to close…"
