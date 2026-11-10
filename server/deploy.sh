#!/usr/bin/env bash
# Deploy WhoNotSleep server to $WNS_DEPLOY_HOST. Caddy there proxies
# https://wns.168-231-73-244.sslip.io -> 127.0.0.1:3420.
# Usage: server/deploy.sh   (needs ssh access to host alias "$WNS_DEPLOY_HOST" with sudo)
set -euo pipefail
HOST="${WNS_DEPLOY_HOST:?set WNS_DEPLOY_HOST to your ssh host}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="/opt/whonotsleep"

ssh "$HOST" "sudo mkdir -p $DEST/server/data && sudo chown -R \$(id -un):\$(id -gn) $DEST"

rsync -az --delete \
  --exclude node_modules --exclude data --exclude test.mjs \
  "$ROOT/server" "$HOST:$DEST/"
rsync -az --delete \
  --exclude previews --exclude node_modules \
  "$ROOT/shared" "$HOST:$DEST/"

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
cd $DEST/server
npm ci --omit=dev --no-audit --no-fund
sudo install -m 0644 $DEST/server/whonotsleep.service /etc/systemd/system/whonotsleep.service
sudo systemctl daemon-reload
sudo systemctl enable whonotsleep.service
id wns >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin wns
sudo mkdir -p $DEST/server/data && sudo chown -R wns:wns $DEST/server/data
sudo systemctl restart whonotsleep.service
sleep 1
systemctl --no-pager --lines=5 status whonotsleep.service || true
curl -fsS http://127.0.0.1:3420/healthz && echo
REMOTE
echo "deployed -> https://wns.168-231-73-244.sslip.io/healthz"
