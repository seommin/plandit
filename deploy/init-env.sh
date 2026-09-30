#!/usr/bin/env bash
# First-time setup on the server: writes .env.production with fresh random secrets.
# Usage: deploy/init-env.sh myplandit.duckdns.org
set -euo pipefail
cd "$(dirname "$0")/.."

domain="${1:-}"
if [ -z "$domain" ]; then
  echo "Usage: deploy/init-env.sh <domain>   e.g. deploy/init-env.sh myplandit.duckdns.org" >&2
  exit 1
fi
if [ -e .env.production ]; then
  echo ".env.production already exists. Delete it first if you really want new secrets (existing data keeps the old DB password)." >&2
  exit 1
fi

secret() { openssl rand -hex 32; }
auth_secret="$(secret)"
demo_password="plandit-demo-1234"

umask 077
cat > .env.production <<ENV
# Written by deploy/init-env.sh. Never commit this file.
DOMAIN=${domain}
POSTGRES_PASSWORD=$(secret)

# Web ↔ api (both inside Docker) and sign-in cookies
API_INTERNAL_SECRET=$(secret)
AUTH_SECRET=${auth_secret}
NEXTAUTH_SECRET=${auth_secret}
LOG_LEVEL=info

# Bearer token for /metrics (not exposed through Caddy anyway)
METRICS_TOKEN=$(secret)
# Emails of platform operators (manual credit adjustments, recovery commands), comma-separated
PLATFORM_ADMIN_EMAILS=

# Everything external is the mock server: no real payment and no real SMS, ever.
PAYMENT_PROVIDER=mock
MESSAGE_PROVIDER=mock
MOCK_PG_WEBHOOK_SECRET=$(secret)
MOCK_RELAY_WEBHOOK_SECRET=$(secret)
PUSH_PROVIDER=NOOP

# AI. Keep "mock" on a public demo: the mock PG hands out credits for free, so anyone could spend a real API key.
LLM_PROVIDER=mock
ANTHROPIC_API_KEY=

# Demo accounts (deploy/seed-demo.sh) and the "데모 계정으로 둘러보기" button on the login page.
# The button values are built into the web app: rebuild (deploy/deploy.sh) after changing them.
DEMO_PASSWORD=${demo_password}
NEXT_PUBLIC_DEMO_EMAIL=demo@plandit.dev
NEXT_PUBLIC_DEMO_PASSWORD=${demo_password}
ENV
echo "Wrote .env.production for https://${domain}"
