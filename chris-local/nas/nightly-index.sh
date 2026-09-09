#!/bin/sh
# 진바이오 NAS 야간 색인. root 로 하루 한 번 cron 이 부른다.
#
#   /volume1/docker/openclaw/nightly-index.sh              평소 (새벽 cron)
#   /volume1/docker/openclaw/nightly-index.sh --tree-only  폴더 트리만 다시 훑는다
#   /volume1/docker/openclaw/nightly-index.sh --dry-run    문서 색인 계획만 낸다
#
# 두 가지를 순서대로 한다.
#   1) 폴더 트리 훑기 (openclaw folders scan). 폴더 화면이 NAS 를 직접 읽지 않고
#      이 결과를 읽는다. 공유 9개 전부를 훑는다.
#   2) 문서 사이드카 색인 (openclaw knowledge sync) + 메모리 재색인. 아래 SHARES 에
#      적힌 공유만 돈다. 공유 하나가 파일 4만 개라 전부 켜면 밤 한 번에 끝나지 않는다.
#
# 왜 새벽인가: 이 NAS 는 2코어이고 낮에는 회사의 파일 서버다. 문서 변환은 코어를
# 오래 물고 있어서 업무 시간에 돌리면 사람이 파일을 여는 속도가 같이 느려진다.
#
# 왜 컨테이너 안 CLI 인가: ix-auth 모드에서 컨테이너 안 openclaw 는 게이트웨이 RPC 가
# unauthorized 라 cron 등록 자체가 막힌다(DEPLOY.md 12.3). 반대로 이 두 명령은 RPC 를
# 쓰지 않고 폴더와 상태 DB 만 만지므로 그대로 돈다. 그래서 일정을 호스트로 뺀다.
#
# POSIX sh. deploy.sh 와 같은 잠금·로그 회전 규칙을 쓰고, 잠금도 로그도 따로 둔다.
# deploy.sh 와 겹쳐 돌아도 서로를 막지 않는다(다른 잠금이다). 실패하면 그날은 거기서
# 멈추고 다음 날 다시 돈다. 되돌아가 고치지 않는다.
#
# 설치·되돌리기: chris-local/DEPLOY.md 12절.
set -eu

ROOT=/volume1/docker/openclaw
PROJECT=openclaw-ixauth
CONTAINER="${PROJECT}_gateway_1"
LOG="$ROOT/nightly-index.log"
LOCK="$ROOT/.nightly-index.lock"
LOG_MAX_BYTES=1048576

DOCKER_BIN=/var/packages/Docker/target/usr/bin/docker
PATH="/var/packages/Docker/target/usr/bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin"
export PATH

# 색인할 공유. 공유 이름 하나가 한 줄이고, 컨테이너 안 경로는
# /mnt/nas/<이름> -> /mnt/knowledge/<이름> 로 짝이 정해져 있다.
#
# 지금은 00_공용폴더 하나다. 나머지 여덟은 개인·거래처 공유라 폴더 규칙이 아무에게도
# 열어 주지 않았고, 열어 주지 않은 폴더는 색인하지 않는 것이 이 제품의 규칙이다
# (KNOWLEDGE.md 8-1). 인사·급여가 들어 있는 01_이화정 이 특히 그렇다. 사이드카는
# 사람별 필터가 없는 공용 풀에 쌓이므로, 민감 공유는 색인하지 않고 관리자가 파일을
# 직접 연다. 공유를 늘리려면 여기에 한 줄 더하고 먼저 --dry-run 으로 규모를 본다.
SHARES="00_공용폴더"

tree_only=0
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --tree-only) tree_only=1 ;;
    --dry-run) dry_run=1 ;;
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

in_container() {
  "$DOCKER_BIN" exec "$CONTAINER" sh -lc "$1" >>"$LOG" 2>&1
}

# 겹치기 방지. 첫 색인은 몇 시간이 걸릴 수 있고, 겹쳐 돌면 같은 파일을 두 번 변환하며
# 2코어를 통째로 잡는다. mkdir 는 원자적이라 잠금으로 쓸 수 있다. 여섯 시간보다 오래된
# 잠금은 죽은 실행이 남긴 것으로 보고 걷어낸다(색인은 배포보다 오래 걸린다).
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -d "$LOCK" ] && [ -z "$(find "$LOCK" -maxdepth 0 -mmin -360 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    log "SKIP: 앞의 실행이 아직 돌고 있다"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

rotate_log

state=$("$DOCKER_BIN" inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null | head -1)
if [ "$state" != running ]; then
  log "SKIP: 게이트웨이 컨테이너가 running 이 아니다 (state=${state:-missing})"
  exit 0
fi

started=$(date '+%s')
log "시작 (tree_only=${tree_only}, dry_run=${dry_run})"

# 1) 폴더 트리. 공유 전체라 몇십 초로 끝난다. 실패해도 문서 색인은 이어서 한다.
if in_container "openclaw folders scan --concurrency 2 --quiet"; then
  log "폴더 트리 훑기 완료"
else
  log "WARN: 폴더 트리 훑기 실패. 폴더 화면은 저장본이 없는 가지에서 NAS 를 직접 읽는다"
fi

if [ "$tree_only" = 1 ]; then
  log "완료 (트리만, $(($(date '+%s') - started))초)"
  exit 0
fi

# 2) 문서 사이드카. 공유 하나씩 돌고, 하나가 실패해도 다음 공유는 돈다.
failed=0
for share in $SHARES; do
  out="/mnt/knowledge/${share}"
  log "색인 시작: ${share}"
  if [ "$dry_run" = 1 ]; then
    in_container "openclaw knowledge sync --source '/mnt/nas/${share}' --out '${out}' --dry-run" ||
      failed=1
    continue
  fi
  if in_container "mkdir -p '${out}' && openclaw knowledge sync --source '/mnt/nas/${share}' --out '${out}'"; then
    log "색인 완료: ${share}"
  else
    log "FAIL: 색인 실패 ${share}. 다음 주기에 다시 시도한다"
    failed=1
  fi
done

if [ "$dry_run" = 1 ]; then
  log "완료 (dry-run, $(($(date '+%s') - started))초)"
  exit "$failed"
fi

# 3) 사이드카를 메모리 색인기에 알린다. 이 단계를 빼면 사이드카가 있어도 검색에
# 걸리지 않는다(KNOWLEDGE.md 7.2).
if in_container "openclaw memory index --force --agent main"; then
  log "메모리 재색인 완료"
else
  log "FAIL: 메모리 재색인 실패"
  failed=1
fi

log "완료 ($(($(date '+%s') - started))초, failed=${failed})"
exit "$failed"
