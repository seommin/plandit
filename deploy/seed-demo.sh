#!/usr/bin/env bash
# Creates (or refreshes) the demo accounts demo@plandit.dev / teammate@plandit.dev. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps api \
  node -r ./register-dist.cjs dist/apps/api/src/scripts/seed-demo.js
