#!/bin/bash
# Builds ReCut-mac.zip: double-click launcher + app with its (pure JS) dependencies bundled.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/dist}"
STAGE="$(mktemp -d)/ReCut"
mkdir -p "$STAGE/app" "$OUT"
cd "$HERE"
npm install --omit=dev --no-audit --no-fund >/dev/null
cp -R index.html app.js style.css package.json package-lock.json .env.example server sample node_modules "$STAGE/app/"
cp mac/ReCut.command mac/README.txt "$STAGE/"
chmod +x "$STAGE/ReCut.command"
( cd "$(dirname "$STAGE")" && zip -qry "$OUT/ReCut-mac.zip" ReCut )
echo "$OUT/ReCut-mac.zip"
