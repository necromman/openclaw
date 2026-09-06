# HTTP API 계약

> **정본.** 인가 API 상세는 [`authz.md`](authz.md), 토큰 형식은 [`token.md`](token.md), 에러는 [`errors.md`](errors.md).

---

## 1. 공통

### 인증 방식 3가지

| 대상 | 방식 | 헤더 |
|------|------|------|
| **앱 → jar** (서버 간) | 공유 시크릿 | `X-IxAuth-Key: <ixauth.service-key>` |
| **사용자 컨텍스트 필요** | access token | `Authorization: Bearer <jwt>` |
| **공개** | 없음 | `/health`, `/.well-known/jwks.json` |

jar 는 외부에 노출되지 않는다 (설계 불변식 4). 브라우저는 jar 를 직접 호출하지 않으며, **앱이 중계**하고 앱 도메인 쿠키로 심는다.

### 응답 봉투

성공:

```json
{ "data": { … } }
```

실패:

```json
{ "error": { "code": "AUTH_INVALID_CREDENTIALS", "message": "이메일 또는 비밀번호가 올바르지 않습니다.", "traceId": "0f4c…" } }
```

- 목록 응답은 `data` 안에 `{ "items": [...], "page": 0, "size": 20, "total": 137 }`
- `traceId` 는 항상 포함한다. 운영에서 로그와 대조할 유일한 수단이다
- **스택트레이스·내부 경로·SQL 을 응답에 넣지 않는다**

### 공통 헤더

| 헤더 | 방향 | 설명 |
|------|------|------|
| `X-Request-Id` | 요청 | 앱이 주면 그대로 `traceId` 로 쓴다. 없으면 생성 |
| `X-Forwarded-For` | 요청 | **최종 사용자의 IP.** 본문에 `ip` 칸이 없는 호출(갱신·로그아웃 등)은 이 헤더로 전달한다. 첫 조각만 읽는다 |
| `User-Agent` | 요청 | 최종 사용자의 UA. 위와 같은 이유 |
| `X-IxAuth-Pv` | 응답 | 현재 `permissions_version`. 앱이 캐시 무효화에 쓸 수 있다 |

> jar 는 앱만 호출할 수 있으므로(설계 불변식 4) 이 두 헤더를 신뢰한다. 값을 만드는 법은 [`../guides/client-ip.md`](../guides/client-ip.md).

---

## 2. 인증 — `/auth/*`

### `POST /auth/login`

인증: 서비스 키

```json
// 요청
{ "email": "chris@prost.team", "password": "…", "userAgent": "…", "ip": "203.0.113.7",
  "captchaToken": "03AGdBq2…" }

// 200
{ "data": {
  "accessToken": "eyJ…",
  "refreshToken": "9f2c…",
  "expiresIn": 900,
  "user": { "id": "1042", "email": "chris@prost.team", "name": "이대훈",
            "roles": ["ADMIN"], "groups": ["dev-team"] },
  "mfaSetupRequired": false,
  "termsAgreementRequired": []
} }
```

- `userAgent` / `ip` 는 앱이 최종 사용자 정보를 전달한다 (jar 입장에선 앱이 클라이언트라 직접 알 수 없다). 감사 로그·세션에 기록된다
- **`ip` 는 이 순서로 뽑는다** (정본: [`../guides/client-ip.md`](../guides/client-ip.md))

  ```
  CF-Connecting-IP → True-Client-IP → X-Forwarded-For 첫 조각 → X-Real-IP → 소켓 주소
  ```

  CDN 이 없으면 앞의 둘이 비어 있어 자연히 XFF 로 떨어진다. 그래서 환경별로 코드가 갈릴 이유가 없다
- **XFF 첫 조각만 믿으면 CDN 뒤에서는 엣지 IP 가 남는다.** Cloudflare 를 거치는 구성에서는 그 자리가 엣지 서버 주소로 채워져 나가는 경우가 흔하다. 소켓 주소(`request.client.host`·`req.ip`)도 같은 함정으로, 그것은 프록시 홉의 주소다. 2026-08-25 에 소비 프로젝트 두 곳이 각각 이 두 방식으로 틀려 감사 로그가 전부 경유지 주소로 남아 있었다 (실측)
- **잘못 넘긴 값은 되돌릴 수 없다.** 이미 쌓인 줄에서 진짜 주소를 복원할 방법이 없다. 그래서 서버가 감사 IP 를 보고 방문자일 수 없는 주소면 시스템 로그에 경고한다 (`ixauth.audit.client-ip-guard`, 가이드 5절)
- **실패 응답은 이유를 구분하지 않는다** — 계정 없음과 비밀번호 불일치 모두 `AUTH_INVALID_CREDENTIALS`(401). 계정 존재 여부가 새어나가면 안 된다
- 예외: **비밀번호가 맞았는데** 잠금/비활성 상태면 `AUTH_ACCOUNT_LOCKED`(423) / `AUTH_ACCOUNT_DISABLED`(403) 를 준다. 이미 인증에 성공했으므로 노출 문제가 없고, 안내가 없으면 사용자가 원인을 알 수 없다
- **어느 상태가 로그인을 막는가** (2026-08-21 명시 — 아래 §2-1-1)

- **2단계 인증이 켜진 계정은 토큰 대신 401 `AUTH_MFA_REQUIRED` + challenge** 를 받는다 (§2-3)
- `mfaSetupRequired` (2026-08-08 추가) — 설정상 2단계가 필수인데 아직 등록하지 않았다는 신호. 앱은 이 값이 참이면 등록 화면으로 보낸다
- `termsAgreementRequired` (2026-08-08 추가) — 아직 동의하지 않은 **필수 약관 코드** 배열. 비어 있으면 앱은 아무것도 하지 않아도 된다. `mfaSetupRequired` 와 같은 이유로 **로그인을 막지 않는다** (§2-4)
- `captchaToken` (2026-08-08 추가) — `ixauth.captcha.protect` 에 `LOGIN` 이 들어 있을 때만 본다. 꺼져 있으면 보내도 무시되므로 앱이 조건 분기를 둘 필요가 없다 (§2-6)

#### 2-1-1. 계정 상태와 로그인 게이트

`users.status` 의 다섯 값이 각 로그인 경로에서 어떻게 동작하는지의 **정본**이다.
상태를 선언해 놓고 게이트를 걸지 않으면 관리 화면은 "잠김" 이라 적어 두고 실제로는
들어와지는 상태가 된다 (2026-08-20 늘봄 PoC 실측으로 드러난 결함).

| status | 뜻 | 비밀번호 로그인 | 소셜 로그인 | 매직 링크 | 에러 코드 |
|--------|----|----------------|------------|----------|----------|
| `ACTIVE` | 정상 | 통과 | 통과 | 통과 | — |
| `LOCKED` | 잠김 (아래 두 갈래) | **차단** | **차단** | 아래 참조 | `AUTH_ACCOUNT_LOCKED` (423) |
| `DISABLED` | 관리자 비활성 · 소프트 삭제 · 탈퇴 완료 | 차단 | 차단 | 차단 | `AUTH_ACCOUNT_DISABLED` (403) |
| `PENDING` | 초대 수락 전 | 차단 | 수락으로 간주해 `ACTIVE` 전환 | 차단 | `AUTH_ACCOUNT_PENDING` (403) |
| `PENDING_APPROVAL` | 가입 승인 대기 | 차단 | 차단 | 차단 | `AUTH_ACCOUNT_PENDING_APPROVAL` (403) |

**`LOCKED` 은 두 갈래이고, 구분 기준은 `locked_until` 의 유무다.**

| 갈래 | 만들어지는 경로 | `locked_until` | 푸는 방법 |
|------|----------------|---------------|----------|
| 자동 잠금 | 로그인 실패 누적 (`ixauth.lockout.*`) | 값 있음 | 시각이 지나면 **저절로** 풀린다. 성공 로그인·비밀번호 재설정도 푼다 |
| 관리자 잠금 | `PATCH /admin/users/{id}` 에 `status=LOCKED` | `null` | `POST /admin/users/{id}/unlock` 또는 `PATCH … status=ACTIVE` **뿐이다** |

- 관리자 잠금은 시간으로 풀리지 않고, 비밀번호 재설정·초대 수락으로도 풀리지 않는다.
  풀 수 있는 사람은 관리자뿐이라는 것이 이 상태의 존재 이유다
- **매직 링크는 자동 잠금만 통과시킨다.** 자동 잠금은 무차별 대입을 늦추는 장치인데
  이 경로는 비밀번호를 쓰지 않으므로 막을 이유가 없다. 관리자 잠금은 막는다 —
  아니면 "차단" 이 메일 한 통으로 우회된다
- `PATCH /admin/users/{id}` 로 `LOCKED`·`DISABLED` 가 걸리면 **그 사용자의 세션을 즉시 폐기한다.**
  차단이 다음 로그인 시점까지 미뤄지면 차단이 아니다
- `AUTH_ACCOUNT_LOCKED` 의 `meta.lockedUntil` 은 **자동 잠금일 때만** 실린다.
  관리자 잠금에는 풀리는 시각이 없으므로 앱은 이 값의 유무로 둘을 가른다

### `POST /auth/refresh`

```json
{ "refreshToken": "9f2c…" }
→ { "data": { "accessToken": "eyJ…", "refreshToken": "1a8e…", "expiresIn": 900 } }
```

- **회전(rotation)**: 새 refresh 를 함께 발급하고 기존 것을 폐기한다
- **재사용 감지**: 이미 폐기된 refresh 가 오면 해당 사용자의 **모든 세션을 폐기**하고 감사 로그에 남긴 뒤 `AUTH_SESSION_REVOKED`(401)
- **본문에 `ip` 칸이 없다.** 최종 사용자 IP 는 `X-Forwarded-For` 헤더로 전달한다 (1절 공통 헤더). 갱신도 세션 기록을 갱신하므로, 로그인만 고치고 여기를 빼먹으면 15분마다 그 자리가 앱 서버 주소로 덮인다

### `POST /auth/logout`

```json
{ "refreshToken": "9f2c…" }         // 또는 { "sessionId": "…" }
→ 204
```

- 갱신과 같다. 최종 사용자 IP·UA 는 `X-Forwarded-For` · `User-Agent` 헤더로 전달한다

### `GET /auth/me`

인증: access token

