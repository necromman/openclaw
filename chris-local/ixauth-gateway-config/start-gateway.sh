#!/bin/sh
# Render the tracked Gateway config into the state volume, then start the Gateway.
#
# The template is the single source of truth for this deployment: it is copied over the
# state copy on every start, so an edit here always takes effect on the next restart.
# Three placeholders are substituted: the browser origin, the signup switch, and the
# trusted proxy list. They are the values that cannot be known when the file is written
# and are not secrets (secrets ride in as env SecretRefs such as "${IXAUTH_SERVICE_KEY}",
# which the Gateway resolves itself). The template itself stays valid JSON so it can be
# read and checked.
#
# It used to render five more, for the department agents "rnd-bot" and "qa-bot". This
# delivery ships one agent, "main", so those placeholders and the agents that needed them
# are gone (DEPLOY.md 3.3). The compose file still mounts the department shares and the
# index folders: an unused mount costs nothing and is exactly what a department agent
# needs back, so taking it away would only make that day harder. Turning the agents back
# on is DEPLOY.md 3.3-1.
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

# Trusted proxies. The Gateway believes "x-forwarded-proto: https" only from an address
# listed here, and that header is the only thing that can tell it the browser reached a
# TLS origin when the hop into this container is plain HTTP. It is what brings back the
# "__Host-" cookie prefix and the Secure attribute behind Cloudflare Tunnel (DEPLOY.md
# 11.7) or behind a reverse proxy (DEPLOY.md 11.3).
#
# Empty is the default and it is the right default. An entry here is a statement that
# requests from that address were relayed by something trustworthy; on a deployment where
# ordinary browsers also arrive from that address, any of them could claim HTTPS and draw
# out a Secure cookie the browser then refuses to store, which looks exactly like a login
# that fails for no reason. So the list is opt-in and stays out of the plain-HTTP profile.
#
# Comma separated, whitespace ignored. "[]" is what the Gateway sees when it is unset,
# and an empty list is treated the same as no list at all
# (isTrustedProxyAddress in src/gateway/net.ts).
trusted_proxies='[]'
if [ -n "${OPENCLAW_TRUSTED_PROXIES:-}" ]; then
  case "${OPENCLAW_TRUSTED_PROXIES}" in
    *'|'* | *'&'* | *'"'* | *'\'*)
      echo 'OPENCLAW_TRUSTED_PROXIES must not contain | & " or \' >&2
      exit 64
      ;;
  esac
  items=""
  rest="${OPENCLAW_TRUSTED_PROXIES},"
  while [ -n "$rest" ]; do
    entry="${rest%%,*}"
    rest="${rest#*,}"
    entry="$(printf '%s' "$entry" | tr -d '[:space:]')"
    [ -n "$entry" ] || continue
    [ -z "$items" ] || items="${items},"
    items="${items}\"${entry}\""
  done
  trusted_proxies="[${items}]"
fi

mkdir -p /home/node/.openclaw
sed -e "s|__OPENCLAW_PUBLIC_ORIGIN__|${origin}|g" \
    -e "s|\"__OPENCLAW_SELF_SIGNUP__\"|${self_signup}|g" \
    -e "s|\"__OPENCLAW_TRUSTED_PROXIES__\"|${trusted_proxies}|g" /config/openclaw.json \
  > /home/node/.openclaw/openclaw.json

# Workspace identity, rendered the same way the config is: from the tracked template on
# every start. A stock workspace ships a BOOTSTRAP.md whose first beat is "ask the user
# what to call you", so the first question a person put to this delivery came back as a
# naming ceremony instead of an answer. An appliance has no such conversation: the name,
# the language and the role are decided here, once.
#
# Seeding IDENTITY.md is also what suppresses the ceremony. The Gateway seeds BOOTSTRAP.md
# only into a workspace whose profile files still match the stock templates
# (workspaceProfileLooksConfigured in src/agents/workspace.ts); a workspace that already
# carries a real IDENTITY.md is recorded as set up and never gets one. Removing an
# existing BOOTSTRAP.md closes the same door on volumes seeded before this change: the
# Gateway reads "seeded once, gone now" as "the ceremony finished".
#
# Two directories, because either can be the agent workspace depending on how the roster
# resolved when the volume was first written: "workspace" is the process default and
# "workspace-<agent id>" is the per-agent form. Writing both costs two small files and
# removes a class of "it worked on the other volume" faults.
for workspace_dir in /home/node/.openclaw/workspace /home/node/.openclaw/workspace-main; do
  mkdir -p "$workspace_dir"
  cp /config/workspace-seed/IDENTITY.md "$workspace_dir/IDENTITY.md"
  cp /config/workspace-seed/SOUL.md "$workspace_dir/SOUL.md"
  chmod 644 "$workspace_dir/IDENTITY.md" "$workspace_dir/SOUL.md"
  rm -f "$workspace_dir/BOOTSTRAP.md"
done

exec node dist/index.js gateway --bind lan --port 18789
