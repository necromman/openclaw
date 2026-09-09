# IX-Auth 연동 정본

> 이 문서가 포크의 `gateway.auth.mode: "ix-auth"` 정본이다.\
> 채택 근거와 자체 구현안 대비 비교는 [AUTH-IXAUTH-OPTION.md](AUTH-IXAUTH-OPTION.md),\
> 폐기된 자체 구현 계획은 [AUTH-PLAN.md](AUTH-PLAN.md) 의 부록에 있다.\
> 벤더 트리 취급은 [ix-auth/VENDOR.md](../ix-auth/VENDOR.md), 수정 가능 범위는 [ix-auth/MODULE.md](../ix-auth/MODULE.md).
>
> 작성 2026-09-07 (KST, 일요일). 구현 범위 = 계획 v2 의 M1'.

---

## 1. 한 문단 요약

게이트웨이가 **BFF** 가 되어 브라우저의 로그인을 IX-Auth 로 중계한다. 브라우저에는 불투명 세션 쿠키 하나만 나가고, IX-Auth 의 access/refresh 토큰은 게이트웨이 프로세스 밖으로 나가지 않는다. 매 요청·매 WS 핸드셰이크의 신원 확인은 **JWKS 공개키로 로컬 검증**하므로 신원 서버를 호출하지 않는다. 로그인한 사람은 기기 페어링도 게이트웨이 토큰도 없이 어느 PC 에서든 들어온다.

## 2. 구조

```text
       브라우저
          |  (1) POST /auth/login  {email, password}
          |  (5) Set-Cookie: 세션(HttpOnly) + CSRF(스크립트 가독)
          v
 +---------------------------------------------+
 |  OpenClaw Gateway  =  BFF                    |
 |                                              |
 |  [HTTP 비 admitted stage]   [WS upgrade]      |
 |   /auth/login                쿠키 -> 세션 행   |
 |   /auth/mfa                  -> JWKS 로컬 검증 |
 |   /auth/logout               -> 신원·역할 주입 |
 |   /auth/refresh              -> device 면제    |
 |   /auth/me                   -> 기기토큰 미발급|
 |            |                        |         |
 |            +----------+-------------+         |
 |                       v                       |
 |            ix_auth_login_sessions (SQLite)    |
 |            digest 만 저장 + refresh token      |
 |                       |                       |
 |            user_profiles (기존) / gateway.roles|
 +-----------------------|----------------------+
       (2) X-IxAuth-Key  |  (4) accessToken + refreshToken
       (3) 자격 검증      v
            +--------------------------+
            | IX-Auth (외부 미노출)      |
            |  계정·비밀번호·2FA·잠금    |
            |  /admin-ui 관리 콘솔       |
            +------------+-------------+
                         v
                   PostgreSQL 16
```

## 3. 시퀀스

### 3.1 로그인

```text
1. 브라우저 -> POST /auth/login {email, password}   (Origin 검사, IP 레이트리밋)
2. 게이트웨이 -> IX-Auth POST /auth/login
      X-IxAuth-Key: <service key>
      body 에 실방문자 ip·userAgent 를 함께 넘긴다
3. 2단계 인증이 켜진 계정이면 401 AUTH_MFA_REQUIRED + challenge
      -> 게이트웨이가 {mfaRequired:true, challenge} 로 응답, 브라우저는 코드 화면
      -> POST /auth/mfa {challenge, code} 로 이어간다
4. 성공하면 accessToken(JWT, 15분) + refreshToken(불투명, 7일)
5. 게이트웨이가 accessToken 을 JWKS 로 로컬 검증
      -> 검증된 email 로 user_profiles 확정 (ensureProfileForEmail)
      -> ix_auth_login_sessions 에 새 행 (세션 ID 는 항상 신규 = 세션 고정 방지)
      -> 저장하는 것: 세션 토큰 digest, CSRF digest, access/refresh 토큰, 만료 3종
6. Set-Cookie 2개
      <name>       = 불투명 세션 토큰   HttpOnly Secure SameSite=Lax Path=/
      <name>-csrf  = CSRF 토큰          Secure SameSite=Lax Path=/  (스크립트 가독)
7. 응답 본문에 user{profileId,email,displayName,roles,groups} + csrfToken
```

### 3.2 요청·핸드셰이크 인가

```text
[HTTP]  요청 -> 쿠키 -> ix_auth_login_sessions 조회(digest)
            -> revoked / idle 만료 / absolute 만료 검사
            -> access 만료 60초 전이면 IX-Auth /auth/refresh 로 회전
               (회전된 refresh 토큰을 반드시 저장. 구 토큰 재사용은 절도로 간주돼
                그 사용자의 모든 세션이 폐기된다)
            -> accessToken JWKS 로컬 검증 -> 클레임 파싱
            -> IxAuthPrincipal 생성 (요청 본문·헤더로는 절대 생성 불가)
            -> 변경 요청이면 Origin 검사 + x-openclaw-csrf 헤더를 세션 digest 와 대조

[WS upgrade]  auth-context.ts resolveConnectAuthState 가 req 를 이미 받는다
            -> 같은 쿠키 검증을 touch=false 로 수행 (핸드셰이크가 유휴 창을 밀지 않는다)
            -> authResult { ok, method:"ix-auth", user: email }
[WS connect]  connect-policy.ts   isControlUi && (trustedProxyAuthOk || ixAuthOk) => device 면제
              connect-device-tokens.ts  !trustedProxyAuthOk && !ixAuthOk => 기기 토큰 미발급
              connect-user-profile.ts   boundProfileId 로 로그인 때 확정한 프로필에 직결
              connect-session.ts ix-auth 세션이면 역할 정의에서 스코프를 그대로 펼친다
                                 (브라우저가 무엇을 요청했든 상관없다)
```

