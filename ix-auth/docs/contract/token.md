# 토큰 계약

> **정본.** 서버(Java)와 SDK 4종이 여기에 맞춘다. 변경 절차는 [`../../.claude/rules/contract-policy.md`](../../.claude/rules/contract-policy.md).

---

## 1. 두 종류의 토큰

| | access token | refresh token |
|---|---|---|
| 형식 | **JWT** (RS256 서명) | **opaque 난수** (JWT 아님) |
| 검증 | **앱이 로컬에서** JWKS 공개키로 | **jar 만** — DB 대조 |
| 기본 TTL | **15분** | **7일** |
| 저장 | 앱이 쿠키/메모리 (jar 는 저장 안 함) | `ixauth.sessions.refresh_token_hash` (SHA-256) |
| 폐기 | 불가 (만료 대기) | **즉시 가능** |

### 왜 refresh 는 JWT 가 아닌가

JWT 로 만들면 앱이 로컬 검증할 수 있게 되고, 그러면 **로그아웃·강제 종료가 실제로 먹지 않는다.** refresh 는 반드시 jar 가 DB 를 보고 판단해야 한다.

### 왜 access TTL 이 15분인가

앱이 로컬 검증하므로 발급된 access token 은 **만료 전까지 무효화할 수 없다.** 그 대가를 짧은 수명으로 상쇄한다. 로그아웃하면 refresh 가 즉시 죽으므로 최대 15분 뒤에는 접근이 끊긴다.

> 더 짧게(5분) 두면 무효화가 빨라지지만 refresh 왕복이 늘어난다. 15분은 그 절충이며 `ixauth.jwt.access-ttl` 로 조정 가능하다.

---

## 2. 서명

| 항목 | 값 |
|------|-----|
| 알고리즘 | **RS256** (기본) · `ES256` 선택 가능 (`ixauth.jwt.algorithm`) |
| 키 길이 | RSA 2048 이상 |
| 키 생성 | 최초 부팅 시 자동 생성 후 보관. `ixauth.jwt.private-key` 로 주입도 가능 |

**RS256 을 기본으로 두는 이유**: ES256 이 키가 작고 빠르지만, 앱 쪽 언어·런타임(특히 Spring 레거시, 오래된 Python)에서 RS256 의 라이브러리 호환성이 가장 넓다. 검증 주체가 **우리가 통제하지 않는 앱**이므로 호환성을 우선한다.

---

## 3. Access Token 클레임

```json
{
  "iss": "https://myapp.example.com",
  "sub": "1042",
  "aud": "myapp",
  "exp": 1786237800,
  "iat": 1786236900,
  "jti": "0f4c…",

  "email": "chris@prost.team",
  "name": "이대훈",

  "ixauth_roles":  ["ADMIN", "PM"],
  "ixauth_groups": ["dev-team"],
  "ixauth_sid":    "9b1d…",
  "ixauth_pv":     1786230000,
  "ixauth_idp":    "nexus-hub",

  "act": { "sub": "1", "email": "admin@example.com" }
}
```

| 클레임 | 타입 | 필수 | 설명 |
|--------|------|------|------|
| `iss` | string | ✅ | 발급자. `ixauth.jwt.issuer` |
| `sub` | string | ✅ | `users.id` 의 문자열 표현 |
| `aud` | string | ✅ | 대상 앱 식별자. `ixauth.jwt.audience` |
| `exp` `iat` | number | ✅ | epoch 초 |
| `jti` | string | ✅ | 토큰 고유 ID (감사 추적용) |
| `email` `name` | string | ✅ | 표시용 |
| `ixauth_roles` | string[] | ✅ | **역할 코드**. 권한 자체가 아니다 — L1 판정은 이 역할 + permission-map 으로 한다 |
| `ixauth_groups` | string[] | ✅ | 소속 그룹 코드 |
| `ixauth_sid` | string | ✅ | 세션 ID (`sessions.id`). 감사·강제 종료 추적용 |
| `ixauth_pv` | number | ✅ | **permissions_version** — 앱의 캐시된 permission-map 이 낡았는지 판단 ([`authz.md`](authz.md) §캐싱) |
| `act` | object | — | **대리 중일 때만.** 실제로 조작하는 사람(관리자) — `{ "sub": "<관리자 id>", "email": "<관리자 email>" }` |
| `ixauth_idp` | string | — | **연합 신원으로 들어왔을 때만.** 그 외부 IdP 이름 (`http-api.md` §2-7). 없으면 IX-Auth 자체 인증(비밀번호·매직 링크·소셜)이다 |