```json
{ "data": { "id": "1042", "email": "…", "name": "…", "roles": [...], "groups": [...],
            "attributes": {}, "lastLoginAt": "2026-08-08T10:12:00+09:00" } }
```

> 이 엔드포인트를 **매 요청 호출하지 않는다.** 토큰 안에 이미 같은 정보가 있다 (설계 불변식 2).

### `GET /.well-known/jwks.json`

인증: 없음. 형식은 [`token.md`](token.md) §4.

---

## 2-1. 계정 라이프사이클 — 비밀번호 찾기 · 이메일 인증 · 초대

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/auth/password/forgot` | 서비스 키 | 재설정 메일 요청 |
| POST | `/auth/password/reset` | 서비스 키 | 토큰으로 재설정 |
| POST | `/auth/password/change` | access token | 현재 비밀번호 확인 후 변경 |
| POST | `/auth/email/verify/request` | 서비스 키 | 인증 메일 재발송 |
| POST | `/auth/email/verify` | 서비스 키 | 토큰 확인 (EMAIL_VERIFY·EMAIL_CHANGE 공용) |
| POST | `/auth/email/change` | access token | 새 주소로 확인 메일 |
| POST | `/auth/invite/accept` | 서비스 키 | 초대 수락 — 비밀번호 설정 |
| POST | `/auth/signup` | 서비스 키 | 자체 가입 (기본 비활성) |
| POST | `/auth/account/delete` | access token | **본인 탈퇴** — 현재 비밀번호 확인 (기본 비활성) |
| GET | `/auth/sessions` | access token | 내 세션 목록 |
| DELETE | `/auth/sessions/{id}` | access token | 세션 하나 해지 |
| DELETE | `/auth/sessions` | access token | 전부 해지 (현재 세션 포함) |
| GET | `/auth/terms` | 서비스 키 | 현재 게시 중인 약관 (§2-4) |
| POST | `/auth/terms/agree` | access token | 동의·거절 기록 |
| GET | `/auth/terms/agreements` | access token | 내 동의 이력 |
| POST | `/auth/magic-link/request` | 서비스 키 | **매직 링크** 발송 요청 (기본 비활성, §2-5) |
| POST | `/auth/magic-link/verify` | 서비스 키 | 링크의 토큰 → 로그인 (§2-5) |

### 요청형 응답은 항상 같다

`forgot` · `verify/request` · `signup` 은 계정이 있든 없든, 비활성이든, 쿨다운에 걸렸든 **똑같이** 답한다.

```json
{ "data": { "accepted": true } }
```

다르게 답하면 그 화면이 **가입자 명부를 조회하는 도구**가 된다. 앱은 이 응답을 받아 "메일을 보냈습니다" 라고 안내하면 되고, 실제로 보냈는지는 앱도 알 필요가 없다.

### 링크는 앱을 가리킨다

메일의 링크는 jar 가 아니라 **앱** 주소다 (설계 불변식 4 — jar 는 외부에 노출되지 않는다).

```
{ixauth.mail.app-base-url}{reset-path}?token=…
예) https://myapp.example.com/reset-password?token=qTci…
```

앱이 그 경로에 화면을 두고, 사용자가 입력한 새 비밀번호를 토큰과 함께 `/auth/password/reset` 로 중계한다.

### 가입 요청 본문

```json
// POST /auth/signup
{ "email": "…", "password": "…", "name": "…",
  "attributes": { "dept": "개발" },                 // 정의가 있으면 검증된다 (§4)
  "agreements": { "service": true, "marketing": false } }  // 약관 코드 → 동의 여부
```

`agreements` 에 **버전을 보내지 않는다.** 서버가 현재 게시본으로 정한다 — 클라이언트가 보낸 버전을 믿으면 옛 버전에 동의한 것으로 기록해 재동의를 회피할 수 있다.

필수 약관이 빠지면 `AUTH_TERMS_REQUIRED`(400)이고 **계정은 만들어지지 않는다.** 만든 뒤에 막으면 동의하지 않은 계정이 남고, 같은 주소로 다시 가입할 수도 없게 된다.

### 토큰 규칙

- **1회용.** 쓰면 즉시 소모되고 재사용은 `AUTH_TOKEN_EXPIRED`
- 새로 발급하면 **같은 용도의 옛 토큰이 모두 무효화**된다. 옛 링크를 살려 두면 가장 오래된 메일 하나만 유출돼도 계정을 빼앗긴다
- DB 에는 SHA-256 해시만 둔다. 평문은 메일로 나간 것뿐이다
- 비밀번호 정책 위반은 토큰을 소모하지 **않는다** — 약하게 적었다고 링크가 죽으면 메일을 다시 받아야 한다. **재사용 이력 위반(`AUTH_PASSWORD_REUSED`)도 마찬가지다** (2026-08-08) — 사용자 입장에서는 둘 다 "다시 적으면 되는 일" 인데 링크만 죽으면 메일을 처음부터 다시 받아야 한다

### 재설정·변경의 부수효과

| 동작 | 세션 | 그 밖에 |
|------|------|--------|
| `password/reset` | **전부 폐기** | 잠금 해제 + 이메일 인증됨으로 표시 |
| `password/change` | 전부 폐기 (`revoke-sessions-on-password-change`) | 변경 알림 메일 |
| `invite/accept` | — | `PENDING` → `ACTIVE`, 이메일 인증됨 |
| `email/verify` (EMAIL_CHANGE) | — | 확인해야 주소가 바뀐다. 그 전까지는 옛 주소 |

재설정을 하는 이유는 대개 계정을 빼앗겼기 때문이다. 세션을 남겨 두면 빼앗은 쪽이 그대로 남는다.

### 내 세션 목록 — 기기 이름을 함께 준다

> 2026-08-08 추가 (`deviceLabel`).

```json
{ "data": { "items": [
  { "id": "3f2a…", "issuedAt": "…", "lastUsedAt": "…", "expiresAt": "…",
    "ip": "203.0.113.7",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …",
    "deviceLabel": "Chrome · Windows",
    "current": true }
] } }
```

이 화면의 목적은 "이 중에 내가 모르는 기기가 있는가" 를 사용자가 판단하는 것이다. **UA 원문을 늘어놓으면 그 판단이 불가능하다.** `deviceLabel` 이 판단용, `userAgent` 는 진단용(표시가 틀렸을 때 대조)이라 둘 다 준다.

- 알아보지 못하면 `"알 수 없는 기기"` 다. **비어 오지 않으며, 파싱 실패로 요청이 실패하지도 않는다** — UA 는 클라이언트가 마음대로 보내는 값이라, 그것 하나 때문에 목록 화면 자체를 못 보면 안 된다
- 저장하지 않고 **읽는 시점에** 만든다. 저장하면 파싱 규칙을 고쳤을 때 옛 행이 옛 이름으로 남아 같은 기기가 두 이름으로 보인다
- 관리자 API(`GET /admin/users/{id}/sessions`)도 같은 표기를 쓴다

### 새 기기 로그인 알림

> 2026-08-08 추가. `ixauth.account.notify-new-device` (기본 `true`).

그 사용자의 **이전 세션에 없던 (IP, User-Agent) 조합**으로 로그인하면 본인에게 메일이 나간다 (시각·기기·IP + "본인이 아니라면" 안내). 계정을 빼앗겼다는 사실을 사용자가 스스로 알아챌 통로가 사실상 이것뿐이다.

- **첫 로그인에는 보내지 않는다** — 가입 직후 전원에게 가면 알림이 아니라 소음이고, 그러면 이 메일 전체가 읽히지 않게 된다
- **토큰 갱신은 로그인이 아니다.** 갱신마다 판정하면 이동 중인 휴대폰이 IP 를 바꿀 때마다 메일이 나간다
- 메일에 링크를 넣지 않는다. "본인이 아니면 여기를 누르세요" 는 그대로 피싱 메일의 생김새다
- 감사 로그 `NEW_DEVICE_LOGIN`

### 동시 로그인 상한

> 2026-08-08 추가. `ixauth.account.max-concurrent-sessions` (기본 `0` = 제한 없음).

상한을 넘기면 **가장 오래된 세션부터** 폐기한다 (감사 로그 `SESSION_EVICTED`). 방금 로그인한 세션은 상한이 `1` 이어도 살아남는다 — 끊으면 로그인에 성공하고도 곧바로 못 쓰는 토큰을 받는다.

최근 것이 아니라 오래된 것을 끊는 이유: 최근 것을 끊으면 방금 로그인한 사람이 그 자리에서 튕겨 원인을 짐작할 수도 없다.

### 본인 탈퇴

> 2026-08-08 추가. `ixauth.account.self-delete-mode` (기본 `DISABLED`).

```json
// POST /auth/account/delete   { "currentPassword": "…" }
{ "data": { "mode": "GRACE", "effectiveAt": "2026-08-15T11:20:00Z" } }
```

- **현재 비밀번호를 확인한다** — 자리를 비운 사이 남이 계정을 닫아 버리는 것을 막는다. 틀리면 `AUTH_INVALID_CREDENTIALS`(401)
- 꺼져 있으면 `AUTH_SELF_DELETE_DISABLED`(403). 앱은 이 코드를 보고 탈퇴 화면을 감춘다
- 소셜로만 쓰는 계정(비밀번호 없음)은 확인 수단이 없어 여기서 막힌다 — 관리자를 거친다
- **계정을 지우지 않는다.** `status=DISABLED` + 요청 시각 기록. 모드별 동작과 그 근거는 [`config.md`](config.md) §5-2
- 어느 모드든 **모든 세션을 폐기**하고 확인 메일을 보낸다
- `GRACE` 는 유예 안에 **로그인 한 번**으로 취소된다 (감사 로그 `SELF_DELETE_CANCELED`)

### 초대 vs 관리자 비밀번호 지정

`POST /admin/users` 에 `password` 를 **비우면 초대 방식**이다 — 계정은 `PENDING` 으로 만들어지고 초대 메일이 나간다. `POST /admin/users/{id}/invite` 로 다시 보낼 수 있다.

`/admin/users/{id}/password-reset` 은 관리자가 비밀번호를 정해 **따로 알려 줘야** 하고, 그 전달 경로(메신저·구두)가 대개 가장 약한 고리다. 초대 쪽을 권장한다.

---

## 2-2. 소셜 로그인 — Microsoft · 카카오 · 네이버 · Google

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/auth/social/providers` | 서비스 키 | 켜져 있는 provider 목록 |
| GET | `/auth/social/{provider}/authorize-url?redirectUri=` | 서비스 키 | 동의 화면 주소 |
| POST | `/auth/social/{provider}/callback` | 서비스 키 | `code` 중계 → 로그인 |
| POST | `/auth/social/{provider}/link` | access token | 내 계정에 연결 |
| GET | `/auth/social/links` | access token | 연결된 계정 목록 |
| DELETE | `/auth/social/{provider}/link` | access token | 연결 해제 |

