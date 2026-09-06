#!/usr/bin/env bash
# IX-Auth 데모를 한 번에 띄운다 — DB → jar → BFF → Vite.
#
#   ./run-demo.sh          기동
#   ./run-demo.sh stop     정리
#
# 기본 포트: DB 55432 · IX-Auth 59100 · BFF 58080 · 화면 55173
# (개발 PC 의 흔한 포트와 겹치지 않게 높은 번호를 쓴다)

set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

DB_PORT=55432
JAR_PORT=59100
BFF_PORT=58080
WEB_PORT=55173
SERVICE_KEY="demo-service-key-at-least-32-characters"
ADMIN_EMAIL="admin@demo.local"
ADMIN_PASSWORD='Dem0!Passw0rd'
LOG_DIR="${TMPDIR:-/tmp}"

kill_port() {
  local pid
  pid=$(netstat -ano 2>/dev/null | grep ":$1 " | grep LISTENING | awk '{print $5}' | head -1 || true)
  [ -n "${pid:-}" ] && { taskkill //F //PID "$pid" >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null; } || true
}

stop() {
  echo "정리 중..."
  for p in $WEB_PORT $BFF_PORT $JAR_PORT; do kill_port "$p"; done
  docker rm -f ixauth-demo-db >/dev/null 2>&1 || true
  echo "완료."
}

[ "${1:-}" = "stop" ] && { stop; exit 0; }

trap 'echo; echo "중단됨. 정리하려면: ./run-demo.sh stop"' INT

echo "① PostgreSQL"
docker rm -f ixauth-demo-db >/dev/null 2>&1 || true
docker run -d --name ixauth-demo-db \
  -e POSTGRES_DB=demoapp -e POSTGRES_USER=demoapp -e POSTGRES_PASSWORD=demo-pass \
  -p ${DB_PORT}:5432 postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec ixauth-demo-db pg_isready -U demoapp >/dev/null 2>&1 && break
  sleep 1
done
echo "   준비 완료 (:${DB_PORT})"

echo "② IX-Auth jar"
[ -f "$ROOT/ix-auth-server/build/libs/ix-auth.jar" ] || (cd "$ROOT" && ./gradlew :ix-auth-server:bootJar -q)
kill_port $JAR_PORT

# Java 21 을 찾는다. 시스템 java 가 17 이어도 Gradle toolchain 이 받아둔 21 을 쓴다
JAVA_BIN="java"
if ! java -version 2>&1 | grep -qE '"(21|22|23|24)'; then
  for d in "$HOME"/.gradle/jdks/*21*/ "$HOME"/.gradle/jdks/*21*/*/; do
    [ -x "${d}bin/java" ] && { JAVA_BIN="${d}bin/java"; break; }
  done
fi
"$JAVA_BIN" -version 2>&1 | head -1 | sed 's/^/   /'
IXAUTH_DB_URL="jdbc:postgresql://localhost:${DB_PORT}/demoapp" \
IXAUTH_DB_USERNAME=demoapp IXAUTH_DB_PASSWORD=demo-pass \
IXAUTH_JWT_ISSUER=https://demo.local \
IXAUTH_SERVICE_KEY="$SERVICE_KEY" \
IXAUTH_ADMIN_EMAIL="$ADMIN_EMAIL" IXAUTH_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
IXAUTH_PORT=$JAR_PORT \
nohup "$JAVA_BIN" -jar "$ROOT/ix-auth-server/build/libs/ix-auth.jar" > "$LOG_DIR/ixauth-demo-jar.log" 2>&1 &
for _ in $(seq 1 60); do
  curl -s -m 2 "http://localhost:${JAR_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
echo "   $(curl -s -m 3 http://localhost:${JAR_PORT}/health)"

echo "③ BFF"
[ -d server/node_modules ] || (cd server && npm install --silent)
kill_port $BFF_PORT
# APP_BASE_URL 은 소셜 콜백(Redirect URI)의 뿌리다 — BFF 포트가 아니라
# 브라우저가 실제로 여는 화면 주소여야 한다 (Vite 가 /oauth 를 BFF 로 프록시한다)
(cd server && IXAUTH_BASE_URL="http://localhost:${JAR_PORT}" \
  IXAUTH_SERVICE_KEY="$SERVICE_KEY" IXAUTH_JWT_ISSUER=https://demo.local \
  APP_BASE_URL="http://localhost:${WEB_PORT}" \
  PORT=$BFF_PORT nohup node src/index.js > "$LOG_DIR/ixauth-demo-bff.log" 2>&1 &)
sleep 3
echo "   $(curl -s -m 3 http://localhost:${BFF_PORT}/api/ixauth-status)"

echo "④ 데모 데이터 시드"
seed() {
  local token uid
  token=$(curl -s -X POST "http://localhost:${JAR_PORT}/auth/login" \
    -H "Content-Type: application/json" -H "X-IxAuth-Key: $SERVICE_KEY" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
  [ -z "$token" ] && { echo "   시드 건너뜀 (로그인 실패)"; return; }

  uid=$(curl -s -H "Authorization: Bearer $token" \
    "http://localhost:${JAR_PORT}/admin/users?q=${ADMIN_EMAIL}" \
    | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' | head -1)

  post() {
    curl -s -o /dev/null -X POST "http://localhost:${JAR_PORT}$1" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $token" -d "$2"
  }
  # L1 — 화면에서 '권한 부여 전/후' 를 비교해 볼 수 있게 reports 는 일부러 미부여로 둔다
  post /admin/permissions '{"code":"page:reports:view","description":"리포트 조회"}'

  # L2 — 상속(ALLOW)과 그 예외(DENY) 를 한눈에 보여주는 조합
  post /admin/resource-grants "{\"subjectType\":\"USER\",\"subjectId\":${uid},\"resourceType\":\"file\",\"resourceKey\":\"/contracts/\",\"action\":\"download\",\"effect\":\"ALLOW\"}"
  post /admin/resource-grants "{\"subjectType\":\"USER\",\"subjectId\":${uid},\"resourceType\":\"file\",\"resourceKey\":\"/contracts/secret/\",\"action\":\"download\",\"effect\":\"DENY\"}"
  echo "   권한 코드 1건 · 파일 권한 2건 (ALLOW /contracts/ · DENY /contracts/secret/)"
}
seed

echo "⑤ 화면"
[ -d web/node_modules ] || (cd web && npm install --silent)
kill_port $WEB_PORT
# BFF_PORT 를 넘겨야 프록시가 이 스크립트가 띄운 BFF 를 본다 (vite.config.ts 주석 참조)
(cd web && BFF_PORT=$BFF_PORT WEB_PORT=$WEB_PORT \
  nohup npx vite --port $WEB_PORT --strictPort > "$LOG_DIR/ixauth-demo-vite.log" 2>&1 &)
sleep 5

cat <<EOF

준비 완료.

  화면        http://localhost:${WEB_PORT}
  관리 콘솔    http://localhost:${JAR_PORT}/admin-ui
  계정        ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}

해볼 것
  1) 파일 권한 (L2 — 경로 상속)
       /contracts/2026/a.pdf    → 허용 (상위 /contracts/ 권한 상속)
       /contracts/secret/x.pdf  → 거부 (하위 폴더 DENY 가 상속을 이긴다)
       /nowhere/z.pdf           → 거부 (권한 없음)

  2) jar 를 꺼도 로그인 세션이 유지되는지
       netstat -ano | grep :${JAR_PORT}  로 PID 확인 후 종료
       → 상태 배지는 '응답 없음' 이 되지만 로그인·권한 판정은 그대로 동작한다

  3) 권한을 부여하면 화면이 열리는지
       관리 콘솔에서 ADMIN 역할에 page:reports:view 를 부여 → 재로그인
       → '보호된 API' 의 두 번째 버튼이 403 에서 200 으로 바뀐다

정리:  ./run-demo.sh stop
EOF
