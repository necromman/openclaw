#!/bin/sh
# Render the tracked Gateway config into the state volume, then start the Gateway.
#
# The template is the single source of truth for this deployment: it is copied over the
# state copy on every start, so an edit here always takes effect on the next restart.
# Only one placeholder is substituted, the browser origin, because it is the one value
# that cannot be known when the file is written and is not a secret (secrets ride in as
# env SecretRefs such as "${IXAUTH_SERVICE_KEY}", which the Gateway resolves itself).
set -eu

origin="${OPENCLAW_PUBLIC_ORIGIN:-http://127.0.0.1:18800}"
case "$origin" in
  *"|"*)
    echo "OPENCLAW_PUBLIC_ORIGIN must not contain '|'" >&2
    exit 64
    ;;
esac

mkdir -p /home/node/.openclaw
sed "s|__OPENCLAW_PUBLIC_ORIGIN__|${origin}|g" /config/openclaw.json \
  > /home/node/.openclaw/openclaw.json

exec node dist/index.js gateway --bind lan --port 18789
