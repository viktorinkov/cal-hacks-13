#!/bin/bash
# Runs as root on the Debian VM: installs Chromium (for medical record PDFs), Poppler (for page images), Caddy, Rust and Bun,
# checks out $BANDIT_BRANCH into /opt/bandit, builds the pages and the services, sets up the Python the
# venue setup runs pipeline/venue_model.py with (Playwright drives Bright Data's browser), then (re)starts
# bandit-api, bandit-indexer, bandit-workers and the live run's floor staff under systemd behind Caddy on
# https://$BANDIT_HOST, and turns on bandit-autodeploy.timer, which runs this again whenever vik-e2e moves.
# scripts/deploy-vm copies /opt/bandit/.env and /var/lib/bandit/identities first, then runs this.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APP=/opt/bandit
# One deploy at a time: scripts/deploy-vm and deploy/autodeploy.sh can start together.
exec 9> /var/lock/bandit-deploy
flock 9

apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git build-essential pkg-config libssl-dev unzip \
  chromium fonts-liberation poppler-utils caddy python3-venv > /dev/null
command -v pdftoppm > /dev/null
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
# The command center is the desk at /organizer. Publish the committed build first, then replace it
# if a fresh one succeeds. A failed build keeps the last desk up. /callback, /api, and /blobs stay proxied.
if [ -f frontend/dist/index.html ]; then
  rm -rf /srv/bandit-desk.new && cp -r frontend/dist /srv/bandit-desk.new
  rm -rf /srv/bandit-desk && mv /srv/bandit-desk.new /srv/bandit-desk
fi
if [ -f frontend/package.json ]; then
  if (cd frontend && bun install --silent && bun run --silent build:host > /dev/null); then
    rm -rf /srv/bandit-desk.new && cp -r frontend/dist /srv/bandit-desk.new
    rm -rf /srv/bandit-desk && mv /srv/bandit-desk.new /srv/bandit-desk
  else
    echo "command center build failed, keeping the last one"
  fi
fi
CARGO_PROFILE_DEV_DEBUG=0 cargo build -q -p bandit-api -p bandit-indexer -p bandit-workers -p bandit-claims
[ -x var/venv/bin/python3 ] || python3 -m venv var/venv
var/venv/bin/pip install -q playwright requests

install -m 644 deploy/bandit@.service /etc/systemd/system/bandit@.service
install -m 644 deploy/bandit-live.service /etc/systemd/system/bandit-live.service
install -m 644 deploy/bandit-autodeploy.service deploy/bandit-autodeploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable -q bandit@api bandit@indexer bandit@workers bandit-live
systemctl restart bandit@api bandit@indexer bandit@workers bandit-live
systemctl enable -q --now bandit-autodeploy.timer

# /deploy/ shows the last deploy. dev.$BANDIT_HOST keeps the plain pages for testing.
# The first line names the main host, which deploy/autodeploy.sh reads back.
# / is the front page (home.html in the desk build). /organizer and the other desk routes are the command
# center. /portal keeps the previous organizer page.
# A band's tag link, /t/BANDIT-07, opens the command center's signup for that band; dev.$BANDIT_HOST keeps the old tap page.
install -d -m 755 /srv/bandit-deploy /srv/bandit-portal
cp -f web/organizer.html /srv/bandit-portal/index.html
chmod 644 /srv/bandit-portal/index.html
cat > /etc/caddy/Caddyfile <<CADDY
$BANDIT_HOST, www.$BANDIT_HOST {
	handle_path /deploy/* {
		root * /srv/bandit-deploy
		file_server
	}
	redir /cc /cc/
	handle_path /cc/* {
		root * /srv/bandit-desk
		try_files {path} /index.html
		file_server
	}
	@home path /
	handle @home {
		root * /srv/bandit-desk
		rewrite * /home.html
		file_server
	}
	@desk path /organizer /organizer/ /payments /payments/ /venue /venue/ /attendees /attendees/ /bands /bands/ /photos /photos/ /cameras /cameras/ /photo /photo/ /merch /merch/ /graph /graph/ /claims /claims/ /costs /costs/ /join /join/ /register /register/ /wallet /wallet/ /staff /staff/ /view-as /view-as/ /t/*
	handle @desk {
		root * /srv/bandit-desk
		try_files {path} /index.html
		file_server
	}
	@portal path /portal /portal/
	handle @portal {
		root * /srv/bandit-portal
		try_files {path} /index.html
		file_server
	}
	handle {
		reverse_proxy 127.0.0.1:8080
	}
}

dev.$BANDIT_HOST {
	handle_path /deploy/* {
		root * /srv/bandit-deploy
		file_server
	}
	handle {
		reverse_proxy 127.0.0.1:8080
	}
}
CADDY
if command -v ufw > /dev/null; then ufw allow 80/tcp > /dev/null && ufw allow 443/tcp > /dev/null; fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload-or-restart caddy
printf '%s %s deployed at %s\n' "$BANDIT_BRANCH" "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)" > /srv/bandit-deploy/status.txt
