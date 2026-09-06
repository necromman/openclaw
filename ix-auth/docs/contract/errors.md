# 에러 코드 계약

> **정본.** 응답 봉투는 [`http-api.md`](http-api.md) §1.

```json
{ "error": { "code": "AUTH_INVALID_CREDENTIALS",
             "message": "이메일 또는 비밀번호가 올바르지 않습니다.",
             "traceId": "0f4c…" } }
```

- `code` 는 **기계가 읽는 값**이다. 앱은 이 값으로 분기한다. 절대 `message` 문자열로 분기하지 않는다
- `message` 는 사람이 읽는 한국어. 문구는 바뀔 수 있다 (계약 아님)
- `traceId` 는 항상 포함
- **선택 필드** `details`: 검증 실패 시 필드별 사유 배열
- **선택 필드** `meta`: 그 에러를 처리하려면 값이 하나 더 필요한 경우에만 붙는다. 지금은 `AUTH_MFA_REQUIRED` 뿐이다 — 로그인 2단계는 `challenge`·`expiresIn`, step-up 재인증은 `stepUp`(작업 이름) (2026-08-08 추가). **내부 상태·원인을 담지 않는다**

---

## 인증 — `AUTH_*`

| code | HTTP | 언제 |
|------|------|------|
| `AUTH_INVALID_CREDENTIALS` | 401 | 이메일 없음 **또는** 비밀번호 불일치. **둘을 구분하지 않는다** — 계정 존재 여부 유출 방지 |
| `AUTH_ACCOUNT_LOCKED` | 423 | 잠긴 계정 — 로그인 실패 누적(자동) **또는 관리자가 건 `status=LOCKED`**(수동). **비밀번호가 맞았을 때만** 반환. 두 갈래의 차이는 http-api.md §2-1-1 |
| `AUTH_ACCOUNT_DISABLED` | 403 | 비활성 계정. **비밀번호가 맞았을 때만** 반환 |
| `AUTH_ACCOUNT_PENDING` | 403 | 초대 수락 전 계정. 초대 메일의 링크로 비밀번호를 정해야 한다 |
| `AUTH_ACCOUNT_PENDING_APPROVAL` | 403 | 가입 승인 대기 (`account.signup-mode=APPROVAL`). **본인이 할 일이 없다** — 관리자가 승인해야 한다는 것을 알려 줘야 무엇을 기다리는지 안다 |
| `AUTH_EMAIL_UNVERIFIED` | 403 | 이메일 미인증. `ixauth.account.require-email-verification=true` 일 때만. 앱은 '인증 메일 다시 보내기' 를 안내한다 |
| `AUTH_TOKEN_EXPIRED` | 401 | access token 만료. **메일 링크 토큰의 만료·재사용도 이 코드다** — 만료와 재사용을 구분해 주면 유효한 토큰을 찾는 쪽에 힌트가 된다 |
| `AUTH_TOKEN_INVALID` | 401 | 서명 불일치 · 형식 오류 · `iss`/`aud` 불일치 |
| `AUTH_SESSION_REVOKED` | 401 | 폐기된 refresh 사용. **재사용 감지 시 전 세션 폐기 후 이 코드** |
| `AUTH_REFRESH_EXPIRED` | 401 | refresh 만료 → 재로그인 필요 |
| `AUTH_PASSWORD_POLICY` | 400 | 비밀번호가 정책 미달(길이·구성). `details` 에 위반 항목 |
| `AUTH_PASSWORD_REUSED` | 400 | **최근에 쓴 비밀번호.** 기본값에서는 직전 것만, `password.history-count` 를 켜면 최근 N개가 걸린다. 몇 개까지인지는 `message` 로 알린다 — **코드는 그대로**라 앱의 분기가 깨지지 않는다 |
| `AUTH_PASSWORD_BREACHED` | 400 | 외부 유출 목록(HIBP)에 있는 비밀번호 (`password.check-breached`). 2026-08-08 추가 |
| `AUTH_TERMS_REQUIRED` | 400 | 필수 약관에 동의하지 않았다. `details` 에 빠진 코드(`agreements.<code>`). 2026-08-08 추가 |
| `AUTH_MFA_REQUIRED` | 401 | 2단계 인증 필요. **`meta.challenge` · `meta.expiresIn` 이 함께 온다** — 앱은 그걸 들고 `/auth/mfa/verify` 로 간다. **step-up 재인증(§`mfa.step-up-actions`)에서는 `meta.stepUp` 만 오고 `challenge` 가 없다** (2026-08-08) |
| `AUTH_MFA_INVALID` | 401 | 코드 불일치 · **이미 쓴 코드의 재사용** · 이미 쓴 백업 코드. **셋을 구분하지 않는다** — 구분하면 "그 코드는 맞았다" 가 새어나간다 |
| `AUTH_SELF_DELETE_DISABLED` | 403 | 본인 탈퇴가 꺼져 있다 (`ixauth.account.self-delete-mode=DISABLED`). 2026-08-08 추가 |
| `AUTH_CAPTCHA_REQUIRED` | 400 | CAPTCHA 를 거는 경로인데 `captchaToken` 이 오지 않았다 (`captcha.protect`). 2026-08-08 추가 |
| `AUTH_CAPTCHA_FAILED` | 403 | CAPTCHA 검증이 거절됐다 — 위조·만료·점수 미달. **provider 에 닿지 못한 경우는 이 코드가 아니다**(통과시킨다). 2026-08-08 추가 |

