#!/usr/bin/env bash
# Idempotent setup of the isolated local gateway for this fork.
# Run from inside the source checkout:  bash chris-local/install.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/oc-env.sh"
OC() { node "$OPENCLAW_SRC/openclaw.mjs" "$@"; }

mkdir -p "$OPENCLAW_LOCAL_ROOT/bin" "$OPENCLAW_WORKSPACE_DIR"
chmod 700 "$OPENCLAW_CONFIG_DIR"
install -m 0644 "$HERE/oc-env.sh" "$OPENCLAW_LOCAL_ROOT/oc-env.sh"
install -m 0755 "$HERE/oc"        "$OPENCLAW_LOCAL_ROOT/bin/oc"

# 1. Gateway token (generated once, never committed).
TOKFILE="$OPENCLAW_CONFIG_DIR/gateway-token.txt"
if [ ! -s "$TOKFILE" ]; then ( umask 077; openssl rand -hex 32 > "$TOKFILE" ); fi
chmod 600 "$TOKFILE"

# 2. Gateway config: loopback only, token auth, Control UI on.
PATCH="$(mktemp)"
cat > "$PATCH" <<JSON
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "port": ${OPENCLAW_LOCAL_PORT:-18789},
    "auth": {
      "mode": "token",
      "token": "$(cat "$TOKFILE")",
      "rateLimit": { "maxAttempts": 10, "windowMs": 60000, "lockoutMs": 300000 }
    },
    "controlUi": { "enabled": true }
  }
}
JSON
OC config patch --file "$PATCH"
rm -f "$PATCH"
chmod 600 "$OPENCLAW_CONFIG_PATH"
OC config validate

# 3. systemd user service.
UNITDIR="$HOME/.config/systemd/user"
mkdir -p "$UNITDIR"
sed "s|@NODE_BIN@|$(command -v node)|" "$HERE/openclaw-local.service" \
  > "$UNITDIR/openclaw-local.service"
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
systemctl --user daemon-reload
systemctl --user enable --now openclaw-local.service
echo "Gateway token: $TOKFILE"
echo "Control UI:    http://127.0.0.1:${OPENCLAW_LOCAL_PORT:-18789}/"