**역할이 프로필에 닿아야 한다.** 핸드셰이크 이후의 판정(연결 스코프, 타인 세션 상한,
에이전트 허용)은 전부 `user_profiles.role` 을 읽는 `resolveOperatorRolePolicyForProfile`
을 거친다. 로그인이 그 행을 쓰지 않으면 `gateway.roles.default` 가 적용되고, 시스템
관리자도 기본 역할의 스코프로 붙는다. 그래서 로그인과 `/auth/me` 가 매핑된 역할을
프로필에 투영한다(`src/auth/ix-auth/ix-auth-role-projection.ts`). IX-Auth 가 정본이므로
투영은 갓 검증한 토큰이 말하는 것만 쓰고, 매핑되지 않는 코드는 저장된 역할을 건드리지
않는다.

**연결 스코프는 요청이 아니라 역할이다.** 다른 인증 경로에서 `connect.scopes` 는 요청이고
기기·프록시 헤더·역할 정의가 차례로 상한이 된다. ix-auth 세션에서는 역할 정의 하나가
답이다(`src/gateway/ix-auth-connection-scopes.ts`). 오래된 기기 토큰의 스코프 목록이나
`x-openclaw-scopes` 헤더가 관리자를 조용히 강등하지 못하게 하려는 것이다. trusted-proxy
경로는 종전대로 헤더 상한을 지킨다.

### 3.3 로그아웃

```text
POST /auth/logout  (Origin 검사 + CSRF 헤더 필수)
  -> ix_auth_login_sessions.revoked_at 기록  = 즉시 무효
  -> IX-Auth /auth/logout 으로 refresh 토큰 폐기 (best effort)
  -> 쿠키 2개 만료
  -> UI 는 전체 리로드로 이전 사용자의 캐시·구독을 통째로 버린다
```

**즉시성이 여기서 나온다.** access token 은 15분짜리라 로컬 검증만으로는 무효화할 수 없다. 게이트웨이가 세션 행을 갖고 있기 때문에 로그아웃·정지가 다음 요청부터 바로 먹는다.

## 4. 설정 키

```json5
{
  gateway: {
    mode: "local",
    auth: {
      mode: "ix-auth",
      ixAuth: {
        baseUrl: "http://ix-auth:9100", // 내부망 주소. 브라우저는 모른다
        jwksUrl: "...", // 생략 시 <baseUrl>/.well-known/jwks.json
        serviceKey: "<SecretRef 또는 평문>", // X-IxAuth-Key
        issuer: "https://gateway.example", // IX-Auth 의 IXAUTH_JWT_ISSUER 와 정확히 같아야 한다
        audience: "openclaw", // IXAUTH_JWT_AUDIENCE 와 같아야 한다
        cookieName: "__Host-openclaw-session", // 기본값
        // 생략하면 게이트웨이가 중계하는 내장 경로 "/admin/identity/" 가 쓰인다.
        // 콘솔을 별도 호스트에 띄우는 배포만 절대 URL 로 덮어쓴다
        adminConsoleUrl: "https://ixauth-admin.example/admin-ui",
        roleMap: {
          SUPERADMIN: "superadmin",
          ADMIN: "admin",
          EXECUTIVE: "executive",
          MODERATOR: "moderator",
          MEMBER: "member",
        },
        superAdminRoles: ["superadmin"],
        departmentClaim: "ixauth_groups", // 기본값
        departmentGroupPrefix: "dept-", // 기본값
        session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
      },
    },
    roles: {
      default: "member",
      definitions: {
        superadmin: { sessions: { others: "write" }, agents: "*", scopes: ["operator.admin"] },
        admin: {
          sessions: { others: "write" },
          agents: "*",
          scopes: ["operator.read", "operator.write", "operator.approvals", "operator.questions"],
        },
        executive: {
          sessions: { others: "view" },
          agents: "*",
          scopes: ["operator.read", "operator.write", "operator.questions"],
        },
        moderator: {
          sessions: { others: "suggest" },
          agents: "*",
          scopes: ["operator.read", "operator.write", "operator.approvals", "operator.questions"],
        },
        member: {
          sessions: { others: "view" },
          agents: "*",
          scopes: ["operator.read", "operator.write", "operator.questions"],
        },
      },
    },
  },
  tools: { sessions: { visibility: "self" } },
}
```

**함정 3개** (전부 로컬 검증에서 실측으로 드러났다):

| 함정                                   | 증상                                                             | 해결                                                                              |
| -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `issuer` / `audience` 불일치           | 로그인은 200 인데 곧바로 세션이 죽는다                           | 게이트웨이 설정과 `IXAUTH_JWT_ISSUER`/`IXAUTH_JWT_AUDIENCE` 를 글자 그대로 맞춘다 |
| `gateway.mode` 누락                    | `Gateway start blocked: existing config is missing gateway.mode` | `"mode": "local"` 을 넣는다                                                       |
| `roles.definitions.<role>.agents` 누락 | `gateway.roles.definitions.admin.agents: Invalid input`          | 각 역할에 `agents` 를 명시한다(`"*"` 또는 에이전트 ID 배열)                       |

**배포 스택에서는 함정 1이 구조적으로 제거돼 있다.** `chris-local/docker-compose.ixauth.yml` 과 `chris-local/ixauth-gateway-config/openclaw.json` 이 `issuer`/`audience` 를 같은 리터럴(`openclaw-ix-auth` / `openclaw-gateway`)로 박아 두어 운영자가 두 곳을 맞출 일이 없다. 설치 절차는 [DEPLOY.md](DEPLOY.md).

`gateway.auth.token` 과 상호배타다. 둘 다 있으면 기동을 거부한다 - 공유 비밀이 있으면 1인 로그인을 우회하는 길이 생기기 때문이다.

## 5. 역할 매핑표

| IX-Auth 역할 코드 | 게이트웨이 역할 | 한국어 표기   | 세션 타인 열람               | 스코프                            | 관리 콘솔 링크 |
| ----------------- | --------------- | ------------- | ---------------------------- | --------------------------------- | -------------- |
| `SUPERADMIN`      | `superadmin`    | 시스템 관리자 | write                        | `operator.admin`                  | 보인다         |
| `ADMIN`           | `admin`         | 관리자        | write                        | read, write, approvals, questions | 안 보인다      |
| `EXECUTIVE`       | `executive`     | 임원          | view                         | read, write, questions            | 안 보인다      |
| `MODERATOR`       | `moderator`     | 중재자        | suggest                      | read, write, approvals, questions | 안 보인다      |
| `MEMBER`          | `member`        | 직원          | view                         | read, write, questions            | 안 보인다      |
| 매핑 없음         | (없음)          | 설정한 이름   | `gateway.roles.default` 적용 | 그 역할의 상한                    | 안 보인다      |

