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
#   - Reverts the tracked files the build itself rewrites before pulling, and names them
#     in the log. Anything else that is dirty still stops the pull, and the log carries
#     `git status --short` so the next session can see what it was.
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

# Some tracked files are build outputs. `pnpm build` rewrites them in place, so a
# checkout that has ever built is dirty in exactly those paths, and the next
# `git pull --ff-only` refuses. The refusal is silent from the outside: the timer keeps
# ticking, the log keeps saying FAIL, and the Gateway keeps serving a build that falls
# further behind every push. That is how this checkout ended up 35 commits behind in
# 2026-09-08. Reverting them here is safe because the next build writes them again.
#
# The list is not hardcoded. A package declares its own build outputs in
# package.json under openclaw.assetScripts.buildOutputs (workboard's plugin manifest
# carries a content hash of its Control UI bundle; canvas ships a vendored bundle and its
# hash), and a package added later declares them the same way. Node is present because
# the build needs it; if it somehow is not, fall back to the two known packages rather
# than skipping the step.
build_outputs() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    for (const root of ["extensions", "packages"]) {
      let dirs = [];
      try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const manifest = path.join(root, dir.name, "package.json");
        let pkg;
        try { pkg = JSON.parse(fs.readFileSync(manifest, "utf8")); } catch { continue; }
        const outputs = pkg?.openclaw?.assetScripts?.buildOutputs;
        if (!Array.isArray(outputs)) continue;
        for (const out of outputs) {
          if (typeof out === "string" && out.length > 0) {
            console.log(path.posix.join(root, dir.name, out));
          }
        }
      }
    }
  ' 2>/dev/null || printf '%s\n' \
    "extensions/workboard/openclaw.plugin.json" \
    "extensions/canvas/src/host/a2ui/.bundle.hash" \
    "extensions/canvas/src/host/a2ui/a2ui.bundle.js" \
    "extensions/canvas/src/host/a2ui/a2ui-v0.9.bundle.js"
}

REVERTED=""
for output in $(build_outputs); do
  # Only touch what is actually modified, so the log names what really drifted.
  if ! git diff --quiet -- "$output" 2>/dev/null; then
    if git checkout --quiet -- "$output" 2>>"$LOG"; then
      REVERTED="$REVERTED $output"
    fi
  fi
done
[ -n "$REVERTED" ] && log "reverted build outputs before pull:$REVERTED"

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  if ! git pull --quiet --ff-only origin "$BRANCH" 2>>"$LOG"; then
    log "FAIL: git pull --ff-only rejected (local commits or diverged history). Gateway left running on ${LOCAL_SHA:0:12}"
    # Name what is in the way. Without this the log says only that the pull was refused,
    # and the reason has to be dug out by hand on a later day.
    git status --short >> "$LOG" 2>&1
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
