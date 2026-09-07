# 대안 검토: IX-Auth 를 신원 공급자로 쓸 때 포크가 구현할 최소 범위

> 작성 2026-09-07 (KST, 일요일). **초안. 커밋하지 않았다.**\
> 비교 대상: [AUTH-PLAN.md](AUTH-PLAN.md) 의 자체 내장 구현 계획(M0~M5).\
> 근거: `D:\PROJECT\ix-auth` 의 `docs/contract/http-api.md`, `docs/contract/token.md`,\
> `docs/guides/permission-model.md`, `packages/client-node/`, `README.md`,\
> `docs/design/embedded-auth-server-design.md` + 포크 `D:\PROJECT\openclaw` 커밋 `690497b5ae3` 실제 소스.
>
> **이 문서는 판단 자료다. 구현을 포함하지 않는다.**

---

## 0. 세 줄 요약

1. IX-Auth 는 계정·비밀번호·메일·2FA·초대·잠금·인증 감사·관리 콘솔을 **전부 이미 갖고 있다.** 자체 계획의 M2(가입·메일)와 M5(2FA)는 사실상 사라지고 M1 의 절반, M4 의 절반이 준다.
2. 그러나 **줄지 않는 덩어리가 둘** 있다. (a) WS 핸드셰이크에 신원을 주입하고 기기 페어링을 면제하는 게이트웨이 통합(계획서 3.2 의 WS 라인 훅 9곳), (b) **부서 격리 전체**. IX-Auth 는 "그룹은 조직도가 아니다" 를 명시하고 부서 트리를 받지 않는다.
3. 새로 **생기는** 일도 있다. access token 15분 TTL 때문에 BFF 갱신 루프와 장수명 WS 재검증이 필요하고, IX-Auth jar + 별도 RDB 가 런타임 의존성으로 늘어난다.

---

## 1. IX-Auth 계약 요약 (포크 연동에 필요한 것만)

### 1.1 인증 방식 3종

| 대상                       | 방식         | 헤더                                 |
| -------------------------- | ------------ | ------------------------------------ |
| 앱(포크 게이트웨이) -> jar | 공유 시크릿  | `X-IxAuth-Key: <ixauth.service-key>` |
| 사용자 컨텍스트 필요       | access token | `Authorization: Bearer <jwt>`        |
| 공개                       | 없음         | `/health`, `/.well-known/jwks.json`  |

**설계 불변식 4: jar 는 외부에 노출되지 않는다.** 브라우저는 jar 를 직접 호출하지 않고 앱이 중계(BFF)하며 **앱 도메인 쿠키**로 심는다. 포크가 BFF 가 되어야 하는 이유가 이것이다.

### 1.2 포크가 부를 엔드포인트

| 메서드     | 경로                                                                | 인증         | 쓰임                                                                      |
| ---------- | ------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| POST       | `/auth/login`                                                       | 서비스 키    | 로그인 중계. 본문 `{email, password, userAgent, ip, captchaToken?}`       |
| POST       | `/auth/refresh`                                                     | 서비스 키    | 회전 + 재사용 탐지. 본문 `{refreshToken}`, IP 는 `X-Forwarded-For` 헤더로 |
| POST       | `/auth/logout`                                                      | 서비스 키    | 본문 `{refreshToken}` 또는 `{sessionId}` -> 204                           |
| GET        | `/auth/me`                                                          | access token | 표시용. **매 요청 호출 금지** (토큰에 같은 정보가 있다)                   |
| GET        | `/.well-known/jwks.json`                                            | 없음         | 공개키. `Cache-Control: public, max-age=3600`                             |
| POST       | `/auth/mfa/verify`                                                  | 서비스 키    | 로그인 2/2 (TOTP 켠 계정)                                                 |
| POST       | `/auth/password/reset`, `/auth/invite/accept`, `/auth/email/verify` | 서비스 키    | **메일 링크 도착 화면 3개**가 중계                                        |
| GET/DELETE | `/auth/sessions`, `/auth/sessions/{id}`                             | access token | 내 세션 목록·해지                                                         |
| GET        | `/authz/permission-map`                                             | 서비스 키    | L1 권한 맵 캐시 (쓸 경우)                                                 |

응답 봉투는 성공 `{ "data": {...} }`, 실패 `{ "error": { code, message, traceId } }`.\
로그인 응답: `{ accessToken, refreshToken, expiresIn(900), user{id,email,name,roles,groups}, mfaSetupRequired, termsAgreementRequired }`.