### 콜백은 앱이 받는다

IX-Auth 는 외부에 노출되지 않으므로(설계 불변식 4) provider 가 브라우저를 IX-Auth 로 돌려보낼 수 없다. **콜백 주소는 앱 도메인에 둔다.**

```
① 앱  → IX-Auth   GET /auth/social/kakao/authorize-url?redirectUri=https://myapp/oauth/kakao
② 앱  → 브라우저   그 url 로 리다이렉트
③ 사용자 → 카카오   동의
④ 카카오 → 앱      https://myapp/oauth/kakao?code=...&state=...
⑤ 앱  → IX-Auth   POST /auth/social/kakao/callback { code, state }
⑥ IX-Auth         토큰 교환 · 프로필 조회 · 계정 매칭 · 세션 발급
⑦ 앱              받은 토큰을 HttpOnly 쿠키로 심는다
```

`redirectUri` 는 provider 콘솔에 등록된 값과 같아야 하고, ⑤의 토큰 교환에서도 **같은 값**이 쓰인다 — IX-Auth 가 ①에서 저장해 두므로 앱이 다시 보낼 필요는 없다.

### 계정 매칭 — 이 기능의 보안 급소

판정 순서는 이렇다.

| 순서 | 조건 | 결과 |
|------|------|------|
| ① | `(provider, subject)` 로 이미 연결됨 | 그 사용자로 로그인. **이메일이 바뀌었어도 상관없다** |
| ② | 같은 이메일의 계정이 있고 **provider 가 검증했다고 명시** | 자동 연결 (`auto-link-verified-email`) |
| ③ | 처음 보는 사용자 | `auto-signup` 이 켜져 있고 이메일이 있을 때만 생성 |
| ④ | 그 외 | `AUTH_SOCIAL_NO_ACCOUNT` |

**②의 조건이 핵심이다.** provider 가 "검증했다" 고 명시하지 않았는데 이메일만 보고 붙이면, 남의 주소를 자기 소셜 계정에 적어 넣는 것만으로 그 계정을 가져갈 수 있다.

| provider | 이메일 검증 신호 | 자동 연결 |
|----------|-----------------|----------|
| **Google** | `email_verified` — **OIDC 표준 클레임이다** (2026-08-08 추가) | 가능 |
| Microsoft | Graph `/me` 는 주지 않는다. **테넌트를 조직 ID 로 고정한 경우에만** 신뢰 (`common`·`consumers` 는 불가) | 조건부 |
| 카카오 | `is_email_verified` + `is_email_valid` | 가능 |
| 네이버 | **주지 않는다** | **불가** — 수동 연결만 |

네이버 사용자를 기존 계정에 붙이려면 로그인한 상태에서 `POST /auth/social/naver/link` 를 쓴다. 본인 확인이 이미 끝났으므로 이메일 신호에 기댈 필요가 없다 — **가장 안전한 경로다.**

> **Google 은 신호를 믿을 수 있지만 범위 제한 수단이 없다.** Microsoft 의 테넌트에 해당하는 것이 없어서, 켜면 **Google 계정을 가진 누구나** 동의 화면을 통과한다. 사내 시스템이라면 `social.auto-signup` 을 끄고 초대받은 계정에만 붙게 하거나 `account.signup-allowed-domains` 로 도메인을 건다. provider 의 `hd` 파라미터는 힌트일 뿐 강제가 아니므로 그것에 기대지 않는다.

### state 와 PKCE

`state` 는 1회용이고 **DB 에 해시로만** 저장된다. 콜백에서 소비 후 즉시 삭제하므로 재생 공격이 되지 않는다. **Microsoft·Google 은 PKCE(S256)를 함께 쓴다.**

state 는 앱 DB 에 둔다 — 인메모리면 인스턴스가 여러 대일 때 콜백이 다른 인스턴스로 들어와 실패한다. 전용 Redis 를 두지 않는 것이 불변식 3 이다.

---

## 2-3. 2단계 인증 (TOTP) — `/auth/mfa/*`

> 2026-08-08 추가. 스키마는 V1 에 있었고 구현이 없었다 (V6 에서 컬럼 정정).

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/auth/mfa/totp/setup` | access token | 등록 시작 — otpauth URI + 백업 코드 |
| POST | `/auth/mfa/totp/confirm` | access token | 코드 확인 → 활성화 |
| DELETE | `/auth/mfa/totp` | access token | 해제 (현재 비밀번호 확인) |
| GET | `/auth/mfa/status` | access token | 활성 여부·남은 백업 코드 수 |
| POST | `/auth/mfa/verify` | 서비스 키 | 로그인 2/2 — challenge + 코드 → 토큰 |

### 등록은 2단계다 — 등록과 활성화를 분리한다

```json
// ① POST /auth/mfa/totp/setup   (본문 없음)
{ "data": {
  "otpauthUri": "otpauth://totp/IX-Auth:chris%40prost.team?secret=JBSW…&issuer=IX-Auth&algorithm=SHA1&digits=6&period=30",
  "backupCodes": ["4KQ2M-9XTVB", "…"]     // 10개
} }

// ② POST /auth/mfa/totp/confirm  { "code": "492013" }
{ "data": { "enabled": true, "type": "TOTP", "backupCodesRemaining": 10,
            "pendingConfirm": false, "mode": "OPTIONAL", "setupRequired": false } }
```

- **`confirm` 전에는 로그인에 아무 영향이 없다.** 이 분리가 없으면 QR 을 잘못 스캔한 사람이 그 순간부터 자기 계정에서 잠긴다
- **QR 이미지는 만들지 않는다.** `otpauthUri` 문자열만 주고 그림은 앱이 그린다 (설계 불변식 1)
- **`backupCodes` 평문은 이 응답에서만 볼 수 있다.** DB 에는 SHA-256 해시만 남으므로 다시 조회할 방법이 없다. 앱은 사용자가 저장했는지 확인하고 다음으로 넘어가야 한다
- `confirm` 은 **백업 코드를 받지 않는다** — 확인의 목적은 "인증 앱이 이 시크릿으로 코드를 만든다" 를 증명하는 것이다
- 이미 켜진 상태에서 `setup` 을 다시 부르면 `CONFLICT`(409). 조용히 갈아 끼우면 토큰을 훔친 쪽이 자기 앱으로 바꿔 주인을 밀어낼 수 있다

### 로그인은 2단계로 갈라진다

```json
// ① POST /auth/login  → 401
{ "error": { "code": "AUTH_MFA_REQUIRED", "message": "2단계 인증이 필요합니다.",
             "traceId": "0f4c…",
             "meta": { "challenge": "qTci9f…", "expiresIn": 300 } } }

// ② POST /auth/mfa/verify  { "challenge": "qTci9f…", "code": "492013" }
//    → /auth/login 200 과 같은 모양 (accessToken · refreshToken · user)
```

- `code` 자리에는 인증 앱의 6자리와 **백업 코드**가 모두 온다. 필드를 나누면 앱이 "지금 무엇을 입력받는지" 를 미리 알아야 하는데, 사용자는 휴대폰이 없을 때 비로소 백업 코드를 꺼낸다
- **challenge 는 짧고(기본 5분) 1회용이며 DB 에 해시로만** 있다 (`verification_tokens.purpose = MFA_CHALLENGE`). 새로 로그인하면 앞선 challenge 는 무효가 된다
- **틀린 코드는 challenge 를 소모하지 않는다.** 오타 한 번에 로그인부터 다시 하게 만들면 사용자는 2단계를 끄고 싶어진다. 대신 실패가 **계정 잠금 카운터에 올라가고**, `/auth/mfa/verify` 는 `/auth/login` 과 **같은 rate limit 버킷**을 쓴다
- 시계 오차는 앞뒤 1스텝(±30초)까지 받는다. **같은 스텝의 코드는 두 번 통하지 않는다** — 마지막으로 성공한 스텝을 저장해 두고 그보다 크지 않으면 거부한다

### 필수로 바꿔도 기존 사용자를 잠그지 않는다

`mfa.mode` 를 `REQUIRED_ADMIN` · `REQUIRED_ALL` 로 바꿔도, **아직 등록하지 않은 사람의 로그인은 그대로 성공한다.** 대신 응답에 `mfaSetupRequired: true` 가 실린다.

> 막지 않는 이유는 하나다 — 막으면 설정을 바꾼 순간 **전원이 잠긴다.** 그리고 앱은 토큰을 로컬 검증하므로(설계 불변식 2) jar 가 "제한된 토큰" 을 발급해 봐야 그 제한을 강제할 주체는 결국 앱이다. 그래서 신호를 주고 앱이 등록 화면으로 보내게 한다.

`GET /auth/mfa/status` 로 같은 판단을 언제든 다시 물을 수 있다.

```json
{ "data": { "enabled": false, "type": "TOTP", "backupCodesRemaining": 0,
            "pendingConfirm": false, "mode": "REQUIRED_ALL", "setupRequired": true } }
```

### 경계 — 지금 하지 않는 것

| 항목 | 현재 |
|------|------|
| **소셜 로그인** | 2단계를 요구하지 **않는다.** provider 가 이미 본인확인(대개 자체 2단계 포함)을 마친 경로이고, 여기서 막으면 소셜로만 쓰던 사용자가 들어올 방법이 없어진다 |
| **매직 링크** | **요구한다** (2026-08-08 추가). 소셜과 갈린 이유는 §2-5 |
| **관리자의 타인 2단계 초기화** | **있다** (2026-08-08 추가) — `POST /admin/users/{id}/mfa-reset`. 아래 §4 |
| **민감 작업 재인증(step-up)** | **있다** (2026-08-08 추가) — `mfa.step-up-actions`. 아래 §2-6 |
| SMS·WebAuthn | 제품 경계 밖 (`rules/product-boundary.md`) |

---

## 2-4. 약관 동의 — `/auth/terms*`

> 2026-08-08 추가. `ixauth.terms.enabled` (기본 `false`).

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/auth/terms` | 서비스 키 | 코드마다 최신 **게시본** 하나씩 |
| POST | `/auth/terms/agree` | access token | 동의·거절 기록 |
| GET | `/auth/terms/agreements` | access token | 내 동의 이력 |

