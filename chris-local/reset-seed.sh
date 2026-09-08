#!/usr/bin/env bash
#
# Clear the test seed out of a running delivery stack.
#
# Test drives leave three kinds of residue behind: conversation sessions, the accounts
# that made them, and the ledgers that recorded both. This script removes them through
# the same surfaces a signed-in administrator uses, so nothing here can leave the state
# database in a shape the Gateway would not have produced itself.
#
# It reports and changes nothing until it is given --yes. The account stage is off by
# default because deleting a person is the one step nobody can undo from a screen.
#
# Usage:
#   chris-local/reset-seed.sh                      # report what is there
#   chris-local/reset-seed.sh --sessions --yes     # remove the seeded sessions
#   chris-local/reset-seed.sh --accounts disable --yes
#   chris-local/reset-seed.sh --sessions --audit --invites --yes
#
# The full delivery-day procedure, including the volume-recreation route, is in
# chris-local/DEPLOY.md, "delivery reset".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${HERE}/docker-compose.ixauth.yml"
ENV_FILE="${HERE}/ixauth.env"
BASE_URL="http://127.0.0.1:18800"
APPLY=0
DO_SESSIONS=0
DO_AUDIT=0
DO_INVITES=0
ACCOUNTS_MODE="keep"

# The accounts every rehearsal creates. Names, not ids: ids differ per stack.
TEST_ACCOUNTS=(
  "solo" "nobody" "nobody-1" "nobody-2" "newjoiner" "invitee"
  "qamem" "mod" "member" "admin2" "exec1"
)
# Sessions to remove by key. Add one per --session-key, or edit this list for a stack
# whose seed differs. The main session of an agent is refused by the Gateway and is not
# listed here on purpose.
SESSION_KEYS=()

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --sessions) DO_SESSIONS=1 ;;
    --session-key) SESSION_KEYS+=("$2"); DO_SESSIONS=1; shift ;;
    --accounts) ACCOUNTS_MODE="$2"; shift ;;
    --account) TEST_ACCOUNTS=("$2"); shift ;;
    --audit) DO_AUDIT=1 ;;
    --invites) DO_INVITES=1 ;;
    --yes) APPLY=1 ;;
    --compose) COMPOSE_FILE="$2"; shift ;;
    --env-file) ENV_FILE="$2"; shift ;;
    --base-url) BASE_URL="$2"; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 2 ;;
  esac
  shift
done

case "${ACCOUNTS_MODE}" in
  keep|disable|delete) ;;
  *) echo "--accounts takes keep, disable or delete" >&2; exit 2 ;;
esac

[ -f "${ENV_FILE}" ] || { echo "missing env file: ${ENV_FILE}" >&2; exit 2; }
# Read one value out of the compose env file. It is not a shell script: values carry
# spaces and no quoting, so sourcing it turns a product name into a command.
env_value() {
  local raw
  raw="$(sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%'}"
  raw="${raw#'}"
  printf '%s' "${raw}"
}
ADMIN_EMAIL="$(env_value IXAUTH_ADMIN_EMAIL)"
ADMIN_PASSWORD="$(env_value IXAUTH_ADMIN_PASSWORD)"
[ -n "${ADMIN_EMAIL}" ] || { echo "set IXAUTH_ADMIN_EMAIL in ${ENV_FILE}" >&2; exit 2; }
[ -n "${ADMIN_PASSWORD}" ] || { echo "set IXAUTH_ADMIN_PASSWORD in ${ENV_FILE}" >&2; exit 2; }

COMPOSE=(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")
JAR="$(mktemp)"
trap 'rm -f "${JAR}"' EXIT

say() { printf '%s\n' "$*"; }
planned() { if [ "${APPLY}" -eq 1 ]; then say "  $*"; else say "  would $*"; fi; }

# --- sign in -----------------------------------------------------------------
# The Origin header is required: these routes refuse a browser-shaped request that
# does not name an allowed origin, and curl is browser-shaped enough to be checked.
login_body="$(
  curl -sS -X POST "${BASE_URL}/auth/login" \
    -H "Origin: ${BASE_URL}" -H "Content-Type: application/json" \
    -c "${JAR}" \
    --data "$(printf '{"email":"%s","password":"%s"}' "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}")"
)"
case "${login_body}" in
  *'"authenticated":true'*) ;;
  *) echo "sign-in failed: ${login_body}" >&2; exit 1 ;;
