#!/usr/bin/env bash
# QA Pilot launcher for macOS / Linux.
#   ./start.sh        install if needed, build the UI and start on http://localhost:4300
#   ./start.sh dev    development mode with hot reload (UI on http://localhost:5173)
set -euo pipefail
cd "$(dirname "$0")"

major=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
if [[ -z "${major}" || "${major}" -lt 22 ]]; then
  echo "QA Pilot needs Node.js 22 or newer: https://nodejs.org (or: nvm install --lts)"
  exit 1
fi
echo "Using Node $(node -v)"

[[ -f .env ]] || cp .env.example .env
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies (first run, takes a few minutes)..."
  npm install
fi
# Linux may also need system libraries for Chromium: npx playwright install-deps chromium
npx playwright install chromium

if [[ "${1:-}" == "dev" ]]; then
  npm run dev
else
  npm start
fi