### 규칙

1. **클레임 이름은 OIDC 관례를 따른다** (`sub`/`iss`/`aud`/`exp`/`iat`/`email`/`name`). 커스텀은 `ixauth_` 접두어.
   > 이유: `ixauth.mode=federated` 로 IX-Trust 에 위임할 때 앱 코드가 그대로 동작해야 한다. 클레임 이름이 다르면 승격 경로가 막힌다.
2. **권한 목록을 토큰에 넣지 않는다.** 역할만 넣는다. 권한은 수백 개가 될 수 있어 토큰이 비대해지고, 권한이 바뀔 때마다 재발급이 필요해진다.
3. **개인정보를 최소화한다.** 전화번호·주소·사번 등은 넣지 않는다. 앱이 필요하면 자기 프로필 테이블에서 조회한다.
4. `act` 만 `ixauth_` 접두어의 예외다. **이름과 모양이 이미 표준으로 정해져 있다** (RFC 8693 §4.1 — delegation 의 actor). 우리 이름을 붙이면 `federated` 모드로 IX-Trust 에 위임할 때 앱 코드가 갈라진다.

### `ixauth_idp` — 연합 신원 (2026-08-27 추가)

앱이 외부에서 확인한 신원을 `POST /auth/federated/exchange` 로 제출해 받은 토큰에만 실린다 ([`http-api.md`](http-api.md) §2-7).

| 규칙 | 내용 |
|------|------|
| **없으면 자체 인증이다** | 비밀번호·매직 링크·소셜 로그인 토큰에는 이 클레임을 넣지 않는다. 빈 값을 늘 붙이면 앱이 유무가 아니라 내용으로 판단하게 된다 — `act` 와 같은 이유 |
| **회전해도 유지된다** | refresh 로 새 토큰을 받아도 그대로 실린다. 사라지면 15분 뒤부터 그 세션이 자체 로그인처럼 보인다 |
| **출처는 세션 행이다** | `sessions.idp`. 앱이 보낸 토큰의 값을 믿고 다시 서명하면 **어느 IdP 로 들어왔는지를 클라이언트가 정하게 된다** |
| **값은 정규화된 provider 이름** | 소문자. 허용 목록에 `Nexus-Hub` 로 적어도 토큰에는 `nexus-hub` 로 나간다 |
| **인가에 쓰지 않는다** | 이것은 "어떻게 들어왔는가" 이지 "무엇을 할 수 있는가" 가 아니다. 권한은 `ixauth_roles` + permission-map 으로 판정한다 |

`act` 와 함께 실릴 수 있다 — 관리자가 연합으로 들어온 사용자를 대리하는 경우다. 그때 `ixauth_idp` 는 **대리 세션이 아니라 그 세션이 열린 방식**을 가리키므로 대리 세션에는 붙지 않는다(대리는 관리 API 로 시작하고, 그 자리에 IdP 가 없다).

---

### `act` — 사용자 대리 (2026-08-20 추가)

`sub` 는 **대리 대상**이고 `act` 는 **실제로 조작하는 사람**이다. 앱은 대상의 권한으로 동작하되 화면에는 대리 중임을 함께 보여 준다.

```
sub = 41  (user@example.com)   ← 이 사람의 권한으로 동작한다
act = 1   (admin@example.com)  ← 이 사람이 지금 그러고 있다
```

| 규칙 | 내용 |
|------|------|
| **없으면 대리가 아니다** | 평범한 로그인 토큰에는 이 클레임을 넣지 않는다. 빈 `act` 를 늘 붙이면 앱이 유무가 아니라 내용으로 판단하게 된다 |
| **회전해도 유지된다** | refresh 로 새 토큰을 받아도 `act` 가 그대로 실린다. 사라지면 그 뒤의 조작은 본인이 한 것으로 남는다 |
| **출처는 세션 행이다** | `sessions.impersonator_id` · `impersonator_email`. 앱이 보낸 토큰의 `act` 를 믿고 다시 서명하면 **대리 사실을 클라이언트가 정하게 된다** |
| **앱이 할 일** | 화면 상단에 "지금 ○○ 님으로 보는 중 (관리자 △△)" 을 띄운다. 대리 세션은 민감 작업이 서버에서 막히므로([`http-api.md`](http-api.md) §4) 그 버튼들은 감추는 편이 낫다 |
| **중첩하지 않는다** | 대리 세션으로는 다시 대리할 수 없다. `act` 는 언제나 사람 하나이고 배열이 되지 않는다 |

