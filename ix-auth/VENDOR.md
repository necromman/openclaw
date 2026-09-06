# VENDOR: 이 디렉터리는 IX-Auth 의 벤더 복사본이다

이 트리는 별도 제품 **IX-Auth** 를 포크 저장소 안으로 들여온 것이다. 여기서 자유롭게 수정할 수 있고, 수정분은 포크와 함께 버전 관리된다. 원본 저장소는 그대로 남아 있고 이 복사본이 원본을 바꾸지 않는다.

수정 가능 범위와 지켜야 할 계약은 [MODULE.md](MODULE.md) 를 읽는다.

---

## 1. 복사 출처

| 항목 | 값 |
| --- | --- |
| 원본 경로 | `D:\PROJECT\ix-auth` (Windows 편집 체크아웃) |
| 원본 커밋 | `da66bda885dc27b4ea63c607264699263918fa35` |
| 원본 커밋 제목 | `feat(server): 연합 신원 교환 구현 - /auth/federated/exchange + V13 + SDK` |
| 복사 시각 | 2026-09-07 (KST, 일요일) |
| 복사 방식 | `git archive --format=tar HEAD` (원본에서 추적 중인 파일만) |
| 복사 결과 | 342 파일 / 약 3.0 MB |
| 벤더 위치 | `D:\PROJECT\openclaw\ix-auth\` |
| 포크 쪽 커밋 | 이 디렉터리를 처음 들여온 커밋 (`git log -- ix-auth/` 의 최초 항목) |

`git archive` 를 쓴 이유는 원본의 `.gitignore` 가 이미 걸러 둔 산출물(`build/`, `node_modules/`, `.gradle/`, `*.jar`)을 자동으로 제외하기 때문이다. 파일 목록을 손으로 고르지 않았으므로 누락·오탈이 없다.

## 2. 제외 목록

`git archive` 가 자동으로 제외한 것 (원본 `.gitignore` 기준):

| 제외 대상 | 이유 | 원본 크기 |
| --- | --- | --- |
| `.git/` | 별도 저장소 이력. 포크 이력과 섞으면 안 된다 | - |
| `build/`, `*/build/` | Gradle 산출물. 재생성 가능 | 약 70 MB |
| `.gradle/` | Gradle 로컬 캐시 | - |
| `**/node_modules/` | npm 산출물. 재생성 가능 | 약 49 MB (`packages/client-react`) |
| `**/dist/` | SDK 빌드 산출물 | - |
| `*.jar` (단 `gradle/wrapper/gradle-wrapper.jar` 은 유지) | 빌드 산출물 | - |
| `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/` | 시크릿. 원본에도 커밋돼 있지 않다 | - |
| `examples/react-demo/web/node_modules` | 데모 의존성 | 약 70 MB |

명시적으로 **추가 제외**한 것:

| 제외 대상 | 이유 |
| --- | --- |
| `.claude/` (23 파일) | 원본 프로젝트 전용 에이전트 지침·훅·`settings.json`. 포크 안에 두면 Claude Code 가 이 하위 트리에서 원본 프로젝트의 규칙과 훅을 로드해 포크 규칙과 충돌한다. 내용이 필요하면 원본 `D:\PROJECT\ix-auth\.claude\` 를 직접 읽는다. 그중 설계 불변식 4개는 [MODULE.md](MODULE.md) 에 요약해 두었다 |

**시크릿 점검 결과**: 복사한 트리에서 `password` / `secret` / `key` 문자열을 가진 설정 파일은 `ix-auth-server/src/main/resources/application.yml`, `docker/docker-compose.example.yml`, `.gitlab-ci.yml` 세 개뿐이고, **전부 `${IXAUTH_*}` 환경변수 자리표시자**다. 평문 값은 하나도 없어 제거할 것이 없었다. 예시 설정은 원본에서 이미 `*.example.yml` 로 분리돼 있다.

## 3. 포크 쪽에서 추가한 격리 설정

벤더 트리가 포크의 도구 체인에 잡히지 않게 다음을 추가했다. 이것은 포크 파일 수정이지 벤더 트리 수정이 아니다.

| 파일 | 추가 내용 | 이유 |
| --- | --- | --- |
| `.oxfmtrc.jsonc` | `ignorePatterns` 에 `"ix-auth/"` | `oxfmt --check` 는 인자 없이 저장소 전체를 훑는다. 벤더 트리를 재포맷하면 원본 대비 diff 가 전부 깨진다 |
| `.oxlintrc.json` | `ignorePatterns` 에 `"ix-auth/"` | 방어적 추가. oxlint 대상은 `src ui packages extensions scripts` 로 이미 한정돼 있다 |
| `.gitignore` | `/ix-auth/**/build/` 등 4줄 | `ix-auth/.gitignore` 가 이미 덮지만, 루트에서 `git add -A` 할 때 70 MB Gradle 트리가 절대 스테이징되지 않도록 이중으로 건다 |

**확인했고 손댈 필요가 없던 것** (경로 글롭이 저장소 루트에 고정돼 있어 `ix-auth/` 하위를 잡지 않는다):

| 도구 | 스캔 대상 |
| --- | --- |
| `pnpm-workspace.yaml` | `.`, `ui`, `packages/*`, `extensions/*`, `examples/*` - `ix-auth/packages/*` 는 매칭되지 않는다 |
| `tsconfig.json` / `tsconfig.core.json` | `src/**`, `ui/**`, `extensions/**`, `packages/**` |
| oxlint 샤드 | `src`, `ui`, `packages`, `extensions`, `scripts` |
| markdownlint (`lint:docs`) | `docs/**/*.md`, `docs/**/*.mdx`, `README.md` |
| `format:docs:check` | `git ls-files docs/**/*.md docs/**/*.mdx README.md` |
| `check-max-lines-ratchet` | `src`, `ui/src`, `packages`, `extensions` |
| `check-env-var-count` | `src`, `packages`, `extensions` |
| `check-import-cycles` | `src`, `extensions`, `scripts` |
| `check-madge-import-cycles` | `src`, `extensions`, `ui` |
| `check-database-first-legacy-stores` | `src`, `extensions`, `packages` |
| vitest 프로젝트 | `src/**`, `ui/src/**`, `extensions/**`, `test/**` |

## 4. 빌드

원본과 동일하다. JDK 21 이 필요하다 (`build.gradle.kts` 의 `JavaLanguageVersion.of(21)`).

```bash
export JAVA_HOME=$HOME/tools/jdk21     # Temurin 21 (sudo 없이 설치한 경로)
export PATH=$JAVA_HOME/bin:$PATH
./gradlew :ix-auth-server:bootJar
# 산출물: ix-auth-server/build/libs/ix-auth-server-<version>.jar
```

**빌드는 `/mnt/d/...` 에서 하지 않는다.** WSL 에서 Windows 파일시스템을 거치면 Gradle 이 매우 느리고 파일 잠금 문제가 난다. WSL 로컬 경로로 복사해 빌드한다.

```bash
rm -rf ~/ix-auth-build && mkdir -p ~/ix-auth-build
cd /mnt/d/PROJECT/openclaw/ix-auth
tar -cf - --exclude=.git --exclude=build --exclude=node_modules . | tar -xf - -C ~/ix-auth-build
cd ~/ix-auth-build && ./gradlew --no-daemon :ix-auth-server:bootJar
```

**산출 jar 는 커밋하지 않는다.** Spring Boot fat jar 는 70 MB 를 넘는다. 배포는 컨테이너 이미지(`ix-auth/docker/Dockerfile`)로 하고, 로컬 검증은 위 절차로 그때그때 만든다.

## 5. 원본과 재동기화하는 법

원본 `D:\PROJECT\ix-auth` 가 앞서 나가면 그 변경분만 이 트리로 가져온다. **원본에서 이쪽으로만 흐른다.** 포크에서 고친 것을 원본에 되돌리려면 원본 저장소에서 별도 MR 을 낸다.

### 5.1 원본이 무엇을 바꿨는지 본다

```bash
cd /d/PROJECT/ix-auth
git fetch --all
git log --oneline da66bda885dc27b4ea63c607264699263918fa35..HEAD
git diff --stat da66bda885dc27b4ea63c607264699263918fa35..HEAD
```

`da66bda...` 는 이 문서 1절의 "원본 커밋" 이다. **재동기화할 때마다 이 값을 새 커밋으로 갱신한다.**

### 5.2 패치로 가져온다 (권장)

```bash
cd /d/PROJECT/ix-auth
git diff da66bda885dc27b4ea63c607264699263918fa35..HEAD -- . \
  ':(exclude).claude' > /tmp/ix-auth-sync.patch

cd /d/PROJECT/openclaw/ix-auth
git apply --3way --directory=ix-auth /tmp/ix-auth-sync.patch
```

`--3way` 는 포크 쪽 수정과 충돌하면 충돌 표식을 남긴다. 충돌은 [MODULE.md](MODULE.md) 의 "포크가 수정해도 되는 영역" 기준으로 푼다.

### 5.3 전량 교체가 필요할 때

포크 쪽 수정이 없거나 전부 버려도 되는 상황에서만 쓴다.

```bash
cd /d/PROJECT/openclaw && rm -rf ix-auth && mkdir ix-auth
cd /d/PROJECT/ix-auth && git archive --format=tar HEAD | tar -x -C /d/PROJECT/openclaw/ix-auth
cd /d/PROJECT/openclaw/ix-auth && rm -rf .claude
```

그 다음 이 문서 1절의 커밋 해시·시각을 갱신하고, `git diff` 로 포크 쪽 수정이 날아가지 않았는지 확인한다.

### 5.4 재동기화 후 필수 확인

```bash
cd /d/PROJECT/openclaw
pnpm check                       # 0 실패 (벤더 트리가 도구 체인에 새지 않았는지)
git status --porcelain ix-auth/  # build/ node_modules/ 가 스테이징되지 않았는지
```

그리고 `ix-auth/docs/contract/` 가 바뀌었으면 포크 쪽 연동 코드(`src/auth/ix-auth/`)를 함께 고친다. 계약 변경은 조용히 지나가지 않게 [MODULE.md](MODULE.md) 의 계약 변경 절차를 따른다.

## 6. 이 트리를 지우는 법 (되돌리기)

포크가 IX-Auth 연동을 포기하는 경우:

```bash
cd /d/PROJECT/openclaw
git rm -r ix-auth
# .oxfmtrc.jsonc, .oxlintrc.json, .gitignore 에서 ix-auth 항목 제거
# gateway.auth.mode 를 token 또는 trusted-proxy 로 되돌리고 auth.ixAuth 블록 삭제
```

원본 `D:\PROJECT\ix-auth` 는 영향받지 않는다.
