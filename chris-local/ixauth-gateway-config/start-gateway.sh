#!/bin/sh
# Render the tracked Gateway config into the state volume, then start the Gateway.
#
# The template is the single source of truth for this deployment: it is copied over the
# state copy on every start, so an edit here always takes effect on the next restart.
# Two placeholders are substituted, the browser origin and the signup switch, because
# they are the values that cannot be known when the file is written and are not secrets
# (secrets ride in as env SecretRefs such as "${IXAUTH_SERVICE_KEY}", which the Gateway
# resolves itself). The template itself stays valid JSON so it can be read and checked.
set -eu

origin="${OPENCLAW_PUBLIC_ORIGIN:-http://127.0.0.1:18800}"
case "$origin" in
  *"|"*)
    echo "OPENCLAW_PUBLIC_ORIGIN must not contain '|'" >&2
    exit 64
    ;;
esac

# The signup screen is offered only where the identity server accepts signups. Deriving
# both from one variable removes the setup fault where one side is opened and the other
# still refuses, which a visitor reads as a broken form rather than a closed door.
case "${IXAUTH_ACCOUNT_SIGNUP_MODE:-CLOSED}" in
  OPEN | APPROVAL) self_signup="true" ;;
  *) self_signup="false" ;;
esac

mkdir -p /home/node/.openclaw
sed -e "s|__OPENCLAW_PUBLIC_ORIGIN__|${origin}|g" \
    -e "s|\"__OPENCLAW_SELF_SIGNUP__\"|${self_signup}|g" /config/openclaw.json \
  > /home/node/.openclaw/openclaw.json

exec node dist/index.js gateway --bind lan --port 18789
