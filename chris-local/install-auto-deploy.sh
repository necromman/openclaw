#!/usr/bin/env bash
# Install (or refresh) the 2-minute auto-deploy timer for this fork.
# Falls back to a nohup polling loop when systemd is not running in this WSL distro.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/oc-env.sh"
chmod +x "$HERE/auto-deploy.sh"

if systemctl --user show-environment >/dev/null 2>&1; then
  UNITDIR="$HOME/.config/systemd/user"
  mkdir -p "$UNITDIR"
  install -m 0644 "$HERE/openclaw-auto-deploy.service" "$UNITDIR/openclaw-auto-deploy.service"
  install -m 0644 "$HERE/openclaw-auto-deploy.timer"   "$UNITDIR/openclaw-auto-deploy.timer"
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  systemctl --user daemon-reload
  systemctl --user enable --now openclaw-auto-deploy.timer
  echo "systemd user timer installed:"
  systemctl --user list-timers openclaw-auto-deploy.timer --no-pager | head -3
else
  echo "systemd user manager unavailable; starting a nohup polling loop instead."
  pkill -f 'openclaw-auto-deploy-loop' 2>/dev/null || true
  nohup bash -c 'exec -a openclaw-auto-deploy-loop bash -c "while true; do \
    '"$HERE"'/auto-deploy.sh; sleep 120; done"' \
    >> "$OPENCLAW_LOCAL_ROOT/auto-deploy-loop.log" 2>&1 &
  echo "loop started (pid $!)"
fi
