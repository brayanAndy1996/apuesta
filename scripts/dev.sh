#!/usr/bin/env bash
# Levanta la BD, la API (:4000) y la web (:3000) en modo desarrollo.
set -euo pipefail

cd "$(dirname "$0")/.."

scripts/db-up.sh

(cd api && npm run dev) &
API_PID=$!
(cd web && npm run dev) &
WEB_PID=$!

trap 'kill $API_PID $WEB_PID 2>/dev/null' EXIT
wait
