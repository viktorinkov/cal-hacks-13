#!/bin/sh
set -e
DB="${SPACETIMEDB_DATABASE:-bandit-calhacks13-sp82j}"
spacetime describe -s maincloud "$DB" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print("tables:", ", ".join(sorted(t["source_name"] for s in d["sections"] if "Tables" in s for t in s["Tables"])))'
spacetime sql -s maincloud "$DB" "SELECT * FROM settings"
spacetime sql -s maincloud "$DB" "SELECT role, label FROM staff_role"
spacetime sql -s maincloud "$DB" "SELECT name, sponsor_tier, category FROM organization"
spacetime sql -s maincloud "$DB" "SELECT id, run_id, organizer, counts FROM import_run"
