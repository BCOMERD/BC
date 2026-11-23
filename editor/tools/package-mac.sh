#!/bin/bash
# Builds ReCut-mac.zip containing ReCut.app (unsigned) with the app and its pure-JS dependencies bundled.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/dist}"
STAGE="$(mktemp -d)"
APPDIR="$STAGE/ReCut.app/Contents"
mkdir -p "$APPDIR/MacOS" "$APPDIR/Resources/app" "$OUT"
cd "$HERE"
npm install --omit=dev --no-audit --no-fund >/dev/null
cp mac/app-template/Info.plist "$APPDIR/"
cp mac/app-template/ReCut "$APPDIR/MacOS/ReCut"; chmod +x "$APPDIR/MacOS/ReCut"
cp mac/app-template/ReCut.icns "$APPDIR/Resources/"
cp -R index.html app.js style.css package.json package-lock.json server sample node_modules "$APPDIR/Resources/app/"
rm -f "$OUT/ReCut-mac.zip"
( cd "$STAGE" && zip -qry "$OUT/ReCut-mac.zip" ReCut.app )
echo "$OUT/ReCut-mac.zip"
