#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Brak Node.js – zainstaluj wersję LTS z https://nodejs.org"; exit 1; }
if [ ! -d node_modules ]; then
  npm install && npx playwright install chromium || exit 1
fi
# HEADLESS=false ./start.sh   – widoczne okno przeglądarki
# HOST=0.0.0.0 ./start.sh     – dostęp z telefonu w sieci lokalnej
node server.js
