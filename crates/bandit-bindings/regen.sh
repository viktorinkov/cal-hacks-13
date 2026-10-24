#!/bin/sh
# Regenerates the bindings from spacetimedb/server. Uses its own CLI config so
# a local login never touches ~/.config/spacetime.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$root/var/spacetime"
rm -rf "$root/crates/bandit-bindings/src/module_bindings"
"${SPACETIME:-$HOME/.local/bin/spacetime}" --config-path "$root/var/spacetime/cli.toml" generate --lang rust \
  --out-dir "$root/crates/bandit-bindings/src/module_bindings" --module-path "$root/spacetimedb/server" --include-private -y
