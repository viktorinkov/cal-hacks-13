#!/bin/bash
# Setup script of the "BandIt" cloud environment that the CalHacks 13.0 project's cloud threads run in (a copy:
# the live one is in the project settings, Environment, BandIt, Setup script).
# Installs the SpacetimeDB CLI and the wasm target, commits as Viktor, and installs bandit-creds, which turns
# the keys file /mnt/project-files/bandit-cloud.env into the files the scripts expect, as on Viktor's Mac:
# ~/.config/spacetime/cli.toml (the Maincloud owner login), the deploy key for root@band1t.vip, and the repo's
# .env and .dev/e2e-maincloud/identities. The project folder is mounted after this script, so every new shell runs it.
set -e
curl -fsSL https://spacetimedb-client-binaries.s3.amazonaws.com/refs/tags/v2.13.0/spacetime-x86_64-unknown-linux-gnu.tar.gz \
  | tar -xz -C /usr/local/bin spacetimedb-cli spacetimedb-standalone
mv /usr/local/bin/spacetimedb-cli /usr/local/bin/spacetime
rustup target add wasm32-unknown-unknown || true
git config --global user.name "Viktor Minchev"
git config --global user.email vikitominchev@gmail.com
install -d -m 700 "$HOME/.ssh"
echo 'band1t.vip,104.207.149.22 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN2IxNVt3ymy8zSNfPq8UwFwPEYRnYzho3TE4OSqd80M' >> "$HOME/.ssh/known_hosts"

cat > /usr/local/bin/bandit-creds <<'EOF'
#!/bin/bash
# Writes the BandIt credentials from the project's keys file. Safe to run again.
[ -f /mnt/project-files/bandit-cloud.env ] || exit 0
. /mnt/project-files/bandit-cloud.env
B="$HOME/.bandit"
install -d -m 700 "$B" "$B/identities" "$HOME/.ssh" "$HOME/.config/spacetime"
echo "$BANDIT_ENV_B64" | base64 -d > "$B/.env"
echo "$BANDIT_IDENTITIES_B64" | base64 -d | tar -xzo -C "$B/identities"
echo "$BANDIT_DEPLOY_KEY_B64" | base64 -d > "$HOME/.ssh/bandit_cloud_deploy"
chmod 600 "$B/.env" "$B"/identities/* "$HOME/.ssh/bandit_cloud_deploy"
grep -q bandit_cloud_deploy "$HOME/.ssh/config" 2>/dev/null \
  || printf 'Host band1t.vip 104.207.149.22\n\tUser root\n\tIdentityFile ~/.ssh/bandit_cloud_deploy\n\tIdentitiesOnly yes\n' >> "$HOME/.ssh/config"
grep -q spacetimedb_token "$HOME/.config/spacetime/cli.toml" 2>/dev/null || cat > "$HOME/.config/spacetime/cli.toml" <<TOML
default_server = "maincloud"
spacetimedb_token = "$BANDIT_SPACETIME_TOKEN"

[[server_configs]]
nickname = "maincloud"
host = "maincloud.spacetimedb.com"
protocol = "https"
TOML
chmod 600 "$HOME/.config/spacetime/cli.toml"
# Give each BandIt clone the .env and service identities the Mac checkout holds.
for repo in "$PWD" "$CLAUDE_PROJECT_DIR" /home/user/*; do
  [ -f "$repo/scripts/e2e-env" ] || continue
  ln -sfn "$B/.env" "$repo/.env"
  mkdir -p "$repo/.dev/e2e-maincloud" && ln -sfn "$B/identities" "$repo/.dev/e2e-maincloud/identities"
done
exit 0
EOF
chmod 755 /usr/local/bin/bandit-creds
echo '/usr/local/bin/bandit-creds > /dev/null 2>&1' >> "$HOME/.bashrc"