규칙:

- **여러 역할을 가지면 가장 높은 것**을 취한다(superadmin > admin > executive > moderator > member). 매핑 목록에 없는 이름은 모든 알려진 이름보다 낮게 정렬된다.
- **`executive` 는 계급이 아니라 도달 범위다.** 스코프와 세션 상한은 `member` 와 같고, 다른 점은 전 부서를 읽는다는 것뿐이다. 그 열람은 이 역할이 주는 것이 아니라 IX-Auth 에서 모든 `dept-` 그룹에 넣어서 얻는다 - 부서 경계 코드에는 임원을 위한 예외가 없다([AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 3절). 그래서 `admin` 보다 아래에 정렬한다. 위에 두면 임원을 겸한 관리자가 강등된다.
- **한국어 표기는 UI 카탈로그 한 곳**(`ui/src/features/ix-auth/ix-auth-role-labels.ts` + `ixAuth.roles.*`)에서 나온다. 역할 코드와 게이트웨이 역할 이름 둘 다 같은 라벨로 옮겨지므로 화면이 날것의 코드를 보이지 않는다. 매핑에 없는 이름은 설정한 그대로 보인다.
- **`superadmin` 승격은 `roleMap` 만으로는 안 된다.** `superAdminRoles` 에도 있어야 한다. 매핑 오타 하나로 관리자가 생기지 않게 하는 이중 조건이다.
- 관리 콘솔 링크는 `superadmin` 에게만 **응답 본문에 실린다.** 브라우저에서 감추는 것이 아니라 애초에 보내지 않는다. 주소를 직접 입력해도 게이트웨이의 `/admin/identity/*` 가 같은 판정으로 403 을 낸다. `admin` 은 콘솔을 못 열지만 앱 안의 초대·가입 승인·사용자 관리·감사 조회는 그대로 쓴다 - 두 판정은 이름이 다른 별개의 술어다(`canOpenIxAuthAdminConsole` 과 `canUseIxAuthAdminApi`).

  화면이 이 둘을 한동안 뒤섞고 있었다. `admin` 에게는 오지 않는 `adminConsoleUrl` 의 존재로 "사용자 관리를 해도 되는가" 를 판정해서, 서버가 200 을 내주는 `/settings/users`·`/settings/audit` 을 화면이 스스로 잠갔다. O 단계에서 세션 프로브가 **역할**(`user.gatewayRole`)을 `superadmin`·`admin` 과 맞추도록 고쳤다(`ui/src/features/ix-auth/ix-auth-admin-access.ts` 의 `isIxAuthAdminRole`). P 단계에서 부서 화면도 관리자에게 열렸다(5-1).
- 부서는 `ixauth_groups` 의 `dept-` 접두 코드에서 뽑아 `IxAuthPrincipal.departments` 에 담는다. A 단계는 매핑 데이터만 준비했고, **B 단계가 강제를 붙였다** - 정본 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md).

## 5-1. 설정 메뉴 표시 규칙 (P 단계, 2026-09-08)

ix-auth 모드의 `/settings` 왼쪽 메뉴는 역할 세 단계로 갈린다. 판정은 `ui/src/app-navigation.ts` 의 `isSettingsNavigationRouteVisible` 하나이고, 세 단계를 구분하는 술어는 `ui/src/features/ix-auth/ix-auth-admin-access.ts` 에 모여 있다(`isIxAuthRestrictedAccount`·`isIxAuthAdminOnlyAccount`·`canManageIxAuthUsers`·`canManageIxAuthDepartments`).

| 메뉴 | 라우트 | 그 화면이 요구하는 것 | 직원·중재자·임원 | 관리자 | 시스템 관리자 | 근거 |
| --- | --- | --- | --- | --- | --- | --- |
| 프로필 | `profile` | 읽기 전용 신원 표시 | 보임 | 보임 | 보임 | `ui/src/pages/profile/` (ix-auth 모드는 읽기 전용) |
| 화면 설정 | `appearance` | 브라우저 로컬 테마·언어 | 보임 | 보임 | 보임 | `ui/src/pages/config/route.ts:65` |
| 알림 | `notifications` | 브라우저 로컬 알림 | 보임 | 보임 | 보임 | `ui/src/pages/config/route.ts:66` |
| 음성 대화 | `talk` | 채팅에서 쓰는 음성 조작 | 보임 | 보임 | 보임 | `ui/src/pages/config/route.ts:71` |
| 정보 | `about` | 버전 표시 | 보임 | 보임 | 보임 | `ui/src/pages/about/` |
| 사용자 | `users` | `/auth/admin/users` | 안 보임 | 보임 | 보임 | `src/auth/ix-auth/ix-auth-role-map.ts` 의 `canUseIxAuthAdminApi` |
| 부서 | `departments` | `/auth/admin/departments` | 안 보임 | 보임 | 보임 | `src/gateway/ix-auth-admin-departments-http.ts` (P 단계에서 관리자에게 열림) |
| 감사 기록 | `audit` | `/auth/admin/audit` | 안 보임 | 보임 | 보임 | `src/gateway/ix-auth-admin-audit-http.ts` |
| 승인 | `approvals` | `operator.approvals` | 안 보임 | 보임 | 보임 | `chris-local/ixauth-gateway-config/openclaw.json` 의 역할 정의 |
| Gateway | `connection` | `operator.admin` | 안 보임 | 안 보임 | 보임 | `ui/src/pages/connection/` |
| 채널 | `channels` | `operator.admin` | 안 보임 | 안 보임 | 보임 | `ui/src/pages/channels/channels-page.ts:651` |
| 기기 | `devices` | `operator.admin`(페어링 승인) | 안 보임 | 안 보임 | 보임 | `ui/src/pages/devices/` |
| 에이전트 | `agents` | `operator.admin` | 안 보임 | 안 보임 | 보임 | `ui/src/pages/agents/agents-page.ts:718` 외 |
| 모델 | `model-providers` | `operator.admin`(`config.set`) | 안 보임 | 안 보임 | 보임 | `ui/src/pages/model-providers/` |
| 모델(채팅) | `model-catalog` | `/auth/admin/models` | 안 보임 | 보임 | 보임 | `src/gateway/ix-auth-admin-models-http.ts` (U 단계에서 신설) |
| 메모리 | `memory` | 게이트웨이 전역 설정(`plugins.slots.memory`) | 안 보임 | 안 보임 | 보임 | `ui/src/pages/config/memory-page.ts:60` |
| 고급 | `advanced` | 게이트웨이 설정 편집 | 안 보임 | 안 보임 | 보임 | `ui/src/pages/config/route.ts:74` |
| 디버그 | `debug` | 진단 | 안 보임 | 안 보임 | 보임 | `ui/src/pages/debug/` |
| 로그 | `logs` | 게이트웨이 로그 | 안 보임 | 안 보임 | 보임 | `ui/src/pages/logs/` |
| IX-Auth 콘솔 링크 | `/admin/identity/` | `canOpenIxAuthAdminConsole` | 안 보임 | 안 보임 | 보임 | 위 5절 마지막 항목 |

