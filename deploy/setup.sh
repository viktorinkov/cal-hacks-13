#!/bin/bash
# Runs as root on the Debian VM: installs Chromium (for the medical record PDFs), Caddy, Rust and Bun,
# checks out $BANDIT_BRANCH into /opt/bandit, builds the pages and the services, then (re)starts
# bandit-api, bandit-indexer and bandit-workers under systemd behind Caddy on https://$BANDIT_HOST.
# scripts/deploy-vm copies /opt/bandit/.env and /var/lib/bandit/identities first, then runs this.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APP=/opt/bandit

apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git build-essential pkg-config libssl-dev unzip \
  chromium fonts-liberation caddy > /dev/null
printf '#!/bin/sh\nexec chromium --no-sandbox --disable-dev-shm-usage "$@"\n' > /usr/local/bin/chrome
chmod +x /usr/local/bin/chrome
[ -x /root/.cargo/bin/cargo ] || curl -fsSL https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain 1.97.1
[ -x /root/.bun/bin/bun ] || curl -fsSL https://bun.sh/install | bash -s bun-v1.4.0 > /dev/null
export PATH=/root/.cargo/bin:/root/.bun/bin:$PATH
# Swap keeps the Rust build from running out of memory on the 4 GB plan.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p $APP /var/lib/bandit
cd $APP
if [ ! -d .git ]; then
  git init -q
  git remote add origin https://github.com/viktorinkov/cal-hacks-13
fi
git fetch -q origin "$BANDIT_BRANCH"
git reset -q --hard FETCH_HEAD
echo "building $(git log --oneline -1)"
(cd web && bun install --silent && bun run --silent build > /dev/null)
CARGO_PROFILE_DEV_DEBUG=0 cargo build -q -p bandit-api -p bandit-indexer -p bandit-workers -p bandit-claims

install -m 644 deploy/bandit@.service /etc/systemd/system/bandit@.service
systemctl daemon-reload
systemctl enable -q bandit@api bandit@indexer bandit@workers
systemctl restart bandit@api bandit@indexer bandit@workers

printf '%s {\n\treverse_proxy 127.0.0.1:8080\n}\n' "$BANDIT_HOST" > /etc/caddy/Caddyfile
if command -v ufw > /dev/null; then ufw allow 80/tcp > /dev/null && ufw allow 443/tcp > /dev/null; fi
systemctl reload-or-restart caddy
