# MODULE: 포크가 이 벤더 트리를 어떻게 다루는가

복사 출처·제외 목록·재동기화 절차는 [VENDOR.md](VENDOR.md) 에 있다. 이 문서는 **무엇을 고쳐도 되고 무엇을 고치면 안 되는가**를 정한다.

---

## 1. 한 줄 요약

IX-Auth 는 포크의 **신원 공급자**다. 포크(OpenClaw Gateway)는 BFF 로서 IX-Auth 를 중계하고, 브라우저는 IX-Auth 를 직접 보지 않는다. 두 제품의 접점은 오직 [`docs/contract/`](docs/contract/) 의 HTTP 계약과 JWT 형식이다.

## 2. 세 구역

| 구역 | 경로 | 포크가 고쳐도 되나 |
| --- | --- | --- |
| **A. 계약** | `docs/contract/http-api.md`, `token.md`, `authz.md`, `errors.md`, `config.md` | **안 된다.** 원본이 정본이다. 고쳐야 하면 3절 절차 |
| **B. 구현** | `ix-auth-server/src/`, `ix-auth-common/`, `db/migration/` | **된다.** 계약을 지키는 한 자유롭게 |
| **C. 주변부** | `docker/`, `examples/`, `packages/client-*`, `reference/`, `conformance/` | **된다.** 다만 4절의 삭제 후보를 먼저 본다 |

### 2.1 구역 A 를 건드리면 안 되는 이유

계약이 갈라지면 재동기화(VENDOR.md 5절)에서 매번 충돌하고, 원본을 쓰는 다른 납품(ax-connect, IX-Trust 계열)과 SDK 4종이 이 포크와 어긋난다. 계약은 **읽기 전용 사양서**로 취급한다.

포크가 계약에 없는 동작이 필요하면 두 가지 중 하나다.

1. 포크 쪽(`src/auth/ix-auth/`)에서 기존 계약을 조합해 해결한다. 대부분 여기서 끝난다.
2. 정말 서버 변경이 필요하면 3절.

### 2.2 구역 B 에서 자주 손댈 만한 곳

| 대상 | 상황 |
| --- | --- |
| `application.yml` 기본값 | 포크 배포에 맞는 TTL, 잠금 임계값, 가입 모드 |
| `db/migration/postgresql/` | 포크 전용 컬럼이 필요할 때 (새 버전 번호로만 추가, 기존 마이그레이션 수정 금지) |
| 관리 콘솔(`admin-ui`) 문구 | 포크 브랜딩에 맞춘 표기 |
| 로깅·감사 필드 | 포크 감사 원장과 대조하기 쉽게 |

## 3. 계약을 바꿔야 할 때 (구역 A)

```text
1. 원본 D:\PROJECT\ix-auth 에서 먼저 고친다 (그쪽 contract-policy 절차를 따른다)
2. 원본에 머지된 뒤 VENDOR.md 5절로 이 트리에 가져온다
3. 포크 쪽 연동 코드(src/auth/ix-auth/)를 같은 커밋에서 함께 고친다
4. 이 문서 6절 "포크 로컬 델타" 표에 기록한다
```

**급해서 벤더 트리에서 먼저 고쳐야 한다면**, 그 자리에 `// OPENCLAW-FORK-DELTA:` 주석을 남기고 6절 표에 반드시 적는다. 표에 없는 델타는 다음 재동기화에서 조용히 사라진다.

## 4. 포크에서 쓰지 않는 부분

지금 지우지는 않는다. 재동기화 diff 를 깨끗하게 유지하는 편이 이득이 크다. 다만 **포크는 이것들을 실행 경로에 넣지 않는다.**

| 경로 | 상태 |
| --- | --- |
| `packages/client-node`, `client-python`, `client-react` | **쓰지 않는다.** 포크는 `node:crypto` 로 JWKS 검증을 직접 한다 (사유는 5절) |
| `ix-auth-client-spring/` | 쓰지 않는다. 포크에 Spring 이 없다 |
| `examples/react-demo/` | 참조용. `web/src/TokenPages.tsx` 는 메일 링크 도착 화면 3개의 참조 구현이라 남겨 둘 값어치가 있다 |
| `conformance/` | 원본의 적합성 검사. 포크 CI 에서 돌리지 않는다 |
| `.gitlab-ci.yml` | 원본 저장소용. 포크 안에서는 무동작 |