- **감추는 것으로 끝내지 않는다.** 주소를 직접 입력해도 같은 판정이 라우트 아웃렛을 "권한 없음" 안내로 바꾼다(`ui/src/app/settings-route-access.ts`). 아웃렛을 아예 그리지 않으므로 그 화면의 로더가 게이트웨이에 아무것도 묻지 않는다. 하위 페이지(`ai-agents`·`model-setup`)는 자기 상위 항목의 판정을 따른다.
- **토큰 모드는 그대로다.** 세 단계 판정은 `authMode: "ix-auth"` 이고 로그인한 세션에서만 켜지고, 그 전에는 전부 거짓이라 화면이 뜨는 도중에 항목이 사라지지 않는다.
- **모델 화면이 둘인 이유**(U 단계, 2026-09-09). 업스트림 `model-providers` 는 설정을 `config.set` 으로 쓰므로 `operator.admin` 이 필요하고, 그것은 시스템 관리자만 가진다. 그런데 "어떤 모델이 답하고 사람들이 채팅에서 무엇을 고를 수 있는가" 는 사용자·부서와 같은 회사 운영 판단이다. 그래서 그 판단만 하는 좁은 화면 `model-catalog` 를 따로 두고 관리자에게 열었다. 이 화면이 쓰는 것은 `/auth/admin/models` 하나이고, 그 라우트는 문서 전체가 아니라 이름 붙은 네 필드(`primary`·`fallbacks`·`allow`·`utilityModel`)만 받는다. 읽기(`models.list`·`models.authStatus`)는 관리자가 이미 가진 `operator.read` 로 충분하다. 모델 인증(구독 로그인·토큰)을 새로 넣는 것은 이 화면의 일이 아니고, 인증 상태를 보여 주고 없으면 안내만 한다. 저장은 감사 원장에 `admin_action`/`model-policy` 로 남는다. 재기동 후 유지 방식은 [DEPLOY.md](DEPLOY.md) 3.4.
- **이 화면을 위해 프로바이더를 감추는 코드는 넣지 않았다**(Y 단계 판단, 2026-09-09). 감출 필요가 없었기 때문이다. codex 플러그인을 끄자 **OpenAI 프로바이더가 카탈로그에서 통째로 사라졌다**(`models list --all` 의 `openai/` 0건, 화면 프로바이더 8개 -> 7개). `openai` 플러그인 자체는 그대로 실려 있는데도(기동 로그의 플러그인 12개에 들어 있다) 목록이 비었다. 확인한 것은 "codex 를 끄면 OpenAI 모델이 카탈로그에서 사라진다" 는 사실이고, 되켜면 돌아온다.
- 남아 있는 자격증명 없는 프로바이더(`claude-cli`·`github-copilot` 등)는 그대로 보여 준다. 그것들은 "인증 없음" 으로 표시되고 스위치가 잠기므로(`blocked = !authenticated && !allowAll`) 켤 수 없고, 목록에서 감추면 관리자가 무엇을 켤 수 있었는지와 어디에 로그인하면 되는지를 화면에서 볼 길이 없어진다. 직원이 보는 채팅 모델 선택기는 이 화면이 아니라 `modelPolicy.allow` 가 정한다.
- **알려진 예외 한 가지**: 중재자는 역할 정의상 `operator.approvals` 를 가지지만 승인 화면은 관리자 전용으로 두었다. 채팅 사이드바의 승인 알림으로는 그대로 처리할 수 있다. 승인 화면까지 열지는 사용자 결정으로 남긴다.

## 5-2. 시스템 관리자 계정 보호 (P 단계)

`admin` 은 `superadmin` 행에 대해 다음을 할 수 없다. 판정은 `src/gateway/ix-auth-admin-users-guard.ts` 의 `rejectSuperAdminTarget` 하나이고 403 `forbidden` 을 낸다.

| 동작 | 경로 | 관리자 | 시스템 관리자 |
| --- | --- | --- | --- |
| 역할 변경 | `PUT /auth/admin/users/<id>/roles` | 거부 | 가능 |
| 부서 변경 | `PUT /auth/admin/users/<id>/departments` | 거부(P 단계에서 추가) | 가능 |
| 비활성화 | `PATCH /auth/admin/users/<id>` (`status`) | 거부 | 가능 |
| 삭제 | `DELETE /auth/admin/users/<id>` | 거부(원래 superadmin 전용) | 가능 |
| 2단계 인증 초기화 | `POST /auth/admin/users/<id>/mfa-reset` | 거부(P 단계에서 추가) | 가능 |
| 세션 강제 종료 | `DELETE /auth/admin/users/<id>/sessions` | 거부(P 단계에서 추가) | 가능 |
| `SUPERADMIN` 역할 부여 | 역할·초대·CSV 가져오기 | 거부 | 가능 |