계정 상태 게이트(`users.status`)도 IX-Auth 가 정본으로 강제한다: `ACTIVE` 통과, `LOCKED`(423)·`DISABLED`(403)·`PENDING`(403)·`PENDING_APPROVAL`(403) 차단. **가입 승인제가 이미 제품 기능이다**(`ixauth.account.signup-mode: APPROVAL`). 자체 계획의 요구 1 "가입 후 관리자 승인" 이 설정 한 줄로 끝난다.

### 1.3 토큰 형식 (핵심: 역할·그룹이 클레임에 들어온다)

access token = **RS256 서명 JWT**, TTL 기본 15분. refresh token = **불투명 난수**(JWT 아님), TTL 7일, DB 대조로만 검증, **즉시 폐기 가능**.

```json
{
  "iss": "...",
  "sub": "1042",
  "aud": "openclaw",
  "exp": 0,
  "iat": 0,
  "jti": "...",
  "email": "chris@prost.team",
  "name": "이대훈",
  "ixauth_roles": ["ADMIN", "PM"],
  "ixauth_groups": ["dev-team"],
  "ixauth_sid": "9b1d...",
  "ixauth_pv": 1786230000,
  "ixauth_idp": "nexus-hub",
  "act": { "sub": "1", "email": "admin@example.com" }
}
```

| 클레임          | 포크에서의 쓰임                                                    |
| --------------- | ------------------------------------------------------------------ |
| `sub`           | IX-Auth `users.id`. 포크 `user_profiles` 와 1:1 로 묶을 안정 키    |
| `email`, `name` | 프로필 표시                                                        |
| `ixauth_roles`  | **역할 코드 배열.** `gateway.roles.definitions` 이름으로 매핑      |
| `ixauth_groups` | **그룹 코드 배열.** 부서 코드를 여기에 실어 보낼 수 있다 (2.4)     |
| `ixauth_sid`    | IX-Auth 세션 ID. 포크 감사 줄에 실어 두 원장을 대조                |
| `ixauth_pv`     | permission-map 캐시 무효화 (L1 을 쓸 때만)                         |
| `act`           | 관리자 대리 중. 포크 UI 에 "대리 중" 배너, 감사에 실제 조작자 기록 |

**유효 역할 = 직접 부여분 U 소속 그룹의 역할** 을 IX-Auth 가 발급 시점에 계산해 넣는다. 포크는 그룹 -> 역할 매핑을 몰라도 된다.

검증 절차(SDK 규약): `kid` 로 JWKS 캐시 조회(모르는 kid 면 1회 재조회, 분당 1회 제한) -> 서명 -> `exp`/`iat`(clock skew +-60초) -> `iss`/`aud` 일치. **이 경로에서 jar 를 호출하지 않는다.**

### 1.4 쿠키·CSRF 권고

- 토큰은 **HttpOnly 쿠키**로 심는다. JS 가 읽을 수 있으면 XSS 로 샌다.
- 참조 구현(`packages/client-node/README.md`)의 쿠키: `ixauth_at`, `ixauth_rt`, `{ httpOnly: true, sameSite: "lax", secure: true }`.
- 서비스 키를 **브라우저로 내보내지 않는다.**
- **CSRF 토큰 자체는 IX-Auth 가 제공하지 않는다.** 쿠키 기반 변경 요청의 CSRF 방어는 앱(포크) 책임이다 -> 자체 계획의 `csrf.ts` 는 **그대로 필요**하다.
- 로그인·갱신·로그아웃 **세 호출 모두**에 실방문자 IP·UA 를 넘긴다. 순서는 `CF-Connecting-IP` -> `True-Client-IP` -> `X-Forwarded-For` 첫 조각 -> `X-Real-IP` -> 소켓 주소. **`req.ip` 를 그대로 넣으면 안 된다**(2026-08-25 소비 프로젝트 2곳 실사고, 잘못 넘긴 값은 복원 불가). 포크에는 이미 같은 일을 하는 `src/gateway/ingress-attribution.ts` 와 `src/gateway/net.ts` 의 `resolveRequestClientIpFromHeaders` 가 있으므로 **재사용한다.**

### 1.5 Node 클라이언트 패키지 평가

`packages/client-node` = `@ix-auth/client-node@0.1.0`, ESM, `engines.node >= 20`, 의존성 **`jose@^5.9.6` 하나**, `license: "UNLICENSED"`.\
API: `login/refresh/logout/verifyMfa/magicLinkVerify/socialCallback`, `verifyToken`(로컬), `loadPermissionMap`/`refreshMapIfStale`/`hasPermission`(로컬 L1), `check`/`batchCheck`/`listResources`(L2), `clientIpFrom`/`clientMetaFrom`/`requestMeta`.

