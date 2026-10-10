#!/usr/bin/env bash
# CI local: instala dependencias y corre lint + tests + build de api y web.
set -euo pipefail

cd "$(dirname "$0")/.."

scripts/db-up.sh

echo "=== api: install ==="
(cd api && npm ci)
echo "=== api: lint ==="
(cd api && npm run lint)
echo "=== api: test ==="
(cd api && npm test)

echo "=== web: install ==="
(cd web && npm ci)
echo "=== web: lint ==="
(cd web && npm run lint)
echo "=== web: build ==="
(cd web && npm run build)

echo "=== CI local OK ==="
