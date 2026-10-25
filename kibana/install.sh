#!/bin/sh
# Creates or replaces the saved Kibana dashboards (Dashboards API): each <name>.json here becomes the
# dashboard bandit-<name>. The two event dashboards come from bandit-ingest instead.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/../.env"
KIBANA_URL="${KIBANA_URL:-$(sed -n 's/^KIBANA_URL=//p' "$env_file")}"
KIBANA_API_KEY="${KIBANA_API_KEY:-$(sed -n 's/^KIBANA_API_KEY=//p' "$env_file")}"
for file in "$here"/*.json; do
  id="bandit-$(basename "$file" .json)"
  body="$(curl -sS -w '\n%{http_code}' -X PUT "$KIBANA_URL/api/dashboards/$id" \
    -H "Authorization: ApiKey $KIBANA_API_KEY" -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    --data-binary "@$file")"
  status="$(printf '%s' "$body" | tail -n 1)"
  case "$status" in
    2*) echo "$id: $KIBANA_URL/app/dashboards#/view/$id" ;;
    *) echo "$id refused: HTTP $status $(printf '%s' "$body" | sed '$d')"; failed=1 ;;
  esac
done
exit "${failed:-0}"