**권고: 이 패키지를 포크에 의존성으로 넣지 않는다.** 이유 셋.

1. `license: "UNLICENSED"` 라 포크의 `THIRD_PARTY_NOTICES.md`·의존성 감사와 충돌한다.
2. Express 미들웨어 전제인데 포크는 `node:http` + `ws` 직접 사용이다.
3. `jose` 를 새 의존성으로 들이면 포크의 번들·의존성 래칫을 건드린다.

**RS256/JWKS 검증은 `node:crypto` 의 `createPublicKey({ format: "jwk" })` + `verify()` 로 약 150줄이면 자체 구현된다.** 계약 문서(`token.md`)를 정본으로 삼고 클라이언트 패키지는 **참조 구현**으로만 읽는다.

---

## 2. 확정 아키텍처 (IX-Auth 안)

```text
                브라우저 (사내 어느 PC 든)
                          |
        HTTPS (TLS 종단: Traefik). 앱 도메인 쿠키만 오간다
                          |
 +------------------------v-------------------------------------+
 |            OpenClaw Gateway (포크 빌드) = BFF                  |
 |                                                              |
 |  [HTTP 라인 - 비 admitted stage]      [WS 라인]                |
 |   /auth/login   -> jar 중계            upgrade req 의 쿠키      |
 |   /auth/refresh -> jar 중계            -> JWKS 로컬 검증        |
 |   /auth/logout  -> jar 중계            -> 신원·역할·그룹 주입   |
 |   /auth/me      -> 쿠키의 JWT 로 로컬  -> device 면제           |
 |   /auth/csrf    -> 포크 소유           -> 기기 토큰 미발급       |
 |                          |                     |              |
 |                          +----------+----------+              |
 |                                     v                         |
 |                       +--------------------------+            |
 |                       | IxAuthPrincipal          |            |
 |                       |  sub/email/roles/groups  |            |
 |                       |  (JWT 검증 결과로만 생성) |            |
 |                       +------------+-------------+            |
 |                                    |                          |
 |          +-------------------------+------------------+       |
 |          v                         v                  v       |
 |   user_profiles          department-access      gateway.roles |
 |   (기존, sub 로 결선)     (신규, 포크 소유)      (기존 상한)     |
 |                                    |                          |
 |                     audit_security_events (신규, 포크 소유)     |
 |                     = 세션 열람·설정 변경·부서 거부             |
 +--------------------------|-----------------------------------+
                            | X-IxAuth-Key (내부망 전용)
                            v
             +--------------------------------+
             | IX-Auth jar (외부 미노출)        |
             |  계정·비밀번호·메일·2FA·초대     |
             |  감사 = 인증 이벤트 정본          |
             |  /admin-ui 관리 콘솔             |
             +---------------+----------------+
                             v
                   PostgreSQL / MariaDB / MySQL 8
```

### 2.1 세션 표현 (두 선택지)

|                      | (A) 토큰 직접 쿠키                                         | (B) 불투명 세션 ID + 서버 저장                     |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| 쿠키 내용            | `__Host-oc_at`=access JWT, `__Host-oc_rt`=refresh 불투명값 | `__Host-oc_sid`=난수, DB 에 digest + refresh token |
| WS 핸드셰이크        | 쿠키의 JWT 를 바로 로컬 검증. **jar 호출 0**               | 세션 조회 후 보관한 JWT 검증                       |
| 로그아웃 즉시성      | refresh 는 즉시 죽지만 access 는 **최대 15분 남는다**      | 세션 행 폐기로 즉시. 열린 WS 도 즉시 종료          |
| 브라우저에 나가는 것 | refresh token 이 브라우저까지 나간다                       | 불투명 ID 만                                       |
| 신규 테이블          | 없음                                                       | `ixauth_login_sessions` 1개                        |

**권고: (B).** (A)는 로그아웃·정지 후에도 최대 15분간 열린 WS 가 살아 있고, 그 창은 자체 계획이 명시적으로 막기로 한 지점이다(계획서 2.5 "세션 만료"·"기기 토큰 우회 차단"). refresh token 이 브라우저에 나가지 않는 이점도 (B) 쪽이다.

### 2.2 access token 만료와 장수명 WS (자체 계획에 없던 새 문제)

