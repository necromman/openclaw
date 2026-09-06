#!/usr/bin/env bash
# Auto-deploy: pull chris/main from the fork, rebuild, restart the local Gateway.
#
# Flow:  edit on Windows (D:\PROJECT\openclaw) -> git push origin chris/main
#        -> this script (timer, every 2 min) sees the new SHA -> pull -> build -> restart.
#
# Safety rules:
#   - flock so two runs never overlap.
#   - Does nothing at all when the remote SHA equals the local HEAD (cheap no-op).
#   - Runs `pnpm install` only when pnpm-lock.yaml actually changed.
#   - Restarts the Gateway ONLY when the build succeeded. A failed build leaves the
#     running Gateway on its previous in-memory build and writes the reason to the log.
#   - Appends every outcome to chris-local/auto-deploy.log with a KST timestamp + SHA.
#
# Usage:
#   auto-deploy.sh          # timer mode (quiet when there is nothing to do)
#   auto-deploy.sh --now    # manual: same work, but always logs what it decided
#   auto-deploy.sh --force  # rebuild + restart even when the SHA did not move
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$HERE/oc-env.sh"

BRANCH="${OPENCLAW_AUTO_DEPLOY_BRANCH:-chris/main}"
UNIT="${OPENCLAW_AUTO_DEPLOY_UNIT:-openclaw-local.service}"
LOG="$HERE/auto-deploy.log"
LOCK="$OPENCLAW_LOCAL_ROOT/auto-deploy.lock"

MODE="timer"
for arg in "$@"; do
  case "$arg" in
    --now) MODE="now" ;;
    --force) MODE="force" ;;
  esac
done

mkdir -p "$OPENCLAW_LOCAL_ROOT"
# Keep the log out of git without touching upstream .gitignore (survives rebases).
if [ -d "$REPO/.git" ] && ! grep -qxF "chris-local/auto-deploy.log" "$REPO/.git/info/exclude" 2>/dev/null; then
  echo "chris-local/auto-deploy.log" >> "$REPO/.git/info/exclude"
fi

log() { printf '%s  %s\n' "$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S KST')" "$*" >> "$LOG"; }

# Single instance. A timer tick that lands while a build runs simply exits.
exec 9>"$LOCK"
if ! flock -n 9; then
  [ "$MODE" != "timer" ] && log "skip: another auto-deploy run holds the lock"
  exit 0
fi

cd "$REPO" || { log "FAIL: repo not found at $REPO"; exit 1; }

if ! git fetch --quiet origin "$BRANCH" 2>>"$LOG"; then
  log "FAIL: git fetch origin $BRANCH failed"
  exit 1
fi

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ] && [ "$MODE" != "force" ]; then
  [ "$MODE" = "now" ] && log "no-op: already at ${LOCAL_SHA:0:12} (origin/$BRANCH)"
  exit 0
fi

log "deploy start: ${LOCAL_SHA:0:12} -> ${REMOTE_SHA:0:12} (origin/$BRANCH, mode=$MODE)"

LOCK_BEFORE="$(git rev-parse "HEAD:pnpm-lock.yaml" 2>/dev/null || echo none)"

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  if ! git pull --quiet --ff-only origin "$BRANCH" 2>>"$LOG"; then
    log "FAIL: git pull --ff-only rejected (local commits or diverged history). Gateway left running on ${LOCAL_SHA:0:12}"
    exit 1
  fi
fi

NEW_SHA="$(git rev-parse HEAD)"
LOCK_AFTER="$(git rev-parse "HEAD:pnpm-lock.yaml" 2>/dev/null || echo none)"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "pnpm-lock.yaml changed; running pnpm install --frozen-lockfile"
  if ! corepack pnpm install --frozen-lockfile >>"$LOG" 2>&1; then
    log "FAIL: pnpm install failed. Gateway left running on the previous build"
    exit 1
  fi
fi

if ! corepack pnpm build >>"$LOG" 2>&1; then
  log "FAIL: pnpm build failed at ${NEW_SHA:0:12}. Gateway NOT restarted; it keeps serving the previous build"
  exit 1
fi

if ! systemctl --user restart "$UNIT" 2>>"$LOG"; then
  log "FAIL: build ok at ${NEW_SHA:0:12} but systemctl --user restart $UNIT failed"
  exit 1
fi

# Give the Gateway a moment, then confirm it actually answers.
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 2
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:${OPENCLAW_LOCAL_PORT:-18789}/" || true)"
  [ "$CODE" = "200" ] && break
done

if [ "${CODE:-}" = "200" ]; then
  log "OK: deployed ${NEW_SHA:0:12}, Gateway restarted and answering HTTP 200"
else
  log "WARN: deployed ${NEW_SHA:0:12} and restarted, but Control UI probe returned '${CODE:-no-response}'"
fi