## 5. 포크가 SDK 패키지를 쓰지 않는 이유

`packages/client-node` (`@ix-auth/client-node`) 는 이 연동에 딱 맞아 보이지만 의존성으로 넣지 않는다.

1. `package.json` 의 `"license": "UNLICENSED"` 가 포크의 `THIRD_PARTY_NOTICES.md` 및 의존성 감사와 충돌한다.
2. Express 미들웨어 전제인데 포크는 `node:http` + `ws` 를 직접 쓴다.
3. 유일한 실질 의존성이 `jose` 인데, 포크에 새 npm 의존성을 들이면 번들·의존성 래칫을 건드린다. RS256/JWKS 검증은 `node:crypto` 의 `createPublicKey({ format: "jwk" })` + `verify()` 로 충분하다.

대신 **[`docs/contract/token.md`](docs/contract/token.md) 를 정본으로 삼고 SDK 는 참조 구현으로 읽는다.** 특히 `packages/client-node/src/client-ip.js` 의 실방문자 IP 추출 순서(`CF-Connecting-IP` -> `True-Client-IP` -> `X-Forwarded-For` 첫 조각 -> `X-Real-IP` -> 소켓 주소)는 포크가 반드시 같은 순서를 지켜야 하는 부분이다. 포크에는 같은 일을 하는 `src/gateway/ingress-attribution.ts` 와 `src/gateway/net.ts` 가 이미 있으므로 그쪽을 쓴다.

## 6. 포크 로컬 델타

원본과 달라진 부분을 여기에 적는다. 비어 있으면 벤더 트리가 원본과 완전히 같다는 뜻이다.

| 파일 | 델타 | 사유 | 원본 반영 계획 |
| --- | --- | --- | --- |
| (트리 자체는 원본 `da66bda` 와 동일) | `.claude/` 제외만 | VENDOR.md 2절 | 해당 없음 |
| `db/migration/{postgresql,mariadb,mysql}/V14__openclaw_role_tiers.sql` | 신규. 역할 `SUPERADMIN`·`MODERATOR`·`MEMBER` 시드 + SUPERADMIN 에 `ixauth:*:*` 부여 | 원본 기본 역할은 `ADMIN`/`USER` 뿐이라 포크의 4단계 `roleMap` 이 비어 떨어진다. 무인 설치 한 번으로 권한 구분이 서야 한다 | 역할 계층은 포크 고유 정책이라 원본 반영 대상이 아니다. 원본이 역할 정의 API 를 열면 그쪽으로 옮긴다 |
| `config/BootstrapRunner.java` | 최초 관리자에게 `SUPERADMIN` 을 먼저 찾아 부여(없으면 종전대로 `ADMIN`) | 위 시드가 없는 원본 스키마에서도 동작이 같고, 있는 곳에서는 무인 설치 직후 superadmin 이 1명 생긴다 | 제안 가치 있음. 원본에 역할 계층이 생기면 함께 올린다 |
| `admin-ui/index.html` | fetch 3곳에 `forkCsrfHeaders()` 추가 | 게이트웨이 BFF(`/admin/identity/`) 뒤에서 열릴 때 세션 CSRF 토큰을 함께 보낸다. 쿠키가 없으면 헤더가 붙지 않아 독립 실행 동작은 그대로다 | 원본에는 무의미한 델타. 재동기화 때 다시 얹는다 |
| `db/migration/{postgresql,mariadb,mysql}/V15__openclaw_executive_role.sql` | 신규. 역할 `EXECUTIVE` 시드(권한 부여 없음) | 포크가 임원 단계를 더해 5단계가 됐다. V14 는 고치지 않고 새 버전으로만 얹는다(2.2 규칙). 임원의 전 부서 열람은 역할이 아니라 `dept-` 그룹 전체 소속에서 나온다 | V14 와 같은 이유로 원본 반영 대상이 아니다 |
| `build.gradle.kts` | `version` 에 `+openclaw.2` | 8절 표기 규칙 | 해당 없음 |

## 7. 설계 불변식 4개와 포크의 준수 상태

원본 `.claude/rules/design-invariants.md` 의 요약이다(그 파일 자체는 벤더 복사에서 제외했다). 어기면 "작은 IX-Trust" 가 되므로 포크도 지킨다.