Control UI 의 WS 는 몇 시간씩 열려 있는데 access token 은 15분이다. 세 가지 처리가 필요하다.

1. BFF 가 **서버측에서** 갱신한다. 세션 행에 refresh token 을 두고 access 만료 60초 전에 `/auth/refresh` 를 부른다. 브라우저는 아무것도 하지 않는다.
2. 갱신 실패(재사용 탐지·세션 폐기·계정 정지)면 그 세션의 **열린 WS 를 끊는다.** 기존 `disconnectClientsForUserProfile` 경로를 재사용한다.
3. 역할 변경 반영 지연은 최대 15분이다(IX-Auth `permission-model.md` 6절이 명시). 즉시 반영이 필요하면 관리 콘솔에서 세션 종료 -> 포크의 갱신 실패 -> WS 종료로 전파된다. **이 전파 경로를 계약으로 문서화해야 한다.**

### 2.3 역할 매핑

`ixauth_roles` 를 포크 `gateway.roles.definitions` 키로 옮기는 **설정 맵 1개**로 끝난다. 새 RBAC 엔진은 자체 계획과 동일하게 만들지 않는다.

```json5
gateway: { auth: { mode: "ix-auth", ixAuth: {
  baseUrl: "http://ix-auth:9100",
  serviceKey: "<SecretRef>",
  issuer: "https://ai.jinbio.example",
  audience: "openclaw",
  roleMap: { SUPERADMIN: "superadmin", ADMIN: "admin", MODERATOR: "moderator", MEMBER: "member" },
  departmentGroupPrefix: "dept-",
  session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
} } }
```

여러 역할을 가진 사용자는 매핑된 역할 중 **최고 권한**을 취하되, `superadmin` 승격은 설정에 명시된 역할 코드로만 허용한다(매핑 오타·자기 승격으로 인한 권한 상승 차단).

### 2.4 부서: 여기가 줄지 않는 지점

IX-Auth `permission-model.md` 4절이 못박는다. **"그룹은 조직도가 아니다 ... 부서 트리·직급·보고 라인은 IX-Auth 에 넣지 않는다."**

따라서 `ixauth_groups` 는 부서 **코드의 전달 수단**일 뿐이고 다음은 전부 포크가 그대로 만든다.

- `departments` / `department_agents` 테이블
- `department-access.ts` / `department-session-filter.ts` (자체 계획 기준 약 670줄)
- 계획서 3.2 "인가·부서 경계" 훅 10곳: `session-sharing.ts:473`(`canReceiveSessionEvent`)·`:546`(`createSessionListEntryFilter`), `session-sharing-policy.ts:148`·`:328`, `agents.list`(`server-methods/agents.ts:806`), `server-methods.ts:258`·`:525`, `plugin-sdk/session-visibility.ts:115` 등. **한 줄도 줄지 않는다**
- `/settings/departments` UI 와 `openclaw departments` CLI

`department_members`(사용자 -> 부서)는 `ixauth_groups` 로 대체할 수 있다(그룹 코드 `dept-sales` -> 부서 `sales`). 그러면 사용자 부서 배정 화면이 IX-Auth 콘솔로 넘어가 테이블 1개와 UI 1개가 준다. 대신 **에이전트 -> 부서 귀속(`department_agents`)은 IX-Auth 가 모르는 개념이라 포크에 남는다.**

### 2.5 관리 콘솔 재사용은 조건부다

IX-Auth 는 내장 관리 콘솔(`/admin-ui`)을 갖고 있고 사용자 CRUD·역할·그룹·세션 강제 종료·감사 CSV 내보내기·런타임 설정 77개가 거기 있다. 자체 계획의 `/settings/users` 페이지(약 460줄)와 `directory.*` RPC(약 400줄)가 사라진다.

**다만 그 콘솔은 "애초에 외부에 노출하지 않는 것이 전제" 다**(`config.md:464`, `:514`, 설계 불변식 4). 재사용하려면 의도적으로 노출해야 한다.

| 방식                                           | 평가                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Traefik 으로 별도 호스트명 + 사내 IP allowlist | 권고. 콘솔 자체 로그인이 있으므로 이중 방어                  |
| 포크 게이트웨이가 `/admin-ui` 를 프록시        | 비권고. 서비스 키 경로와 관리 콘솔 경로가 한 오리진에 섞인다 |
| VPN(Headscale) 안에서만 접근                   | 사내 배포면 가장 단순                                        |

