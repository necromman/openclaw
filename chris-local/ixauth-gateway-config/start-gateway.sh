#!/bin/sh
# Render the tracked Gateway config into the state volume, then start the Gateway.
#
# The template is the source of truth for this deployment: it is copied over the state
# copy on every start, so an edit here always takes effect on the next restart. One region
# is the exception since stage U and is named at the merge step below: the model settings
# an administrator owns are merged back on top of the render.
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

# The template carries a top-level "meta" block, and it has to. The Gateway compares each
# config it reads against the last one it accepted, and a file that drops "meta" when the
# previous one had it is read as damage: the loader restores the backup and logs
# "Config auto-restored from backup ... (missing-meta-vs-last-good)". The Gateway writes
# "meta" itself the first time it records a migration, so from that moment on a
# meta-less render is silently thrown away and this deployment keeps running yesterday's
# settings. Carrying the block makes the render an ordinary config again.
mkdir -p /home/node/.openclaw
sed -e "s|__OPENCLAW_PUBLIC_ORIGIN__|${origin}|g" \
    -e "s|\"__OPENCLAW_SELF_SIGNUP__\"|${self_signup}|g" \
    -e "s|\"__OPENCLAW_TRUSTED_PROXIES__\"|${trusted_proxies}|g" /config/openclaw.json \
  > /home/node/.openclaw/openclaw.json

# One region of that render is not the template's to dictate any more (stage U): which
# model answers, which model answers when the first cannot, and which models chat offers.
# An administrator sets those from Settings > Models without holding "operator.admin", and
# the Gateway records the choice in this file beside the config as well as in the config
# itself. Merging it back here is what makes the choice survive the next start; without it
# the render would quietly reinstate yesterday's models and the screen would look broken.
#
# Everything else stays exactly as before. The merge reads four named leaves and ignores
# the rest of the file, so identity, departments, tool policy, the proxy list and the
# top-level "meta" block are still the template's alone. A missing, damaged or wrongly
# shaped overrides file changes nothing: the script says so on stderr and leaves the
# render in place, which is the deployment's known-good state. Deleting the file is
# therefore the way to put the models back under template control.
admin_overrides="/home/node/.openclaw/admin-overrides.json"
if [ -f "$admin_overrides" ]; then
  node /config/merge-admin-overrides.mjs /home/node/.openclaw/openclaw.json "$admin_overrides" \
    || echo "admin overrides merge failed; keeping the rendered template" >&2
fi

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
