#!/usr/bin/env bash
# Bring up a throwaway IX-Auth stack and a second Gateway profile for manual verification.
#
# It leaves the everyday gateway on 18789 alone: this starts a separate profile on 18791
# with gateway.auth.mode set to ix-auth, plus PostgreSQL and the identity server in Docker.
#
#   ./chris-local/ixauth-verify.sh up      # postgres + ix-auth + gateway on 18791
#   ./chris-local/ixauth-verify.sh status
#   ./chris-local/ixauth-verify.sh logs
#   ./chris-local/ixauth-verify.sh down    # stop everything and delete the profile
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_HOME="${IXAUTH_VERIFY_HOME:-$HOME/openclaw-ixauth}"
GATEWAY_PORT="${IXAUTH_VERIFY_GATEWAY_PORT:-18791}"
IXAUTH_PORT="${IXAUTH_VERIFY_IXAUTH_PORT:-19100}"
PG_PORT="${IXAUTH_VERIFY_PG_PORT:-15432}"
STACK="openclaw-ixauth-verify"
SECRETS_FILE="$PROFILE_HOME/verify-secrets.env"

log() { printf '[ixauth-verify] %s\n' "$*"; }

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
}

# Secrets are generated once and reused so a restart does not invalidate the signing
# keys or the seeded administrator password.
load_or_create_secrets() {
  mkdir -p "$PROFILE_HOME"
  if [ ! -f "$SECRETS_FILE" ]; then
    log "generating verification secrets in $SECRETS_FILE"
    umask 077
    cat > "$SECRETS_FILE" <<EOF
IXAUTH_DB_PASSWORD=$(openssl rand -hex 24)
IXAUTH_SERVICE_KEY=$(openssl rand -hex 32)
IXAUTH_ADMIN_EMAIL=admin@verify.local
IXAUTH_ADMIN_PASSWORD=Verify-$(openssl rand -hex 8)!aA1
EOF
  fi
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
}

write_gateway_config() {
  mkdir -p "$PROFILE_HOME/.openclaw"
  cat > "$PROFILE_HOME/.openclaw/openclaw.json" <<EOF
{
  "gateway": {
    "port": $GATEWAY_PORT,
    "auth": {
      "mode": "ix-auth",
      "ixAuth": {
        "baseUrl": "http://127.0.0.1:$IXAUTH_PORT",
        "serviceKey": "$IXAUTH_SERVICE_KEY",
        "issuer": "http://127.0.0.1:$GATEWAY_PORT",
        "audience": "openclaw",
        "adminConsoleUrl": "http://127.0.0.1:$IXAUTH_PORT/admin-ui",
        "roleMap": {
          "SUPERADMIN": "superadmin",
          "ADMIN": "admin",
          "EXECUTIVE": "executive",
          "MODERATOR": "moderator",
          "MEMBER": "member"
        },
        "superAdminRoles": ["superadmin"]
      }
    },
    "roles": {
      "default": "member",
      "definitions": {
        "superadmin": { "sessions": { "others": "write" }, "agents": "*", "scopes": ["operator.admin"] },
        "admin": {
          "sessions": { "others": "write" },
          "scopes": ["operator.read", "operator.write", "operator.approvals", "operator.questions"]
        },
        "executive": {
          "sessions": { "others": "view" },
          "scopes": ["operator.read", "operator.write", "operator.questions"]
        },
        "moderator": {
          "sessions": { "others": "suggest" },
          "scopes": ["operator.read", "operator.write", "operator.approvals", "operator.questions"]
        },
        "member": {
          "sessions": { "others": "view" },
          "scopes": ["operator.read", "operator.write", "operator.questions"]
        }
      }
    }
  },
  "tools": { "sessions": { "visibility": "self" } }
}
EOF
}