**결정 항목이다.** 노출하지 않기로 하면 사용자 관리 UI 를 포크가 다시 만들어야 하고, 그 순간 절감분의 상당 부분이 되돌아온다(3.2 의 X1).

### 2.6 감사는 두 원장으로 나뉜다

| 사건                                                                                | 정본                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 로그인 성공·실패·로그아웃·비밀번호 변경·MFA·역할/그룹 변경·계정 상태 변경·대리 시작 | **IX-Auth** (append-only, CSV 내보내기, 기간 필터, 보존 정리 배치) |
| 세션 열람·에이전트 실행·설정 변경·부서 접근 거부·파일 접근                          | **포크** `audit_security_events` (해시 체인 유지)                  |

두 원장을 잇는 키는 `ixauth_sid` + `sub` 다. 포크 감사 줄에 이 둘을 실으면 사후 대조가 된다. **해시 체인과 `security-audit-*.ts` 3파일은 그대로 필요하다.** 포크 쪽 사건에 대해서다.

---

## 3. 자체 구현 대비 규모 비교

### 3.1 파일·줄수

| 구분               | 자체 구현 (AUTH-PLAN)       | IX-Auth 안                                                                                     | 차이                        |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------- |
| 신규 파일          | **34개 / 약 8,400줄**       | **약 17개 / 약 3,500줄**                                                                       | **-17개 / -4,900줄 (-58%)** |
| 수정 기존 파일     | **28개 / 훅 52곳**          | **약 24개 / 훅 44곳**                                                                          | -4개 / -8곳 (-15%)          |
| 신규 SQLite 테이블 | 13개                        | **4개** (`ixauth_login_sessions`, `departments`, `department_agents`, `audit_security_events`) | -9개                        |
| 신규 npm 의존성    | argon2 계열 1개 (신규 도입) | **0개** (JWKS 검증 자체 구현)                                                                  | 유리                        |
| 새 런타임 인프라   | 없음 (SQLite 만)            | **IX-Auth jar + RDB 1개**                                                                      | 불리                        |

신규 파일 내역 (IX-Auth 안):

| 파일                                                                     | 역할                                                  | 자체 계획 대비                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| `src/auth/ix-auth/client.ts`                                             | login/refresh/logout 중계, 서비스 키, IP·UA 전달      | `service.ts` 자리, 훨씬 얇다                          |
| `src/auth/ix-auth/jwks.ts`                                               | JWKS 캐시·kid 재조회 제한·RS256 로컬 검증             | 신규                                                  |
| `src/auth/ix-auth/claims.ts`                                             | 클레임 파싱, `IxAuthPrincipal` 계약                   | `types.ts` 대체                                       |
| `src/auth/ix-auth/role-map.ts`                                           | `ixauth_roles` -> `gateway.roles`                     | 신규(소형)                                            |
| `src/auth/ix-auth/sessions.ts`                                           | 불투명 세션 ID·서버측 갱신 루프·폐기                  | `sessions.ts` 유지 + 갱신 루프 추가                   |
| `src/auth/ix-auth/csrf.ts`                                               | 세션 결합 CSRF                                        | **그대로 유지**                                       |
| `src/gateway/cookie-header.ts`                                           | 쿠키 파서 승격(`control-ui-plugin-auth-cookie.ts:45`) | **그대로 유지**                                       |
| `src/gateway/ix-auth-http.ts` + `-paths.ts`                              | `/auth/*` BFF 라우트                                  | `builtin-user-http.ts` 축소판                         |
| `src/gateway/ix-auth-principal.ts`                                       | 요청 컨텍스트 결선                                    | **그대로 유지**                                       |
| `src/gateway/department-access.ts` + `-session-filter.ts`                | 부서 경계                                             | **그대로 유지 (약 670줄)**                            |
| `src/state/ix-auth-schema.ts` + `ix-auth-sessions.ts` + `departments.ts` | 저장소                                                | 6개 -> 3개                                            |
| `src/audit/security-audit-{events,store,chain}.ts`                       | 포크 사건 원장                                        | **그대로 유지** (`query` 는 IX-Auth CSV 로 일부 대체) |
| `src/cli/ix-auth-cli.ts`                                                 | `openclaw ixauth doctor/whoami`, `departments`        | `users` 관리 CLI 대부분 소멸                          |