| # | 불변식 | 포크 준수 상태 |
| --- | --- | --- |
| 1 | **헤드리스.** jar 는 로그인 화면을 렌더하지 않는다. 앱이 자기 프레임워크로 만든다. 관리 콘솔은 예외이고 `ixauth.admin-ui.enabled=false` 로 끌 수 있어야 한다 | **지킨다.** 로그인 화면은 Control UI 가 그린다 |
| 2 | **검증은 앱 로컬.** 매 요청 jar 를 호출하지 않는다. JWKS 공개키로 앱이 직접 검증한다. L1 권한도 앱 로컬 판정 | **지킨다.** WS 핸드셰이크·HTTP 요청에서 JWKS 로컬 검증. jar 호출은 로그인·갱신·로그아웃뿐 |
| 3 | **앱 DB 공유.** IX-Auth 전용 DB·Redis 를 띄우지 않는다 | **예외를 기록하고 어긴다.** 아래 7.1 |
| 4 | **외부 미노출.** jar 를 인터넷에 열지 않는다. 브라우저는 앱을 거친다(BFF) | **지킨다.** compose 에서 jar 포트를 열지 않는다. 관리 콘솔 노출은 별도 결정 항목(7.2) |

### 7.1 불변식 3 의 명시적 예외 (2026-09-07, 사용자 결정)

**어긴다.** IX-Auth 전용 PostgreSQL 을 띄운다.

사유: 포크(OpenClaw)의 상태 저장소는 `node:sqlite` 기반 SQLite 파일이고, IX-Auth 는 PostgreSQL / MariaDB / MySQL 8 만 지원한다. 공유할 수 있는 DB 가 애초에 없다. 불변식 3 의 목적은 "관리 포인트를 늘리지 않는 것" 인데, 여기서는 DB 를 공유할 방법이 없으므로 목적 자체가 성립하지 않는다.

완화:

- 컨테이너 1개(postgres 16)로 제한하고 Redis 는 도입하지 않는다. 세션 저장소는 DB 로 둔다.
- 고객 표준이 MariaDB 이면 `IXAUTH_DB_URL` 을 바꿔 교체할 수 있다. 서버가 세 방언을 모두 지원하고 Flyway 가 JDBC URL 로 방언을 정한다.
- 배포 정의는 `chris-local/docker-compose.ixauth.yml` 한 곳에 모은다.

불변식 문서의 규정("사용자가 그래도 진행하라고 하면 예외를 기록하고 진행한다")에 따라 이 항목이 그 기록이다.

### 7.2 관리 콘솔 노출은 미결정

IX-Auth 내장 관리 콘솔(`/admin-ui`)은 원본 설계상 외부에 노출하지 않는 것이 전제다(`docs/contract/config.md`). 포크는 사용자 관리 UI 를 다시 만들지 않고 이 콘솔을 재사용하므로, 사내에서 접근할 방법이 필요하다.

| 방식 | 평가 |
| --- | --- |
| Traefik 으로 별도 호스트명 + 사내 IP allowlist | 권고. 콘솔 자체 로그인이 있어 이중 방어가 된다 |
| VPN 안에서만 접근 | 사내 배포면 가장 단순 |
| 게이트웨이가 `/admin-ui` 를 프록시 | **채택(2026-09-07).** 아래 7.3 |

### 7.3 채택안: 게이트웨이 BFF 프록시 (가정 - 사용자 미확정)

게이트웨이가 `/admin/identity/` 에서 콘솔을 중계한다. jar 는 여전히 포트를 열지 않으므로 불변식 4 를 지킨다.

"서비스 키 경로와 관리 콘솔 경로가 한 오리진에 섞인다" 던 비권고 사유는 다음으로 해소했다.

- 서비스 키는 브라우저로 나가지 않는다. 프록시가 업스트림 요청 헤더를 **허용목록으로 새로 만들고** 마지막에 `X-IxAuth-Key` 를 주입한다. 브라우저의 쿠키·hop-by-hop 헤더·위조 귀속 헤더는 아예 옮겨지지 않는다.
- 통과 조건이 **게이트웨이 세션의 superadmin** 이다. 그 외에는 403 이고, 애초에 링크를 응답에 싣지 않는다.
- 콘솔은 **자체 로그인을 하지 않는다**(J 단계에서 바뀌었다). 프록시가 그 사람의 세션이 이미 쥐고 있는 신원 서버 access token 을 업스트림 요청에 붙이고, 콘솔의 로그인 경로(`/api/login`·`/api/mfa/verify`)는 404 로 막는다. 근거는 아래 7.3.1.
- 전달 경로는 3가지(`/admin-ui`, `/admin-ui/api/*`, `/admin/*`)로 고정이고 그 밖은 404 다. 업스트림 경로를 호출자가 고를 수 없다.

