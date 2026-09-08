#!/bin/sh
# 진바이오 NAS 자동 배포. root 로 5분마다 cron 이 부른다.
#
#   /volume1/docker/openclaw/deploy.sh            평소 (바뀌었을 때만 움직인다)
#   /volume1/docker/openclaw/deploy.sh --force    태그가 그대로여도 다시 받고 재기동
#   /volume1/docker/openclaw/deploy.sh --status   지금 상태만 찍는다
#
# 하는 일은 하나다. ghcr 의 chris-main 태그가 가리키는 다이제스트와 지금 돌고 있는
# 이미지의 다이제스트를 견주어, 다르면 받아서 다시 띄운다. 같으면 아무것도 하지 않고
# 로그 한 줄만 남긴다. GitHub Actions 가 chris/main 푸시마다 그 태그를 옮기므로,
# 여기서 필요한 것은 "옮겨졌는지"를 보는 것뿐이다.
#
# 왜 git 이 아니라 다이제스트인가: NAS 에 git 도 Node 도 없고, 2코어로 게이트웨이
# 이미지를 빌드할 수도 없다. 이 호스트가 아는 것은 "레지스트리에 새 이미지가 있다"
# 까지이고, 그것으로 충분하다.
#
# POSIX sh 로 쓴다. DSM 6.2 에 bash 는 있지만 cron 이 주는 환경은 최소라, 셸 기능을
# 늘릴 이유가 없다. 쓰는 외부 명령은 curl, sed, docker, docker-compose 뿐이다.
#
# 설치·되돌리기: chris-local/DEPLOY.md 13절.
set -eu

ROOT=/volume1/docker/openclaw
COMPOSE_FILE="$ROOT/docker-compose.nas.yml"
ENV_FILE="$ROOT/ixauth.env"
PROJECT=openclaw-ixauth
PROFILE=tunnel
LOG="$ROOT/deploy.log"
LOCK="$ROOT/.deploy.lock"
LOG_MAX_BYTES=1048576

DOCKER_BIN=/var/packages/Docker/target/usr/bin/docker
COMPOSE_BIN=/var/packages/Docker/target/usr/bin/docker-compose
PATH="/var/packages/Docker/target/usr/bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin"
export PATH

GATEWAY_REPO=necromman/openclaw-gateway
IX_AUTH_REPO=necromman/openclaw-ix-auth
TAG=chris-main

force=0
status_only=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --status) status_only=1 ;;
    *)
      echo "unknown option: $arg" >&2
      exit 64
      ;;
  esac
done

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S %Z')  $*" >>"$LOG"
}

rotate_log() {
  [ -f "$LOG" ] || return 0
  size=$(wc -c <"$LOG" 2>/dev/null || echo 0)
  [ "$size" -gt "$LOG_MAX_BYTES" ] || return 0
  mv "$LOG" "$LOG.1"
  : >"$LOG"
}

compose() {
  "$COMPOSE_BIN" -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile "$PROFILE" "$@"
}