- 자기 자신의 역할·부서·상태는 **누구도** 바꾸지 못한다(`rejectSelfTarget`). 이름 변경만 예외다.
- 마지막 시스템 관리자를 강등·비활성화·삭제하는 것은 시스템 관리자에게도 409 `last_super_admin` 이다.
- 비밀번호 재설정 메일·초대 재발송·잠금 해제는 관리자도 시스템 관리자 행에 쓸 수 있다. 셋 다 계정 소유자에게만 도달하므로 탈취 경로가 아니고, 헬프데스크 동작으로 남긴다.
- 화면(`ui/src/pages/users/user-detail-panel.ts`)은 그 행의 조작을 흐리게 하고 이유를 한 줄로 적는다. 서버 판정이 정본이고 화면은 그것을 되풀이할 뿐이다.

## 6. 이번 단계에서 하지 않은 것

| 항목                                       | 상태                                                                                                                              | 다음 단계 조건                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 부서 접근 강제(`department-access`)        | **해결(B 단계).** `tools.sessions.visibility: "department"` 로 켠다                                                               | 정본 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md)                                   |
| `departments` / `department_agents` 테이블 | **해결(B 단계).** feature-local DDL 3표, 스키마 버전 유지                                                                         | AUTH-DEPARTMENTS.md 6절                                                           |
| 세션 목록·이벤트·`agents.list` 부서 필터   | **해결(B 단계).** 목록·직접 열람·전사·이벤트·에이전트 선택·생성 게이트                                                            | AUTH-DEPARTMENTS.md 7절                                                           |
| 초대장 가입 플로우 화면                    | **해결(C 단계).** 초대 수락·가입 신청·이메일 인증·비밀번호 찾기·재설정 + 관리자 초대·승인 화면                                    | 정본 [AUTH-SIGNUP.md](AUTH-SIGNUP.md)                                             |
| 포크 감사 원장 해시 체인                   | 미구현. 인증 사건은 IX-Auth 원장에 남는다                                                                                         | 6.3                                                                               |
| TOTP 등록 화면                             | 미구현. 로그인 시 코드 입력 단계는 구현했다                                                                                       | IX-Auth 콘솔에서 등록. **콘솔 접근 경로가 A 단계에서 열렸다**(`/admin/identity/`) |
| 관리 콘솔 접근 경로                        | **해결(A 단계).** 게이트웨이 BFF `/admin/identity/` 가 중계한다. **J 단계에서 superadmin 전용 + 무로그인 진입으로 바뀌었다**(7.2) | -                                                                                 |
| 역할 4단계 시드                            | **해결(A 단계).** IX-Auth 마이그레이션 `V14` 가 만든다. 콘솔에서 손으로 만들 필요가 없다                                          | -                                                                                 |
| 무인 배포                                  | **해결(A 단계).** `docker compose up -d` 한 번으로 마이그레이션·역할 시드·superadmin 부트스트랩·설정 주입이 끝난다                | 절차는 [DEPLOY.md](DEPLOY.md)                                                     |

**A 단계의 완화책**: `tools.sessions.visibility` 를 `"self"` 로 좁혀 두었다. B 단계에서 같은 키를 `"department"` 로 올려 그 자리가 실제 경계가 됐다.

### 6.1 부서 강제 (B 단계에서 완료)

세 진입 조건이 모두 충족돼 구현했다. 정본은 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md).

1. 부서 코드 체계 확정 - `dept-<slug>`, 정본은 IX-Auth 그룹이고 포크 DB 는 투영이다.
2. 스키마 승인 - 감독자 승인 근거를 AUTH-DEPARTMENTS.md 6.1 에 남겼다.
3. 훅 회귀 - `department-access.test.ts` 21건 + 기존 sharing·visibility 회귀 통과.

### 6.2 초대장 가입 (C 단계에서 완료)

세 진입 조건이 모두 해소돼 구현했다. 정본은 [AUTH-SIGNUP.md](AUTH-SIGNUP.md).

1. SMTP 는 선택으로 확정했다. 없는 배포는 `IXAUTH_MAIL_TRANSPORT=WEBHOOK` 으로 초대 링크가 게이트웨이에 넘어오고 관리자 화면이 그것을 보여준다. 로그를 뒤질 필요가 없어졌다.
2. `IXAUTH_ACCOUNT_SIGNUP_MODE` 한 값이 IX-Auth 의 가입 모드와 게이트웨이의 가입 화면 노출을 동시에 정한다. 기본은 `CLOSED` + 초대장 전용.
3. 도착 화면 3개(`/reset-password`·`/accept-invite`·`/verify-email`)와 `/signup`·`/forgot-password` 를 만들었다. 토큰 판정은 전부 IX-Auth 가 한다.

### 6.3 감사 원장 진입 조건

인증 사건은 이미 IX-Auth 원장(append-only, CSV 내보내기)에 있다. 포크 원장이 필요한 것은 세션 열람·질문·파일 열람·부서 거부이고, 그것은 6.1 이 선행돼야 의미가 생겼다. **H 단계에서 들어왔다** - 정본 [AUTH-AUDIT.md](AUTH-AUDIT.md).

## 7. 운영 절차

### 7.1 최초 기동

```bash
cp chris-local/ixauth.env.example chris-local/ixauth.env   # 시크릿 채우기
docker compose --env-file chris-local/ixauth.env \
  -f chris-local/docker-compose.ixauth.yml up -d
```

`IXAUTH_ADMIN_EMAIL` / `IXAUTH_ADMIN_PASSWORD` 로 최초 관리자 1명이 **첫 부팅에만** 시드되고 `SUPERADMIN` 역할을 받는다. IX-Auth 에는 "첫 로그인 시 비밀번호 변경 강제" 기능이 없으므로, 첫 로그인 후 콘솔에서 비밀번호를 바꾸는 것은 **운영 지시**다.

요구사항·`.env` 항목표·백업·되돌리기·라이선스 확인 항목은 [DEPLOY.md](DEPLOY.md).

### 7.2 사용자 추가

**앱 안의 설정 > 사용자**(`/settings/users`)에서 한다. F 단계에서 들어왔고 정본은 [AUTH-USERS.md](AUTH-USERS.md).