**소멸하는 자체 구현 파일 (17개):** `password.ts`, `totp.ts`, `mail.ts`, `mail-templates.ts`, `rate-limit.ts`, `bootstrap.ts`, `builtin-user-accounts.ts`, `builtin-user-mail.ts`, `builtin-auth-rate-limits.ts`, `server-methods/directory.ts`, `security-audit-query.ts`(축소), UI `register/`·`account/`·`users/`·`audit/`(축소)·`verify-email`(축소)·`reset-password`(축소).

**되돌아오는 것:** IX-Auth 메일 링크가 앱을 가리키므로 `/reset-password?token=`, `/accept-invite?token=`, `/verify-email?token=` **얇은 토큰 중계 화면 3개**는 포크가 만들어야 한다(참조 구현 `examples/react-demo/web/src/TokenPages.tsx`, 로직 없이 토큰만 넘긴다). 자체 계획의 같은 화면들보다 훨씬 얇다.

**추가로 확인된 유리한 사실 (포크 소스 실측):**

- 포크의 `user_profiles` 는 정본 SQL 이 아니라 **feature-local TS 템플릿 + 손으로 쓴 Kysely 인터페이스**로 산다(`src/state/user-profiles-schema.ts`). 같은 방식(Route A)을 쓰면 신규 4테이블 모두 `openclaw-state-schema.sql` 수정·`pnpm db:kysely:gen`·`user_version` 상향·호환성 테스트 수정이 **전부 불필요**하다. 자체 계획이 잡았던 13테이블 정본 SQL 작업이 크게 준다.
- WS 쪽 훅은 이미 자리가 있다. `auth-context.ts:128 resolveConnectAuthState` 가 **`req: IncomingMessage` 를 그대로 받으므로** 여기서 쿠키를 읽으면 되고, `connect-policy.ts:84` 의 device 면제 분기와 `connect-device-tokens.ts:37` 의 `!trustedProxyAuthOk` 가드가 **이미 존재**해 각각 OR 한 항·AND 한 항 추가로 끝난다.
- 반대로 **불리한 실측**: Control UI 에는 연결 전에 게이트웨이 인증 모드를 알아내는 프로브가 **없다**. `authMode` 는 연결 성공 후 `hello.snapshot.authMode` 로만 온다(`ui/src/pages/connection/view.ts:59`). 따라서 어느 안이든 `GET /auth/me`(또는 `/auth/session`) 비인증 부트스트랩 엔드포인트를 **새로 만들어야** 한다. 이 비용은 두 안이 동일하다.

### 3.2 마일스톤·기간

전제는 계획서와 같다(서버 1명 + UI 1명 + 보안/QA 파트타임, 1인 단독이면 x1.7).

| 마일스톤                        | 자체 구현 | IX-Auth 안 | 차이              | 근거                                                                                    |
| ------------------------------- | --------- | ---------- | ----------------- | --------------------------------------------------------------------------------------- |
| M0 계약 확정                    | 1주       | **1주**    | 0                 | 권한 매트릭스·부서 모델·위협 모델은 그대로 필요. IX-Auth 배치·노출 정책 결정이 추가된다 |
| M1 디렉터리+로그인+세션+WS      | 3주       | **1.5주**  | **-1.5주**        | 계정·해시·부트스트랩 소멸. BFF 중계·JWKS 검증·WS 훅·CSRF·쿠키 세션은 유지               |
| M2 가입·메일·승인·재설정        | 2주       | **0.5주**  | **-1.5주**        | 전부 IX-Auth. 포크는 메일 링크 도착 화면 3개만                                          |
| M3 역할·부서 + 관리 UI          | 3주       | **2.5주**  | -0.5주            | **부서 격리는 그대로.** `/settings/users` 만 IX-Auth 콘솔로 대체                        |
| M4 감사 원장·조회·보존          | 2주       | **1.5주**  | -0.5주            | 인증 사건은 IX-Auth. 포크 사건 원장·해시 체인·부서 제한 조회는 유지                     |
| M5 2FA·강화·침투·문서           | 2주       | **1주**    | **-1주**          | TOTP·백업코드·잠금·CAPTCHA 소멸. 침투 점검·문서는 유지                                  |
| (신규) 토큰 갱신 루프·WS 재검증 | 0         | **+0.5주** | +0.5주            | 15분 TTL 대응. 자체 계획에 없던 항목                                                    |
| **합계**                        | **13주**  | **8.5주**  | **-4.5주 (-35%)** | 1인 단독 환산 22주 -> **14.5주**                                                        |

### 3.3 정성 비교

