#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

FQBN_XIAO=esp32:esp32:XIAO_ESP32C3
FQBN_C3=esp32:esp32:esp32c3:CDCOnBoot=cdc
PY=python3

fqbn() { if [ "$1" = station ]; then echo "$FQBN_C3"; else echo "$FQBN_XIAO"; fi; }

write_version() {
  local v
  v=$(git rev-parse --short HEAD 2>/dev/null || echo local)
  if ! git diff --quiet HEAD -- . 2>/dev/null; then v="$v+$(date +%m%d.%H%M)"; fi
  local line="#define BANDIT_FW \"$v\""
  if [ ! -f bandit_common/bandit_version.h ] || [ "$(cat bandit_common/bandit_version.h)" != "$line" ]; then
    echo "$line" > bandit_common/bandit_version.h
  fi
  echo "fw $v"
}

compile() {
  local t=$1
  echo "== compile $t"
  arduino-cli compile --fqbn "$(fqbn "$t")" --library bandit_common --build-path "build/$t" "bandit_$t" \
    | grep -E "Sketch uses|error" || true
  test -f "build/$t/bandit_$t.ino.bin" || { echo "compile failed: $t"; exit 1; }
}

wait_port() {
  for _ in $(seq 1 40); do [ -e "$1" ] && return 0; sleep 0.25; done
  echo "port $1 did not come back"; return 1
}

upload() {
  local t=$1 port=$2
  echo "== upload $t -> $port"
  arduino-cli upload -p "$port" --fqbn "$(fqbn "$t")" --input-dir "build/$t" "bandit_$t" >"build/upload_$(basename "$port").log" 2>&1 \
    || { tail -5 "build/upload_$(basename "$port").log"; echo "upload failed on $port (hold B, tap R, release B, retry)"; return 1; }
  sleep 1.5
  wait_port "$port"
  sleep 1
}

set_id() {
  local port=$1 id=$2
  $PY tools/fleet.py send "$port" "id $id" "save"
}

mkdir -p build
cmd=${1:-}
case "$cmd" in
  ports)
    $PY tools/fleet.py table ;;
  compile)
    write_version
    targets=${2:-all}
    [ "$targets" = all ] && targets="band gateway station"
    for t in $targets; do compile "$t"; done ;;
  band|gateway|station)
    port=${2:?usage: ./build.sh $cmd <port> [id]}
    write_version
    compile "$cmd"
    upload "$cmd" "$port"
    if [ -n "${3:-}" ]; then set_id "$port" "$3"; else $PY tools/fleet.py send "$port" info; fi ;;
  all-bands)
    write_version
    compile band
    ports=$($PY tools/fleet.py targets)
    [ -n "$ports" ] || { echo "no band boards connected"; exit 1; }
    echo "bands: $ports"
    pids=()
    for p in $ports; do upload band "$p" & pids+=($!); done
    fail=0
    for pid in "${pids[@]}"; do wait "$pid" || fail=1; done
    $PY tools/fleet.py table
    exit $fail ;;
  monitor)
    arduino-cli monitor -p "${2:?usage: ./build.sh monitor <port>}" -c baudrate=115200 ;;
  *)
    echo "usage: ./build.sh ports | compile [band|gateway|station|all] | band <port> [id] | gateway <port> | station <port> [id] | all-bands | monitor <port>"; exit 1 ;;
esac
