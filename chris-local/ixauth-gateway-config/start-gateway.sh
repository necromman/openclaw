#!/bin/sh
# Render the tracked Gateway config into the state volume, then start the Gateway.
#
# The template is the single source of truth for this deployment: it is copied over the
# state copy on every start, so an edit here always takes effect on the next restart.
# Eight placeholders are substituted: the browser origin, the signup switch, the two
# department agent workspaces, the bootstrap switch those workspaces require, the two
# knowledge index folders those agents search, and the trusted proxy list. They are the
# values that cannot be known when the file is written and are not secrets (secrets ride
# in as env SecretRefs such as "${IXAUTH_SERVICE_KEY}", which the Gateway resolves
# itself). The template itself stays valid JSON so it can be read and checked.
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

# Department agent workspaces. The compose file always mounts the department shares at
# /mnt/nas/<slug> read only, but a share only becomes an agent's workspace when the
# operator names its parent in OPENCLAW_NAS_ROOT. Unset means "no NAS here": each agent
# keeps the writable workspace the Gateway would resolve for it anyway
# (<state dir>/workspace-<id>), so the shipped default starts and answers exactly as it
# did before this switch existed.
#
# A read-only workspace also has to have workspace bootstrap files switched off. First
# turn setup publishes AGENTS.md into the workspace through a staging file it creates
# inside that same directory (src/agents/workspace.ts:319-393, reached from
# src/agents/command/prepare.ts:368), and on a ":ro" mount that write fails with EROFS
# and takes the turn down with it. The switch is per agent
# (agents.entries.<id>.skipBootstrap, resolved by resolveAgentSkipBootstrap in
# src/agents/agent-scope-config.ts), so only the two department agents lose their
# scaffolding here. "main" keeps a writable workspace and keeps its bootstrap files.
if [ -n "${OPENCLAW_NAS_ROOT:-}" ]; then
  rnd_workspace="/mnt/nas/rnd"
  qa_workspace="/mnt/nas/qa"
  skip_bootstrap="true"
else
  rnd_workspace="/home/node/.openclaw/workspace-rnd-bot"
  qa_workspace="/home/node/.openclaw/workspace-qa-bot"
  skip_bootstrap="false"
fi

# Knowledge index folders. A department share holds pdf, docx, xlsx and pptx files, and
# the memory indexer collects only Markdown, so a share is searchable only through the
# Markdown sidecars "openclaw knowledge sync" writes beside it. The sidecars live on host
# local disk, never on the share, and the agent reaches them through extraPaths. Unset
# means "no index here": the agents get an empty list and search only their own memory,
# which is exactly what they did before this switch existed. See chris-local/KNOWLEDGE.md.
if [ -n "${OPENCLAW_KNOWLEDGE_ROOT:-}" ]; then
  rnd_knowledge='["/mnt/knowledge/rnd"]'
  qa_knowledge='["/mnt/knowledge/qa"]'
else
  rnd_knowledge='[]'
  qa_knowledge='[]'
fi

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
    -e "s|__OPENCLAW_RND_WORKSPACE__|${rnd_workspace}|g" \
    -e "s|__OPENCLAW_QA_WORKSPACE__|${qa_workspace}|g" \
    -e "s|\"__OPENCLAW_NAS_SKIP_BOOTSTRAP__\"|${skip_bootstrap}|g" \
    -e "s|\"__OPENCLAW_RND_KNOWLEDGE_PATHS__\"|${rnd_knowledge}|g" \
    -e "s|\"__OPENCLAW_QA_KNOWLEDGE_PATHS__\"|${qa_knowledge}|g" \
    -e "s|\"__OPENCLAW_TRUSTED_PROXIES__\"|${trusted_proxies}|g" /config/openclaw.json \
  > /home/node/.openclaw/openclaw.json

exec node dist/index.js gateway --bind lan --port 18789