# ghcr 의 태그가 지금 가리키는 다이제스트. 공개 패키지라 익명 토큰으로 읽는다.
# Accept 헤더를 다 붙이는 이유: 붙이지 않으면 레지스트리가 옛 스키마1 매니페스트를
# 돌려주고 다이제스트가 로컬 것과 영영 달라 매번 재배포한다.
remote_digest() {
  repo="$1"
  token=$(curl -fsS "https://ghcr.io/token?scope=repository:${repo}:pull" |
    sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$token" ] || return 1
  curl -fsS -I \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/${repo}/manifests/${TAG}" |
    tr -d '\r' |
    sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: *//p' |
    tail -1
}

# 지금 이 호스트에 있는 같은 태그의 다이제스트. 이미지가 없으면 빈 문자열이다.
local_digest() {
  repo="$1"
  "$DOCKER_BIN" inspect --format '{{index .RepoDigests 0}}' "ghcr.io/${repo}:${TAG}" 2>/dev/null |
    sed -n 's/.*@//p'
}

# 컨테이너가 없으면 docker inspect 는 빈 줄을 내고 실패한다. 그 빈 줄이 그대로 나가면
# 상태 표시가 한 줄 어긋나고 비교도 빗나가므로 여기서 걸러 "missing" 으로 통일한다.
health_of() {
  state=$("$DOCKER_BIN" inspect --format '{{.State.Health.Status}}' "$1" 2>/dev/null | head -1)
  [ -n "$state" ] || state=missing
  echo "$state"
}

print_status() {
  for name in ix-auth-db ix-auth gateway cloudflared; do
    container="${PROJECT}_${name}_1"
    echo "  ${name}: $(health_of "$container")"
  done
  echo "  gateway image: $(local_digest "$GATEWAY_REPO")"
  echo "  ix-auth image: $(local_digest "$IX_AUTH_REPO")"
}

if [ "$status_only" = 1 ]; then
  print_status
  exit 0
fi

# 겹치기 방지. 이미지 받기와 재기동은 5분보다 오래 걸릴 수 있고, 그때 다음 cron 이
# 겹쳐 들어오면 같은 컨테이너를 두 번 내린다. mkdir 는 원자적이라 잠금으로 쓸 수 있다.
# 두 시간보다 오래된 잠금은 죽은 실행이 남긴 것으로 보고 걷어낸다.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -d "$LOCK" ] && [ -z "$(find "$LOCK" -maxdepth 0 -mmin -120 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

rotate_log

gateway_remote=$(remote_digest "$GATEWAY_REPO" || true)
ix_auth_remote=$(remote_digest "$IX_AUTH_REPO" || true)

if [ -z "$gateway_remote" ] || [ -z "$ix_auth_remote" ]; then
  log "FAIL: ghcr 다이제스트를 읽지 못했다 (네트워크 또는 패키지 공개 설정). 배포하지 않는다"
  exit 1
fi

gateway_local=$(local_digest "$GATEWAY_REPO")
ix_auth_local=$(local_digest "$IX_AUTH_REPO")

if [ "$force" = 0 ] &&
  [ "$gateway_remote" = "$gateway_local" ] &&
  [ "$ix_auth_remote" = "$ix_auth_local" ]; then
  log "변경 없음 (gateway ${gateway_local})"
  exit 0
fi

log "배포 시작: gateway ${gateway_local:-없음} -> ${gateway_remote}, ix-auth ${ix_auth_local:-없음} -> ${ix_auth_remote}, force=${force}"

# --quiet 를 준다. 주지 않으면 압축 해제 진행률이 1초에 수십 줄씩 로그로 들어가
# 7GB 이미지 한 번에 로그가 수 메가바이트가 된다.
if ! compose pull --quiet >>"$LOG" 2>&1; then
  log "FAIL: docker-compose pull 실패. 돌던 컨테이너는 그대로 둔다"
  exit 1
fi

if ! compose up -d --remove-orphans >>"$LOG" 2>&1; then
  log "FAIL: docker-compose up 실패"
  exit 1
fi

# 헬스 대기. 게이트웨이는 start_period 60초를 쓰므로 넉넉히 잡는다.
waited=0
while [ "$waited" -lt 300 ]; do
  state=$(health_of "${PROJECT}_gateway_1")
  case "$state" in
    healthy) break ;;
    missing)
      log "FAIL: 게이트웨이 컨테이너가 없다"
      exit 1
      ;;
  esac
  sleep 10
  waited=$((waited + 10))
done

state=$(health_of "${PROJECT}_gateway_1")
if [ "$state" != healthy ]; then
  log "WARN: 게이트웨이가 ${waited}초 안에 healthy 가 되지 않았다 (state=${state})"
else
  log "OK: 배포 완료 gateway ${gateway_remote} (헬스까지 ${waited}초)"
fi

# 갈려 나간 옛 이미지 정리. NAS 볼륨 여유는 넉넉하지만 7GB 짜리가 쌓이면 다르다.
# dangling 만 지우므로 태그가 붙은 다른 앱의 이미지는 건드리지 않는다.
"$DOCKER_BIN" image prune -f >>"$LOG" 2>&1 || true
