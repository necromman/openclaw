#!/usr/bin/env bash
# Appends chris-local/workspace-pdf-rules.md to the local instance workspace
# AGENTS.md. Idempotent: a second run detects the marker and does nothing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/oc-env.sh"

SRC="$HERE/workspace-pdf-rules.md"
DST="$OPENCLAW_WORKSPACE_DIR/AGENTS.md"

if [ ! -f "$DST" ]; then
  echo "no workspace AGENTS.md at $DST" >&2
  exit 1
fi

if grep -q "Making PDFs" "$DST"; then
  echo "already installed: $DST"
  exit 0
fi

printf '\n' >>"$DST"
sed -n '/^## Making PDFs/,$p' "$SRC" | sed 's/\r$//' >>"$DST"
echo "installed into $DST"