#### 7.3.1 콘솔 로그인을 없애고 통과 조건을 좁힌 이유 (J 단계, 2026-09-08)

A 단계는 "콘솔이 자체 로그인을 유지하니 게이트웨이 세션만 훔쳐도 사용자 관리는 못 한다" 를 이중 방어로 삼았다. 그 논거는 다음 두 사실 때문에 성립하지 않는다.

1. **관리자에게는 이중 방어가 아니다.** baseline 시드가 `ADMIN` 역할에도 `ixauth:*:*` 전권을 준다. 콘솔이 매 동작을 다시 검사해도 관리자가 요청한 것은 전부 통과하므로, 콘솔을 열 수 있는 관리자는 사용자 생성·삭제·역할 변경까지 다 할 수 있었다.
2. **비밀번호를 두 번 묻는 것은 관리자에게 비용이 아니다.** 같은 사람이 같은 비밀번호를 한 번 더 넣을 뿐이라 공격 표면이 줄지 않는다.

그래서 방어를 자리에서 옮겼다. 콘솔 로그인 화면을 없애 **토큰이 브라우저에 내려가지 않게** 하고, 대신 **통과 조건을 superadmin 으로 좁혔다.**

- 브라우저에는 신원 서버 토큰이 전혀 저장되지 않는다. 프록시가 요청 허용목록에서 `Authorization` 을 아예 빼고 세션의 access token 으로 새로 세운다. 브라우저가 보낸 `Authorization` 은 상류에 닿지 못한다.
- 콘솔 화면은 `sessionStorage` 에 토큰이 있어야 열리므로, 프록시가 콘솔 문서 응답에만 짧은 인라인 스크립트를 끼워 **불투명 sentinel** 과 표시용 이메일·역할을 채운다. sentinel 은 상류에서 항상 덮어써지므로 유출돼도 값이 없다.
- 감수한 것: 게이트웨이 세션 하나가 곧 콘솔 접근이다. 그래서 그 세션을 가질 수 있는 사람을 superadmin 으로 줄였다. 관리자·감사자가 쓰던 초대·가입 승인·사용자 관리·감사 조회는 포크 자신의 화면이고 게이트웨이가 부서 범위까지 좁혀 인가하므로 그대로 열려 있다(포크의 `canUseIxAuthAdminApi`).

별도 호스트명 + IP allowlist 안은 여전히 유효하다. 그 배포에서는 `gateway.auth.ixAuth.adminConsoleUrl` 로 절대 URL 을 지정하면 게이트웨이가 그쪽 링크를 대신 보낸다.

## 8. 버전 표기

포크가 구역 B 를 고치면 `build.gradle.kts` 의 `version` 에 포크 델타 번호를 붙인다.

```kotlin
// build.gradle.kts (allprojects)
version = "0.1.0-SNAPSHOT+openclaw.1"
```

`+openclaw.N` 은 SemVer 빌드 메타데이터라 버전 비교에 영향을 주지 않으면서 "원본 0.1.0-SNAPSHOT 에 포크 델타 N 개가 얹힌 빌드" 임을 드러낸다. 6절 표에 델타를 추가할 때 N 을 올린다.

현재 값은 `0.1.0-SNAPSHOT+openclaw.2` 이다 (6절 델타 2묶음).

## 9. 빌드 산출물

| 항목 | 값 |
| --- | --- |
| Gradle 태스크 | `:ix-auth-server:bootJar` |
| 산출 파일명 | `ix-auth.jar` (`ix-auth-server/build.gradle.kts` 의 `archiveFileName`) |
| 산출 경로 | `ix-auth-server/build/libs/ix-auth.jar` |
| 크기 | 약 63 MB (Spring Boot fat jar) |
| 필요 JDK | 21 (`JavaLanguageVersion.of(21)`) |
| Gradle | 9.5.0 (wrapper 가 받는다) |

**커밋하지 않는다.** `.gitignore` 가 막는다. 배포는 `docker/Dockerfile` 로 이미지를 만들어 쓴다.