| 항목                            | 자체 구현                                               | IX-Auth 안                                                                               |
| ------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 비밀번호·2FA·메일 보안 책임     | **포크가 진다** (argon2 파라미터·열거 방지·타이밍·잠금) | IX-Auth 가 진다. 적합성 검사 84건 중 78 통과·0 실패                                      |
| 계획서 2.5 보안 체크리스트 20항 | 20항 전부 포크                                          | **9항이 IX-Auth 로 이동** (비밀번호 저장·무차별 대입·이메일 열거·메일·세션 고정 일부 등) |
| 업스트림 리베이스 부담          | 신규 34파일 + 훅 52곳                                   | 신규 17파일 + 훅 44곳. **WS 라인 훅은 동일**                                             |
| 배포 단위                       | 게이트웨이 1개 (SQLite)                                 | 게이트웨이 + jar + RDB. **폐쇄망이면 이미지·JDBC 반입 필요**                             |
| 역할 변경 즉시성                | 즉시 (DB 직행)                                          | **최대 15분** 또는 콘솔 세션 종료로 전파                                                 |
| jar 장애 시                     | 해당 없음                                               | **이미 로그인한 사용자는 계속 동작**(로컬 검증). 신규 로그인·갱신만 막힘                 |
| 부서 격리                       | 포크 소유                                               | **포크 소유 (동일)**                                                                     |
| 관리 콘솔                       | 포크가 제작                                             | IX-Auth 내장. 단 노출 정책 결정 필요                                                     |
| 납품 시 라이선스·소유권         | 포크 코드 100%                                          | IX-Auth 는 사내 산출물(`UNLICENSED`). 진바이오테크 재배포 조건 **확인 필요**             |

---

## 4. 포크가 반드시 구현할 최소 범위 (IX-Auth 안, 자체 계획 M1 상당)

1. **설정**: `GatewayAuthMode` 유니온에 `"ix-auth"` 1항 추가(`src/config/types.gateway.ts:178`, `src/config/zod-schema.gateway.ts:119-126`) + `gateway.auth.ixAuth` strictObject. `gateway.auth.token` 과 상호배타 검증을 `src/gateway/auth.ts:175-186` 에 한 항 추가. `auth-resolve.ts:18`·`:63-65` 에서 token/password 자동 폴백을 상속하지 않게 분기.
2. **JWKS 로컬 검증** (`node:crypto`): RS256, kid 캐시, 모르는 kid 1회 재조회(분당 1회 상한), `iss`/`aud`/`exp`/`iat` 검사, clock skew +-60초. 네트워크는 JWKS 조회 때만.
3. **BFF 라우트**: `/auth/login`·`/auth/refresh`·`/auth/logout`·`/auth/me`·`/auth/csrf` 를 `src/gateway/server-http.ts:409` 의 **`addRequestStage`(비 admitted)** 로 등록한다. `handleHooksRequest`(`:483`)보다 앞에 둬야 훅 base path 가 삼키지 않는다. 레이트리밋·IP 귀속은 `device-pairing-join-http.ts` + `server-http.ts:459-470` 선례 형태 그대로.
4. **쿠키 세션**: `__Host-` 접두, `Path=/; Secure; HttpOnly; SameSite=Lax`, `Domain` 미지정, 256비트 이상 난수, DB 에는 digest 만. 서버측 갱신 루프. 로그인 시 세션 ID 회전(고정 방지).
5. **CSRF**: Origin 검증 + 세션 결합 토큰(더블 서밋). **IX-Auth 가 주지 않는다.**
6. **WS 인가**: `auth-context.ts:128 resolveConnectAuthState` 에서 `req` 의 쿠키를 읽어 principal 을 만들고, `connect-auth.ts` 에서 `ixAuthOk` 를 `trustedProxyAuthOk` 와 나란히 계산한다.
   - `connect-policy.ts:84` -> `if (params.isControlUi && (params.trustedProxyAuthOk || params.ixAuthOk))`
   - `connect-device-tokens.ts:37` -> `!trustedProxyAuthOk && !ixAuthOk && device && ...`
   - `connect-user-profile.ts:18` -> `sub` 로 프로필 직결(`ensureProfileForEmail` 자동 생성 경로 미사용)
   - Origin 은 `gateway.controlUi.allowedOrigins` 와 정확 대조(와일드카드·Host 헤더 추론 금지)