### 목록은 로그인 전에 보여야 한다

```json
// GET /auth/terms
{ "data": { "items": [
  { "code": "service", "version": 3, "title": "이용약관",
    "body": "제1조 …", "bodyUrl": null, "required": true, "displayOrder": 0 },
  { "code": "marketing", "version": 1, "title": "마케팅 정보 수신",
    "body": null, "bodyUrl": "https://myapp/terms/marketing", "required": false, "displayOrder": 9 }
] } }
```

**access token 을 요구하지 않는다.** 가입 화면은 로그인 전에 뜨므로, 토큰을 요구하면 가입하려는 사람이 약관을 읽을 수 없다. 게시된 약관은 어차피 공개 문서라 감출 것이 없다.

- **초안(미게시)은 나오지 않는다.** 관리자가 문안을 다듬는 동안 반쯤 쓴 약관이 가입 화면에 뜨면 안 된다
- `body` 와 `bodyUrl` 중 하나는 채워져 온다. 앱은 본문이 있으면 그리고, 없으면 주소를 연다
- 기능이 꺼져 있으면 **빈 배열**이다. 앱은 "약관 기능이 켜졌는가" 를 따로 물을 필요 없이 목록이 비면 동의 단계를 건너뛰면 된다

### 동의

```json
// POST /auth/terms/agree   { "agreements": { "service": true, "marketing": false } }
{ "data": { "recorded": 2, "pending": [] } }
```

- `pending` 은 **이 요청 뒤에도 남은 필수 코드**다. 비어야 앱이 동의 화면을 닫는다 — 다음 로그인까지 기다리게 하면 화면이 어긋난다
- 필수 약관에 `false` 를 보내면 `AUTH_TERMS_REQUIRED`(400)
- **게시되지 않은 코드는 조용히 버려진다** (`recorded` 가 보낸 개수보다 작을 수 있다). 400 으로 막으면 앱이 옛 코드를 하나 남겨 둔 것만으로 동의 전체가 실패한다
- 선택 약관의 **거절도 기록된다.** 마케팅 수신 거부는 지켜야 할 의사 표시다

### 이력은 지우지도 고치지도 않는다

```json
// GET /auth/terms/agreements
{ "data": { "items": [
  { "code": "service", "version": 3, "agreed": true,  "agreedAt": "2026-08-08T11:20:00Z" },
  { "code": "service", "version": 2, "agreed": true,  "agreedAt": "2026-03-02T09:10:00Z" },
  { "code": "marketing", "version": 1, "agreed": false, "agreedAt": "2026-03-02T09:10:00Z" }
] } }
```

철회는 덮어쓰기가 아니라 **`agreed: false` 인 새 행**이다. 덮어쓰면 "언제부터 언제까지 동의 상태였는가" 가 사라지는데, 증빙에서 필요한 것이 바로 그 구간이다. 동의 시각과 함께 **IP · User-Agent · 약관 버전**을 남긴다(관리 API 에서 조회).

### 재동의는 로그인을 막지 않는다

필수 약관이 새 버전으로 게시되면 로그인 응답에 `termsAgreementRequired: ["service"]` 가 실린다. **로그인 자체는 성공한다.**

> 막지 않는 이유는 `mfaSetupRequired` 와 같다 (§2-3) — 막으면 새 버전을 게시하는 순간 **전원이 못 들어온다.** 앱이 그 신호를 받아 동의 화면으로 보내야 실제로 강제된다.

2단계 인증과 **다른 점**: 이 신호는 **소셜 로그인에도 나간다.** 2단계는 provider 가 본인확인을 대신했다고 볼 수 있지만, 약관은 우리와 사용자 사이의 합의라 provider 가 대신 받아 줄 수 있는 것이 아니다.

`ixauth.terms.reagreement-required` 를 끄면 한 번 동의한 사람은 개정돼도 다시 묻지 않는다 (근거와 대가는 [`config.md`](config.md) §5-5).

---

## 2-5. 매직 링크 로그인 — `/auth/magic-link/*`

> 2026-08-08 추가. `ixauth.account.magic-link-enabled` (기본 `false`).

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/auth/magic-link/request` | 서비스 키 | 로그인 링크 발송 요청 |
| POST | `/auth/magic-link/verify` | 서비스 키 | 링크의 토큰 → 로그인 토큰 |

### 요청은 계정 존재를 알려 주지 않는다

```json
// POST /auth/magic-link/request   { "email": "chris@prost.team", "captchaToken": "…" }
{ "data": { "accepted": true } }
```

계정이 없어도, 비활성이어도, 쿨다운에 걸려도 **똑같이** 답한다. 비밀번호 찾기와 같은 규칙이다 — 다르게 답하면 그 화면이 가입자 명부를 조회하는 도구가 된다.

- 기능이 꺼져 있으면 `AUTHZ_FORBIDDEN`(403). **이건 계정과 무관한 전역 스위치**라 알려 줘도 새는 것이 없고, 앱은 이 코드를 보고 "메일로 로그인" 버튼을 감춘다
- 재발송 간격은 `account.resend-cooldown` 을 그대로 쓴다. 없으면 남의 주소로 "로그인 링크" 메일을 무한히 보낼 수 있다
- 속도 제한은 `/auth/password/forgot` 과 **같은 `mail` 버킷**이다 (§6)
- `captchaToken` 은 `captcha.protect` 에 `PASSWORD_FORGOT` 이 있을 때만 본다 — 이 경로는 비밀번호 찾기와 성격이 같은 "메일을 유발하는 익명 요청" 이라 같은 스위치를 쓴다

### 확인은 로그인과 같은 응답이다

```json
// POST /auth/magic-link/verify   { "token": "qTci9f…", "userAgent": "…", "ip": "203.0.113.7" }
// → /auth/login 200 과 같은 모양 (accessToken · refreshToken · user · mfaSetupRequired · termsAgreementRequired)
```

- **1회용이고 수명이 짧다** (기본 10분, `account.magic-link-token-ttl`). 재설정 링크(30분)보다 짧은 이유는 이것이 **그 자체로 로그인**이기 때문이다 — 재설정 링크는 손에 넣어도 새 비밀번호를 정해야 하고 그 순간 본인에게 알림이 나가지만, 이쪽은 흔적 없이 들어온다
- 새로 요청하면 **앞선 링크가 모두 무효**가 된다. 옛 링크를 살려 두면 메일함에 쌓인 것 중 하나만 새어도 계정을 빼앗긴다
- 다른 용도의 토큰(재설정·초대)은 여기서 통하지 않는다. 통하게 두면 **가장 수명이 긴 링크가 로그인 수단**이 된다
- 메일을 받아 눌렀다는 것 자체가 주소 확인이므로 **미인증 계정은 이 시점에 인증된 것으로 표시**된다 (초대 수락·비밀번호 재설정과 같은 판단)
- 감사 로그 `MAGIC_LINK_REQUESTED` · `MAGIC_LINK_CONSUMED`

### ⚠ 2단계를 우회하지 않는다 — 소셜 로그인과 갈리는 지점

**2단계가 켜진 계정은 매직 링크로도 코드를 한 번 더 받는다.**

```json
// POST /auth/magic-link/verify  → 401
{ "error": { "code": "AUTH_MFA_REQUIRED", "meta": { "challenge": "…", "expiresIn": 300 } } }
// → 그다음은 /auth/mfa/verify 로 §2-3 과 완전히 같다
```

소셜 로그인은 2단계를 요구하지 않는데(§2-3) 여기서는 요구하는 이유:

| | 소셜 | 매직 링크 |
|---|------|----------|
| 무엇이 본인을 확인했나 | **provider** — 대개 자체 2단계를 포함한 로그인 | **메일함 접근** 하나뿐 |
| 요구하지 않으면 | 다른 곳에서 한 2단계를 인정하는 셈 | **우리 2단계가 메일 한 통으로 무력화** |

즉 소셜은 "2단계를 다른 곳에서 했다" 이고, 매직 링크는 "2단계를 아무도 하지 않았다" 이다. 같은 취급을 할 수 없다.

- 토큰은 challenge 를 발급하는 시점에 **이미 소비된다.** 코드를 틀려도 같은 링크를 다시 쓸 수 없지만, challenge 는 소모되지 않으므로 코드는 다시 넣을 수 있다
- 상태 검사는 확인 시점에 다시 한다 — 발급과 사용 사이가 짧아도 창은 창이다. **잠긴 계정은 통과시킨다**: 잠금은 비밀번호 무차별 대입을 막는 장치인데 이 경로는 비밀번호를 쓰지 않고, 막으면 비밀번호를 잊어 잠긴 사람이 메일로도 못 들어온다

### 앱이 할 일

```
① 앱  → IX-Auth   POST /auth/magic-link/request { email }
② IX-Auth → 사용자  메일 — {mail.app-base-url}{mail.magic-link-path}?token=…
③ 사용자 → 앱      그 화면을 연다
④ 앱  → IX-Auth   POST /auth/magic-link/verify { token }
⑤ 앱              받은 토큰을 HttpOnly 쿠키로 심는다 (2단계면 §2-3 을 한 번 거친다)
```

메일 링크는 **앱**을 가리킨다 (설계 불변식 4). 경로는 `ixauth.mail.magic-link-path` (기본 `/magic-link`).

---

## 2-6. CAPTCHA · step-up 재인증

> 2026-08-08 추가. 둘 다 기본이 꺼져 있고, **켜기 전에 앱을 먼저 고쳐야 한다.**

### CAPTCHA — `captchaToken`

`ixauth.captcha.enabled` (기본 `false`) · `ixauth.captcha.protect` (기본 `SIGNUP, PASSWORD_FORGOT`).

| 걸리는 경로 | `protect` 값 |
|------------|-------------|
| `POST /auth/signup` | `SIGNUP` |
| `POST /auth/login` | `LOGIN` |
| `POST /auth/password/forgot` · `POST /auth/magic-link/request` | `PASSWORD_FORGOT` |

토큰은 **요청 본문의 `captchaToken`** 으로 받는다. 헤더가 아니라 본문인 이유 — 이 값은 그 요청의 일부이지 인증 수단이 아니고, 본문에 두면 앱이 SDK 응답을 그대로 실어 보낼 수 있다.

```json
{ "email": "…", "password": "…", "captchaToken": "03AGdBq2…" }
```

**속도 제한(§6)과 무엇이 다른가.** 속도 제한은 한 IP 의 속도를 누른다. 그런데 봇넷은 수천 IP 가 하나씩 던지므로 어느 IP 도 한도를 넘지 않은 채 전부 통과한다. 계정 잠금도 계정당이라 password spraying 을 막지 못한다. CAPTCHA 는 그 빈틈을 메운다 — **대체가 아니라 보완이다.**

#### 실패는 거부, 미도달은 통과

| 상황 | 결과 | 왜 |
|------|------|-----|
| `captchaToken` 이 없다 | `AUTH_CAPTCHA_REQUIRED`(400) | 앱의 실수다. 없다고 통과시키면 공격자도 빼고 보내면 그만이다 |
| provider 가 "봇" 이라고 답했다 | `AUTH_CAPTCHA_FAILED`(403) | 정상적으로 나온 판정이다. 통과시키면 이 기능이 있으나 마나다 |
| provider 에 닿지 못했다 (타임아웃·키 미설정) | **통과** + WARN 로그 | 물어보지 못했을 뿐 봇이라는 증거가 없다. 여기서 막으면 **Google 장애가 우리 가입 장애**가 된다 |

유출 비밀번호 검사(`password.check-breached`)와 같은 판단이다 — 외부 조회에 기대는 **보조 검사**는 못 물어봤을 때 통과시킨다.

- 실패 사유를 응답에 담지 않는다. 점수를 알려 주면 넘길 때까지 조정하는 데 쓰인다
- **관리 화면 로그인(`/admin-ui/api/login`)에는 걸리지 않는다.** 그 화면은 우리가 만든 정적 페이지라 site key 를 심는 것이 별도 작업이고, 애초에 외부에 노출하지 않는 것이 전제다
- 시크릿(`captcha.secret-key`)은 **환경변수로만** 받는다 — 관리 화면에 없다

### step-up 재인증 — `mfaCode`

`ixauth.mfa.step-up-actions` (기본 **비어 있음** = 요구하지 않음).

| 작업 | 경로 | `step-up-actions` 값 |
|------|------|---------------------|
| 비밀번호 변경 | `POST /auth/password/change` | `PASSWORD_CHANGE` |
| 이메일 변경 | `POST /auth/email/change` | `EMAIL_CHANGE` |
| 본인 탈퇴 | `POST /auth/account/delete` | `ACCOUNT_DELETE` |
| 2단계 해제 | `DELETE /auth/mfa/totp` | `MFA_DISABLE` |

이 넷은 이미 **현재 비밀번호**를 요구한다. 그런데 비밀번호는 한 번 새면 계속 새어 있는 값이라 "이 사람이 비밀번호를 안다" 만 증명하고 **"지금 이 사람이 계정 주인이다" 는 증명하지 못한다.** 30초마다 바뀌는 TOTP 코드는 그 질문에 답한다.

```json
// POST /auth/email/change  { "newEmail": "…", "currentPassword": "…", "mfaCode": "492013" }

