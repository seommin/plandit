#!/usr/bin/env bash
# Pull the latest main and (re)start everything. Safe to run again; the GitHub Actions deploy job runs this too.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose --env-file .env.production -f docker-compose.prod.yml ps