콘솔은 게이트웨이가 **`/admin/identity/` 에서 중계**한다. 신원 서버는 포트를 열지 않는다(설계 불변식 4). 사용자 관리 화면의 "고급: IX-Auth 콘솔" 링크가 그 경로이고, 링크 노출과 중계 통과 조건이 **둘 다 superadmin** 이다.

**콘솔은 로그인 화면을 띄우지 않는다(J 단계).** 게이트웨이가 그 사람의 세션이 이미 쥔 신원 서버 access token 을 업스트림 요청의 `Authorization` 에 붙이고, 콘솔의 로그인 경로(`/api/login`·`/api/mfa/verify`)는 404 로 막는다. 토큰은 브라우저로 내려가지 않는다 - 콘솔 화면이 열리도록 `sessionStorage` 에 심는 값은 상류에서 항상 덮어써지는 불투명 sentinel 이다.

그 대가로 "콘솔 자체 로그인" 이라는 이중 방어가 사라졌다. 이제 게이트웨이 세션 하나가 곧 콘솔 접근이므로 **통과 조건을 superadmin 으로 좁혔다.** 관리자에게 이중 방어였던 적도 없다 - baseline 시드가 `ADMIN` 역할에도 `ixauth:*:*` 전권을 주므로, 콘솔을 열 수 있는 관리자는 이미 사용자 생성·삭제·역할 변경을 다 할 수 있었다. 근거 정본은 [ix-auth/MODULE.md](../ix-auth/MODULE.md) 7.3.1.

**콘솔의 로그아웃 버튼은 "게이트웨이로 돌아가기" 다(K 단계).** 콘솔의 `logout()` 은 `sessionStorage` 를 비우고 자기 로그인 폼을 띄우는데, 그 폼이 부르는 `/admin-ui/api/login` 은 위에서 404 로 막혀 있다. 그래서 로그아웃을 누른 사람은 아무 것도 통하지 않는 로그인 화면에 갇혔다(J 단계 잔여 결함).

방문자의 세션은 애초에 콘솔의 것이 아니라 게이트웨이의 것이다. 그래서 프록시가 콘솔 문서 끝에 스크립트를 하나 더 붙여 `window.logout` 을 덮어쓰고, 버튼 문구를 바꾸고, 콘솔 진입 전 화면인 `/settings/users` 로 보낸다. 세션이 그대로라 **재로그인 없이 링크를 다시 눌러 들어올 수 있다.** 진짜 로그아웃은 지금까지처럼 게이트웨이 계정 메뉴(설정 > Gateway)에 있다.

덮어쓰기 스크립트는 부트스트랩과 달리 콘솔 스크립트 **뒤**(`</body>` 앞)에 넣는다. 앞에 두면 콘솔의 함수 선언이 이겨서 덮어쓴 것이 도로 사라진다. 게이트웨이가 하위 경로에 붙어 있어도 되도록 돌아갈 주소는 문서가 실제로 서빙된 `location.pathname` 에서 계산한다.

역할 `SUPERADMIN`·`ADMIN`·`MODERATOR`·`MEMBER` 4종은 IX-Auth 마이그레이션 `V14` 가 기동 시 시드한다. 원본 기본 역할이 `ADMIN`/`USER` 뿐이라 `roleMap` 이 비어 떨어지던 문제는 없어졌다. 고객이 자기 역할 코드를 쓰면 `roleMap` 을 그쪽에 맞춘다.

### 7.3 즉시 차단

| 하고 싶은 것         | 방법                                       | 반영 시점                                             |
| -------------------- | ------------------------------------------ | ----------------------------------------------------- |
| 한 사람을 지금 끊기  | 설정 > 사용자 에서 비활성 또는 "세션 종료" | 즉시 (IX-Auth 세션·게이트웨이 세션·WS 를 함께 끊는다) |
| 역할·부서 변경 반영  | 설정 > 사용자 에서 바꾼다                  | 즉시 (같은 정리 절차가 자동으로 따라붙는다)           |
| 콘솔에서만 바꿨을 때 | 콘솔에서 `status=DISABLED` 또는 역할 변경  | 게이트웨이의 다음 갱신(최대 15분)                     |

앱 화면의 변경은 **세 곳을 함께 끊는다**(AUTH-USERS 4절). 콘솔에서만 역할을 바꾸고 세션을 건드리지 않으면 **최대 15분** 늦게 반영된다. 이것은 로컬 검증의 대가이고 계약 문구에 넣어야 한다.

### 7.4 진단

| 증상                                        | 확인                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| 로그인 화면이 안 뜨고 토큰 입력 화면이 뜬다 | `GET /auth/me` 가 `{"authMode":"ix-auth"}` 를 주는지. 아니면 모드가 안 켜진 것 |
| 로그인 200 인데 바로 로그아웃된다           | `issuer`/`audience` 불일치. 게이트웨이 로그에서 `identity-claims-invalid`      |
| 로그인은 되는데 WS 가 안 붙는다             | `gateway.controlUi.allowedOrigins` 와 실제 Origin                              |
| 반복 실패 후 계속 429                       | 게이트웨이 IP 리미터(기본 5분) 또는 IX-Auth 분당 10회 리미터                   |
| 쿠키가 아예 안 저장된다                     | HTTPS 도 루프백도 아닌 접근. `__Host-` 쿠키는 그런 곳에 저장되지 않는다        |

## 8. 되돌리기

```text
1. gateway.auth.mode 를 "token" 또는 "trusted-proxy" 로 되돌리고
   gateway.auth.ixAuth 블록을 제거한다. gateway.auth.token 을 다시 넣는다
2. 게이트웨이 재시작
3. ix_auth_login_sessions 는 남겨 둔다 (구버전은 모르는 테이블을 무시한다)
   - 남은 행이 신경 쓰이면 revoked_at 을 채운다. DROP 은 하지 않는다
4. IX-Auth 컨테이너와 PostgreSQL 은 정지만 한다. 계정 데이터는 보존한다
5. 브라우저는 쿠키가 무의미해지므로 다음 접속에서 토큰 화면으로 떨어진다
```

**금지**: `ix_auth_login_sessions` DROP, IX-Auth DB 삭제. 되돌린 뒤 다시 켤 때 계정을 처음부터 만들게 된다.