// 필요한데 없으면 → 401
{ "error": { "code": "AUTH_MFA_REQUIRED", "message": "이 작업에는 2단계 인증 코드가 필요합니다.",
             "meta": { "stepUp": "EMAIL_CHANGE" } } }
```

- **`meta.challenge` 가 없다.** 로그인 2단계와 같은 코드를 쓰지만, 앱은 이 차이로 둘을 구분한다 — 여기서는 코드를 입력받아 **같은 요청을 다시** 보내면 되고 로그인 화면으로 갈 이유가 없다
- `mfaCode` 자리에는 인증 앱의 6자리와 **백업 코드**가 모두 온다. 휴대폰이 없을 때 민감 작업이 영영 막히면 안 된다
- **재사용 차단이 그대로 적용된다** — 로그인 2단계와 같은 검증 경로를 지나므로 같은 스텝의 코드는 두 번 통하지 않고 백업 코드는 쓰면 사라진다
- **2단계를 켜지 않은 계정에는 적용되지 않는다.** 요구할 코드 자체가 없고, 막으면 그 사람은 비밀번호조차 바꿀 수 없게 된다. 전원에게 강제하려면 `mfa.mode = REQUIRED_ALL` 이 그 수단이다
- 실패는 계정 잠금 카운터에 올라간다. 감사 로그 `MFA_VERIFIED` / `MFA_FAILED` 의 `detail.phase = STEP_UP`
- **유효 시간(grace)을 두지 않는다.** "5분 안에는 다시 묻지 않는다" 를 만들면 그 사이에 이메일 변경이 코드 없이 통과한다

⚠ **켜는 순서가 있다.** 앱이 그 화면에서 `mfaCode` 를 받아 보내도록 먼저 고치고, 그다음 설정을 켠다. 반대로 하면 2단계를 켠 사용자의 그 화면들이 전부 실패한다.

---

## 2-7. 연합 신원 교환 — `POST /auth/federated/exchange`

> 2026-08-27 추가. 설정은 [`config.md`](config.md) §5-8, 스키마는 [`schema.sql`](schema.sql), 토큰은 [`token.md`](token.md) §3.

앱이 **이미 검증한** 외부 신원을 제출하면 IX-Auth 가 그 사람을 계정에 잇고 세션을 발급한다.

**IX-Auth 가 OIDC IdP 가 되는 것이 아니다.** jar 는 외부 provider 와 직접 토큰을 교환하지 않고 브라우저를 받지도 않는다(설계 불변식 1·4). 신원 확인은 앱이 끝내고, jar 는 그 결과를 계정에 잇는 일만 한다.

```
① 앱  → 외부 IdP    사용자를 보내 신원을 확인한다 (여기까지 jar 는 관여하지 않는다)
② 앱  → IX-Auth     POST /auth/federated/exchange  { provider, subject, email, name }
③ IX-Auth           연결 조회 → 이메일 연결 → JIT 생성 → 상태 게이트 → 세션 발급
④ 앱                받은 토큰을 HttpOnly 쿠키로 심는다
```

인증: **서비스 키** (`X-IxAuth-Key`). 다른 서버 간 API 와 같다.

```json
// 요청
{ "provider": "nexus-hub", "subject": "8f31c2a0-…", "email": "chris@prost.team",
  "name": "이대훈", "userAgent": "Mozilla/5.0 …", "ip": "203.0.113.7" }