시작은 감사 로그 `IMPERSONATION_STARTED` 에 남는다 — 끌 수 없다.

---

## 4. JWKS

```
GET /.well-known/jwks.json
```

```json
{
  "keys": [
    { "kty": "RSA", "use": "sig", "alg": "RS256", "kid": "2026-08-a", "n": "…", "e": "AQAB" },
    { "kty": "RSA", "use": "sig", "alg": "RS256", "kid": "2026-05-a", "n": "…", "e": "AQAB" }
  ]
}
```

- 응답에 `Cache-Control: public, max-age=3600` 을 준다. 앱 SDK 는 이를 존중하되, **모르는 `kid` 를 만나면 즉시 한 번 다시 받는다** (회전 직후 대응). 단 재조회는 rate limit 을 둔다 (분당 1회 등)
- 이 엔드포인트는 **서비스 키 인증 없이** 접근 가능하다 (공개키이므로)

### 키 회전

```
① 새 키페어 생성 → JWKS 에 추가 (구 키 유지)
② 새 토큰은 새 키로 서명 (헤더 kid 갱신)
③ access TTL(기본 15분) + 여유시간 경과 후 구 키를 JWKS 에서 제거
```

구 키를 즉시 지우면 아직 유효한 토큰이 검증 실패한다. **반드시 겹치는 기간을 둔다.**

### 키 보관

키는 **DB(`ixauth.signing_keys`)에 둔다.** 파일이나 메모리가 아니다.

| 이유 | |
|------|--|
| 재시작 내성 | jar 가 재시작해도 이미 발급된 토큰이 계속 검증돼야 한다 |
| 다중 인스턴스 | 여러 인스턴스가 같은 키로 서명해야 한다 |
| 회전 안전성 | 구 키를 남겨둬야 아직 유효한 토큰이 깨지지 않는다 |

`retired_at` 이 설정되면 JWKS 에서 빠진다. `active` 는 "지금 서명에 쓰는 키"를 가리킨다.

> DB 접근이 곧 키 유출이므로 **DB 자체의 접근 통제가 전제**다. 더 강한 격리가 필요하면
> `ixauth.jwt.private-key` 로 외부에서 주입한다 (KMS·시크릿 매니저 연동 지점).

---

## 5. 발급 · 갱신 흐름

```
로그인    앱 → POST /auth/login       → { accessToken, refreshToken, expiresIn, user }
갱신      앱 → POST /auth/refresh     → { accessToken, refreshToken, expiresIn }
로그아웃  앱 → POST /auth/logout      → 세션 revoked_at 기록
```

- **refresh 회전**: `/auth/refresh` 는 새 refresh token 도 함께 발급하고 기존 것을 폐기한다 (rotation)
- **재사용 감지**: 이미 폐기된 refresh token 이 다시 오면 **해당 사용자의 모든 세션을 폐기**하고 감사 로그에 남긴다. 토큰 탈취 신호다
- 브라우저는 jar 를 직접 호출하지 않는다. 앱이 중계하고 **앱 도메인 쿠키**로 심는다 (설계 불변식 4)

---

## 6. 앱 측 검증 절차 (SDK 규약)

```
① Authorization: Bearer <token> 또는 앱이 정한 쿠키에서 꺼낸다
② 헤더의 kid 로 JWKS 캐시에서 공개키를 찾는다 (없으면 JWKS 1회 재조회)
③ 서명 검증 → exp/iat 검증 → iss/aud 일치 확인
④ ixauth_roles 와 캐시된 permission-map 으로 권한을 판정한다 (authz.md)
```

**③까지가 인증, ④가 인가다. 어느 단계에서도 jar 를 호출하지 않는다** (설계 불변식 2).

clock skew 는 ±60초까지 허용한다.

---

## 7. 미결정

| # | 항목 | 현재 |
|---|------|------|
| — | `aud` 를 다중 값으로 둘지 | 단일 문자열로 시작. 한 jar 가 여러 앱을 서빙하는 요구가 생기면 재검토 |
| — | access token 을 앱이 어디에 저장할지 | **앱 자유.** IX-Auth 는 강제하지 않는다 (HttpOnly 쿠키 권장을 문서로만 안내) |