벤더 트리 자체를 걷어내는 절차는 [ix-auth/VENDOR.md](../ix-auth/VENDOR.md) 6절.

## 9. 파일 지도

### 9.1 신규

| 경로                                                 | 역할                                                 |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `src/auth/ix-auth/ix-auth-types.ts`                  | `IxAuthPrincipal` 등 닫힌 계약과 기본값 상수         |
| `src/auth/ix-auth/ix-auth-claims.ts`                 | 클레임 파싱·검증, 부서 코드 추출                     |
| `src/auth/ix-auth/ix-auth-jwks.ts`                   | JWKS 캐시 + RS256/ES256 로컬 검증 (`node:crypto` 만) |
| `src/auth/ix-auth/ix-auth-client.ts`                 | IX-Auth `/auth/*` 중계. 서비스 키·실방문자 IP 전달   |
| `src/auth/ix-auth/ix-auth-role-map.ts`               | 역할 코드 -> 게이트웨이 역할, 콘솔·관리 API 판정 2종 |
| `src/auth/ix-auth/ix-auth-sessions.ts`               | 세션 발급·검증·갱신·폐기                             |
| `src/auth/ix-auth/ix-auth-role-projection.ts`        | 매핑된 역할을 `user_profiles.role` 에 투영           |
| `src/gateway/ix-auth-connection-scopes.ts`           | 역할 정의 -> 연결 스코프 (요청은 상한이 아니다)      |
| `src/auth/ix-auth/ix-auth-settings.ts`               | 설정 해석·기본값·서비스 키 캐시                      |
| `src/state/ix-auth-sessions-schema.ts`               | feature-local DDL (`user_profiles` 와 같은 방식)     |
| `src/state/ix-auth-sessions-store.ts`                | Kysely 행 접근                                       |
| `src/gateway/cookie-header.ts`                       | 쿠키 파서·직렬화·보안 컨텍스트 판정 (승격본)         |
| `src/gateway/ix-auth-http.ts`                        | `/auth/*` 핸들러                                     |
| `src/gateway/ix-auth-http-paths.ts`                  | 경로 분류                                            |
| `src/gateway/ix-auth-principal.ts`                   | 요청·핸드셰이크 -> principal                         |
| `ui/src/features/ix-auth/ix-auth-session-api.ts`     | Control UI 클라이언트                                |
| `ui/src/features/ix-auth/ix-auth-form-state.ts`      | 로그인 폼 상태                                       |
| `ui/src/components/ix-auth-login.ts`                 | 로그인 화면 (지연 로드)                              |
| `ui/src/pages/connection/ix-auth-account-section.ts` | 계정 표시·로그아웃·콘솔 링크                         |
| `ui/src/i18n/locales/en-ix-auth.ts`                  | i18n 카탈로그                                        |
| `src/gateway/ix-auth-admin-proxy.ts`                 | 관리 콘솔 BFF 프록시 (`/admin/identity/*`)           |
| `chris-local/docker-compose.ixauth.yml`              | 배포 정의                                            |
| `chris-local/ixauth-gateway-config/openclaw.json`    | 배포 설정 정본 (시크릿은 env SecretRef)              |
| `chris-local/ixauth-gateway-config/start-gateway.sh` | 설정 렌더링 + 기동                                   |
| `chris-local/DEPLOY.md`                              | 납품 설치 절차서                                     |
| `chris-local/ixauth-verify.sh`                       | 로컬 검증 스택                                       |

### 9.2 수정 (훅 지점만)

| 경로                                                                 | 훅                                           |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `src/config/types.gateway.ts`                                        | 모드 유니온 + `GatewayIxAuthConfig`          |
| `src/config/zod-schema.gateway.ts`                                   | 모드 리터럴 + `ixAuth` strictObject          |
| `src/gateway/auth-resolve.ts`                                        | 모드 유니온·병합 키·Tailscale 비활성         |
| `src/gateway/auth.ts`                                                | method 유니온, 상호배타 검증, HTTP 인가 분기 |
| `src/gateway/server-http.ts`                                         | `/auth/*` 를 비 admitted stage 로 등록       |
| `src/gateway/server/ws-connection/auth-context.ts`                   | 쿠키 -> principal                            |
| `src/gateway/server/ws-connection/connect-auth.ts`                   | `ixAuthOk` 계산·전달                         |
| `src/gateway/server/ws-connection/connect-policy.ts`                 | device 면제 + 선언 스코프 폐기               |
| `src/gateway/server/ws-connection/connect-device-tokens.ts`          | 기기 토큰 미발급                             |
| `src/gateway/server/ws-connection/connect-user-profile.ts`           | `boundProfileId`                             |
| `src/gateway/server/ws-connection/connect-session.ts`                | principal 전달                               |
| `src/gateway/server/ws-connection/message-handler-types.ts`          | 상태 필드 2개                                |
| `packages/gateway-protocol/src/schema/snapshot.ts`                   | `authMode` 유니온                            |
| `ui/src/app/app-root.ts`                                             | 세션 부트스트랩 + 로그인 화면 분기           |
| `ui/src/app/lazy-custom-element.ts`                                  | 로그인 화면 지연 로드 등록                   |
| `ui/src/api/gateway.ts`                                              | 기기 토큰 저장 억제                          |
| `ui/src/pages/connection/view.ts`·`connection-page.ts`               | 계정 블록·로그아웃                           |
| `ui/src/i18n/locales/en.ts`·`scripts/lib/control-ui-i18n-catalog.ts` | 카탈로그 등록                                |

## 10. 보안 체크리스트 대비표