> `AUTH_SELF_DELETE_DISABLED` 를 `AUTHZ_FORBIDDEN` 과 나눈 이유 — 앱이 둘에 다르게 반응해야 한다. 권한 문제면 "관리자에게 문의", **기능이 꺼진 것이면 탈퇴 화면 자체를 감춘다.** 같은 코드로 묶으면 앱은 그 구분을 할 수 없다.

> `AUTH_PASSWORD_BREACHED` 를 `AUTH_PASSWORD_POLICY` 와 나눈 이유도 같다. 정책 미달은 "무엇을 고치면 되는지"(더 길게, 숫자를 넣어서)를 안내할 수 있지만, 유출된 비밀번호는 길이·복잡도를 아무리 만족해도 **그 값 자체를 버려야** 한다. 같은 코드로 묶으면 앱은 "10자 이상이어야 합니다" 옆에 "이미 잘 지켰는데?" 를 띄우게 된다.

### 앱 처리 지침

| code | 앱이 할 일 |
|------|-----------|
| `AUTH_TOKEN_EXPIRED` | `/auth/refresh` 시도 → 실패하면 로그인 화면 |
| `AUTH_SESSION_REVOKED` · `AUTH_REFRESH_EXPIRED` | **즉시 로그인 화면.** refresh 재시도 금지 |
| `AUTH_ACCOUNT_LOCKED` | 잠금 해제 시각을 안내 (`meta.lockedUntil`). **값이 없으면 관리자 잠금**이라 시간이 지나도 풀리지 않는다 — 관리자에게 문의하라고 안내한다. (2026-08-21 정정: 예전 문안은 `details.lockedUntil` 이었으나 `details` 는 검증 오류 목록 전용이고 구현은 한 번도 그렇게 실은 적이 없다. `AUTH_MFA_REQUIRED` 의 `meta.challenge` 와 같은 자리다) |
| `AUTH_MFA_REQUIRED` | `meta.challenge` 를 보관하고 코드 입력 화면 → `/auth/mfa/verify` |
| `AUTH_MFA_INVALID` | 같은 challenge 로 **재시도할 수 있다** (challenge 는 소모되지 않았다). 실패는 계정 잠금 카운터에 올라간다 |
| `AUTH_TOKEN_EXPIRED` (2단계 중) | challenge 만료 → **로그인부터 다시** |
| `AUTH_PASSWORD_BREACHED` | "다른 비밀번호를 쓰세요" 만 안내한다. 어디서 유출됐는지는 우리도 모르고, 알려 줄 수 있는 것도 아니다 |
| `AUTH_TERMS_REQUIRED` | `details[].field` 가 `agreements.<code>` 다. 그 체크박스를 짚어 준다 |
| `AUTH_MFA_REQUIRED` (step-up) | `meta.challenge` 가 **없고** `meta.stepUp` 이 있다. 코드를 입력받아 **같은 요청을 다시** 보낸다 — 로그인 화면으로 보내지 않는다 |
| `AUTH_CAPTCHA_REQUIRED` | **앱의 실수다.** 사용자에게 "다시 시도" 만 안내하고, 그 화면에 CAPTCHA 위젯을 붙였는지 확인한다 |
| `AUTH_CAPTCHA_FAILED` | 사용자에게 이유를 설명하지 않는다 — 우리도 점수만 알고, 알려 주면 넘길 때까지 조정하는 데 쓰인다. "다시 시도" 로 충분하다 |