7. **역할 주입**: `ixauth_roles` -> `roleMap` -> `gateway.roles` 상한. 브라우저 자기 선언 스코프(`ui/src/api/gateway.ts:104` 의 `operator.admin` 포함 목록)는 권한 근거로 쓰지 않는다.
8. **Control UI 로그인 화면**: IX-Auth 는 화면을 만들지 않는다. `ui/src/app/app-root.ts:578` 의 `showLoginGate` 앞에 `GET /auth/me` 부트스트랩을 두고, `ui/src/components/login-gate.ts:411` 을 계정 로그인 화면으로 위임한다. 브랜드 문자열은 `src/brand.ts` 의 `BRAND_NAME`(현재 `"Chris Agent"`)을 import 한다(하드코딩 금지). i18n 은 신규 카탈로그 `ui/src/i18n/locales/en-ix-auth.ts` + `en.ts` 네임스페이스 앵커 + `scripts/lib/control-ui-i18n-catalog.ts` 등록 3곳. ko 는 생성물(`ko.tm.jsonl`)이라 `pnpm ui:i18n:sync` 로 채운다. 라운드 5px 상한·full width 규칙은 `ui/src/styles/fork-style.css` 토큰을 읽고, 로그인 카드는 FORK.md 가 명시한 **중앙 정렬 의도적 예외**를 따른다.
9. **CLI**: `openclaw ixauth doctor`(jar 도달·JWKS·서비스 키·issuer/audience 일치), `openclaw ixauth whoami`. 자체 계획의 `users bootstrap` 은 IX-Auth 의 `IXAUTH_ADMIN_EMAIL`/`IXAUTH_ADMIN_PASSWORD` 초기 시드로 대체된다.
10. **기존 모드 무영향**: token/password/trusted-proxy 회귀 0. 루프백 password 폴백(`src/gateway/auth.ts:493`) 유지.

---

## 5. 결정 필요 항목

| #   | 항목                                              | 선택지                                        | 미결 시 영향                                                                             |
| --- | ------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| X1  | IX-Auth 관리 콘솔을 사내에 노출하는가             | Traefik + IP allowlist / VPN 전용 / 미노출    | **미노출이면 사용자 관리 UI 를 포크가 다시 만든다(+1.5주).** 절감분의 3분의 1이 사라진다 |
| X2  | 세션 표현 (A) 토큰 쿠키 vs (B) 불투명 ID          | (B) 권고                                      | (A)면 로그아웃·정지가 최대 15분 늦다                                                     |
| X3  | 부서를 `ixauth_groups` 로 전달할지                | 전달 시 `department_members` 테이블·UI 소멸   | 전달 권고                                                                                |
| X4  | IX-Auth DB 를 어디에 두는가                       | 별도 Postgres 컨테이너 / 기존 RDB 스키마 분리 | 폐쇄망 반입 목록에 영향                                                                  |
| X5  | 진바이오테크 납품 시 IX-Auth 재배포·라이선스 조건 | 사내 산출물, `UNLICENSED`                     | **법무·영업 확인 필요.** 불가면 자체 구현으로 되돌아간다                                 |
| X6  | 역할 변경 최대 15분 지연을 계약 문구로 수용하는가 | 수용 / `ixauth.jwt.access-ttl` 단축           | 수용 + 콘솔 세션종료 전파 문서화                                                         |
| X7  | `jose` 의존성 추가 vs `node:crypto` 자체 검증     | 자체 검증 권고                                | 자체 검증                                                                                |

---

## 6. 권고

**IX-Auth 안을 채택할 만하다.** 근거 셋.

1. 위험이 큰 부분(비밀번호 해싱·메일 토큰·열거 방지·2FA·잠금)이 이미 실측 검증된 제품으로 넘어간다. 계획서 2.5 보안 체크리스트 20항 중 **9항이 IX-Auth 책임**으로 이동한다.
2. 기간이 13주 -> 8.5주(1인 22주 -> 14.5주)로 준다.
3. 사내 다른 납품(ax-connect·IX-Trust 계열)과 신원 스택이 하나로 모인다.

**단 세 가지를 먼저 못박고 시작한다.**

- **X1(콘솔 노출)** 이 "미노출" 로 결정되면 절감분의 3분의 1이 사라진다. 먼저 답을 받는다.
- **X5(라이선스·재배포)** 가 막히면 이 안 자체가 성립하지 않는다.
- **부서 격리는 어느 안을 택하든 포크가 만든다.** IX-Auth 도입을 "부서까지 해결된다" 로 이해하면 M3 에서 일정이 무너진다.

M0(계약 확정)은 어느 안이든 그대로 필요하다. **M0 을 먼저 진행하면서 X1·X5 답을 받는 것**이 지금의 최적 수순이다.
