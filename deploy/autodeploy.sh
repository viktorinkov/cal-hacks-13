#!/bin/bash
# Run every 30 s by bandit-autodeploy.timer: when vik-e2e on GitHub has moved past the commit the VM serves,
# deploys it with that commit's deploy/setup.sh. Cloud threads can't reach the VM over SSH, so pushing vik-e2e
# is how they ship. Serving another branch (scripts/deploy-vm with BANDIT_BRANCH) pauses this until vik-e2e
# is deployed again. https://<host>/deploy/status.txt shows the last deploy and the end of its log.
set -euo pipefail
APP=/opt/bandit
OUT=/srv/bandit-deploy
grep -q "branch 'vik-e2e'" "$APP/.git/FETCH_HEAD" || exit 0
remote="$(git -C "$APP" ls-remote origin refs/heads/vik-e2e | cut -f1)"
[ -n "$remote" ] && [ "$remote" != "$(git -C "$APP" rev-parse HEAD)" ] || exit 0

git -C "$APP" fetch -q origin vik-e2e
commit="$(git -C "$APP" rev-parse FETCH_HEAD)"
host="$(sed -n '1s/,.*//p' /etc/caddy/Caddyfile)"
started="$(date -u +%FT%TZ)"
printf 'vik-e2e %s deploying since %s\n' "$commit" "$started" > "$OUT/status.txt"
if git -C "$APP" show "$commit:deploy/setup.sh" | BANDIT_BRANCH=vik-e2e BANDIT_HOST="$host" bash > "$OUT/log.txt" 2>&1; then
  result=deployed
else
  result=failed
fi
{ printf 'vik-e2e %s %s at %s (started %s)\n\n' "$commit" "$result" "$(date -u +%FT%TZ)" "$started"; tail -40 "$OUT/log.txt"; } > "$OUT/status.tmp"
mv "$OUT/status.tmp" "$OUT/status.txt"
