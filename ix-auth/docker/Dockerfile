# IX-Auth — 신규 프로젝트에 동봉되는 경량 인증 서버
#
# 기본 배포 형태를 Docker 이미지로 두는 이유: 앱이 파이썬이든 Node 든
# JRE 설치를 요구하지 않기 위해서다 (설계 문서 §9 R1).

# ── build ──
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /src

# 의존성 레이어를 먼저 굳혀 소스만 바뀔 때 재다운로드를 피한다
COPY gradle/ gradle/
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY config/ config/
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies --quiet || true

# settings.gradle.kts 가 include 한 모듈은 **전부** 있어야 한다.
#   · ix-auth-common — 서버가 implementation(project(":ix-auth-common")) 로 의존한다
#   · ix-auth-client-spring — 빌드하지는 않지만(:ix-auth-server:bootJar 만 돈다),
#     Gradle 9 는 include 된 프로젝트 디렉터리가 없으면 설정 단계에서 거부한다
#     ("Configuring project ':…' without an existing directory is not allowed")
# 둘 다 빠져 있어 원본 Dockerfile 로는 이미지가 만들어지지 않았다
# (2026-08-21 늘봄 PoC 실측 — 사본 Dockerfile 로 우회 중이었다)
COPY ix-auth-common/ ix-auth-common/
COPY ix-auth-client-spring/ ix-auth-client-spring/
COPY ix-auth-server/ ix-auth-server/
RUN ./gradlew --no-daemon :ix-auth-server:bootJar -x test -x checkstyleMain -x spotbugsMain

# ── runtime ──
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# root 로 돌리지 않는다
RUN addgroup -S ixauth && adduser -S -G ixauth ixauth
COPY --from=build /src/ix-auth-server/build/libs/ix-auth.jar app.jar
USER ixauth

EXPOSE 9100

# 컨테이너 메모리에 맞춰 힙을 잡는다 (기본 250~400MB 수준)
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC"

# jar 는 외부에 노출하지 않는다 (설계 불변식 4) — 헬스체크도 내부에서만
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- http://127.0.0.1:9100/health | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
