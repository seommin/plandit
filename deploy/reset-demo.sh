#!/usr/bin/env bash
# Optional, for a public demo: wipe ALL data, re-apply migrations and recreate the demo accounts.
# cron (server clock is UTC; 19:00 UTC = 04:00 in Korea):  0 19 * * * /home/ubuntu/plandit/deploy/reset-demo.sh >> /home/ubuntu/reset-demo.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
compose() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }

compose stop web worker api mocks
compose exec -T postgres psql -U plandit -d plandit -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS mock CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
compose exec -T redis redis-cli FLUSHALL
compose run --rm migrate
deploy/seed-demo.sh
compose up -d
echo "Demo reset at $(date -u +%FT%TZ)"