> `AUTH_MFA_REQUIRED` 를 두 자리에서 같은 코드로 쓰는 이유 — 앱이 해야 할 일이 **둘 다 "코드를 받아 오는 것"** 이라 같다. 다른 것은 그다음 어디로 보내느냐뿐이고, 그 차이는 `meta.challenge` 의 유무로 드러난다. 코드를 나누면 앱은 사실상 같은 화면을 두 번 만들게 된다.

---

## 인가 — `AUTHZ_*`

| code | HTTP | 언제 |
|------|------|------|
| `AUTHZ_FORBIDDEN` | 403 | 권한 없음 (L1/L2 공통) |
| `AUTHZ_UNKNOWN_PERMISSION` | 400 | 등록되지 않은 권한 코드 부여 시도 (사전 등록제 — 결정 A4) |
| `AUTHZ_INVALID_PERMISSION_CODE` | 400 | 코드 문법 오류. 3파트 아님 · `**` 중간 배치 등 ([`authz.md`](authz.md) §2) |
| `AUTHZ_GRANT_CONFLICT` | 409 | 같은 (주체·리소스·액션) 에 grant 중복 [P2] |
| `AUTHZ_BATCH_TOO_LARGE` | 400 | `batch-check` 100건 초과 |

**403 응답에 "무엇이 없어서 막혔는지" 를 넣지 않는다.** 권한 구조가 공격자에게 노출된다. 대신 `traceId` 로 서버 로그에서 확인한다.

> 단 `/authz/check` 는 예외다. 앱이 판정을 위임한 것이므로 `reason` 을 돌려준다 ([`authz.md`](authz.md) §6).

---

## 사용자 대리 — `IMPERSONATION_*`

> 2026-08-20 추가. 계약은 [`http-api.md`](http-api.md) §4.

| code | HTTP | 언제 |
|------|------|------|
| `IMPERSONATION_SELF` | 400 | 자기 자신을 대리하려 했다 |
| `IMPERSONATION_TARGET_NOT_ACTIVE` | 409 | 대상이 `ACTIVE` 가 아니다 (잠김·비활성·초대대기·승인대기). `message` 에 현재 상태를 적는다 |
| `IMPERSONATION_ACTION_FORBIDDEN` | 403 | **대리 세션**이 민감 작업을 시도했다 — 관리 API(재대리 포함) · 비밀번호/이메일 변경 · 탈퇴 · 2단계 · 소셜 연결 · 약관 동의 · 세션 해지 |
| `IMPERSONATION_DISABLED` | 403 | `ixauth.impersonation.enabled=false` |

| 앱이 할 일 | |
|-----------|---|
| `IMPERSONATION_SELF` | **앱의 실수다.** 대리 버튼을 자기 행에 띄우지 않는다 |
| `IMPERSONATION_TARGET_NOT_ACTIVE` | "활성 사용자만 대리할 수 있다" 를 안내한다. 잠긴 계정이면 먼저 잠금 해제를 권한다 |
| `IMPERSONATION_ACTION_FORBIDDEN` | **로그인 화면으로 보내지 않는다.** "대리 중에는 할 수 없다 — 대리를 끝내고 본인으로 다시 로그인하라" 를 안내한다. 애초에 대리 중이면 그 버튼들을 감추는 편이 낫다 |
| `IMPERSONATION_DISABLED` | 대리 버튼 자체를 감춘다 |

> `IMPERSONATION_ACTION_FORBIDDEN` 을 `AUTHZ_FORBIDDEN` 과 나눈 이유 — 앱이 둘에 다르게 반응해야 한다. 권한 부족이면 "관리자에게 문의" 지만, 이건 **대리를 끝내면 되는** 일이다. 같은 코드로 묶으면 앱은 그 구분을 할 수 없고, 관리자는 자기에게 권한이 없다고 오해한다.

---

## 연합 신원 교환 — `AUTH_FEDERATION_*`

> 2026-08-27 추가. 계약은 [`http-api.md`](http-api.md) §2-7, 설정은 [`config.md`](config.md) §5-8.

| code | HTTP | 언제 |
|------|------|------|
| `AUTH_FEDERATION_DISABLED` | 403 | `ixauth.federation.enabled=false` |
| `AUTH_FEDERATION_PROVIDER_NOT_ALLOWED` | 403 | `ixauth.federation.allowed-providers` 에 없는 provider |
| `AUTH_FEDERATION_LINK_DENIED` | 409 | 같은 이메일의 계정이 있는데 `link-by-email=false`. **새 계정을 만들지 않는다** — 만들면 같은 주소의 계정이 둘이 된다 |
| `AUTH_FEDERATION_NO_ACCOUNT` | 404 | 연결된 계정이 없고 `auto-provision=false` 다. 이메일이 오지 않아 붙일 곳도 만들 근거도 없을 때도 같다 |