| 항목                    | 구현 위치                                                       | 테스트                           |
| ----------------------- | --------------------------------------------------------------- | -------------------------------- |
| 비밀번호 저장·해시      | **IX-Auth** (bcrypt, 정책·재해싱 포함)                          | 제품 자체 적합성 검사            |
| 이메일 열거 방지        | `ix-auth-http.ts` `IX_AUTH_INVALID_CREDENTIALS` 단일 응답       | 라이브 1·2 (본문·상태 동일)      |
| 무차별 대입             | 게이트웨이 IP 리미터 + IX-Auth 분당·계정 잠금                   | 라이브 5                         |
| CSRF                    | `ix-auth-http.ts` Origin 검사 + 세션 결합 토큰 digest 대조      | 라이브 4                         |
| 세션 고정               | `persistIxAuthLoginSession` 이 항상 새 ID 발급                  | `ix-auth-sessions-store.test.ts` |
| 쿠키 속성               | `cookie-header.ts` `serializeGatewaySetCookie` (`__Host-` 강제) | `cookie-header.test.ts`          |
| 세션 만료               | idle 30분 / absolute 12시간, 서버가 판정                        | `ix-auth-sessions-store.test.ts` |
| WS Origin               | 기존 `checkGatewayWsBrowserOrigin` 유지                         | 기존 회귀                        |
| 기기 토큰 우회 차단     | `connect-device-tokens.ts` + `ui/src/api/gateway.ts`            | `connect-policy.ix-auth.test.ts` |
| 자기 선언 스코프 불신   | `connect-policy.ts` `shouldClearUnboundScopes...`               | `connect-policy.ix-auth.test.ts` |
| 권한 상승 차단          | `superAdminRoles` 이중 조건                                     | `ix-auth-role-map.test.ts`       |
| 토큰 위조·알고리즘 강등 | `ix-auth-jwks.ts` (alg 화이트리스트, kid 필수)                  | `ix-auth-jwks.test.ts`           |
| 발급자·대상 위조        | `ix-auth-claims.ts` iss/aud 대조                                | `ix-auth-claims.test.ts`         |
| 로그 비밀 배제          | 감사 이벤트에 토큰·비밀번호를 싣지 않는다                       | 코드 리뷰                        |
| 부서 누출               | `department-access.ts` (에이전트 경계, superadmin 만 통과)      | `department-access.test.ts` (21) |

## 11. 라이브 검증 기록 (2026-09-07, WSL 로컬)

검증 구성: PostgreSQL 16(사용자 권한 바이너리, 15432) + IX-Auth jar(19100) + 별도 게이트웨이 프로파일(`~/openclaw-ixauth`, 18791). 상시 인스턴스는 건드리지 않았다. Docker 는 WSL 에 없어 컨테이너 대신 프로세스로 띄웠다.

| #   | 시나리오                                                                               | 결과                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 콘솔 API 로 사용자 2명 생성 (`admin@verify.local`=ADMIN, `member@verify.local`=MEMBER) | 통과. 기본 역할이 ADMIN/USER 뿐이라 MEMBER 역할을 먼저 만들었다                                                                                                                                                               |
| 2   | Windows Chrome 격리 프로필에서 로그인                                                  | 통과. 계정 화면이 뜨고, 토큰·페어링 없이 `/chat/main` 진입, 채팅 1건 전송 확인                                                                                                                                                |
| 3   | member 로 로그인 시 관리 메뉴 미노출                                                   | 통과. `/auth/me` 응답에 `adminConsoleUrl` 자체가 없다                                                                                                                                                                         |
| 4   | 로그아웃                                                                               | 통과. 세션 행 `revoke_reason=user-logout`, 쿠키 2개 만료, 로그인 화면 복귀                                                                                                                                                    |
| 5   | 잘못된 비밀번호 반복                                                                   | 통과. 5회에 IX-Auth 가 계정 잠금(`status=LOCKED`), 11회에 게이트웨이 IP 리미터 429. 잠긴 계정에 올바른 비밀번호를 넣으면 423 `account_locked` + `lockedUntilMs`, UI 는 "Too many attempts" 로 표시                            |
| 6   | 두 번째 브라우저(모바일 에뮬레이션)에서 admin 로그인                                   | 통과. 페어링 요구 없이 진입, 이쪽만 "Manage users" 노출                                                                                                                                                                       |
| 7   | 감사 조회                                                                              | 통과. IX-Auth 원장에 `LOGIN_SUCCESS`/`LOGIN_FAILURE`/`ACCOUNT_LOCKED`, **실방문자 IP 와 실제 브라우저 User-Agent** 가 기록됐다(게이트웨이 것이 아니다). 게이트웨이 세션 표는 digest 32바이트만 저장하고 원본 세션 토큰은 없다 |

스크린샷: `D:\PROJECT\chris-server\analysis\2026-09-07-openclaw-auth\ixauth-01..08-*.png`

### 11.1 실측으로 잡은 결함 4건

| #   | 증상                                                 | 원인                                                                        | 수정                                         |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | 로그인 화면 대신 구 토큰 화면이 떴다                 | Chrome 은 동일 출처 GET 에 `Origin` 을 보내지 않는데 헤더를 무조건 요구했다 | `Sec-Fetch-Site: same-origin`/`none` 을 허용 |
| 2   | 비밀번호가 맞는데 "틀렸다" 고 나왔다                 | IX-Auth 의 분당 리미터 429 를 `invalid_credentials` 로 뭉갰다               | 429 를 `rate_limited` 로 전달                |
| 3   | 설정 화면에 `IXAUTH.TITLE` 같은 키가 날것으로 보였다 | 계정 섹션이 i18n 카탈로그를 등록하지 않았다                                 | 섹션이 직접 등록                             |
| 4   | 키 회전 직후 60초 동안 인증이 깨질 수 있었다         | 최초 JWKS 적재를 "회전 재조회" 로 세어 쿨다운을 소모했다                    | 최초 적재는 재조회로 세지 않는다             |

### 11.2 검증 중 확인한 운영 함정

- `openclaw.mjs` 는 `dist/` 가 있으면 **소스가 아니라 빌드 산출물**을 실행한다. 서버 코드를 고친 뒤 `pnpm build` 없이 재시작하면 옛 동작이 그대로 남는다(이 검증에서 실제로 15분을 잃었다).
- `chris-local/auto-deploy.sh` 타이머가 `origin/chris/main` 을 따라가므로, 기능 브랜치로 로컬 검증할 때는 `systemctl --user stop openclaw-auto-deploy.timer` 로 멈춰야 한다.
- `pkill -f openclaw-gateway` 는 자기 자신의 셸 명령줄까지 매칭해 죽인다. 포트로 PID 를 찾아 죽인다.
