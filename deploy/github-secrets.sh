#!/usr/bin/env bash
# Optional: lets GitHub Actions deploy every push to main (.github/workflows/ci.yml, job "deploy").
# Makes an SSH key that may ONLY run deploy/deploy.sh on this server (whatever command is sent), allows it for this
# user, and prints the four values to paste into GitHub → Settings → Secrets and variables → Actions.
# Safe to run again: it reuses the key and doesn't add the same line twice.
set -euo pipefail
cd "$(dirname "$0")/.."
repo="$(pwd)"
key="$HOME/.ssh/plandit_github_deploy"

domain="$(sed -n 's/^DOMAIN=//p' .env.production 2>/dev/null || true)"
if [ -z "$domain" ]; then
  echo "No DOMAIN in .env.production. Run deploy/init-env.sh <domain> first." >&2
  exit 1
fi

install -d -m 700 "$HOME/.ssh"
[ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "github-actions-plandit-deploy" -f "$key"

allowed="restrict,command=\"$repo/deploy/deploy.sh\" $(cat "$key.pub")"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
grep -qxF "$allowed" "$HOME/.ssh/authorized_keys" || echo "$allowed" >> "$HOME/.ssh/authorized_keys"

cat <<OUT
GitHub → Settings → Secrets and variables → Actions → New repository secret, four times:

DEPLOY_HOST
${domain}

DEPLOY_USER
$(id -un)

DEPLOY_KNOWN_HOSTS
${domain} $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)

DEPLOY_SSH_KEY  (every line below, including the BEGIN and END lines)
$(cat "$key")
OUT