esac
CSRF="$(printf '%s' "${login_body}" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')"
# The session cookie is HttpOnly, which curl writes with a "#HttpOnly_" domain prefix.
# Skipping every line that starts with "#" would drop the one cookie that matters.
COOKIE_HEADER="$(awk 'NF == 7 && ($0 !~ /^#/ || $0 ~ /^#HttpOnly_/) { printf "%s=%s; ", $6, $7 }' "${JAR}")"
[ -n "${COOKIE_HEADER}" ] || { echo "no session cookie was set" >&2; exit 1; }
say "signed in as ${ADMIN_EMAIL}"

auth_get() { curl -sS "${BASE_URL}$1" -H "Origin: ${BASE_URL}" -b "${JAR}"; }
auth_send() {
  curl -sS -X "$1" "${BASE_URL}$2" -H "Origin: ${BASE_URL}" \
    -H "Content-Type: application/json" -H "x-openclaw-csrf: ${CSRF}" \
    -b "${JAR}" --data "${3:-{\}}"
}

# One Gateway RPC, made from inside the container with the cookie this script holds.
# See chris-local/reset-seed-rpc.mjs for why the bundled CLI cannot do this in ix-auth
# mode.
gateway_rpc() {
  RESET_SEED_COOKIE="${COOKIE_HEADER}" RESET_SEED_ORIGIN="${BASE_URL}" \
    "${COMPOSE[@]}" exec -T \
    -e RESET_SEED_COOKIE -e RESET_SEED_ORIGIN \
    gateway node - "$@" < "${HERE}/reset-seed-rpc.mjs"
}

# --- sessions ----------------------------------------------------------------
if [ "${DO_SESSIONS}" -eq 1 ]; then
  say "sessions:"
  if [ "${#SESSION_KEYS[@]}" -eq 0 ]; then
    say "  no --session-key given; nothing to remove"
  fi
  for key in ${SESSION_KEYS[@]+"${SESSION_KEYS[@]}"}; do
    planned "delete ${key}"
    if [ "${APPLY}" -eq 1 ]; then
      gateway_rpc "sessions.delete" \
        "$(printf '{"key":%s,"deleteTranscript":true}' "\"${key}\"")" >/dev/null
      say "  deleted ${key}"
    fi
  done
fi

# --- accounts ----------------------------------------------------------------
if [ "${ACCOUNTS_MODE}" != "keep" ]; then
  say "accounts (${ACCOUNTS_MODE}):"
  users_json="$(auth_get "/auth/admin/users?pageSize=200")"
  for name in "${TEST_ACCOUNTS[@]}"; do
    # Ids and emails sit next to each other in one object per user; take the id that
    # shares an object with this account name.
    entry="$(printf '%s' "${users_json}" \
      | tr '{' '\n' | grep -F "\"${name}@" || true)"
    [ -n "${entry}" ] || continue
    id="$(printf '%s' "${entry}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "${id}" ] || continue
    planned "${ACCOUNTS_MODE} ${name} (${id})"
    [ "${APPLY}" -eq 1 ] || continue
    if [ "${ACCOUNTS_MODE}" = "disable" ]; then
      auth_send PATCH "/auth/admin/users/${id}" '{"status":"DISABLED"}' >/dev/null
    else
      auth_send DELETE "/auth/admin/users/${id}" >/dev/null
    fi
    say "  ${ACCOUNTS_MODE}d ${name}"
  done
fi

# --- invitation links --------------------------------------------------------
if [ "${DO_INVITES}" -eq 1 ]; then
  say "invitation links:"
  invites="$(auth_get "/auth/admin/invites")"
  emails="$(printf '%s' "${invites}" | tr ',' '\n' \
    | sed -n 's/.*"email":"\([^"]*\)".*/\1/p')"
  if [ -z "${emails}" ]; then
    say "  none outstanding"
  fi
  for email in ${emails}; do
    planned "forget the link for ${email}"
    [ "${APPLY}" -eq 1 ] || continue
    auth_send DELETE "/auth/admin/invites" "$(printf '{"email":"%s"}' "${email}")" >/dev/null
  done
fi

# --- activity ledger ---------------------------------------------------------
# The ledger has no clearing route on purpose: it is an audit record, and nothing a
# screen offers should be able to erase it. Delivery reset is the one moment that is
# legitimate, so it happens here, explicitly, against the state database.
if [ "${DO_AUDIT}" -eq 1 ]; then
  say "activity ledger:"
  planned "clear audit_user_activity"
  if [ "${APPLY}" -eq 1 ]; then
    "${COMPOSE[@]}" exec -T gateway node -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.HOME + "/.openclaw/state/openclaw.sqlite");
      const before = db.prepare("select count(*) as n from audit_user_activity").get().n;
      db.prepare("delete from audit_user_activity").run();
      console.log("cleared " + before + " rows");
    '
  fi
fi

if [ "${APPLY}" -eq 0 ]; then
  say ""
  say "nothing was changed. Re-run with --yes to apply."
fi
