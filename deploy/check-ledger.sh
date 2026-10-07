#!/usr/bin/env bash
# Checks that every credit balance matches its ledger (read-only). Exit code: 0 ok, 1 mismatch found, 2 could not run.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps api \
  node -r ./register-dist.cjs dist/apps/api/src/scripts/check-ledger.js