// 200 — POST /auth/login 과 같은 봉투다
{ "data": {
  "accessToken": "eyJ…", "refreshToken": "9f2c…", "expiresIn": 900,
  "user": { "id": "1042", "email": "chris@prost.team", "name": "이대훈",
            "roles": ["USER"], "groups": [] },
  "mfaSetupRequired": false, "termsAgreementRequired": []
} }
```

- `subject` 는 외부 IdP 의 **불변 식별자**다. 이메일이 아니다 — 이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다. 매칭은 `(provider, subject)` 로만 한다
- `provider` 는 `ixauth.federation.allowed-providers` 에 적힌 이름과 대조한다. **대소문자를 가리지 않고**, 저장은 소문자로 정규화한다
- `userAgent` / `ip` 는 `/auth/login` 과 **같은 규약**이다. 앱이 최종 사용자의 것을 실어 보낸다 — 뽑는 법은 §2 와 [`../guides/client-ip.md`](../guides/client-ip.md). 본문에 실을 자리가 있으므로 헤더 폴백에 기대지 않는다
- 응답이 로그인과 같은 봉투인 이유 — 앱이 로그인 응답을 다루던 코드를 그대로 쓸 수 있어야 한다. 어느 IdP 로 들어왔는지는 토큰의 `ixauth_idp` 클레임이 답한다

### 계정 매칭 — 이 기능의 보안 급소

| 순서 | 조건 | 결과 |
|------|------|------|
| ① | `(provider, subject)` 로 이미 연결됨 | 그 사용자. **이메일이 바뀌었어도 상관없다** |
| ② | 이메일이 오지 않았다 | `AUTH_FEDERATION_NO_ACCOUNT` (404) |
| ③ | 같은 이메일의 계정이 있음 | `link-by-email` 이면 연결, 아니면 `AUTH_FEDERATION_LINK_DENIED` (409) |
| ④ | 처음 보는 사람 | `auto-provision` 이면 JIT 생성, 아니면 `AUTH_FEDERATION_NO_ACCOUNT` (404) |

- **③에서 거절할 때 새 계정을 만들지 않는다.** 만들면 같은 주소의 계정이 둘이 되고, 그다음부터 "이 사람" 이 누구인지 아무도 답할 수 없다
- 소셜 로그인(§2-2)과 달리 **provider 의 이메일 검증 신호를 보지 않는다.** 여기서는 앱이 이미 신원을 확인했다는 것이 전제이고, 그 전제를 못 믿으면 이 기능 자체를 켜면 안 된다. 판단은 `link-by-email` 로 운영자에게 넘긴다
- JIT 생성 계정은 **비밀번호 없음 · 이메일 인증됨 · 역할 `USER` · 상태 `ACTIVE`** 다. 로그인은 이 IdP 로만 되고, 나중에 '비밀번호 찾기' 로 스스로 비밀번호를 만들 수 있다

### 계정 상태 게이트는 비밀번호 로그인과 같다

§2-1-1 의 표가 **그대로** 적용된다 — `LOCKED`(423) · `DISABLED`(403) · `PENDING`(403) · `PENDING_APPROVAL`(403). 소셜 로그인처럼 `PENDING` 을 초대 수락으로 보지 **않는다**: 외부 IdP 가 확인해 준 것은 "이 사람이 누구인가" 이지 "우리 초대를 받아들였는가" 가 아니다.

여기를 열어 두면 관리자가 건 차단이 **"넥서스허브로 로그인" 한 번으로 우회된다.**

### 2단계 인증을 건너뛴다

외부 IdP 가 이미 본인확인(대개 자체 2단계 포함)을 마친 경로이고, 여기서 다시 막으면 그 IdP 로만 쓰던 사용자가 들어올 방법이 없어진다. **소셜 로그인과 같은 경계이며, 매직 링크(§2-5)와 갈리는 지점이다** — 매직 링크는 우리가 보낸 메일 한 통이 유일한 근거라 2단계를 그대로 요구한다.

약관 재동의 신호(`termsAgreementRequired`)는 **그대로 실린다.** 약관은 우리와 사용자 사이의 합의라 외부 IdP 가 대신 받아 줄 수 있는 것이 아니다.

### 감사 로그

| 이벤트 | 언제 |
|--------|------|
| `FEDERATED_LOGIN` | 교환이 성공할 때마다. `detail.provider` 에 어느 IdP 인지 |
| `FEDERATED_LINK` | 외부 신원을 이메일이 같은 **기존 계정에 연결**했다 — 계정 인수가 일어나는 지점이다 |
| `FEDERATED_PROVISION` | 계정을 새로 만들었다(JIT) — 비밀번호 없는 계정이 하나 늘어난 사건이다 |

`LOGIN_SUCCESS` 와 따로 두는 이유 — 이 경로는 비밀번호도 2단계도 거치지 않는다. 같은 이름으로 묶으면 "이 계정으로 누가 어떻게 들어왔나" 를 되짚을 때 자체 인증과 구분되지 않는다.

### 에러

| 상태 | code | 언제 |
|------|------|------|
| 401 | `SERVICE_KEY_MISSING` · `SERVICE_KEY_INVALID` | 서비스 키가 없거나 틀리다 |
| 400 | `VALIDATION_FAILED` | `provider`·`subject` 가 비었거나 `email` 형식이 아니다 |
| 403 | `AUTH_FEDERATION_DISABLED` | `federation.enabled=false` |
| 403 | `AUTH_FEDERATION_PROVIDER_NOT_ALLOWED` | 허용 목록에 없는 provider |
| 409 | `AUTH_FEDERATION_LINK_DENIED` | 같은 이메일의 계정이 있는데 `link-by-email=false` |
| 404 | `AUTH_FEDERATION_NO_ACCOUNT` | 연결된 계정이 없고 자동 생성도 하지 않는다(또는 이메일 미제공) |
| 423 · 403 | `AUTH_ACCOUNT_LOCKED` · `AUTH_ACCOUNT_DISABLED` · `AUTH_ACCOUNT_PENDING` · `AUTH_ACCOUNT_PENDING_APPROVAL` | §2-1-1 의 상태 게이트 |

---

## 3. 인가 — `/authz/*`

상세는 [`authz.md`](authz.md) §6.

| 메서드 | 경로 | 인증 | Phase |
|--------|------|------|-------|
| GET | `/authz/permission-map` | 서비스 키 | P1 |
| GET | `/authz/my-permissions` | access token | P1 |
| POST | `/authz/check` | 서비스 키 | P2 |
| POST | `/authz/batch-check` | 서비스 키 | P2 |
| GET | `/authz/list-resources` | 서비스 키 | P2 |

---

## 4. 관리 — `/admin/*`

인증: access token + `ixauth:*` 권한. 내장 관리 화면(`/admin-ui`)도 같은 API 를 쓴다.

### 사용자

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/users?q=&status=&role=&page=&size=` | `ixauth:users:read` |
| POST | `/admin/users` | `ixauth:users:write` |
| GET · PATCH · DELETE | `/admin/users/{id}` | read / write / write |
| POST | `/admin/users/{id}/password-reset` | `ixauth:users:write` |
| POST | `/admin/users/{id}/unlock` | `ixauth:users:write` |
| POST | `/admin/users/{id}/mfa-reset` | `ixauth:users:write` |
| POST | `/admin/users/bulk` | `ixauth:users:write` |
| GET | `/admin/users/{id}/detail` | `ixauth:users:read` |
| GET · PUT | `/admin/users/{id}/roles` | `ixauth:roles:read` / `write` |
| GET · DELETE | `/admin/users/{id}/sessions` | `ixauth:users:read` / `write` |
| POST | `/admin/users/{id}/impersonate` | `ixauth:impersonation:create` |

`DELETE /admin/users/{id}` 는 **소프트 삭제**(`status=DISABLED`)다. 물리 삭제는 감사 로그의 FK 를 끊으므로 하지 않는다.

**목록 필터** (`GET /admin/users`) — 셋은 AND 로 걸린다.

| 파라미터 | 의미 |
|----------|------|
| `q` | 이메일·이름 부분일치 (대소문자 무시) |
| `status` | `users.status` 정확일치. 계약에 없는 값이면 400 |
| `role` | 역할 코드 정확일치 (2026-08-21 구현). **유효 역할** 기준 — 직접 부여분과 그룹 경유분을 모두 본다 |

`role` 은 응답의 `roles` 배열과 **같은 기준**이다. 화면에 `["TEACHER"]` 로 보이는 사람은
그 역할이 그룹에서 온 것이어도 `?role=TEACHER` 에 반드시 잡힌다 — 보이는 것과 걸리는 것이
다르면 그 목록은 신뢰할 수 없다.

없는 역할 코드를 주면 **빈 목록**(`total: 0`)이다. 400 이 아닌 이유는 역할이 런타임에
지워질 수 있어서다 — 방금까지 있던 코드로 거른 화면이 오류가 되면 안 된다.

`POST`·`PATCH /admin/users` 는 `attributes` 를 받는다. 정의(`/admin/user-attributes`)가 있으면 **타입을 검사하고 정규화**한다 — 정의가 하나도 없으면 아무 검사도 하지 않는다.

### 일괄 등록 — `POST /admin/users/bulk`

> 2026-08-08 추가. 상한 `ixauth.account.bulk-import-max` (기본 `500`).

CSV(`Content-Type: text/csv`) 또는 JSON 으로 받는다. JSON 은 **배열과 객체 둘 다** 받는다 — 스크립트로 만드는 쪽은 배열이 자연스럽고, 옵션을 함께 보내려면 객체여야 한다.

```
POST /admin/users/bulk?invite=true
Content-Type: text/csv;charset=UTF-8

email,name,roles
hong@example.com,홍길동,USER
kim@example.com,김철수,"ADMIN,USER"
```

```json
// 또는  Content-Type: application/json
{ "users": [ { "email": "…", "name": "…", "roles": ["USER"], "attributes": {} } ],
  "invite": true }

// 200
{ "data": { "total": 3, "created": 2, "failed": 1, "invited": 2, "results": [
  { "line": 2, "email": "hong@example.com", "status": "CREATED", "userId": 41, "error": null },
  { "line": 3, "email": "not-an-email",     "status": "FAILED",  "userId": null,
    "error": "이메일 형식이 올바르지 않습니다." }
] } }
```

- **한 줄이 틀려도 전체가 실패하지 않는다.** 행마다 독립된 트랜잭션이고, 성공한 것은 그대로 남는다. 전부 되돌리면 관리자는 고쳐서 통째로 다시 올리게 되고, 그러면 이미 들어간 계정이 중복 오류를 낸다
- `line` 은 **원본 줄 번호**다(머리글을 건너뛰어도 유지). 없으면 300줄을 눈으로 훑게 된다
- **비밀번호를 만들지 않는다.** 수백 명에게 안전하게 전달할 경로가 없다 — 계정은 `PENDING` 이고 초대 링크로 본인이 정한다(기존 초대 흐름 그대로)
- `invite=false` 로 메일을 끌 수 있다. 다만 그 계정은 **아무도 들어올 수 없는 상태**로 남으므로 의식적인 선택이어야 한다
- 초대 메일 실패는 계정 생성을 되돌리지 않는다 — 그 사람만 다시 초대하면 된다
- 상한을 넘으면 `VALIDATION_FAILED`(400)이고 **한 건도 만들지 않는다.** 앞부분만 처리하면 일부만 들어간 것을 알아채기 어렵다
- CSV 의 `roles` 는 따옴표로 감싼 쉼표 외에 `;` · `|` 도 구분자로 받는다 (엑셀에서 따옴표를 넣기가 생각보다 어렵다)

### 약관 — `/admin/terms`

> 2026-08-08 추가. 사용자 쪽 계약은 §2-4.

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/terms` (초안 포함 전량) | `ixauth:users:read` |
| GET | `/admin/terms/{id}` | `ixauth:users:read` |
| POST | `/admin/terms` (새 약관 · 새 버전) | `ixauth:users:write` |
| POST | `/admin/terms/templates` (표준 문안 4건을 **초안**으로) | `ixauth:users:write` |
| PATCH | `/admin/terms/{id}` | `ixauth:users:write` |
| POST | `/admin/terms/{id}/publish` | `ixauth:users:write` |
| DELETE | `/admin/terms/{id}` | `ixauth:users:write` |
| GET | `/admin/terms/{id}/agreements?page=&size=` | `ixauth:users:read` |

- **버전은 서버가 매긴다** (같은 코드의 최대값 + 1). 요청에 넣어도 무시된다 — 관리자가 직접 넣으면 중복·건너뜀이 생기고, 그때 "몇 번에 동의한 것인가" 가 흐려진다
- 만들면 **언제나 초안**이다. `publish` 해야 사용자에게 보인다. **게시 취소는 없다** — 이미 본 사람과 동의한 사람을 없던 일로 할 수 없다. 잘못 게시했다면 고친 새 버전을 낸다
- **게시된 약관은 제목·본문·필수 여부를 고칠 수 없다** (`CONFLICT` 409). 바꿀 수 있는 것은 표시 순서뿐이다
- **동의 이력이 한 건이라도 있으면 삭제되지 않는다** (`CONFLICT` 409). 삭제는 오타 난 초안을 치우는 용도다
- **동의 이력을 수정·삭제하는 엔드포인트는 없다.** 감사 로그와 같은 이유다 — 지울 수 있는 경로가 있으면 그 순간 증빙이 아니게 된다
- `POST /admin/terms/templates` 는 국내 가입 화면의 네 가지(`service`·`privacy`·`age` 필수, `marketing` 선택)를 **초안**으로 넣는다. **이미 있는 코드는 건너뛴다** — 여러 번 호출해도 결과가 같아, 관리자가 자기 약관을 덮어쓸 걱정 없이 눌러 볼 수 있다. 응답은 **이번에 만들어진 것만** 담는다(전부 건너뛰면 빈 배열). 문안은 법률 자문이 아니라 고쳐 쓸 출발점이며, 서비스마다 달라지는 자리는 `[ ]` 로 비워 두어 검토 없이 게시하면 사용자 눈에 그대로 보인다

### 사용자 속성 정의 — `/admin/user-attributes`

> 2026-08-08 추가.

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/user-attributes` | `ixauth:users:read` |
| POST | `/admin/user-attributes` (등록·수정 겸용) | `ixauth:users:write` |
| DELETE | `/admin/user-attributes/{key}` | `ixauth:users:write` |

```json
{ "key": "dept", "label": "부서", "type": "ENUM", "required": true,
  "options": "개발,영업,경영지원", "displayOrder": 0, "description": "…" }
```

타입은 `STRING` · `NUMBER` · `BOOLEAN` · `ENUM` · `DATE`. 여기서 멈추는 이유 — 더 늘리면 이 표가 앱의 도메인 스키마가 된다. 구조가 있는 데이터는 앱이 자기 테이블에 둔다.

- **정의가 하나도 없으면 아무 검사도 하지 않는다.** 지금까지 쓰던 앱이 그대로 동작해야 한다
- 값은 정의대로 **정규화되어 저장된다** — `"3"` 은 `3` 이 된다. 같은 값이 앱에 따라 문자열과 숫자로 갈리면 읽는 쪽이 두 경우를 다 다뤄야 한다
- 정의에 없는 키는 그대로 통과한다. 거부하려면 `ixauth.account.strict-attributes` 를 켠다 ([`config.md`](config.md) §5-2)
- 검증 실패는 `VALIDATION_FAILED`(400) + `details[].field = "attributes.<key>"`
- **정의를 지워도 사용자에게 저장된 값은 지우지 않는다.** 정의를 잘못 지운 실수가 곧 데이터 손실이 되면 안 된다
- `PATCH /admin/users/{id}` 에 `attributes` 가 **없으면** "손대지 않음" 이라 검사하지 않는다 — 이름만 바꾸는 요청이 속성 검사에 걸리면 안 된다

### 2단계 인증 초기화 — `POST /admin/users/{id}/mfa-reset`

> 2026-08-08 추가. `ixauth.mfa.admin-reset` 이 `false` 면 `AUTHZ_FORBIDDEN`(403).

```json
{ "data": { "reset": true } }     // false = 등록돼 있던 것이 없었다
```

사용자가 휴대폰과 백업 코드를 **모두** 잃었을 때의 복구 경로다. 이것이 없으면 남는 수단은 DB 직접 수정뿐이고, 그쪽은 흔적이 남지 않아 오히려 위험하다.

**두 가지가 반드시 따라붙는다. 설정으로 끌 수 없다.**

| | 왜 |
|---|-----|
| 감사 로그 `MFA_RESET_BY_ADMIN` | 누가·누구를·언제. 없으면 사고 조사에서 되짚을 수 없다 |
| 대상자에게 나가는 통지 메일 | 본인이 요청하지 않은 초기화는 이 메일로만 드러난다 |

관리자가 **조용히** 남의 2단계를 끄고 그 계정으로 들어가는 일이 없어야 한다. 등록된 것이 없어도 기록과 통지는 나간다 — "시도했다" 는 사실 자체가 신호다.

비밀번호는 요구하지 않는다(남의 비밀번호를 관리자가 알 리 없다). 통제 수단은 권한 + 위 두 흔적이다.

### 사용자 대리 — `POST /admin/users/{id}/impersonate`

> 2026-08-20 추가. 필요 권한 **`ixauth:impersonation:create`** (전용 코드). 설정 `ixauth.impersonation.*` ([`config.md`](config.md) §5-7).

관리자가 특정 사용자로 전환한다. 답하려는 질문은 하나다 — **"저는 그 화면이 안 나와요" 를 어떻게 재현하는가.** 대안은 그 사람의 비밀번호를 초기화하고 로그인해 보는 것인데, 그건 사용자를 실제로 쫓아내고 감사 로그에 **본인 로그인**으로 남는다. 대리가 오히려 흔적이 정확하다.

```json
// 요청 — 본문은 선택이다. 없으면 요청 헤더에서 IP·UA 를 뽑는다
POST /admin/users/41/impersonate
Authorization: Bearer <관리자 access token>
{ "userAgent": "…", "ip": "203.0.113.7" }

// 200 — 로그인과 같은 봉투. 단 토큰은 **대상 사용자의 것**이다
{ "data": {
  "accessToken": "eyJ…",
  "refreshToken": "9f2c…",
  "expiresIn": 900,
  "user": { "id": "41", "email": "user@example.com", "name": "…",
            "roles": ["USER"], "groups": [] },
  "impersonator": { "id": "1", "email": "admin@example.com", "name": "관리자" }
} }
```

- 인증은 다른 `/admin/*` 과 같다 — 관리자 access token. 서비스 키도 같은 규약이다(있으면 통과, 관리 API 는 토큰으로 판정)
- `mfaSetupRequired` · `termsAgreementRequired` 는 **싣지 않는다.** 관리자에게 대상 사용자의 2단계 등록이나 약관 동의를 시킬 수는 없다
- `impersonator` 는 access token 의 표준 `act` 클레임과 같은 사실을 가리킨다 ([`token.md`](token.md) §3). 토큰을 열지 않고도 "누구를 대리 중인가" 를 띄울 수 있어야 한다

#### 왜 전용 권한 코드인가

`ixauth:users:write` 를 재사용하지 않는다. **사용자를 고치는 것과 사용자가 되는 것은 다른 일이다.** `users:write` 로 하는 조작(비밀번호 초기화·2단계 초기화)은 관리자 이름으로 흔적이 남지만, 대리 이후의 조작은 **그 사람 이름으로** 남는다.

resource 를 `users` 가 아니라 `impersonation` 으로 둔 것도 같은 이유다 — `ixauth:users:*` 를 준 역할에 대리 권한이 딸려 가면 안 된다.

#### 제약

| 상황 | 응답 |
|------|------|
| 자기 자신 | `IMPERSONATION_SELF` **400** — 권한 문제가 아니라 말이 안 되는 요청이다 |
| 대상이 `ACTIVE` 가 아님 (잠김·비활성·초대대기·승인대기) | `IMPERSONATION_TARGET_NOT_ACTIVE` **409** |
| 대상이 없음 | `NOT_FOUND` 404 |
| 권한 없음 | `AUTHZ_FORBIDDEN` 403 |
| `ixauth.impersonation.enabled=false` | `IMPERSONATION_DISABLED` 403 |
| **대리 세션이 이 API 를 다시 호출** (재대리) | `IMPERSONATION_ACTION_FORBIDDEN` 403 |

`ACTIVE` 만 허용하는 이유 — 잠긴 계정을 대리하면 **본인은 못 들어오는데 관리자는 들어가는** 상태가 된다. 재현하려던 화면이 애초에 그 사람에게 보이지 않는 화면이라 조사 결과 자체가 틀어진다.

#### 대리 세션이 할 수 없는 일

막지 않으면 관리자가 그 사람의 비밀번호를 바꾸고 2단계를 풀고 계정을 지울 수 있고, 그 흔적은 전부 **본인이 한 일**로 남는다. 아래는 전부 `IMPERSONATION_ACTION_FORBIDDEN`(403)이다.

| 막는 것 | 왜 |
|---------|-----|
| `/admin/**` 전체 | 재대리 포함. 대리 사슬이 생기면 되짚을 수 없다 |
| `POST /auth/password/change` · `/auth/email/change` | 바꾸면 본인이 못 들어온다 |
| `POST /auth/account/delete` | 되돌릴 수 없다 |
| `/auth/mfa/totp*` (등록·확인·해제) | 2단계는 본인만 걸고 푼다 |
| `POST·DELETE /auth/social/{provider}/link` | 계정 연결도 자격증명이다 |
| `POST /auth/terms/agree` | 그 사람과 우리 사이의 합의다. 대신 눌러 줄 수 없다 |
| `DELETE /auth/sessions` · `/auth/sessions/{id}` | 남의 기기를 끊는 일. 대리를 끝내는 것은 `/auth/logout` 으로 한다 |

**읽기는 막지 않는다.** 대리의 목적이 "그 사람에게 무엇이 보이는가" 를 확인하는 것이라, 조회까지 막으면 기능이 성립하지 않는다. `GET /auth/me` · `/auth/sessions` · `/auth/mfa/status` · `/authz/my-permissions` 는 전부 통한다.

#### 세션 · 수명 · 흔적

- 대리 세션은 **일반 세션과 같은 표에 들어간다.** `GET /admin/users/{id}/sessions` 에 그대로 보이고, 같은 `DELETE` 로 끊긴다. 다만 `impersonated: true` · `impersonatorId` · `impersonatorEmail` 이 함께 실린다 — 구분이 없으면 관리자는 사용자가 낯선 기기에서 접속한 것으로 읽는다
- **수명은 `ixauth.impersonation.ttl`(기본 `1h`) 이다.** 일반 로그인(`jwt.refresh-ttl`, 기본 7일)보다 짧다. access token 수명은 그대로 `jwt.access-ttl`(기본 15분)이다 — 그건 서명 갱신 주기이지 세션 수명이 아니다
- **refresh 회전은 되지만 창이 늘어나지 않는다.** 회전한 세션은 원래 만료를 물려받는다. 늘어나면 `ttl` 이 '수명' 이 아니라 '유휴 시간' 이 되어, 15분마다 갱신하는 것만으로 남의 계정을 무한정 붙들 수 있다
- **대상의 로그인 기록을 건드리지 않는다.** `lastLoginAt` · 실패 카운터 · 잠금 해제는 그대로다. 동시 세션 상한도 적용하지 않고(대리가 사용자를 쫓아내면 안 된다), 새 기기 알림 메일도 보내지 않는다
- 시작은 **반드시** 감사 로그 `IMPERSONATION_STARTED` 에 남는다 (`userId`=대상, `actorId`=관리자, IP·UA·대상 이메일·`ttl`). **끌 수 없다** — 이 한 줄이 없으면 그 세션이 남긴 기록을 본인이 한 일과 구분할 방법이 사라진다

> 대리를 **끝내는** 전용 엔드포인트는 두지 않는다. `POST /auth/logout` 에 대리 refresh token 을 주면 그 세션만 끊긴다 — 대리 세션은 일반 세션과 같은 것이므로 종료도 같은 문으로 나간다.

### 역할 · 권한 · 그룹

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET · POST | `/admin/roles` | `ixauth:roles:read` / `write` |
| GET · PATCH · DELETE | `/admin/roles/{id}` | read / write / write |
| GET · PUT | `/admin/roles/{id}/permissions` | read / write |
| GET · POST · DELETE | `/admin/permissions` | read / write |
| GET · POST | `/admin/groups` | read / write |
| GET · PATCH · DELETE | `/admin/groups/{id}` | read / write / write |
| GET · POST · DELETE | `/admin/groups/{id}/members` | read / write |
| GET · PUT | `/admin/groups/{id}/roles` | read / write |
| GET · POST · DELETE | `/admin/resource-grants` [P2] | read / write |

`is_system = true` 인 역할은 **삭제·코드 변경 불가** (`CONFLICT` 409).

### 사용자 상세 — `GET /admin/users/{id}/detail`

> 2026-08-08 추가 (G22).

한 사람의 지금 상태를 한 번에 준다 — 기본정보 + 역할·그룹 + **활성** 세션 + 소셜 연결 + 2단계 상태 + 약관 응답 + 최근 감사 로그 10건.

```json
{ "data": {
  "id": "41", "email": "…", "status": "ACTIVE", "emailVerified": true,
  "roles": ["USER"], "groups": [],
  "sessions": [ { "id": "…", "ip": "…", "deviceLabel": "Chrome · Windows", "issuedAt": "…" } ],
  "identities": [ { "provider": "KAKAO", "email": "…", "linkedAt": "…" } ],
  "federatedIdentities": [ { "provider": "nexus-hub", "subject": "8f31…",
                             "emailAtLink": "…", "linkedAt": "…", "lastLoginAt": "…" } ],
  "mfa": { "enabled": true, "confirmedAt": "…", "backupCodesLeft": 7 },
  "terms": [ { "code": "service", "version": 2, "agreed": true, "agreedAt": "…" } ],
  "recentAudit": [ { "eventType": "LOGIN_SUCCESS", "createdAt": "…", "detail": {} } ]
} }
```

- 목록만 있으면 "이 사람이 왜 못 들어오는가" 에 답하려고 탭을 번갈아 열게 되고, 그러다 정작 원인(2단계가 걸려 있다 · 소셜만 연결돼 있다 · 어제 잠겼다)을 놓친다
- **시크릿은 하나도 실리지 않는다.** TOTP 시크릿도, 백업 코드도, 세션 토큰도 없다. 2단계는 "걸려 있는가 · 백업 코드가 몇 개 남았는가" 까지다
- 세션은 **살아 있는 것만.** 폐기·만료된 것까지 보이면 "지금 어디서 쓰는가" 가 묻힌다
- `identities`(소셜)와 `federatedIdentities`(연합, §2-7)를 **나눠서** 준다. 두 목록은 그 연결을 **누가 보증했는가** 가 다르다 — 소셜은 jar 가 provider 와 직접 주고받은 결과이고, 연합은 앱이 대신 확인해 온 결과다. 한 줄로 섞으면 "이 사람이 어떻게 들어오나" 를 볼 때 그 차이가 사라진다

### 감사 로그

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/audit-logs?eventType=&userId=&from=&to=&page=&size=` | `ixauth:audit:read` |
| GET | `/admin/audit-logs/export?eventType=&userId=&from=&to=` | `ixauth:audit:read` |

조회 전용. 수정·삭제 엔드포인트를 만들지 않는다 (append-only).

**CSV 내보내기** (2026-08-08 추가 · G14) — `text/csv;charset=UTF-8`, UTF-8 BOM 으로 시작하고 열은 `id,createdAt,eventType,userId,actorId,ip,userAgent,detail` 이다. `detail` 은 JSON 한 칸으로 들어간다(열로 펼치면 이벤트마다 열 구성이 달라진다).

- 상한은 `ixauth.audit.export-max`(기본 5만 행). 걸리면 거기서 끊고 **마지막 줄에 잘렸다고 적는다**
- `to` 를 주지 않으면 **요청 시각으로 닫는다.** 열어 두면 내보내는 동안 새로 쌓이는 행이 최근순 페이지를 밀어 같은 줄이 두 번 나온다
- **내보내기 자체가 감사 로그에 남는다** (`AUDIT_EXPORTED`)

### 설정 변경 이력 — `GET /admin/settings/{key}/history`

> 2026-08-08 추가 (G25). 필요 권한 `ixauth:audit:read`.

```json
{ "data": [ { "eventType": "SETTING_CHANGED", "before": "OPEN", "after": "CLOSED",
              "actorId": 1, "ip": "…", "changedAt": "…" } ] }
```

**표를 따로 만들지 않았다.** 설정 변경은 이미 감사 로그에 있고(`SETTING_CHANGED` · `SETTING_RESET`), 같은 사실을 두 곳에 두면 언젠가 둘이 어긋난다. 그래서 감사 로그를 그 키로 좁혀 준다 — 보존 기간이 지난 것은 여기에도 없다. 정의에 없는 키는 `VALIDATION_FAILED`(400)다.

### 메일 발송 이력 — `/admin/mail-deliveries`

> 2026-08-08 추가 (G21). 설정은 [`config.md`](config.md) §5-1.

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/mail-deliveries?status=&kind=&email=&page=&size=` | `ixauth:users:read` |
| POST | `/admin/mail-deliveries/{id}/retry` | `ixauth:users:write` |

```json
{ "data": { "items": [ { "id": 12, "to": "user@example.com", "kind": "PASSWORD_RESET",
  "subject": "[IX-Auth] 비밀번호 재설정", "locale": "ko", "status": "GAVE_UP",
  "attempts": 3, "lastError": "Connection refused", "createdAt": "…", "sentAt": null,
  "retryable": true } ], "page": 0, "size": 20, "total": 1 } }
```

- **본문과 링크는 없다.** 재설정 링크가 남으면 그것이 곧 계정 탈취 경로다
- 상태는 `SENT` · `FAILED`(재시도 남음) · `GAVE_UP`(재시도 끝) · `SKIPPED`(`transport=LOG`) · `PENDING`
- `retryable` 이 `false` 면 메시지를 더 이상 들고 있지 않다는 뜻이고, 그 상태에서 재시도를 부르면 `CONFLICT`(409)다. **없는 것을 있는 척하지 않는다** — 그 경우 해당 기능(초대·재설정)을 다시 실행한다

### 메일 템플릿 — `/admin/mail-templates`

> 2026-08-08 추가 (G16 · G17).

| 메서드 | 경로 | 필요 권한 |
|--------|------|----------|
| GET | `/admin/mail-templates` | `ixauth:users:read` |
| PUT | `/admin/mail-templates/{kind}/{locale}` | `ixauth:users:write` |
| DELETE | `/admin/mail-templates/{kind}/{locale}` (초기화) | `ixauth:users:write` |
| POST | `/admin/mail-templates/preview` | `ixauth:users:read` |

```json
// GET — 코드 기본값과 관리자가 고친 값을 함께 준다
{ "data": [ { "kind": "PASSWORD_RESET", "locale": "ko", "subject": "…", "body": "…",
              "overridden": false, "defaultSubject": "…", "defaultBody": "…" } ] }

// POST /preview — subject·body 를 주면 그것으로, 없으면 저장된 것으로 치환해 본다
{ "kind": "PASSWORD_RESET", "locale": "ko", "subject": "…", "body": "…" }
```

- `kind` 는 웹훅의 `kind` 와 같은 값이다 (§5-1)
- **미리보기의 링크는 가짜다.** 진짜 토큰을 만들면 관리 화면을 여는 것만으로 유효한 재설정 링크가 생긴다
- 삭제가 곧 초기화다 — 행이 없으면 코드 기본값을 쓴다

---

## 5. 시스템

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/health` | 없음 | `{ "status": "UP", "db": "UP", "migration": "OK", "version": "0.1.0" }` |
| GET | `/admin-ui/**` | 세션 | 내장 관리 화면 (`ixauth.admin-ui.enabled=false` 면 404) |

`/health` 는 DB 연결 + 마이그레이션 적용 상태를 본다. 하나라도 실패면 `503` + `status: DOWN`.

---

## 6. Rate Limit

| 대상 | 기본값 |
|------|--------|
| `/auth/login` | IP 당 분당 10회 |
| `/auth/refresh` | IP 당 분당 60회 |
| 그 외 | 서비스 키 당 분당 600회 |

초과 시 `429` + `RATE_LIMITED` + `Retry-After` 헤더.

> jar 는 내부 전용이라 IP 가 앱 서버 하나로 몰린다. 따라서 로그인 rate limit 은 **요청 본문의 `ip`(최종 사용자 IP)** 를 기준으로 센다. 앱이 이를 주지 않으면 서비스 키 단위로 폴백한다.
>
> 즉 IP 를 잘못 넘기면 속도 제한이 방문자별이 아니라 **앱 하나 단위**로 걸린다. 한 사람의 실패가 다른 사람의 로그인을 막는다는 뜻이다 ([`../guides/client-ip.md`](../guides/client-ip.md)).

---

## 7. 페이지네이션 · 정렬

```
?page=0&size=20&sort=createdAt,desc
```

- `page` 0-based, `size` 기본 20 · 최대 100
- 응답은 §1 의 목록 봉투

---

## 8. 미결정

| 항목 | 현재 |
|------|------|
| ~~사용자 일괄 등록(CSV/JSON bulk)~~ | **구현됨** (2026-08-08) — §4 `POST /admin/users/bulk` |
| 관리 API 의 낙관적 잠금(`If-Match`) | 단일 관리자 전제로 생략. 다중 관리자 요구 시 추가 |
| 약관 다국어 | 코드마다 한 언어. 언어별 약관이 필요하면 `service-en` 처럼 코드를 나눠 쓴다. 메일 본문이 한국어 고정인 것과 같은 경계라 다국어(G17)와 함께 다룬다 |
| 속성 정의의 복합 타입(배열·객체) | 하지 않는다. 그 이상은 앱의 도메인 스키마이고, 그건 앱 테이블의 몫이다 |
