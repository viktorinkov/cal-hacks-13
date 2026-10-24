#!/bin/sh
# Creates or replaces the BandIt claims dashboard in Kibana (Dashboards API).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/../../../.env"
KIBANA_URL="${KIBANA_URL:-$(sed -n 's/^KIBANA_URL=//p' "$env_file")}"
KIBANA_API_KEY="${KIBANA_API_KEY:-$(sed -n 's/^KIBANA_API_KEY=//p' "$env_file")}"
curl -sS -X PUT "$KIBANA_URL/api/dashboards/bandit-claims" \
  -H "Authorization: ApiKey $KIBANA_API_KEY" -H "kbn-xsrf: true" -H "Content-Type: application/json" \
  --data-binary "@$here/claims-dashboard.json" -w '\nHTTP %{http_code}\n'