start_identity_stack() {
  require_docker
  docker rm -f "$STACK-db" "$STACK-app" >/dev/null 2>&1 || true
  docker network create "$STACK-net" >/dev/null 2>&1 || true

  log "starting postgres on $PG_PORT"
  docker run -d --name "$STACK-db" --network "$STACK-net" \
    -e POSTGRES_DB=ixauth -e POSTGRES_USER=ixauth \
    -e POSTGRES_PASSWORD="$IXAUTH_DB_PASSWORD" \
    -p "127.0.0.1:$PG_PORT:5432" postgres:16-alpine >/dev/null

  log "waiting for postgres"
  for _ in $(seq 1 60); do
    if docker exec "$STACK-db" pg_isready -U ixauth -d ixauth >/dev/null 2>&1; then break; fi
    sleep 1
  done

  if ! docker image inspect "$STACK-image" >/dev/null 2>&1; then
    log "building the identity server image (first run only, several minutes)"
    docker build -t "$STACK-image" -f "$REPO_ROOT/ix-auth/docker/Dockerfile" "$REPO_ROOT/ix-auth"
  fi

  log "starting the identity server on $IXAUTH_PORT"
  # The port is published only on loopback, and only so the verification gateway
  # running outside Docker can reach it. A real deployment publishes nothing.
  docker run -d --name "$STACK-app" --network "$STACK-net" \
    -e IXAUTH_DB_URL="jdbc:postgresql://$STACK-db:5432/ixauth" \
    -e IXAUTH_DB_USERNAME=ixauth \
    -e IXAUTH_DB_PASSWORD="$IXAUTH_DB_PASSWORD" \
    -e IXAUTH_SERVICE_KEY="$IXAUTH_SERVICE_KEY" \
    -e IXAUTH_JWT_ISSUER="http://127.0.0.1:$GATEWAY_PORT" \
    -e IXAUTH_JWT_AUDIENCE=openclaw \
    -e IXAUTH_ADMIN_EMAIL="$IXAUTH_ADMIN_EMAIL" \
    -e IXAUTH_ADMIN_PASSWORD="$IXAUTH_ADMIN_PASSWORD" \
    -e IXAUTH_MAIL_TRANSPORT=LOG \
    -e IXAUTH_MAIL_APP_BASE_URL="http://127.0.0.1:$GATEWAY_PORT" \
    -e IXAUTH_ADMIN_UI_ENABLED=true \
    -p "127.0.0.1:$IXAUTH_PORT:9100" "$STACK-image" >/dev/null

  log "waiting for the identity server"
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$IXAUTH_PORT/health" >/dev/null 2>&1; then break; fi
    sleep 1
  done
}

start_gateway() {
  log "starting the verification gateway on $GATEWAY_PORT"
  mkdir -p "$PROFILE_HOME"
  ( cd "$REPO_ROOT" \
    && OPENCLAW_HOME="$PROFILE_HOME" \
       OPENCLAW_CONFIG_PATH="$PROFILE_HOME/.openclaw/openclaw.json" \
       OPENCLAW_STATE_DIR="$PROFILE_HOME/.openclaw" \
       nohup ./openclaw.mjs gateway > "$PROFILE_HOME/gateway.log" 2>&1 & echo $! > "$PROFILE_HOME/gateway.pid" )
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null 2>&1; then break; fi
    sleep 1
  done
}

case "${1:-status}" in
  up)
    load_or_create_secrets
    write_gateway_config
    start_identity_stack
    start_gateway
    log "identity console: http://127.0.0.1:$IXAUTH_PORT/admin-ui"
    log "control ui:       http://127.0.0.1:$GATEWAY_PORT/"
    log "seeded admin:     $IXAUTH_ADMIN_EMAIL  (password in $SECRETS_FILE)"
    ;;
  status)
    docker ps --filter "name=$STACK" --format '  {{.Names}} {{.Status}}' || true
    curl -s -o /dev/null -w "  ix-auth  http=%{http_code}\n" --max-time 5 \
      "http://127.0.0.1:$IXAUTH_PORT/health" || true
    curl -s -o /dev/null -w "  gateway  http=%{http_code}\n" --max-time 5 \
      "http://127.0.0.1:$GATEWAY_PORT/health" || true
    curl -s -o /dev/null -w "  auth/me  http=%{http_code}\n" --max-time 5 \
      "http://127.0.0.1:$GATEWAY_PORT/auth/me" || true
    ;;
  logs)
    docker logs --tail "${2:-60}" "$STACK-app" 2>&1 || true
    echo "--- gateway ---"
    tail -n "${2:-60}" "$PROFILE_HOME/gateway.log" 2>/dev/null || true
    ;;
  down)
    [ -f "$PROFILE_HOME/gateway.pid" ] && kill "$(cat "$PROFILE_HOME/gateway.pid")" 2>/dev/null || true
    rm -f "$PROFILE_HOME/gateway.pid"
    docker rm -f "$STACK-db" "$STACK-app" >/dev/null 2>&1 || true
    docker network rm "$STACK-net" >/dev/null 2>&1 || true
    log "stopped. profile kept at $PROFILE_HOME (delete it to reset)"
    ;;
  *)
    echo "usage: $0 {up|status|logs [n]|down}" >&2
    exit 2
    ;;
esac