| 앱이 할 일 | |
|-----------|---|
| `AUTH_FEDERATION_DISABLED` | 그 IdP 의 로그인 버튼 자체를 감춘다. 계정과 무관한 전역 스위치다 |
| `AUTH_FEDERATION_PROVIDER_NOT_ALLOWED` | **앱의 실수이거나 운영자의 설정 누락이다.** 사용자에게는 "다시 시도" 만 안내하고, 허용 목록에 이름이 있는지 확인한다 |
| `AUTH_FEDERATION_LINK_DENIED` | "같은 주소의 계정이 이미 있다 — 관리자에게 연결을 요청하라" 를 안내한다. **다른 주소로 다시 시도하라고 하지 않는다** |
| `AUTH_FEDERATION_NO_ACCOUNT` | "등록된 계정이 없다 — 관리자에게 문의하라". 로그인 화면으로 되돌리면 사용자는 같은 버튼을 계속 누른다 |

> `AUTH_FEDERATION_DISABLED` 와 `AUTH_FEDERATION_PROVIDER_NOT_ALLOWED` 를 나눈 이유 — 앱이 다르게 반응해야 한다. 앞은 기능이 통째로 꺼진 것이라 **버튼을 감추는** 것이 답이고, 뒤는 기능은 켜져 있는데 이 provider 만 안 들어오는 것이라 **허용 목록에 이름을 추가하는** 것이 답이다. 같은 코드로 묶으면 운영자는 켜 둔 스위치를 다시 켜 보게 된다.

> `AUTH_FEDERATION_NO_ACCOUNT` 가 403 이 아닌 404 인 이유 — 권한이 없는 것이 아니라 **가리키는 사용자가 없다.** 403 으로 주면 앱은 "차단된 사람" 으로 읽고 사용자에게 엉뚱한 안내를 한다. 소셜의 `AUTH_SOCIAL_NO_ACCOUNT`(403)와 갈리는 지점이며, 그쪽은 계정 존재 여부를 흐리는 것이 목적이었지만 여기는 **앱이 이미 그 사람을 아는** 경로라 흐릴 것이 없다.

---

## 서비스 인증 — `SERVICE_*`

| code | HTTP | 언제 |
|------|------|------|
| `SERVICE_KEY_MISSING` | 401 | `X-IxAuth-Key` 헤더 없음 |
| `SERVICE_KEY_INVALID` | 401 | 키 불일치 |

---

## 공통 — 그 외

| code | HTTP | 언제 |
|------|------|------|
| `VALIDATION_FAILED` | 400 | 요청 형식 오류. `details` 에 필드별 사유 |
| `NOT_FOUND` | 404 | 리소스 없음 · **매핑되지 않은 경로** |
| `METHOD_NOT_ALLOWED` | 405 | 경로는 있으나 메서드가 다름. 허용 메서드를 `Allow` 헤더로 동반 |
| `CONFLICT` | 409 | 이메일 중복 · 시스템 역할 변경 시도 등 |
| `RATE_LIMITED` | 429 | Rate limit 초과. `Retry-After` 헤더 동반 |
| `SERVICE_UNAVAILABLE` | 503 | DB 연결 실패 · 마이그레이션 미적용 |
| `INTERNAL` | 500 | 그 외 전부 |

### `details` 형식

```json
{ "error": {
  "code": "VALIDATION_FAILED",
  "message": "요청 값이 올바르지 않습니다.",
  "traceId": "0f4c…",
  "details": [
    { "field": "email", "reason": "형식이 올바르지 않습니다." },
    { "field": "password", "reason": "최소 10자 이상이어야 합니다." }
  ]
} }
```

---

## 규칙

1. **`INTERNAL` 에 원인을 담지 않는다.** 스택트레이스·SQL·내부 경로 금지. `traceId` 로 서버 로그를 본다
2. **새 코드를 추가할 때 기존 코드의 의미를 바꾸지 않는다.** 앱이 이미 분기하고 있다 (계약 하위 호환 — [`../../.claude/rules/contract-policy.md`](../../.claude/rules/contract-policy.md))
3. **접두어로 도메인을 구분한다** — `AUTH_` / `AUTHZ_` / `SERVICE_` / 접두어 없음(공통). 앱이 접두어만 보고 대분류할 수 있어야 한다
4. 로그인 실패는 **어떤 경우에도 계정 존재 여부를 노출하지 않는다.** 이 규칙은 테스트로 고정한다
