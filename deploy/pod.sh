#!/bin/bash
# Start command of the Runpod pod that serves BandIt on Maincloud. It installs Chromium (for the medical
# record PDFs) and Bun, checks out $BANDIT_BRANCH into /workspace/app, builds the pages and the services,
# unpacks the bandit-bundle secret (the .env and the Maincloud identities), then runs bandit-api on port
# 8080, bandit-indexer and bandit-workers. When one of them stops the script exits and Runpod restarts it.
# /workspace is the pod's network volume, so the build cache, uploads and tokens survive restarts.
set -euo pipefail
W=/workspace
export CARGO_HOME=$W/cargo CARGO_TARGET_DIR=$W/target CARGO_PROFILE_DEV_DEBUG=0 BUN_INSTALL=$W/bun
export PATH=$W/bun/bin:$PATH CHROME=/usr/local/bin/chrome
export BANDIT_DATA_DIR=$W/data BANDIT_API_ADDR=0.0.0.0:8080 BANDIT_SIMULATE=1 ELASTIC_INDEX_PREFIX=bandit

apt-get update -qq
apt-get install -y -qq --no-install-recommends chromium fonts-liberation unzip > /dev/null
printf '#!/bin/sh\nexec chromium --no-sandbox --disable-dev-shm-usage "$@"\n' > "$CHROME"
chmod +x "$CHROME"
[ -x "$BUN_INSTALL/bin/bun" ] || curl -fsSL https://bun.sh/install | bash -s bun-v1.4.0 > /dev/null

[ -d $W/app/.git ] || git clone -q https://github.com/viktorinkov/cal-hacks-13 $W/app
cd $W/app
git fetch -q origin "$BANDIT_BRANCH"
git reset -q --hard FETCH_HEAD
echo "building $(git log --oneline -1)"
(cd web && bun install --silent && bun run --silent build > /dev/null)
cargo build -q -p bandit-api -p bandit-indexer -p bandit-workers -p bandit-claims

unpack=$(mktemp -d)
echo "$BANDIT_BUNDLE" | base64 -d | tar -xz -C "$unpack"
unset BANDIT_BUNDLE
install -m 600 "$unpack/env" .env
mkdir -p "$BANDIT_DATA_DIR/identities"
chmod 700 "$BANDIT_DATA_DIR/identities"
install -m 600 "$unpack"/identities/* "$BANDIT_DATA_DIR/identities/"
rm -rf "$unpack"

bin=$CARGO_TARGET_DIR/debug
"$bin/bandit-indexer" &
"$bin/bandit-workers" &
"$bin/bandit-api" &
wait -n
exit 1
