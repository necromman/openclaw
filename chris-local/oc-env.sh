#!/usr/bin/env bash
# OpenClaw local source-build instance (Chris fork) - shared environment.
#
# Keeps this instance completely separate from the homelab gateway (claw01):
# its own home, config, state, workspace and gateway token. Nothing here is
# shared with ~/.openclaw, so a stock `openclaw` install can coexist.
export OPENCLAW_SRC="${OPENCLAW_SRC:-$HOME/openclaw}"
export OPENCLAW_LOCAL_ROOT="${OPENCLAW_LOCAL_ROOT:-$HOME/openclaw-local}"
export OPENCLAW_HOME="$OPENCLAW_LOCAL_ROOT"
export OPENCLAW_CONFIG_DIR="$OPENCLAW_LOCAL_ROOT/.openclaw"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_LOCAL_ROOT/.openclaw/openclaw.json"
export OPENCLAW_STATE_DIR="$OPENCLAW_LOCAL_ROOT/.openclaw"
export OPENCLAW_WORKSPACE_DIR="$OPENCLAW_LOCAL_ROOT/.openclaw/workspace"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
set +u
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null 2>&1
set -u
